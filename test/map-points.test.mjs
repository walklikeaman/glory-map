import assert from "node:assert/strict";
import test from "node:test";

import { createMapPointsHandler } from "../app/api/map/points/route.js";
import {
  buildMapResponse,
  CLUSTER_BELOW_ZOOM,
  candidateFeatures,
  MAX_MAP_POINTS,
  MAX_ROWS_PER_RESPONSE,
  parseMapQuery,
  pointBadge,
  viewportCenter,
} from "../app/lib/map-points.mjs";

const params = (object) => new URLSearchParams(object);
const LONDON = { west: "-0.35", south: "51.35", east: "0.05", north: "51.65" };

function placeRow(overrides = {}) {
  return {
    point_kind: "place",
    place_id: "11111111-1111-1111-1111-111111111111",
    wikidata_id: "Q129143",
    name: "Trafalgar Square",
    lat: 51.508,
    lng: -0.128,
    place_class: "real_exterior",
    geocode_precision: "point",
    shot_on_set: false,
    confidence: 0.9,
    confidence_band: "verified",
    work_count: 3,
    evidence_count: 1,
    cluster_count: 1,
    ...overrides,
  };
}

// --- query parsing -----------------------------------------------------------

test("parseMapQuery rejects a missing or out-of-range bbox", () => {
  assert.match(parseMapQuery(params({})).error, /bbox/);
  assert.match(parseMapQuery(params({ ...LONDON, north: "999" })).error, /bbox/);
  assert.match(parseMapQuery(params({ ...LONDON, west: "abc" })).error, /bbox/);
});

test("parseMapQuery names the zoom as the problem, not the bbox", () => {
  assert.match(parseMapQuery(params({ ...LONDON, z: "99" })).error, /Zoom/);
});

test("parseMapQuery preserves an antimeridian-crossing viewport", () => {
  // west > east is a real window across the date line. Sorting the pair would turn
  // the strip in front of the user into its own complement — the rest of the world.
  const query = parseMapQuery(params({ west: "170", south: "-60", east: "-170", north: "75", z: "13" }));
  assert.equal(query.west, 170);
  assert.equal(query.east, -170);
});

test("parseMapQuery refuses a filter it cannot honour instead of widening silently", () => {
  // Quietly dropping a bad workId would answer "this film's places" with the whole
  // graph — a wrong answer dressed as a successful one.
  assert.match(parseMapQuery(params({ ...LONDON, workId: "not-a-uuid" })).error, /workId/);
  assert.match(parseMapQuery(params({ ...LONDON, kinds: "film,nonsense" })).error, /kinds/);
  assert.match(parseMapQuery(params({ ...LONDON, kinds: "" })).error, /kinds/);
});

test("parseMapQuery normalizes flipped latitudes and rounds the zoom", () => {
  const query = parseMapQuery(params({ west: "-0.35", east: "0.05", south: "51.65", north: "51.35", z: "13.4" }));
  assert.equal(query.south, 51.35);
  assert.equal(query.north, 51.65);
  assert.equal(query.zoom, 13);
});

test("parseMapQuery switches to clustering below the zoom threshold", () => {
  assert.equal(parseMapQuery(params({ ...LONDON, z: String(CLUSTER_BELOW_ZOOM - 1) })).clustered, true);
  assert.equal(parseMapQuery(params({ ...LONDON, z: String(CLUSTER_BELOW_ZOOM) })).clustered, false);
});

test("parseMapQuery accepts a real uuid work id and known kinds", () => {
  const uuid = "22222222-2222-2222-2222-222222222222";
  assert.equal(parseMapQuery(params({ ...LONDON, workId: uuid })).workId, uuid);
  assert.deepEqual(parseMapQuery(params({ ...LONDON, kinds: "film,book" })).kinds, ["film", "book"]);
  assert.equal(parseMapQuery(params({ ...LONDON })).kinds, null);
});

// --- badges & shaping --------------------------------------------------------

