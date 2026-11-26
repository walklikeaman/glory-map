import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createNarrationHandler } from "../app/api/narration/route.js";
import { narrationBodyFromUrl, narrationUrl, startStreamedAudio } from "../app/lib/narration-stream.mjs";

test("a stream address carries the same fields the POST takes", () => {
  const url = narrationUrl({ text: "  Rue de l'Abreuvoir & café?  ", profileId: "noir", language: "fr" });
  assert.match(url, /^\/api\/narration\?/);
  assert.deepEqual(narrationBodyFromUrl(url), { text: "Rue de l'Abreuvoir & café?", profileId: "noir", language: "fr" });
  assert.equal(narrationBodyFromUrl(narrationUrl({ text: "Hi" })).language, undefined);
  assert.equal(narrationUrl({ text: "" }), null);
  assert.equal(narrationUrl({ text: "x".repeat(601) }), null);
});

function fakeAudio({ event, playRejects = false } = {}) {
  const listeners = new Map();
  return {
    src: "",
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    play() {
      if (playRejects) return Promise.reject(new Error("blocked"));
      if (event) setTimeout(() => listeners.get(event)?.(), 0);
      return Promise.resolve();
    },
    listeners,
  };
}

test("a stream resolves at the first sound and cleans up its listeners", async () => {
  const audio = fakeAudio({ event: "playing" });
  await startStreamedAudio(audio, "/api/narration?text=a");
  assert.equal(audio.src, "/api/narration?text=a");
  assert.equal(audio.listeners.size, 0);
});

test("a stream that errors, is blocked or stays silent rejects, so the whole clip is asked for", async () => {
  await assert.rejects(startStreamedAudio(fakeAudio({ event: "error" }), "/a"));
  await assert.rejects(startStreamedAudio(fakeAudio({ playRejects: true }), "/a"));
  const silent = fakeAudio();
  await assert.rejects(startStreamedAudio(silent, "/a", { timeoutMs: 5 }));
  assert.equal(silent.listeners.size, 0);
});

function streamOf(chunks, { failAfter = Infinity } = {}) {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= failAfter) { controller.error(new Error("cut")); return; }
      if (i >= chunks.length) { controller.close(); return; }
      controller.enqueue(new Uint8Array(chunks[i++]));
    },
  });
}

function handlerWith(speechBody, saved) {
  return createNarrationHandler({
    env: { OPENAI_API_KEY: "k", NEXT_PUBLIC_SUPABASE_URL: "https://db.example" },
    fetchImpl: async () => ({ ok: false }),
    createOpenAIClient: () => ({ audio: { speech: { create: async () => ({ body: speechBody }) } } }),
    createCache: () => ({ url: "https://db.example", canWrite: true, save: async (path, bytes) => { saved.push(bytes.length); return true; } }),
    logError: () => {},
  });
}

test("GET streams OpenAI's audio through and caches it once the stream ends", async () => {
  const saved = [];
  const handler = handlerWith(streamOf([[1, 2], [3, 4, 5]]), saved);
  const response = await handler(new Request(`http://localhost${narrationUrl({ text: "The bench.", profileId: "neutral" })}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-TTS-Cache"), "miss");
  assert.equal((await response.arrayBuffer()).byteLength, 5);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(saved, [5]);
});

test("a stream that breaks off is not cached", async () => {
  const saved = [];
  const handler = handlerWith(streamOf([[1, 2], [3]], { failAfter: 1 }), saved);
  const response = await handler(new Request(`http://localhost${narrationUrl({ text: "Cut short." })}`));
  await response.arrayBuffer().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(saved, []);
});

test("GET checks its text like the POST does", async () => {
  const handler = handlerWith(streamOf([[1]]), []);
  const response = await handler(new Request("http://localhost/api/narration?text=&profileId=neutral"));
  assert.equal(response.status, 400);
});

test("both players try the stream before the whole clip", () => {
  for (const file of ["useTellingPlayer.js", "VoiceGuide.jsx"]) {
    const source = readFileSync(new URL(`../app/components/${file}`, import.meta.url), "utf8");
    assert.ok(source.indexOf("startStreamedAudio(") > 0, file);
    assert.ok(source.indexOf("startStreamedAudio(") < source.indexOf('fetch("/api/narration"'), file);
  }
});
