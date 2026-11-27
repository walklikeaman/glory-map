import assert from "node:assert/strict";
import test from "node:test";

import {
  BUDGET_TOLERANCE,
  DRIVE_DETOUR,
  FERRY_WAIT_MINUTES,
  PARK_MINUTES,
  WALK_DETOUR,
  WALK_MAX_KM,
  applyMeasurements,
  buildRouterUrl,
  estimateLeg,
  isWorkingStudio,
  legRuns,
  mergeNearbyStops,
  normalizeModes,
  parseRouterRun,
  planTourOrder,
  poolForTour,
  reachKm,
  scheduleStops,
  stopToDrop,
  stopValue,
  tourHonesty,
  tourLegs,
  tourTotals,
} from "../app/lib/film-tour.mjs";
import { FILM_TOUR_TEMPLATES, findFilmTourTemplate } from "../app/lib/film-tour-templates.mjs";
import { createFilmTourHandler, parseTourBody, stopsFromRows } from "../app/api/trip/tour/route.js";

// Real coordinates from our own stores (2026-11-27), not typed from memory.
const BELFAST = [54.5967, -5.93];
const PLACES = {
  darkHedges: [55.1344, -6.3808],
  ballintoy: [55.2447, -6.3685],
  castleWard: [54.3729, -5.5789],
  inchAbbey: [54.3362, -5.7298],
  clandeboye: [54.6421, -5.7175],
};

function stop(id, position, { verified = false, works = ["Game of Thrones"], status = "pending" } = {}) {
  return { id, name: id, position, works, verified, grounding: { verified, status } };
}

// An independent distance, so the test does not grade haversine with itself.
function equirectangularKm([lat1, lng1], [lat2, lng2]) {
  const x = ((lng2 - lng1) * Math.PI / 180) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  const y = (lat2 - lat1) * Math.PI / 180;
  return Math.sqrt(x * x + y * y) * 6371;
}

test("a leg's straight-line distance is computed, not guessed", () => {
  const leg = estimateLeg(BELFAST, PLACES.darkHedges, "car");
  const expected = equirectangularKm(BELFAST, PLACES.darkHedges);
  assert.ok(Math.abs(leg.straightKm - expected) < 0.2, `${leg.straightKm} vs ${expected}`);
  assert.equal(leg.km, Math.round(leg.straightKm * DRIVE_DETOUR * 10) / 10);
  assert.equal(leg.source, "estimate");
  assert.equal(leg.mode, "car");
});

test("walking estimates use the street detour and walking speed", () => {
  const leg = estimateLeg([51.5072, -0.1275], [51.5007, -0.1246], "walk");
  assert.equal(leg.mode, "walk");
  assert.ok(leg.km > leg.straightKm * 0.99 && leg.km <= leg.straightKm * WALK_DETOUR + 0.1);
  assert.ok(leg.minutes >= 8 && leg.minutes <= 13, String(leg.minutes));
});

test("modes: walking is always allowed, unknown modes are ignored", () => {
  assert.deepEqual(normalizeModes(["car", "boat"]), ["walk", "car"]);
  assert.deepEqual(normalizeModes(null), ["walk"]);
});

// A point `km` kilometres north of `from`.
const north = (from, km) => [from[0] + km / 111.2, from[1]];

test("on foot, every leg is walked", () => {
  const legs = tourLegs(BELFAST, [stop("far", PLACES.darkHedges)], { modes: ["walk"] });
  assert.deepEqual(legs.map((leg) => [leg.mode, leg.kind]), [["walk", "stop"], ["walk", "home"]]);
});