test("pointBadge tells a studio from a street from an approximate centroid", () => {
  assert.equal(pointBadge(placeRow({ shot_on_set: true, place_class: "studio_interior" })), "studio");
  assert.equal(pointBadge(placeRow({ place_class: "narrative_real" })), "narrative");
  assert.equal(pointBadge(placeRow({ geocode_precision: "city" })), "approximate");
  assert.equal(pointBadge(placeRow({ geocode_precision: "country" })), "approximate");
  assert.equal(pointBadge(placeRow()), "exact");
});

test("pointBadge never calls an unconfirmed spot exact", () => {
  // Measured on the live graph: 860 places are `none`, and eight different Vienna
  // locations — the Votivkirche among them — share one coordinate in the Prater. Each
  // read "Filmed here" with "none" printed under it.
  assert.equal(pointBadge(placeRow({ geocode_precision: "none", wikidata_id: null })), "unconfirmed");
  assert.equal(pointBadge(placeRow({ geocode_precision: null })), "unconfirmed");
  assert.equal(pointBadge(placeRow({ geocode_precision: "building" })), "exact");
  assert.equal(pointBadge(placeRow({ geocode_precision: "street" })), "exact");
});

test("buildMapResponse emits GeoJSON with the grounding fields inline", () => {
  const query = parseMapQuery(params({ ...LONDON, z: "13" }));
  const body = buildMapResponse(query, [placeRow()], []);

  assert.equal(body.type, "FeatureCollection");
  assert.equal(body.clustered, false);
  assert.deepEqual(body.features[0].geometry.coordinates, [-0.128, 51.508]); // lng, lat
  const props = body.features[0].properties;
  assert.equal(props.name, "Trafalgar Square");
  assert.equal(props.place_class, "real_exterior");
  assert.equal(props.confidence, 0.9);
  assert.equal(props.badge, "exact");
  assert.equal(props.work_count, 3);
  assert.equal(props.source_url, "https://www.wikidata.org/wiki/Q129143");
});

test("buildMapResponse shapes clusters when zoomed out", () => {
  const query = parseMapQuery(params({ ...LONDON, z: "5" }));
  const body = buildMapResponse(query, [
    { lat: 51.5, lng: -0.12, cluster_count: 17, sample_name: "London", has_studio: true },
  ], []);
  assert.equal(body.clustered, true);
  assert.deepEqual(body.features[0].properties, {
    cluster: true, point_count: 17, sample_name: "London", has_studio: true,
  });
});

test("buildMapResponse never emits a feature it cannot honestly place", () => {
  const query = parseMapQuery(params({ ...LONDON, z: "13" }));
  const body = buildMapResponse(query, [
    placeRow({ lat: null, lng: null }),
    placeRow({ lat: 91, lng: 0 }), // out of range
    placeRow(),
  ], []);
  assert.equal(body.features.length, 1);
});

test("buildMapResponse carries fiction as a strip, never as a pin", () => {
  const query = parseMapQuery(params({ ...LONDON, z: "13" }));
  const body = buildMapResponse(query, [placeRow()], [
    { place_id: "f1", wikidata_id: "Q79734", name: "Middle-earth", work_count: 1 },
  ]);
  assert.equal(body.features.length, 1); // fiction is not among the features
  assert.deepEqual(body.fictional, [
    { place_id: "f1", wikidata_id: "Q79734", name: "Middle-earth", work_count: 1 },
  ]);
});

test("buildMapResponse flags a truncated result", () => {
  const query = parseMapQuery(params({ ...LONDON, z: "13" }));
  const many = Array.from({ length: MAX_MAP_POINTS }, () => placeRow());
  assert.equal(buildMapResponse(query, many, []).truncated, true);
  assert.equal(buildMapResponse(query, [placeRow()], []).truncated, false);
});

// --- route -------------------------------------------------------------------

function mapRequest(query) {
  return new Request(`http://localhost/api/map/points?${new URLSearchParams(query)}`);
}

