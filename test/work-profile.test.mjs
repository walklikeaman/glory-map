import assert from "node:assert/strict";
import test from "node:test";

import { createWorkProfileHandler, textlessBackdrops } from "../app/api/work/route.js";
import {
  MAX_PROFILE_PLACES,
  parseProfileQuery,
  placeRole,
  placeSummary,
  placeTally,
  precisionBadge,
  profilePlaces,
  profileRatings,
  sortPlaces,
  sourceLinks,
} from "../app/lib/work-profile.mjs";

const params = (query) => new URL(`http://x/?${query}`).searchParams;

const place = (overrides = {}) => ({
  id: "p1", name: "Leadenhall Market", city: "London", country: "United Kingdom",
  lat: 51.5127, lng: -0.0835, place_class: "real_exterior",
  geocode_precision: "point", confidence: 0.9, wikidata_id: "Q961148",
  relation_kind: "filming_location", ...overrides,
});

// --- the studio distinction, taken from data instead of the name ---------------

test("a studio is identified by its class, not by the word 'studio'", () => {
  // The scene-image matcher tested /studio/i against the NAME, which calls the
  // "Studio Ghibli Museum" a soundstage and misses any lot without the word.
  const museum = place({ name: "Studio Ghibli Museum", place_class: "real_exterior" });
  assert.equal(placeRole(museum).role, "on_location");

  const lot = place({ name: "Leavesden", place_class: "studio_interior" });
  assert.equal(placeRole(lot).role, "studio");
});

test("a studio pin is real, but it says it depicts somewhere else", () => {
  // The product's rule: mark it and show the studio's own geography.
  const summary = placeSummary(place({ name: "Pinewood Studios", place_class: "studio_interior" }));
  assert.equal(summary.depicts_elsewhere, true);
  assert.equal(summary.role_label, "Filmed at a studio");
  assert.equal(summary.lat, 51.5127); // still a real coordinate
});

test("filmed here and set here are different claims", () => {
  assert.equal(placeRole(place({ relation_kind: "narrative_location" })).role, "narrative");
  assert.equal(placeSummary(place({ relation_kind: "narrative_location" })).depicts_elsewhere, false);
  assert.equal(placeRole(place()).role, "on_location");
});

test("a fictional place is never presented as mappable", () => {
  const role = placeRole(place({ name: "Hogwarts", place_class: "fictional" }));
  assert.equal(role.role, "fictional");
  assert.equal(role.mappable, false);
});

test("an unclassified place says so rather than claiming a location", () => {
  assert.equal(placeRole(place({ place_class: "unknown" })).role, "unknown");
  assert.equal(placeRole({}).role, "unknown");
});

// --- precision -----------------------------------------------------------------

test("the badge reports how well we know WHERE", () => {
  assert.equal(precisionBadge(place({ geocode_precision: "city" })), "City only");
  assert.equal(precisionBadge(place({ geocode_precision: "street" })), "Street");
  assert.equal(precisionBadge(place({ geocode_precision: "point" })), "Exact point");
  assert.equal(precisionBadge(place({ geocode_precision: "country" })), "Region only");
  assert.equal(precisionBadge({}), "Unknown precision");
});

test("a snapped building outranks whatever the geocoder claimed", () => {
  // The footprint snap is stronger evidence than the precision string it inherited.
  const snapped = place({ geocode_precision: "city", osm_building_id: "way/88313379" });
  assert.equal(precisionBadge(snapped), "Building");
});

// --- ordering ------------------------------------------------------------------

test("places we actually found come before studios and story settings", () => {
  // "We found the street" is the answer; a studio pin is real but is not that.
  const ordered = sortPlaces([
    placeSummary(place({ id: "n", relation_kind: "narrative_location" })),
    placeSummary(place({ id: "s", place_class: "studio_interior" })),
    placeSummary(place({ id: "r" })),
  ]);
  assert.deepEqual(ordered.map((p) => p.id), ["r", "s", "n"]);
});

