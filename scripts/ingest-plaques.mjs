#!/usr/bin/env node
// Ingest commemorative plaques from the Open Plaques dump (#125).
//
//   node scripts/ingest-plaques.mjs --dry            # match and report, write nothing
//   node scripts/ingest-plaques.mjs                  # write submissions
//   node scripts/ingest-plaques.mjs --sql out.sql    # emit SQL instead of writing
//
// The dump is PDDL — public domain — and they ask people not to crawl, so this reads the
// published file and nothing else. Every row lands in `location_submissions` as
// `pending`: a plaque is a strong claim and still not a verified one.
//
// What this script does NOT do is widen the match to raise the count. Measured on the
// whole world dump: a normalised substring gives 4,643 "hits" that are mostly ordinary
// English ("the club", "the beach"); case-sensitive matching gives 346; requiring the
// claim word beside the title gives 46, and those 46 are real. The rules live in
// `app/lib/plaque-source.mjs` with the numbers that produced them.

import fs from "node:fs";
import process from "node:process";

import { matchPlaque, PLAQUE_SOURCE_KIND } from "../app/lib/plaque-source.mjs";

const DUMP_URL = "https://openplaques.s3.eu-west-2.amazonaws.com/open-plaques-all-2025-12-14.csv";
const USER_AGENT = "GloryMap/1.1 (https://codex-hackathon-starter.vercel.app/; nakonechnyi.n@gmail.com)";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const sqlPath = args.includes("--sql") ? args[args.indexOf("--sql") + 1] : null;
const cachePath = process.env.PLAQUE_DUMP ?? null;

// A CSV reader rather than a dependency: the dump is 42 MB of quoted fields with commas
// and newlines inside them, and this is the whole of what we need from it.
function readCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.replace(/^﻿/, ""));
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

async function loadDump() {
  if (cachePath && fs.existsSync(cachePath)) {
    console.log(`dump: ${cachePath} (cached)`);
    return fs.readFileSync(cachePath, "utf8");
  }
  console.log(`dump: fetching ${DUMP_URL}`);
  const response = await fetch(DUMP_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`dump responded ${response.status}`);
  const text = await response.text();
  if (cachePath) fs.writeFileSync(cachePath, text);
  return text;
}

// Our works, read with the public key: this is a read of the public graph.
async function loadWorks({ url, key }) {
  const works = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${url}/rest/v1/works?select=id,title,title_norm,kind,year&order=id.asc&limit=1000&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!response.ok) throw new Error(`works responded ${response.status}`);
    const page = await response.json();
    works.push(...page);
    if (page.length < 1000) break;
  }
  return works;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

const COLUMNS = [
  "work_id", "place_name", "area_hint", "source_kind", "source_record_id",
  "source_sentence", "source_title", "source_url", "source_license",
  "source_license_url", "source_attribution", "lat", "lng", "geocode_source",
  "geocode_source_id", "geocode_license", "geocode_reason", "status",
];

function toSql(rows) {
  const values = rows.map((row) =>
    `(${COLUMNS.map((column) => {
      const value = row[column];
      if (column === "source_kind") return `${sqlLiteral(value)}::submission_source_kind`;
      if (column === "status") return `${sqlLiteral(value)}::submission_status`;
      return sqlLiteral(value);
    }).join(", ")})`).join(",\n  ");

  return `insert into location_submissions (${COLUMNS.join(", ")})\nvalues\n  ${values}\non conflict do nothing;\n`;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required");
  process.exit(1);
}

const [dump, works] = await Promise.all([loadDump(), loadWorks({ url, key: anonKey })]);
const plaques = readCsv(dump);
console.log(`plaques: ${plaques.length}, works: ${works.length}`);

const matchable = works.filter((work) => work.title && work.kind);
const submissions = [];
const skipped = { victim: 0, noClaim: 0 };

for (const plaque of plaques) {
  if (!plaque.latitude || !plaque.inscription) { skipped.noClaim += 1; continue; }
  const matched = matchPlaque(plaque, matchable);
  if (!matched) { skipped.noClaim += 1; continue; }
  submissions.push(matched.submission);
}

console.log(`\nmatched: ${submissions.length} plaques → ${new Set(submissions.map((s) => s.work_id)).size} works`);
for (const row of submissions.slice(0, 12)) {
  console.log(`  ${row.place_name} — "${row.source_sentence.slice(0, 78)}…"`);
}

if (dryRun) { console.log("\n--dry: nothing written"); process.exit(0); }

if (sqlPath) {
  fs.writeFileSync(sqlPath, toSql(submissions));
  console.log(`\nSQL written to ${sqlPath} (${submissions.length} rows)`);
  process.exit(0);
}

if (!serviceKey) {
  console.error("\nSUPABASE_SERVICE_ROLE_KEY is required to write; use --sql to emit statements instead");
  process.exit(1);
}

// Inserted in batches, and never updated: a plaque that is already in the queue has
// already been seen by whoever reviews it.
const BATCH = 100;
let written = 0;
for (let index = 0; index < submissions.length; index += BATCH) {
  const batch = submissions.slice(index, index + BATCH);
  const response = await fetch(`${url}/rest/v1/location_submissions?on_conflict=place_key`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(batch),
  });
  if (!response.ok) throw new Error(`insert failed ${response.status}: ${await response.text()}`);
  written += batch.length;
  console.log(`written ${written}/${submissions.length}`);
}

console.log(`\ndone: ${written} ${PLAQUE_SOURCE_KIND} submissions`);