function handlerWith(overrides = {}) {
  return createMapPointsHandler({
    env: {},
    createReader: overrides.createReader ?? (() => overrides.reader ?? {
      points: async () => [placeRow()],
      clusters: async () => [{ lat: 51.5, lng: -0.12, cluster_count: 9, sample_name: "London", has_studio: false }],
      fictional: async () => [],
    }),
    logError: () => {},
  });
}

test("map points route rejects a bad bbox", async () => {
  assert.equal((await handlerWith()(mapRequest({ z: "13" }))).status, 400);
});

test("map points route returns 503 when the graph is not configured", async () => {
  const handler = handlerWith({ createReader: () => null });
  assert.equal((await handler(mapRequest({ ...LONDON, z: "13" }))).status, 503);
});

test("map points route serves places when zoomed in and clusters when zoomed out", async () => {
  const calls = [];
  const reader = {
    points: async (p) => { calls.push(["points", p.p_zoom]); return [placeRow()]; },
    clusters: async (p) => { calls.push(["clusters", p.p_zoom]); return [{ lat: 51.5, lng: -0.12, cluster_count: 9 }]; },
    fictional: async () => [],
  };
  const handler = handlerWith({ reader });

  const zoomedIn = await (await handler(mapRequest({ ...LONDON, z: "13" }))).json();
  assert.equal(zoomedIn.clustered, false);
  assert.equal(zoomedIn.features[0].properties.name, "Trafalgar Square");

  const zoomedOut = await (await handler(mapRequest({ ...LONDON, z: "5" }))).json();
  assert.equal(zoomedOut.clustered, true);
  assert.equal(zoomedOut.features[0].properties.point_count, 9);

  assert.deepEqual(calls, [["points", 13], ["clusters", 5]]);
});

test("map points route passes the work and kind filters through to the graph", async () => {
  let seen = null;
  const uuid = "33333333-3333-3333-3333-333333333333";
  const handler = handlerWith({
    reader: {
      points: async (p) => { seen = p; return []; },
      clusters: async () => [],
      fictional: async () => [],
    },
  });
  await handler(mapRequest({ ...LONDON, z: "13", workId: uuid, kinds: "film,series" }));
  assert.equal(seen.p_work_id, uuid);
  assert.deepEqual(seen.p_kinds, ["film", "series"]);
});

test("the fictional strip is filtered by the same query as the map", async () => {
  // A strip describing a different query than the pins would misreport what the user
  // is looking at ("your film is set in Mordor" while showing another film's places).
  let fictionalArgs = null;
  const uuid = "44444444-4444-4444-4444-444444444444";
  const handler = handlerWith({
    reader: {
      points: async () => [],
      clusters: async () => [],
      fictional: async (args) => { fictionalArgs = args; return []; },
    },
  });
  await handler(mapRequest({ ...LONDON, z: "13", workId: uuid, kinds: "book" }));
  assert.deepEqual(fictionalArgs, { workId: uuid, kinds: ["book"] });
});

test("viewportCenter handles a window that crosses the antimeridian", () => {
  assert.deepEqual(
    viewportCenter({ west: -0.4, east: 0.2, south: 51, north: 52 }),
    { lat: 51.5, lng: -0.1 },
  );
  // 170 → -170 spans the date line: the midpoint is 180, not the mean (0).
  const crossing = viewportCenter({ west: 170, east: -170, south: -10, north: 10 });
  assert.equal(crossing.lat, 0);
  assert.equal(Math.abs(crossing.lng), 180);
});

