import assert from "node:assert/strict";
import test from "node:test";

import { bareName, chooseResult, geocodePatch, queriesFor } from "../app/lib/nominatim.mjs";

test("an address is asked on its own first, the name only with the area", () => {
  assert.deepEqual(queriesFor({
    place_name: "Jesse Pinkman's house",
    area_hint: "322 16th Street SW, Albuquerque, United States",
  }), [
    "322 16th Street SW, Albuquerque, United States",
    "Jesse Pinkman's house, Albuquerque, United States",
  ]);
  assert.deepEqual(queriesFor({ place_name: "Pile Gate (King's Landing)", area_hint: "Dubrovnik, Croatia" }), [
    "Pile Gate, Dubrovnik, Croatia",
  ]);
  assert.deepEqual(queriesFor({ place_name: "x", area_hint: "" }), []);
  assert.equal(bareName("Twisters (Los Pollos Hermanos exterior)"), "Twisters");
});

const house = { lat: "35.0875", lon: "-106.6656", addresstype: "building", osm_type: "way", osm_id: 1 };

test("a spot is kept, an area is refused", () => {
  assert.equal(chooseResult([house]).point.sourceId, "way/1");
  assert.equal(chooseResult([{ lat: "35.08", lon: "-106.65", addresstype: "city" }]).refused, "area_not_a_spot");
  assert.equal(chooseResult([]).refused, "no_result");
});

test("results far apart mean a homonym, and nothing is chosen", () => {
  assert.equal(chooseResult([house, { ...house, lat: "40.7", lon: "-74" }]).refused, "results_disagree");
  assert.ok(chooseResult([house, { ...house, lat: "35.09" }]).point);
});

test("the patch names its source and licence", () => {
  const patch = geocodePatch(chooseResult([house]).point, 0);
  assert.equal(patch.geocode_source, "nominatim");
  assert.equal(patch.geocode_license, "ODbL-1.0");
  assert.equal(patch.geocode_reason, "nominatim_first_query_building");
});
