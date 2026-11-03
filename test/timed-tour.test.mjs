import assert from "node:assert/strict";
import test from "node:test";

import {
  createFallbackGuide,
  createTimedTourCandidates,
  fetchTimedTourGuide,
  pickRouteThatFitsBudget,
  routeFitsBudget,
  TOUR_BUDGET_TOLERANCE,
} from "../app/lib/timed-tour.mjs";
import { ACCESS } from "../app/lib/place-access.mjs";

const locations = [
  { id: "a", place: "A", film: "Film A", description: "A story", position: [51.5000, -0.1000] },
  { id: "b", place: "B", film: "Film B", description: "B story", position: [51.5010, -0.1010] },
  { id: "c", place: "C", film: "Film C", description: "C story", position: [51.5020, -0.1020] },
  { id: "d", place: "D", film: "Film D", description: "D story", position: [51.5030, -0.1030] },
  { id: "e", place: "E", film: "Film E", description: "E story", position: [51.5040, -0.1040] },
];

test("creates a deterministic 3-5 stop candidate within the time tolerance", () => {
  const candidates = createTimedTourCandidates(locations, [51.5, -0.1], 30);

  assert.ok(candidates.length > 0);
  assert.equal(candidates[0].stops.length, 5);
  assert.ok(candidates[0].estimatedMinutes <= 30 * TOUR_BUDGET_TOLERANCE);
  assert.deepEqual(
    candidates[0].stops.map((stop) => stop.id),
    ["a", "b", "c", "d", "e"],
  );
});

test("deduplicates locations before planning", () => {
  const duplicate = { ...locations[0], place: "Duplicate A" };
  const candidates = createTimedTourCandidates(
    [...locations.slice(0, 3), duplicate],
    [51.5, -0.1],
    60,
  );

  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    const ids = candidate.stops.map((stop) => stop.id);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test("combines different films at the same physical stop", () => {
  const sharedPlace = {
    ...locations[0],
    id: "same-place-different-film",
    filmId: "film-b",
    film: "Another Film",
  };
  const candidates = createTimedTourCandidates(
    [sharedPlace, ...locations],
    [51.5, -0.1],
    60,
  );

  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    const places = candidate.stops.map((stop) => stop.place);
    assert.equal(new Set(places).size, places.length);
  }
  assert.deepEqual(candidates[0].stops[0].films, ["Another Film", "Film A"]);
});

test("requires at least three valid unique stops", () => {
  assert.deepEqual(
    createTimedTourCandidates(locations.slice(0, 2), [51.5, -0.1], 30),
    [],
  );
});

test("checks measured walking time against the 15 percent tolerance", () => {
  assert.equal(routeFitsBudget({ durationMinutes: 34.5 }, 30), true);
  assert.equal(routeFitsBudget({ durationMinutes: 35 }, 30), false);
});

test("builds a verified-description fallback guide", () => {
  const guide = createFallbackGuide({
    city: "London",
    budgetMinutes: 60,
    stops: locations.slice(0, 3),
  });

  assert.match(guide.title, /60-minute/);
  assert.deepEqual(
    guide.stops.map((stop) => stop.locationId),
    ["a", "b", "c"],
  );
  assert.equal(guide.stops[0].narration, "A story");
});

// --- access: showing a place and routing to it are different promises -------------------

test("a place OpenStreetMap says is closed is never routed to", () => {
  // The one verdict that removes a stop outright. Everything else is a preference,
  // because access coverage is thin; "closed" is not thin, it is an answer.
  const candidates = createTimedTourCandidates(locations, [51.5, -0.1], 30, {
    access: { c: { access: ACCESS.closed } },
  });

  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    assert.ok(!candidate.stops.some((stop) => stop.id === "c"));
  }
});

test("among equal-length tours, the one we can vouch for wins", () => {
  // Measured against twelve real tour stops, OSM knows about four — and all four are in
  // cities. Excluding every unknown would produce no Scottish tour at all, so an
  // unknown is ranked BELOW a confirmed stop rather than deleted.
  const confirmed = createTimedTourCandidates(locations, [51.5, -0.1], 30, {
    access: {
      c: { access: ACCESS.open },
      d: { access: ACCESS.ticketed },
      e: { access: ACCESS.view_only },
    },
  });

  const best = confirmed[0];
  assert.equal(best.confirmedStops, 3);
  // Every three-stop tour that could have been all-confirmed is ranked above one that
  // could not — the comparison the ordering exists to make.
  const threeStop = confirmed.filter((candidate) => candidate.stops.length === 3);
  assert.deepEqual(
    [...threeStop].sort((left, right) => right.confirmedStops - left.confirmedStops)
      .map((candidate) => candidate.stops.map((stop) => stop.id).join("")),
    threeStop.map((candidate) => candidate.stops.map((stop) => stop.id).join("")),
  );
});

test("no access knowledge plans exactly the tour it planned before", () => {
  // The degraded path is the common one — a busy Overpass, a stop nobody has tagged —
  // and it must cost the labels, never the tour.
  const withNothing = createTimedTourCandidates(locations, [51.5, -0.1], 30, { access: null });
  const original = createTimedTourCandidates(locations, [51.5, -0.1], 30);

  assert.deepEqual(
    withNothing.map((candidate) => candidate.stops.map((stop) => stop.id).join("")),
    original.map((candidate) => candidate.stops.map((stop) => stop.id).join("")),
  );
  assert.equal(withNothing[0].confirmedStops, 0);
});

