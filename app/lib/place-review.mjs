// Whether a proposed place may go on the map (#48).
//
// Everything in the graph today came from a Wikidata statement, so the map is currently
// safe by accident: nothing has ever tried to insert an unverified place. This module
// exists so that when an AI-discovered or community-submitted location can persist, it
// arrives `pending` and has to earn `verified`.
//
// The issue proposed gating on the vision frame-matcher. Measured, that matcher returns
// zero matches even for Skyfall against Glencoe and Harry Potter against Alnwick Castle,
// because a film's TMDB gallery is marketing material, not a location survey. A gate
// that admits nothing is an off switch, so verification is built from evidence that
// actually exists — and the frame match, when it fires, is a bonus rather than the bar.
//
// The governing lesson, learned by shipping a fabricated match: **demanding evidence is
// not the same as checking it.** So each signal below is a fact that can be looked up
// and disagreed with, not a model's assurance that it is satisfied.

import { finiteOrNull } from "./numbers.mjs";

export const STATUS = Object.freeze({
  pending: "pending",
  verified: "verified",
  rejected: "rejected",
});

// Signals answer two DIFFERENT questions, and conflating them is how a scoring model
// quietly starts lying:
//
//   * claim signals — is this place linked to the work at all?
//     (wikidata_entity, cited_source, frame_match)
//   * location signals — is the coordinate right?
//     (coordinate_agreement)
//
// Two geocoders agreeing tells you nothing about whether a film was shot there. So
// coordinate agreement is weighted as the supporting detail it is, and CANNOT combine
// with another supporting detail to publish a claim nobody has evidenced.
export const CLAIM_SIGNALS = Object.freeze([
  "wikidata_entity", "cited_source", "frame_match", "independent_corroboration",
]);

// A canonical Wikidata entity is the strongest single signal we have: it means a place
// exists independently of anything we or a model said about it, so it verifies alone.
// Nothing else does — a citation can be wrong about where a scene was shot, and a frame
// match is one model's reading of a picture.
// `independent_corroboration` — two DIFFERENT sites naming the same place for the same
// work — sits below a canonical entity and above a single citation, and deliberately
// below the threshold on its own. Both sites are scrapes of secondary material and may
// be repeating a common upstream; agreement between them is real evidence and is not
// authority, so it needs a second signal before it publishes anything.
export const SIGNAL_WEIGHTS = Object.freeze({
  wikidata_entity: 0.6,
  independent_corroboration: 0.5,
  cited_source: 0.45,
  frame_match: 0.35,
  coordinate_agreement: 0.25,
});

// Deliberately high. The cost of a wrong pin is a false claim about the world; the cost
// of a missed one is a place that stays pending until more evidence arrives.
export const VERIFY_THRESHOLD = 0.6;

// Independent signals combine by noisy-OR, so two weak, unrelated confirmations count
// for more than either alone but never reach certainty. Summing would let three flimsy
// signals outrank one canonical entity, which is the wrong ordering.
export function combineSignals(signals) {
  const present = (Array.isArray(signals) ? signals : []).filter((signal) => SIGNAL_WEIGHTS[signal]);
  const unique = [...new Set(present)];
  let doubt = 1;
  for (const signal of unique) doubt *= 1 - SIGNAL_WEIGHTS[signal];
  return Number((1 - doubt).toFixed(4));
}

// What a candidate actually demonstrates. Each check is mechanical: no model is asked
// whether it is convinced.
export function placeSignals(candidate) {
  const signals = [];
  if (typeof candidate?.wikidata_id === "string" && /^Q[1-9]\d*$/.test(candidate.wikidata_id)) {
    signals.push("wikidata_entity");
  }
  // A citation counts only if the source was actually consulted — the discovery path
  // already refuses to emit a place whose URL was not among the pages it read, and
  // this carries that guarantee forward instead of re-deriving it.
  if (candidate?.source_url && candidate?.source_consulted === true) {
    signals.push("cited_source");
  }
  if (coordinatesAgree(candidate)) signals.push("coordinate_agreement");
  if (candidate?.frame_match === true) signals.push("frame_match");
  return signals;
}

