import assert from "node:assert/strict";
import test from "node:test";

import {
  attachPlaceFilms,
  budgetNote,
  buildTripPlan,
  collapseSameSpot,
  filterStopsByLibrary,
  pickForBudget,
  poolNearest,
  splitTripStops,
  TRIP_EXCLUSION,
  tripHonestyLine,
} from "../app/lib/trip-plan.mjs";
import { ACCESS } from "../app/lib/place-access.mjs";
import { DISTANCE_INFLUENCE, DISTANCE_PERSON, DISTANCE_SELF } from "../app/lib/facts.mjs";

// Real rows in the shape the reader returned UNTIL 10.09 — one row per submission. Kept
// because the graph reader still returns it and because the duplicates below are what broke
// the first plan; the grouped shape the queue returns now is exercised at the bottom of
// this file. The coordinates and spellings are live ones from the Hollywood viewport.
const HOLLYWOOD = [
  { submission_id: "s1", work_id: "w1", work_title: "Forrest Gump", name: "Grauman's Chinese Theatre",
    lat: 34.10204, lng: -118.34093, status: "pending", source_kind: "moviemaps",
    source_url: "https://moviemaps.org/locations/1", area_hint: "6925 Hollywood Boulevard" },
  { submission_id: "s2", work_id: "w2", work_title: "Iron Man 3",
    name: "Grauman’s Chinese Theatre, Hollywood Boulevard, Hollywood, Los Angeles",
    lat: 34.10204, lng: -118.34093, status: "pending", source_kind: "movielocations",
    source_url: "https://movielocations.example/2", area_hint: "Los Angeles" },
  { submission_id: "s3", work_id: "w3", work_title: "The Majestic",
    name: "Grauman's Chinese Theatre, Hollywood Boulevard, Hollywood",
    lat: 34.10194, lng: -118.34083, status: "pending", source_kind: "movielocations",
    source_url: "https://movielocations.example/3", area_hint: "Los Angeles" },
  { submission_id: "s4", work_id: "w4", work_title: "Hacks", name: "Madame Tussauds Hollywood",
    lat: 34.10178, lng: -118.34145, status: "pending", source_kind: "moviemaps",
    source_url: "https://moviemaps.org/locations/4", area_hint: "6933 Hollywood Blvd" },
  { submission_id: "s5", work_id: "w5", work_title: "The Fabulous Baker Boys",
    name: "The Hollywood Roosevelt", lat: 34.10125, lng: -118.34178, status: "pending",
    source_kind: "moviemaps", source_url: "https://moviemaps.org/locations/5",
    area_hint: "7000 Hollywood Blvd" },
  { submission_id: "s6", work_id: "w6", work_title: "Charlie's Angels: Full Throttle",
    name: "Roosevelt Hotel, Hollywood Boulevard, Hollywood", lat: 34.10125, lng: -118.34178,
    status: "pending", source_kind: "movielocations", source_url: "https://movielocations.example/6",
    area_hint: "Los Angeles" },
  { submission_id: "s7", work_id: "w7", work_title: "The Muppets", name: "El Capitan Theatre",
    lat: 34.10132, lng: -118.33993, status: "pending", source_kind: "moviemaps",
    source_url: "https://moviemaps.org/locations/7", area_hint: "6838 Hollywood Blvd" },
];

// Inside Paramount's fence — a real backlot street, and the row a name test cannot catch.
const BACKLOT = {
  submission_id: "s8", work_id: "w8", work_title: "Chinatown", name: "New York City Backlot",
  lat: 34.08500, lng: -118.31900, status: "pending", source_kind: "moviemaps",
  source_url: "https://moviemaps.org/locations/8", area_hint: "5555 Melrose Avenue",
};

// Inside a working lot nobody may enter.
const WORKING_LOT = {
  submission_id: "s9", work_id: "w9", work_title: "Argo", name: "The Jim Henson Company",
  lat: 34.09660, lng: -118.34350, status: "pending", source_kind: "moviemaps",
  source_url: "https://moviemaps.org/locations/9", area_hint: "1416 N La Brea Ave",
};

