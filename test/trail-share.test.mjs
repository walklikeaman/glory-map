import assert from "node:assert/strict";
import test from "node:test";

import { TRAIL_ORDER } from "../app/lib/trail-order.mjs";
import { trailFileName, trailGeoJson, trailOrderFromParams, trailShareUrl } from "../app/lib/trail-share.mjs";

const PAGE = "https://example.app/?lat=51.5&lng=-0.12&z=13&work=abc#panel";

test("the shared link keeps the work and the map, and says walking order only when it is on", () => {
  const story = new URL(trailShareUrl(PAGE, { order: TRAIL_ORDER.story }));
  assert.equal(story.searchParams.get("work"), "abc");
  assert.equal(story.searchParams.get("lat"), "51.5");
  assert.equal(story.searchParams.has("trail"), false);
  assert.equal(story.hash, "");

  const walk = new URL(trailShareUrl(`${PAGE}&trail=walk`, { order: TRAIL_ORDER.walk }));
  assert.equal(walk.searchParams.get("trail"), "walk");
  // Switching back drops it rather than writing the default.
  assert.equal(new URL(trailShareUrl(`${PAGE}&trail=walk`, { order: TRAIL_ORDER.story })).searchParams.has("trail"), false);
});

test("nothing about spoilers rides in the link", () => {
  const url = trailShareUrl(PAGE, { order: TRAIL_ORDER.walk });
  assert.doesNotMatch(url, /spoil|progress/i);
});

test("the trail order is read back from a link, defaulting to the story", () => {
  assert.equal(trailOrderFromParams(new URLSearchParams("trail=walk")), TRAIL_ORDER.walk);
  assert.equal(trailOrderFromParams(new URLSearchParams("trail=bogus")), TRAIL_ORDER.story);
  assert.equal(trailOrderFromParams(new URLSearchParams("")), TRAIL_ORDER.story);
  assert.equal(trailOrderFromParams(null), TRAIL_ORDER.story);
});

test("the GeoJSON lists stops in story order with GeoJSON's lng, lat", () => {
  const geo = trailGeoJson({
    title: "Notting Hill",
    stops: [
      { sequence_index: 4, place: "The Travel Bookshop", position: [51.5155, -0.2049], sentence: "William's shop." },
      { sequence_index: 2, place: "Portobello Road", position: [51.5168, -0.2058] },
      { sequence_index: 9, place: "Nowhere", position: [null, 1] },
    ],
  });
  assert.equal(geo.type, "FeatureCollection");
  const points = geo.features.filter((feature) => feature.geometry.type === "Point");
  assert.deepEqual(points.map((point) => point.properties.name), ["Portobello Road", "The Travel Bookshop"]);
  assert.deepEqual(points[0].geometry.coordinates, [-0.2058, 51.5168]);
  assert.deepEqual(points.map((point) => point.properties.order), [1, 2]);
  assert.equal(points[1].properties.description, "William's shop.");
  const line = geo.features.find((feature) => feature.geometry.type === "LineString");
  assert.deepEqual(line.geometry.coordinates, points.map((point) => point.geometry.coordinates));
});

test("a single stop is a point and no line", () => {
  const geo = trailGeoJson({ stops: [{ sequence_index: 1, place: "A", position: [1, 2] }] });
  assert.deepEqual(geo.features.map((feature) => feature.geometry.type), ["Point"]);
  assert.equal(geo.name, "Story trail");
});

test("the file name is safe and says what it is", () => {
  assert.equal(trailFileName("Amélie: Le Fabuleux Destin"), "amelie-le-fabuleux-destin-trail.geojson");
  assert.equal(trailFileName(""), "story-trail.geojson");
});
