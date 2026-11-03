#!/usr/bin/env node
//
// Find TMDB ids for works Wikidata could not give one to (the rules are in
// app/lib/tmdb-title-match.mjs).
//
//   node --env-file=.env.local scripts/match-tmdb-by-title.mjs [--out data/tmdb-match]
//
// Read-only: works are public-read and TMDB is only searched. Writes candidates.json with a
// verdict per work. Only `imdb_exact` and `title_year_unique` rows are candidates for a
// write, and a candidate whose TMDB id another work already holds is flagged
// `duplicate_of_existing` — that is the same film twice in our graph and needs a merge,
// not a second copy of the id.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { matchByImdb, matchByTitleYear } from "../app/lib/tmdb-title-match.mjs";

const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "data/tmdb-match";
const key = process.env.TMDB_API_KEY;
if (!key) throw new Error("TMDB_API_KEY is required");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tmdb(pathAndQuery) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`https://api.themoviedb.org/3/${pathAndQuery}&api_key=${key}`);
    if (response.ok) return response.json();
    if (response.status !== 429 || attempt === 5) throw new Error(`TMDB ${response.status} for ${pathAndQuery}`);
    await wait(2000 * attempt);
  }
}

const works = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("works").select("id, title, year, kind, imdb_id")
    .in("kind", ["film", "series"]).is("tmdb_id", null).order("id").range(from, from + 999);
  if (error) throw new Error(`works read failed: ${error.message}`);
  works.push(...data);
  if (data.length < 1000) break;
}
console.log(`${works.length} films and series with no tmdb_id`);

const out = [];
for (const [index, work] of works.entries()) {
  const segment = work.kind === "series" ? "tv" : "movie";
  let verdict = null;
  if (work.imdb_id) {
    const found = await tmdb(`find/${work.imdb_id}?external_source=imdb_id`);
    verdict = matchByImdb(work.kind === "series" ? found.tv_results : found.movie_results);
  }
  if (!verdict) {
    const results = work.year
      ? (await tmdb(`search/${segment}?${new URLSearchParams({ query: work.title })}`)).results
      : [];
    verdict = matchByTitleYear(work, results);
  }
  out.push({ ...work, ...verdict });
  if ((index + 1) % 250 === 0) console.log(`${index + 1}/${works.length}`);
  await wait(30);
}

// Ids another work already holds: the same film twice in our graph.
const candidates = out.filter((row) => row.status === "imdb_exact" || row.status === "title_year_unique");
const taken = new Set();
const ids = [...new Set(candidates.map((row) => String(row.tmdb_id)))];
for (let start = 0; start < ids.length; start += 150) {
  const { data, error } = await db.from("works").select("tmdb_id").in("tmdb_id", ids.slice(start, start + 150));
  if (error) throw new Error(`tmdb_id check failed: ${error.message}`);
  for (const row of data) taken.add(String(row.tmdb_id));
}
const claims = new Map();
for (const row of candidates) claims.set(String(row.tmdb_id), (claims.get(String(row.tmdb_id)) ?? 0) + 1);
for (const row of candidates) {
  if (taken.has(String(row.tmdb_id))) row.duplicate_of_existing = true;
  // Two of our works matching one TMDB record in the same run: neither is written.
  if (claims.get(String(row.tmdb_id)) > 1) row.claimed_twice = true;
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "candidates.json"), JSON.stringify(out, null, 1));
const counts = {};
for (const row of out) counts[row.status] = (counts[row.status] ?? 0) + 1;
const writable = candidates.filter((row) => !row.duplicate_of_existing && !row.claimed_twice).length;
console.log(JSON.stringify({ ...counts, writable, duplicate_of_existing: candidates.filter((row) => row.duplicate_of_existing).length }));
