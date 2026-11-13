import assert from "node:assert/strict";
import test from "node:test";

import {
  checkLocation,
  choosePoint,
  costOf,
  extractJson,
  parseResearch,
  submissionRow,
  userPrompt,
} from "../app/lib/web-research.mjs";

const good = {
  place_name: "Twin Peaks Sheriff's Station (DirtFish Rally School)",
  address: "7001 396th Dr SE",
  city: "Snoqualmie",
  country: "United States",
  lat: 47.5197,
  lng: -121.8563,
  scene: "Exterior of the sheriff's station.",
  source_url: "https://www.movie-locations.com/movies/t/Twin-Peaks.php",
  quote: "the sheriff's station is now DirtFish Rally School",
};

test("extractJson takes the last json fence, and falls back to the outer braces", () => {
  assert.deepEqual(extractJson('Here:\n```json\n{"a":1}\n```\nthen\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('Sure! {"locations":[]} done'), { locations: [] });
  assert.equal(extractJson("no json here"), null);
});

test("a location needs a real spot name and a source url", () => {
  assert.ok(checkLocation(good).location);
  assert.equal(checkLocation({ ...good, source_url: "" }).refused, "no_source_url");
  assert.equal(checkLocation({ ...good, source_url: "movie-locations.com" }).refused, "no_source_url");
  assert.equal(checkLocation({ ...good, place_name: "  " }).refused, "no_name");
  assert.equal(checkLocation({ ...good, scene: "", quote: "here" }).refused, "no_sentence");
  assert.equal(checkLocation({ ...good, place_name: "Snoqualmie" }).refused, "area_not_a_spot");
  assert.equal(checkLocation({ ...good, place_name: "City of Dubrovnik" }).refused, "area_not_a_spot");
});

test("impossible or null-island coordinates are dropped, not kept", () => {
  assert.equal(checkLocation({ ...good, lat: 0, lng: 0 }).location.lat, null);
  assert.equal(checkLocation({ ...good, lat: 147, lng: 3 }).location.lng, null);
  assert.equal(checkLocation({ ...good, lat: "47.5", lng: null }).location.lat, null);
  assert.equal(checkLocation({ ...good, lat: "47.5", lng: "-121.8" }).location.lat, 47.5);
});

test("parseResearch counts refusals and keeps one row per name", () => {
  const text = "```json\n" + JSON.stringify({
    locations: [good, { ...good, place_name: good.place_name.toUpperCase() }, { ...good, source_url: null }],
  }) + "\n```";
  const result = parseResearch(text);
  assert.equal(result.ok, true);
  assert.equal(result.locations.length, 1);
  assert.deepEqual(result.refused, { no_source_url: 1 });
  assert.equal(parseResearch("I could not find anything").ok, false);
});

test("the gazetteer point wins only inside the named city", () => {
  const location = checkLocation(good).location;
  const city = { lat: 47.528, lng: -121.825 };
  assert.equal(choosePoint(location, { placeHit: { lat: 47.52, lng: -121.85, wikidata_id: "Q1" }, cityHit: city }).reason, "gazetteer_place");
  // A homonym on another continent is refused; the model's own point near the city is kept.
  const far = choosePoint(location, { placeHit: { lat: 51.5, lng: -0.1, wikidata_id: "Q2" }, cityHit: city });
  assert.match(far.reason, /^model_point_within_\d+km_of_city$/);
});

test("the model's coordinate is never trusted on its own", () => {
  const location = checkLocation(good).location;
  assert.equal(choosePoint(location, {}), null);
  assert.equal(choosePoint(location, { cityHit: { lat: 40.7, lng: -74 } }), null);
  assert.equal(choosePoint({ ...location, lat: null, lng: null }, { cityHit: { lat: 47.5, lng: -121.8 } }), null);
});

test("a row lands as a web_research filming location with its link", () => {
  const location = checkLocation(good).location;
  const row = submissionRow({ id: "w1" }, location, null);
  assert.equal(row.source_kind, "web_research");
  assert.equal(row.relation_kind, "filming_location");
  assert.equal(row.source_title, "movie-locations.com");
  assert.equal(row.source_url, good.source_url);
  assert.equal(row.area_hint, "7001 396th Dr SE, Snoqualmie, United States");
  assert.equal(row.geocode_reason, "no_point_from_research");
  assert.equal(row.lat, undefined);
});

test("cost counts tokens and searches", () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 100_000, server_tool_use: { web_search_requests: 5 } };
  assert.equal(Number(costOf(usage, "claude-haiku-5-5").toFixed(4)), 0.2);
});

test("the prompt names the work and what we already hold", () => {
  const prompt = userPrompt({ title: "Twin Peaks", year: 1990, kind: "series", imdb_id: "tt0098936" }, ["Double R Diner"]);
  assert.match(prompt, /TV series "Twin Peaks" \(1990\) \[IMDb tt0098936\]/);
  assert.match(prompt, /Double R Diner/);
});
