// The map panel's three zones (UX-2): Search, Results (Works / Places), Plan.
//
// The panel was twelve blocks one under another, on the desktop and in the phone sheet
// alike. Ordering and the rating bars now sit behind one "Filters" chip, and the chip says
// how many of them are narrowing the list, so closing it never hides that the list is
// narrowed.

import { NO_MINIMUM } from "./library-view.mjs";

export const RESULT_TABS = Object.freeze([
  Object.freeze({ id: "works", label: "Works" }),
  Object.freeze({ id: "places", label: "Places" }),
]);

// How many of the bars behind the chip are set. Order is not counted: it changes the
// order, not what is shown. Your-rating counts only with a library, because only then is
// its slider behind the chip (a restored URL can carry one without a library; the chip
// row above clears it). Not filter-url's `activeFilterCount`, which counts every filter.
export function barsSetBehindChip({ minImdb, minRating, hasLibrary = false } = {}) {
  const bars = hasLibrary ? [minImdb, minRating] : [minImdb];
  return bars.filter((value) => Number(value) > NO_MINIMUM).length;
}

export function filtersChipLabel(filters) {
  const count = barsSetBehindChip(filters);
  return count > 0 ? `Filters · ${count}` : "Filters";
}

// Arrow keys move between tabs, as a tablist promises a screen reader.
export function nextResultTab(current, key) {
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  if (!step) return null;
  const at = RESULT_TABS.findIndex((tab) => tab.id === current);
  return RESULT_TABS[(at + step + RESULT_TABS.length) % RESULT_TABS.length].id;
}
