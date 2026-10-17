import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

import { modelFailed, notConfigured, readJsonBody } from "../../lib/ai-route.mjs";
import { createSpeechRequest } from "../../lib/voice-guide.mjs";
import { ttsCacheTarget, TTS_BUCKET } from "../../lib/tts-cache.mjs";
import { guideLanguage } from "../../lib/guide-language.mjs";

export const runtime = "nodejs";

const audioHeaders = (cache) => ({
  "Content-Type": "audio/mpeg",
  // A guide clip is not private, and a replay should be instant.
  "Cache-Control": "public, max-age=31536000, immutable",
  "X-TTS-Cache": cache,
});

// Reads are public (the bucket is public-read); writes need the service role. A
// deployment without that key still WORKS — it regenerates every time instead of
// caching. Losing the cache must never mean losing the feature.
function defaultCreateCache(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  return {
    url,
    canWrite: Boolean(serviceKey),
    async save(path, bytes) {
      if (!serviceKey) return false;
      const client = createClient(url, serviceKey, { auth: { persistSession: false } });
      const { error } = await client.storage.from(TTS_BUCKET).upload(path, bytes, {
        contentType: "audio/mpeg",
        upsert: false, // the same key is the same audio, so a re-upload is pointless
      });
      // A duplicate means another request cached it first — a hit, not a failure.
      return !error || /exists/i.test(error.message ?? "");
    },
  };
}

// POST /api/narration — speak a narration, reusing a cached clip when one exists.
//
// The cache key is a hash of (text, voice, model, and the language when it is not English), so editing the narration changes
// the key and the stale clip is simply never requested again. There is no purge step
// because none is needed.
export function createNarrationHandler({
  env = process.env,
  fetchImpl = (...args) => fetch(...args),
  createOpenAIClient = (apiKey) => new OpenAI({ apiKey }),
  createCache,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeCache = createCache ?? (() => defaultCreateCache(env));

  return async function POST(request) {
    const body = await readJsonBody(request);

    const language = guideLanguage(body?.language).code;
    let speechRequest;
    try {
      speechRequest = createSpeechRequest({
        text: body?.text,
        profileId: body?.profileId,
        model: env.OPENAI_TTS_MODEL,
        language,
      });
    } catch {
      return Response.json({ error: "Provide a valid narration and narrator." }, { status: 400 });
    }

    const cache = makeCache(env);
    const target = cache
      ? ttsCacheTarget({
          text: speechRequest.input,
          voice: speechRequest.voice,
          model: speechRequest.model,
          language,
          supabaseUrl: cache.url,
        })
      : null;

    // A hit costs nothing on the model and is served by the CDN.
    if (target?.publicUrl) {
      try {
        const cached = await fetchImpl(target.publicUrl, { signal: request.signal });
        if (cached.ok) {
          return new Response(cached.body, { status: 200, headers: audioHeaders("hit") });
        }
      } catch (error) {
        // A cache that is down must not break playback — fall through and generate.
        if (error?.name !== "AbortError") {
          logError("TTS cache read failed", { message: error?.message });
        }
      }
    }

    if (!env.OPENAI_API_KEY) {
      return notConfigured("The OpenAI API key is not configured.");
    }

    try {
      const openai = createOpenAIClient(env.OPENAI_API_KEY);
      const speech = await openai.audio.speech.create(speechRequest);

      // Buffered once so the same bytes are both stored and returned; streaming
      // straight through would leave nothing to cache.
      const bytes = new Uint8Array(await speech.arrayBuffer());

      if (target && cache?.canWrite) {
        // Storing must never delay or break playback, so the write is not awaited
        // and its failure is logged rather than surfaced.
        Promise.resolve(cache.save(target.path, bytes)).catch((error) => {
          logError("TTS cache write failed", { message: error?.message });
        });
      }

      return new Response(bytes, { status: 200, headers: audioHeaders("miss") });
    } catch (error) {
      return modelFailed({
        error, label: "OpenAI narration generation failed", message: "Could not generate the voice guide. Try again.", log: logError,
      });
    }
  };
}

export const POST = createNarrationHandler();
