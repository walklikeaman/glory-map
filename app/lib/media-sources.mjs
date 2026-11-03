// The services a reader can import a list from, and what each one's numbers mean.
//
// **This file is the only place that knows.** Before it, the pair was written out
// independently in seven: the CSV parser's allow-list, the cloud normaliser's filter, the
// scale table, the legacy migration's letterboxd-or-imdb guess, the file input's `accept`,
// the ZIP check, and the two connector cards. Adding a third service meant finding all
// seven, and missing one of them does not throw — it puts a whole library on the wrong
// scale, which is the failure this module exists to make impossible.
//
// Adding a service is a row here plus a header alias in `parseMediaCsv`. Nothing else.
//
// Related: [[personal-library]].

// The scale the library itself holds, whatever a service rates in. Ten, because it is the
// finer of the two we have: every Letterboxd half-star is a whole number out of ten and
// nothing is lost, where halving IMDb would round 7 and 8 onto the same 3.5 stars.
export const RATING_SCALE = 10;

export const MEDIA_SOURCES = Object.freeze({
  letterboxd: Object.freeze({
    label: "Letterboxd",
    // Half-stars, 0.5 to 5.
    scale: 5,
    blurb: "Upload the complete ZIP export or a CSV",
    accept: ".zip,.csv,application/zip,text/csv",
    // Letterboxd hands you a ZIP of several CSVs; IMDb hands you one CSV per list.
    archive: true,
    logoText: null,
  }),
  imdb: Object.freeze({
    label: "IMDb",
    // Whole numbers, 1 to 10 — already the library's scale.
    scale: RATING_SCALE,
    blurb: "Ratings, Check-ins or list CSV",
    accept: ".csv,text/csv",
    archive: false,
    logoText: "IMDb",
  }),
  goodreads: Object.freeze({
    label: "Goodreads",
    // Whole stars, 1 to 5; 0 in the export means read and not rated.
    scale: 5,
    blurb: "Library export CSV, the books you have read",
    accept: ".csv,text/csv",
    archive: false,
    logoText: "g",
    // The only service here that lists books. Its rows are stamped as books so they are
    // matched against books, never against a film that happens to share the title.
    kind: "book",
  }),
});

export const MEDIA_SOURCE_IDS = Object.freeze(Object.keys(MEDIA_SOURCES));

export function isMediaSource(source) {
  return typeof source === "string" && Object.hasOwn(MEDIA_SOURCES, source);
}

export function mediaSource(source) {
  return isMediaSource(source) ? MEDIA_SOURCES[source] : null;
}

export function mediaSourceLabel(source) {
  return mediaSource(source)?.label ?? null;
}

export function mediaSourceKind(source) {
  return mediaSource(source)?.kind ?? null;
}

export function mediaSourceScale(source) {
  return mediaSource(source)?.scale ?? null;
}

// A rating as the library holds it: out of ten, whatever the service rated it out of.
//
// Unrated stays unrated. Watched-and-never-scored is not a zero, and a service that reports
// "no rating" as 0 must not become a 0/10, which is a real and damning score.
export function toTenPoint(rating, source) {
  if (!Number.isFinite(rating) || rating <= 0) return null;
  const scale = mediaSourceScale(source) ?? RATING_SCALE;
  return Math.round((rating * RATING_SCALE / scale) * 10) / 10;
}

// Which scale a STORED row's number is on, read from the sources it carries. Only needed
// for rows saved before `ratingScale` existed; everything written since says so outright.
//
// **When the sources disagree, assume the row is already converted.** A legacy row merged
// from two services holds whichever import wrote last and there is no way to recover which,
// so the choice is between under- and over-converting. Under-converting leaves a number too
// low, which is wrong but in range and fixable by re-importing. Over-converting turns a 9
// into an 18, which is off the scale entirely, cannot be told from a real number later, and
// makes every filter above it dead.
export function storedScale(sources) {
  const scales = [...new Set((Array.isArray(sources) ? sources : [])
    .filter(isMediaSource)
    .map(mediaSourceScale))];
  return scales.length === 1 ? scales[0] : RATING_SCALE;
}