const ORIGIN = [34.1022, -118.3406];

function plan(overrides = {}) {
  return buildTripPlan({ candidates: HOLLYWOOD, origin: ORIGIN, budgetMinutes: 120, ...overrides });
}

test("a queue row never comes back wearing the graph's clothes", () => {
  const stop = plan().stops[0];
  assert.equal(stop.grounding.verified, false);
  assert.equal(stop.grounding.store, "queue");
  assert.equal(stop.grounding.confidence_band, null, "a candidate has no confidence to report");
  assert.ok(stop.grounding.source_url, "and it always names who said it");
});

test("a graph place is the only thing that may be called verified", () => {
  const built = buildTripPlan({
    // Placed among the Hollywood stops on purpose. Downtown it would simply be too far
    // to walk to and the test would be measuring seed selection, not labelling.
    places: [{ place_id: "p1", name: "Hollywood Walk of Fame", lat: 34.10150, lng: -118.34120,
      wikidata_id: "Q893134", confidence_band: "verified", geocode_precision: "street" }],
    candidates: HOLLYWOOD,
    origin: ORIGIN,
    budgetMinutes: 120,
  });
  const verified = built.stops.filter((stop) => stop.grounding.verified);
  assert.equal(verified.length, 1);
  assert.equal(verified[0].grounding.store, "graph");
  assert.equal(verified[0].grounding.source_url, "https://www.wikidata.org/wiki/Q893134");
});

test("the honesty line refuses to describe candidates as stops we checked", () => {
  assert.match(tripHonestyLine({ stops: 5, verified: 0, candidates: 5 }), /None of these 5 stops is verified/);
  assert.match(tripHonestyLine({ stops: 5, verified: 2, candidates: 3 }), /^2 of 5 stops are verified/);
  assert.match(tripHonestyLine({ stops: 3, verified: 3, candidates: 0 }), /All 3 stops are verified/);
});

// --- the studio lot rules -------------------------------------------------------------

test("a backlot street is kept out of the walk and named, not silently dropped", () => {
  const built = plan({ candidates: [...HOLLYWOOD, BACKLOT] });
  assert.ok(!built.stops.some((stop) => stop.name === "New York City Backlot"));

  const excluded = built.excluded.find((row) => row.name === "New York City Backlot");
  assert.ok(excluded, "the caller must see what we refused, or it will re-propose it");
  assert.equal(excluded.reason, TRIP_EXCLUSION.studio_lot_needs_booking);
  assert.match(excluded.note, /set somewhere else/);
});

test("a working lot is refused for a different reason than a ticketed one", () => {
  const built = plan({ candidates: [...HOLLYWOOD, WORKING_LOT] });
  const excluded = built.excluded.find((row) => row.name === "The Jim Henson Company");
  assert.equal(excluded.reason, TRIP_EXCLUSION.studio_lot_no_entry);
  assert.match(excluded.access_note, /no public access|gate is as close/,
    "the refusal that matters is whether the gate opens, and it must not be lost");
  assert.match(excluded.note, /set somewhere else/, "and what the place is, alongside it");
});

test("a lot on public land is a real stop — the rule is the gate, not the word studio", () => {
  // Paramount Ranch is a National Park Service site: ACCESS.open, and you can walk in.
  // It is the case that proves the refusal is about the fence and not about the name.
  const ranch = (index) => ({
    submission_id: `r${index}`, work_id: `wr${index}`, work_title: `Ranch Film ${index}`,
    name: `Paramount Ranch ${index}`, lat: 34.1180 + index / 10000, lng: -118.7550,
    status: "pending", source_kind: "moviemaps", source_url: `https://moviemaps.org/r${index}`,
    area_hint: "Agoura Hills",
  });
  const built = buildTripPlan({
    candidates: [ranch(1), ranch(2), ranch(3)],
    origin: [34.1180, -118.7550],
    budgetMinutes: 120,
  });

  assert.equal(built.excluded.length, 0, "public land is not a gate");
  assert.equal(built.stops.length, 3);
  assert.ok(built.stops.every((stop) => stop.access.verdict === ACCESS.open));
  assert.ok(built.stops.every((stop) => stop.depicts_elsewhere === true),
    "and it still says the camera lied about where");
});

