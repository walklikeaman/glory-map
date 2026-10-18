// Does a place's pin stand where the place is? (live content check, 18.10)
//
// Found by hand on the live graph: The Shard pinned on the Tower of London, five London
// rows — Whitehall, Embankment Place, two Charing Cross station rows and "London" — all on
// the city centroid at Charing Cross, and Glencoe the village pinned on Buachaille Etive
// Mòr, 13 km away. Each was written by a geocoder that fell back to something nearby and
// said nothing.
//
// This module only DECIDES. It takes a place and what a gazetteer says about it and
// returns one of four verdicts, with no I/O, so every rule below is testable offline:
//
//   ok          — the pin is where the gazetteer puts the place, within tolerance.
//   fix         — the pin is far off AND the gazetteer clearly names this same place.
//   ambiguous   — the pin is far off but something stops a safe correction. Listed for
//                 a person, never written.
//   unresolved  — nothing to compare against (no coordinate, no gazetteer answer).
//
// The asymmetry is the whole design. A wrong "fix" moves a correct pin to a homonym on
// another continent, which is worse than the bug it set out to remove — so a fix needs
// a name match, a sane distance and an unsnapped row, and anything less is a question.

import { haversineMeters } from "./geo.mjs";
import { namesMatch, normalizePlaceName } from "./place-dedup.mjs";

// Wikidata's P625 is the place's own coordinate; 150 m is wider than any building we
// pin and narrower than the gap between two neighbouring landmarks.
export const WIKIDATA_TOLERANCE_M = 150;
// A geocoder answers with an OSM centroid, which for a long street or a park can sit a
// few hundred metres from where a source pinned it. Tolerance to match.
export const NOMINATIM_TOLERANCE_M = 300;
// A matching name this far away is a homonym, not a correction — "Trinity Square" names
// squares in London, Hull and St Petersburg.
export const HOMONYM_KM = 50;
// A geocoder fix bigger than this moves a pin across a city. Measured on the first full
// run: "The Old Mitre" 40 km and "The Bull & Butcher" 28 km — both names of many pubs,
// both asked with no area, both answered with somebody else's pub. A move that size is
// shown to a person, never written.
export const NOMINATIM_REVIEW_M = 5000;

// Precisions that describe an AREA. Its centroid is a convention, not a claim about a
// spot, so comparing it to another centroid says nothing.
const AREA_PRECISIONS = new Set(["city", "region", "country"]);

export function nameHead(name) {
  return String(name ?? "").split(",")[0].trim();
}

export function metresBetween(a, b) {
  return Math.round(haversineMeters([a.lat, a.lng], [b.lat, b.lng]));
}

function hasPin(place) {
  return Number.isFinite(place?.lat) && Number.isFinite(place?.lng)
    && !(place.lat === 0 && place.lng === 0);
}

// A pin somebody already moved onto a footprint or confirmed on a street was moved on
// evidence. Overwriting it from a gazetteer centroid would undo that work.
function snappedReason(place) {
  if (place.osm_building_id) return "snapped to a building footprint";
  if (place.osm_street_id) return "confirmed on an OSM street";
  return null;
}

// `entity`: { label, aliases: [], lat, lng } from Wikidata, or null.
export function judgeAgainstWikidata(place, entity) {
  if (!hasPin(place)) return { verdict: "unresolved", reason: "no stored coordinate" };
  if (AREA_PRECISIONS.has(String(place.geocode_precision ?? "").toLowerCase())) {
    return { verdict: "ok", reason: "an area; its centroid is a convention" };
  }
  if (!entity || !Number.isFinite(entity.lat) || !Number.isFinite(entity.lng)) {
    return { verdict: "unresolved", reason: "Wikidata holds no coordinate" };
  }

  const metres = metresBetween(place, entity);
  if (metres <= WIKIDATA_TOLERANCE_M) return { verdict: "ok", metres };

  const names = [entity.label, ...(entity.aliases ?? [])].filter(Boolean);
  const head = nameHead(place.name);
  if (!names.some((name) => namesMatch(head, name))) {
    return { verdict: "ambiguous", metres, reason: `the Q-id is labelled "${entity.label ?? "?"}", not "${head}"` };
  }
  if (metres > HOMONYM_KM * 1000) {
    return { verdict: "ambiguous", metres, reason: "the name matches but the Q-id's point is too far — a wrong Q-id?" };
  }
  const snapped = snappedReason(place);
  if (snapped) return { verdict: "ambiguous", metres, reason: snapped };

  return {
    verdict: "fix",
    metres,
    lat: entity.lat,
    lng: entity.lng,
    // P625 is a point. A place whose row says "building" keeps that grade only once it is
    // snapped again; until then the honest grade is the point it now stands on.
    geocode_precision: "point",
    source: `wikidata:${place.wikidata_id}:P625`,
  };
}

// OSM `addresstype` → our precision vocabulary.
const STREET_TYPES = new Set(["road", "street", "pedestrian", "square"]);
const AREA_TYPES = new Set([
  "city", "town", "village", "hamlet", "municipality", "county", "state", "country",
  "region", "province", "district", "borough", "suburb", "quarter", "neighbourhood",
  "city_district", "island", "archipelago",
]);

export function precisionForResult(result) {
  const type = String(result?.addresstype ?? result?.type ?? "").toLowerCase();
  if (STREET_TYPES.has(type)) return "street";
  if (AREA_TYPES.has(type)) return "city";
  if (type === "building" || result?.category === "building") return "building";
  return "point";
}