test("the tally counts each kind of claim separately", () => {
  const tally = placeTally(profilePlaces([
    place({ id: "a" }), place({ id: "b" }),
    place({ id: "c", place_class: "studio_interior" }),
    place({ id: "d", relation_kind: "narrative_location" }),
  ]));
  assert.equal(tally.on_location, 2);
  assert.equal(tally.studio, 1);
  assert.equal(tally.narrative, 1);
});

test("the place list is bounded", () => {
  const many = Array.from({ length: MAX_PROFILE_PLACES + 30 }, (_, i) => place({ id: `p${i}` }));
  assert.equal(profilePlaces(many).length, MAX_PROFILE_PLACES);
  assert.deepEqual(profilePlaces(null), []);
});

// --- links ---------------------------------------------------------------------

test("every external source is a link, never borrowed content", () => {
  // IMDb's terms forbid extracting their material; pointing at it is fine.
  const links = sourceLinks({
    kind: "film", tmdb_id: "509", imdb_id: "tt0125439",
    rt_path: "m/notting_hill", mc_path: "movie/notting-hill", wikidata_id: "Q217628",
  });
  const byLabel = Object.fromEntries(links.map((l) => [l.label, l.url]));
  assert.match(byLabel.IMDb, /imdb\.com\/title\/tt0125439/);
  assert.match(byLabel["Rotten Tomatoes"], /rottentomatoes\.com\/m\/notting_hill/);
  assert.match(byLabel.Metacritic, /metacritic\.com\/movie\/notting-hill/);
  assert.match(byLabel.TMDB, /themoviedb\.org\/movie\/509/);
});

test("a series links to the tv page, not the movie page", () => {
  const links = sourceLinks({ kind: "series", tmdb_id: "19885" });
  assert.match(links.find((l) => l.label === "TMDB").url, /\/tv\/19885/);
});

test("missing identifiers simply produce no link", () => {
  assert.deepEqual(sourceLinks({ kind: "film" }), []);
  assert.deepEqual(sourceLinks(null), []);
});

test("a rating carries the page it came from", () => {
  const ratings = profileRatings([
    { source: "imdb", display: "7.1/10", score: 7.1, votes: 300000, source_url: "https://www.imdb.com/title/tt0125439/" },
    { source: "broken", display: null, score: null },
  ]);
  assert.equal(ratings.length, 1);
  assert.match(ratings[0].url, /imdb\.com/);
});

// --- the query -----------------------------------------------------------------

test("a profile is addressed by TMDB id, because that is what a live chip has", () => {
  assert.deepEqual(parseProfileQuery(params("film=509")), { kind: "film", tmdbId: "509" });
  assert.deepEqual(parseProfileQuery(params("series=19885")), { kind: "series", tmdbId: "19885" });
  assert.equal(parseProfileQuery(params("film=abc")), null);
  assert.equal(parseProfileQuery(params("")), null);
});

// --- the route -----------------------------------------------------------------

const WORK = { id: "w1", title: "Notting Hill", kind: "film", year: 1999, tmdb_id: "509",
  imdb_id: "tt0125439", wikidata_id: "Q217628", poster_path: "/p.jpg", rt_path: "m/notting_hill" };

function handlerWith(overrides = {}) {
  const calls = { tmdb: [] };
  const handler = createWorkProfileHandler({
    env: { NEXT_PUBLIC_SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k",
      TMDB_API_READ_ACCESS_TOKEN: "t", ...overrides.env },
    createStore: overrides.createStore ?? (() => ({
      loadWork: async () => ("work" in overrides ? overrides.work : WORK),
      loadRatings: async () => overrides.ratings ?? [],
      loadPlaces: async () => overrides.places ?? [],
      loadClassifiedImages: async () => overrides.classified ?? [],
      loadPlaceFrames: async () => overrides.placeFrames ?? [],
    })),
    fetchImpl: overrides.fetchImpl ?? (async (url) => {
      calls.tmdb.push(url);
      return { ok: true, json: async () => ({ backdrops: [{ file_path: "/still.jpg", vote_count: 9, width: 1920, height: 1080 }] }) };
    }),
    logError: () => {},
  });
  return { handler, calls };
}