test("the car stays where it was parked: walk back to it before the next drive", () => {
  const abbey = north(BELFAST, 1); // walked from the start
  const legs = tourLegs(BELFAST, [stop("abbey", abbey), stop("coast", PLACES.darkHedges)], { modes: ["walk", "car"] });
  assert.deepEqual(legs.map((leg) => [leg.mode, leg.kind]), [
    ["walk", "stop"],
    ["walk", "car"], // back to the car at the start
    ["car", "stop"],
    ["car", "home"],
  ]);
  assert.deepEqual(legs[2].from, BELFAST, "the drive starts where the car is");
  // Contiguous: every leg starts where the last one ended.
  legs.slice(1).forEach((leg, index) => assert.deepEqual(leg.from, legs[index].to));
});

test("a short hop from a parked car is walked, and the tour drives home from the car", () => {
  const castle = PLACES.castleWard;
  const garden = north(castle, 0.8);
  const legs = tourLegs(BELFAST, [stop("castle", castle), stop("garden", garden)], { modes: ["walk", "car"] });
  assert.deepEqual(legs.map((leg) => [leg.mode, leg.kind]), [
    ["car", "stop"],
    ["walk", "stop"],
    ["walk", "car"],
    ["car", "home"],
  ]);
  assert.deepEqual(legs[3].from, castle);
});

test("a one-way tour ends with a walk back to the car", () => {
  const castle = PLACES.castleWard;
  const legs = tourLegs(BELFAST, [stop("castle", castle), stop("garden", north(castle, 0.8))], { modes: ["walk", "car"], returnToStart: false });
  assert.deepEqual(legs.map((leg) => leg.kind), ["stop", "stop", "car"]);
});

test("reach grows with the budget and with a car", () => {
  assert.ok(reachKm(240, ["walk", "car"]) > reachKm(240, ["walk"]) * 5);
  assert.ok(reachKm(600, ["walk", "car"]) > reachKm(120, ["walk", "car"]));
});

test("stops at one spot merge, keeping every film and the richer row", () => {
  const merged = mergeNearbyStops([
    stop("Cathédrale de Durham", [54.7735, -1.5762], { works: ["Philosopher's Stone"] }),
    stop("Durham Cathedral", [54.77352, -1.57622], { verified: true, works: ["Chamber of Secrets"] }),
    stop("Alnwick Castle", [55.4157, -1.7059], { verified: true }),
  ]);
  assert.equal(merged.length, 2);
  const durham = merged.find((entry) => entry.id === "Durham Cathedral");
  assert.deepEqual(durham.works.sort(), ["Chamber of Secrets", "Philosopher's Stone"]);
  assert.equal(durham.merged_count, 2);
  assert.deepEqual(durham.also_known_as, ["Cathédrale de Durham"]);
});

test("the pool leaves out the hub's own name and working studios, and keeps famous far stops", () => {
  const near = Array.from({ length: 50 }, (_, index) =>
    stop(`estate-${String(index).padStart(2, "0")}`, [BELFAST[0] + 0.01 + index * 0.003, BELFAST[1]]));
  const pool = poolForTour([
    ...near,
    stop("Belfast", BELFAST),
    stop("Titanic Studios", [54.611, -5.9051]),
    stop("Dark Hedges", PLACES.darkHedges, { verified: true }),
  ], BELFAST, { budgetMinutes: 600, modes: ["walk", "car"], hubName: "Belfast" });
  assert.equal(pool.length, 40);
  assert.ok(pool.some((entry) => entry.id === "Dark Hedges"), "a verified place 60 km out is in the pool");
  assert.ok(!pool.some((entry) => entry.id === "Belfast"));
  assert.ok(!pool.some((entry) => entry.id === "Titanic Studios"));
  assert.equal(isWorkingStudio({ name: "Stone Street Studios" }), true);
  assert.equal(isWorkingStudio({ name: "Studland Bay" }), false);
  assert.equal(isWorkingStudio({ name: "Warner Bros. Studio Tour London" }), false);
});

test("value: verified beats a checked source beats an unread row; more films add", () => {
  assert.ok(stopValue(stop("a", BELFAST, { verified: true })) > stopValue(stop("b", BELFAST, { status: "verified" })));
  assert.ok(stopValue(stop("b", BELFAST, { status: "verified" })) > stopValue(stop("c", BELFAST)));
  assert.ok(stopValue(stop("d", BELFAST, { works: ["a", "b", "c"] })) > stopValue(stop("c", BELFAST)));
});

