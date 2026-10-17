import assert from "node:assert/strict";
import test from "node:test";

import { createArtworkEnrichHandler } from "../app/api/enrich/artwork/route.js";

const WORKS = [
  { id: "w-found", kind: "film", title: "Skyfall", wikidata_id: "Q4941", tmdb_id: null, poster_path: null },
  { id: "w-none", kind: "film", title: "No TMDB entry", wikidata_id: "Q1", tmdb_id: null, poster_path: null },
  { id: "w-gone", kind: "film", title: "Deleted on TMDB", wikidata_id: "Q2", tmdb_id: "999", poster_path: null },
  { id: "w-down", kind: "film", title: "TMDB having a bad day", wikidata_id: "Q3", tmdb_id: "998", poster_path: null },
];

function run() {
  const calls = { saved: [], checked: [] };
  const handler = createArtworkEnrichHandler({
    env: { ENRICH_TOKEN: "t", TMDB_API_KEY: "k" },
    createWriter: () => ({
      loadWorks: async () => WORKS,
      saveArtwork: async (rows) => { calls.saved.push(...rows); return rows.length; },
      markChecked: async (ids) => { calls.checked.push(...ids); },
    }),
    fetchImpl: async (url) => {
      const href = String(url);
      if (href.includes("wikidata")) {
        return { ok: true, json: async () => ({ entities: {
          Q4941: { claims: { P4947: [{ mainsnak: { datavalue: { value: "37724" } } }] } },
          Q1: { claims: {} },
        } }) };
      }
      if (href.includes("/movie/37724")) return { ok: true, json: async () => ({ poster_path: "/p.jpg" }) };
      if (href.includes("/movie/999")) return { ok: false, status: 404 };
      return { ok: false, status: 503 };
    },
    logError: () => {},
  });
  return { handler, calls };
}

test("a work looked up and not found on TMDB is stamped, so the next batch moves on", async () => {
  // 6,489 of 7,054 films and series lacked a tmdb_id on 18.10; without the stamp every
  // miss came back in every batch and a catalogue run stalled on them.
  const { handler, calls } = run();
  const response = await handler(new Request("http://x/api/enrich/artwork", {
    method: "POST", headers: { authorization: "Bearer t" },
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls.saved.map((row) => [row.id, row.tmdb_id]), [["w-found", "37724"]]);
  assert.deepEqual(calls.checked.sort(), ["w-gone", "w-none"]);
  assert.equal(body.not_on_tmdb, 2);
});

test("a TMDB outage is not an answer and leaves the work in the queue", async () => {
  const { handler, calls } = run();
  await handler(new Request("http://x/api/enrich/artwork", { method: "POST", headers: { authorization: "Bearer t" } }));
  assert.ok(!calls.checked.includes("w-down"));
});

test("a batch bigger than one Wikidata request is asked for in pieces", async () => {
  const many = Array.from({ length: 60 }, (unused, index) => ({
    id: `w${index}`, kind: "film", title: `Film ${index}`, wikidata_id: `Q${index + 10}`, tmdb_id: null, poster_path: null,
  }));
  const asked = [];
  const handler = createArtworkEnrichHandler({
    env: { ENRICH_TOKEN: "t", TMDB_API_KEY: "k" },
    createWriter: () => ({ loadWorks: async () => many, saveArtwork: async () => 0, markChecked: async () => {} }),
    fetchImpl: async (url) => {
      asked.push(new URL(String(url)).searchParams.get("ids").split("|").length);
      return { ok: true, json: async () => ({ entities: {} }) };
    },
    logError: () => {},
  });
  const response = await handler(new Request("http://x", { method: "POST", headers: { authorization: "Bearer t" } }));
  assert.equal(response.status, 200);
  assert.deepEqual(asked, [50, 10]);
});
