#!/usr/bin/env node
//
// Match the same place across sources, work by work.
//
//   node --env-file=.env.local scripts/corroborate-sources.mjs --dry-run
//   node --env-file=.env.local scripts/corroborate-sources.mjs
//
// Two things come out of a match. The agreement itself — two sets of
// contributors arriving at the same address independently, which is the only
// corroboration our data contains at scale. And a coordinate: moviemaps holds
// 30,153 points while reelstreets and movie-locations hold almost none, and
// 13,819 rows are refused by the review gate before any scoring purely for
// having no point.
//
// No network beyond Supabase, no model. Matching is place-dedup's own name rule,
// which refuses "National Gallery" against "National Portrait Gallery" on
// purpose — corroboration inherits that refusal rather than relaxing it.

import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { corroborateWork } from "../app/lib/cross-source.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const WRITE_BATCH = 200;

async function main() {
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Only works that more than one source touched can corroborate anything, but
  // finding those costs the same scan as reading everything, so read it once
  // and group in memory. 44k rows of five columns is small.
  const byWork = new Map();
  let read = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("location_submissions")
      .select("id, work_id, source_kind, place_name, lat, lng, corroborated_by")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data.length) break;
    for (const row of data) {
      read += 1;
      if (!byWork.has(row.work_id)) byWork.set(row.work_id, []);
      byWork.get(row.work_id).push(row);
    }
    if (data.length < 1000) break;
  }
  console.log(`${read} submissions across ${byWork.size} works`);

  const multi = [...byWork.values()].filter((rows) => new Set(rows.map((r) => r.source_kind)).size > 1);
  console.log(`${multi.length} works are described by more than one source\n`);

  const updates = multi.flatMap(corroborateWork);
  const rowsById = new Map(multi.flat().map((row) => [row.id, row]));
  const gained = updates.filter((u) => u.lat !== undefined);
  const bySource = {};
  for (const u of updates) {
    const row = multi.flat().find((r) => r.id === u.id);
    const k = row?.source_kind ?? "?";
    bySource[k] = bySource[k] ?? { corroborated: 0, borrowed: 0 };
    bySource[k].corroborated += 1;
    if (u.lat !== undefined) bySource[k].borrowed += 1;
  }

  console.log(`${updates.length} submissions gain corroboration`);
  console.log(`${gained.length} of them also gain a coordinate they did not have\n`);
  for (const [kind, counts] of Object.entries(bySource).sort((a, b) => b[1].corroborated - a[1].corroborated)) {
    console.log(`   ${kind.padEnd(16)} corroborated ${String(counts.corroborated).padStart(6)}   borrowed a point ${String(counts.borrowed).padStart(6)}`);
  }

  if (DRY_RUN) {
    console.log("\n   dry run — nothing written");
    for (const u of gained.slice(0, 5)) {
      console.log(`     ${u.id}  ${u.lat.toFixed(4)}, ${u.lng.toFixed(4)}  from ${u.geocode_source}`);
    }
    return;
  }

  // One row at a time within a batch: these are per-row values, not a shared
  // patch, so PostgREST's bulk update does not apply.
  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_BATCH) {
    const batch = updates.slice(i, i + WRITE_BATCH);
    await Promise.all(batch.map(async ({ id, ...patch }) => {
      // A confirmation that is not another row of ours (a web page that named the same
      // place, written by research-locations.mjs) has no submission_id to re-derive it
      // from, so a rerun keeps it instead of overwriting it.
      const kept = (rowsById.get(id)?.corroborated_by ?? []).filter((entry) => entry && !entry.submission_id);
      patch.corroborated_by = [...patch.corroborated_by, ...kept];
      const { error } = await db.from("location_submissions").update(patch).eq("id", id);
      if (error) throw new Error(`${id}: ${error.message}`);
    }));
    written += batch.length;
    if (i % (WRITE_BATCH * 5) === 0) console.log(`   ${written}/${updates.length}`);
  }
  console.log(`\n   ${written} submissions updated`);
}

main().catch((failure) => { console.error(failure.message); process.exit(1); });