test("an empty viewport says where the nearest place IS, not just that it is empty", async () => {
  // A blank map reads as "there is nothing"; the honest answer is "nothing HERE".
  let nearestArgs = null;
  const handler = handlerWith({
    reader: {
      points: async () => [],
      clusters: async () => [],
      fictional: async () => [],
      nearest: async (args) => {
        nearestArgs = args;
        return [{
          place_id: "p1", wikidata_id: "Q1", name: "Lake District",
          lat: 54.5, lng: -3.16, place_class: "real_exterior",
          geocode_precision: "point", shot_on_set: false, distance_m: 128600,
        }];
      },
    },
  });
  const body = await (await handler(mapRequest({ ...LONDON, z: "13" }))).json();

  assert.equal(body.features.length, 0);
  assert.deepEqual(body.nearest, [{
    place_id: "p1", wikidata_id: "Q1", name: "Lake District",
    lat: 54.5, lng: -3.16, place_class: "real_exterior",
    badge: "exact", distance_km: 129,
  }]);
  // Searched from the middle of what the user is looking at.
  assert.ok(Math.abs(nearestArgs.lat - 51.5) < 0.01);
});

test("a populated viewport never pays for the nearest query", async () => {
  let calledNearest = false;
  const handler = handlerWith({
    reader: {
      points: async () => [placeRow()],
      clusters: async () => [],
      fictional: async () => [],
      nearest: async () => { calledNearest = true; return []; },
    },
  });
  const body = await (await handler(mapRequest({ ...LONDON, z: "13" }))).json();
  assert.equal(calledNearest, false);
  assert.deepEqual(body.nearest, []);
});

test("a graph failure names its cause so a deployment can be diagnosed", async () => {
  // "Could not load" alone is undiagnosable: a wrong anon key, a missing function and
  // a real outage all look the same from outside.
  const cases = [
    ["Invalid API key", "graph_auth_rejected"],
    ["Could not find the function public.map_points_in_view", "graph_schema_mismatch"],
    ["connection reset", "graph_query_failed"],
  ];
  for (const [message, expected] of cases) {
    const handler = handlerWith({
      reader: {
        points: async () => { throw new Error(message); },
        clusters: async () => [],
        fictional: async () => [],
      },
    });
    const response = await handler(mapRequest({ ...LONDON, z: "13" }));
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.reason, expected);
    assert.ok(!JSON.stringify(body).includes("Invalid API key") || expected === "graph_auth_rejected");
  }
});

test("map points route maps a graph failure to 502", async () => {
  const handler = handlerWith({
    reader: {
      points: async () => { throw new Error("rpc down"); },
      clusters: async () => [],
      fictional: async () => [],
    },
  });
  assert.equal((await handler(mapRequest({ ...LONDON, z: "13" }))).status, 502);
});

// ---------- the queue on the browsable map ----------
//
// Measured 10.09.2026: /api/map/points over the whole Los Angeles basin returned ONE
// feature — the city itself — while the queue held 5,266 located rows there across 1,642
// works. These tests are about the layer that closes that, and about the two ways it
// could quietly start lying: by looking like the graph, and by being cut off in silence.

const LA = { west: "-118.45", south: "34.00", east: "-118.15", north: "34.20" };

// The module is already imported at the top of the file; this keeps the new test readable.
function require_map() {
  return { candidateFeatures };
}

// One POINT, carrying the films listed at it. 5,266 Los Angeles rows sit on 2,024 distinct
// coordinates, and before the grouping 71% of them were drawn on top of each other.
function candidateRow(overrides = {}) {
  return {
    place_name: "New York City Backlot",
    area_hint: "860 N Gower St, Los Angeles, CA",
    // Inside Paramount. The address reads like a street and the coordinate is a backlot.
    lat: 34.0863,
    lng: -118.3202,
    row_count: 1,
    work_count: 1,
    status: "pending",
    films: [{
      work_id: "33333333-3333-3333-3333-333333333333",
      title: "Cloverfield",
      year: 2008,
      kind: "film",
      place_name: "New York City Backlot",
      source_kind: "moviemaps",
      source_url: "https://moviemaps.org/locations/1",
      status: "pending",
    }],
    ...overrides,
  };
}

