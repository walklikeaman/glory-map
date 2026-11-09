import assert from "node:assert/strict";
import test from "node:test";

import {
  AMBIENT_RADIUS_M, FEED_HALF_SIZE_M, FEED_REFRESH_M, MAX_SPOKEN_FILMS, QUIET_GAP_MS, SAME_SPOT_M,
  candidatePlaceText, checkedPlaceText, feedBox, feedNeedsRefresh, feedUrl,
  nearbyFromMapResponse, pickAmbient, spokenSeconds, tellingFor,
} from "../app/lib/ambient-walk.mjs";

// Hollywood Blvd, by the Pantages — the real shapes /api/map/points returns there.
const HERE = [34.10211, -118.32573];
const fix = (coords, accuracy = 10) => ({ coords, accuracy });
const north = (metres, from = HERE) => [from[0] + metres / 111_320, from[1]];

const PANTAGES_FILMS = [
  {
    title: "Friends with Benefits", year: 2011, kind: "film", work_id: "w1", imdb_votes: 423565,
    note: "Friends With Benefits film location: Kayla splits up with Dylan: Pantages Theatre, Hollywood Boulevard, Hollywood",
    place_name: "Pantages Theatre, Hollywood Boulevard, Hollywood",
    source_kind: "movielocations", status: "pending",
  },
  {
    title: "The Bodyguard", year: 1992, kind: "film", work_id: "w2", imdb_votes: 380000,
    note: "The Bodyguard film location: interior of the Oscar ceremony: Pantages Theatre, Hollywood Boulevard, Hollywood",
    place_name: "Pantages Theatre, Hollywood Boulevard, Hollywood",
    source_kind: "moviemaps", status: "pending",
  },
  { title: "Ed Wood", year: 1994, work_id: "w3", imdb_votes: 200000, source_kind: "moviemaps" },
];

const MAP_RESPONSE = {
  features: [{
    type: "Feature",
    geometry: { type: "Point", coordinates: [-118.32426, 34.09829] },
    properties: { place_id: "2b453aa8-7bfc-486c-8266-8a73f872a6a7", name: "Hollywood Palladium", work_count: 2, shot_on_set: false },
  }, {
    type: "Feature", geometry: { type: "Point", coordinates: [200, 0] }, properties: { place_id: "bad" },
  }],
  candidates: [{
    type: "Feature",
    geometry: { type: "Point", coordinates: [HERE[1], HERE[0]] },
    properties: { candidate: true, name: "Hollywood Pantages Theatre", work_count: 6, films: PANTAGES_FILMS },
  }],
};

test("the feed keeps checked places and listings apart, and drops what cannot be placed", () => {
  const places = nearbyFromMapResponse(MAP_RESPONSE);
  assert.equal(places.length, 2);
  const [palladium, pantages] = places;
  assert.equal(palladium.checked, true);
  assert.equal(palladium.id, "place:2b453aa8-7bfc-486c-8266-8a73f872a6a7");
  assert.deepEqual(palladium.position, [34.09829, -118.32426]);
  assert.equal(pantages.checked, false);
  assert.equal(pantages.workCount, 6);
  assert.equal(pantages.films.length, 3);
  assert.deepEqual(nearbyFromMapResponse(null), []);
});

// A place must be in the feed before it can come into range, or it is walked past in
// silence. The margin between the box and the refresh distance guarantees that.
test("the feed is always wider than the walker can move before it is re-read", () => {
  assert.ok(FEED_HALF_SIZE_M - FEED_REFRESH_M > AMBIENT_RADIUS_M);
  const box = feedBox(HERE);
  assert.ok(box.north > HERE[0] && box.south < HERE[0] && box.east > HERE[1] && box.west < HERE[1]);
  // 250 m is further in degrees of longitude than of latitude away from the equator.
  assert.ok(box.east - HERE[1] > box.north - HERE[0]);
  assert.equal(feedNeedsRefresh(null, HERE), true);
  assert.equal(feedNeedsRefresh(HERE, north(FEED_REFRESH_M - 5)), false);
  assert.equal(feedNeedsRefresh(HERE, north(FEED_REFRESH_M + 5)), true);
  assert.equal(feedNeedsRefresh(HERE, null), false);
});

test("the feed asks the map for individual places and the queue", () => {
  const url = new URL(feedUrl(HERE), "http://x");
  assert.equal(url.pathname, "/api/map/points");
  assert.equal(url.searchParams.get("z"), "17");
  assert.equal(url.searchParams.get("candidates"), "1");
  assert.equal(feedUrl(null), null);
});

