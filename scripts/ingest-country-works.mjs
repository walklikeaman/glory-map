#!/usr/bin/env node
//
// A country's films and series → `works` rows, so the map has something to say there.
//
//   node --env-file=.env.local scripts/ingest-country-works.mjs --country Q801 --dry-run
//   node --env-file=.env.local scripts/ingest-country-works.mjs --country Q801 --limit 10
//   node --env-file=.env.local scripts/ingest-country-works.mjs --country Q801 \
//        --category "Films shot in Israel" --category "Films set in Tel Aviv"
//
// Two lists are read from Wikidata and merged: the country's own productions (P495,
// with an English Wikipedia article) and the members of each English Wikipedia category
// given, read through the query service's MediaWiki bridge — en.wikipedia.org's own API
// rate-limits the cloud egress at once (429), the query service does not.
//
// It writes `works` only: kind, title, year, the three ids and a TMDB poster. Places come
// after, from the works' own Wikidata statements (scripts/resolve-works.mjs) and their
// Wikipedia articles (scripts/enrich-from-wikipedia.mjs). Rows land with
// source = 'wikidata'. Re-running is safe: anything the catalogue holds under any of
// its ids is skipped.

import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { candidatesFromBindings, newRows, workRowFrom } from "../app/lib/country-works.mjs";
import { CONTACT_USER_AGENT, WIKIDATA_SPARQL } from "../app/lib/user-agent.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const COUNTRY = arg("country");
const CATEGORIES = argv.flatMap((value, index) => (argv[index - 1] === "--category" ? [value] : []));
const LIMIT = Number(arg("limit", 0)) || null;
const DRY_RUN = argv.includes("--dry-run");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!/^Q\d+$/.test(COUNTRY ?? "")) {
  console.error("Pass --country <Q-id>, e.g. --country Q801 for Israel");
  process.exit(1);
}

async function sparql(query) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(`${WIKIDATA_SPARQL}?query=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": CONTACT_USER_AGENT },
    });
    if (response.ok) return (await response.json()).results.bindings;
    console.warn(`  query service ${response.status}, retrying`);
    await sleep(5000 * attempt);
  }
  throw new Error("Wikidata query service kept failing");
}

const OWN_PRODUCTIONS = (country) => `SELECT DISTINCT ?item WHERE {
  VALUES ?type { wd:Q11424 wd:Q5398426 wd:Q1259759 }
  ?item wdt:P495 wd:${country}; wdt:P31 ?type .
  ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/> .
}`;

const CATEGORY_MEMBERS = (category) => `SELECT ?item WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:endpoint "en.wikipedia.org"; wikibase:api "Generator";
      mwapi:generator "categorymembers"; mwapi:gcmtitle "Category:${category.replace(/"/g, "")}";
      mwapi:gcmlimit "max"; mwapi:gcmnamespace "0" .
    ?item wikibase:apiOutputItem mwapi:item .
  }
}`;

const DETAILS = (ids) => `SELECT ?item ?itemLabel ?type ?article ?imdb ?tmdbMovie ?tmdbTv ?date WHERE {
  VALUES ?item { ${ids.map((id) => `wd:${id}`).join(" ")} }
  OPTIONAL { ?item wdt:P31 ?type }
  OPTIONAL { ?a schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?article }
  OPTIONAL { ?item wdt:P345 ?imdb }
  OPTIONAL { ?item wdt:P4947 ?tmdbMovie }
  OPTIONAL { ?item wdt:P4983 ?tmdbTv }
  OPTIONAL { { ?item wdt:P577 ?date } UNION { ?item wdt:P580 ?date } }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,he,mul". }
}`;

async function tmdbArt(row) {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN;
  if (!token || !row.tmdb_id) return {};
  const path = row.kind === "series" ? "tv" : "movie";
  const response = await fetch(`https://api.themoviedb.org/3/${path}/${row.tmdb_id}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) return {};
  const body = await response.json();
  return { poster_path: body.poster_path ?? null, backdrop_path: body.backdrop_path ?? null };
}

async function heldIds(db) {
  const held = { wikidata_id: [], imdb_id: [], tmdb_id: [] };
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("works")
      .select("wikidata_id, imdb_id, tmdb_id").order("id").range(from, from + 999);
    if (error) throw new Error(`works read failed: ${error.message}`);
    for (const row of data ?? []) for (const key of Object.keys(held)) if (row[key]) held[key].push(row[key]);
    if ((data?.length ?? 0) < 1000) return held;
  }
}

async function main() {
  const ids = new Set();
  for (const row of await sparql(OWN_PRODUCTIONS(COUNTRY))) ids.add(row.item.value.split("/").pop());
  console.log(`${ids.size} productions of ${COUNTRY} with an English article`);
  for (const category of CATEGORIES) {
    await sleep(1500);
    const before = ids.size;
    for (const row of await sparql(CATEGORY_MEMBERS(category))) ids.add(row.item.value.split("/").pop());
    console.log(`  + ${ids.size - before} from "${category}"`);
  }

  const bindings = [];
  const list = [...ids];
  for (let index = 0; index < list.length; index += 150) {
    bindings.push(...await sparql(DETAILS(list.slice(index, index + 150))));
    await sleep(1500);
  }
  const rows = candidatesFromBindings(bindings).map(workRowFrom).filter(Boolean);
  console.log(`${rows.length} of ${ids.size} have a TMDB or IMDb id and a film/series type`);

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  let fresh = newRows(rows, await heldIds(db));
  console.log(`${fresh.length} are new to the catalogue`);
  if (LIMIT) fresh = fresh.slice(0, LIMIT);

  if (DRY_RUN) {
    for (const row of fresh.slice(0, 40)) console.log(`  ${row.kind.padEnd(6)} ${row.year ?? "----"}  ${row.title}`);
    console.log("dry run — nothing written");
    return;
  }

  let written = 0;
  for (let index = 0; index < fresh.length; index += 50) {
    const batch = [];
    for (const row of fresh.slice(index, index + 50)) {
      batch.push({ ...row, ...await tmdbArt(row) });
    }
    const { error } = await db.from("works").insert(batch);
    if (error) throw new Error(`insert failed: ${error.message}`);
    written += batch.length;
    console.log(`  ${written} written`);
  }
  console.log(`${written} works created (source = 'wikidata')`);
}

main().catch((failure) => {
  console.error(failure.message);
  process.exit(1);
});
