import test from "node:test";
import assert from "node:assert/strict";

import { RESULT_TABS, barsSetBehindChip, filtersChipLabel, nextResultTab } from "../app/lib/panel-zones.mjs";

test("results have two tabs, works first", () => {
  assert.deepEqual(RESULT_TABS.map((tab) => tab.id), ["works", "places"]);
});

test("the Filters chip counts the bars that narrow the list", () => {
  assert.equal(filtersChipLabel({ minImdb: 0, minRating: 0 }), "Filters");
  assert.equal(filtersChipLabel({ minImdb: 7.5, minRating: 0 }), "Filters · 1");
  assert.equal(filtersChipLabel({ minImdb: 7.5, minRating: 4, hasLibrary: true }), "Filters · 2");
});

test("missing or junk values do not count as a filter", () => {
  assert.equal(barsSetBehindChip(), 0);
  assert.equal(barsSetBehindChip({ minImdb: null, minRating: "x", hasLibrary: true }), 0);
});

test("your-rating bar counts only when its slider is behind the chip", () => {
  assert.equal(filtersChipLabel({ minImdb: 0, minRating: 4 }), "Filters");
  assert.equal(filtersChipLabel({ minImdb: 0, minRating: 4, hasLibrary: true }), "Filters · 1");
});

test("arrow keys cycle the tabs; other keys do nothing", () => {
  assert.equal(nextResultTab("works", "ArrowRight"), "places");
  assert.equal(nextResultTab("places", "ArrowRight"), "works");
  assert.equal(nextResultTab("works", "ArrowLeft"), "places");
  assert.equal(nextResultTab("works", "Enter"), null);
});
