import test from "node:test";
import assert from "node:assert/strict";

import {
  FILTER_DEFAULTS, activeFilterCount, activeFilters, clearedFilter, filterChipLabel, filtersFromParams,
  narrowingFilters, workChipTitle, writeFilterParams,
} from "../app/lib/filter-url.mjs";
import { NO_MINIMUM } from "../app/lib/library-view.mjs";

const params = (query) => new URLSearchParams(query);

// A URL that spells out every default makes a fresh map look configured, and grows every
// time a filter is added.
test("a map with nothing narrowed writes no filter parameters at all", () => {
  const written = writeFilterParams("lat=34.1&lng=-118.3&z=12", FILTER_DEFAULTS);
  assert.equal(written.toString(), "lat=34.1&lng=-118.3&z=12");
});

// The place and the filters are two different questions about one map, and neither may
// erase the other.
test("writing filters keeps the viewport parameters that were already there", () => {
  const written = writeFilterParams("lat=34.1&lng=-118.3&z=12", { ...FILTER_DEFAULTS, mineOnly: true });
  assert.equal(written.get("lat"), "34.1");
  assert.equal(written.get("z"), "12");
  assert.equal(written.get("mine"), "1");
});

test("turning a filter back off removes its parameter rather than writing a default", () => {
  const on = writeFilterParams("", { ...FILTER_DEFAULTS, minImdb: 8 });
  assert.equal(on.get("imdb"), "8");
  const off = writeFilterParams(on, FILTER_DEFAULTS);
  assert.equal(off.has("imdb"), false);
});

test("a filtered view survives a round trip", () => {
  const filters = {
    ...FILTER_DEFAULTS, mineOnly: true, minImdb: 8, minRating: 4, kinds: ["film"], candidates: false,
  };
  const restored = filtersFromParams(writeFilterParams("", filters));
  assert.equal(restored.mineOnly, true);
  assert.equal(restored.minImdb, 8);
  assert.equal(restored.minRating, 4);
  assert.deepEqual(restored.kinds, ["film"]);
  assert.equal(restored.candidates, false);
});

// Somebody edits a URL by hand, a chat client truncates a link, a parameter is renamed in a
// later release. In every case the honest answer is the default and a working map.
test("nonsense in the URL gives the default rather than an empty map", () => {
  const restored = filtersFromParams(params("mine=banana&imdb=abc&stars=-4&kind=chair&queue=maybe"));
  assert.equal(restored.mineOnly, FILTER_DEFAULTS.mineOnly);
  assert.equal(restored.minImdb, NO_MINIMUM);
  assert.equal(restored.minRating, NO_MINIMUM);
  assert.deepEqual(restored.kinds, FILTER_DEFAULTS.kinds);
  assert.equal(restored.candidates, true);
});

test("an empty URL is a map with nothing narrowed", () => {
  assert.deepEqual(filtersFromParams(params("")), FILTER_DEFAULTS);
});

// Every kind and no kind are the same map, and `[]` is how the app says "every". Writing all
// three back would make the reset button claim a filter is on.
test("selecting every kind is not a filter", () => {
  const restored = filtersFromParams(params("kind=film,series,book"));
  assert.deepEqual(restored.kinds, FILTER_DEFAULTS.kinds);
  assert.equal(activeFilterCount(restored), 0);
});

test("selecting some kinds is a filter", () => {
  assert.deepEqual(filtersFromParams(params("kind=film,book")).kinds, ["film", "book"]);
  assert.equal(activeFilterCount(filtersFromParams(params("kind=film,book"))), 1);
});

// The count is what the reset button shows, so it has to be right about every axis.
test("the count knows each filter apart", () => {
  assert.equal(activeFilterCount(FILTER_DEFAULTS), 0);
  assert.equal(activeFilterCount({ ...FILTER_DEFAULTS, mineOnly: true }), 1);
  assert.equal(activeFilterCount({ ...FILTER_DEFAULTS, mineOnly: true, minImdb: 8 }), 2);
  assert.equal(activeFilterCount({ ...FILTER_DEFAULTS, candidates: false, studioLots: false }), 2);
  assert.deepEqual(
    activeFilters({ ...FILTER_DEFAULTS, workId: "abc", graphLayer: false }).sort(),
    ["graphLayer", "workId"],
  );
});

