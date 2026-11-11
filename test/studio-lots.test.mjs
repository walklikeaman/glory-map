import assert from "node:assert/strict";
import test from "node:test";

import { ACCESS } from "../app/lib/place-access.mjs";
import {
  STUDIO_LOTS,
  findStudioLot,
  studioLotAccessNote,
  studioLotAt,
  studioLotSentence,
} from "../app/lib/studio-lots.mjs";
import { placeRole, placeSummary } from "../app/lib/work-profile.mjs";
import { submissionToCandidate } from "../app/lib/submission-places.mjs";

// Every coordinate below is a real row from the production queue, measured 10.09.2026.
// They are here rather than invented because the point of this module is that it decides
// correctly on the rows we actually hold.

// ---------- the six a name test gets wrong ----------

test("a name test matches these three and every one of them is a place you can walk to", () => {
  // Each contains a studio's name and none is a studio. This is the /studio/i failure
  // that [[work-profile]] already paid for once, in the other direction.
  const walkable = [
    ["Disney Hall", 34.0554, -118.2499],       // Walt Disney Concert Hall, Grand Avenue
    ["Hilton Universal City", 34.1368, -118.3583], // a hotel across the street from the lot
    ["Culver City High School", 34.0069, -118.4019],
  ];
  for (const [name, lat, lng] of walkable) {
    assert.equal(studioLotAt(lat, lng), null, `${name} is not a studio lot`);
  }
});

test("a name test misses these three and every one of them is inside a lot", () => {
  // None of the three carries the word "studio". All three are backlot streets, and they
  // are the rows the product most needs to catch: each stands in for a city far away.
  assert.equal(studioLotAt(34.1400, -118.3520).slug, "universal-city");   // Courthouse Square
  assert.equal(studioLotAt(34.0863, -118.3202).slug, "paramount-pictures"); // New York City Backlot
  assert.equal(studioLotAt(34.1490, -118.3370).slug, "warner-bros-burbank"); // Hennesy Street
});

// ---------- the boundary is the point ----------

test("the Hilton is inside Universal's bounding box and outside Universal", () => {
  // The reason the rings are stored in full. A box around the lot — or a radius wide
  // enough to hold the backlot — takes in a hotel on the far side of the road.
  const universal = findStudioLot("universal-city");
  const points = universal.rings.flat();
  const lats = points.map(([lat]) => lat);
  const lngs = points.map(([, lng]) => lng);
  const [lat, lng] = [34.1368, -118.3583];
  assert.ok(lat > Math.min(...lats) && lat < Math.max(...lats), "inside the box by latitude");
  assert.ok(lng > Math.min(...lngs) && lng < Math.max(...lngs), "inside the box by longitude");
  assert.equal(studioLotAt(lat, lng), null, "and outside the lot itself");
});

test("Null Island is not a studio lot", () => {
  // `Number("")` is 0 and 0 is finite. Four incidents in this project.
  assert.equal(studioLotAt(0, 0), null);
  assert.equal(studioLotAt(null, null), null);
  assert.equal(studioLotAt("", ""), null);
  assert.equal(studioLotAt(Number.NaN, -118.3), null);
});

test("a street on the other side of the city is on the street", () => {
  assert.equal(studioLotAt(34.1016, -118.3269), null); // Hollywood & Vine
  assert.equal(studioLotAt(51.508, -0.128), null);     // Trafalgar Square
});

// ---------- the data itself ----------

test("every lot carries a ring, a source and an access answer", () => {
  assert.ok(STUDIO_LOTS.length >= 20);
  const slugs = new Set();
  for (const lot of STUDIO_LOTS) {
    assert.match(lot.slug, /^[a-z0-9-]+$/);
    assert.equal(slugs.has(lot.slug), false, `${lot.slug} is used twice`);
    slugs.add(lot.slug);
    assert.ok(lot.name);
    // The OSM way or relation it came from, so a boundary can be re-checked rather than
    // believed. A lot OSM draws in pieces (Elstree and its backlot) names every piece.
    assert.match(lot.osm, /^(way|relation)\/\d+( \+ (way|relation)\/\d+)*$/);
    assert.ok(Object.values(ACCESS).includes(lot.access), `${lot.slug} has a real access value`);
    assert.ok(lot.rings.length > 0);
    for (const ring of lot.rings) {
      // A ring with fewer than three points encloses nothing.
      assert.ok(ring.length >= 3, `${lot.slug} ring is a polygon`);
      // Stored without the repeated closing point — `inRing` joins last to first itself,
      // and a duplicated vertex would be counted twice by the ray test.
      assert.notDeepEqual(ring[0], ring[ring.length - 1], `${lot.slug} ring is not re-closed`);
    }
  }
});

test("the lots that run a public tour are the ones marked ticketed", () => {
  const ticketed = STUDIO_LOTS.filter((lot) => lot.access === ACCESS.ticketed).map((lot) => lot.slug);
  assert.deepEqual(ticketed.sort(), [
    "paramount-pictures", "sony-pictures", "universal-city", "warner-bros-burbank",
    // The Making of Harry Potter.
    "warner-bros-leavesden",
  ]);
});

