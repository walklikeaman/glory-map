// Which TMDB record is this work, when Wikidata does not say? (live content check, 18.10)
//
// After the Wikidata backfill, 2,135 films and series still had no tmdb_id — mostly works
// with no Wikidata id at all. Two kinds of evidence are left, and they are not equal:
//
//   imdb_exact        — the work carries an IMDb id and TMDB's /find returns exactly one
//                       record for it. An id lookup, no guessing.
//   title_year_unique — TMDB search returns exactly ONE record whose title (or original
//                       title) is the work's title and whose year is within a year of it.
//
// Anything else — two same-titled films in one year, a title with the wrong year, no year
// at all — is left alone. A wrong TMDB id is worse than none: it puts another film's
// poster and stills on the card and nothing on the page says so.

export const YEAR_TOLERANCE = 1;

export function normalizeTitle(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function yearOf(record) {
  return Number(String(record?.release_date ?? record?.first_air_date ?? "").slice(0, 4)) || null;
}

function summary(record) {
  return { tmdb_id: record.id, tmdb_title: record.title ?? record.name ?? null, tmdb_year: yearOf(record) };
}

// `found`: TMDB /find results for the work's kind (movie_results or tv_results).
export function matchByImdb(found) {
  const records = Array.isArray(found) ? found : [];
  return records.length === 1 ? { status: "imdb_exact", ...summary(records[0]) } : null;
}

// `results`: TMDB /search results for the work's title.
export function matchByTitleYear(work, results) {
  if (!work?.year) return { status: "no_year" };
  const title = normalizeTitle(work.title);
  const named = (Array.isArray(results) ? results : []).filter((record) =>
    normalizeTitle(record.title ?? record.name) === title
    || normalizeTitle(record.original_title ?? record.original_name) === title);
  const dated = named.filter((record) => yearOf(record) && Math.abs(yearOf(record) - work.year) <= YEAR_TOLERANCE);
  if (dated.length === 1) return { status: "title_year_unique", ...summary(dated[0]) };
  if (dated.length > 1) return { status: "several", options: dated.length };
  return { status: named.length ? "title_other_year" : "not_found" };
}
