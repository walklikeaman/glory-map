import assert from "node:assert/strict";
import test from "node:test";

import { createNarrationHandler, POST } from "../app/api/narration/route.js";

function narrationRequest(body) {
  return new Request("http://localhost/api/narration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("narration API validates input before contacting OpenAI", async () => {
  const response = await POST(narrationRequest({ text: "", profileId: "neutral" }));

  assert.equal(response.status, 400);
});

test("narration API keeps the OpenAI key server-side", async (context) => {
  const originalKey = process.env.OPENAI_API_KEY;
  context.after(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });
  delete process.env.OPENAI_API_KEY;

  const response = await POST(narrationRequest({
    text: "A short original recap.",
    profileId: "neutral",
  }));
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.match(payload.error, /not configured/);
});

test("a narration in another language is spoken in it and cached under its own key (#67)", async () => {
  const spoken = [];
  const fetched = [];
  const handler = createNarrationHandler({
    env: { OPENAI_API_KEY: "k", NEXT_PUBLIC_SUPABASE_URL: "https://db.example" },
    fetchImpl: async (url) => { fetched.push(url); return { ok: false }; },
    createOpenAIClient: () => ({ audio: { speech: { create: async (request) => {
      spoken.push(request);
      return { arrayBuffer: async () => new ArrayBuffer(4) };
    } } } }),
  });

  await handler(narrationRequest({ text: "Bonjour", profileId: "neutral", language: "fr" }));
  await handler(narrationRequest({ text: "Bonjour", profileId: "neutral" }));

  assert.match(spoken[0].instructions, /Speak in French/);
  assert.doesNotMatch(spoken[1].instructions, /Speak in/);
  assert.notEqual(fetched[0], fetched[1]);
});