const NI_STOPS = [
  stop("Dark Hedges", PLACES.darkHedges, { verified: true }),
  stop("Ballintoy Harbour", PLACES.ballintoy, { verified: true }),
  stop("Castle Ward", PLACES.castleWard, { verified: true }),
  stop("Inch Abbey", PLACES.inchAbbey),
  stop("Clandeboye Estate", PLACES.clandeboye, { verified: true }),
];

test("a day by car fits its budget and reaches the north coast", () => {
  const options = { budgetMinutes: 600, modes: ["walk", "car"], dwellMinutes: 20, returnToStart: true };
  const order = planTourOrder(NI_STOPS, BELFAST, options);
  const totals = tourTotals(tourLegs(BELFAST, order, options), order, 20);
  assert.ok(totals.totalMinutes <= 600, String(totals.totalMinutes));
  assert.ok(order.some((entry) => entry.id === "Dark Hedges"));
  // Deterministic: the same request answers the same way twice.
  assert.deepEqual(planTourOrder(NI_STOPS, BELFAST, options).map((entry) => entry.id), order.map((entry) => entry.id));
});

test("two hours on foot from Belfast reaches none of these", () => {
  const order = planTourOrder(NI_STOPS, BELFAST, { budgetMinutes: 120, modes: ["walk"] });
  assert.deepEqual(order, []);
});

test("legs group into one router run per unbroken stretch of one mode", () => {
  const order = [NI_STOPS[4], NI_STOPS[2]];
  const legs = tourLegs(BELFAST, order, { modes: ["walk", "car"], returnToStart: true });
  assert.equal(legs.length, 3);
  assert.deepEqual(legs[2].to, BELFAST);
  const runs = legRuns(legs);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].legIndexes, [0, 1, 2]);
  assert.equal(runs[0].positions.length, 4);

  const mixed = legRuns([
    { index: 0, mode: "walk", from: [0, 1], to: [0, 2] },
    { index: 1, mode: "car", from: [0, 2], to: [0, 3] },
    { index: 2, mode: "car", from: [0, 3], to: [0, 4] },
    { index: 3, mode: "car", from: [0, 9], to: [0, 5] },
  ]);
  assert.deepEqual(mixed.map((run) => [run.mode, run.legIndexes]), [["walk", [0]], ["car", [1, 2]], ["car", [3]]]);
});

test("the router URL asks for steps, on the right profile, lng before lat", () => {
  const url = buildRouterUrl([BELFAST, PLACES.darkHedges], "car");
  assert.match(url.pathname, /^\/routed-car\/route\/v1\/driving\/-5\.93,54\.5967;-6\.3808,55\.1344$/);
  assert.equal(url.searchParams.get("steps"), "true");
  assert.match(buildRouterUrl([BELFAST, PLACES.darkHedges], "walk").pathname, /^\/routed-foot\//);
});

const RUN = { mode: "car", legIndexes: [3, 4], positions: [[0, 0], [1, 1], [2, 2]] };

test("router legs are read back with their ferry time", () => {
  const { measured, path } = parseRouterRun({
    code: "Ok",
    routes: [{
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 1], [2, 2]] },
      legs: [
        { distance: 12345, duration: 1800, steps: [{ mode: "driving", duration: 1800 }] },
        { distance: 8000, duration: 2400, steps: [{ mode: "driving", duration: 600 }, { mode: "ferry", duration: 1800 }] },
      ],
    }],
  }, RUN);
  assert.deepEqual(measured, [
    { index: 3, km: 12.3, routerMinutes: 30, ferryMinutes: 0 },
    { index: 4, km: 8, routerMinutes: 40, ferryMinutes: 30 },
  ]);
  assert.equal(path.source, "router");
  assert.equal(path.positions.length, 3);
});