function candidateHandler(rows, overrides = {}) {
  return createMapPointsHandler({
    env: {},
    createReader: () => ({
      points: async () => [],
      clusters: async () => [],
      fictional: async () => [],
      nearest: async () => [{ place_id: "p", name: "Somewhere", lat: 1, lng: 1, distance_km: 90 }],
      candidatePoints: async () => rows,
      candidateClusters: async () => overrides.clusters ?? [],
      ...overrides.reader,
    }),
    logError: () => {},
  });
}

test("the queue is not served unless it is asked for", async () => {
  // Every caller of this endpoint was written before the queue reached the map. They must
  // keep getting the graph and nothing else on the day this shipped.
  let asked = false;
  const handler = candidateHandler([candidateRow()], {
    reader: { candidatePoints: async () => { asked = true; return [candidateRow()]; } },
  });
  const body = await (await handler(mapRequest({ ...LA, z: "13" }))).json();
  assert.equal(asked, false);
  assert.deepEqual(body.candidates, []);
});

test("candidates ride in their own collection, never mixed into features", async () => {
  // Appending them to `features` would make every existing reader of this response — the
  // map layer, the panel's count, the route builder — start counting unchecked rows as
  // places, silently.
  const handler = candidateHandler([candidateRow()], {
    reader: { points: async () => [placeRow()] },
  });
  const body = await (await handler(mapRequest({ ...LA, z: "13", candidates: "1" }))).json();
  assert.equal(body.features.length, 1);
  assert.equal(body.candidates.length, 1);
  assert.equal(body.features[0].properties.candidate, undefined);
  assert.equal(body.candidates[0].properties.candidate, true);
});

test("a candidate carries no confidence and no band", async () => {
  // Those are answers the review produces. A null one would put an unexamined row in the
  // same vocabulary as something we checked.
  const handler = candidateHandler([candidateRow()]);
  const body = await (await handler(mapRequest({ ...LA, z: "13", candidates: "1" }))).json();
  const props = body.candidates[0].properties;
  assert.equal("confidence" in props, false);
  assert.equal("confidence_band" in props, false);
  assert.equal("evidence_count" in props, false);
  assert.equal("place_class" in props, false);
  // What it does carry: whether anybody looked, and the films listed at this point, each
  // with the source that named it.
  assert.equal(props.status, "pending");
  assert.equal(props.films[0].title, "Cloverfield");
  assert.equal(props.films[0].source_kind, "moviemaps");
});

test("a point carries its films, and its two counts are not the same number", () => {
  // One film listing a place twice is not two films. The pin is sized by films; the panel
  // states both.
  const { candidateFeatures } = require_map();
  const [feature] = candidateFeatures({ clustered: false }, [candidateRow({
    place_name: "Millennium Biltmore Hotel", lat: 34.0505, lng: -118.2515,
    row_count: 101, work_count: 96,
    films: [
      { work_id: "a", title: "Ghostbusters", year: 1984, kind: "film" },
      { work_id: "b", title: "Chinatown", year: 1974, kind: "film" },
    ],
  })]);
  assert.equal(feature.properties.work_count, 96);
  assert.equal(feature.properties.row_count, 101);
  assert.equal(feature.properties.films.length, 2);
  // The query caps the list at 40; the count beside it is the truth. A popup listing forty
  // of ninety-six must say so rather than print its own cap as the number we hold.
  assert.equal(feature.properties.films_truncated, true);
});

test("a candidate inside a studio lot is flagged by its coordinate", async () => {
  const handler = candidateHandler([candidateRow()]);
  const body = await (await handler(mapRequest({ ...LA, z: "13", candidates: "1" }))).json();
  const props = body.candidates[0].properties;
  assert.equal(props.depicts_elsewhere, true);
  assert.equal(props.studio_lot.name, "Paramount Pictures Studios");
});

test("a candidate on the street is not flagged", async () => {
  const handler = candidateHandler([candidateRow({ place_name: "Union Station", lat: 34.0561, lng: -118.2365 })]);
  const body = await (await handler(mapRequest({ ...LA, z: "13", candidates: "1" }))).json();
  assert.equal(body.candidates[0].properties.depicts_elsewhere, false);
  assert.equal(body.candidates[0].properties.studio_lot, null);
});

