import assert from "node:assert/strict";
import test from "node:test";

import { createTripPlanHandler, parseTripBody } from "../app/api/trip/plan/route.js";

const HOLLYWOOD_BBOX = { west: -118.36, south: 34.085, east: -118.30, north: 34.115 };

// The rows in the shape `map_candidate_points_in_view` returns them.
const CANDIDATES = [
  { submission_id: "s1", work_id: "w1", work_title: "Forrest Gump", name: "Grauman's Chinese Theatre",
    lat: 34.10204, lng: -118.34093, status: "pending", source_kind: "moviemaps",
    source_url: "https://moviemaps.org/1", area_hint: "6925 Hollywood Boulevard" },
  { submission_id: "s2", work_id: "w2", work_title: "Hacks", name: "Madame Tussauds Hollywood",
    lat: 34.10178, lng: -118.34145, status: "pending", source_kind: "moviemaps",
    source_url: "https://moviemaps.org/2", area_hint: "6933 Hollywood Blvd" },
  { submission_id: "s3", work_id: "w3", work_title: "The Muppets", name: "El Capitan Theatre",
    lat: 34.10132, lng: -118.33993, status: "pending", source_kind: "moviemaps",
    source_url: "https://moviemaps.org/3", area_hint: "6838 Hollywood Blvd" },
];

const OSRM_OK = {
  code: "Ok",
  routes: [{
    distance: 420, duration: 380,
    geometry: { type: "LineString", coordinates: [[-118.34093, 34.10204], [-118.33993, 34.10132]] },
  }],
};

function request(body, { token = null } = {}) {
  return {
    json: async () => body,
    url: "https://glorymap.test/api/trip/plan",
    headers: { get: (name) => (name.toLowerCase() === "authorization" && token ? `Bearer ${token}` : null) },
  };
}

function handlerWith({ candidates = CANDIDATES, places = [], router = OSRM_OK, readerError = null } = {}) {
  const calls = { rpc: [], router: [] };
  const handler = createTripPlanHandler({
    env: { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" },
    createReader: () => ({
      points: async (params) => { calls.rpc.push(["points", params]); if (readerError) throw readerError; return places; },
      candidatePoints: async (params) => { calls.rpc.push(["candidates", params]); if (readerError) throw readerError; return candidates; },
    }),
    fetchImpl: async (url) => {
      calls.router.push(String(url));
      if (router instanceof Error) throw router;
      return { ok: true, status: 200, json: async () => router };
    },
    logError: () => {},
  });
  return { handler, calls };
}

test("a Hollywood viewport comes back as an ordered walk with a line on the map", async () => {
  const { handler, calls } = handlerWith();
  const response = await handler(request({ bbox: HOLLYWOOD_BBOX, budgetMinutes: 120 }));
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.stops.length, 3);
  assert.deepEqual(body.stops.map((stop) => stop.order), [1, 2, 3]);
  assert.equal(body.walk.distanceKm, 0.4);
  assert.equal(body.walk.source, "openstreetmap-foot");
  assert.equal(calls.router.length, 1, "one router call for the whole walk");
});

test("every stop states which store it came from and who said it", async () => {
  const { handler } = handlerWith();
  const { stops } = await (await handler(request({ bbox: HOLLYWOOD_BBOX }))).json();
  for (const stop of stops) {
    assert.equal(stop.grounding.verified, false);
    assert.equal(stop.grounding.store, "queue");
    assert.ok(stop.grounding.source_url);
  }
});

test("the honesty line and the caveat travel with the payload, not in a doc somewhere", async () => {
  const { handler } = handlerWith();
  const body = await (await handler(request({ bbox: HOLLYWOOD_BBOX }))).json();
  assert.match(body.honesty, /None of these 3 stops is verified/);
  assert.match(body.caveat, /never means open/);
  assert.equal(body.min_stops, 3);
});

test("coverage says whether we looked at everything or only the first thousand rows", async () => {
  const many = Array.from({ length: 1000 }, (unused, index) => ({
    submission_id: `m${index}`, work_id: `w${index}`, work_title: `Film ${index}`,
    name: `Place ${index}`, lat: 34.10 + index / 100000, lng: -118.34, status: "pending",
    source_kind: "moviemaps", source_url: `https://moviemaps.org/${index}`,
  }));
  const { handler } = handlerWith({ candidates: many });
  const body = await (await handler(request({ bbox: HOLLYWOOD_BBOX }))).json();
  assert.equal(body.coverage.candidates_in_view, 1000);
  assert.equal(body.coverage.truncated, true, "Los Angeles holds 4,665 rows and the cap is 1,000");
});