test("a router answer with the wrong number of legs is refused, not half-trusted", () => {
  assert.throws(() => parseRouterRun({ code: "Ok", routes: [{ legs: [{ distance: 1, duration: 1 }] }] }, RUN));
  assert.throws(() => parseRouterRun({ code: "NoRoute" }, RUN));
});

test("measured legs add parking and the ferry queue, out loud", () => {
  const legs = [
    { index: 0, mode: "car", km: 10, minutes: 99, source: "estimate", ferry: null },
    { index: 1, mode: "walk", km: 1, minutes: 15, source: "estimate", ferry: null },
  ];
  const applied = applyMeasurements(legs, [{ index: 0, km: 12.3, routerMinutes: 40, ferryMinutes: 25 }]);
  assert.equal(applied[0].minutes, 40 + PARK_MINUTES + FERRY_WAIT_MINUTES);
  assert.deepEqual(applied[0].ferry, { minutes: 25, waitMinutes: FERRY_WAIT_MINUTES });
  assert.equal(applied[0].source, "router");
  assert.equal(applied[1].source, "estimate");
  const totals = tourTotals(applied, [{}, {}], 20);
  assert.equal(totals.measuredLegs, 1);
  assert.equal(totals.estimatedLegs, 1);
  assert.equal(totals.ferries, 1);
  assert.match(tourHonesty({ stops: [{ verified: true }], totals }), /1 of 2 legs are estimates.*Ferry/);
});

test("the stop to drop is the one costing the most time per value", () => {
  const order = [NI_STOPS[4], NI_STOPS[0]];
  assert.equal(stopToDrop(order, BELFAST, { modes: ["walk", "car"] }), 1);
});

test("stops get clock times from the legs and the dwell", () => {
  const scheduled = scheduleStops([{ id: "a" }, { id: "b" }], [
    { kind: "stop", stop: 0, minutes: 10 },
    { kind: "car", minutes: 4 },
    { kind: "stop", stop: 1, minutes: 5 },
    { kind: "home", minutes: 7 },
  ], 20);
  assert.deepEqual(scheduled.map((entry) => [entry.order, entry.arriveAtMinute]), [[1, 10], [2, 39]]);
});

test("templates: unique ids, real hubs, works as Wikidata ids", () => {
  const ids = new Set();
  for (const template of FILM_TOUR_TEMPLATES) {
    assert.ok(!ids.has(template.id), template.id);
    ids.add(template.id);
    assert.ok(Math.abs(template.hub.lat) <= 90 && Math.abs(template.hub.lng) <= 180);
    assert.match(template.hub.wikidata, /^Q\d+$/);
    assert.ok(template.works.length > 0 && template.works.every((id) => /^Q\d+$/.test(id)));
    assert.ok(template.minutes >= 30 && template.minutes <= 900);
  }
  assert.equal(findFilmTourTemplate("got-northern-ireland").hub.name, "Belfast");
  assert.equal(findFilmTourTemplate("nope"), null);
});

test("the body: template defaults, validation", () => {
  const fromTemplate = parseTourBody({ template: "got-dubrovnik" });
  assert.deepEqual(fromTemplate.origin, [42.6403, 18.1083]);
  assert.equal(fromTemplate.budgetMinutes, 180);
  assert.deepEqual(fromTemplate.modes, ["walk"]);
  assert.equal(parseTourBody({ template: "x" }).error, "Unknown tour template");
  assert.match(parseTourBody({ works: ["Q1"] }).error, /origin/);
  assert.match(parseTourBody({ works: ["Q1"], origin: [1, 2], budgetMinutes: 5 }).error, /budgetMinutes/);
  assert.match(parseTourBody({}).error, /template, works or stops/);
  const client = parseTourBody({ stops: [{ name: "A", position: [1, 2] }, { name: "", position: [1, 2] }], origin: [1, 2] });
  assert.equal(client.stops.length, 1);
  assert.equal(client.stops[0].verified, false);
});

