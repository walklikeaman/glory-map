import assert from "node:assert/strict";
import test from "node:test";

import { createResolveHandler } from "../app/api/resolve/route.js";

const WORK_ID = "11111111-1111-1111-1111-111111111111";
const WORK_ID_2 = "22222222-2222-2222-2222-222222222222";

// A plan as location-resolver would produce it: one real place, one fictional.
function samplePlan() {
  return {
    places: [
      {
        wikidata_id: "Q100", name: "Bradbury Building", lat: 34.05, lng: -118.25,
        place_class: "real_exterior", geocode_precision: "point", shot_on_set: false,
        confidence: 0.9, confidence_band: "verified", resolver_version: "wikidata-stage0.1",
      },
      {
        wikidata_id: "Q200", name: "Hogwarts", lat: null, lng: null,
        place_class: "fictional", geocode_precision: "none", shot_on_set: false,
        confidence: 0.9, confidence_band: "verified", resolver_version: "wikidata-stage0.1",
      },
    ],
    links: [
      { workKey: WORK_ID, place_wikidata_id: "Q100", relation_kind: "filming_location", confidence: 0.9 },
      { workKey: WORK_ID, place_wikidata_id: "Q200", relation_kind: "filming_location", confidence: 0.9 },
    ],
    evidence: [
      { subject_type: "place", subject_ref: "Q100", method: "wikidata_statement", source_url: "u", source_ref: "Q100", agrees: true },
      { subject_type: "link", subject_ref: `${WORK_ID}|Q100|filming_location`, method: "wikidata_statement", source_url: "u", source_ref: "Q1/P915/Q100", agrees: true },
      { subject_type: "place", subject_ref: "Q200", method: "wikidata_statement", source_url: "u", source_ref: "Q200", agrees: true },
      { subject_type: "link", subject_ref: `${WORK_ID}|Q200|filming_location`, method: "wikidata_statement", source_url: "u", source_ref: "Q1/P915/Q200", agrees: true },
    ],
    flags: [],
    skipped: [],
  };
}

function recordingWriter({ existingEvidence = [] } = {}) {
  const calls = { works: null, places: null, links: null, evidence: null };
  return {
    calls,
    loadWorks: async (ids) => {
      calls.works = ids;
      return ids.map((id) => ({ id, kind: "film", wikidata_id: "Q1" }));
    },
    upsertPlaces: async (rows) => {
      calls.places = rows;
      return rows.map((row) => ({ id: `place-${row.wikidata_id}`, wikidata_id: row.wikidata_id }));
    },
    // Stands in for the write_resolved_links RPC: link + its evidence in one call, and
    // evidence already stored for the link (same method and source) is not counted again.
    writeLinks: async (rows) => {
      calls.links = rows;
      return rows.map((row, i) => ({
        id: `link-${i}`,
        work_id: row.work_id,
        place_id: row.place_id,
        relation_kind: row.relation_kind,
        evidence_inserted: row.evidence.filter((e) => !existingEvidence.some((x) =>
          x.subject_type === "link" && x.subject_id === `link-${i}`
          && x.method === e.method && x.source_ref === e.source_ref)).length,
      }));
    },
    loadEvidence: async () => existingEvidence,
    insertEvidence: async (rows) => { calls.evidence = rows; },
  };
}

