#!/usr/bin/env node
//
// Check every place's pin against the gazetteers and list the ones that are wrong
// (live content check, 18.10 — the rules are in app/lib/pin-audit.mjs).
//
//   node --env-file=.env.local scripts/audit-place-pins.mjs [--out data/pin-audit]
//
// Read-only: places are public-read, so the anon key is enough. It writes three files —
// verdicts.json (every place), fixes.csv (the clear corrections, with the old and new
// coordinate and the source that decided each) and ambiguous.csv (the rows a person has
// to look at). Nothing in the database changes; applying fixes.csv is a separate,
// reviewed step.
//
// Places with a Wikidata id are checked against that item's P625. Places without one are
// looked up on Nominatim as "<name head>, <area>", one request a second as its usage
// policy asks; answers are cached in the output folder, so a stopped run resumes.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  areaHint,
  cityOfArea,
  fixUpdate,
  judgeAgainstNominatim,
  judgeAgainstWikidata,
  nameHead,
} from "../app/lib/pin-audit.mjs";
import { USER_AGENT } from "../app/lib/user-agent.mjs";

const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "data/pin-audit";
const NOMINATIM_GAP_MS = 1100;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and the anon key are required");

const reader = createClient(url, anonKey, { auth: { persistSession: false } });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync(OUT, { recursive: true });

async function allPlaces() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await reader
      .from("places")
      .select("id, name, city, country, lat, lng, wikidata_id, geocode_precision, osm_building_id, osm_street_id, pre_snap_lat, pre_snap_lng")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`places read failed: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

function truthy(claims) {
  const ranked = (claims ?? []).filter((claim) => claim.rank !== "deprecated");
  const preferred = ranked.filter((claim) => claim.rank === "preferred");
  return (preferred.length ? preferred : ranked).map((claim) => claim.mainsnak?.datavalue?.value).filter(Boolean);
}

async function wikidataEntities(ids) {
  const out = new Map();
  for (let start = 0; start < ids.length; start += 50) {
    const chunk = ids.slice(start, start + 50);
    const query = new URLSearchParams({
      action: "wbgetentities", ids: chunk.join("|"), props: "claims|labels|aliases",
      languages: "en", languagefallback: "1", format: "json", maxlag: "5",
    });
    // maxlag answers 200 with `{ error: { code: "maxlag" } }` and no entities. The first
    // full run read that as "no coordinate" for 1,589 places, the London Eye among them.
    let payload;
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetch(`https://www.wikidata.org/w/api.php?${query}`, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) throw new Error(`Wikidata responded ${response.status}`);
      payload = await response.json();
      if (!payload.error) break;
      if (attempt === 12) throw new Error(`Wikidata kept answering ${payload.error.code}`);
      await wait(Math.min(60_000, 10_000 * attempt));
    }
    for (const id of chunk) {
      const entity = payload.entities?.[id];
      if (!entity || entity.missing !== undefined) { out.set(id, null); continue; }
      const point = truthy(entity.claims?.P625).find((value) => Number.isFinite(value?.latitude));
      out.set(id, {
        label: entity.labels?.en?.value ?? Object.values(entity.labels ?? {})[0]?.value ?? null,
        aliases: (entity.aliases?.en ?? []).map((alias) => alias.value),
        lat: point?.latitude ?? null,
        lng: point?.longitude ?? null,
      });
    }
    await wait(300);
  }
  return out;
}

const cacheFile = path.join(OUT, "nominatim-cache.json");
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};

async function nominatim(query) {
  if (query in cache) return cache[query];
  const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "3", "accept-language": "en" });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { "User-Agent": USER_AGENT } });
  await wait(NOMINATIM_GAP_MS);
  if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
  cache[query] = await response.json();
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  return cache[query];
}

const places = await allPlaces();
console.log(`${places.length} places`);

const verdicts = [];
const withQ = places.filter((place) => place.wikidata_id);
const entities = await wikidataEntities([...new Set(withQ.map((place) => place.wikidata_id))]);
for (const place of withQ) {
  verdicts.push({ place, by: "wikidata", ...judgeAgainstWikidata(place, entities.get(place.wikidata_id)) });
}
console.log(`wikidata: ${withQ.length} checked`);

const withoutQ = places.filter((place) => !place.wikidata_id);
let asked = 0;
for (const place of withoutQ) {
  const area = areaHint(place);
  const head = nameHead(place.name);
  let query = area ? `${head}, ${area}` : head;
  try {
    let verdict = judgeAgainstNominatim(place, await nominatim(query), { hinted: Boolean(area) });
    // A full street address with a postcode often finds nothing where "<name>, <city>"
    // does — The Shard, on the first run.
    const city = cityOfArea(area);
    if (verdict.verdict === "unresolved" && city && city !== area) {
      query = `${head}, ${city}`;
      verdict = judgeAgainstNominatim(place, await nominatim(query), { hinted: true });
    }
    verdicts.push({ place, by: "nominatim", query, ...verdict });
  } catch (error) {
    verdicts.push({ place, by: "nominatim", query, verdict: "unresolved", reason: error.message });
  }
  asked += 1;
  if (asked % 50 === 0) console.log(`nominatim: ${asked}/${withoutQ.length}`);
}

const counts = {};
for (const row of verdicts) counts[`${row.by}:${row.verdict}`] = (counts[`${row.by}:${row.verdict}`] ?? 0) + 1;
console.log(counts);

const flat = verdicts.map(({ place, ...rest }) => ({
  id: place.id, name: place.name, wikidata_id: place.wikidata_id, old_lat: place.lat, old_lng: place.lng,
  old_precision: place.geocode_precision, ...rest,
  // The exact row a fix would become, pre_snap_* included, so the review reads the write.
  ...(rest.verdict === "fix" ? { update: fixUpdate(place, rest) } : {}),
}));
fs.writeFileSync(path.join(OUT, "verdicts.json"), JSON.stringify(flat, null, 1));
const csv = (rows, columns) => [columns.join(","), ...rows.map((row) =>
  columns.map((column) => JSON.stringify(row[column] ?? "")).join(","))].join("\n");
fs.writeFileSync(path.join(OUT, "ambiguous.csv"), csv(flat.filter((row) => row.verdict === "ambiguous"),
  ["id", "name", "wikidata_id", "old_lat", "old_lng", "metres", "reason", "query"]));
fs.writeFileSync(path.join(OUT, "fixes.csv"), csv(flat.filter((row) => row.verdict === "fix"),
  ["id", "name", "wikidata_id", "old_lat", "old_lng", "old_precision", "lat", "lng", "geocode_precision", "metres", "source"]));
console.log(`report: ${OUT}/fixes.csv and ${OUT}/ambiguous.csv`);
