#!/usr/bin/env node
//
// Ask Wikidata what entity sits at each MovieMaps pin, under that pin's own name.
//
//   node --env-file=.env.local scripts/resolve-wikidata.mjs --dry-run --limit 20
//   node --env-file=.env.local scripts/resolve-wikidata.mjs
//
// This is the first path to `verified`. The review gate weights wikidata_entity
// at 0.6 against a 0.6 threshold, so a canonical entity is the only single
// signal that passes — and none of our 44k submissions had one.
//
// Measured on 196 real pins: 28.1% resolve. The ceiling is the data, not the
// rule. 138 of those 196 had SOME entity within 150 m, but the rest are genuine
// neighbours: in a city there is nearly always something notable within a
// block, and Wikidata holds no entry for an ordinary house.
//
// WDQS is a free public endpoint that asks not to be hammered. The existing
// cascade already learned the etiquette — 5 s between queries, 504 means "too
// heavy", 429 means "too fast" — so this keeps a 2.5 s gap on single-point
// queries and backs off hard on either. 27k pins is a day and a half; that is
// the price of not running a private endpoint, and the job is resumable.

import { stat } from "node:fs/promises";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { buildAroundQuery, chooseEntity, foldBindings } from "../app/lib/wikidata-resolve.mjs";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? true);
}
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = Number.parseInt(arg("limit", "0"), 10) || 0;
const GAP_MS = Number.parseInt(arg("gap", "2500"), 10) || 2500;
const SOURCE_KIND = String(arg("source", "moviemaps"));

const ENDPOINT = "https://query.wikidata.org/sparql";
const AGENT = "GloryMapBot/0.1 (+https://github.com/walklikeaman/glory-map; contact via repo issues)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function askWikidata(lat, lng, attempt = 0) {
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(buildAroundQuery(lat, lng))}`;
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": AGENT, Accept: "application/sparql-results+json" } });
  } catch (failure) {
    if (attempt >= 3) throw failure;
    await sleep(8000 * (attempt + 1));
    return askWikidata(lat, lng, attempt + 1);
  }
  if (res.status === 429 || res.status === 504 || res.status >= 500) {
    if (attempt >= 3) throw new Error(`WDQS ${res.status} after 4 attempts`);
    // 429 means slow down and 504 means the query was heavy; a single-point
    // query cannot be shrunk, so both are answered with a longer wait.
    await sleep((res.status === 429 ? 20000 : 8000) * (attempt + 1));
    return askWikidata(lat, lng, attempt + 1);
  }
  if (!res.ok) throw new Error(`WDQS ${res.status}`);
  return foldBindings((await res.json()).results.bindings);
}

async function main() {
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Only rows with a coordinate and no answer yet. Resumable by construction:
  // a row that resolved is skipped, and a row that did not is retried on a
  // later run — which is right, because Wikidata gains entries over time.
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("location_submissions")
      .select("id, place_name, lat, lng")
      .eq("source_kind", SOURCE_KIND).not("lat", "is", null).is("wikidata_id", null)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }

  const todo = LIMIT ? rows.slice(0, LIMIT) : rows;
  const hours = (todo.length * GAP_MS) / 3_600_000;
  console.log(`${rows.length} ${SOURCE_KIND} pins awaiting an entity; working ${todo.length}`);
  console.log(`at ${GAP_MS} ms per query this is about ${hours.toFixed(1)} hours\n`);

  const totals = { asked: 0, resolved: 0, none: 0, ambiguous: 0, failed: 0 };
  const started = Date.now();

  for (const row of todo) {
    let candidates;
    try {
      candidates = await askWikidata(row.lat, row.lng);
      totals.asked += 1;
    } catch (failure) {
      totals.failed += 1;
      console.log(`  ${failure.message} on ${row.place_name}`);
      await sleep(GAP_MS);
      continue;
    }

    const { entity, reason } = chooseEntity(row.place_name, candidates);
    if (entity) {
      totals.resolved += 1;
      if (!DRY_RUN) {
        const { error } = await db.from("location_submissions")
          .update({ wikidata_id: entity.qid }).eq("id", row.id);
        if (error) throw new Error(error.message);
      }
      console.log(`  ${entity.qid.padEnd(11)} ${row.place_name.slice(0, 46).padEnd(48)} ${entity.label.slice(0, 34)} (${entity.distanceM} m)`);
    } else if (/share this name/.test(reason)) {
      totals.ambiguous += 1;
    } else {
      totals.none += 1;
    }

    const done = totals.asked + totals.failed;
    if (done % 100 === 0) {
      const rate = done / ((Date.now() - started) / 1000);
      console.log(`  … ${done}/${todo.length}  resolved ${totals.resolved} (${(100 * totals.resolved / Math.max(totals.asked, 1)).toFixed(1)}%)  ` +
                  `~${((todo.length - done) / rate / 3600).toFixed(1)} h left`);
    }
    await sleep(GAP_MS);
  }

  console.log(`\n${totals.asked} asked, ${totals.failed} failed`);
  console.log(`   ${totals.resolved} resolved to an entity`);
  console.log(`   ${totals.ambiguous} refused — several entities share the name there`);
  console.log(`   ${totals.none} no entity of that name within 150 m`);
  console.log(DRY_RUN ? "   dry run — nothing written" : `   ${totals.resolved} Q-ids written`);
}

main().catch((failure) => { console.error(failure.message); process.exit(1); });
