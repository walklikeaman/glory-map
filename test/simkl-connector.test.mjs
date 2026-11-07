import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createSimklImportHandler } from "../app/api/import/simkl/route.js";
import {
  createPkcePair, libraryFromSimkl, simklApiUrl, simklAuthorizeUrl, simklRedirectUri,
} from "../app/lib/connectors/simkl.mjs";
import { mergeLibraries } from "../app/lib/media-library.mjs";
import { MEDIA_SOURCES, toTenPoint } from "../app/lib/media-sources.mjs";

const MOVIES = {
  movies: [
    { status: "completed", user_rating: 9, last_watched_at: "2026-10-01T20:00:00Z",
      movie: { title: "Notting Hill", year: 1999, ids: { simkl: 53434, slug: "notting-hill", imdb: "tt0125439", tmdb: "509" } } },
    { status: "completed", movie: { title: "Skyfall", year: 2012, ids: { simkl: 1 } } },
  ],
};
const SHOWS = {
  shows: [
    { status: "watching", show: { title: "Sherlock", year: 2010, ids: { simkl: 7, slug: "sherlock", imdb: "tt1475582" } } },
    { status: "plantowatch", show: { title: "Not Yet", year: 2020, ids: { simkl: 8 } } },
    { status: "dropped", show: { title: "Gave Up", year: 2019, ids: { simkl: 9 } } },
  ],
};

test("PKCE pair: a 43-char verifier and its S256 challenge", async () => {
  const { verifier, challenge } = await createPkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  const expected = createHash("sha256").update(verifier).digest("base64url");
  assert.equal(challenge, expected);
});

test("the authorize URL asks for read-only access with S256", () => {
  const url = new URL(simklAuthorizeUrl({ clientId: "abc", redirectUri: simklRedirectUri("https://glory-map.vercel.app/"), state: "s1", codeChallenge: "c1" }));
  assert.equal(url.origin + url.pathname, "https://simkl.com/oauth2/authorize");
  assert.equal(url.searchParams.get("redirect_uri"), "https://glory-map.vercel.app/auth/simkl");
  assert.equal(url.searchParams.get("scope"), "media:read");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "s1");
});

test("API URLs carry the app identity", () => {
  const url = new URL(simklApiUrl("/sync/all-items/movies/completed", { clientId: "abc", extended: "ids_only" }));
  assert.equal(url.host, "api.simkl.com");
  assert.equal(url.searchParams.get("client_id"), "abc");
  assert.equal(url.searchParams.get("app-name"), "glorymap");
  assert.equal(url.searchParams.get("extended"), "ids_only");
});

test("watched films and series become library rows; wish list and dropped do not", () => {
  const rows = libraryFromSimkl({ movies: MOVIES, shows: SHOWS });
  assert.deepEqual(rows.map((row) => row.title), ["Notting Hill", "Skyfall", "Sherlock"]);
  const [notting] = rows;
  assert.equal(notting.imdbId, "tt0125439");
  assert.equal(notting.rating, 9);
  assert.equal(notting.url, "https://simkl.com/movies/53434/notting-hill");
  assert.equal(rows[2].url, "https://simkl.com/tv/7/sherlock");
  assert.equal(rows[1].rating, null);
  assert.deepEqual(libraryFromSimkl({ movies: null, shows: {} }), []);
});

test("a Simkl row merges with the same film from an IMDb CSV by imdb id", () => {
  const imdb = [{ id: "tt0125439", title: "Notting Hill", year: 1999, rating: 7, ratingScale: 10, imdbId: "tt0125439", sources: ["imdb"] }];
  const merged = mergeLibraries(imdb, libraryFromSimkl({ movies: MOVIES }));
  assert.equal(merged.filter((row) => row.title === "Notting Hill").length, 1);
  assert.deepEqual(merged.find((row) => row.title === "Notting Hill").sources, ["imdb", "simkl"]);
});

test("simkl is a sign-in source on the ten-point scale", () => {
  assert.equal(MEDIA_SOURCES.simkl.signIn, true);
  assert.equal(toTenPoint(8, "simkl"), 8);
});

function fakeSimkl({ tokenStatus = 200, listStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/oauth2/token")) {
      return Response.json(tokenStatus === 200 ? { access_token: "at", refresh_token: "simkl_rt_1", token_type: "Bearer" } : { error: "invalid_grant" }, { status: tokenStatus });
    }
    if (listStatus !== 200) return new Response("", { status: listStatus });
    return Response.json(String(url).includes("/movies/") ? MOVIES : SHOWS);
  };
  return { calls, fetchImpl };
}

const post = (body) => new Request("https://glory-map.test/api/import/simkl", { method: "POST", body: JSON.stringify(body) });
const quiet = () => {};

test("POST with a code exchanges it with the verifier and returns the rows", async () => {
  const { calls, fetchImpl } = fakeSimkl();
  const POST = createSimklImportHandler({ clientId: "abc", fetchImpl, logError: quiet });
  const response = await POST(post({ code: "c", codeVerifier: "v".repeat(43), redirectUri: "https://glory-map.vercel.app/auth/simkl" }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.refreshToken, "simkl_rt_1");
  assert.equal(body.movies.length, 3);

  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code_verifier"), "v".repeat(43));
  assert.equal(form.get("client_id"), "abc");
  assert.equal(calls[1].init.headers.Authorization, "Bearer at");
});

test("POST with a refresh token uses the refresh grant", async () => {
  const { calls, fetchImpl } = fakeSimkl();
  const POST = createSimklImportHandler({ clientId: "abc", fetchImpl, logError: quiet });
  assert.equal((await POST(post({ refreshToken: "simkl_rt_1" }))).status, 200);
  assert.equal(new URLSearchParams(calls[0].init.body).get("grant_type"), "refresh_token");
});

test("POST says what went wrong", async () => {
  const none = createSimklImportHandler({ fetchImpl: async () => assert.fail("must not fetch"), logError: quiet });
  assert.equal((await none(post({}))).status, 400);
  const refused = createSimklImportHandler({ ...fakeSimkl({ tokenStatus: 400 }), logError: quiet });
  assert.equal((await refused(post({ refreshToken: "old" }))).status, 401);
  const listDown = createSimklImportHandler({ ...fakeSimkl({ listStatus: 500 }), logError: quiet });
  assert.equal((await listDown(post({ refreshToken: "x" }))).status, 502);
});