// ---------- what a reader is told ----------

test("the sentence keeps the backlot street's own name", () => {
  // "Courthouse Square" is what somebody watching Back to the Future actually saw, and
  // replacing it with "Universal Studios Lot" throws that away.
  const lot = studioLotAt(34.1400, -118.3520);
  const sentence = studioLotSentence(lot, "Courthouse Square");
  assert.match(sentence, /Courthouse Square, inside Universal Studios Lot/);
  assert.match(sentence, /set somewhere else/);
});

test("the sentence does not say the name twice", () => {
  const lot = findStudioLot("paramount-ranch");
  assert.match(studioLotSentence(lot, "Paramount Ranch"), /^Paramount Ranch — a studio lot/);
});

test("it never guesses WHERE else the scene is set", () => {
  // The source recorded a lot, not a story location. Naming one would be the same
  // invention in the opposite direction.
  const sentence = studioLotSentence(studioLotAt(34.0863, -118.3202), "New York City Backlot");
  assert.equal(/New York(?!\s+City Backlot)/.test(sentence), false);
});

test("access is stated in the reader's terms, not the schema's", () => {
  assert.match(studioLotAccessNote(findStudioLot("warner-bros-burbank")), /tour goes inside/);
  assert.match(studioLotAccessNote(findStudioLot("paramount-ranch")), /walk in/);
  assert.match(studioLotAccessNote(findStudioLot("culver-studios")), /no public access/);
  assert.equal(studioLotAccessNote(null), null);
});

// ---------- precedence, where it meets the rest of the product ----------

test("a coordinate answers only where nobody has classified the place", () => {
  // An explicit `place_class` is somebody's decision and outranks a shape on a map.
  const onLot = { lat: 34.1400, lng: -118.3520 };
  assert.equal(placeRole({ ...onLot }).role, "studio");
  assert.equal(placeRole({ ...onLot, place_class: "real_exterior" }).role, "on_location");
  // And a narrative or inspiration row keeps its own meaning: "set at Universal" is not
  // "filmed at Universal", whatever the coordinate says.
  assert.equal(placeRole({ ...onLot, relation_kind: "narrative_location" }).role, "narrative");
  assert.equal(placeRole({ ...onLot, relation_kind: "inspiration_for" }).role, "inspiration");
});

test("a fact inside a lot reaches the card flagged, named and marked depicts_elsewhere", () => {
  const summary = placeSummary({ place_id: "p1", name: "New York Street", lat: 34.1490, lng: -118.3370 });
  assert.equal(summary.depicts_elsewhere, true);
  assert.equal(summary.studio_lot.slug, "warner-bros-burbank");
  assert.equal(summary.studio_lot.access, ACCESS.ticketed);
  assert.match(summary.role_label, /Warner Bros\. Studios Burbank/);
});

test("a fact on the street is not flagged and carries no lot", () => {
  const summary = placeSummary({ place_id: "p2", name: "Hollywood & Vine", lat: 34.1016, lng: -118.3269 });
  assert.equal(summary.depicts_elsewhere, false);
  assert.equal(summary.studio_lot, null);
});

test("a queue row inside a lot says so before it says anything else", () => {
  // The Cloverfield row: the address reads as a street in Los Angeles and the coordinate
  // is Paramount's New York backlot.
  const candidate = submissionToCandidate(
    {
      id: "s1",
      place_name: "New York City Backlot",
      area_hint: "860 N Gower St, Los Angeles, CA",
      lat: 34.0863,
      lng: -118.3202,
      source_kind: "moviemaps",
      status: "pending",
    },
    { work: { title: "Cloverfield" } },
  );
  assert.equal(candidate.depicts_elsewhere, true);
  assert.equal(candidate.studio_lot.name, "Paramount Pictures Studios");
  // The lot leads the sentence — a reader must not reach the end of the row before
  // learning they cannot go there.
  assert.match(candidate.sentence, /^New York City Backlot, inside Paramount Pictures Studios — a studio lot\./);
  // And the row still says nobody has checked it. The lot is geometry, not verification.
  assert.match(candidate.sentence, /Not confirmed yet/);
  assert.match(candidate.role_label, /no public access|tour goes inside/);
});

test("a queue row on the street keeps naming its source in the meta line", () => {
  const candidate = submissionToCandidate(
    { id: "s2", place_name: "Union Station", lat: 34.0561, lng: -118.2365, source_kind: "moviemaps", status: "pending" },
    { work: { title: "Blade Runner" } },
  );
  assert.equal(candidate.depicts_elsewhere, false);
  assert.equal(candidate.studio_lot, null);
  assert.equal(candidate.role_label, "MovieMaps");
  assert.match(candidate.sentence, /^Union Station is listed as a location/);
});