function place(id, metres, { checked = false, workCount = 1 } = {}) {
  return { id, checked, workCount, name: id, position: north(metres) };
}

test("nothing speaks while the guide is talking or catching its breath", () => {
  const places = [place("a", 5)];
  assert.equal(pickAmbient(places, fix(HERE), { busy: true }), null);
  assert.equal(pickAmbient(places, fix(HERE), { now: 1_000, quietUntil: 1_000 + QUIET_GAP_MS }), null);
  assert.equal(pickAmbient(places, fix(HERE), { now: 1_000 + QUIET_GAP_MS, quietUntil: 1_000 + QUIET_GAP_MS }).place.id, "a");
});

test("only a place within the radius, and only on a fix good enough to say so", () => {
  const places = [place("far", AMBIENT_RADIUS_M + 10)];
  assert.equal(pickAmbient(places, fix(HERE)), null);
  assert.equal(pickAmbient([place("near", 10)], fix(HERE, 500)), null, "a 500 m fix is not a location");
  assert.equal(pickAmbient([place("near", 10)], fix(HERE)).distance_m, 10);
});

// Nearest-first would let whichever pin the geocoder put closest to the pavement win.
test("the better-evidenced place speaks first", () => {
  const places = [
    place("listing, nearest", 3, { workCount: 9 }),
    place("checked, further", 40, { checked: true, workCount: 1 }),
  ];
  assert.equal(pickAmbient(places, fix(HERE)).place.id, "checked, further");

  const listings = [place("one film, near", 3, { workCount: 1 }), place("six films", 35, { workCount: 6 })];
  assert.equal(pickAmbient(listings, fix(HERE)).place.id, "six films");

  const tie = [place("b", 20, { workCount: 2 }), place("a", 10, { workCount: 2 })];
  assert.equal(pickAmbient(tie, fix(HERE)).place.id, "a");
});

// "Pantages Theatre" in the graph and "Hollywood Pantages Theatre" in the queue.
test("a place is told once, and so is the building it stands on", () => {
  const told = place("pantages, graph", 0, { checked: true });
  const sameBuilding = place("pantages, queue", SAME_SPOT_M - 5);
  const nextDoor = place("next door", SAME_SPOT_M + 10);
  const spoken = [{ id: told.id, position: told.position }];

  assert.equal(pickAmbient([told, sameBuilding], fix(HERE), { spoken }), null);
  assert.equal(pickAmbient([told, sameBuilding, nextDoor], fix(HERE), { spoken }).place.id, "next door");
});

test("an unchecked listing says so first, names its sources, and drops the address", () => {
  const text = candidatePlaceText({ name: "Hollywood Pantages Theatre", films: PANTAGES_FILMS });
  assert.equal(
    text,
    "Not confirmed yet. Movie-Locations and MovieMaps list Hollywood Pantages Theatre as a filming location. "
      + "Friends with Benefits, 2011: Kayla splits up with Dylan. The Bodyguard, 1992: interior of the Oscar ceremony. "
      + "And one more film.",
  );
  assert.doesNotMatch(text, /Hollywood Boulevard/, "the address is the pin's own name, not a scene");
});

// Headphones get pulled out mid-sentence. Wherever the audio stops, the listener must
// not have heard more than we know.
test("no part of an unchecked telling makes a claim before the qualifier", () => {
  const text = candidatePlaceText({ name: "Hollywood Pantages Theatre", films: PANTAGES_FILMS });
  const qualifier = text.indexOf("Not confirmed yet");
  assert.equal(qualifier, 0);
  for (const film of PANTAGES_FILMS) {
    const at = text.indexOf(film.title);
    if (at >= 0) assert.ok(at > qualifier, film.title);
  }
});

test("a listing with one source says 'lists', and one without films says nothing", () => {
  const one = candidatePlaceText({ name: "Hollywood Tower Apartments", films: [PANTAGES_FILMS[1]] });
  assert.match(one, /^Not confirmed yet\. MovieMaps lists Hollywood Tower Apartments as a filming location\. The Bodyguard, 1992/);
  assert.equal(candidatePlaceText({ name: "Somewhere", films: [] }), null);
  assert.equal(candidatePlaceText({ name: "Somewhere", films: [{ note: "no title" }] }), null);
});

