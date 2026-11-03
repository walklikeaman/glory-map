// Classify a film's gallery images: which are frames FROM the film, and which are
// posters of it (#107).
//
// A separate enrichment job rather than part of /api/work, for the same reason posters
// are: opening a profile must not wait on a model call. The profile serves whatever
// has been classified and honestly labels the rest, and this job fills the cache.
//
// Every image is paid for once. The verdict for a given file never changes, and
// rejected images are stored as rejections — without that we would re-ask about the
// same gun-barrel poster on every visit.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { createClient } from "@supabase/supabase-js";

import { DEFAULT_CLAUDE_MODEL } from "../../../lib/model-client.mjs";
import {
  buildClassificationContent,
  buildClaudeClassificationContent,
  classificationInstructions,
  imageBatches,
  MAX_IMAGES_PER_WORK,
  stillClassificationSchema,
  verdictRows,
} from "../../../lib/still-classify.mjs";
import { selectTmdbBackdrops, tmdbImageUrl } from "../../../lib/tmdb-images.mjs";
import { enrichGuard } from "../../../lib/enrich-auth.mjs";

export const runtime = "nodejs";
export const maxDuration = 300;

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const TMDB_PATH = Object.freeze({ film: "movie", series: "tv" });

// Small: this spends money per image, and there is no deadline. Galleries fill in over
// several runs rather than one expensive burst.
export const DEFAULT_WORK_LIMIT = 3;
export const MAX_WORK_LIMIT = 10;

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function defaultCreateStore(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  return {
    // Works worth classifying: they have a TMDB id and no verdicts yet. Ordered by
    // place count so the films people actually browse get their galleries first.
    async pendingWorks(limit) {
      const { data, error } = await client
        .from("works")
        .select("id, title, kind, tmdb_id, work_images(id)")
        .not("tmdb_id", "is", null)
        .limit(limit * 4);
      if (error) throw new Error(`works load failed: ${error.message}`);
      return (data ?? [])
        .filter((work) => (work.work_images?.length ?? 0) === 0)
        .slice(0, limit);
    },
    async loadWork(workId) {
      const { data, error } = await client
        .from("works").select("id, title, kind, tmdb_id").eq("id", workId).maybeSingle();
      if (error) throw new Error(`work load failed: ${error.message}`);
      return data;
    },
    async saveVerdicts(rows) {
      if (rows.length === 0) return 0;
      const { error } = await client
        .from("work_images")
        .upsert(rows, { onConflict: "work_id,file_path" });
      if (error) throw new Error(`verdict save failed: ${error.message}`);
      return rows.length;
    },
  };
}