test("an opt-in puts the lots back, because refusing is a default and not a verdict", () => {
  const shut = plan({ candidates: [...HOLLYWOOD, BACKLOT] });
  const open = plan({ candidates: [...HOLLYWOOD, BACKLOT], includeStudioLots: true });
  assert.equal(shut.counts.eligible + 1, open.counts.eligible);
  assert.ok(shut.excluded.some((row) => row.name === "New York City Backlot"));
  assert.ok(!open.excluded.some((row) => row.name === "New York City Backlot"));
});

// --- ROUTE_BLOCK_DISTANCES ------------------------------------------------------------

test("distance 2 is never a route stop, however well evidenced it is", () => {
  const stops = [
    { id: "a", name: "Where the idea came from", position: [34.1, -118.34], distance: DISTANCE_INFLUENCE,
      work: {}, grounding: { verified: true }, access: { verdict: ACCESS.open } },
    { id: "b", name: "Filmed here", position: [34.1, -118.35], distance: DISTANCE_SELF,
      work: {}, grounding: { verified: true }, access: { verdict: ACCESS.open } },
    { id: "c", name: "Its writer lived here", position: [34.1, -118.36], distance: DISTANCE_PERSON,
      work: {}, grounding: { verified: true }, access: { verdict: ACCESS.open } },
  ];
  const { eligible, excluded } = splitTripStops(stops);
  assert.deepEqual(eligible.map((stop) => stop.id), ["b", "c"]);
  assert.equal(excluded[0].reason, TRIP_EXCLUSION.not_a_route_stop);
});

test("a closed place is refused outright", () => {
  const { eligible, excluded } = splitTripStops([
    { id: "a", name: "Shut", position: [34.1, -118.34], distance: DISTANCE_SELF,
      work: {}, grounding: {}, access: { verdict: ACCESS.closed } },
  ]);
  assert.equal(eligible.length, 0);
  assert.equal(excluded[0].reason, TRIP_EXCLUSION.closed);
});

// --- one building is one stop ---------------------------------------------------------

test("three spellings of one theatre are one stop, and every film survives the merge", () => {
  const built = plan();
  const graumans = built.stops.filter((stop) => /Grauman/i.test(stop.name));
  assert.equal(graumans.length, 1, "three rows for one building must not be three stops");
  assert.deepEqual(
    [...graumans[0].works].sort(),
    ["Forrest Gump", "Iron Man 3", "The Majestic"],
    "the whole reason to stand there is the films, and the collapse must not eat them",
  );
  assert.equal(graumans[0].merged_count, 3);
  assert.deepEqual([...graumans[0].sources].sort(), ["movielocations", "moviemaps"]);
});

test("two names on one coordinate are one place to walk to, and both names are kept", () => {
  const built = plan();
  const roosevelt = built.stops.filter((stop) => /Roosevelt/i.test(stop.name));
  assert.equal(roosevelt.length, 1);
  assert.deepEqual(roosevelt[0].also_known_as, ["Roosevelt Hotel, Hollywood Boulevard, Hollywood"]);
  assert.equal(roosevelt[0].works.length, 2);
});

test("two different theatres 100 m apart stay two stops", () => {
  // The discriminating case: Grauman's Chinese and Grauman's Egyptian share three words.
  const egyptian = { submission_id: "e1", work_id: "w11", work_title: "Some Film",
    name: "Grauman's Egyptian Theatre", lat: 34.10190, lng: -118.32500, status: "pending",
    source_kind: "moviemaps", source_url: "https://moviemaps.org/locations/11", area_hint: "6712 Hollywood Blvd" };
  const collapsed = collapseSameSpot([
    { id: "a", name: "Grauman's Chinese Theatre", position: [34.10204, -118.34093],
      grounding: { source_kind: "moviemaps" }, work: { title: "Forrest Gump" } },
    { id: "b", name: egyptian.name, position: [egyptian.lat, egyptian.lng],
      grounding: { source_kind: "moviemaps" }, work: { title: "Some Film" } },
  ]);
  assert.equal(collapsed.length, 2, "a shared prefix is not a shared building");
});