test(`at most ${MAX_SPOKEN_FILMS} films are read, the rest are counted`, () => {
  const many = Array.from({ length: 6 }, (_, index) => ({
    title: `Film ${index}`, year: 2000 + index, work_id: `w${index}`, imdb_votes: 100 - index, source_kind: "moviemaps",
  }));
  const text = candidatePlaceText({ name: "A corner", films: many });
  assert.match(text, /Film 0, 2000\. Film 1, 2001\. And 4 more films\.$/);
});

// The graph's sentences were written against a source at the strength we hold them;
// the telling repeats them and adds nothing, not even the name they already contain.
test("a checked place is told in the graph's own sentences", () => {
  const facts = [
    { subject_type: "work", sentence: "Almost Famous was filmed at Hollywood Palladium." },
    { subject_type: "work", sentence: "The Blues Brothers was filmed at Hollywood Palladium" },
    { subject_type: "work", sentence: "Almost Famous was filmed at Hollywood Palladium." },
    { subject_type: "creator", sentence: "Somebody was born here." },
    { subject_type: "work", sentence: "La La Land was filmed at Hollywood Palladium." },
  ];
  assert.equal(
    checkedPlaceText({ facts }),
    "Almost Famous was filmed at Hollywood Palladium. The Blues Brothers was filmed at Hollywood Palladium. And one more film.",
  );
  assert.equal(checkedPlaceText({ facts: [] }), null);
  assert.equal(checkedPlaceText({}), null);
});

test("a telling is fetched only for a checked place, and a failed fetch says nothing", async () => {
  const [palladium, pantages] = nearbyFromMapResponse(MAP_RESPONSE);
  let asked = null;
  const fetchImpl = async (url) => {
    asked = url;
    return { ok: true, json: async () => ({ facts: [{ subject_type: "work", sentence: "Almost Famous was filmed at Hollywood Palladium." }] }) };
  };
  assert.equal(await tellingFor(palladium, { fetchImpl }), "Almost Famous was filmed at Hollywood Palladium.");
  assert.equal(asked, "/api/place?id=2b453aa8-7bfc-486c-8266-8a73f872a6a7");

  asked = null;
  assert.match(await tellingFor(pantages, { fetchImpl }), /^Not confirmed yet\./);
  assert.equal(asked, null, "a listing carries its own sentences");

  assert.equal(await tellingFor(palladium, { fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal(await tellingFor(null), null);
});

// Measured on four real tellings: 12.4-15.0 characters a second.
test("the length of a telling is estimated at the measured speaking rate", () => {
  assert.equal(spokenSeconds("x".repeat(235)), 18);   // measured 17.9 s
  assert.equal(spokenSeconds("x".repeat(102)), 8);    // measured 6.8 s
  assert.equal(spokenSeconds(""), 3);
});

// The pacing, walked. Places every 70 m along a straight 1 km street at 4.2 km/h, one
// fix every 5 s, each telling 15 s: every place in range is told, one at a time, with
// never less than the quiet gap between the end of one and the start of the next.
test("walked past a place every 70 m, the guide tells one at a time and breathes between", () => {
  const places = Array.from({ length: 14 }, (_, index) => place(`p${index}`, 70 * (index + 1)));
  const spoken = [];
  const starts = [];
  let busyUntil = 0;
  let quietUntil = 0;
  for (let t = 0, metres = 0; metres <= 1_000; t += 5_000, metres += (4.2 / 3.6) * 5) {
    const hit = pickAmbient(places, fix(north(metres)), { spoken, busy: t < busyUntil, now: t, quietUntil });
    if (!hit) continue;
    starts.push(t);
    spoken.push({ id: hit.place.id, position: hit.place.position });
    busyUntil = t + 15_000;
    quietUntil = busyUntil + QUIET_GAP_MS;
  }
  assert.equal(new Set(spoken.map((entry) => entry.id)).size, spoken.length, "nothing told twice");
  assert.ok(spoken.length >= 12, `${spoken.length} of 14 told`);
  for (let index = 1; index < starts.length; index += 1) {
    assert.ok(starts[index] - starts[index - 1] >= 15_000 + QUIET_GAP_MS);
  }
});

test("a trail stop says its own film's sentence, and nothing when it has none", async () => {
  const { trailStopText } = await import("../app/lib/ambient-walk.mjs");
  assert.equal(trailStopText({ sentence: "Notting Hill was filmed at Portobello Road" }), "Notting Hill was filmed at Portobello Road.");
  assert.equal(trailStopText({ sentence: "  " }), null);
  assert.equal(trailStopText({}), null);
  assert.equal(trailStopText(null), null);
});
