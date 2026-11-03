import assert from "node:assert/strict";
import test from "node:test";

import {
  NARRATOR_PROFILES,
  createSpeechRequest,
  narrationText,
} from "../app/lib/voice-guide.mjs";

const location = {
  place: "Example Square",
  film: "Example Film",
  description: "A verified description of the scene.",
};

test("uses the generated story when spoilers are allowed", () => {
  assert.equal(
    narrationText({ location, story: "A short original story.", spoilerFree: false }),
    "A short original story.",
  );
});

test("uses a generic verified-location recap in spoiler-free mode", () => {
  const text = narrationText({ location, story: "The ending is revealed.", spoilerFree: true });

  assert.match(text, /Example Square/);
  assert.match(text, /Example Film/);
  assert.doesNotMatch(text, /ending/);
});

test("offers high-quality OpenAI voices without actor imitation", () => {
  assert.deepEqual(Object.keys(NARRATOR_PROFILES), ["neutral", "archivist", "noir", "suspense", "epic", "light", "tender"]);
  assert.equal(NARRATOR_PROFILES.neutral.label, "Warm guide");
  assert.equal(NARRATOR_PROFILES.neutral.voice, "marin");
  assert.equal(NARRATOR_PROFILES.archivist.label, "Curious archivist");
  assert.equal(NARRATOR_PROFILES.archivist.voice, "cedar");
});

test("builds a server-side OpenAI speech request", () => {
  assert.deepEqual(
    createSpeechRequest({
      text: "  A short original recap.  ",
      profileId: "neutral",
      model: "gpt-4o-mini-tts",
    }),
    {
      model: "gpt-4o-mini-tts",
      voice: "marin",
      input: "A short original recap.",
      instructions: NARRATOR_PROFILES.neutral.instructions,
      response_format: "mp3",
    },
  );
});

test("rejects unknown profiles and oversized narration", () => {
  assert.throws(
    () => createSpeechRequest({ text: "A story", profileId: "actor" }),
    /Invalid narration request/,
  );
  assert.throws(
    () => createSpeechRequest({ text: "x".repeat(601), profileId: "neutral" }),
    /Invalid narration request/,
  );
});
