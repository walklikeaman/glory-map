#!/usr/bin/env node
// English for every non-Latin place name (and, on request, scene note) the map shows.
//
//   node scripts/translate-display-text.mjs --limit 10            # try 10 names, print them
//   ... --write                                                    # every missing name, stored
//   ... --bbox 34.2,29.4,35.9,33.4                                  # only inside a box
//   ANTHROPIC_API_KEY=$GLORYMAP_ANTHROPIC_KEY ... --notes --write   # also translate notes
//
// Names are never translated: each is looked up on Wikidata in its own language, near its
// pin, and the entity's English label is stored (free, no model). A name Wikidata does not
// know stays in its own script. Scene notes have no canonical English, so they are only
// rendered by Claude when --notes is passed. Reads the queue rows the map draws and the
// checked places; writes `text_translations` with the service key; /api/map/points reads
// them. See app/lib/display-language.mjs.

import process from "node:process";
import { z } from "zod";

import {
  englishNameFromWikidata, needsEnglish, searchLanguage, servedNote, textKey,
} from "../app/lib/display-language.mjs";
import { CONTACT_USER_AGENT } from "../app/lib/user-agent.mjs";
import { createModelClient, parseStructured, TIERS } from "../app/lib/model-client.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

const WRITE = flag("--write");
const NOTES = flag("--notes");
const LIMIT = option("--limit") ? Number(option("--limit")) : Infinity;
const BBOX = option("--bbox")?.split(",").map(Number) ?? null;
const BATCH = 25;
// Haiku list price, per million tokens. Only for the report at the end.
const PRICE_IN = 1;
const PRICE_OUT = 5;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };

async function readAll(path) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${url}/rest/v1/${path}&limit=1000&offset=${offset}`, { headers });
    if (!response.ok) throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`${path}: not a list`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function inBox(row) {
  if (!BBOX) return true;
  const [west, south, east, north] = BBOX;
  return row.lat >= south && row.lat <= north && row.lng >= west && row.lng <= east;
}

const queue = await readAll(
  "location_submissions?select=place_name,source_sentence,lat,lng"
  + "&lat=not.is.null&place_id=is.null&status=neq.rejected&order=id.asc",
);
const places = await readAll("places?select=name,lat,lng&order=id.asc");

// A name keeps the first pin it was seen at, which is where Wikidata must agree it is.
const wanted = new Map();
const want = (text, kind, row) => {
  if (needsEnglish(text) && !wanted.has(textKey(text))) {
    wanted.set(textKey(text), { text, kind, at: { lat: row.lat, lng: row.lng } });
  }
};
for (const row of queue.filter(inBox)) {
  want(row.place_name, "place name", row);
  if (NOTES) want(servedNote(row.source_sentence), "scene note", row);
}
for (const row of places.filter(inBox)) want(row.name, "place name", row);

// Before the migration the table is missing; a dry run can still show what it would write.
const done = new Set((await readAll("text_translations?select=source_md5&order=source_md5.asc")
  .catch((error) => { if (WRITE) throw error; console.warn(`(${error.message.slice(0, 80)})`); return []; }))
  .map((row) => row.source_md5));
const todo = [...wanted.entries()].filter(([md5]) => !done.has(md5)).slice(0, LIMIT);
console.log(`${wanted.size} non-Latin strings in view, ${done.size} already rendered, ${todo.length} to do`);
if (todo.length === 0) process.exit(0);

const rendered = [];

// --- Names: Wikidata's English label, never a translation ---------------------------
async function wikidata(params) {
  const response = await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ ...params, format: "json" })}`, {
    headers: { "User-Agent": CONTACT_USER_AGENT },
  });
  if (!response.ok) throw new Error(`wikidata ${response.status}`);
  return response.json();
}

let unmatched = 0;
for (const [md5, item] of todo.filter(([, entry]) => entry.kind === "place name")) {
  const lang = searchLanguage(item.text);
  const search = await wikidata({ action: "wbsearchentities", search: item.text, language: lang, uselang: "en", limit: 7 });
  const hits = search.search ?? [];
  const entities = hits.length
    ? (await wikidata({
      action: "wbgetentities", ids: hits.map((hit) => hit.id).join("|"),
      props: "labels|claims", languages: `${lang}|en`,
    })).entities
    : {};
  const found = englishNameFromWikidata(item.text, item.at, hits, entities);
  if (!found) { unmatched += 1; console.log(`${item.text}  →  (no match, stays as is)`); continue; }
  rendered.push({ source_md5: md5, source: item.text, english: found.english, source_lang: lang, method: `wikidata:${found.id}` });
}
console.log(`names: ${rendered.length} matched on Wikidata, ${unmatched} left in their own script`);

// --- Notes: only when asked, by Claude ----------------------------------------------
const notes = todo.filter(([, entry]) => entry.kind === "scene note");
// Haiku unless told otherwise: this is a rendering job, and the cost line below is priced for it.
const runtime = notes.length === 0 ? null : createModelClient(
  { ...process.env, ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5" },
  { tier: TIERS.CAREFUL },
);
if (notes.length > 0 && runtime?.provider !== "anthropic") {
  console.error("Set ANTHROPIC_API_KEY (in the cloud: ANTHROPIC_API_KEY=$GLORYMAP_ANTHROPIC_KEY).");
  process.exit(1);
}

const INSTRUCTIONS = `You translate scene notes from a film-locations map into English for English-speaking visitors: faithfully and plainly, one or two sentences, keeping film titles and place names as they are known in English. Do not add facts. Return one entry per item, with the same id.`;

const Schema = z.object({
  items: z.array(z.object({ id: z.number().int(), english: z.string() })),
});

let tokensIn = 0;
let tokensOut = 0;
for (let start = 0; start < notes.length; start += BATCH) {
  const batch = notes.slice(start, start + BATCH);
  const input = JSON.stringify(batch.map(([, item], index) => ({ id: index, text: item.text })));
  const result = await parseStructured({ runtime, schema: Schema, schemaName: "renderings", instructions: INSTRUCTIONS, input });
  if (!result.ok) {
    console.error(`batch at ${start} failed: ${result.reason} ${result.detail ?? ""}`);
    continue;
  }
  tokensIn += result.usage?.input_tokens ?? 0;
  tokensOut += result.usage?.output_tokens ?? 0;
  for (const item of result.parsed.items) {
    const entry = batch[item.id];
    const english = item.english.trim();
    // A repeated id would put one key twice into the upsert, and Postgres refuses the batch.
    if (!entry || !english || needsEnglish(english) || rendered.some((row) => row.source_md5 === entry[0])) continue;
    rendered.push({ source_md5: entry[0], source: entry[1].text, english, source_lang: searchLanguage(entry[1].text), method: `claude:${result.model}` });
  }
}

for (const row of rendered) console.log(`${row.source.slice(0, 60)}  →  ${row.english.slice(0, 90)}`);
const cost = (tokensIn * PRICE_IN + tokensOut * PRICE_OUT) / 1e6;
console.log(`${rendered.length} rendered${notes.length ? `, notes cost ${tokensIn} in / ${tokensOut} out tokens, about $${cost.toFixed(3)}` : ""}`);

if (!WRITE) {
  console.log("Dry run: nothing written. Add --write to store them.");
  process.exit(0);
}
for (let i = 0; i < rendered.length; i += 200) {
  const response = await fetch(`${url}/rest/v1/text_translations?on_conflict=source_md5`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rendered.slice(i, i + 200)),
  });
  if (!response.ok) throw new Error(`write failed: ${response.status} ${await response.text()}`);
}
console.log(`${rendered.length} written to text_translations`);