test("access is looked up by the place id the map carries, not the row id", () => {
  // A location's `locationId` is the place; `id` is the work-and-place pair. Two films
  // shot at one address share the place and must share its access.
  const shared = [
    { ...locations[0], id: "film1-Q1", locationId: "Q1" },
    { ...locations[1], id: "film2-Q1", locationId: "Q1" },
    { ...locations[2], id: "film3-Q2", locationId: "Q2" },
    { ...locations[3], id: "film4-Q3", locationId: "Q3" },
  ];
  const candidates = createTimedTourCandidates(shared, [51.5, -0.1], 60, {
    access: { Q1: { access: ACCESS.closed } },
  });

  for (const candidate of candidates) {
    assert.ok(!candidate.stops.some((stop) => stop.locationId === "Q1"));
  }
});

// --- the two halves of building a timed tour (#82) ----------------------------
const plan = (count, tag = "") => ({ stops: Array.from({ length: count }, (_, index) => ({ id: `${tag}${count}-${index}`, place: `P${index}`, description: `D${index}` })) });
const routeOf = (minutes) => ({ durationMinutes: minutes, positions: [[0, 0], [0, 1]] });

test("the longest candidate whose routed walk fits the budget is taken", async () => {
  const asked = [];
  const picked = await pickRouteThatFitsBudget([plan(3), plan(5), plan(4)], 60, {
    requestRoute: async (stops) => { asked.push(stops.length); return routeOf(stops.length === 5 ? 90 : 50); },
    fallbackRoute: () => assert.fail("the router answered"),
  });
  assert.deepEqual(asked, [5, 4], "five first, and it did not fit");
  assert.equal(picked.plan.stops.length, 4);
  assert.equal(picked.usedRouteFallback, false);
});

test("at most four candidates of each length are routed, and none fitting is null", async () => {
  const candidates = [...Array.from({ length: 6 }, () => plan(3))];
  let calls = 0;
  const picked = await pickRouteThatFitsBudget(candidates, 30, {
    requestRoute: async () => { calls += 1; return routeOf(999); },
    fallbackRoute: () => assert.fail("the router answered"),
  });
  assert.equal(picked, null);
  assert.equal(calls, 4);
});

test("a router that fails falls back to straight lines for the best candidate, still held to the budget", async () => {
  const failing = async () => { throw new Error("router down"); };
  const fits = await pickRouteThatFitsBudget([plan(4, "a"), plan(3, "b")], 60, { requestRoute: failing, fallbackRoute: () => routeOf(40) });
  assert.equal(fits.plan.stops[0].id, "a4-0");
  assert.equal(fits.usedRouteFallback, true);
  const tooLong = await pickRouteThatFitsBudget([plan(4)], 60, { requestRoute: failing, fallbackRoute: () => routeOf(400) });
  assert.equal(tooLong, null);
});

const jsonResponse = (status, body) => ({ ok: status < 400, status, json: async () => body });

test("the model's guide is used only when it returns every stop in the given order", async () => {
  const stops = plan(3).stops;
  const inOrder = { title: "T", stops: stops.map((stop) => ({ locationId: stop.id, narration: "n" })) };
  const good = await fetchTimedTourGuide(stops, { city: "London", budgetMinutes: 60, fetchImpl: async () => jsonResponse(200, inOrder) });
  assert.equal(good.usedAiFallback, false);
  assert.deepEqual(good.guide, { ...inOrder, language: "en" });

  const reordered = { stops: [...inOrder.stops].reverse() };
  for (const fetchImpl of [
    async () => jsonResponse(200, reordered),
    async () => jsonResponse(502, { error: "Could not build the AI tour. Try again." }),
    async () => { throw new Error("offline"); },
  ]) {
    const result = await fetchTimedTourGuide(stops, { city: "London", budgetMinutes: 60, fetchImpl });
    assert.equal(result.usedAiFallback, true);
    assert.deepEqual(result.guide.stops.map((stop) => stop.locationId), stops.map((stop) => stop.id));
    assert.match(result.guide.title, /60-minute GloryMap walk · London/);
  }
});

test("the guide request asks the model to keep the order, and sends only what it needs", async () => {
  let sent;
  const stops = [{ id: "a", place: "P", scene: "S", description: "D", film: "F", position: [51, 0], secret: "x" }];
  await fetchTimedTourGuide(stops, { city: "London", budgetMinutes: 30, fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return jsonResponse(500, {}); } });
  assert.equal(sent.url, "/api/tour");
  assert.deepEqual(sent.body, { city: "London", durationMinutes: 30, preserveOrder: true, locations: [{ id: "a", place: "P", scene: "S", description: "D", film: "F" }] });
});

test("a guide in another language is asked for, and falls back to English before the script", async () => {
  const stops = plan(3).stops;
  const tour = (language) => ({ title: "T", language, stops: stops.map((stop) => ({ locationId: stop.id, narration: "n" })) });

  const sent = [];
  const french = await fetchTimedTourGuide(stops, {
    city: "Paris", budgetMinutes: 60, language: "fr",
    fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body).language); return jsonResponse(200, tour("fr")); },
  });
  assert.deepEqual(sent, ["fr"]);
  assert.equal(french.guide.language, "fr");
  assert.equal(french.usedLanguageFallback, false);

  const asked = [];
  const english = await fetchTimedTourGuide(stops, {
    city: "Paris", budgetMinutes: 60, language: "fr",
    fetchImpl: async (url, init) => {
      const language = JSON.parse(init.body).language ?? "en";
      asked.push(language);
      return language === "fr" ? jsonResponse(502, {}) : jsonResponse(200, tour("en"));
    },
  });
  assert.deepEqual(asked, ["fr", "en"]);
  assert.equal(english.guide.language, "en");
  assert.equal(english.usedAiFallback, false);
  assert.equal(english.usedLanguageFallback, true);

  const scripted = await fetchTimedTourGuide(stops, {
    city: "Paris", budgetMinutes: 60, language: "fr", fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(scripted.usedAiFallback, true);
  assert.equal(scripted.guide.language, "en");
});