// A rating bar at its off position is not a filter — it is the slider sitting where it
// started, and counting it would put a permanent "1" on the reset button.
test("a rating slider at rest does not count as a filter", () => {
  assert.equal(activeFilterCount({ ...FILTER_DEFAULTS, minImdb: NO_MINIMUM, minRating: NO_MINIMUM }), 0);
});

test("a work id is bounded, because it lands in a URL somebody can type", () => {
  const restored = filtersFromParams(params(`work=${"x".repeat(400)}`));
  assert.equal(restored.workId.length, 100);
});

test("filters read from a plain object as well as from URLSearchParams", () => {
  assert.equal(filtersFromParams({ mine: "1", imdb: "7.5" }).mineOnly, true);
  assert.equal(filtersFromParams({ mine: "1", imdb: "7.5" }).minImdb, 7.5);
});


// Three of the eight flags "Reset" counted were LAYER switches. Pressing it turned back on
// layers the reader had deliberately turned off.
test("a layer switch is not a filter the reset may undo", () => {
  const state = { ...FILTER_DEFAULTS, candidates: false, studioLots: false, graphLayer: false };
  assert.deepEqual(narrowingFilters(state), []);
  // ...and it still travels in the URL, which is a different question.
  assert.equal(activeFilterCount(state), 3);
});

test("the narrowing filters come back in a stable, readable order", () => {
  const state = { ...FILTER_DEFAULTS, workId: "w", minImdb: 8, mineOnly: true, candidates: false };
  assert.deepEqual(narrowingFilters(state), ["mineOnly", "minImdb", "workId"]);
});

// "Reset 3 filters" named a number and none of the filters.
test("every chip names what it keeps, in the reader's terms", () => {
  const state = { ...FILTER_DEFAULTS, mineOnly: true, minRating: 7, minImdb: 7.5, kinds: ["film", "book"] };
  assert.equal(filterChipLabel("mineOnly", state), "My films");
  assert.equal(filterChipLabel("minRating", state), "Mine 7/10+");
  assert.equal(filterChipLabel("minImdb", state), "IMDb 7.5+");
  assert.equal(filterChipLabel("kinds", state), "Films + Books");
});

test("a work chip uses the title, and never the raw id", () => {
  const state = { ...FILTER_DEFAULTS, workId: "0d9f1c2e-aaaa-bbbb-cccc-000000000000" };
  assert.equal(filterChipLabel("workId", state, { workTitle: "Skyfall" }), "Skyfall");
  assert.equal(filterChipLabel("workId", state), "One work");
});

test("clearing one chip puts back exactly that filter's default", () => {
  assert.equal(clearedFilter("mineOnly"), false);
  assert.equal(clearedFilter("minImdb"), NO_MINIMUM);
  assert.deepEqual(clearedFilter("kinds"), []);
  assert.equal(clearedFilter("nonsense"), undefined);
});

test("a work picked from search keeps its title on the chip when it is not in view", () => {
  const id = "7fdfc23c-bb31-4e50-8586-b2ce0200c676";
  const picked = { work_id: id, title: "Notting Hill" };
  assert.equal(workChipTitle(id, { worksInView: [], picked }), "Notting Hill");
  assert.equal(workChipTitle(id, { worksInView: [{ work_id: id, title: "Notting Hill (1999)" }], picked }), "Notting Hill (1999)");
  // A pick that is no longer the filter (a shared link replaced it) does not name it.
  assert.equal(workChipTitle("other-id", { worksInView: [], picked }), null);
  assert.equal(workChipTitle("", { picked }), null);
});
