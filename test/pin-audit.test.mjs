import assert from "node:assert/strict";
import test from "node:test";

import {
  areaHint,
  cityOfArea,
  fixUpdate,
  judgeAgainstNominatim,
  judgeAgainstWikidata,
  nameHead,
  precisionForResult,
} from "../app/lib/pin-audit.mjs";

// Live rows, 18.10.
const SHARD = { id: "s", name: "The Shard, London Bridge Street, London SE1", lat: 51.5081225771367,
  lng: -0.0762687888854998, geocode_precision: "none", wikidata_id: null };
const WHITEHALL = { id: "w", name: "Whitehall, Westminster, London", lat: 51.5075602496,
  lng: -0.127019330025, geocode_precision: "none" };
const VILLA = { id: "v", name: "Villa del Balbianello", wikidata_id: "Q1759446", lat: 45.9653201077365,
  lng: 9.20235263659674, geocode_precision: "point" };

test("a name's head is what comes before the address", () => {
  assert.equal(nameHead("The Shard, London Bridge Street, London SE1"), "The Shard");
  assert.equal(areaHint(WHITEHALL), "Westminster, London");
  assert.equal(areaHint({ name: "Cockburn Street", city: "Edinburgh" }), "Edinburgh");
});

test("a Q-id whose label matches and whose point is far away is the fix", () => {
  const verdict = judgeAgainstWikidata(VILLA,
    { label: "Villa del Balbianello", aliases: [], lat: 45.9655, lng: 9.2115 });
  assert.equal(verdict.verdict, "fix");
  assert.ok(verdict.metres > 150);
  assert.equal(verdict.source, "wikidata:Q1759446:P625");
  assert.equal(verdict.geocode_precision, "point");
});

test("a pin within 150 m of its Q-id is left alone", () => {
  assert.equal(judgeAgainstWikidata(VILLA,
    { label: "Villa del Balbianello", lat: 45.9660, lng: 9.2025 }).verdict, "ok");
});

test("a Q-id labelled as something else is a question, not a fix", () => {
  const verdict = judgeAgainstWikidata({ ...VILLA, name: "Glencoe" },
    { label: "Buachaille Etive Mòr", lat: 56.65, lng: -4.90 });
  assert.equal(verdict.verdict, "ambiguous");
  assert.match(verdict.reason, /labelled/);
});

test("a matching name on another continent is a wrong Q-id, not a correction", () => {
  const verdict = judgeAgainstWikidata({ ...VILLA, name: "Trinity Square", wikidata_id: "Q9" },
    { label: "Trinity Square", lat: 59.95, lng: 30.32 });
  assert.equal(verdict.verdict, "ambiguous");
});

test("an area's centroid is never 'corrected'", () => {
  assert.equal(judgeAgainstWikidata({ ...VILLA, name: "London", geocode_precision: "city" },
    { label: "London", lat: 51.5, lng: -0.12 }).verdict, "ok");
});

test("a pin already moved onto a footprint is listed, not overwritten", () => {
  const verdict = judgeAgainstWikidata({ ...VILLA, osm_building_id: "way/1" },
    { label: "Villa del Balbianello", lat: 45.9655, lng: 9.2115 });
  assert.equal(verdict.verdict, "ambiguous");
  assert.match(verdict.reason, /footprint/);
});

test("The Shard leaves the Tower of London", () => {
  const verdict = judgeAgainstNominatim(SHARD, [
    { name: "The Shard", lat: "51.5045", lon: "-0.0865", addresstype: "building", osm_type: "way", osm_id: 1 },
  ]);
  assert.equal(verdict.verdict, "fix");
  assert.equal(verdict.geocode_precision, "building");
  assert.equal(verdict.source, "nominatim:way/1");
});

test("a street is never moved onto one of its segments", () => {
  // Whitehall's pin sat on its north end; OSM answered with a segment 370 m south.
  const verdict = judgeAgainstNominatim(WHITEHALL, [
    { name: "Whitehall", lat: "51.5040", lon: "-0.1265", addresstype: "road", osm_type: "way", osm_id: 2 },
  ]);
  assert.equal(verdict.verdict, "ambiguous");
  assert.match(verdict.reason, /street/);
});

