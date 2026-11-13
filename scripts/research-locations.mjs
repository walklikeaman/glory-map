#!/usr/bin/env node
//
// Filming locations researched on the open web, for the most-watched works first.
//
//   node --env-file=.env.local scripts/research-locations.mjs --top 10 --dry-run
//   node --env-file=.env.local scripts/research-locations.mjs --top 80 --write --max-dollars 5
//   node --env-file=.env.local scripts/research-locations.mjs --wikidata Q2085,Q22661229 --write
//   node --env-file=.env.local scripts/research-locations.mjs --replay <run.json> --write
//
// The model (claude-haiku-5-5 with web search) reads fan sites, location
// blogs and wikis and returns places with the page that names each one. The rules for
// what it may return are in app/lib/web-research.mjs.
//
// What lands:
//   - a new name for the work → a `location_submissions` row, source_kind web_research,
//     pending. With a point it shows on the map as "Unconfirmed"; without one it waits.
//   - a name we already hold from another source → a `corroborated_by` entry on that
//     row, so the review can count a second, independent source for it.
// Then run corroborate-sources, review-submissions --write and promote-verified.
//
// Every work researched goes into a ledger under /mnt/project-files/glorymap-research/,
// so the nightly batch moves down the list instead of paying for the same work twice.
// `--dry-run` writes the run file and nothing else; `--replay` writes a run file's
// results without asking the model again.
//
// The key: ANTHROPIC_API_KEY, or GLORYMAP_ANTHROPIC_KEY in the cloud environment.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

import { createGeocoder } from "../app/lib/geocode-client.mjs";
import { parseQids } from "../app/lib/resolve-selection.mjs";
import {
  choosePoint, costOf, parseResearch, submissionRow, SOURCE_KIND, SYSTEM, userPrompt,
} from "../app/lib/web-research.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const TOP = Number(arg("top", 0)) || 0;
const OFFSET = Number(arg("offset", 0)) || 0;
const WIKIDATA = parseQids(arg("wikidata"));
const WORK_IDS = String(arg("work", "") || "").split(",").map((id) => id.trim()).filter(Boolean);
const REPLAY = arg("replay");
const MAX_DOLLARS = Number(arg("max-dollars", 5));
const CONCURRENCY = Number(arg("concurrency", 3)) || 3;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const DRY_RUN = argv.includes("--dry-run") || !argv.includes("--write");
const AGAIN = argv.includes("--again");
const DIR = arg("dir", "/mnt/project-files/glorymap-research/");
const LEDGER = path.join(DIR, "ledger.json");

if (!TOP && !WIKIDATA.length && !WORK_IDS.length && !REPLAY) {
  console.error("Pass --top N, --wikidata Q1,Q2, --work <uuid> or --replay <run.json>");
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const WORK_COLUMNS = "id, title, year, kind, imdb_id, wikidata_id";

function readLedger() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  } catch {
    return {};
  }
}

function writeLedger(ledger) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
}

async function selectWorks(ledger) {
  const works = [];
  if (WORK_IDS.length || WIKIDATA.length) {
    let query = db.from("works").select(WORK_COLUMNS);
    query = WORK_IDS.length ? query.in("id", WORK_IDS) : query.in("wikidata_id", WIKIDATA);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    works.push(...data);
  }
  if (TOP) {
    // Most IMDb votes first: the closest thing we hold to "what people have watched".
    for (let from = 0; works.length < TOP; from += 1000) {
      const { data, error } = await db.from("work_ratings")
        .select(`votes, works(${WORK_COLUMNS})`)
        .eq("source", "imdb").not("votes", "is", null)
        .order("votes", { ascending: false }).range(from, from + 999);
      if (error) throw new Error(error.message);
      const fresh = data.map((row) => row.works).filter((work) => work && (AGAIN || ledger[work.id]?.mode !== "write"));
      works.push(...fresh.slice(OFFSET && from === 0 ? OFFSET : 0));
      if (data.length < 1000) break;
    }
  }
  const seen = new Set();
  return works.filter((work) => !seen.has(work.id) && seen.add(work.id)).slice(0, TOP || undefined);
}

async function heldNames(workId) {
  const { data, error } = await db.from("location_submissions")
    .select("id, place_name, source_kind, corroborated_by").eq("work_id", workId).limit(2000);
  if (error) throw new Error(error.message);
  return data;
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.GLORYMAP_ANTHROPIC_KEY });
// Search only. web_fetch is refused for requests from a sandbox with restricted network
// access (the cloud sessions this runs in), and search results carry the page text the
// answer quotes from.
const TOOLS = [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }];

