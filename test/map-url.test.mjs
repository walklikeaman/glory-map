import assert from "node:assert/strict";
import test from "node:test";

import { citySlugFromName, locateOnOpen, mapUrlQuery, readMapUrl } from "../app/lib/map-url.mjs";

const q = (s) => new URLSearchParams(s);

// Measured 10.09.2026: the map opened on London and there was no way to open it anywhere
// else by link. Every other surface got an address — a work in #146, a city and the
// directory in #158, a place in #129 — and the main one never did.

test("a city slug opens the map on that city", () => {
  const view = readMapUrl(q("city=los-angeles"));
  assert.equal(view.source, "city");
  assert.equal(view.name, "Los Angeles");
  // The gazetteer's anchor, not a number in the URL: it is measured from the places we
  // hold, and it moves when they do.
  assert.equal(view.lat, 34.0597);
  assert.equal(view.lng, -118.2856);
});

test("an unknown slug is ignored rather than guessed at", () => {
  // Falling back to somewhere the reader did not write is how a shared link quietly opens
  // in the wrong city.
  assert.equal(readMapUrl(q("city=atlantis")), null);
  assert.equal(readMapUrl(q("city=")), null);
});

test("a raw coordinate works too, because most places are not in the gazetteer", () => {
  const view = readMapUrl(q("lat=34.09&lng=-118.33&z=14"));
  assert.deepEqual([view.source, view.lat, view.lng, view.zoom], ["point", 34.09, -118.33, 14]);
});

test("a URL that says nothing answers null, and does not invent London", () => {
  // The caller keeps its own default; this module does not decide it.
  assert.equal(readMapUrl(q("")), null);
  assert.equal(readMapUrl(q("z=13")), null);
});

test("Null Island is not a place", () => {
  // `Number("")` is 0 and 0 is finite. Four incidents in this project.
  assert.equal(readMapUrl(q("lat=0&lng=0")), null);
  assert.equal(readMapUrl(q("lat=&lng=")), null);
});

test("a coordinate off the globe is refused", () => {
  assert.equal(readMapUrl(q("lat=91&lng=0")), null);
  assert.equal(readMapUrl(q("lat=10&lng=181")), null);
});

test("an impossible zoom falls back rather than being obeyed", () => {
  assert.equal(readMapUrl(q("city=london&z=99")).zoom, 12);
  assert.equal(readMapUrl(q("city=london&z=abc")).zoom, 12);
});

test("the city slug survives a round trip", () => {
  const view = readMapUrl(q("city=los-angeles&z=12"));
  assert.equal(mapUrlQuery({ lat: view.lat, lng: view.lng, zoom: view.zoom, citySlug: "los-angeles" }),
    "city=los-angeles&z=12");
});

test("a dragged map falls back to its coordinate", () => {
  // The slug is what the reader pasted; once they move off the anchor it is no longer
  // true, and the URL has to describe where they actually are.
  const dragged = mapUrlQuery({ lat: 34.09, lng: -118.33, zoom: 14, citySlug: "los-angeles" });
  assert.equal(dragged, "lat=34.0900&lng=-118.3300&z=14");
});

test("four decimals, the same precision the place card copies", () => {
  // About 11 m. Six would be inventing digits the map never had.
  assert.match(mapUrlQuery({ lat: 51.508123456, lng: -0.128987654, zoom: 13 }), /lat=51\.5081&lng=-0\.1290/);
});

test("a name is joined to the gazetteer only when we hold that city", () => {
  // The map holds a NAME from the live Wikidata search, which knows nothing about the
  // committed gazetteer. Wikidata knows far more cities than the directory does, and one
  // we do not hold has to fall back to a coordinate.
  assert.equal(citySlugFromName("Los Angeles"), "los-angeles");
  assert.equal(citySlugFromName("London"), "london");
  assert.equal(citySlugFromName("Nowheresville"), null);
  assert.equal(citySlugFromName(""), null);
  assert.equal(citySlugFromName(null), null);
});

test("a view with no coordinate produces no query at all", () => {
  assert.equal(mapUrlQuery({}), "");
  assert.equal(mapUrlQuery({ lat: null, lng: null }), "");
});

test("the map asks for the reader's position only when the address named nowhere", () => {
  assert.equal(locateOnOpen(readMapUrl(new URLSearchParams(""))), true);
  assert.equal(locateOnOpen(readMapUrl(new URLSearchParams("imdb=8&kind=film"))), true);
  assert.equal(locateOnOpen(readMapUrl(new URLSearchParams("city=los-angeles"))), false);
  assert.equal(locateOnOpen(readMapUrl(new URLSearchParams("lat=51.5&lng=-0.12"))), false);
});
