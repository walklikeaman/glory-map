import assert from "node:assert/strict";
import test from "node:test";

import {
  COORDINATE_AGREEMENT_M,
  combineSignals,
  coordinatesAgree,
  disqualification,
  placeSignals,
  reviewPlace,
  SIGNAL_WEIGHTS,
  STATUS,
  VERIFY_THRESHOLD,
} from "../app/lib/place-review.mjs";

const candidate = (overrides = {}) => ({
  name: "Leadenhall Market", lat: 51.5127, lng: -0.0835,
  place_class: "real_exterior", wikidata_id: "Q961148", ...overrides,
});

// --- what may never be shown ---------------------------------------------------

test("a fictional place is rejected, never merely pending", () => {
  // Pending means "maybe later". Hogwarts is not maybe later.
  const verdict = reviewPlace(candidate({ place_class: "fictional", name: "Hogwarts" }));
  assert.equal(verdict.status, STATUS.rejected);
  assert.equal(verdict.reason, "fictional_place");
});

test("0,0 is refused as an unparsed coordinate, not accepted as the Gulf of Guinea", () => {
  assert.equal(disqualification(candidate({ lat: 0, lng: 0 })), "null_island");
  assert.equal(disqualification(candidate({ lat: null })), "no_coordinate");
  assert.equal(disqualification(candidate({ lat: 91 })), "impossible_coordinate");
  assert.equal(disqualification(candidate({ lng: -181 })), "impossible_coordinate");
  assert.equal(disqualification(null), "no_candidate");
});

test("a rejected candidate is never scored — it is refused before evidence matters", () => {
  const verdict = reviewPlace(candidate({ place_class: "fictional" }));
  assert.equal(verdict.score, 0);
  assert.deepEqual(verdict.signals, []);
});

// --- the signals ----------------------------------------------------------------

test("a canonical Wikidata entity alone is enough to verify", () => {
  // It means the place exists independently of anything we or a model asserted.
  const verdict = reviewPlace(candidate());
  assert.equal(verdict.status, STATUS.verified);
  assert.ok(verdict.signals.includes("wikidata_entity"));
  assert.ok(SIGNAL_WEIGHTS.wikidata_entity >= VERIFY_THRESHOLD);
});

test("a URL only counts if the source was actually read", () => {
  // The discovery path refuses to emit a place whose URL was not among the pages it
  // consulted; this carries that guarantee forward rather than trusting the string.
  const unread = candidate({ wikidata_id: null, source_url: "https://example.com/x" });
  assert.deepEqual(placeSignals(unread), []);

  const read = candidate({ wikidata_id: null, source_url: "https://example.com/x", source_consulted: true });
  assert.deepEqual(placeSignals(read), ["cited_source"]);
});

test("a citation alone is not enough to publish", () => {
  // A cited page can still be wrong about where a scene was shot.
  const verdict = reviewPlace(candidate({
    wikidata_id: null, source_url: "https://example.com/x", source_consulted: true,
  }));
  assert.equal(verdict.status, STATUS.pending);
  assert.match(verdict.reason, /^insufficient:/);
});

test("a citation plus agreeing geocoders is still not enough", () => {
  // Two geocoders agreeing says WHERE the place is, not that a film was shot there.
  // They corroborate different questions and must not add up to publishing a claim.
  const verdict = reviewPlace(candidate({
    wikidata_id: null,
    source_url: "https://example.com/x", source_consulted: true,
    coordinates: [
      { lat: 51.5127, lng: -0.0835, source: "nominatim" },
      { lat: 51.5128, lng: -0.0836, source: "wikidata" },
    ],
  }));
  assert.deepEqual(verdict.signals.sort(), ["cited_source", "coordinate_agreement"]);
  assert.equal(verdict.status, STATUS.pending);
});

test("a consulted citation plus a confirmed frame does clear the bar", () => {
  // Two independent supports for the SAME claim — a page that says it, and a picture
  // that shows it.
  const verdict = reviewPlace(candidate({
    wikidata_id: null,
    source_url: "https://example.com/x", source_consulted: true,
    frame_match: true,
  }));
  assert.equal(verdict.status, STATUS.verified);
});

test("geography alone never publishes, whatever it scores", () => {
  // The guard that makes the claim/location split real rather than decorative.
  const verdict = reviewPlace(candidate({
    wikidata_id: null,
    coordinates: [
      { lat: 51.5127, lng: -0.0835, source: "a" },
      { lat: 51.5128, lng: -0.0836, source: "b" },
    ],
  }));
  assert.deepEqual(verdict.signals, ["coordinate_agreement"]);
  assert.equal(verdict.status, STATUS.pending);
});

test("nothing at all is pending, not rejected", () => {
  // "We have no evidence yet" and "this is wrong" are different answers.
  const verdict = reviewPlace(candidate({ wikidata_id: null }));
  assert.equal(verdict.status, STATUS.pending);
  assert.equal(verdict.reason, "no_evidence");
  assert.equal(verdict.score, 0);
});