function resolveRequest(body) {
  return new Request("http://localhost/api/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function handlerWith(overrides = {}) {
  return createResolveHandler({
    env: {},
    fetchImpl: async () => { throw new Error("no network in tests"); },
    resolveUserId: overrides.resolveUserId ?? (async () => "user-1"),
    createWriter: overrides.createWriter ?? (() => overrides.writer ?? recordingWriter()),
    resolvePlaces: overrides.resolvePlaces ?? (async () => ({ plan: samplePlan() })),
    logError: () => {},
  });
}

test("resolve rejects a malformed or oversized batch before any work", async () => {
  const handler = handlerWith();
  for (const body of [undefined, {}, { work_ids: [] }, { work_ids: ["nope"] }]) {
    assert.equal((await handler(resolveRequest(body))).status, 400);
  }
  const tooMany = { work_ids: Array.from({ length: 21 }, (_, i) => `${i}`.padStart(8, "0") + "-1111-1111-1111-111111111111") };
  assert.equal((await handler(resolveRequest(tooMany))).status, 400);
});

test("resolve requires an authenticated user", async () => {
  const handler = handlerWith({ resolveUserId: async () => null });
  assert.equal((await handler(resolveRequest({ work_ids: [WORK_ID] }))).status, 401);
});

test("resolve returns 503 when the writer is not configured", async () => {
  const handler = handlerWith({ createWriter: () => null });
  assert.equal((await handler(resolveRequest({ work_ids: [WORK_ID] }))).status, 503);
});

test("resolve write-through persists places, links and evidence at both grains", async () => {
  const writer = recordingWriter();
  const handler = handlerWith({ writer });
  const response = await handler(resolveRequest({ work_ids: [WORK_ID] }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.places_upserted, 2);
  assert.equal(body.links_upserted, 2);
  assert.equal(body.evidence_inserted, 4);

  // Fiction is persisted with no coordinate — the never-invent invariant.
  const fiction = writer.calls.places.find((p) => p.wikidata_id === "Q200");
  assert.equal(fiction.place_class, "fictional");
  assert.equal(fiction.lat, null);

  // Place evidence carries a real uuid subject and is written on its own.
  assert.deepEqual([...new Set(writer.calls.evidence.map((e) => e.subject_type))], ["place"]);
  assert.ok(writer.calls.evidence.every((e) => typeof e.subject_id === "string" && e.subject_id.length > 0));
  assert.ok(writer.calls.evidence.every((e) => !("subject_ref" in e)));

  // A link travels WITH its evidence. The link trigger is checked at commit and every
  // PostgREST request commits, so a link sent without its evidence in the same call was
  // refused — every batch, 05.08 to 07.11.2026.
  assert.deepEqual(writer.calls.links[0], {
    work_id: WORK_ID, place_id: "place-Q100", relation_kind: "filming_location", confidence: 0.9,
    evidence: [{ method: "wikidata_statement", source_url: "u", source_ref: "Q1/P915/Q100", agrees: true }],
  });
  assert.deepEqual(body.resolved[0].places.map((p) => p.wikidata_id), ["Q100", "Q200"]);
});

test("re-running resolve inserts no duplicate evidence", async () => {
  // Second run: the ledger already holds every row, keyed by subject+method+source_ref.
  const existingEvidence = [
    { subject_type: "place", subject_id: "place-Q100", method: "wikidata_statement", source_ref: "Q100" },
    { subject_type: "link", subject_id: "link-0", method: "wikidata_statement", source_ref: "Q1/P915/Q100" },
    { subject_type: "place", subject_id: "place-Q200", method: "wikidata_statement", source_ref: "Q200" },
    { subject_type: "link", subject_id: "link-1", method: "wikidata_statement", source_ref: "Q1/P915/Q200" },
  ];
  const writer = recordingWriter({ existingEvidence });
  const handler = handlerWith({ writer });
  const body = await (await handler(resolveRequest({ work_ids: [WORK_ID] }))).json();

  assert.equal(body.evidence_inserted, 0);
  assert.equal(writer.calls.evidence, null); // insert never called
  assert.equal(body.places_upserted, 2); // upserts still converge
});

test("resolve reports skipped works without writing anything", async () => {
  const writer = recordingWriter();
  const handler = handlerWith({
    writer,
    resolvePlaces: async () => ({
      plan: { places: [], links: [], evidence: [], flags: [], skipped: [{ workKey: WORK_ID, reason: "no_locations" }] },
    }),
  });
  const body = await (await handler(resolveRequest({ work_ids: [WORK_ID] }))).json();

  assert.deepEqual(body.skipped, [{ workKey: WORK_ID, reason: "no_locations" }]);
  assert.equal(body.places_upserted, 0);
  assert.equal(writer.calls.places, null);
});

test("resolve returns empty when no requested work exists", async () => {
  const writer = recordingWriter();
  writer.loadWorks = async () => [];
  const handler = handlerWith({ writer });
  const body = await (await handler(resolveRequest({ work_ids: [WORK_ID, WORK_ID_2] }))).json();
  assert.deepEqual(body.resolved, []);
  assert.equal(body.places_upserted, 0);
});

test("resolve maps a database failure to 502", async () => {
  const writer = recordingWriter();
  writer.upsertPlaces = async () => { throw new Error("db down"); };
  const handler = handlerWith({ writer });
  assert.equal((await handler(resolveRequest({ work_ids: [WORK_ID] }))).status, 502);
});

test("resolve never writes evidence whose subject was not persisted", async () => {
  const writer = recordingWriter();
  // The place upsert silently returns only one of the two rows.
  writer.upsertPlaces = async (rows) => [{ id: "place-Q100", wikidata_id: rows[0].wikidata_id }];
  const handler = handlerWith({ writer });
  const body = await (await handler(resolveRequest({ work_ids: [WORK_ID] }))).json();

  assert.equal(writer.calls.links.length, 1); // the Q200 link is dropped
  assert.ok(writer.calls.evidence.every((e) => e.subject_id === "place-Q100"));
  assert.equal(body.evidence_inserted, 2);
});