const request = (query) => new Request(`http://localhost/api/work?${query}`);

test("a work we hold returns its places, ratings and links", async () => {
  const { handler } = handlerWith({
    places: [place(), place({ id: "p2", place_class: "studio_interior", name: "Shepperton" })],
    ratings: [{ source: "imdb", display: "7.1/10", score: 7.1, source_url: "https://www.imdb.com/title/tt0125439/" }],
  });
  const body = await (await handler(request("film=509"))).json();

  assert.equal(body.work.title, "Notting Hill");
  assert.equal(body.work.in_graph, true);
  assert.equal(body.places.length, 2);
  assert.equal(body.tally.on_location, 1);
  assert.equal(body.tally.studio, 1);
  assert.ok(body.links.some((l) => l.label === "IMDb"));
  assert.equal(body.ratings.length, 1);
});

test("a film we do NOT hold still gets a profile instead of an empty page", async () => {
  // Most chips come from the live Wikidata path and are not in our graph.
  const { handler } = handlerWith({ work: null });
  const body = await (await handler(request("film=27205"))).json();

  assert.equal(body.work.in_graph, false);
  assert.equal(body.work.tmdb_id, "27205");
  assert.deepEqual(body.places, []);
  assert.equal(body.stills.length, 1); // stills still arrive
  assert.ok(body.links.some((l) => l.label === "TMDB"));
});

test("stills are labelled as belonging to the film, not to a place", async () => {
  // Tier B of the stills policy: film images, unverified location. Pinning them to a
  // street would be an invention.
  const { handler } = handlerWith();
  const body = await (await handler(request("film=509"))).json();

  assert.match(body.stills_note, /not matched to any location/i);
  assert.match(body.stills[0].url, /image\.tmdb\.org/);
  assert.equal(body.stills[0].place_id, undefined);
});

