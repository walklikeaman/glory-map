import assert from "node:assert/strict";
import test from "node:test";

import { workPlacesAsLocations } from "../app/lib/work-locations.mjs";

const work = { id: "7fdfc23c-bb31-4e50-8586-b2ce0200c676", title: "Notting Hill", kind: "film", year: 1999, tmdb_id: "509", wikidata_id: "Q200672" };
const places = [
  { id: "p1", name: "The Coronet Theatre", lat: 51.5085, lng: -0.1981, sentence: "Notting Hill was filmed at the Coronet.", role_label: "Location unconfirmed", wikidata_id: "Q7" },
  { id: "p2", name: "Kenwood House", lat: 51.5714, lng: -0.1674 },
  { id: "p3", name: "Nowhere", lat: null, lng: null },
  { id: "p4", name: "Off the globe", lat: 123, lng: 0 },
];

test("a picked work lists its own places, never the nearby search", () => {
  const rows = workPlacesAsLocations(work, places);
  assert.deepEqual(rows.map((row) => row.place), ["The Coronet Theatre", "Kenwood House"]);
  assert.ok(rows.every((row) => row.film === "Notting Hill"));
});

test("a row carries what the list, the card and the route read", () => {
  const [row] = workPlacesAsLocations(work, places);
  assert.equal(row.id, "film-7fdfc23c-bb31-4e50-8586-b2ce0200c676-p1");
  assert.deepEqual(row.position, [51.5085, -0.1981]);
  assert.equal(row.description, "Notting Hill was filmed at the Coronet.");
  assert.equal(row.scene, "Location unconfirmed");
  assert.equal(row.year, 1999);
  assert.equal(row.display, "pin");
});

test("ids are unique per place, so the route can tell two stops apart", () => {
  const ids = workPlacesAsLocations(work, places).map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("no work, or no places, is an empty list", () => {
  assert.deepEqual(workPlacesAsLocations(null, places), []);
  assert.deepEqual(workPlacesAsLocations(work, null), []);
});

test("a row says it came from the picked work, so a nearby reload leaves its card open", () => {
  // 10.11: the card opened from this list shut as soon as the map panned to it, because
  // the nearby reload kept only the places in its own answer.
  assert.ok(workPlacesAsLocations(work, places).every((row) => row.fromPickedWork === true));
});
