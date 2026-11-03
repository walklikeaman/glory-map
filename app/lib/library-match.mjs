// How much of somebody's film library we actually hold — answered without their library
// ever leaving the browser.
//
// Reported from a real import: **2,422 films from a Letterboxd ZIP, "0 mapped titles".**
// The ZIP parsed fine. The count was computed against `films`, which is
// `worksFromLocations(sourceLocations)` — the works belonging to the locations loaded for
// the CITY IN VIEW. So 2,422 titles were being compared with the eleven films the map
// happened to be drawing in London, and zero is the arithmetically correct answer to a
// question nobody asked.
//
// Measured on production the same day: the catalogue holds 7,063 works, and **6,075 of
// them have at least one located row**. That is the number a library should be compared
// with.
//
// The reason this is a matcher over a downloaded INDEX rather than a request carrying the
// library is the promise printed under the import button: *"The ZIP or CSV is processed
// locally and is never uploaded."* Sending 2,422 titles to a server to be matched would
// break it for a feature whose whole appeal is that it does not. So the catalogue comes to
// the library instead — 6,075 rows of title, year and identifier, which is small.

import { normalizeWorkTitle } from "./content-graph.mjs";

function year(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 1800 ? number : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// An identifier is not a name, and here it is also not optional. A title can be shared by
// works that have nothing to do with each other — Gladiator is two films, Doctor Who is
// two series — so an id match is accepted outright and a title match has to agree on the
// year as well.
export function indexLibrary(catalogue) {
  const byImdb = new Map();
  const byTmdb = new Map();
  const byTitle = new Map();
  for (const entry of Array.isArray(catalogue) ? catalogue : []) {
    if (!entry) continue;
    if (text(entry.imdb_id)) byImdb.set(entry.imdb_id.trim(), entry);
    if (text(entry.tmdb_id)) byTmdb.set(String(entry.tmdb_id).trim(), entry);
    const title = text(entry.title_norm);
    if (title) {
      const bucket = byTitle.get(title) ?? [];
      bucket.push(entry);
      byTitle.set(title, bucket);
    }
  }
  return { byImdb, byTmdb, byTitle };
}

// One film against the catalogue index. Returns the catalogue entry or null.
export function matchOne(movie, index) {
  if (!movie || !index) return null;

  const imdbId = text(movie.imdbId ?? movie.imdb_id);
  if (imdbId && index.byImdb.has(imdbId)) return index.byImdb.get(imdbId);

  const tmdbId = movie.tmdbId ?? movie.tmdb_id;
  if (tmdbId !== null && tmdbId !== undefined && index.byTmdb.has(String(tmdbId))) {
    return index.byTmdb.get(String(tmdbId));
  }

  const title = normalizeWorkTitle(movie.title ?? "");
  if (!title) return null;
  // A book matches books and a film matches everything else: "Dune" the novel is not "Dune"
  // the film, and with a year missing on one side nothing else would tell them apart.
  const wantsBook = movie.kind === "book";
  const candidates = index.byTitle.get(title)?.filter((entry) => (entry.kind === "book") === wantsBook);
  if (!candidates || candidates.length === 0) return null;

  const wanted = year(movie.year);
  // One title, one work: nothing to disambiguate and nothing to get wrong.
  if (candidates.length === 1) {
    const only = candidates[0];
    const held = year(only.year);
    // A year on both sides that disagrees is a different film, not a near miss.
    if (wanted !== null && held !== null && wanted !== held) return null;
    return only;
  }
  // Several works share the title. Only the year can separate them, and without one on
  // either side the honest answer is that we do not know which — refusing is the point.
  if (wanted === null) return null;
  const exact = candidates.filter((entry) => year(entry.year) === wanted);
  return exact.length === 1 ? exact[0] : null;
}

// The whole library against the catalogue.
//
// `places` is what makes the answer worth reading: "we hold 214 of your films" is a
// number, "…and 1,904 places between them" is a reason to open the map.
export function matchLibrary(library, catalogue) {
  const index = indexLibrary(catalogue);
  const matched = [];
  const seen = new Set();
  for (const movie of Array.isArray(library) ? library : []) {
    const entry = matchOne(movie, index);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    matched.push({ ...entry, watched_title: movie.title ?? null, rating: movie.rating ?? null });
  }
  const places = matched.reduce((total, entry) => total + (Number(entry.place_count) || 0), 0);
  return {
    matched,
    works: matched.length,
    places,
    considered: Array.isArray(library) ? library.length : 0,
  };
}

// The sentence under the import button. It has to name BOTH numbers, because they answer
// two different questions and the old message answered only the second — which is how
// "0 mapped titles" came to mean "none of your films is on the screen right now".
export function libraryImportSummary({ imported, works, places, cityName, inCity, noun = "films" }) {
  const held = `${imported} ${noun} imported · we hold ${works} of them`;
  const withPlaces = works > 0 ? `, with ${places} place${places === 1 ? "" : "s"} between them` : "";
  const here = cityName ? ` · ${inCity} on the map in ${cityName}` : "";
  return `${held}${withPlaces}.${here}`;
}

// What to call a library in a sentence: films, books, or titles when it holds both.
export function libraryNoun(library) {
  const rows = Array.isArray(library) ? library : [];
  const books = rows.filter((row) => row?.kind === "book").length;
  if (books === 0) return "films";
  return books === rows.length ? "books" : "titles";
}
