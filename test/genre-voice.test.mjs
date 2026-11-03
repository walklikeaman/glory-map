import assert from "node:assert/strict";
import test from "node:test";

import { createGenresHandler } from "../app/api/genres/route.js";
import {
  NARRATOR_PROFILES,
  createSpeechRequest,
  genreProfileId,
  resolveNarrator,
} from "../app/lib/voice-guide.mjs";

test("a genre picks a tone, in a tactful order", () => {
  assert.equal(genreProfileId(["Crime", "Comedy"]), "noir");
  assert.equal(genreProfileId([{ id: 27, name: "Horror" }]), "suspense");
  assert.equal(genreProfileId(["Science Fiction", "Action"]), "epic");
  assert.equal(genreProfileId(["Sci-Fi & Fantasy"]), "epic");
  assert.equal(genreProfileId(["Romance", "Comedy"]), "tender");
  assert.equal(genreProfileId(["Animation"]), "light");
});

test("drama, documentary and no genre keep the warm guide", () => {
  assert.equal(genreProfileId(["Drama", "Documentary", "History"]), null);
  assert.equal(resolveNarrator("auto", ["Documentary"]), "neutral");
  assert.equal(resolveNarrator("auto", []), "neutral");
  assert.equal(resolveNarrator(undefined, undefined), "neutral");
});

test("an explicit narrator always wins over the genre", () => {
  assert.equal(resolveNarrator("auto", ["Crime"]), "noir");
  assert.equal(resolveNarrator("neutral", ["Crime"]), "neutral");
  assert.equal(resolveNarrator("epic", ["Romance"]), "epic");
  assert.equal(resolveNarrator("made-up", ["Romance"]), "tender");
});

test("every profile is speakable, and every genre tone imitates nobody", () => {
  for (const [id, profile] of Object.entries(NARRATOR_PROFILES)) {
    const request = createSpeechRequest({ text: "Here.", profileId: id });
    assert.equal(request.voice, profile.voice);
    if (!profile.genre) continue;
    assert.match(profile.instructions, /original/i, id);
    assert.match(profile.instructions, /(not|never|without) imitat/i, id);
  }
});

const genresRequest = (query) => new Request(`http://localhost/api/genres?${query}`);
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

test("the genre route returns TMDB's genre names, cached at the edge", async () => {
  const urls = [];
  const handler = createGenresHandler({
    env: { TMDB_API_KEY: "k" },
    fetchImpl: async (url) => { urls.push(url); return json(200, { genres: [{ id: 80, name: "Crime" }, { id: 18, name: "Drama" }] }); },
  });
  const response = await handler(genresRequest("kind=film&id=500"));
  assert.deepEqual(await response.json(), { genres: ["Crime", "Drama"] });
  assert.match(response.headers.get("Cache-Control"), /max-age=604800/);
  assert.match(urls[0], /\/3\/movie\/500\?api_key=k/);

  await handler(genresRequest("kind=series&id=1399"));
  assert.match(urls[1], /\/3\/tv\/1399/);
});

test("the genre route turns every failure into no genre, and refuses a bad id", async () => {
  const quiet = () => {};
  assert.equal((await createGenresHandler({ env: {}, logError: quiet })(genresRequest("kind=book&id=5"))).status, 400);
  assert.equal((await createGenresHandler({ env: {}, logError: quiet })(genresRequest("kind=film&id=abc"))).status, 400);

  const noKey = await createGenresHandler({ env: {}, logError: quiet })(genresRequest("kind=film&id=5"));
  assert.deepEqual(await noKey.json(), { genres: [], reason: "no_credentials" });

  const down = createGenresHandler({ env: { TMDB_API_KEY: "k" }, logError: quiet, fetchImpl: async () => json(503, {}) });
  assert.deepEqual(await (await down(genresRequest("kind=film&id=5"))).json(), { genres: [], reason: "http_503" });

  const offline = createGenresHandler({ env: { TMDB_API_KEY: "k" }, logError: quiet, fetchImpl: async () => { throw new Error("offline"); } });
  assert.deepEqual(await (await offline(genresRequest("kind=film&id=5"))).json(), { genres: [], reason: "threw" });
});
