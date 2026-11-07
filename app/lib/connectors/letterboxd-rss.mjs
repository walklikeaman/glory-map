// Letterboxd RSS connector — pure parser. Every Letterboxd member profile exposes
// letterboxd.com/{handle}/rss/, and each watched-film item carries a ready
// tmdb:movieId, so we can join straight to our TMDB-keyed graph with no external
// id cross-walk. Watchlist/list items lack a film title + tmdb id and are skipped.
//
// Pure module (no fetch) so it is unit-testable per testing-conventions. The
// server route fetches the feed with a browser User-Agent (Letterboxd 403s a
// bare server request) and hands the XML string here.

import { RATING_SCALE, toTenPoint } from "../media-sources.mjs";

const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,40}$/;

// Letterboxd handles are alphanumerics/underscores. Reject anything else so the
// route never interpolates junk into the feed URL.
export function isLetterboxdHandle(value) {
  return typeof value === "string" && HANDLE_PATTERN.test(value);
}

// What a person types: "dave", "@dave", or their profile link pasted from the browser
// ("https://letterboxd.com/dave/films/"). Returns the bare handle, or null.
export function letterboxdHandleFrom(input) {
  if (typeof input !== "string") return null;
  let value = input.trim();
  const fromUrl = value.match(/^(?:https?:\/\/)?(?:www\.)?letterboxd\.com\/([^/?#]+)/i);
  if (fromUrl) value = fromUrl[1];
  value = value.replace(/^@/, "");
  return isLetterboxdHandle(value) ? value : null;
}

export function letterboxdRssUrl(handle) {
  if (!isLetterboxdHandle(handle)) throw new Error("Invalid Letterboxd handle");
  return `https://letterboxd.com/${handle}/rss/`;
}

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(?:amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();
}

function tagText(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1]) : null;
}

function positiveInt(value) {
  return /^[1-9]\d*$/.test(value ?? "") ? value : null;
}

// Parse a Letterboxd RSS document into watched-film records. Only items that are
// real films (have a film title AND a positive tmdb:movieId) are returned.
export function parseLetterboxdRss(xml) {
  if (typeof xml !== "string" || !xml.includes("<item")) return [];

  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  const films = [];

  for (const block of items) {
    const title = tagText(block, "letterboxd:filmTitle");
    const tmdbId = positiveInt(tagText(block, "tmdb:movieId"));
    if (!title || !tmdbId) continue; // list/watchlist item, not a watched film

    const yearText = tagText(block, "letterboxd:filmYear");
    const ratingText = tagText(block, "letterboxd:memberRating");

    films.push({
      title,
      year: /^\d{4}$/.test(yearText ?? "") ? Number(yearText) : null,
      tmdbId,
      rating: ratingText !== null && Number.isFinite(Number(ratingText)) ? Number(ratingText) : null,
      watchedDate: tagText(block, "letterboxd:watchedDate"),
    });
  }

  return films;
}

// The feed's films in the shape the personal library holds (the same rows a Letterboxd
// CSV import produces), so `mergeLibraries` treats a synced profile and an uploaded
// export as one source.
export function libraryFromLetterboxdFeed(films) {
  return films.map((film) => ({
    id: `letterboxd:tmdb:${film.tmdbId}`,
    title: film.title,
    year: film.year,
    rating: toTenPoint(film.rating, "letterboxd"),
    ratingScale: RATING_SCALE,
    watchedDate: film.watchedDate,
    url: null,
    imdbId: null,
    sources: ["letterboxd"],
  }));
}
