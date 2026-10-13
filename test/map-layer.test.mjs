import assert from "node:assert/strict";
import test from "node:test";

import {
  BADGE_STYLES,
  badgeStyle,
  clusterRadius,
  clusterStyle,
  pointStyle,
  pointSummary,
  viewportQuery,
} from "../app/lib/map-layer.mjs";

const feature = (badge, properties = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [-0.128, 51.508] },
  properties: { badge, work_count: 2, ...properties },
});

test("every badge has a distinct look, so five different claims never read alike", () => {
  const keys = Object.keys(BADGE_STYLES);
  assert.deepEqual(keys.sort(), ["approximate", "exact", "narrative", "studio", "unconfirmed"]);
  // Colour alone isn't enough (exact and approximate share the amber), so the pair
  // must differ in something else a viewer can see.
  const exact = BADGE_STYLES.exact;
  const approx = BADGE_STYLES.approximate;
  assert.notEqual(exact.dashArray, approx.dashArray);
  assert.ok(approx.radius > exact.radius);
  assert.ok(approx.fillOpacity < exact.fillOpacity);
  // Studio and narrative are distinguished by colour.
  assert.notEqual(BADGE_STYLES.studio.color, BADGE_STYLES.exact.color);
  assert.notEqual(BADGE_STYLES.narrative.color, BADGE_STYLES.exact.color);
  // An unconfirmed spot is pin-sized like exact but dashed and dimmer, so it never reads
  // as a confirmed doorway.
  const unconfirmed = BADGE_STYLES.unconfirmed;
  assert.ok(unconfirmed.dashArray);
  assert.notEqual(unconfirmed.dashArray, approx.dashArray);
  assert.ok(unconfirmed.fillOpacity < exact.fillOpacity);
  assert.ok(unconfirmed.radius < approx.radius);
});

test("an approximate point is drawn as a region, never as a doorstep", () => {
  const style = badgeStyle("approximate");
  assert.ok(style.radius >= 12);
  assert.ok(style.dashArray);
  assert.match(style.hint, /city or country/i);
});

test("a studio says the story is set elsewhere", () => {
  assert.match(badgeStyle("studio").hint, /elsewhere/i);
});

test("badgeStyle falls back instead of throwing on an unknown badge", () => {
  assert.deepEqual(badgeStyle("nonsense"), BADGE_STYLES.exact);
  assert.deepEqual(badgeStyle(undefined), BADGE_STYLES.exact);
});

test("selection grows the ring but keeps what the point IS", () => {
  const base = badgeStyle("studio");
  const selected = pointStyle(feature("studio"), { selected: true });
  assert.ok(selected.radius > base.radius);
  assert.equal(selected.fillColor, base.fillColor); // identity survives selection
  assert.equal(pointStyle(feature("studio")).radius, base.radius);
});

test("cluster bubbles stay visibly distinct across the whole range", () => {
  // A scale that saturates early would draw 50 and 5000 identically — telling the
  // reader those two clusters are the same size.
  assert.ok(clusterRadius(1) < clusterRadius(50));
  assert.ok(clusterRadius(50) < clusterRadius(500));
  assert.ok(clusterRadius(500) < clusterRadius(5000));
  assert.equal(clusterRadius(100000), 30); // clamped, so one cell can't swallow the map
  assert.equal(clusterRadius(0), 12);
  assert.equal(clusterRadius(undefined), 12);
});

test("a cluster containing a studio is marked as such", () => {
  assert.equal(clusterStyle(5, { hasStudio: true }).color, BADGE_STYLES.studio.color);
  assert.equal(clusterStyle(5).color, BADGE_STYLES.exact.color);
});

// --- viewport ----------------------------------------------------------------

const bounds = (west, south, east, north) => ({
  getWest: () => west, getSouth: () => south, getEast: () => east, getNorth: () => north,
});

test("viewportQuery builds the endpoint query from Leaflet bounds", () => {
  const query = new URLSearchParams(viewportQuery(bounds(-0.35, 51.35, 0.05, 51.65), 13));
  assert.equal(query.get("west"), "-0.35");
  assert.equal(query.get("east"), "0.05");
  assert.equal(query.get("z"), "13");
  assert.equal(query.get("workId"), null);
});

test("viewportQuery preserves a date-line-crossing viewport", () => {
  // Sorting west/east here would ask the API for the complement of what the user sees.
  const query = new URLSearchParams(viewportQuery(bounds(170, -10, -170, 10), 13));
  assert.equal(query.get("west"), "170");
  assert.equal(query.get("east"), "-170");
});

test("viewportQuery clamps longitudes Leaflet reports outside the world", () => {
  // After wrapping, Leaflet happily returns e.g. -190; the API would reject it.
  const query = new URLSearchParams(viewportQuery(bounds(-190, -95, 190, 95), 4));
  assert.equal(query.get("west"), "-180");
  assert.equal(query.get("east"), "180");
  assert.equal(query.get("south"), "-90");
  assert.equal(query.get("north"), "90");
});

test("viewportQuery passes the work and kind filters through", () => {
  const query = new URLSearchParams(
    viewportQuery(bounds(-1, 51, 1, 52), 13, { workId: "abc", kinds: ["film", "book"] }),
  );
  assert.equal(query.get("workId"), "abc");
  assert.equal(query.get("kinds"), "film,book");
});