const WORK = { id: "w-got", title: "Game of Thrones", year: 2011, kind: "series", wikidata_id: "Q23572" };
const ROWS = {
  works: [WORK],
  byId: new Map([[WORK.id, WORK]]),
  links: [
    { place_id: "p1", work_id: WORK.id, places: { id: "p1", name: "Dark Hedges", lat: PLACES.darkHedges[0], lng: PLACES.darkHedges[1], geocode_precision: "point" } },
    { place_id: "p2", work_id: WORK.id, places: { id: "p2", name: "Northern Ireland", lat: 54.6075, lng: -6.6925, geocode_precision: "country" } },
    { place_id: "p3", work_id: WORK.id, places: { id: "p3", name: "Castle Ward", lat: PLACES.castleWard[0], lng: PLACES.castleWard[1], geocode_precision: "point" } },
    { place_id: "p4", work_id: WORK.id, relation_kind: "inspiration_for", places: { id: "p4", name: "Inch Abbey", lat: PLACES.inchAbbey[0], lng: PLACES.inchAbbey[1], geocode_precision: "point" } },
  ],
  queue: [
    { id: "s1", work_id: WORK.id, place_name: "Ballintoy Harbour", source_kind: "moviemaps", status: "pending", lat: PLACES.ballintoy[0], lng: PLACES.ballintoy[1] },
  ],
};

test("rows become stops; a country and an influence are not", () => {
  const { stops, excluded } = stopsFromRows(ROWS);
  assert.deepEqual(stops.map((entry) => entry.name).sort(), ["Ballintoy Harbour", "Castle Ward", "Dark Hedges"]);
  assert.equal(excluded, 2, "the country and the influence");
  assert.equal(stops.find((entry) => entry.name === "Dark Hedges").verified, true);
  assert.equal(stops.find((entry) => entry.name === "Ballintoy Harbour").verified, false);
});

function osrmFor(url) {
  // One leg per waypoint pair, 1.4× the straight line at 60 km/h, as the router would.
  const coordinates = decodeURIComponent(new URL(url).pathname.split("/").pop()).split(";")
    .map((pair) => pair.split(",").map(Number));
  const legs = coordinates.slice(1).map((to, index) => {
    const km = equirectangularKm([coordinates[index][1], coordinates[index][0]], [to[1], to[0]]) * 1.4;
    return { distance: km * 1000, duration: (km / 60) * 3600, steps: [{ mode: "driving", duration: (km / 60) * 3600 }] };
  });
  return { code: "Ok", routes: [{ geometry: { type: "LineString", coordinates }, legs }] };
}

function handlerWith({ router = "ok", rows = ROWS } = {}) {
  const calls = [];
  const handler = createFilmTourHandler({
    env: {},
    createReader: () => async (ids) => { calls.push(["read", ids]); return rows; },
    fetchImpl: async (url) => {
      calls.push(["router", String(url)]);
      if (router === "down") throw new Error("offline");
      return { ok: true, status: 200, json: async () => osrmFor(String(url)) };
    },
    logError: () => {},
  });
  return { handler, calls };
}

const post = (body) => ({ json: async () => body });

