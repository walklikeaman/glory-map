import assert from "node:assert/strict";
import test from "node:test";

import { boundsOfPositions, workCandidatesAsLocations, workPlacesAsLocations } from "../app/lib/work-locations.mjs";

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

const twinPeaks = { id: "tp", title: "Twin Peaks", kind: "series", year: 1990, wikidata_id: "Q2085" };
const candidates = [
  { id: "c1", name: "Bronson Canyon", lat: 34.124, lng: -118.314, sentence: "Appears as \"Owl Cave\".", role_label: "MovieMaps", source_url: "https://moviemaps.org/locations/5c3", precision: "Source checked", mappable: true },
  { id: "c2", name: "Snoqualmie Falls", lat: "47.5417", lng: "-121.8377", role_label: "Fandom", studio_lot: "Warner Bros." },
  { id: "c3", name: "Somewhere in Washington", lat: 47.5, lng: -120.5, mappable: false },
  { id: "c4", name: "No coordinate", lat: null, lng: null },
  { id: "c5", name: "Null Island", lat: 0, lng: 0 },
];

test("a picked work's unconfirmed rows become hollow, sourced map rows", () => {
  const rows = workCandidatesAsLocations(twinPeaks, candidates);
  assert.deepEqual(rows.map((row) => row.place), ["Bronson Canyon", "Snoqualmie Falls"]);
  const [first, second] = rows;
  assert.equal(first.isCandidate, true);
  assert.equal(first.evidenceSource, "queue");
  assert.equal(first.sourceTitle, "MovieMaps");
  assert.equal(first.sourceUrl, "https://moviemaps.org/locations/5c3");
  assert.equal(first.fromPickedWork, true);
  assert.deepEqual(second.position, [47.5417, -121.8377]);
  assert.equal(second.studioLot, true);
  // Never the same id as a confirmed place of the same work.
  assert.notEqual(first.id, workPlacesAsLocations(twinPeaks, [{ id: "c1", name: "x", lat: 1, lng: 1 }])[0].id);
});

test("no work, no candidates", () => {
  assert.deepEqual(workCandidatesAsLocations(null, candidates), []);
  assert.deepEqual(workCandidatesAsLocations(twinPeaks, null), []);
});

test("the bounds of a work's places are west-south / east-north", () => {
  assert.deepEqual(
    boundsOfPositions([[34.1, -118.3], [47.5, -121.8], [null, 1]]),
    [[-121.8, 34.1], [-118.3, 47.5]],
  );
  assert.equal(boundsOfPositions([]), null);
  assert.equal(boundsOfPositions(undefined), null);
});

test("the frame leaves the farthest tenth out, never a small film's second city", async () => {
  const { boundsOfPositions: bounds } = await import("../app/lib/work-locations.mjs");
  const washington = Array.from({ length: 30 }, (_, i) => [47.5 + i * 0.001, -121.8]);
  const la = Array.from({ length: 15 }, (_, i) => [34.1 + i * 0.001, -118.3]);
  const [[west, south], [east, north]] = bounds([...washington, ...la, [42.64, -73.54]]);
  assert.ok(east < -100, "the lone New York pin does not stretch the frame across the country");
  assert.ok(south < 34.2 && north > 47.5 && west <= -121.8);
  // Two places, two cities: both framed.
  const two = bounds([[51.5, -0.1], [48.85, 2.35]]);
  assert.deepEqual(two, [[-0.1, 48.85], [2.35, 51.5]]);
});

test("the map's padding steps around the panel, on a desktop and on a phone", async () => {
  const { paddingForCovers } = await import("../app/lib/work-locations.mjs");
  const desktop = paddingForCovers([
    { left: 24, right: 434, top: 24, bottom: 803, width: 410, height: 779 }, // panel
    { left: 446, right: 524, top: 24, bottom: 314, width: 78, height: 290 }, // rail
  ], { width: 1280, height: 900 });
  assert.equal(desktop.left, 548);
  assert.equal(desktop.bottom, 48);
  const phone = paddingForCovers([
    { left: 0, right: 390, top: 718, bottom: 782, width: 390, height: 64 }, // sheet handle
    { left: 0, right: 390, top: 782, bottom: 844, width: 390, height: 62 }, // tab bar
    { left: 12, right: 326, top: 12, bottom: 58, width: 314, height: 46 }, // search button
  ], { width: 390, height: 844 });
  assert.equal(phone.left, 48);
  assert.equal(phone.bottom, 844 - 718 + 16);
  assert.equal(phone.top, 74);
});

test("an unconfirmed row that repeats a confirmed place is not drawn twice", () => {
  const rows = workCandidatesAsLocations(twinPeaks, [
    { id: "d1", name: "Ennis House", lat: 30, lng: -100 },          // same name
    { id: "d2", name: "Ennis House gate", lat: 34.11612, lng: -118.29281 }, // same spot
    { id: "d3", name: "Bronson Canyon", lat: 34.124, lng: -118.314 },
  ], { confirmed: [{ name: "ennis  house", lat: 34.116111, lng: -118.292777 }] });
  assert.deepEqual(rows.map((row) => row.place), ["Bronson Canyon"]);
});

test("a verified queue row is solid, and a studio lot's access note is not named as the source", () => {
  const [verified, lot] = workCandidatesAsLocations(twinPeaks, [
    { id: "v", name: "Double R", lat: 47.49, lng: -121.79, status: "verified", role_label: "MovieMaps" },
    { id: "l", name: "Stage 4", lat: 34.15, lng: -118.34, status: "pending", role_label: "A working lot — no public access.", studio_lot: { slug: "wb" } },
  ]);
  assert.equal(verified.isCandidate, false);
  assert.equal(lot.isCandidate, true);
  assert.equal(lot.sourceTitle, null);
  assert.equal(lot.precision, "unknown");
});
