#!/usr/bin/env node
// Classify the galleries of films that have none yet (#107), in this process, through the
// same handler /api/enrich/stills serves.
//
//   node --env-file=.env.local scripts/classify-stills.mjs --limit 10
//   node --env-file=.env.local scripts/classify-stills.mjs --work <uuid>
//
// Costs money: one vision call per 12 images, up to 48 images a film. With
// ANTHROPIC_API_KEY set it runs on Claude (ANTHROPIC_VISION_MODEL, else ANTHROPIC_MODEL)
// and ends with what the run cost, measured from the API's usage counts.

import process from "node:process";

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

let left = workId ? 1 : limit;
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