// --- combining ------------------------------------------------------------------

test("signals combine by noisy-OR, so nothing reaches certainty", () => {
  const all = combineSignals(Object.keys(SIGNAL_WEIGHTS));
  assert.ok(all < 1, "no amount of evidence should read as certain");
  assert.ok(all > SIGNAL_WEIGHTS.wikidata_entity);
});

test("weak signals cannot outrank a canonical entity by piling up", () => {
  // Summing would let three flimsy confirmations beat one Wikidata statement.
  const flimsy = combineSignals(["cited_source", "coordinate_agreement", "frame_match"]);
  assert.ok(flimsy < 1);
  assert.equal(combineSignals(["wikidata_entity"]), SIGNAL_WEIGHTS.wikidata_entity);
});

test("the same signal twice counts once", () => {
  assert.equal(combineSignals(["cited_source", "cited_source"]), SIGNAL_WEIGHTS.cited_source);
  assert.equal(combineSignals(["nonsense"]), 0);
  assert.equal(combineSignals(null), 0);
});

// --- coordinate agreement --------------------------------------------------------

test("two geocoders agreeing is corroboration; one repeating itself is not", () => {
  const agreeing = candidate({ coordinates: [
    { lat: 51.5127, lng: -0.0835, source: "nominatim" },
    { lat: 51.5128, lng: -0.0836, source: "wikidata" },
  ] });
  assert.equal(coordinatesAgree(agreeing), true);

  const sameSource = candidate({ coordinates: [
    { lat: 51.5127, lng: -0.0835, source: "nominatim" },
    { lat: 51.5128, lng: -0.0836, source: "nominatim" },
  ] });
  assert.equal(coordinatesAgree(sameSource), false);
});

test("landing in different districts is not agreement", () => {
  const apart = candidate({ coordinates: [
    { lat: 51.5127, lng: -0.0835, source: "a" },
    { lat: 51.5074, lng: -0.1278, source: "b" }, // ~3 km away
  ] });
  assert.equal(coordinatesAgree(apart), false);
  assert.ok(COORDINATE_AGREEMENT_M < 200);
});

test("a missing coordinate is not agreement, and never becomes 0,0", () => {
  assert.equal(coordinatesAgree(candidate({ coordinates: [{ lat: null, lng: null }, { lat: 0, lng: 0 }] })), false);
  assert.equal(coordinatesAgree(candidate({ coordinates: [] })), false);
  assert.equal(coordinatesAgree(candidate()), false);
});

// --- the frame match is a bonus, not the bar ------------------------------------

test("a frame match helps but cannot publish a place on its own", () => {
  // Measured, the matcher returns zero matches even for well-photographed landmarks.
  // Making it the gate would have admitted nothing at all.
  const verdict = reviewPlace(candidate({ wikidata_id: null, frame_match: true }));
  assert.deepEqual(verdict.signals, ["frame_match"]);
  assert.equal(verdict.status, STATUS.pending);
  assert.ok(SIGNAL_WEIGHTS.frame_match < VERIFY_THRESHOLD);
});

test("reviewResolvedPlace holds countries and cities back from the map", async () => {
  const { reviewResolvedPlace } = await import("../app/lib/place-review.mjs");
  const spot = { name: "Fort Lovrijenac", lat: 42.6408, lng: 18.1043, place_class: "real_exterior", wikidata_id: "Q1430830" };
  assert.equal(reviewResolvedPlace({ ...spot, geocode_precision: "point" }).status, STATUS.verified);
  for (const precision of ["country", "city"]) {
    const verdict = reviewResolvedPlace({ ...spot, name: "Croatia", wikidata_id: "Q224", geocode_precision: precision });
    assert.equal(verdict.status, STATUS.pending);
    assert.equal(verdict.reason, "area_not_a_spot");
  }
  const region = reviewResolvedPlace({ ...spot, name: "Île-de-France", wikidata_id: "Q13917", geocode_precision: "street", area_km2: 12012 });
  assert.equal(region.status, STATUS.pending);
  assert.equal(reviewResolvedPlace({ ...spot, geocode_precision: "point", area_km2: 0.02 }).status, STATUS.verified);
  assert.equal(reviewResolvedPlace({ ...spot, name: "Saint-Tropez", geocode_precision: "point", area_km2: Infinity }).status, STATUS.pending);
});

test("reviewResolvedPlace keeps a place without a coordinate pending, not rejected", async () => {
  const { reviewResolvedPlace } = await import("../app/lib/place-review.mjs");
  const verdict = reviewResolvedPlace({ name: "Galeries Lafayette", lat: null, lng: null, wikidata_id: "Q3094686", geocode_precision: "none" });
  assert.equal(verdict.status, STATUS.pending);
  assert.equal(reviewResolvedPlace({ name: "Winterfell", lat: 1, lng: 1, place_class: "fictional", geocode_precision: "point" }).status, STATUS.rejected);
});
