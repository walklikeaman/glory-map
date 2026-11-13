#!/usr/bin/env node
// Put a verdict, and a reason, on every row of the review queue.
//
//   node scripts/review-submissions.mjs --dry             # report, write nothing
//   node scripts/review-submissions.mjs --sql out.sql     # emit the UPDATEs
//   node scripts/review-submissions.mjs --write           # apply them
//
// It used to emit SQL only, because the machine that ran it held the anon key and writes
// had to go through the Supabase MCP as `postgres`. With `SUPABASE_SERVICE_ROLE_KEY` in the
// environment it can apply its own verdicts — and it should, because the emitted file for
// this queue is 227 kB of id lists that nobody reads before running it anyway. `--sql`
// stays for the case where somebody wants to read the decisions before they land.
//
// The rules live in `app/lib/submission-review.mjs` with the measurements that produced
// them. This file only fetches, applies them, and counts.
//
// Every UPDATE carries its own reason, and the reasons are grouped, so the run is
// readable as a table afterwards: a review whose verdicts cannot be counted by kind is a
// review nobody can disagree with.

import fs from "node:fs";
import process from "node:process";

import { reviewSubmission, tallyVerdicts } from "../app/lib/submission-review.mjs";

const args = process.argv.slice(2);
const sqlPath = args.includes("--sql") ? args[args.indexOf("--sql") + 1] : null;
const WRITE = args.includes("--write");

const PAGE = 1000;
const UPDATE_CHUNK = 500;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and a Supabase key in the environment.");
  process.exit(1);
}

// Only the columns the rules read. `corroborated_by` and `wikidata_id` are filled by the
// resolver in another branch; absent, they simply produce no signal, which is the honest
// answer rather than an error.
const COLUMNS = [
  "id", "place_name", "place_key", "lat", "lng", "source_kind", "source_sentence",
  "source_url", "status", "wikidata_id", "corroborated_by",
  // Without these the rule that refuses a Q-id echoing our own geocode cannot see it, and a
  // missing column reads as "not an echo" — silently counting what it exists to refuse.
  "geocode_source", "geocode_source_id",
].join(",");

async function fetchPage(offset) {
  const endpoint = `${url}/rest/v1/location_submissions`
    + `?select=${encodeURIComponent(COLUMNS)}&order=id.asc&limit=${PAGE}&offset=${offset}`;
  const response = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  // PostgREST answers a bad range and a bad filter with a 200 and a body that is not the
  // rows you asked for, so the shape is checked rather than assumed.
  if (!response.ok) throw new Error(`queue read failed: ${response.status} ${await response.text()}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`queue read returned ${typeof rows}, not an array`);
  return rows;
}

async function readQueue() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await fetchPage(offset);
    rows.push(...page);
    process.stderr.write(`\rread ${rows.length}`);
    if (page.length < PAGE) break;
  }
  process.stderr.write("\n");
  return rows;
}

function quote(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}

// ONLY the verdicts that change what the product does.
//
// A `pending` row's reason -- "no signal yet", "no coordinate", "the name is a caption" --
// is DERIVED from the row, and it goes stale the moment the resolver fills a Q-id or the
// extractor is fixed. Writing 42,000 of those would stamp `reviewed_at` on rows nobody
// decided anything about, and the queue would then report itself as reviewed when all
// that happened was a label. It costs one script run to re-derive, and the report below
// prints it every time.
//
// So `verified` and `rejected` are written, because the map reads them. Everything else
// is reported and not stored.
const DECISIVE = new Set(["verified", "rejected"]);

// One UPDATE per (status, reason) group, chunked. Grouping is not a micro-optimisation:
// it makes the emitted SQL itself the report -- you can read what was decided and why
// without running anything.
function emitSql(decisions) {
  const groups = new Map();
  for (const { id, verdict } of decisions) {
    if (!DECISIVE.has(verdict.status)) continue;
    // A reason contains spaces ("the inscription is on a wall at this coordinate"), so
    // the two parts are kept apart rather than joined and split back out.
    const groupKey = JSON.stringify([verdict.status, verdict.reason]);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), id]);
  }

  const out = [
    "-- Review verdicts for location_submissions, produced by scripts/review-submissions.mjs.",
    "-- Rules and their measurements: app/lib/submission-review.mjs.",
    "-- Reversible in one statement:",
    "--   update location_submissions set status='pending', status_reason=null, reviewed_at=null;",
    "",
  ];

  for (const [groupKey, ids] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const [status, reason] = JSON.parse(groupKey);
    out.push(`-- ${status}: ${reason} (${ids.length})`);
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      const chunk = ids.slice(i, i + UPDATE_CHUNK).map(quote).join(", ");
      out.push(
        `update location_submissions set status = ${quote(status)}, `
        + `status_reason = ${quote(reason)}, reviewed_at = now() `
        + `where id in (${chunk});`,
      );
    }
    out.push("");
  }
  return out.join("\n");
}

function report(rows, decisions) {
  const tally = tallyVerdicts(decisions.map((decision) => decision.verdict));
  console.log(`\nqueue: ${rows.length} rows`);
  console.log(`verified ${tally.verified} · rejected ${tally.rejected} · pending ${tally.pending}\n`);
  const reasons = Object.entries(tally.reasons).sort((a, b) => b[1] - a[1]);
  const width = Math.max(...reasons.map(([reason]) => reason.length));
  for (const [reason, count] of reasons) {
    console.log(`  ${reason.padEnd(width)}  ${String(count).padStart(6)}`);
  }
}

const rows = await readQueue();
const decisions = rows.map((row) => ({ id: row.id, current: row.status, verdict: reviewSubmission(row) }));
report(rows, decisions);

// The same grouping the SQL uses, applied. One request per (status, reason, chunk), so a
// failure names the group it failed in rather than "the review failed".
async function applyVerdicts(decisions) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("--write needs SUPABASE_SERVICE_ROLE_KEY in the environment");

  // Only rows whose status changes: re-stamping a row already verified for the same
  // reason would move its `reviewed_at` without anyone deciding anything new.
  const groups = new Map();
  for (const { id, current, verdict } of decisions) {
    if (!DECISIVE.has(verdict.status) || verdict.status === current) continue;
    const groupKey = JSON.stringify([verdict.status, verdict.reason]);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), id]);
  }

  let written = 0;
  for (const [groupKey, ids] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const [status, reason] = JSON.parse(groupKey);
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      const chunk = ids.slice(i, i + UPDATE_CHUNK);
      const endpoint = `${url}/rest/v1/location_submissions`
        + `?id=in.(${chunk.join(",")})`;
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ status, status_reason: reason, reviewed_at: new Date().toISOString() }),
      });
      if (!response.ok) {
        throw new Error(`verdict write failed for "${status}: ${reason}": `
          + `${response.status} ${await response.text()}`);
      }
      written += chunk.length;
      process.stderr.write(`\rwrote ${written}`);
    }
  }
  process.stderr.write("\n");
  return written;
}

if (sqlPath) {
  fs.writeFileSync(sqlPath, emitSql(decisions));
  console.log(`\nwrote ${sqlPath}`);
}

if (WRITE) {
  const written = await applyVerdicts(decisions);
  console.log(`\napplied ${written} verdicts`);
  console.log("Reversible: update location_submissions set status='pending', status_reason=null, reviewed_at=null;");
} else if (!sqlPath) {
  console.log("\nNothing written. Pass --write to apply, or --sql <path> to read them first.");
}
