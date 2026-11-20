#!/usr/bin/env node
//
// The films and series shot in a country's biggest cities → `works` rows, plus a queue
// for the paid web research.
//
//   node --env-file=.env.local scripts/ingest-city-works.mjs --country Q38 --cities 10 --dry-run
//   node --env-file=.env.local scripts/ingest-city-works.mjs --country Q38 --cities 100 --write
//
// Nikita, 2026-11-19: "take each country's top-100 cities, see which films were shot
// there, and work through them in batches". For each of the N most populous cities:
//   - Wikidata P915 (filming location) on the city or on a place inside it (P131);
//   - the English Wikipedia's "Films shot in <city>" category, read through the query
//     service's MediaWiki bridge (en.wikipedia.org rate-limits the cloud egress itself).
// Ten test cities (Rome … Oslo) named 1,142 works; the catalogue held 95.
//
// Writes:
//   - new `works` rows (source = 'wikidata', with a TMDB poster), only with --write;
//   - the queue /mnt/project-files/glorymap-research/cities/<country>.json: every work the
//     cities name, held or new, most widely known first (research-locations.mjs --queue).
// After it: resolve-works.mjs --unlinked (free Wikidata places) and review-resolved-places.
//
// The row rules (film/series types, a TMDB or IMDb id, the dedup on all three ids) are
// the country ingest's own, in app/lib/country-works.mjs.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { candidatesFromBindings, cityQueue, newRows, workRowFrom } from "../app/lib/country-works.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const COUNTRY = arg("country");
const CITIES = Number(arg("cities", 100)) || 100;
const LIMIT = Number(arg("limit", 0)) || null;
const WRITE = argv.includes("--write");
const DIR = arg("dir", "/mnt/project-files/glorymap-research/cities/");
const SPARQL = "https://query.wikidata.org/sparql";
const AGENT = "GloryMapBot/0.1 (+https://github.com/walklikeaman/glory-map; contact via repo issues)";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const qid = (uri) => String(uri ?? "").split("/").pop();

if (!/^Q\d+$/.test(COUNTRY ?? "")) {
  console.error("Pass --country <Q-id> (e.g. Q38 for Italy)");
  process.exit(1);
}

