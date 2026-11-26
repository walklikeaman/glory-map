import assert from "node:assert/strict";
import test from "node:test";

import { createNarrationHandler } from "../app/api/narration/route.js";
import {
  TTS_BUCKET,
  ttsCacheKey,
  ttsCacheTarget,
  ttsObjectPath,
  ttsPublicUrl,
} from "../app/lib/tts-cache.mjs";

const SUPABASE = "https://project.supabase.co";
const base = { text: "Stand where the scene was filmed.", voice: "marin", model: "gpt-4o-mini-tts" };

test("the key covers everything that changes the audio", () => {
  const key = ttsCacheKey(base);
  // A different voice or model is different audio, so it must be a different clip.
  assert.notEqual(key, ttsCacheKey({ ...base, voice: "cedar" }));
  assert.notEqual(key, ttsCacheKey({ ...base, model: "other-tts" }));
  assert.notEqual(key, ttsCacheKey({ ...base, text: "A different line." }));
});

test("editing the narration invalidates the cache by itself", () => {
  // This is why there is no purge step: the stale clip is simply never asked for.
  const before = ttsCacheKey(base);
  const after = ttsCacheKey({ ...base, text: `${base.text} Now with a correction.` });
  assert.notEqual(before, after);
});

test("the same narration always returns the same key, whitespace aside", () => {
  assert.equal(ttsCacheKey(base), ttsCacheKey({ ...base, text: `  ${base.text}  ` }));
});

test("key parts cannot be confused with one another", () => {
  // Without a separator, ("ab","c") and ("a","bc") would hash alike and one clip
  // would be served for two different requests.
  assert.notEqual(
    ttsCacheKey({ text: "ab", voice: "c", model: "m" }),
    ttsCacheKey({ text: "a", voice: "bc", model: "m" }),
  );
});

test("an empty narration is not cacheable", () => {
  assert.equal(ttsCacheKey({ ...base, text: "" }), null);
  assert.equal(ttsCacheKey({ ...base, text: "   " }), null);
  assert.equal(ttsCacheKey({ ...base, text: null }), null);
  assert.equal(ttsCacheTarget({ ...base, text: "", supabaseUrl: SUPABASE }), null);
});

test("the object path is grouped by model and voice, and is filesystem-safe", () => {
  const path = ttsObjectPath({ key: "abc123", voice: "marin", model: "gpt-4o-mini-tts" });
  assert.equal(path, "gpt-4o-mini-tts/marin/abc123.mp3");
  // A hostile voice or model name must not escape the bucket. Dots are stripped from
  // path segments entirely — they are what makes traversal possible.
  const nasty = ttsObjectPath({ key: "k", voice: "../../etc/passwd", model: "a/b" });
  assert.equal(nasty.includes(".."), false);
  assert.equal(nasty, "ab/etcpasswd/k.mp3");
  // Only the extension keeps its dot.
  assert.equal(nasty.split("/").pop(), "k.mp3");
});

test("a hit is served from the public CDN url", () => {
  const target = ttsCacheTarget({ ...base, supabaseUrl: SUPABASE });
  assert.equal(
    target.publicUrl,
    `${SUPABASE}/storage/v1/object/public/${TTS_BUCKET}/${target.path}`,
  );
  assert.equal(ttsPublicUrl(null, "a/b.mp3"), null);
});

// --- route -------------------------------------------------------------------

const narrationRequest = (body) =>
  new Request("http://localhost/api/narration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const speechBytes = new Uint8Array([1, 2, 3, 4]);

function handlerWith(overrides = {}) {
  return createNarrationHandler({
    env: { OPENAI_API_KEY: "k", NEXT_PUBLIC_SUPABASE_URL: SUPABASE, ...overrides.env },
    fetchImpl: overrides.fetchImpl ?? (async () => new Response("", { status: 404 })),
    createOpenAIClient: () => ({
      audio: {
        speech: {
          create: async () => {
            overrides.onGenerate?.();
            return new Response(speechBytes);
          },
        },
      },
    }),
    createCache: overrides.createCache,
    logError: () => {},
  });
}

test("a cached clip is returned without calling the model at all", async () => {
  let generated = 0;
  const handler = handlerWith({
    onGenerate: () => { generated += 1; },
    fetchImpl: async () => new Response(speechBytes, { status: 200 }),
  });

  const response = await handler(narrationRequest({ text: "Hello there.", profileId: "neutral" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-TTS-Cache"), "hit");
  assert.equal(generated, 0); // the whole point: a replay costs nothing
});

test("a miss generates once and stores the bytes for next time", async () => {
  let stored = null;
  const handler = handlerWith({
    createCache: () => ({
      url: SUPABASE,
      canWrite: true,
      save: async (path, bytes) => { stored = { path, size: bytes.length }; return true; },
    }),
  });

  const response = await handler(narrationRequest({ text: "Hello there.", profileId: "neutral" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-TTS-Cache"), "miss");
  // The clip is streamed to the listener (#65) and stored once the stream has ended.
  assert.equal((await response.arrayBuffer()).byteLength, speechBytes.length);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(stored.size, speechBytes.length);
  assert.match(stored.path, /\/.+\.mp3$/);
});

test("losing the cache must never mean losing the feature", async () => {
  // Storage down on read, and unwritable — playback still works, just uncached.
  let generated = 0;
  const handler = handlerWith({
    onGenerate: () => { generated += 1; },
    fetchImpl: async () => { throw new Error("storage down"); },
    createCache: () => ({
      url: SUPABASE,
      canWrite: false,
      save: async () => { throw new Error("should not be called"); },
    }),
  });

  const response = await handler(narrationRequest({ text: "Hello there.", profileId: "neutral" }));
  assert.equal(response.status, 200);
  assert.equal(generated, 1);
});

test("a failed cache write does not fail the response", async () => {
  const handler = handlerWith({
    createCache: () => ({
      url: SUPABASE,
      canWrite: true,
      save: async () => { throw new Error("upload failed"); },
    }),
  });
  const response = await handler(narrationRequest({ text: "Hello there.", profileId: "neutral" }));
  assert.equal(response.status, 200); // the listener hears the clip regardless
});

test("input is still validated before anything is cached or generated", async () => {
  let generated = 0;
  const handler = handlerWith({ onGenerate: () => { generated += 1; } });
  const response = await handler(narrationRequest({ text: "", profileId: "neutral" }));
  assert.equal(response.status, 400);
  assert.equal(generated, 0);
});
