#!/usr/bin/env node
// English renderings for every non-Latin name and scene note the map shows.
//
//   ANTHROPIC_API_KEY=$GLORYMAP_ANTHROPIC_KEY ANTHROPIC_MODEL=claude-haiku-5-5 \
//     node scripts/translate-display-text.mjs --limit 10          # try 10, print them
//   ... --limit 10 --write                                         # and store them
//   ... --write                                                    # everything missing
//   ... --bbox 34.2,29.4,35.9,33.4                                  # only inside a box
//
// Reads the queue rows the map draws (location_submissions with a point, not rejected,
// not yet promoted) and the checked places, keeps the strings written in a non-Latin
// script that have no rendering yet, and asks Claude for English in batches. Writes go to
// `text_translations` with the service key; /api/map/points reads them. See
// app/lib/display-language.mjs for why this is done ahead of time and not per request.

import process from "node:process";
import { z } from "zod";

import { needsEnglish, servedNote, textKey } from "../app/lib/display-language.mjs";
import { createModelClient, parseStructured, TIERS } from "../app/lib/model-client.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

const WRITE = flag("--write");
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

// kind is what the model is told the string is; a name and a sentence want different care.
const wanted = new Map();
const want = (text, kind) => {
  if (needsEnglish(text) && !wanted.has(textKey(text))) wanted.set(textKey(text), { text, kind });
};
for (const row of queue.filter(inBox)) {
  want(row.place_name, "place name");
  want(servedNote(row.source_sentence), "scene note");
}
for (const row of places.filter(inBox)) want(row.name, "place name");

// Before the migration the table is missing; a dry run can still show what it would write.
const done = new Set((await readAll("text_translations?select=source_md5&order=source_md5.asc")
  .catch((error) => { if (WRITE) throw error; console.warn(`(${error.message.slice(0, 80)})`); return []; }))
  .map((row) => row.source_md5));
const todo = [...wanted.entries()].filter(([md5]) => !done.has(md5)).slice(0, LIMIT);
console.log(`${wanted.size} non-Latin strings in view, ${done.size} already rendered, ${todo.length} to do`);
if (todo.length === 0) process.exit(0);

// Haiku unless told otherwise: this is a rendering job, and the cost line below is priced for it.
const runtime = createModelClient(
  { ...process.env, ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5" },
  { tier: TIERS.CAREFUL },
);
if (runtime?.provider !== "anthropic") {
  console.error("Set ANTHROPIC_API_KEY (in the cloud: ANTHROPIC_API_KEY=$GLORYMAP_ANTHROPIC_KEY).");
  process.exit(1);
}

const INSTRUCTIONS = `You render text from a film-locations map into English for English-speaking visitors.

Each item is either a "place name" or a "scene note".

Place names: give the name an English-language map, guidebook or English Wikipedia uses (רחוב רוטשילד → "Rothschild Boulevard", יפו → "Jaffa", מלון המלך דוד → "King David Hotel", הכותל המערבי → "Western Wall"). Translate generic words (street, hotel, museum, beach, desert, kibbutz stays "Kibbutz"). Only transliterate when no English name exists. Keep it short: the name only, no explanation, no quotes.

Scene notes: translate faithfully and plainly into English, one or two sentences, keeping film titles and proper names as they are known in English. Do not add facts.

Return one entry per item, with the same id.`;

const Schema = z.object({
  items: z.array(z.object({ id: z.number().int(), english: z.string() })),
});

let tokensIn = 0;
let tokensOut = 0;
const rendered = [];
for (let start = 0; start < todo.length; start += BATCH) {
  const batch = todo.slice(start, start + BATCH);
  const input = JSON.stringify(batch.map(([, item], index) => ({ id: index, kind: item.kind, text: item.text })));
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
    rendered.push({ source_md5: entry[0], source: entry[1].text, english, method: `claude:${result.model}` });
  }
}

for (const row of rendered) console.log(`${row.source.slice(0, 60)}  →  ${row.english.slice(0, 90)}`);
const cost = (tokensIn * PRICE_IN + tokensOut * PRICE_OUT) / 1e6;
console.log(`${rendered.length} rendered, ${tokensIn} in / ${tokensOut} out tokens, about $${cost.toFixed(3)}`);

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
