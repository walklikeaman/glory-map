#!/usr/bin/env node
//
// Run the Location Resolution Engine (POST /api/resolve) over works from the shell.
//
//   node --env-file=.env.local scripts/resolve-works.mjs --source wikidata --limit 10
//   node --env-file=.env.local scripts/resolve-works.mjs --source wikidata
//   node --env-file=.env.local scripts/resolve-works.mjs --source any --unlinked --limit 10
//   node --env-file=.env.local scripts/resolve-works.mjs --wikidata Q23572,Q19798734
//
// `--source any` takes every source; `--unlinked` skips works that already have a place;
// `--wikidata` names the works outright (any source).
//
// The route resolves a work's own Wikidata filming locations (P915) into places, links
// and evidence, and only for a signed-in reader. A catalogue import has no reader, so
// this calls the very same handler with the service key and a fixed caller — one write
// path into the graph, not two. Batches of 20, the route's own limit. Re-running is
// safe: places and links upsert, evidence is inserted only where missing.

import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { createResolveHandler } from "../app/api/resolve/route.js";
import { parseQids, pickWorkIds } from "../app/lib/resolve-selection.mjs";
import { resolveWorkPlaces } from "../app/lib/location-resolver.mjs";
import { CONTACT_USER_AGENT } from "../app/lib/user-agent.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const SOURCE = arg("source");
const WIKIDATA = parseQids(arg("wikidata"));
const UNLINKED = argv.includes("--unlinked");
const LIMIT = Number(arg("limit", 0)) || null;
const BATCH = 20;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!SOURCE && !WIKIDATA.length) {
  console.error("Pass --source <works.source|any> or --wikidata Q1,Q2");
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function workIds() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let query = db.from("works").select("id, wikidata_id, source")
      .not("wikidata_id", "is", null).order("id").range(from, from + 999);
    if (WIKIDATA.length) query = query.in("wikidata_id", WIKIDATA);
    else if (SOURCE !== "any") query = query.eq("source", SOURCE);
    const { data, error } = await query;
    if (error) throw new Error(`works read failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  const linked = UNLINKED ? await linkedWorkIds() : new Set();
  return pickWorkIds(rows, { linked, limit: LIMIT });
}

async function linkedWorkIds() {
  const ids = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("work_place_links").select("work_id").order("id").range(from, from + 999);
    if (error) throw new Error(`links read failed: ${error.message}`);
    for (const row of data ?? []) ids.add(row.work_id);
    if ((data?.length ?? 0) < 1000) return ids;
  }
}

// Wikimedia answers a batch job's anonymous User-Agent with 429 and the one carrying the
// owner's contact with 200 (measured 07.11 from the cloud egress), so the batch says who
// it is — the policy asks exactly that of bulk clients.
// The resolver retries a 429 once after 750 ms, which suits a reader waiting on one film
// and not a batch job: here a refusal is waited out for as long as Wikimedia asks.
async function patientFetch(url, options, attempt = 1) {
  const response = await fetch(url, options);
  if (response.status !== 429 || attempt > 6) return response;
  const wait = (Number(response.headers.get("retry-after")) || 20) * 1000 * attempt;
  console.log(`  waiting ${wait / 1000}s (429)`);
  await sleep(wait);
  return patientFetch(url, options, attempt + 1);
}

const handle = createResolveHandler({
  fetchImpl: patientFetch,
  resolveUserId: async () => "catalogue-import",
  resolvePlaces: (works, options) => resolveWorkPlaces(works, { ...options, userAgent: CONTACT_USER_AGENT }),
});

async function main() {
  const ids = await workIds();
  console.log(`${ids.length} works (${WIKIDATA.length ? `wikidata ${WIKIDATA.join(",")}` : `source = '${SOURCE}'`}${UNLINKED ? ", no place yet" : ""})`);
  const totals = { places: 0, links: 0, evidence: 0, withPlaces: 0, failed: 0 };
  for (let index = 0; index < ids.length; index += BATCH) {
    const request = new Request("http://local/api/resolve", {
      method: "POST",
      body: JSON.stringify({ work_ids: ids.slice(index, index + BATCH) }),
    });
    const response = await handle(request);
    const body = await response.json();
    if (!response.ok) {
      totals.failed += 1;
      console.warn(`  batch ${index / BATCH + 1}: ${response.status} ${body.error}`);
    } else {
      totals.places += body.places_upserted;
      totals.links += body.links_upserted;
      totals.evidence += body.evidence_inserted;
      totals.withPlaces += body.resolved.length;
      console.log(`  ${Math.min(index + BATCH, ids.length)}/${ids.length}: +${body.places_upserted} places, +${body.links_upserted} links`);
    }
    await sleep(2000);
  }
  console.log(`${totals.withPlaces} works got places · ${totals.places} places · ${totals.links} links · ${totals.evidence} evidence · ${totals.failed} failed batches`);
}

main().catch((failure) => {
  console.error(failure.message);
  process.exit(1);
});