test("a work-scoped map does not also draw the queue", async () => {
  // /api/locations already serves a film's candidates. Both would draw every row twice.
  let asked = false;
  const handler = candidateHandler([], {
    reader: { candidatePoints: async () => { asked = true; return []; } },
  });
  await handler(mapRequest({
    ...LA, z: "13", candidates: "1", workId: "44444444-4444-4444-4444-444444444444",
  }));
  assert.equal(asked, false);
});

test("truncation is measured against what a response can actually carry", async () => {
  // PostgREST caps a response at 1,000 rows and says nothing about it. Against a ceiling
  // of 2,000 the flag could never be true, and the map would draw half the queue while
  // looking complete — the silent truncation #158 already paid for.
  const many = Array.from({ length: MAX_ROWS_PER_RESPONSE }, (_, i) =>
    candidateRow({ lat: 34.05 + i / 1e6 }));
  const handler = candidateHandler(many);
  const body = await (await handler(mapRequest({ ...LA, z: "13", candidates: "1" }))).json();
  assert.equal(body.candidates.length, MAX_ROWS_PER_RESPONSE);
  assert.equal(body.candidates_truncated, true);
  assert.ok(MAX_ROWS_PER_RESPONSE < MAX_MAP_POINTS, "the ceiling is below what the function is asked for");
});

test("\"nothing here\" means nothing at all, candidates included", async () => {
  // A viewport can hold 4,729 candidates and no verified place. Telling that reader the
  // nearest thing is 90 km away would be false about the screen in front of them.
  const handler = candidateHandler([candidateRow()]);
  const body = await (await handler(mapRequest({ ...LA, z: "13", candidates: "1" }))).json();
  assert.deepEqual(body.nearest, []);

  const empty = candidateHandler([]);
  const emptyBody = await (await empty(mapRequest({ ...LA, z: "13", candidates: "1" }))).json();
  assert.equal(emptyBody.nearest.length, 1);
});

test("a zoomed-out queue arrives as clusters counting places AND films", async () => {
  // The busiest cell over Los Angeles holds 163 films. A bubble stating only the row
  // count cannot tell "one series with 87 pins" from "87 films".
  const handler = candidateHandler([], {
    clusters: [{ lat: 34.05, lng: -118.25, cluster_count: 240, work_count: 163, sample_name: "Union Station" }],
  });
  const body = await (await handler(mapRequest({ ...LA, z: "9", candidates: "1" }))).json();
  assert.equal(body.clustered, true);
  const props = body.candidates[0].properties;
  assert.equal(props.cluster, true);
  assert.equal(props.candidate, true);
  assert.equal(props.point_count, 240);
  assert.equal(props.work_count, 163);
});

test("the candidates flag is opt-in and parsed strictly", () => {
  assert.equal(parseMapQuery(params({ ...LA, z: "13" })).candidates, false);
  assert.equal(parseMapQuery(params({ ...LA, z: "13", candidates: "1" })).candidates, true);
  // Not "true", not "yes" — one spelling, so a typo fails loudly rather than turning the
  // layer on by accident.
  assert.equal(parseMapQuery(params({ ...LA, z: "13", candidates: "true" })).candidates, false);
});

// The map must send the rating of whichever source the ranking may use. Before, the SQL
// decided on its own, IMDb first, and taking "imdb" out of the ranking's list would have
// ranked nothing (#224).
test("the queue is asked for ratings from the sources the ranking uses", async () => {
  const { RANKED_SOURCES } = await import("../app/lib/notable-here.mjs");
  let params = null;
  const handler = candidateHandler([], {
    reader: { candidatePoints: async (asked) => { params = asked; return []; } },
  });
  await handler(mapRequest({ ...LA, z: "15", candidates: "1" }));
  assert.deepEqual(params.p_rating_sources, [...RANKED_SOURCES]);
});