// Two independent geocoders landing in the same spot is real corroboration; one
// geocoder repeating itself is not. 150 m is about a city block — close enough to be
// the same place, far enough that "somewhere in this district" does not qualify.
export const COORDINATE_AGREEMENT_M = 150;

export function coordinatesAgree(candidate) {
  const a = candidate?.coordinates?.[0];
  const b = candidate?.coordinates?.[1];
  const aLat = finiteOrNull(a?.lat);
  const aLng = finiteOrNull(a?.lng);
  const bLat = finiteOrNull(b?.lat);
  const bLng = finiteOrNull(b?.lng);
  if (aLat === null || aLng === null || bLat === null || bLng === null) return false;
  if (a.source && b.source && a.source === b.source) return false; // one source twice
  // Small distances: a flat approximation is accurate well inside the tolerance.
  const metresPerDegree = 111320;
  const dy = (aLat - bLat) * metresPerDegree;
  const dx = (aLng - bLng) * metresPerDegree * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dx, dy) <= COORDINATE_AGREEMENT_M;
}

// Reasons a candidate is refused outright, before any scoring. These are not weak
// evidence — they are claims the product must never make.
export function disqualification(candidate) {
  if (!candidate) return "no_candidate";
  if (candidate.place_class === "fictional") return "fictional_place";
  const lat = finiteOrNull(candidate.lat);
  const lng = finiteOrNull(candidate.lng);
  if (lat === null || lng === null) return "no_coordinate";
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return "impossible_coordinate";
  // Null Island: the signature of a coordinate that was never parsed rather than a
  // place in the Gulf of Guinea.
  if (lat === 0 && lng === 0) return "null_island";
  return null;
}

// The verdict. `pending` is the middle ground and the honest default: not enough to
// show, not wrong enough to bury — a place that may qualify when more evidence arrives.
export function reviewPlace(candidate) {
  const refused = disqualification(candidate);
  if (refused) {
    return { status: STATUS.rejected, score: 0, signals: [], reason: refused };
  }

  const signals = placeSignals(candidate);
  const score = combineSignals(signals);

  // A place is published on the strength of its CLAIM. Without one, no amount of
  // corroborating geography is evidence that a film was shot there.
  const hasClaim = signals.some((signal) => CLAIM_SIGNALS.includes(signal));
  if (hasClaim && score >= VERIFY_THRESHOLD) {
    return { status: STATUS.verified, score, signals, reason: signals.join("+") };
  }
  return {
    status: STATUS.pending,
    score,
    signals,
    reason: signals.length === 0 ? "no_evidence" : `insufficient:${signals.join("+")}`,
  };
}

// A pin is a spot someone can walk to. Wikidata's filming locations (P915) often name a
// whole country, region or city ("Game of Thrones → Croatia", "Emily in Paris → Paris").
// The resolver marks most of them `geocode_precision` country or city, but a region with
// a finely stated point (Île-de-France, Palawan, Rub' al Khali) slips through as `point`,
// so the entity's own area (P2046) is checked too. Drawn, these put one pin in the middle
// of a country with a dozen films on it. They stay in the graph as facts about the work,
// but not on the map.
export const AREA_PRECISIONS = Object.freeze(["country", "city"]);
export const MAX_SPOT_AREA_KM2 = 20;

// The verdict for a place the resolver wrote. Same evidence rules as `reviewPlace`, plus:
// an area is never verified, and a missing coordinate is never a refusal (a later Wikidata
// edit can supply it): the place keeps its status, or waits as pending; it is not drawn
// either way. `area_km2` is the entity's P2046
// in km², Infinity for a town or a region with none stated, absent otherwise.
export function reviewResolvedPlace(place) {
  // Infinity is allowed: it marks an entity whose type is an area but which states none.
  const area = Number(place?.area_km2 ?? 0);
  if (AREA_PRECISIONS.includes(place?.geocode_precision) || area > MAX_SPOT_AREA_KM2) {
    return { status: STATUS.pending, score: 0, signals: [], reason: "area_not_a_spot" };
  }
  const verdict = reviewPlace(place);
  if (verdict.status === STATUS.rejected && verdict.reason === "no_coordinate") {
    return { ...verdict, status: place?.status === STATUS.verified ? STATUS.verified : STATUS.pending };
  }
  return verdict;
}
