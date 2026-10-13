import { normalizeWorkTitle } from "./content-graph.mjs";
import { RATING_SCALE, isMediaSource, mediaSourceKind, storedScale, toTenPoint } from "./media-sources.mjs";

// Re-exported so callers that already think in terms of the library keep one import for
// it. The definitions live in [[media-sources]], which is the only place that knows what
// a service rates out of.
export { RATING_SCALE, toTenPoint };

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function cleanHeader(value) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function firstValue(record, aliases) {
  for (const alias of aliases) {
    const value = record[alias]?.trim();
    if (value) return value;
  }
  return null;
}

function numberValue(value) {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function libraryKey(movie) {
  const key = movie.imdbId || `${movie.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${movie.year ?? ""}`;
  // A book and a film can share a title and a year. Films keep the key they always had, so
  // a library saved before books existed still merges with a fresh import.
  return isBook(movie) ? `book:${key}` : key;
}

// Books are matched only against books and everything else only against everything else.
// A row with no kind is from a film service, which is every row saved before books existed.
export function isBook(item) {
  return item?.kind === "book";
}

// Goodreads appends the series to the title: "The Fellowship of the Ring (The Lord of the
// Rings, #1)". The catalogue holds the title alone, so the suffix is dropped before matching.
function bookTitle(title) {
  return title.replace(/\s*\([^()]*#\s*[\d.]+\)\s*$/, "").trim() || title;
}

// The SAME normaliser the catalogue's `title_norm` is built with, imported rather than
// re-implemented. The two used to differ by one line and it silently broke every accented
// title: this one lacked the combining-accent strip, so NFKD turned "Amelie" into
// "ame\u0301lie" and the punctuation rule then made it "ame lie", against a catalogue
// holding "amelie". "Léon: The Professional" failed the same way. A library of 2,422 films
// matched nothing it should have.
const normalizedTitle = normalizeWorkTitle;

// Exported so a test can assert the two definitions are the same one.
export { normalizeWorkTitle as normalizedTitleForTest };

// Two release years for one film, and both are right.
//
// Letterboxd dates a film by its first public showing; TMDB's `find` answers with the
// primary release date. For a festival film those are different years and neither is
// wrong — measured on 298 works whose year was backfilled from TMDB and compared against
// the same reader's own export:
//
//   exact                 266  (89.3%)
//   off by one              9  ( 3.0%)   Kingsman 2014/2015, Reservoir Dogs 1991/1992,
//                                        V for Vendetta 2005/2006, Split 2016/2017
//   off by two or more     24  ( 8.1%)   Star Trek 2009/1966, A Star Is Born 2018/1937,
//                                        Ghostbusters 1984/2016 — DIFFERENT FILMS
//
// The two groups are different things. The off-by-one rows are one film with two true
// dates; the off-by-two rows are a remake, a reboot or the series of the same name, which
// is exactly the collision the year was added to stop. So the tolerance is **one year** —
// wide enough to hold a premiere and its release together, narrow enough to keep 1984's
// Ghostbusters away from 2016's.
//
// It costs about one case in three hundred: The Evil Dead premiered in 1981 and was
// released in 1983, and two years apart it is read as two films. Widening to two would
// merge The Evil Dead correctly and re-merge four genuinely different films with it, which
// is the worse trade.
export const YEAR_TOLERANCE = 1;

// The library row behind a work, or null. `workIsInLibrary` is this question with the
// answer thrown away, and it is written once so the two can never disagree about which
// film matched — a sort that ordered by one row while the filter tested another would be
// invisible and wrong.
//
// A year missing on EITHER side still counts as agreement. That is not laxity, it is the
// only thing that can be done with a null: before the backfill 6,041 of 7,063 works had
// no year at all, and the ones still lacking one are works TMDB does not know.
export function libraryEntryFor(work, library) {
  const title = normalizedTitle(work?.title);
  if (!title) return null;
  return (Array.isArray(library) ? library : []).find((movie) =>
    isBook(movie) === isBook(work)
      && normalizedTitle(movie?.title) === title
      && (!work?.year || !movie?.year || Math.abs(work.year - movie.year) <= YEAR_TOLERANCE),
  ) ?? null;
}

export function workIsInLibrary(work, library) {
  return libraryEntryFor(work, library) !== null;
}

// A film in the library with no rating is WATCHED AND UNRATED, which is not the same as
// bad — so it is null, never 0, and every comparison below has to decide what to do with
// it rather than sorting it to the bottom by accident. A Letterboxd export leaves 15 of
// 2,422 films unrated; an IMDb ratings export leaves none, because it only lists the
// titles you scored.
//
// The number is on the TEN-POINT scale whatever service it came from — see RATING_SCALE.
export function libraryRating(work, library) {
  const rating = libraryEntryFor(work, library)?.rating;
  return Number.isFinite(rating) ? rating : null;
}

// **One scale, decided at the edge.** The services rate out of different numbers and mean
// the same thing by them: 4.5 stars out of five and 9 out of ten are one judgement. Holding
// both raw in one list makes every comparison a lie — a "rated 4 and up" bar would pass an
// IMDb 4, which is a film the reader disliked, and sorting mixes a 5 that means
// best-possible with a 5 that means mediocre. The merge already puts several services in
// one row (`sources: ["letterboxd", "imdb"]`), so there is nowhere later that could tell
// them apart.
//
// So the conversion happens once, in the parser, against the scale each service declares in
// [[media-sources]].

// A library saved before the scale was settled carries each service's raw number, and there
// is one in every reader's localStorage and in `user_media_libraries`. It is upgraded on
// read.
//
// **The marker is what makes this safe to run twice**, and a heuristic would not be: a
// migration that doubled "any Letterboxd row scoring 5 or less" would, run a second time,
// turn a genuine 0.5 star into 1 and then into 2. `ratingScale` says whether the row has
// already been converted, so a second pass is a no-op instead of a corruption.
export function upgradeLibraryScale(library) {
  if (!Array.isArray(library)) return [];
  return library.map((movie) => {
    if (!movie || typeof movie !== "object") return movie;
    if (movie.ratingScale === RATING_SCALE) return movie;
    // The sources the row carries say what its number is out of — the general rule, and
    // what it does when they disagree, is `storedScale`.
    const scale = storedScale(movie.sources);
    const rating = Number.isFinite(movie.rating)
      ? Math.round((movie.rating * RATING_SCALE / scale) * 10) / 10
      : movie.rating ?? null;
    return { ...movie, rating, ratingScale: RATING_SCALE };
  });
}

export function parseMediaCsv(text, source) {
  if (!isMediaSource(source)) throw new Error("Unsupported media source");
  const [headerRow, ...dataRows] = parseCsvRows(text);
  if (!headerRow) throw new Error("The CSV file is empty");

  const headers = headerRow.map(cleanHeader);
  const kind = mediaSourceKind(source);
  const movies = dataRows.flatMap((row) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
    const rawTitle = firstValue(record, ["name", "title", "original title"]);
    if (!rawTitle) return [];
    // Goodreads exports the want-to-read shelf too. The library is what you have read.
    if (firstValue(record, ["exclusive shelf"]) === "to-read") return [];
    const title = kind === "book" ? bookTitle(rawTitle) : rawTitle;

    const imdbId = firstValue(record, ["const", "imdb id"]);
    // Converted to ten points here and nowhere else, so no caller ever has to ask which
    // service a number came from.
    const rating = toTenPoint(numberValue(firstValue(record, ["rating", "your rating", "my rating"])), source);
    // For a book, the year the work first came out, not the year of the edition on the shelf.
    const year = numberValue(firstValue(record, ["year", "release year", "original publication year", "year published"]));
    const watchedDate = firstValue(record, ["watched date", "date rated", "date read", "date"]);
    const url = firstValue(record, ["letterboxd uri", "url"]);

    return [{
      id: imdbId || `${source}:${libraryKey({ title, year, kind })}`,
      title,
      year,
      rating,
      ratingScale: RATING_SCALE,
      watchedDate,
      url,
      imdbId: imdbId && /^tt\d+$/.test(imdbId) ? imdbId : null,
      sources: [source],
      ...(kind ? { kind } : {}),
    }];
  });

  if (!movies.length) throw new Error(kind === "book" ? "No read books were found in this CSV" : "No movie titles were found in this CSV");
  return movies;
}

export function mergeLibraries(current, imported) {
  // Both sides are put on the ten-point scale BEFORE anything is compared or kept. The
  // stored library is the one that can still be on half-stars, and this is the point where
  // it meets a freshly parsed import — merging first and converting later would leave a
  // row holding whichever of the two scales won.
  const merged = new Map(upgradeLibraryScale(current).map((movie) => [libraryKey(movie), movie]));

  for (const movie of upgradeLibraryScale(imported)) {
    const key = libraryKey(movie);
    const previous = merged.get(key);
    merged.set(key, previous ? {
      ...previous,
      ...movie,
      rating: movie.rating ?? previous.rating,
      ratingScale: RATING_SCALE,
      watchedDate: movie.watchedDate ?? previous.watchedDate,
      url: movie.url ?? previous.url,
      sources: [...new Set([...(previous.sources ?? []), ...movie.sources])],
    } : movie);
  }

  return [...merged.values()].sort((a, b) => a.title.localeCompare(b.title));
}