test("a chain of near-matches cannot drag two venues together", () => {
  // B matches A and C, but A and C are 60 m apart. A group takes a member only if EVERY
  // member agrees, so this must stay two groups rather than becoming one.
  const collapsed = collapseSameSpot([
    { id: "a", name: "Hotel", position: [34.1000, -118.3400], grounding: {}, work: {} },
    { id: "b", name: "Hotel", position: [34.10025, -118.3400], grounding: {}, work: {} },
    { id: "c", name: "Hotel", position: [34.10054, -118.3400], grounding: {}, work: {} },
  ]);
  assert.ok(collapsed.length >= 2);
});

// --- the personal library -------------------------------------------------------------

test("the library is compared, never read — an absent one filters nothing", () => {
  const { kept, dropped } = filterStopsByLibrary(
    [{ work: { title: "Heat", year: 1995 }, id: "a" }], null,
  );
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 0);
});

test("only the traveller's own films survive a library filter", () => {
  const built = plan({ library: [{ title: "Forrest Gump", year: 1994 }] });
  assert.ok(built.stops.every((stop) => stop.works.includes("Forrest Gump")));
  assert.ok(built.excluded.some((row) => row.reason === TRIP_EXCLUSION.not_in_library));
});

test("the library matcher is the project's own, punctuation and all", () => {
  // Letterboxd writes an ellipsis; our rows write three dots or none. `libraryEntryFor`
  // already normalises this, and reusing it is what stops a plan and the map filter
  // disagreeing about which film matched.
  const row = { submission_id: "x", work_id: "wx", work_title: "Once Upon a Time… in Hollywood",
    name: "Musso & Frank Grill", lat: 34.10166, lng: -118.33240, status: "pending",
    source_kind: "moviemaps", source_url: "https://moviemaps.org/x", area_hint: "6667 Hollywood Blvd" };
  const { kept } = filterStopsByLibrary(
    [{ id: "x", work: { title: row.work_title, year: null }, works: [] }],
    [{ title: "Once Upon a Time in Hollywood", year: 2019 }],
  );
  assert.equal(kept.length, 1, "the ellipsis must not lose the match");
});

test("a library that matches nothing yields no stops rather than a plan of strangers", () => {
  const built = plan({ library: [{ title: "A Film Nobody Shot Here", year: 1999 }] });
  assert.equal(built.stops.length, 0);
  assert.equal(built.enough, false);
});

// --- pooling, budget, determinism -----------------------------------------------------

test("the pool is bounded and taken nearest the origin", () => {
  const many = Array.from({ length: 500 }, (unused, index) => ({
    id: `s${index}`, name: `Stop ${index}`, position: [34.1 + index / 1000, -118.34],
  }));
  const pooled = poolNearest(many, [34.1, -118.34], 60);
  assert.equal(pooled.length, 60);
  assert.equal(pooled[0].id, "s0", "nearest first");
});

test("the same request answers the same way twice", () => {
  assert.deepEqual(
    plan().stops.map((stop) => stop.id),
    plan().stops.map((stop) => stop.id),
  );
});

test("pickForBudget prefers the longest walk that still fits, never one that does not", () => {
  const candidates = [
    { stops: [{ id: "a" }, { id: "b" }, { id: "c" }], estimatedMinutes: 5, confirmedStops: 0 },
    { stops: [{ id: "d" }, { id: "e" }, { id: "f" }], estimatedMinutes: 21, confirmedStops: 0 },
    { stops: [{ id: "g" }, { id: "h" }], estimatedMinutes: 90, confirmedStops: 0 },
  ];
  const picked = pickForBudget(candidates);
  assert.equal(picked.estimatedMinutes, 21, "the two-stop 90-minute tour has fewer stops and loses");
});

