import assert from "node:assert/strict";
import test from "node:test";

import { mergeNearby, ownNearbyBox, ownRowsToLocations, settleWithin } from "../app/lib/nearby-own.mjs";

const row = (over = {}) => ({
  id: 7, place_name: "Primrose Hill", area_hint: null, lat: 51.5395, lng: -0.1608,
  source_url: "https://example.com", source_sentence: "", source_kind: "moviemaps", status: "pending",
  works: { id: "w1", wikidata_id: "Q42", title: "Paddington 2", year: 2017, kind: "film" },
  ...over,
});

test("queue rows become unconfirmed nearby places grouped under the work's Wikidata id", () => {
  const [place] = ownRowsToLocations([row()]);
  assert.equal(place.work_wikidata_id, "Q42");
  assert.equal(place.work_title, "Paddington 2");
  assert.equal(place.kind, "film");
  assert.equal(place.relation_kind, "candidate");
  assert.equal(place.relation_label, "Unconfirmed");
  assert.equal(place.loc_source_id, "submission:7");
});

test("a work with no Wikidata id keeps its own id, and the kind filter applies", () => {
  const rows = [row({ works: { id: "w2", wikidata_id: null, title: "Local Show", kind: "series" } })];
  assert.equal(ownRowsToLocations(rows)[0].work_wikidata_id, "work:w2");
  assert.deepEqual(ownRowsToLocations(rows, { kind: "film" }), []);
  assert.deepEqual(ownRowsToLocations([row({ works: null }), row({ lat: null })]), []);
});

test("our row for a place Wikidata already gave is dropped; a new one is added after", () => {
  const wikidata = [{ loc_name: "Primrose Hill", lat: 51.5396, lng: -0.1607, work_wikidata_id: "Q42" }];
  const own = ownRowsToLocations([row(), row({ id: 8, place_name: "Portobello Road", lat: 51.515, lng: -0.205 })]);
  const merged = mergeNearby(wikidata, own);
  assert.deepEqual(merged.map((place) => place.loc_name), ["Primrose Hill", "Portobello Road"]);
  assert.equal(mergeNearby(null, own).length, 2);
});

test("the box is the circle's square", () => {
  const box = ownNearbyBox({ lat: 51.5, lng: -0.12, radius: 11.132 });
  assert.ok(Math.abs(box.north - 51.6) < 1e-9 && Math.abs(box.south - 51.4) < 1e-9);
  assert.ok(box.east > -0.12 && box.west < -0.12);
});

test("settleWithin answers with the value, the error, or a timeout, and waits forever on Infinity", async () => {
  assert.deepEqual(await settleWithin(Promise.resolve(3), 50), { value: 3 });
  const failed = await settleWithin(Promise.reject(new Error("504")), 50);
  assert.equal(failed.error.message, "504");
  assert.deepEqual(await settleWithin(new Promise(() => {}), 10), { timedOut: true });
  const late = new Promise((resolve) => setTimeout(() => resolve("late"), 30));
  assert.deepEqual(await settleWithin(late, Infinity), { value: "late" });
});
