#!/usr/bin/env node
//
// Put a verdict on every place the Wikidata resolver wrote (`resolver_version` set).
//
//   node --env-file=.env.local scripts/review-resolved-places.mjs           # report only
//   node --env-file=.env.local scripts/review-resolved-places.mjs --write   # apply
//
// `/api/resolve` writes its places as `pending`, and until now someone had to verify them
// by hand. The rules are `reviewResolvedPlace` in app/lib/place-review.mjs: a Wikidata
// entity with a point is verified; a country, a city or anything over 20 km² (P2046, read
// from Wikidata here) is held back from the map. Fictional places are left alone: they are
// verified on purpose and never drawn. Only rows whose status changes are written, each
// with its reason.

import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { reviewResolvedPlace } from "../app/lib/place-review.mjs";
import { chunk, createSparqlClient } from "../app/lib/wikidata-sparql.mjs";

const WRITE = process.argv.includes("--write");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function resolvedPlaces() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("places")
      .select("id, name, wikidata_id, lat, lng, place_class, geocode_precision, status")
      .not("resolver_version", "is", null).order("id").range(from, from + 999);
    if (error) throw new Error(`places read failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}

// Q-id → area in km², from Wikidata's normalised quantity (always m²).
async function areasKm2(qids) {
  const query = createSparqlClient();
  const areas = new Map();
  for (const ids of chunk(qids.filter((id) => /^Q[1-9]\d*$/.test(id)), 200)) {
    const bindings = await query(`SELECT ?item (MAX(?m2) AS ?area) WHERE {
      VALUES ?item { ${ids.map((id) => `wd:${id}`).join(" ")} }
      ?item p:P2046/psn:P2046/wikibase:quantityAmount ?m2 } GROUP BY ?item`);
    for (const row of bindings) {
      areas.set(row.item.value.split("/").pop(), Number(row.area.value) / 1e6);
    }
    // A town, an island group, a peninsula or a district with no stated area is still an
    // area. Counted as infinitely large, which is what it is to someone looking for a door.
    const wide = await query(`SELECT DISTINCT ?item WHERE {
      VALUES ?item { ${ids.map((id) => `wd:${id}`).join(" ")} }
      VALUES ?area { ${AREA_TYPES.map((id) => `wd:${id}`).join(" ")} }
      ?item wdt:P31/wdt:P279* ?area }`);
    for (const row of wide) areas.set(row.item.value.split("/").pop(), Infinity);
    const spots = await query(`SELECT DISTINCT ?item WHERE {
      VALUES ?item { ${ids.map((id) => `wd:${id}`).join(" ")} }
      VALUES ?spot { ${SPOT_TYPES.map((id) => `wd:${id}`).join(" ")} }
      ?item wdt:P31/wdt:P279* ?spot }`);
    for (const row of spots) areas.delete(row.item.value.split("/").pop());
  }
  return areas;
}

// human settlement, administrative territorial entity, archipelago, peninsula, desert, oasis,
// river, mountain range, valley, plain, coast
const AREA_TYPES = [
  "Q486972", "Q56061", "Q33837", "Q34763", "Q8514", "Q43742",
  "Q4022", "Q46831", "Q39816", "Q160091", "Q93352",
];
// …unless it is also a structure or a site you walk into: a castle that is also a civil
// parish, a fortress that is also a national park (Alnwick, Masada) stays a spot.
// architectural structure, archaeological site
const SPOT_TYPES = ["Q811979", "Q839954"];

async function main() {
  const places = (await resolvedPlaces()).filter((place) => place.place_class !== "fictional");
  const areas = await areasKm2([...new Set(places.map((place) => place.wikidata_id).filter(Boolean))]);
  for (const place of places) place.area_km2 = areas.get(place.wikidata_id) ?? null;
  const changes = [];
  const tally = {};
  for (const place of places) {
    const verdict = reviewResolvedPlace(place);
    if (verdict.status === place.status) continue;
    const key = `${place.status} → ${verdict.status} (${verdict.reason})`;
    tally[key] = (tally[key] ?? 0) + 1;
    changes.push({ place, verdict });
  }
  console.log(`${places.length} resolved places, ${changes.length} to change`);
  for (const [key, count] of Object.entries(tally)) console.log(`  ${count}\t${key}`);
  for (const { place, verdict } of changes.slice(0, Number(process.env.SHOW ?? 40))) {
    console.log(`  ${verdict.status.padEnd(8)} ${place.name} [${place.geocode_precision}] ${place.wikidata_id ?? ""}${place.area_km2 ? ` ${place.area_km2 === Infinity ? "area type" : `${Math.round(place.area_km2)} km²`}` : ""}`);
  }
  if (!WRITE) return;
  const reviewedAt = new Date().toISOString();
  for (const { place, verdict } of changes) {
    const { error } = await db.from("places")
      .update({ status: verdict.status, status_reason: verdict.reason, reviewed_at: reviewedAt })
      .eq("id", place.id);
    if (error) throw new Error(`update ${place.id} failed: ${error.message}`);
  }
  console.log(`wrote ${changes.length}`);
}

main().catch((failure) => {
  console.error(failure.message);
  process.exit(1);
});
