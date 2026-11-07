import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_LOCATION,
  distanceMeters,
  findNearby,
  formatDistanceMeters,
  MAX_SEARCH_RADIUS_KM,
  mapSearchRadiusKm,
  zoomForRadius,
} from "../app/lib/nearby.mjs";

test("distanceMeters is zero for identical points and symmetric", () => {
  const kingsCross = [51.532, -0.1233];
  const southBank = [51.5066, -0.1162];

  assert.equal(distanceMeters(kingsCross, kingsCross), 0);
  assert.equal(
    Math.round(distanceMeters(kingsCross, southBank)),
    Math.round(distanceMeters(southBank, kingsCross)),
  );
});

test("distanceMeters matches known distances", () => {
  // One degree of latitude is ~111.19 km on the sphere used by the formula.
  const oneDegreeLat = distanceMeters([51, -0.1], [52, -0.1]);
  assert.ok(Math.abs(oneDegreeLat - 111195) < 200, `got ${oneDegreeLat}`);

  // Trafalgar Square -> National Gallery is roughly a 100 m walk.
  const shortHop = distanceMeters(DEMO_LOCATION.position, [51.5089, -0.1283]);
  assert.ok(shortHop > 50 && shortHop < 250, `got ${shortHop}`);
});

test("distanceMeters rejects malformed and out-of-range points", () => {
  assert.throws(() => distanceMeters([51.5], [51.5, -0.1]));
  assert.throws(() => distanceMeters([91, 0], [51.5, -0.1]));
  assert.throws(() => distanceMeters([51.5, -181], [51.5, -0.1]));
  assert.throws(() => distanceMeters(["north", -0.1], [51.5, -0.1]));
  assert.throws(() => distanceMeters(null, [51.5, -0.1]));
});

const sampleLocations = [
  { id: "national-gallery", position: [51.5089, -0.1283] },
  { id: "south-bank", position: [51.5066, -0.1162] },
  { id: "kings-cross", position: [51.532, -0.1233] },
  { id: "broken", position: null },
];

test("findNearby returns the closest point and sorts matches inside the radius", () => {
  const { nearest, inRadius } = findNearby(DEMO_LOCATION.position, sampleLocations, 3000);

  assert.equal(nearest.location.id, "national-gallery");
  assert.deepEqual(
    inRadius.map((entry) => entry.location.id),
    ["national-gallery", "south-bank", "kings-cross"],
  );
  assert.ok(inRadius[0].distanceMeters < inRadius[1].distanceMeters);
});

test("findNearby keeps the nearest point even when the radius excludes it", () => {
  const { nearest, inRadius } = findNearby(DEMO_LOCATION.position, sampleLocations, 100);

  assert.equal(nearest.location.id, "national-gallery");
  assert.ok(nearest.distanceMeters > 0);
  assert.ok(inRadius.length <= 1);
});

test("findNearby handles empty datasets and rejects bad input", () => {
  assert.deepEqual(findNearby(DEMO_LOCATION.position, [], 300), {
    nearest: null,
    inRadius: [],
  });
  assert.throws(() => findNearby([91, 0], sampleLocations, 300));
  assert.throws(() => findNearby(DEMO_LOCATION.position, sampleLocations, 0));
  assert.throws(() => findNearby(DEMO_LOCATION.position, sampleLocations, Number.NaN));
});

test("formatDistanceMeters switches from meters to kilometers", () => {
  assert.equal(formatDistanceMeters(0), "0 m");
  assert.equal(formatDistanceMeters(85.4), "85 m");
  assert.equal(formatDistanceMeters(999), "999 m");
  assert.equal(formatDistanceMeters(1049), "1.0 km");
  assert.equal(formatDistanceMeters(2340), "2.3 km");
  assert.throws(() => formatDistanceMeters(-1));
  assert.throws(() => formatDistanceMeters(Number.NaN));
});

test("mapSearchRadiusKm covers the viewport and respects API limits", () => {
  assert.equal(mapSearchRadiusKm(120), 0.5);
  assert.equal(mapSearchRadiusKm(5250), 5.3);
  // A city view still asks about a city.
  assert.equal(mapSearchRadiusKm(72_000), 72);
  assert.throws(() => mapSearchRadiusKm(0));
  assert.throws(() => mapSearchRadiusKm(Number.NaN));
});

test("a country-wide view asks about a country, not about 50km of it", () => {
  // The ceiling was 50km, so zooming out was pointless: the view widened to Britain
  // while the search kept asking about the same city, and Scotland's places stayed
  // invisible from a Britain-wide view.
  assert.equal(mapSearchRadiusKm(600_000), MAX_SEARCH_RADIUS_KM);
  assert.ok(MAX_SEARCH_RADIUS_KM >= 400, "a country must fit");
  // But not the world: beyond a region the answer stops being a set of stops
  // somebody could walk.
  assert.ok(MAX_SEARCH_RADIUS_KM <= 1000);
});

test("zoomForRadius maps the selectable radii to sensible zoom levels", () => {
  assert.equal(zoomForRadius(100), 17);
  assert.equal(zoomForRadius(300), 16);
  assert.equal(zoomForRadius(1000), 14);
  assert.equal(zoomForRadius(3000), 13);
});

test("a browse keeps the places already on the map instead of replacing them", async () => {
  const { mergeBrowsed } = await import("../app/lib/nearby.mjs");
  const a = { id: "a" }, b = { id: "b" }, b2 = { id: "b", fresh: true }, c = { id: "c" };
  assert.deepEqual(mergeBrowsed([a, b], [b2, c]), [b2, c, a]);
  assert.deepEqual(mergeBrowsed(null, [a]), [a]);
  assert.deepEqual(mergeBrowsed([a, b], [c], 2), [c, a], "capped, newest first");
});