test("a budget the walk cannot fill is said out loud", () => {
  assert.match(budgetNote(7, 120), /7 minutes against a 120-minute budget/);
  assert.equal(budgetNote(20, 30), null, "a walk that uses most of its budget needs no note");
  assert.equal(budgetNote(15, 30), null, "exactly half is not a shortfall");
  assert.equal(budgetNote(0, 120), null);
});

test("a plan states what it is made of and does not imply an afternoon", () => {
  const built = plan();
  assert.equal(built.counts.stops, built.stops.length);
  assert.equal(built.counts.verified + built.counts.candidates, built.counts.stops);
  assert.match(built.caveat, /never means open/);
  assert.match(built.caveat, /Studio lots are excluded/);
});

test("a budget the planner does not offer is refused rather than rounded", () => {
  assert.throws(() => buildTripPlan({ candidates: HOLLYWOOD, budgetMinutes: 45 }), /Budget must be one of/);
});

test("a row on Null Island is not a place", () => {
  const built = buildTripPlan({
    candidates: [...HOLLYWOOD, { submission_id: "z", work_id: "wz", work_title: "Nowhere",
      name: "Nowhere", lat: 0, lng: 0, status: "pending", source_kind: "moviemaps" }],
    origin: ORIGIN, budgetMinutes: 120,
  });
  assert.ok(!built.stops.some((stop) => stop.name === "Nowhere"));
  assert.ok(built.excluded.some((row) => row.reason === TRIP_EXCLUSION.no_position));
});

test("a city centroid is never a stop, however well evidenced it is", () => {
  // The live LA basin's one verified place is "Los Angeles" itself — Q65, city precision,
  // no films — and the first plan built from that viewport routed to it.
  const built = buildTripPlan({
    places: [{ place_id: "p1", name: "Los Angeles", lat: 34.05223, lng: -118.24368,
      wikidata_id: "Q65", confidence_band: "verified", geocode_precision: "city" }],
    candidates: HOLLYWOOD,
    origin: [34.05223, -118.24368],
    budgetMinutes: 120,
  });
  assert.ok(!built.stops.some((stop) => stop.name === "Los Angeles"),
    "the best-evidenced row in the plan is the worst possible stop");

  const refused = built.excluded.find((row) => row.name === "Los Angeles");
  assert.equal(refused.reason, TRIP_EXCLUSION.not_a_spot);
  assert.match(refused.note, /names this area, not a spot inside it/);
});

test("a graded place that IS a spot still routes", () => {
  const built = buildTripPlan({
    places: [{ place_id: "p2", name: "Bradbury Building", lat: 34.10160, lng: -118.34110,
      wikidata_id: "Q893134", confidence_band: "verified", geocode_precision: "building" }],
    candidates: HOLLYWOOD, origin: ORIGIN, budgetMinutes: 120,
  });
  assert.ok(built.stops.some((stop) => stop.name === "Bradbury Building"));
});

test("an ungraded queue row is not deleted for lacking a grade", () => {
  // 4,664 of the 4,665 Los Angeles rows carry no precision. Reading that silence as
  // "too coarse" would empty the city.
  const built = buildTripPlan({ candidates: HOLLYWOOD, origin: ORIGIN, budgetMinutes: 120 });
  assert.ok(built.stops.length >= 3);
  assert.ok(!built.excluded.some((row) => row.reason === TRIP_EXCLUSION.not_a_spot));
});