async function backdropsFor(work, { env, fetchImpl }) {
  const path = TMDB_PATH[work.kind];
  const token = env.TMDB_API_READ_ACCESS_TOKEN;
  const apiKey = env.TMDB_API_KEY;
  if (!path || (!token && !apiKey)) return [];

  const attempts = [];
  if (token) {
    attempts.push({
      url: `https://api.themoviedb.org/3/${path}/${work.tmdb_id}/images`,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
  }
  if (apiKey) {
    attempts.push({
      url: `https://api.themoviedb.org/3/${path}/${work.tmdb_id}/images?api_key=${encodeURIComponent(apiKey)}`,
      headers: { Accept: "application/json" },
    });
  }

  for (const attempt of attempts) {
    const response = await fetchImpl(attempt.url, { headers: attempt.headers });
    if (response?.ok) {
      const payload = await response.json();
      const all = Array.isArray(payload?.backdrops) ? payload.backdrops : [];
      // The total is reported because the cap is the interesting number: if a film has
      // 60 backdrops and we judge 12, a location shot may simply never be offered.
      return { picked: selectTmdbBackdrops(all, MAX_IMAGES_PER_WORK), available: all.length };
    }
    if (response?.status !== 401 && response?.status !== 403) break;
  }
  return { picked: [], available: 0 };
}

// One batch of images in, the parsed verdicts out — or a thrown error, which loses only
// that batch. Claude is used when its key is configured; OpenAI otherwise.
function createClassifier(env, { createOpenAIClient, createAnthropicClient }) {
  if (env.ANTHROPIC_API_KEY) {
    const claude = createAnthropicClient(env.ANTHROPIC_API_KEY);
    return async (urls) => {
      const message = await claude.messages.parse({
        model: env.ANTHROPIC_VISION_MODEL || env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL,
        // Thinking counts against this budget too; the verdicts alone are small.
        max_tokens: 16_000,
        system: classificationInstructions(),
        messages: [{ role: "user", content: buildClaudeClassificationContent(urls) }],
        output_config: { format: zodOutputFormat(stillClassificationSchema), effort: "low" },
      }, { timeout: 120_000 });
      // A refused or truncated response must not be written: storing its silence
      // would permanently mark real frames as rejected.
      if (message.stop_reason !== "end_turn" || !message.parsed_output) {
        throw new Error(`vision stopped with ${message.stop_reason}`);
      }
      return message.parsed_output;
    };
  }

  const openai = createOpenAIClient(env.OPENAI_API_KEY);
  return async (urls) => {
    const response = await openai.responses.parse({
      model: env.OPENAI_VISION_MODEL || "gpt-5-nano",
      store: false,
      // A verdict per image is small, but this is a reasoning model and reasoning
      // tokens count against the same budget. 1200 produced `incomplete` on a
      // 12-image gallery and wrote nothing at all; low effort plus real headroom
      // is what makes a full batch fit.
      max_output_tokens: 4000,
      reasoning: { effort: "low" },
      instructions: classificationInstructions(),
      input: [{ role: "user", content: buildClassificationContent(urls) }],
      text: { format: zodTextFormat(stillClassificationSchema, "still_classification") },
    }, { timeout: 60_000 });
    // A refused or truncated response must not be written: storing its silence
    // would permanently mark real frames as rejected.
    if (response.status !== "completed" || !response.output_parsed) {
      throw new Error(`vision responded ${response.status}`);
    }
    return response.output_parsed;
  };
}

export function createStillsEnrichHandler({
  env = process.env,
  createStore = defaultCreateStore,
  createOpenAIClient = (apiKey) => new OpenAI({ apiKey }),
  createAnthropicClient = (apiKey) => new Anthropic({ apiKey }),
  fetchImpl = fetch,
  logError = console.error,
} = {}) {
  return async function POST(request) {
    // Before anything is read, parsed, or paid for.
    const refusal = enrichGuard(request, env);
    if (refusal) return refusal;

    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY) return jsonError("Vision is not configured.", 503);
    const store = createStore(env);
    if (!store) return jsonError("Storage is not configured.", 503);

    const limit = Math.min(
      Number.parseInt(body?.limit, 10) || DEFAULT_WORK_LIMIT,
      MAX_WORK_LIMIT,
    );

    let works;
    try {
      works = body?.work_id
        ? [await store.loadWork(body.work_id)].filter(Boolean)
        : await store.pendingWorks(limit);
    } catch (error) {
      logError("stills: load failed", error);
      return jsonError("Could not load works.", 502);
    }

    if (works.length === 0) {
      return Response.json({ classified: 0, works: [] }, { headers: noStoreHeaders });
    }

    const classify = createClassifier(env, { createOpenAIClient, createAnthropicClient });
    const results = [];

    for (const work of works) {
      let candidates = [];
      let available = 0;
      try {
        ({ picked: candidates, available } = await backdropsFor(work, { env, fetchImpl }));
      } catch (error) {
        logError(`stills: tmdb failed for ${work.id}`, error);
      }
      if (candidates.length === 0) {
        results.push({ work_id: work.id, title: work.title, reason: "no_images" });
        continue;
      }

      // Several calls, one per batch: a whole gallery in one request would make index
      // confusion likely, and one bad answer would poison far more of it.
      const rows = [];
      let failed = false;
      for (const batch of imageBatches(candidates)) {
      try {
        const parsed = await classify(batch.map((image) => tmdbImageUrl(image.file_path, "w780")));
        rows.push(...verdictRows(work.id, batch, parsed));
      } catch (error) {
        // One failed batch loses its own images, not the whole gallery.
        logError(`stills: vision failed for ${work.id}`, error);
        failed = true;
      }
      }

      if (rows.length === 0) {
        results.push({ work_id: work.id, title: work.title, reason: failed ? "vision_failed" : "no_verdicts" });
        continue;
      }

      try {
        await store.saveVerdicts(rows);
      } catch (error) {
        logError(`stills: save failed for ${work.id}`, error);
        results.push({ work_id: work.id, title: work.title, reason: "save_failed" });
        continue;
      }

      results.push({
        work_id: work.id,
        title: work.title,
        judged: rows.length,
        available,
        frames: rows.filter((row) => row.is_frame).length,
        rejected: rows.filter((row) => !row.is_frame).length,
      });
    }

    return Response.json(
      { classified: results.filter((row) => row.judged).length, works: results },
      { headers: noStoreHeaders },
    );
  };
}

export const POST = createStillsEnrichHandler();
