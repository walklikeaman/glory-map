import assert from "node:assert/strict";
import test from "node:test";

import { createCitySuggestHandler } from "../app/api/cities/suggest/route.js";
import {
  buildCitySuggestQuery,
  cityCandidatesFromBindings,
  DEFAULT_CITY_RADIUS_KM,
  formatCitySuggestions,
  prepareCityQuery,
  radiusFromAreaKm2,
  rankCitySuggestions,
  sparqlLiteral,
} from "../app/lib/city-search.mjs";

const binding = (overrides = {}) => ({
  item: { value: "http://www.wikidata.org/entity/Q84" },
  itemLabel: { value: "London" },
  itemDescription: { value: "capital and largest city of England" },
  coord: { value: "Point(-0.1275 51.507222)" },
  typeLabel: { value: "big city" },
  population: { value: "8866180" },
  sitelinks: { value: "398" },
  ...overrides,
});

const payload = (bindings) => ({ results: { bindings } });

test("prepareCityQuery refuses a single character", () => {
  // One letter matches tens of thousands of places and ranks them by fame, which puts
  // London under "l" — true, useless, and a WDQS query on every first keystroke.
  assert.equal(prepareCityQuery("l"), null);
  assert.equal(prepareCityQuery("  "), null);
  assert.equal(prepareCityQuery("x".repeat(81)), null);
  assert.equal(prepareCityQuery(" New   York ").query, "New York");
});

test("prepareCityQuery clamps the limit", () => {
  assert.equal(prepareCityQuery("lo", { limit: 100 }).limit, 10);
  assert.equal(prepareCityQuery("lo", { limit: "junk" }).limit, 5);
});

test("a quote in the query cannot end the SPARQL literal early", () => {
  // The name goes inside a string literal in a query we build. An unescaped quote is
  // the whole injection surface, and a newline is a syntax error that reads like one.
  assert.equal(sparqlLiteral('Lon"don'), 'Lon\\"don');
  assert.equal(sparqlLiteral("back\\slash"), "back\\\\slash");
  assert.equal(sparqlLiteral("two\nlines"), "two lines");

  const query = buildCitySuggestQuery({ query: '" } SERVICE wikibase:mwapi { "', limit: 5 });
  const literals = query.match(/mwapi:search "(.*)" \./);
  assert.ok(literals, "the search term is still a single literal");
  assert.equal(literals[1], '\\" } SERVICE wikibase:mwapi { \\"');
});

test("the query asks for a coordinate and never walks the subclass tree", () => {
  const query = buildCitySuggestQuery({ query: "lond", limit: 5 });
  assert.match(query, /\?item wdt:P625 \?coord \./);
  // P279* closure over every label match cost 65 seconds and a 504 — see
  // wiki/concepts/geocoding-cascade.md. The type is filtered in code instead.
  assert.doesNotMatch(query, /P279/);
});

test("candidates collect every type of an entity rather than sampling one", () => {
  // One row per (item × P31): the Isle of Skye is an island AND a place with a council
  // area, and taking whichever arrived first is a coin toss.
  const [candidate] = cityCandidatesFromBindings(payload([
    binding(),
    binding({ typeLabel: { value: "capital city" } }),
  ]));
  assert.deepEqual(candidate.type_labels, ["big city", "capital city"]);
  assert.equal(candidate.wikidata_id, "Q84");
  assert.equal(candidate.lat, 51.507222);
  assert.equal(candidate.lng, -0.1275);
  assert.equal(candidate.population, 8866180);
});

test("a row with no coordinate is not a destination", () => {
  assert.deepEqual(cityCandidatesFromBindings(payload([binding({ coord: undefined })])), []);
  assert.deepEqual(cityCandidatesFromBindings(null), []);
});

test("ranking puts the place the world wrote about first", () => {
  // The signal that separates the London somebody means from the eleven they do not.
  const ranked = rankCitySuggestions(cityCandidatesFromBindings(payload([
    binding({
      item: { value: "http://www.wikidata.org/entity/Q92561" },
      itemLabel: { value: "London" },
      itemDescription: { value: "city in Ontario, Canada" },
      sitelinks: { value: "94" },
      population: { value: "422324" },
    }),
    binding(),
  ])));
  assert.deepEqual(ranked.map((row) => row.wikidata_id), ["Q84", "Q92561"]);
});

test("a shipwreck with a coordinate is not a place to go", () => {
  // "Victoria" matches a shipwreck and a bark, and both carry coordinates.
  const ranked = rankCitySuggestions(cityCandidatesFromBindings(payload([
    binding({
      item: { value: "http://www.wikidata.org/entity/Q1" },
      itemLabel: { value: "Victoria" },
      typeLabel: { value: "shipwreck" },
      sitelinks: { value: "3" },
      population: undefined,
    }),
  ])));
  assert.deepEqual(ranked, []);
});

test("a thing that happened is not a thing that is", () => {
  // Found on production, not in review: "lond" put the 2012 Summer Olympics SECOND,
  // above Derry, because an Olympiad has a venue coordinate and 200 Wikipedias behind
  // it. A city has no start time; that one property separates the classes with no
  // taxonomy and no subclass walk.
  const ranked = rankCitySuggestions(cityCandidatesFromBindings(payload([
    binding({
      item: { value: "http://www.wikidata.org/entity/Q8577" },
      itemLabel: { value: "2012 Summer Olympics" },
      itemDescription: { value: "Games of the XXX Olympiad, in London, United Kingdom" },
      typeLabel: { value: "Summer Olympic Games" },
      population: undefined,
      sitelinks: { value: "201" },
      startTime: { value: "2012-07-27T00:00:00Z" },
    }),
    binding(),
  ])));
  assert.deepEqual(ranked.map((row) => row.name), ["London"]);
});