test("the API builds a measured tour from a template", async () => {
  const { handler, calls } = handlerWith();
  const response = await handler(post({ template: "got-northern-ireland" }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(calls[0], ["read", ["Q23572"]]);
  assert.ok(body.stops.length >= 2);
  assert.equal(body.totals.estimatedLegs, 0);
  assert.ok(body.legs.every((leg) => leg.source === "router"));
  assert.ok(body.totals.totalMinutes <= body.budgetMinutes * BUDGET_TOLERANCE);
  assert.match(body.honesty, /OpenStreetMap router/);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("with the router down every leg says it is an estimate", async () => {
  const { handler } = handlerWith({ router: "down" });
  const body = await (await handler(post({ template: "got-northern-ireland" }))).json();
  assert.ok(body.stops.length >= 2);
  assert.ok(body.legs.every((leg) => leg.source === "estimate"));
  assert.ok(body.paths.every((path) => path.source === "estimate"));
  assert.match(body.honesty, /every leg is an estimate/);
});

test("a measured tour over budget drops a stop rather than lying about the time", async () => {
  // A router three times slower than the estimate.
  const handler = createFilmTourHandler({
    env: {},
    createReader: () => async () => ROWS,
    fetchImpl: async (url) => {
      const answer = osrmFor(String(url));
      for (const leg of answer.routes[0].legs) leg.duration *= 3;
      return { ok: true, status: 200, json: async () => answer };
    },
    logError: () => {},
  });
  const body = await (await handler(post({ template: "got-northern-ireland", budgetMinutes: 420 }))).json();
  assert.ok(body.totals.totalMinutes <= 420 * BUDGET_TOLERANCE || body.overBudget === true);
  assert.ok(body.stops.length < 3);
});

test("the API refuses bad input and reports a failed read", async () => {
  const { handler } = handlerWith();
  assert.equal((await handler(post({ template: "nope" }))).status, 400);
  const failing = createFilmTourHandler({
    env: {},
    createReader: () => async () => { throw new Error("db down"); },
    logError: () => {},
  });
  assert.equal((await failing(post({ template: "got-dubrovnik" }))).status, 502);
  const unconfigured = createFilmTourHandler({ env: {}, logError: () => {} });
  assert.equal((await unconfigured(post({ template: "got-dubrovnik" }))).status, 503);
});

test("stops sent by the map are planned without a database read", async () => {
  const { handler, calls } = handlerWith();
  const body = await (await handler(post({
    stops: [
      { id: "a", name: "Westminster Station", position: [51.5010, -0.1248], works: ["Order of the Phoenix"] },
      { id: "b", name: "Lambeth Bridge", position: [51.4946, -0.1236], works: ["Prisoner of Azkaban"] },
    ],
    origin: [51.5072, -0.1275],
    budgetMinutes: 120,
    modes: ["walk"],
  }))).json();
  assert.equal(calls.filter(([kind]) => kind === "read").length, 0);
  assert.equal(body.stops.length, 2);
  assert.ok(body.legs.every((leg) => leg.mode === "walk"));
});

test("minutes read as a clock", async () => {
  const { formatTourMinutes } = await import("../app/lib/film-tour.mjs");
  assert.equal(formatTourMinutes(45), "45 min");
  assert.equal(formatTourMinutes(125), "2 h 05 min");
  assert.equal(formatTourMinutes(600), "10 h");
});

test("the tour opens in Google Maps with its waypoints, capped at nine", async () => {
  const { googleMapsTourUrl } = await import("../app/lib/film-tour.mjs");
  const link = googleMapsTourUrl({ origin: BELFAST, stops: NI_STOPS, modes: ["walk", "car"] });
  const url = new URL(link.href);
  assert.equal(url.searchParams.get("travelmode"), "driving");
  assert.equal(url.searchParams.get("destination"), BELFAST.join(","));
  assert.equal(url.searchParams.get("waypoints").split("|").length, 5);
  assert.equal(link.truncated, false);
  const many = Array.from({ length: 11 }, (_, index) => stop(`s${index}`, [54 + index * 0.01, -6]));
  assert.equal(googleMapsTourUrl({ origin: BELFAST, stops: many }).truncated, true);
  assert.equal(googleMapsTourUrl({ origin: BELFAST, stops: [] }), null);
  const oneWay = new URL(googleMapsTourUrl({ origin: BELFAST, stops: many, returnToStart: false }).href);
  assert.equal(oneWay.searchParams.get("destination"), many[9].position.join(","), "the tenth stop, not the last");
  assert.equal(oneWay.searchParams.get("waypoints").split("|").length, 9);
});