test("a broken graph still returns the stills rather than failing the page", async () => {
  const { handler } = handlerWith({
    createStore: () => ({
      loadWork: async () => { throw new Error("db down"); },
      loadRatings: async () => [], loadPlaces: async () => [],
    }),
  });
  const response = await handler(request("film=509"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.stills.length, 1);
  assert.equal(body.work.in_graph, false);
  // "No places" because a read failed is not an answer to keep for an hour.
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("a card whose graph read succeeded is still cached publicly", async () => {
  const response = await handlerWith({ places: [place()] }).handler(request("film=509"));
  assert.match(response.headers.get("Cache-Control"), /^public/);
});

test("TMDB being unavailable loses the stills, not the profile", async () => {
  const { handler } = handlerWith({ places: [place()], fetchImpl: async () => ({ ok: false, status: 503 }) });
  const body = await (await handler(request("film=509"))).json();
  assert.deepEqual(body.stills, []);
  assert.equal(body.places.length, 1);
});

test("a rejected bearer token falls back to the api_key scheme", async () => {
  const { handler, calls } = handlerWith({
    env: { TMDB_API_READ_ACCESS_TOKEN: "wrong", TMDB_API_KEY: "right" },
    fetchImpl: async (url, init) => {
      calls.tmdb.push(url);
      if (init.headers.Authorization) return { ok: false, status: 401 };
      return { ok: true, json: async () => ({ backdrops: [{ file_path: "/k.jpg", vote_count: 1 }] }) };
    },
  });
  const body = await (await handler(request("film=509"))).json();
  assert.equal(body.stills.length, 1);
  assert.match(calls.tmdb[1], /api_key=right/);
});

test("a request without an id is rejected before any work is done", async () => {
  const { handler, calls } = handlerWith();
  assert.equal((await handler(request(""))).status, 400);
  assert.equal(calls.tmdb.length, 0);
});

// --- promo art is not a frame from the film ------------------------------------

test("images with text baked in are dropped", () => {
  // Helps, but does not separate promo art from stills — Skyfall's gun-barrel key art
  // is textless too and survives this. The caption is honest about that; only the
  // vision check can actually tell a frame from a poster.
  const filtered = textlessBackdrops([
    { file_path: "/still.jpg", iso_639_1: null },
    { file_path: "/titlecard.jpg", iso_639_1: "en" },
    { file_path: "/another.jpg", iso_639_1: null },
  ]);
  assert.deepEqual(filtered.map((i) => i.file_path), ["/still.jpg", "/another.jpg"]);
});

test("a film with no textless art shows what it has rather than nothing", () => {
  const only = [{ file_path: "/a.jpg", iso_639_1: "en" }];
  assert.deepEqual(textlessBackdrops(only), only);
  assert.deepEqual(textlessBackdrops([]), []);
  assert.deepEqual(textlessBackdrops(null), []);
});

test("the gallery drops promo art end to end", async () => {
  const { handler } = handlerWith({
    fetchImpl: async () => ({ ok: true, json: async () => ({ backdrops: [
      { file_path: "/frame.jpg", iso_639_1: null, vote_count: 5 },
      { file_path: "/keyart.jpg", iso_639_1: "en", vote_count: 99 },
    ] }) }),
  });
  const body = await (await handler(request("film=509"))).json();
  assert.equal(body.stills.length, 1);
  assert.match(body.stills[0].url, /frame\.jpg$/);
});

test("the gallery caption does not promise frames it has not verified", async () => {
  const { handler } = handlerWith();
  const body = await (await handler(request("film=509"))).json();
  assert.match(body.stills_note, /promotional art/i);
  assert.match(body.stills_note, /not matched to any location/i);
});

// --- verified frames beat a raw gallery ----------------------------------------

test("once the classifier has looked, only real frames are shown", async () => {
  const { handler, calls } = handlerWith({
    classified: [
      { file_path: "/frame.jpg", is_frame: true, width: 1920, height: 1080 },
      { file_path: "/keyart.jpg", is_frame: false, width: 1920, height: 1080 },
    ],
  });
  const body = await (await handler(request("film=509"))).json();

  assert.equal(body.stills.length, 1);
  assert.match(body.stills[0].url, /frame\.jpg$/);
  assert.equal(body.stills_verified, true);
  assert.match(body.stills_note, /checked one by one/i);
  // No reason to pay TMDB for a gallery we have already judged.
  assert.equal(calls.tmdb.length, 0);
});

test("an unclassified film still shows its gallery, and says it is unchecked", async () => {
  const { handler } = handlerWith({ classified: [] });
  const body = await (await handler(request("film=509"))).json();

  assert.equal(body.stills_verified, false);
  assert.match(body.stills_note, /includes promotional art/i);
  assert.ok(body.stills.length > 0);
});

test("a film judged to have NO real frames shows none, rather than falling back", async () => {
  // Falling back here would quietly undo the classification we paid for.
  const { handler, calls } = handlerWith({
    classified: [{ file_path: "/keyart.jpg", is_frame: false }],
  });
  const body = await (await handler(request("film=509"))).json();
  assert.deepEqual(body.stills, []);
  assert.equal(body.stills_verified, true);   // we DID look; the answer was "none"
  assert.equal(calls.tmdb.length, 0);         // and we do not go fetch the rejects back
});

// --- tier A: a frame matched to a place ----------------------------------------

test("a matched frame is attached to its PLACE, not to the gallery", async () => {
  // This is the one context where a frame is a claim about where something happened,
  // so it travels with the place and carries the evidence that justified it.
  const { handler } = handlerWith({
    places: [place({ id: "p1" }), place({ id: "p2", name: "Christ Church" })],
    placeFrames: [{ place_id: "p1", file_path: "/matched.jpg", evidence: "The iron arcade matches." }],
  });
  const body = await (await handler(request("film=509"))).json();

  const matched = body.places.find((p) => p.id === "p1");
  const unmatched = body.places.find((p) => p.id === "p2");
  assert.match(matched.scene_frame.url, /matched\.jpg$/);
  assert.match(matched.scene_frame.evidence, /iron arcade/);
  assert.equal(unmatched.scene_frame, undefined);
});

test("a place with no matched frame simply has none", async () => {
  const { handler } = handlerWith({ places: [place()], placeFrames: [] });
  const body = await (await handler(request("film=509"))).json();
  assert.equal(body.places[0].scene_frame, undefined);
});

// --- relations that are neither filmed nor set here -------------------------------------

test("a place the idea came from is neither a filming location nor a setting", () => {
  // Thomas Riddell's grave gave a character its name; Harry Potter does not happen in
  // Greyfriars Kirkyard. Without a role of its own the only options were calling it a
  // filming location, which is false, or dropping it, which is what happened.
  const role = placeRole({ relation_kind: "inspiration_for", place_class: "real_exterior" });
  assert.equal(role.role, "inspiration");
  assert.equal(role.mappable, true);
  assert.match(role.label, /came from here/i);
});

test("a replica says so, rather than claiming a shoot", () => {
  // The Green Dragon and Bagshot Row's interior were built for visitors and never shot
  // in; the trolley at King's Cross is on a concourse while the films used platforms 4
  // and 5. "Filmed here" about these is a confident false claim that looks right.
  const role = placeRole({ relation_kind: "replica", place_class: "real_exterior" });
  assert.equal(role.role, "replica");
  assert.match(role.label, /not filmed here/i);
});

test("the author's own places have a role too", () => {
  assert.equal(placeRole({ relation_kind: "author_place" }).role, "author");
});

// --- a place on the card is a FACT, and a fact says what it claims (#129) --------

test("the card prints the sentence the source stated, not our template", () => {
  const summary = placeSummary(place({
    subject_type: "creator",
    subject_name: "J. K. Rowling",
    relation_kind: "wrote_here",
    statement: "J. K. Rowling wrote some of the early chapters of Harry Potter here.",
  }));
  assert.equal(summary.sentence, "J. K. Rowling wrote some of the early chapters of Harry Potter here.");
  assert.equal(summary.subject_type, "creator");
  assert.equal(summary.subject_name, "J. K. Rowling");
});

test("a place with no stated wording still gets a sentence", () => {
  const summary = placeSummary(place({ subject_name: "Notting Hill" }));
  assert.equal(summary.sentence, "Notting Hill was filmed at Leadenhall Market.");
});

test("a fact carries how far it stands from the work, and whether a route may take it", () => {
  assert.equal(placeSummary(place()).distance, 0);
  assert.equal(placeSummary(place()).routable, true);

  const inspiration = placeSummary(place({ relation_kind: "inspiration_for" }));
  assert.equal(inspiration.distance, 2);
  assert.equal(inspiration.routable, false);
  assert.match(inspiration.distance_label, /nearby/i);
});

test("the distance the RPC computed wins over the one we would derive", () => {
  // work_facts() returns it. A client that re-derives it is a second opinion on a
  // question the schema already answered, and the two will diverge.
  const summary = placeSummary(place({ relation_kind: "filming_location", distance: 2 }));
  assert.equal(summary.distance, 2);
  assert.equal(summary.routable, false);
});

test("a person's place sorts below every place the work itself was shot at", () => {
  // Otherwise one plaque about a screenwriter outranks the street in the opening shot.
  const sorted = sortPlaces([
    placeSummary(place({ id: "author", subject_type: "creator", relation_kind: "lived_here", confidence: 0.99 })),
    placeSummary(place({ id: "shot", relation_kind: "filming_location", confidence: 0.4 })),
  ]);
  assert.deepEqual(sorted.map((p) => p.id), ["shot", "author"]);
});

test("the card is told how many sources back a place", () => {
  // Printed even when zero: 8 of the 92 links in the graph carry no evidence row, and a
  // reader is entitled to notice that.
  assert.equal(placeSummary(place({ evidence_count: 3 })).evidence_count, 3);
  assert.equal(placeSummary(place({ evidence_count: 0 })).evidence_count, 0);
  assert.equal(placeSummary(place()).evidence_count, null);
});
