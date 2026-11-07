// A country's films and series, read from Wikidata, turned into `works` rows.
//
// Built for Israel (07.11.2026), where the catalogue held 12 works and the map one pin —
// in Jordan. Every source we harvested (MovieMaps, ReelStreets, movie-locations) is
// Anglo-American, so a country those sites never covered starts empty however many
// films were made there. Wikidata has them: the country's own productions (P495) and
// the English Wikipedia's "Films shot in <country>" category.
//
// This module is pure: it turns SPARQL bindings into rows and decides which rows the
// catalogue already holds. The network and the writes are in
// scripts/ingest-country-works.mjs.

import { normalizeWorkTitle } from "./content-graph.mjs";

// P31 values that make a work a series rather than a film. Checked live: Fauda, Shtisel
// and Srugim are Q5398426; Masada (1981) is a miniseries, Q1259759; a season of one is
// Q3464665, which we do not import (the series is the work).
const SERIES_TYPES = new Set(["Q5398426", "Q1259759", "Q526877", "Q117467246"]);
const FILM_TYPES = new Set(["Q11424", "Q24862", "Q506240", "Q93204", "Q226730", "Q202866", "Q24869"]);

const qid = (uri) => String(uri ?? "").split("/").pop();

// "Homeland (TV series)" → "Homeland". The article title is the readable English name,
// which the item label often is not (labels of Israeli items are frequently Hebrew).
export function titleFromArticle(article) {
  return String(article ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// Rows of one SPARQL result, possibly several per item (one per P31, per id), folded
// into one candidate each.
export function candidatesFromBindings(bindings) {
  const byItem = new Map();
  for (const row of Array.isArray(bindings) ? bindings : []) {
    const id = qid(row.item?.value);
    if (!/^Q\d+$/.test(id)) continue;
    const entry = byItem.get(id) ?? {
      wikidata_id: id, types: new Set(), article: null, label: null,
      imdb_id: null, tmdb_movie: null, tmdb_tv: null, year: null,
    };
    if (row.type?.value) entry.types.add(qid(row.type.value));
    entry.article ??= row.article?.value ?? null;
    entry.label ??= row.itemLabel?.value ?? null;
    entry.imdb_id ??= /^tt\d+$/.test(row.imdb?.value ?? "") ? row.imdb.value : null;
    entry.tmdb_movie ??= /^\d+$/.test(row.tmdbMovie?.value ?? "") ? row.tmdbMovie.value : null;
    entry.tmdb_tv ??= /^\d+$/.test(row.tmdbTv?.value ?? "") ? row.tmdbTv.value : null;
    const year = Number.parseInt(String(row.date?.value ?? "").slice(0, 4), 10);
    if (Number.isInteger(year) && year > 1880 && (entry.year === null || year < entry.year)) entry.year = year;
    byItem.set(id, entry);
  }
  return [...byItem.values()];
}

export function kindOf(candidate) {
  const types = [...(candidate?.types ?? [])];
  if (types.some((type) => SERIES_TYPES.has(type))) return "series";
  if (candidate?.tmdb_tv && !candidate?.tmdb_movie) return "series";
  if (types.some((type) => FILM_TYPES.has(type)) || candidate?.tmdb_movie) return "film";
  return null;
}

// A candidate becomes a row only when somebody outside Wikidata knows the work: a TMDB
// id (which is also where its poster comes from) or an IMDb id. The Israeli newsreel
// archive is 4,425 "short film" items with a P915 each and neither id — a reader cannot
// pick them, and they would bury the films a reader can.
export function workRowFrom(candidate) {
  const kind = kindOf(candidate);
  if (!kind) return null;
  const tmdb = kind === "series" ? candidate.tmdb_tv : candidate.tmdb_movie;
  if (!tmdb && !candidate.imdb_id) return null;
  const title = titleFromArticle(candidate.article) || String(candidate.label ?? "").trim();
  const title_norm = normalizeWorkTitle(title);
  if (!title_norm) return null;
  return {
    wikidata_id: candidate.wikidata_id,
    kind,
    title,
    title_norm,
    year: candidate.year,
    imdb_id: candidate.imdb_id,
    tmdb_id: tmdb ?? null,
    source: "wikidata",
  };
}

// Drop what the catalogue already holds under ANY of its three unique ids — a clash on
// one of them would fail the whole insert batch — and duplicates inside the run.
export function newRows(rows, held = {}) {
  const seen = {
    wikidata_id: new Set(held.wikidata_id ?? []),
    imdb_id: new Set(held.imdb_id ?? []),
    tmdb_id: new Set(held.tmdb_id ?? []),
  };
  const out = [];
  for (const row of rows) {
    if (!row) continue;
    const clash = ["wikidata_id", "imdb_id", "tmdb_id"].some((key) => row[key] && seen[key].has(row[key]));
    if (clash) continue;
    for (const key of Object.keys(seen)) if (row[key]) seen[key].add(row[key]);
    out.push(row);
  }
  return out;
}