// The shape `map_candidate_points_in_view` ACTUALLY returns since 10.09: one row per
// coordinate, carrying the films listed at it. Reading the old field names meant `row.name`
// was undefined and every queue row was dropped before anything could refuse it — the live
// route answered "No stops." for the whole of Los Angeles while reporting 162 candidates in
// view, with nothing in `excluded` to explain the gap.
const GROUPED = [
  {
    lat: 34.11856, lng: -118.30037, place_name: "Griffith Observatory",
    area_hint: "2800 East Observatory Road", row_count: 41, work_count: 39, status: "pending",
    films: [
      { work_id: "w1", title: "Adventures of Superman", year: 1952, kind: "film", imdb: 7.7,
        source_kind: "moviemaps", source_url: "https://moviemaps.org/locations/a", status: "pending",
        note: 'Appears as "Jor-El\'s Laboratory on Krypton"' },
      { work_id: "w2", title: "La La Land", year: 2016, kind: "film", imdb: 8, source_kind: "moviemaps",
        source_url: "https://moviemaps.org/locations/a", status: "pending", note: "Source: IMDb" },
    ],
  },
  {
    lat: 34.10204, lng: -118.34093, place_name: "Grauman's Chinese Theatre",
    area_hint: "6925 Hollywood Boulevard", row_count: 3, work_count: 3, status: "pending",
    films: [
      { work_id: "w3", title: "Forrest Gump", year: 1994, kind: "film", imdb: 8.8,
        source_kind: "moviemaps", source_url: "https://moviemaps.org/locations/b", status: "pending" },
    ],
  },
  {
    lat: 34.10175, lng: -118.34248, place_name: "Hollywood Roosevelt Hotel",
    area_hint: "7000 Hollywood Boulevard", row_count: 2, work_count: 2, status: "pending",
    films: [
      { work_id: "w4", title: "Beverly Hills Cop", year: 1984, kind: "film", imdb: 7.4,
        source_kind: "movielocations", source_url: "https://movie-locations.com/x", status: "pending" },
    ],
  },
];

test("a grouped queue row becomes a stop, with the films it lists", () => {
  const built = buildTripPlan({ candidates: GROUPED, origin: [34.101, -118.34], budgetMinutes: 120 });

  assert.equal(built.counts.considered, 3);
  assert.ok(built.stops.length >= 3, `got ${built.stops.length} stops`);

  const observatory = built.stops.find((stop) => stop.name === "Griffith Observatory");
  assert.ok(observatory, "the observatory is a stop");
  // One point, thirty-nine films. Naming one of them is the failure this carries.
  assert.deepEqual(observatory.works.sort(), ["Adventures of Superman", "La La Land"]);
  assert.equal(observatory.work.title, "Adventures of Superman");
  assert.equal(observatory.grounding.verified, false);
  assert.equal(observatory.grounding.source_kind, "moviemaps");
  assert.equal(observatory.id, "point:34.11856,-118.30037");
});

test("a grouped row with no films is still refused for its own reason, not silently", () => {
  const built = buildTripPlan({
    candidates: [{ lat: 0, lng: 0, place_name: "Null Island", films: [] }, ...GROUPED],
    origin: [34.101, -118.34],
    budgetMinutes: 120,
  });
  assert.equal(built.excluded.some((row) => row.reason === TRIP_EXCLUSION.no_position), true);
});

test("an ungraded pin is refused for what it is, not called an area", () => {
  // Live London, 18.10: 113 verified places graded "none" — Westminster Abbey among them —
  // were each refused with "names this area, not a spot inside it — none precision".
  const built = buildTripPlan({
    places: [{ place_id: "p3", name: "Westminster Abbey", lat: 51.4993, lng: -0.1273,
      confidence_band: "verified", geocode_precision: "none" }],
    candidates: HOLLYWOOD, origin: ORIGIN, budgetMinutes: 120,
  });
  const refused = built.excluded.find((row) => row.name === "Westminster Abbey");
  assert.equal(refused.reason, TRIP_EXCLUSION.not_a_spot);
  assert.match(refused.note, /do not know how precisely this place is pinned/);
});

test("attachPlaceFilms leaves a place it holds no links for exactly as it was", () => {
  const place = { place_id: "lonely", name: "Somewhere", lat: 1, lng: 1 };
  const [out] = attachPlaceFilms([place], [{ place_id: "other", works: { id: "w", title: "X" } }]);
  assert.equal(out, place);
});

test("attachPlaceFilms lists a film once however many links name it", () => {
  const [out] = attachPlaceFilms([{ place_id: "p" }], [
    { place_id: "p", works: { id: "w1", title: "Skyfall", year: 2012 } },
    { place_id: "p", works: { id: "w1", title: "Skyfall", year: 2012 } },
  ]);
  assert.deepEqual(out.films.map((film) => film.title), ["Skyfall"]);
});