test("a geocoder answer under another name confirms nothing", () => {
  assert.equal(judgeAgainstNominatim(SHARD, [
    { name: "London Bridge Station", lat: "51.5050", lon: "-0.0860", addresstype: "railway" },
  ]).verdict, "unresolved");
});

test("two same-named answers far apart are a question", () => {
  const verdict = judgeAgainstNominatim({ name: "Station Road", lat: 51, lng: 0, geocode_precision: "none" }, [
    { name: "Station Road", lat: "51.02", lon: "0.0", addresstype: "road" },
    { name: "Station Road", lat: "51.10", lon: "0.1", addresstype: "road" },
  ]);
  assert.equal(verdict.verdict, "ambiguous");
});

test("a village answer is graded as an area", () => {
  assert.equal(precisionForResult({ addresstype: "village" }), "city");
  assert.equal(precisionForResult({ addresstype: "road" }), "street");
  assert.equal(precisionForResult({ addresstype: "tourism" }), "point");
});

test("the replaced coordinate is kept, and an earlier original is not overwritten", () => {
  const fix = { lat: 1, lng: 2, geocode_precision: "point" };
  assert.deepEqual(fixUpdate({ lat: 5, lng: 6 }, fix),
    { lat: 1, lng: 2, geocode_precision: "point", pre_snap_lat: 5, pre_snap_lng: 6 });
  assert.deepEqual(fixUpdate({ lat: 5, lng: 6, pre_snap_lat: 7, pre_snap_lng: 8 }, fix).pre_snap_lat, 7);
});

test("a common name looked up with no area is never moved", () => {
  // First full run: "The Old Mitre" would have moved 40 km to another pub.
  const verdict = judgeAgainstNominatim({ name: "The Old Mitre", lat: 51.5182, lng: -0.1076, geocode_precision: "none" },
    [{ name: "The Old Mitre", lat: "51.75", lon: "-0.33", addresstype: "amenity" }], { hinted: false });
  assert.equal(verdict.verdict, "ambiguous");
});

test("a move of more than 5 km goes to a person", () => {
  const verdict = judgeAgainstNominatim({ name: "Ham House", lat: 51.5072, lng: -0.1276, geocode_precision: "none" },
    [{ name: "Ham House", lat: "51.4447", lon: "-0.3122", addresstype: "historic" }]);
  assert.equal(verdict.verdict, "ambiguous");
  assert.match(verdict.reason, /km move/);
});

test("a postcode is taken off the area", () => {
  assert.equal(cityOfArea("London Bridge Street, London SE1"), "London");
  assert.equal(cityOfArea("Strand, London WC2R 0RN"), "London");
  assert.equal(cityOfArea("Vienna, Austria"), "Austria");
});

test("a bus stop named after a hotel is not the hotel", () => {
  // First review: "Dorchester Hotel" was about to move onto the bus stop of that name.
  assert.equal(judgeAgainstNominatim({ name: "Dorchester Hotel, Park Lane, London", lat: 51.48, lng: -0.15, geocode_precision: "none" },
    [{ name: "Dorchester Hotel", lat: "51.5072", lon: "-0.1522", type: "bus_stop", addresstype: "highway" }]).verdict, "unresolved");
});

test("a name one word longer is a different thing", () => {
  assert.equal(judgeAgainstNominatim({ name: "Alabama Hills, Lone Pine, California", lat: 36.6, lng: -118.1, geocode_precision: "none" },
    [{ name: "Alabama Hills Trail", lat: "36.61", lon: "-118.12", type: "path", addresstype: "road" }]).verdict, "unresolved");
});

test("a station is the place when the source named a station", () => {
  assert.equal(judgeAgainstNominatim({ name: "Union Station, Front Street, Toronto", lat: 43.64, lng: -79.39, geocode_precision: "none" },
    [{ name: "Union Station", lat: "43.6453", lon: "-79.3806", type: "station", addresstype: "railway" }]).verdict, "fix");
});