// `results`: Nominatim jsonv2 answers to "<head>, <area>", best first.
// A geocoder name must be the place's name, not one word longer. `namesMatch` allows an
// extra word on purpose — right for two rows of our own, wrong here: the first review of
// the fixes found "Alabama Hills" matched to "Alabama Hills Trail", "Bay Station" to the
// station "Bay" and "Henriette-Herz-Park" to a "Jelbi Henriette-Herz-Park" bike dock.
// A leading "the" is the only difference allowed.
export function sameName(a, b) {
  const strip = (value) => normalizePlaceName(value).replace(/^the /, "");
  const left = strip(a);
  return Boolean(left) && left === strip(b);
}

// OSM objects that carry a landmark's name without being the landmark: the bus stop called
// "Dorchester Hotel", the monorail station "Caesar's Palace", the car park of West Wycombe
// Park, the bike-rental dock at Union Station. And linear features — a river or a trail
// has a centroid somewhere along its length, which is not a place to move a pin to.
const STAND_IN_TYPES = new Set([
  "bus_stop", "platform", "stop_position", "station", "halt", "tram_stop", "subway_entrance",
  "parking", "parking_entrance", "bicycle_rental", "mobility_hub", "taxi", "charging_station",
  "river", "stream", "canal", "path", "footway", "cycleway", "track",
]);

function isStandIn(result, head) {
  const type = String(result?.type ?? "").toLowerCase();
  if (!STAND_IN_TYPES.has(type)) return false;
  // A station IS the place when the source named a station.
  if (["station", "halt", "platform"].includes(type) && /station|bahnhof|gare|stazione|terminal/i.test(head)) return false;
  return true;
}

// `hinted`: the query carried an area. Without one a matching name proves nothing.
export function judgeAgainstNominatim(place, results, { hinted = true } = {}) {
  if (!hasPin(place)) return { verdict: "unresolved", reason: "no stored coordinate" };
  const head = nameHead(place.name);
  const answers = (Array.isArray(results) ? results : [])
    .map((result) => ({ ...result, lat: Number(result.lat), lng: Number(result.lon) }))
    .filter((result) => Number.isFinite(result.lat) && Number.isFinite(result.lng));
  if (answers.length === 0) return { verdict: "unresolved", reason: "the geocoder found nothing" };

  const named = answers.filter((result) => sameName(head, result.name ?? "") && !isStandIn(result, head));
  if (named.length === 0) {
    return { verdict: "unresolved", reason: `the geocoder's best answer is "${answers[0].name ?? answers[0].display_name}"` };
  }
  const best = named[0];
  const metres = metresBetween(place, best);
  if (metres <= NOMINATIM_TOLERANCE_M) return { verdict: "ok", metres };

  // Two same-named answers far apart means the area hint did not settle which one.
  const rival = named.slice(1).find((other) => metresBetween(best, other) > NOMINATIM_TOLERANCE_M);
  if (rival) return { verdict: "ambiguous", metres, reason: `two places called "${head}" ${metresBetween(best, rival)} m apart` };
  if (!hinted) {
    return { verdict: "ambiguous", metres, reason: "looked up with no area — a same-named place elsewhere?" };
  }
  if (metres > NOMINATIM_REVIEW_M) {
    return { verdict: "ambiguous", metres, reason: `a ${Math.round(metres / 1000)} km move — needs a person` };
  }
  const snapped = snappedReason(place);
  if (snapped) return { verdict: "ambiguous", metres, reason: snapped };
  // A street or an area has no single right point. OSM answers with ONE segment of a
  // street — Hollywood Boulevard is six kilometres long, and the pin 1.8 km from the
  // segment it returned may be exactly where the scene was shot. Only a point or a
  // building is a coordinate worth moving a pin to.
  const precision = precisionForResult(best);
  if (precision === "street" || precision === "city") {
    return { verdict: "ambiguous", metres, reason: `the geocoder answered with a ${precision === "street" ? "street" : "whole area"}, which has no single point` };
  }

  return {
    verdict: "fix",
    metres,
    lat: best.lat,
    lng: best.lng,
    geocode_precision: precision,
    source: `nominatim:${best.osm_type ?? "?"}/${best.osm_id ?? "?"}`,
  };
}

// The area a Q-less place is looked up in: the row's city, else whatever the source glued
// after the first comma ("Whitehall, Westminster, London" → "Westminster, London"), else
// the country. Without one, "Cockburn Street" is a street in four countries.
// The area with its postcode taken off: "London SE1" → "London", "London WC2" → "London".
// Nominatim matches the whole string, and an outward code it does not hold returns nothing
// — which is how The Shard went unresolved on the first run.
export function cityOfArea(area) {
  const last = String(area ?? "").split(",").pop().trim();
  return last.replace(/\s+[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?$/, "").trim() || null;
}

export function areaHint(place) {
  if (place?.city) return place.city;
  const rest = String(place?.name ?? "").split(",").slice(1).join(",").trim();
  if (rest) return rest;
  return place?.country ?? null;
}

// The row a fix becomes. The coordinate it replaces is kept in pre_snap_* — unless an
// earlier move already put the ORIGINAL there, which stays: that is the one that can be
// shown as "where the source said".
export function fixUpdate(place, fix) {
  const keepOriginal = Number.isFinite(place.pre_snap_lat) && Number.isFinite(place.pre_snap_lng);
  return {
    lat: fix.lat,
    lng: fix.lng,
    geocode_precision: fix.geocode_precision,
    pre_snap_lat: keepOriginal ? place.pre_snap_lat : place.lat,
    pre_snap_lng: keepOriginal ? place.pre_snap_lng : place.lng,
  };
}