// --- the library never leaves the browser ---------------------------------------------

test("a plan filtered by somebody's films is never cached at the edge", async () => {
  const { handler } = handlerWith();
  const withLibrary = await handler(request({
    bbox: HOLLYWOOD_BBOX, library: [{ title: "Forrest Gump", year: 1994 }],
  }));
  assert.equal(withLibrary.headers.get("Cache-Control"), "private, no-store");

  const without = await handler(request({ bbox: HOLLYWOOD_BBOX }));
  assert.match(without.headers.get("Cache-Control"), /public, s-maxage=3600/);
});

test("the library filters the stops and is not echoed back", async () => {
  const { handler } = handlerWith();
  const body = await (await handler(request({
    bbox: HOLLYWOOD_BBOX, library: [{ title: "Forrest Gump", year: 1994 }],
  }))).json();
  assert.ok(!("library" in body), "nothing sent in is written down or handed back");
  assert.ok(body.excluded.some((row) => row.reason === "not_in_library"));
});

test("an oversized library is refused rather than parsed", async () => {
  const { handler } = handlerWith();
  const response = await handler(request({
    bbox: HOLLYWOOD_BBOX,
    library: Array.from({ length: 20_001 }, () => ({ title: "x", year: 2000 })),
  }));
  assert.equal(response.status, 400);
});

// --- validation -----------------------------------------------------------------------

test("a bbox is required and a bad one is a 400, never an empty plan", async () => {
  const { handler } = handlerWith();
  assert.equal((await handler(request({}))).status, 400);
  assert.equal((await handler(request({ bbox: { west: -118 } }))).status, 400);
  assert.equal((await handler(request({ bbox: { ...HOLLYWOOD_BBOX, north: 200 } }))).status, 400);
});

test("a budget the planner does not offer is a 400 and not a silent rounding", async () => {
  const { handler } = handlerWith();
  const response = await handler(request({ bbox: HOLLYWOOD_BBOX, budgetMinutes: 45 }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /budgetMinutes must be one of 30, 60, 120/);
});

test("parseTripBody normalises a flipped bbox instead of returning its complement", () => {
  const parsed = parseTripBody({ bbox: { west: -118.36, east: -118.30, south: 34.115, north: 34.085 } });
  assert.equal(parsed.south, undefined);
  assert.equal(parsed.bbox.south, 34.085);
  assert.equal(parsed.bbox.north, 34.115);
});

test("a body that is not JSON is a 400", async () => {
  const { handler } = handlerWith();
  const response = await handler({ json: async () => { throw new Error("nope"); }, url: "https://x/y" });
  assert.equal(response.status, 400);
});

// --- failure modes --------------------------------------------------------------------

test("a dead router loses the line and never the plan", async () => {
  const { handler } = handlerWith({ router: new Error("OSRM down") });
  const response = await handler(request({ bbox: HOLLYWOOD_BBOX }));
  assert.equal(response.status, 200, "five addresses in walking order is still an afternoon");

  const body = await response.json();
  assert.equal(body.walk, null);
  assert.equal(body.stops.length, 3);
});

test("a graph that cannot be read is a 502 and says so", async () => {
  const { handler } = handlerWith({ readerError: new Error("connection refused") });
  const response = await handler(request({ bbox: HOLLYWOOD_BBOX }));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Could not read places/);
});

test("no credentials is a 503, which is a different problem from an empty viewport", async () => {
  const handler = createTripPlanHandler({ env: {}, logError: () => {} });
  const response = await handler(request({ bbox: HOLLYWOOD_BBOX }));
  assert.equal(response.status, 503);
});

test("an empty viewport is an honest empty plan, not an error", async () => {
  const { handler } = handlerWith({ candidates: [] });
  const response = await handler(request({ bbox: HOLLYWOOD_BBOX }));
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.stops.length, 0);
  assert.equal(body.enough, false);
  assert.equal(body.walk, null, "the router is never called for a plan with nothing in it");
});

test("the map's own readers are used, at the zoom that returns places and not grid cells", async () => {
  const { handler, calls } = handlerWith();
  await handler(request({ bbox: HOLLYWOOD_BBOX }));
  assert.deepEqual(calls.rpc.map(([name]) => name).sort(), ["candidates", "points"]);
  for (const [, params] of calls.rpc) {
    assert.equal(params.p_zoom, 15);
    assert.equal(params.p_cluster_below_zoom, 0, "a cluster is not a place and cannot be walked to");
  }
});

