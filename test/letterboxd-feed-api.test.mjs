import assert from "node:assert/strict";
import test from "node:test";

import { createLetterboxdFeedHandler } from "../app/api/import/letterboxd-feed/route.js";
import { letterboxdHandleFrom, libraryFromLetterboxdFeed } from "../app/lib/connectors/letterboxd-rss.mjs";
import { mergeLibraries, parseMediaCsv } from "../app/lib/media-library.mjs";

const FEED = `<rss xmlns:letterboxd="https://letterboxd.com" xmlns:tmdb="https://themoviedb.org"><channel>
  <item>
    <letterboxd:watchedDate>2026-07-09</letterboxd:watchedDate>
    <letterboxd:filmTitle>Notting Hill</letterboxd:filmTitle>
    <letterboxd:filmYear>1999</letterboxd:filmYear>
    <letterboxd:memberRating>4.5</letterboxd:memberRating>
    <tmdb:movieId>509</tmdb:movieId>
  </item>
  <item><title>My watchlist</title></item>
</channel></rss>`;

const request = (handle) => new Request(`https://glorymap.test/api/import/letterboxd-feed?handle=${encodeURIComponent(handle)}`);

test("letterboxdHandleFrom accepts a username, @username or a pasted profile link", () => {
  assert.equal(letterboxdHandleFrom("dave"), "dave");
  assert.equal(letterboxdHandleFrom("  @dave "), "dave");
  assert.equal(letterboxdHandleFrom("https://letterboxd.com/dave/films/"), "dave");
  assert.equal(letterboxdHandleFrom("letterboxd.com/dave"), "dave");
  assert.equal(letterboxdHandleFrom("https://evil.com/dave"), null);
  assert.equal(letterboxdHandleFrom("da ve"), null);
  assert.equal(letterboxdHandleFrom(null), null);
});

test("feed films become library rows on the ten-point scale", () => {
  const [row] = libraryFromLetterboxdFeed([{ title: "Notting Hill", year: 1999, tmdbId: "509", rating: 4.5, watchedDate: "2026-07-09" }]);
  assert.equal(row.rating, 9);
  assert.deepEqual(row.sources, ["letterboxd"]);
  assert.equal(row.ratingScale, 10);
});

test("a synced film merges with the same film from a CSV import instead of doubling", () => {
  const csv = parseMediaCsv("Date,Name,Year,Letterboxd URI,Rating\n2020-01-01,Notting Hill,1999,https://boxd.it/x,3\n", "letterboxd");
  const synced = libraryFromLetterboxdFeed([{ title: "Notting Hill", year: 1999, tmdbId: "509", rating: 4.5, watchedDate: "2026-07-09" }]);
  const merged = mergeLibraries(csv, synced);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].rating, 9);
  assert.equal(merged[0].url, "https://boxd.it/x");
});

test("GET returns the profile's films and fetches the right feed", async () => {
  let fetched = null;
  const GET = createLetterboxdFeedHandler({
    fetchImpl: async (url) => { fetched = url; return new Response(FEED, { status: 200 }); },
  });
  const response = await GET(request("https://letterboxd.com/dave/"));
  assert.equal(response.status, 200);
  assert.equal(fetched, "https://letterboxd.com/dave/rss/");
  const body = await response.json();
  assert.equal(body.handle, "dave");
  assert.equal(body.movies.length, 1);
  assert.equal(body.movies[0].title, "Notting Hill");
});

test("GET rejects a bad handle without fetching", async () => {
  const GET = createLetterboxdFeedHandler({ fetchImpl: async () => assert.fail("must not fetch") });
  assert.equal((await GET(request("../etc"))).status, 400);
});

test("GET says when the profile does not exist or Letterboxd is down", async () => {
  const quiet = () => {};
  const missing = createLetterboxdFeedHandler({ fetchImpl: async () => new Response("", { status: 404 }), logError: quiet });
  assert.equal((await missing(request("nobody"))).status, 404);
  const refused = createLetterboxdFeedHandler({ fetchImpl: async () => new Response("", { status: 403 }), logError: quiet });
  assert.equal((await refused(request("dave"))).status, 502);
  const down = createLetterboxdFeedHandler({ fetchImpl: async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }, logError: quiet });
  assert.equal((await down(request("dave"))).status, 504);
});
