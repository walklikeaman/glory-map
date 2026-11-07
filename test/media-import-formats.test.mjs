import assert from "node:assert/strict";
import test from "node:test";

import { mergeLibraries, parseMediaCsv, parseMediaJson } from "../app/lib/media-library.mjs";

test("Netflix viewing history: episodes collapse to their series, films keep their colon", () => {
  const csv = [
    "Title,Date",
    '"Sherlock: Season 1: A Study in Pink","01/02/2026"',
    '"Sherlock: Season 1: The Blind Banker","01/03/2026"',
    '"Mission: Impossible","12/12/2025"',
    '"The Crown: Limited Series: Episode 1","11/11/2025"',
  ].join("\n");
  const rows = mergeLibraries([], parseMediaCsv(csv, "netflix"));
  assert.deepEqual(rows.map((row) => row.title), ["Mission: Impossible", "Sherlock", "The Crown"]);
  assert.deepEqual(rows[0].sources, ["netflix"]);
});

test("a hand-made CSV reads imdb_id and rating columns", () => {
  const [row] = parseMediaCsv("title,year,imdb_id,rating\nHeat,1995,tt0113277,9\n", "other");
  assert.equal(row.imdbId, "tt0113277");
  assert.equal(row.rating, 9);
});

test("JSON: a plain array, a Trakt export and a Simkl-style object all read", () => {
  const plain = parseMediaJson(JSON.stringify([{ title: "Heat", year: 1995, imdb_id: "tt0113277", rating: 8 }]), "other");
  assert.equal(plain[0].imdbId, "tt0113277");
  assert.equal(plain[0].rating, 8);

  const trakt = parseMediaJson(JSON.stringify([
    { rating: 10, rated_at: "2026-01-01", movie: { title: "Notting Hill", year: 1999, ids: { imdb: "tt0125439" } } },
    { show: { title: "Sherlock", year: 2010, ids: { imdb: "tt1475582" } } },
  ]), "other");
  assert.deepEqual(trakt.map((row) => row.title), ["Notting Hill", "Sherlock"]);
  assert.equal(trakt[0].rating, 10);

  const grouped = parseMediaJson(JSON.stringify({ movies: [{ movie: { title: "Skyfall", year: 2012 } }], shows: [] }), "other");
  assert.equal(grouped[0].title, "Skyfall");
});

test("JSON errors are said plainly", () => {
  assert.throws(() => parseMediaJson("{nope", "other"), /not valid JSON/);
  assert.throws(() => parseMediaJson("[]", "other"), /No titles/);
});