test("candidates can be turned off, and then the graph is all there is", async () => {
  const { handler, calls } = handlerWith();
  const body = await (await handler(request({ bbox: HOLLYWOOD_BBOX, includeCandidates: false }))).json();
  assert.equal(body.stops.length, 0, "the LA graph holds one place: a plan from it alone is empty");
  assert.ok(!calls.rpc.some(([name]) => name === "candidates"));
});


// An agent acts for the owner in another process: no localStorage, and carrying 2,798
// titles into every call is a workaround, not a design. So the list may live on the
// account — and the route must prove the caller owns it before handing anything back.
function handlerWithLibrary(stored, { throws = null } = {}) {
  const seen = [];
  const handler = createTripPlanHandler({
    env: { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" },
    createReader: () => ({
      points: async () => [],
      candidatePoints: async () => CANDIDATES,
    }),
    readStoredLibrary: () => async (token) => {
      seen.push(token);
      if (throws) throw throws;
      return stored;
    },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => OSRM_OK }),
    logError: () => {},
  });
  return { handler, seen };
}

test("a plan can be filtered by the list on the caller's account", async () => {
  const { handler, seen } = handlerWithLibrary([{ title: "Forrest Gump", year: 1994 }]);
  const response = await handler(request(
    { bbox: HOLLYWOOD_BBOX, budgetMinutes: 120, useStoredLibrary: true },
    { token: "tok-123" },
  ));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(seen, ["tok-123"]);
  // Two of the three Hollywood stops are not in the account's list, and each says so.
  assert.deepEqual(
    body.excluded.filter((row) => row.reason === "not_in_library").map((row) => row.name).sort(),
    ["El Capitan Theatre", "Madame Tussauds Hollywood"],
  );
  // Which list it filtered by, never the titles back.
  assert.deepEqual(body.filtered_by, { source: "account", titles: 1 });
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

// A list in the body is the more specific instruction, and the only one a caller without
// an account has.
test("a list in the body wins over the one on the account", async () => {
  const { handler, seen } = handlerWithLibrary([{ title: "Forrest Gump", year: 1994 }]);
  const response = await handler(request({
    bbox: HOLLYWOOD_BBOX, budgetMinutes: 120, useStoredLibrary: true,
    library: [{ title: "The Muppets", year: 2011 }],
  }, { token: "tok-123" }));

  const body = await response.json();
  assert.deepEqual(seen, [], "the account was never read");
  assert.deepEqual(
    body.excluded.filter((row) => row.reason === "not_in_library").map((row) => row.name).sort(),
    ["Grauman's Chinese Theatre", "Madame Tussauds Hollywood"],
  );
  assert.deepEqual(body.filtered_by, { source: "request", titles: 1 });
});

// Silently planning from the whole catalogue when somebody asked for their own films would
// hand them a list of films they have never seen, labelled as films they have.
test("asking for my films without a token is refused, not quietly widened", async () => {
  const { handler } = handlerWithLibrary([{ title: "Forrest Gump", year: 1994 }]);
  const response = await handler(request({ bbox: HOLLYWOOD_BBOX, useStoredLibrary: true }));
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Authorization: Bearer/);
});

test("a token that identifies nobody is refused", async () => {
  const { handler } = handlerWithLibrary(null);
  const response = await handler(request(
    { bbox: HOLLYWOOD_BBOX, useStoredLibrary: true }, { token: "stale" },
  ));
  assert.equal(response.status, 401);
});

test("an account with no library says so instead of planning from everything", async () => {
  const { handler } = handlerWithLibrary([]);
  const response = await handler(request(
    { bbox: HOLLYWOOD_BBOX, useStoredLibrary: true }, { token: "tok-123" },
  ));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /import one first/);
});

test("a failure reading the account is a 502, never an unfiltered plan", async () => {
  const { handler } = handlerWithLibrary(null, { throws: new Error("network") });
  const response = await handler(request(
    { bbox: HOLLYWOOD_BBOX, useStoredLibrary: true }, { token: "tok-123" },
  ));
  assert.equal(response.status, 502);
});

test("an unfiltered plan says it was filtered by nothing", async () => {
  const { handler } = handlerWithLibrary([]);
  const body = await (await handler(request({ bbox: HOLLYWOOD_BBOX }))).json();
  assert.equal(body.filtered_by, null);
});

// --- verified places name their films --------------------------------------------------

