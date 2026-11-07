import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCloudLibrary } from "../app/lib/cloud-library.mjs";
import { libraryItemsFromLetterboxd } from "../app/lib/content-graph.mjs";
import { upgradeLibraryScale } from "../app/lib/media-library.mjs";
import {
  MEDIA_SOURCES,
  MEDIA_SOURCE_IDS,
  RATING_SCALE,
  isMediaSource,
  mediaSourceLabel,
  storedScale,
  toTenPoint,
} from "../app/lib/media-sources.mjs";

// The point of the registry: adding a service is a row in it, and these tests fail if a
// gate somewhere else kept its own list of the two we started with.
test("every registered service declares a usable scale", () => {
  assert.ok(MEDIA_SOURCE_IDS.length >= 2);
  for (const [id, source] of Object.entries(MEDIA_SOURCES)) {
    assert.ok(source.scale > 0, `${id} has no scale`);
    assert.ok(source.scale <= RATING_SCALE, `${id} rates finer than the library can hold`);
    assert.ok(source.label, `${id} has no label`);
    // A sign-in service takes no file at all.
    if (!source.signIn) assert.ok(source.accept.includes(".csv"), `${id} cannot take a CSV`);
  }
});

test("a top score from any service becomes a top score in the library", () => {
  // The property that matters: the best a service offers is 10/10 and the worst is above
  // zero. A service added with a wrong scale breaks this before it can reach a reader.
  for (const [id, source] of Object.entries(MEDIA_SOURCES)) {
    assert.equal(toTenPoint(source.scale, id), RATING_SCALE, `${id} top score`);
    const worst = source.scale === RATING_SCALE ? 1 : 0.5;
    const converted = toTenPoint(worst, id);
    assert.ok(converted > 0 && converted <= RATING_SCALE, `${id} worst score: ${converted}`);
  }
});

test("the cloud normaliser keeps every registered service", () => {
  // It used to filter against a hardcoded pair, so a third service would have been
  // silently dropped from a synced library.
  const rows = MEDIA_SOURCE_IDS.map((id, index) => ({
    title: `Film ${index}`, rating: 7, ratingScale: RATING_SCALE, sources: [id],
  }));
  const normalized = normalizeCloudLibrary(rows);
  assert.deepEqual(normalized.map((movie) => movie.sources[0]).sort(), [...MEDIA_SOURCE_IDS].sort());
  assert.ok(normalized.every((movie) => movie.ratingScale === RATING_SCALE));
});

test("an unknown source is not treated as a known one", () => {
  assert.equal(isMediaSource("trakt"), false);
  assert.equal(mediaSourceLabel("trakt"), null);
  assert.deepEqual(normalizeCloudLibrary([{ title: "Heat", sources: ["trakt"] }])[0].sources, []);
});

test("a legacy row is converted by the scale its sources declare", () => {
  for (const [id, source] of Object.entries(MEDIA_SOURCES)) {
    const [movie] = upgradeLibraryScale([{ title: "Heat", rating: source.scale, sources: [id] }]);
    assert.equal(movie.rating, RATING_SCALE, `${id} top score through the migration`);
    assert.equal(movie.ratingScale, RATING_SCALE);
  }
});

test("sources that disagree are assumed already converted, never doubled", () => {
  // A legacy row merged from two services holds whichever import wrote last and there is
  // no way to recover which. Under-converting leaves a number too low — wrong, but in
  // range and fixed by re-importing. Doubling a 9 gives 18, which is off the scale, cannot
  // be told from a real number later, and makes every filter above it dead.
  assert.equal(storedScale(["letterboxd", "imdb"]), RATING_SCALE);
  assert.equal(storedScale([]), RATING_SCALE);
  assert.equal(storedScale(["trakt"]), RATING_SCALE);
  const [movie] = upgradeLibraryScale([{ title: "Heat", rating: 9, sources: ["letterboxd", "imdb"] }]);
  assert.equal(movie.rating, 9);
});

test("the server-side import converts too, so both sides of the wire agree", () => {
  // user_library_items is written by the RSS route. Nothing reads it today, but a 4.5
  // sitting there next to a client library out of ten is the same bug waiting.
  const [entry] = libraryItemsFromLetterboxd([{ tmdbId: 603, rating: 4.5 }]);
  assert.equal(entry.rating, 9);
  // No ratingScale: user_library_items has no column for it. See content-graph.mjs.
  assert.equal(entry.ratingScale, undefined);
});