// One conversation per work. A server tool loop can stop with `pause_turn`; it is
// continued by sending the partial answer back as it is.
async function research(work, knownNames) {
  const messages = [{ role: "user", content: userPrompt(work, knownNames) }];
  let cost = 0;
  let response;
  for (let turn = 0; turn < 4; turn += 1) {
    response = await anthropic.messages.create({ model: MODEL, max_tokens: 16000, system: SYSTEM, tools: TOOLS, messages });
    cost += costOf(response.usage, MODEL);
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  return { text, cost, stop: response.stop_reason };
}

const geocode = createGeocoder({ onNote: (note) => console.log(`     ${note}`) });

async function placeAll(locations) {
  const cities = [...new Set(locations.map((l) => l.city).filter(Boolean))];
  const cityHits = await geocode(cities, { areas: new Map(locations.filter((l) => l.city).map((l) => [l.city, l.country])) });
  const placeHits = await geocode(locations.map((l) => l.place_name), {
    areas: new Map(locations.map((l) => [l.place_name, l.city || l.country])),
  });
  return locations.map((location) => choosePoint(location, {
    placeHit: placeHits.get(location.place_name)?.place ?? null,
    cityHit: location.city ? cityHits.get(location.city)?.place ?? null : null,
  }));
}

// A name held already (same work, same name, any case) is a confirmation of that row,
// not a new row: the unique key is (work_id, lower(trim(place_name))).
function split(locations, held) {
  const byKey = new Map(held.map((row) => [row.place_name.trim().toLowerCase(), row]));
  const fresh = [];
  const confirms = [];
  for (const location of locations) {
    const existing = byKey.get(location.place_name.trim().toLowerCase());
    if (!existing) fresh.push(location);
    else if (existing.source_kind !== SOURCE_KIND) confirms.push({ existing, location });
  }
  return { fresh, confirms };
}

async function writeWork(work, locations, points) {
  const held = await heldNames(work.id);
  const { fresh, confirms } = split(locations, held);
  const rows = fresh.map((location) => submissionRow(work, location, points[locations.indexOf(location)]));
  if (rows.length) {
    const { error } = await db.from("location_submissions")
      .upsert(rows, { onConflict: "work_id,place_key", ignoreDuplicates: true });
    if (error) throw new Error(`insert failed for ${work.title}: ${error.message}`);
  }
  for (const { existing, location } of confirms) {
    const entries = Array.isArray(existing.corroborated_by) ? existing.corroborated_by : [];
    if (entries.some((entry) => entry?.source_kind === SOURCE_KIND)) continue;
    const corroborated_by = [...entries, {
      source_kind: SOURCE_KIND, source_url: location.source_url, place_name: location.place_name, gave_coordinate: false,
    }];
    const { error } = await db.from("location_submissions").update({ corroborated_by }).eq("id", existing.id);
    if (error) throw new Error(`confirm failed for ${existing.place_name}: ${error.message}`);
  }
  return { inserted: rows.length, confirmed: confirms.length, placed: rows.filter((row) => row.lat !== undefined).length };
}

async function main() {
  const ledger = readLedger();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runPath = path.join(DIR, "runs", `${stamp}${DRY_RUN ? "-dry" : ""}.json`);
  fs.mkdirSync(path.dirname(runPath), { recursive: true });

  let results;
  if (REPLAY) {
    results = JSON.parse(fs.readFileSync(REPLAY, "utf8")).results;
    console.log(`replaying ${results.length} works from ${REPLAY}`);
  } else {
    const works = await selectWorks(ledger);
    console.log(`${works.length} works to research on ${MODEL}, stop at $${MAX_DOLLARS}`);
    results = [];
    let spent = 0;
    let next = 0;
    async function worker() {
      while (next < works.length && spent < MAX_DOLLARS) {
        const work = works[next++];
        const held = await heldNames(work.id);
        try {
          const { text, cost, stop } = await research(work, held.map((row) => row.place_name));
          spent += cost;
          const parsed = parseResearch(text);
          const points = parsed.ok ? await placeAll(parsed.locations) : [];
          results.push({ work, cost, stop, ...parsed, points });
          console.log(`  $${cost.toFixed(3)}  ${String(parsed.locations.length).padStart(2)} found  `
            + `${String(points.filter(Boolean).length).padStart(2)} placed  ${work.title} (${work.year ?? "?"})`
            + (parsed.ok ? "" : `  [${parsed.reason}]`));
        } catch (failure) {
          console.log(`  failed: ${work.title}: ${failure.message}`);
          if (failure.status === 401 || failure.status === 400) throw failure;
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log(`\nspent $${spent.toFixed(2)} on ${results.length} works`);
    fs.writeFileSync(runPath, JSON.stringify({ model: MODEL, at: stamp, spent, results }, null, 1));
    console.log(`run file: ${runPath}`);
  }

  const totals = { found: 0, placed: 0, inserted: 0, confirmed: 0 };
  for (const result of results) {
    totals.found += result.locations.length;
    totals.placed += result.points.filter(Boolean).length;
    let written = { inserted: 0, confirmed: 0 };
    if (!DRY_RUN) written = await writeWork(result.work, result.locations, result.points);
    totals.inserted += written.inserted;
    totals.confirmed += written.confirmed;
    ledger[result.work.id] = {
      title: result.work.title, at: new Date().toISOString(), mode: DRY_RUN ? "dry" : "write",
      found: result.locations.length, cost: result.cost ?? 0, ...written,
    };
  }
  writeLedger(ledger);
  console.log(`${totals.found} locations found, ${totals.placed} with a point`);
  console.log(DRY_RUN
    ? "dry run: nothing written to the database (pass --replay <run file> --write to store it)"
    : `${totals.inserted} new rows, ${totals.confirmed} existing rows confirmed by a second source`);
}

main().catch((failure) => {
  console.error(failure.message);
  process.exit(1);
});
