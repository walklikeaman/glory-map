import assert from "node:assert/strict";
import test from "node:test";

import { googleMapsDirectionsUrl, gpxFileName, routeGpx } from "../app/lib/route-export.mjs";

const STOPS = [
  { place: "King's Cross", position: [51.5308, -0.1238] },
  { place: "St Pancras & Co <Hotel>", position: [51.5299, -0.1255] },
  { place: "Leadenhall Market", position: [51.5128, -0.0834] },
];

test("a walk opens in Google Maps as walking directions through every stop", () => {
  const url = new URL(googleMapsDirectionsUrl(STOPS));
  assert.equal(url.origin + url.pathname, "https://www.google.com/maps/dir/");
  assert.equal(url.searchParams.get("api"), "1");
  assert.equal(url.searchParams.get("origin"), "51.5308,-0.1238");
  assert.equal(url.searchParams.get("destination"), "51.5128,-0.0834");
  assert.equal(url.searchParams.get("waypoints"), "51.5299,-0.1255");
  assert.equal(url.searchParams.get("travelmode"), "walking");
});

test("two stops need no waypoints, and nothing to route gives no link", () => {
  const url = new URL(googleMapsDirectionsUrl(STOPS.slice(0, 2)));
  assert.equal(url.searchParams.has("waypoints"), false);
  assert.equal(googleMapsDirectionsUrl(STOPS.slice(0, 1)), null);
  assert.equal(googleMapsDirectionsUrl([{ position: [null, 1] }, { position: [1, 2] }]), null);
  assert.equal(googleMapsDirectionsUrl(Array.from({ length: 12 }, (_, i) => ({ position: [51, i / 100] }))), null);
});

test("the GPX holds numbered, escaped waypoints and the drawn track", () => {
  const gpx = routeGpx({ name: "London walk", stops: STOPS, track: [[51.5308, -0.1238], [51.52, -0.11], [51.5128, -0.0834]] });
  assert.match(gpx, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(gpx, /<wpt lat="51.5308" lon="-0.1238"><name>1\. King&apos;s Cross<\/name><\/wpt>/);
  assert.match(gpx, /2\. St Pancras &amp; Co &lt;Hotel&gt;/);
  assert.equal((gpx.match(/<wpt /g) ?? []).length, 3);
  assert.equal((gpx.match(/<trkpt /g) ?? []).length, 3);
  assert.doesNotMatch(gpx, /<Hotel>/);
});

test("a GPX with no route drawn yet is waypoints only", () => {
  const gpx = routeGpx({ stops: STOPS });
  assert.doesNotMatch(gpx, /<trk>/);
});

test("the file is named after the city", () => {
  assert.equal(gpxFileName("São Paulo"), "sao-paulo-glorymap-walk.gpx");
  assert.equal(gpxFileName(null), "glorymap-walk.gpx");
});
