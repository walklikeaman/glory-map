#!/usr/bin/env node
//
// Give a point to queue rows that carry an address or an area but no coordinate.
//
//   node --env-file=.env.local scripts/geocode-addresses.mjs --source web_research --dry-run
//   node --env-file=.env.local scripts/geocode-addresses.mjs --source web_research --write
//   node --env-file=.env.local scripts/geocode-addresses.mjs --source reelstreets --limit 2000 --write
//
// Nominatim allows one request a second, so 2,000 rows is about an hour. A row that
// found nothing is retried on a later run, which is right: OpenStreetMap grows.
// The rules are in app/lib/nominatim.mjs.

import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { chooseResult, geocodePatch, NOMINATIM_GAP_MS, NOMINATIM_SEARCH, queriesFor } from "../app/lib/nominatim.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const SOURCE = arg("source", "web_research");
const LIMIT = Number(arg("limit", 0)) || 0;
const WRITE = argv.includes("--write");
const AGENT = "GloryMapBot/0.1 (+https://github.com/walklikeaman/glory-map; contact via repo issues)";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function search(q, attempt = 0) {
  const url = `${NOMINATIM_SEARCH}?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
  const response = await fetch(url, { headers: { "User-Agent": AGENT, Accept: "application/json" } });
  if (response.status === 429 || response.status >= 500) {
    if (attempt >= 3) throw new Error(`nominatim ${response.status}`);
    await sleep(30000 * (attempt + 1));
    return search(q, attempt + 1);
  }
  if (!response.ok) throw new Error(`nominatim ${response.status}`);
  return response.json();
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("location_submissions")
      .select("id, place_name, area_hint")
      .eq("source_kind", SOURCE).is("lat", null).not("area_hint", "is", null).neq("status", "rejected")
      .order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000 || (LIMIT && rows.length >= LIMIT)) break;
  }
  const todo = LIMIT ? rows.slice(0, LIMIT) : rows;
  console.log(`${todo.length} ${SOURCE} rows without a point; about ${Math.ceil((todo.length * 1.5 * NOMINATIM_GAP_MS) / 60000)} min`);

  const totals = { placed: 0, refused: {} };
  for (const row of todo) {
    let placed = null;
    let why = "no_query";
    for (const [index, q] of queriesFor(row).entries()) {
      await sleep(NOMINATIM_GAP_MS);
      const { point, refused } = chooseResult(await search(q));
      if (point) {
        placed = geocodePatch(point, index);
        break;
      }
      why = refused;
    }
    if (!placed) {
      totals.refused[why] = (totals.refused[why] ?? 0) + 1;
      continue;
    }
    totals.placed += 1;
    console.log(`  ${placed.lat.toFixed(5)}, ${placed.lng.toFixed(5)}  ${row.place_name.slice(0, 50)}  [${placed.geocode_reason}]`);
    if (WRITE) {
      const { error } = await db.from("location_submissions").update(placed).eq("id", row.id).is("lat", null);
      if (error) throw new Error(`${row.id}: ${error.message}`);
    }
  }
  console.log(`\n${totals.placed} of ${todo.length} placed; not placed: ${JSON.stringify(totals.refused)}`);
  console.log(WRITE ? "written" : "dry run, nothing written (pass --write)");
}

main().catch((failure) => {
  console.error(failure.message);
  process.exit(1);
});