test("somewhere people live outranks somewhere that merely has a coordinate", () => {
  // The group is called cities and places, in that order. A university has more
  // sitelinks than a small city and is still not what somebody moving a map means.
  const ranked = rankCitySuggestions(cityCandidatesFromBindings(payload([
    binding({
      item: { value: "http://www.wikidata.org/entity/Q170027" },
      itemLabel: { value: "University of London" },
      typeLabel: { value: "university" },
      population: undefined,
      sitelinks: { value: "120" },
    }),
    binding({
      item: { value: "http://www.wikidata.org/entity/Q163584" },
      itemLabel: { value: "Derry" },
      itemDescription: { value: "city in Northern Ireland" },
      typeLabel: { value: "city" },
      population: { value: "85016" },
      sitelinks: { value: "94" },
    }),
  ])));
  assert.deepEqual(ranked.map((row) => row.name), ["Derry", "University of London"]);
});

test("an entity with no English label is dropped rather than offered as a Q-id", () => {
  const ranked = rankCitySuggestions(cityCandidatesFromBindings(payload([
    binding({ itemLabel: { value: "Q1490" }, typeLabel: undefined }),
  ])));
  assert.deepEqual(ranked, []);
});

test("an untyped entity with a coordinate is still a place", () => {
  const ranked = rankCitySuggestions(cityCandidatesFromBindings(payload([
    binding({ typeLabel: undefined }),
  ])));
  assert.equal(ranked.length, 1);
});

test("the radius comes from the area the source states, or from nothing at all", () => {
  // Greater London is 1,572 km²: a circle of that area has a 23 km radius.
  assert.equal(radiusFromAreaKm2(1572), 23);
  assert.equal(radiusFromAreaKm2(2), 5); // clamped up: a search that finds no suburb is useless
  assert.equal(radiusFromAreaKm2(100000), 50); // clamped down: "in London" has to mean something
  assert.equal(radiusFromAreaKm2(null), DEFAULT_CITY_RADIUS_KM);
  assert.equal(radiusFromAreaKm2(""), DEFAULT_CITY_RADIUS_KM);
});

test("formatting carries the highlight and the radius the map needs", () => {
  const [row] = formatCitySuggestions(cityCandidatesFromBindings(payload([
    binding({ areaM2: { value: "1572000000" } }),
  ])), "lond");
  assert.deepEqual(row.match, { start: 0, end: 4 });
  assert.equal(row.radius_km, 23);
  assert.equal(row.name, "London");
  assert.equal(row.description, "capital and largest city of England");
});

const suggestRequest = (q) =>
  new Request(`http://localhost/api/cities/suggest?${new URLSearchParams(q === undefined ? {} : { q })}`);

test("the route answers a too-short query without touching the network", async () => {
  let called = false;
  const handler = createCitySuggestHandler({
    fetchImpl: async () => { called = true; },
    logError: () => {},
  });
  const body = await (await handler(suggestRequest("l"))).json();
  assert.deepEqual(body.suggestions, []);
  assert.equal(called, false);
});

test("the route ranks what Wikidata answered", async () => {
  let seenBody = null;
  const handler = createCitySuggestHandler({
    fetchImpl: async (url, options) => {
      seenBody = options.body.get("query");
      return new Response(JSON.stringify(payload([binding()])), { status: 200 });
    },
    logError: () => {},
  });
  const response = await handler(suggestRequest("lond"));
  const body = await response.json();
  assert.match(seenBody, /mwapi:search "lond"/);
  assert.equal(body.suggestions[0].wikidata_id, "Q84");
  assert.match(response.headers.get("Cache-Control"), /s-maxage=600/);
});

test("a gazetteer that is down empties the group instead of failing the box", async () => {
  // The film half is a different request and is unaffected; the empty group offers the
  // one-request Nominatim lookup, which is the search that existed before #145.
  for (const failure of [
    async () => new Response("", { status: 504 }),
    async () => { throw new Error("network down"); },
  ]) {
    const handler = createCitySuggestHandler({ fetchImpl: failure, logError: () => {} });
    const response = await handler(suggestRequest("lond"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.unavailable, true);
    assert.deepEqual(body.suggestions, []);
  }
});

test("a picked place gets a zoom that fits its size", async () => {
  const { zoomForPlace, zoomForBoundingBox, zoomForRadiusKm } = await import("../app/lib/city-search.mjs");
  // France: ~640,000 km² — a country view, not a street.
  assert.ok(zoomForPlace({ area_km2: 640_000, population: 68_000_000 }) <= 6);
  // London: ~1,572 km² — the city view the map always used.
  assert.equal(zoomForPlace({ area_km2: 1572, population: 8_900_000 }), 12);
  // A street states neither an area nor a population.
  assert.equal(zoomForPlace({ area_km2: null, population: null }), 16);
  // A town that states people but no area keeps the old city view.
  assert.equal(zoomForPlace({ area_km2: null, population: 5000 }), 12);
  assert.equal(zoomForRadiusKm(0.3), 16);
  assert.equal(zoomForRadiusKm(5000), 4);
  // OpenStreetMap boxes: a street is tiny, a country is huge.
  assert.ok(zoomForBoundingBox([51.5226, 51.5235, -0.1585, -0.1560]) >= 15);
  assert.ok(zoomForBoundingBox([41.3, 51.1, -5.2, 9.6]) <= 6);
  assert.equal(zoomForBoundingBox(null), 12);
});

test("each suggestion carries its zoom", () => {
  const [row] = formatCitySuggestions([{ wikidata_id: "Q1", name: "Baker Street", lat: 51.5, lng: -0.15, area_km2: null, population: null }], "baker");
  assert.equal(row.zoom, 16);
});