// The live Rome viewport, 18.10: three graph places from two films, and the queue rows
// around them. `map_points_in_view` answers a graph place with no titles at all.
const ROME_BBOX = { west: 12.46, south: 41.885, east: 12.50, north: 41.915 };
const ROME_PLACES = [
  { point_kind: "place", place_id: "steps", wikidata_id: "Q848072", name: "Spanish Steps",
    lat: 41.90599, lng: 12.482775, geocode_precision: "point", confidence_band: "verified", work_count: 2 },
  { point_kind: "place", place_id: "trevi", wikidata_id: "Q185382", name: "Fontana di Trevi",
    lat: 41.900933, lng: 12.483318, geocode_precision: "point", confidence_band: "verified", work_count: 3 },
  { point_kind: "place", place_id: "popolo", wikidata_id: "Q824997", name: "Piazza del Popolo",
    lat: 41.910541, lng: 12.476381, geocode_precision: "point", confidence_band: "verified", work_count: 1 },
];
const ROME_LINKS = [
  { place_id: "steps", works: { id: "w-love", title: "To Rome with Love", year: 2012, kind: "film" } },
  { place_id: "steps", works: { id: "w-holiday", title: "Roman Holiday", year: 1953, kind: "film" } },
  { place_id: "trevi", works: { id: "w-love", title: "To Rome with Love", year: 2012, kind: "film" } },
  { place_id: "trevi", works: { id: "w-gypsies", title: "Time of the Gypsies", year: 1988, kind: "film" } },
  { place_id: "popolo", works: { id: "w-love", title: "To Rome with Love", year: 2012, kind: "film" } },
];

function romeHandler({ placeWorks = async () => ROME_LINKS } = {}) {
  const asked = [];
  const handler = createTripPlanHandler({
    env: { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" },
    createReader: () => ({
      points: async () => ROME_PLACES,
      candidatePoints: async () => [],
      placeWorks: async (ids) => { asked.push(ids); return placeWorks(ids); },
    }),
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => OSRM_OK }),
    logError: () => {},
  });
  return { handler, asked };
}

test("a verified stop names the films filmed there, oldest first", async () => {
  const { handler, asked } = romeHandler();
  const body = await (await handler(request({ bbox: ROME_BBOX, includeCandidates: false }))).json();

  assert.deepEqual(asked, [["steps", "trevi", "popolo"]], "one read for every graph place in view");
  const steps = body.stops.find((stop) => stop.name === "Spanish Steps");
  assert.equal(steps.grounding.verified, true);
  assert.equal(steps.work.title, "Roman Holiday");
  assert.deepEqual(steps.works.sort(), ["Roman Holiday", "To Rome with Love"]);
});

test("a library keeps the verified places of its own films instead of refusing them", async () => {
  // Live before the fix: every graph place was "not_in_library" and the plan was three
  // unchecked queue rows.
  const { handler } = romeHandler();
  const body = await (await handler(request({
    bbox: ROME_BBOX,
    library: [{ title: "Roman Holiday", year: 1953 }, { title: "To Rome with Love", year: 2012 }],
  }))).json();

  assert.deepEqual(body.stops.map((stop) => stop.name).sort(),
    ["Fontana di Trevi", "Piazza del Popolo", "Spanish Steps"]);
  assert.ok(body.stops.every((stop) => stop.grounding.verified));
  assert.equal(body.excluded.filter((row) => row.reason === "not_in_library").length, 0);
});

test("a film that is not the stop's lead still makes it the traveller's stop", async () => {
  const { handler } = romeHandler();
  const body = await (await handler(request({
    bbox: ROME_BBOX, library: [{ title: "To Rome with Love", year: 2012 }],
  }))).json();
  // Roman Holiday (1953) leads the Spanish Steps; To Rome with Love is second there.
  const steps = body.stops.find((stop) => stop.name === "Spanish Steps");
  assert.ok(steps, "the second film at a stop counts as much as the first");
  assert.equal(steps.work.title, "Roman Holiday");
});

test("a stop with none of the traveller's films is still refused", async () => {
  const { handler } = romeHandler();
  const body = await (await handler(request({
    bbox: ROME_BBOX, library: [{ title: "Time of the Gypsies", year: 1988 }],
  }))).json();
  assert.ok(body.excluded.some((row) => row.name === "Spanish Steps" && row.reason === "not_in_library"));
  assert.ok(!body.excluded.some((row) => row.name === "Fontana di Trevi"));
});

test("titles that cannot be read cost the stops their names, never the plan", async () => {
  const { handler } = romeHandler({ placeWorks: async () => { throw new Error("db down"); } });
  const response = await handler(request({ bbox: ROME_BBOX }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).stops.length, 3);
});