test("viewportQuery returns null for unusable bounds instead of a bad request", () => {
  assert.equal(viewportQuery(null, 13), null);
  assert.equal(viewportQuery(bounds(NaN, 51, 1, 52), 13), null);
});

test("pointSummary reads as a plain sentence about the claim", () => {
  assert.equal(pointSummary({ badge: "studio", work_count: 1 }), "Studio · 1 work");
  assert.equal(pointSummary({ badge: "exact", work_count: 3 }), "Filmed here · 3 works");
  assert.equal(pointSummary(null), "");
});

test("an unconfirmed spot says so in the popup instead of a raw precision", async () => {
  const { pointHint } = await import("../app/lib/map-layer.mjs");
  assert.equal(pointSummary({ badge: "unconfirmed", work_count: 1 }), "Spot unconfirmed · 1 work");
  assert.match(pointHint({ badge: "unconfirmed" }), /not confirmed/);
  assert.doesNotMatch(pointHint({ badge: "exact" }), /Wikidata/, "most exact pins never came from Wikidata");
  assert.equal(pointHint(null), "");
});

// ---------- the queue's own visual vocabulary ----------

test("a candidate is hollow and a place is filled", async () => {
  const { CANDIDATE_STYLE, badgeStyle, candidateStyle } = await import("../app/lib/map-layer.mjs");
  // The one difference that survives being glanced at on a phone in the street. A
  // candidate drawn as a dimmer verified pin would read as a WEAKER version of something
  // we checked, and it is not weaker — it is unexamined, which is a different axis.
  assert.equal(CANDIDATE_STYLE.fillOpacity, 0);
  for (const badge of ["exact", "approximate", "unconfirmed", "studio", "narrative"]) {
    assert.ok(badgeStyle(badge).fillOpacity > 0, `${badge} is filled`);
  }
  assert.equal(candidateStyle({ properties: {} }).fillOpacity, 0);
});

test("a candidate borrows no verified badge colour", async () => {
  const { BADGE_STYLES, CANDIDATE_STYLE } = await import("../app/lib/map-layer.mjs");
  const taken = new Set(Object.values(BADGE_STYLES).map((style) => style.color));
  assert.equal(taken.has(CANDIDATE_STYLE.color), false);
});

test("a candidate inside a lot stays hollow and takes the studio colour", async () => {
  const { BADGE_STYLES, candidateStyle } = await import("../app/lib/map-layer.mjs");
  const onLot = candidateStyle({ properties: { depicts_elsewhere: true } });
  // Two facts, both kept: unexamined AND a backlot.
  assert.equal(onLot.fillOpacity, 0);
  assert.equal(onLot.color, BADGE_STYLES.studio.color);
});

test("selecting a candidate is the one moment it may look solid", async () => {
  const { candidateStyle } = await import("../app/lib/map-layer.mjs");
  assert.ok(candidateStyle({ properties: {} }, { selected: true }).fillOpacity > 0);
});

test("a checked SOURCE is never called a verified place", async () => {
  const { candidateSummary } = await import("../app/lib/map-layer.mjs");
  const checked = candidateSummary({ status: "verified" });
  // The review checked whoever said it, not whether it happened. "Verified" here would
  // promote a queue row to a fact in the one place nobody would look.
  assert.match(checked, /still a candidate/);
  assert.equal(/^Verified/.test(checked), false);
  assert.match(candidateSummary({ status: "pending" }), /Nobody has checked it/);
});

test("the queue is asked for only when wanted, and never alongside a work", async () => {
  const { viewportQuery } = await import("../app/lib/map-layer.mjs");
  const bounds = { west: -118.45, east: -118.15, south: 34.0, north: 34.2 };
  assert.equal(new URLSearchParams(viewportQuery(bounds, 13)).get("candidates"), null);
  assert.equal(new URLSearchParams(viewportQuery(bounds, 13, { candidates: true })).get("candidates"), "1");
  // A work-scoped map already draws its own candidates through /api/locations.
  const scoped = viewportQuery(bounds, 13, { candidates: true, workId: "44444444-4444-4444-4444-444444444444" });
  assert.equal(new URLSearchParams(scoped).get("candidates"), null);
});

test("a viewport with no area is refused, not queried", async () => {
  const { viewportQuery } = await import("../app/lib/map-layer.mjs");
  // Leaflet answers `getBounds()` on a map it has not measured with west === east. The
  // query built from that asks the server about a single point, gets an honestly empty
  // answer, and the map looks empty with 1,000 points one fetch away.
  assert.equal(viewportQuery({ west: -118.32, east: -118.32, south: 34.08, north: 34.08 }, 14), null);
  assert.equal(viewportQuery({ west: -118.45, east: -118.15, south: 34.0, north: 34.0 }, 14), null);
  // A real viewport still works.
  assert.ok(viewportQuery({ west: -118.45, east: -118.15, south: 34.0, north: 34.2 }, 14));
});

// MapLibre reports one view twice with bounds differing in the 13th decimal. Measured on
// production: the same question went out as two URLs 1.3 s apart.
test("the same view in float noise is the same query", () => {
  const first = viewportQuery(bounds(-118.3473980957035, 34.0276958929109, -118.22380190429737, 34.0916920265052), 13, { candidates: true });
  const second = viewportQuery(bounds(-118.34739809570293, 34.02769589291046, -118.2238019042968, 34.091692026504774), 13, { candidates: true });
  assert.equal(first, second);
  assert.equal(new URLSearchParams(first).get("west"), "-118.3474");
});
