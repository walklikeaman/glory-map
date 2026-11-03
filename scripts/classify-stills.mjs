#!/usr/bin/env node
// Classify the galleries of films that have none yet (#107), in this process, through the
// same handler /api/enrich/stills serves.
//
//   node --env-file=.env.local scripts/classify-stills.mjs --limit 10
//   node --env-file=.env.local scripts/classify-stills.mjs --work <uuid>
//   node --env-file=.env.local scripts/classify-stills.mjs --all --max-dollars 25 --concurrency 4
//
// --all walks every work with a TMDB id and no verdicts yet, by id, so a stopped run
// resumes where the verdicts end. The handler's own queue (`--limit`) only looks at the
// first few dozen works it is handed, and works without TMDB images never leave it.
// --max-dollars stops starting new films once the measured spend reaches it.
//
// Costs money: one vision call per 12 images, up to 48 images a film. With
// ANTHROPIC_API_KEY set it runs on Claude (ANTHROPIC_VISION_MODEL, else ANTHROPIC_MODEL)
// and ends with what the run cost, measured from the API's usage counts.

import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { createStillsEnrichHandler, MAX_WORK_LIMIT } from "../app/api/enrich/stills/route.js";
import { createUsageMeter, meteredAnthropic } from "../app/lib/claude-usage.mjs";

const args = process.argv.slice(2);
const option = (name, fallback = null) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const limit = Number(option("limit", 3));
const workId = option("work");

const meter = createUsageMeter();
const Metered = meteredAnthropic(meter);
const token = `stills-${Math.random().toString(36).slice(2)}`;
const handler = createStillsEnrichHandler({
  env: { ...process.env, ENRICH_TOKEN: token },
  createAnthropicClient: (apiKey) => new Metered({ apiKey }),
  logError: (message, detail) => console.log(`    ! ${message} ${detail?.message ?? ""}`),
});

const ALL = args.includes("--all");
const maxDollars = Number(option("max-dollars", 5));
const concurrency = Number(option("concurrency", 4));
const spent = () => meter.summary().reduce((sum, row) => sum + (row.dollars ?? 0), 0);

async function allIds(db, table, column, filter = (query) => query) {
  const ids = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(db.from(table).select(column)).order(column).range(from, from + 999);
    if (error) throw new Error(error.message);
    ids.push(...data.map((row) => row[column]));
    if (data.length < 1000) return ids;
  }
}

async function classifyOne(id) {
  const response = await handler(new Request("http://local/api/enrich/stills", {
    method: "POST",
    headers: { "content-type": "application/json", "x-enrich-token": token },
    body: JSON.stringify({ work_id: id }),
  }));
  return (await response.json().catch(() => ({}))).works?.[0] ?? { title: id, reason: `http ${response.status}` };
}

if (ALL) {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const done = new Set(await allIds(db, "work_images", "work_id"));
  const pending = (await allIds(db, "works", "id", (query) => query.not("tmdb_id", "is", null)))
    .filter((id) => !done.has(id));
  console.log(`${pending.length} works pending, stop at $${maxDollars}`);
  let next = 0;
  let finished = 0;
  const stats = { judged: 0, frames: 0, films: 0, empty: 0, failed: 0 };
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < pending.length && spent() < maxDollars) {
      const work = await classifyOne(pending[next++]);
      finished += 1;
      if (work.judged) { stats.films += 1; stats.judged += work.judged; stats.frames += work.frames; }
      else if (work.reason === "no_images") stats.empty += 1;
      else { stats.failed += 1; console.log(`  ${work.title}: ${work.reason}`); }
      if (finished % 50 === 0) console.log(`  ${finished}/${pending.length}  $${spent().toFixed(3)}  ${JSON.stringify(stats)}`);
    }
  }));
  console.log(`done ${finished}/${pending.length}  ${JSON.stringify(stats)}`);
}

let left = ALL ? 0 : workId ? 1 : limit;
while (left > 0) {
  const batch = Math.min(left, MAX_WORK_LIMIT);
  const response = await handler(new Request("http://local/api/enrich/stills", {
    method: "POST",
    headers: { "content-type": "application/json", "x-enrich-token": token },
    body: JSON.stringify(workId ? { work_id: workId } : { limit: batch }),
  }));
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { console.log(`${response.status} ${body.error ?? ""}`); break; }
  for (const work of body.works ?? []) {
    console.log(`  ${String(work.title).padEnd(40)} ${work.reason ?? `judged=${work.judged} frames=${work.frames} rejected=${work.rejected} of ${work.available}`}`);
  }
  if ((body.works ?? []).length === 0) break;
  left -= batch;
}

for (const row of meter.summary()) {
  console.log(`${row.model}: ${row.calls} calls, ${row.input} in / ${row.output} out tokens, `
    + `${row.dollars === null ? "price unknown" : `$${row.dollars.toFixed(4)}`}`);
}