async function sparql(query) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(`${SPARQL}?query=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": AGENT },
    });
    if (response.ok) return (await response.json()).results.bindings;
    console.warn(`  query service ${response.status}, retrying`);
    await sleep(5000 * attempt);
  }
  throw new Error("Wikidata query service kept failing");
}

// A city, by population. Three class paths, asked one at a time and merged, because a
// single query with all of them (or with P279*) times out on the US and France:
//   - city (Q515) or a direct subclass (big city, comune, city of England…);
//   - city of the United States (Q1093829) up to two subclass steps (Los Angeles is a
//     charter city → city of California → city of the US; Q515 never reached it, 20.11);
//   - big city (Q1549591) itself.
// Dissolved places (P576) and metropolitan areas (Q1907114) are left out.
const CITY_PATHS = [["Q515", "wdt:P31/wdt:P279?"], ["Q1093829", "wdt:P31/wdt:P279?/wdt:P279?"], ["Q1549591", "wdt:P31"]];
const TOP_CITIES = (country, limit, [target, path]) => `SELECT ?city ?cityLabel ?pop WHERE {
  { SELECT ?city (MAX(?p) AS ?pop) WHERE {
    ?city wdt:P17 wd:${country}; wdt:P1082 ?p; ${path} wd:${target} .
    FILTER NOT EXISTS { ?city wdt:P576 [] }
    FILTER NOT EXISTS { ?city wdt:P31 wd:Q1907114 }
  } GROUP BY ?city ORDER BY DESC(?pop) LIMIT ${limit} }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}`;

async function topCities(country, limit) {
  const byCity = new Map();
  for (const classPath of CITY_PATHS) {
    for (const row of await sparql(TOP_CITIES(country, limit, classPath))) byCity.set(row.city.value, row);
    await sleep(1000);
  }
  return [...byCity.values()].sort((a, b) => Number(b.pop.value) - Number(a.pop.value)).slice(0, limit);
}

// One city at a time: the same query over a whole country times out (Italy, 90 s).
const FILMED_IN = (city) => `SELECT DISTINCT ?item WHERE {
  VALUES ?type { wd:Q11424 wd:Q5398426 wd:Q1259759 }
  { ?item wdt:P915 wd:${city} } UNION { ?item wdt:P915 ?place . ?place wdt:P131 wd:${city} }
  ?item wdt:P31 ?type .
}`;

const CATEGORY_MEMBERS = (category) => `SELECT ?item WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:endpoint "en.wikipedia.org"; wikibase:api "Generator";
      mwapi:generator "categorymembers"; mwapi:gcmtitle "Category:${category.replace(/"/g, "")}";
      mwapi:gcmlimit "max"; mwapi:gcmnamespace "0" .
    ?item wikibase:apiOutputItem mwapi:item .
  }
}`;

const DETAILS = (ids) => `SELECT ?item ?itemLabel ?type ?article ?imdb ?tmdbMovie ?tmdbTv ?date ?links WHERE {
  VALUES ?item { ${ids.map((id) => `wd:${id}`).join(" ")} }
  OPTIONAL { ?item wikibase:sitelinks ?links }
  OPTIONAL { ?item wdt:P31 ?type }
  OPTIONAL { ?a schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?article }
  OPTIONAL { ?item wdt:P345 ?imdb }
  OPTIONAL { ?item wdt:P4947 ?tmdbMovie }
  OPTIONAL { ?item wdt:P4983 ?tmdbTv }
  OPTIONAL { { ?item wdt:P577 ?date } UNION { ?item wdt:P580 ?date } }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}`;

async function tmdbArt(row) {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN;
  if (!token || !row.tmdb_id) return {};
  const kind = row.kind === "series" ? "tv" : "movie";
  const response = await fetch(`https://api.themoviedb.org/3/${kind}/${row.tmdb_id}`, {
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
  const cities = await topCities(COUNTRY, CITIES);
  console.log(`${cities.length} cities of ${COUNTRY}, ${cities[0]?.cityLabel.value ?? "none"} first`);
  const citiesByWork = new Map();
  for (const city of cities) {
    const name = city.cityLabel.value;
    const found = new Set();
    await sleep(1000);
    // A category member without a Wikidata item comes back with ?item unbound (New York City, 20.11).
    for (const row of await sparql(FILMED_IN(qid(city.city.value)))) if (row.item) found.add(qid(row.item.value));
    if (!/^Q\d+$/.test(name)) {
      await sleep(1000);
      for (const row of await sparql(CATEGORY_MEMBERS(`Films shot in ${name}`))) if (row.item) found.add(qid(row.item.value));
    }
    for (const id of found) citiesByWork.set(id, (citiesByWork.get(id) ?? new Set()).add(name));
    if (found.size) console.log(`  ${String(found.size).padStart(4)}  ${name}`);
  }
  const ids = [...citiesByWork.keys()];
  console.log(`${ids.length} works filmed in them`);

  const bindings = [];
  for (let index = 0; index < ids.length; index += 150) {
    bindings.push(...await sparql(DETAILS(ids.slice(index, index + 150))));
    await sleep(1500);
  }
  const rows = candidatesFromBindings(bindings).map(workRowFrom).filter(Boolean);
  console.log(`${rows.length} of ${ids.length} have a TMDB or IMDb id and a film/series type`);

  const sitelinks = new Map(bindings.filter((row) => row.links).map((row) => [qid(row.item.value), Number(row.links.value)]));
  const queue = cityQueue(rows, citiesByWork, sitelinks);
  const queuePath = path.join(DIR, `${COUNTRY}.json`);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(queuePath, JSON.stringify({ country: COUNTRY, cities: cities.length, at: new Date().toISOString(), works: queue }, null, 1));
  console.log(`queue of ${queue.length} works: ${queuePath}`);

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  let fresh = newRows(rows, await heldIds(db));
  console.log(`${fresh.length} are new to the catalogue`);
  if (LIMIT) fresh = fresh.slice(0, LIMIT);

  if (!WRITE) {
    for (const row of fresh.slice(0, 30)) console.log(`  ${row.kind.padEnd(6)} ${row.year ?? "----"}  ${row.title}`);
    console.log("dry run: no works written (pass --write)");
    return;
  }
  let written = 0;
  for (let index = 0; index < fresh.length; index += 50) {
    const batch = [];
    for (const row of fresh.slice(index, index + 50)) batch.push({ ...row, ...await tmdbArt(row) });
    const { error } = await db.from("works").insert(batch);
    if (error) throw new Error(`insert failed: ${error.message}`);
    written += batch.length;
  }
  console.log(`${written} works created (source = 'wikidata')`);
}

main().catch((failure) => {
  console.error(failure.message);
  process.exit(1);
});
