// The city half of the one search box (#145) — pure query shaping and ranking.
//
// **Why this is not the Nominatim route we already have.** `/api/cities` answers one
// city per submitted form, which is a single request per Enter and squarely inside the
// OSMF Nominatim usage policy. A type-ahead is a different act: it fires on keystrokes,
// and the policy names auto-complete search as unacceptable use of the public instance
// outright. So the box cannot be built on it, however convenient it is. (The policy page
// itself is unreachable from this machine — egress is filtered — so this rests on the
// reading already recorded in [[geocoding-cascade]], which refused the same service for
// bulk work for the same family of reasons.)
//
// Wikidata answers the same question and is already this project's gazetteer of record:
// CC0, no attribution owed, results freely storable, and the Action API behind
// `wikibase:mwapi` is the one Wikidata's own search box uses. `/api/cities` keeps its
// job — it is what the "look this up as a place" row calls, one request, user-initiated.
//
// Two rules are inherited rather than re-invented, both measured elsewhere in this
// project and both load-bearing here:
//
//   1. **No `P279*` closure.** Requiring a coordinate does most of the type filtering,
//      and the direct P31 label is dropped through `isPlaceType` in code. The closure
//      cost 65 seconds and a 504 for a single name — see [[geocoding-cascade]].
//   2. **Rank by sitelinks, not by label match.** `wbsearchentities` ranks by how well a
//      label matches the string and nothing else, which is how "Skyfall" returns a lyric
//      video first. How many Wikipedias wrote about a thing is what separates the London
//      somebody means from the eleven they do not.

import { isPlaceType } from "./geocode-wikidata.mjs";
import { coordinates } from "./location-search.mjs";
import { finiteOrNull } from "./numbers.mjs";
import { normalizeWorkTitle } from "./content-graph.mjs";
import { matchRange } from "./work-search.mjs";

export const MIN_CITY_QUERY_LENGTH = 2;
export const MAX_CITY_SUGGESTIONS = 5;

// More candidates than rows, because the search returns whatever carries the label and
// only some of those are places. The same 15-for-8 ratio the work resolver settled on.
export const CITY_SEARCH_CANDIDATES = 20;

// What a place with no stated area is given. It decides only which places count as
// "here" once a city is picked — the map's own viewport decides what is fetched — so an
// honest default beats a number extrapolated from population.
export const DEFAULT_CITY_RADIUS_KM = 15;

// A quantity that reaches the query as a normalised value is in SI units: square metres.
const SQUARE_METRES_PER_SQUARE_KM = 1_000_000;

// The query travels inside a SPARQL string literal. Everything that could end that
// literal early is escaped, and control characters are dropped rather than escaped —
// nothing a user types into a search box needs them, and a newline inside a literal is
// a syntax error rather than an injection, which is a confusing way to fail.
export function sparqlLiteral(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

// Prepare a raw input. Returns null when there is nothing worth asking Wikidata about,
// so the caller can skip the round-trip entirely.
//
// Two characters, not one: a single letter matches tens of thousands of places and
// ranks them by fame, which puts London under "l" — technically true and useless, and
// it spends a WDQS query on every first keystroke of every session.
export function prepareCityQuery(raw, { limit = MAX_CITY_SUGGESTIONS } = {}) {
  const query = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (query.length < MIN_CITY_QUERY_LENGTH || query.length > 80) return null;
  return {
    query,
    limit: Math.max(1, Math.min(Number(limit) || MAX_CITY_SUGGESTIONS, 10)),
  };
}

export function buildCitySuggestQuery({ query, limit = MAX_CITY_SUGGESTIONS } = {}) {
  const search = sparqlLiteral(query);
  if (!search.trim()) return null;
  const candidates = Math.min(50, Math.max(limit * 4, CITY_SEARCH_CANDIDATES));

  // `wdt:P625` is required rather than OPTIONAL: a thing with no coordinate is not
  // somewhere the map can go, whatever else it is.
  return `SELECT ?item ?itemLabel ?itemDescription ?coord ?typeLabel ?population ?sitelinks ?areaM2
       ?startTime ?pointInTime WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:endpoint "www.wikidata.org" .
    bd:serviceParam wikibase:api "EntitySearch" .
    bd:serviceParam mwapi:search "${search}" .
    bd:serviceParam mwapi:language "en" .
    bd:serviceParam mwapi:limit "${candidates}" .
    ?item wikibase:apiOutputItem mwapi:item .
  }
  ?item wdt:P625 ?coord .
  # A thing that HAPPENED is not a thing that IS. Measured on production: "lond" put
  # the 2012 Summer Olympics second, above Derry, because an Olympiad has a venue
  # coordinate and 200 Wikipedias. One property separates the two classes without any
  # taxonomy — a city has no start time.
  OPTIONAL { ?item wdt:P580 ?startTime . }
  OPTIONAL { ?item wdt:P585 ?pointInTime . }
  OPTIONAL { ?item wdt:P31 ?type . }
  OPTIONAL { ?item wdt:P1082 ?population . }
  OPTIONAL { ?item wikibase:sitelinks ?sitelinks . }
  OPTIONAL { ?item p:P2046/psn:P2046/wikibase:quantityAmount ?areaM2 . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
LIMIT 200`;
}

// A stated area, turned into the radius of a circle of the same size. Clamped the way
// the bounding-box radius was: under 5 km a city search stops finding its own suburbs,
// over 50 km "in London" stops meaning anything.
export function radiusFromAreaKm2(areaKm2) {
  const area = finiteOrNull(areaKm2);
  if (area === null || area <= 0) return DEFAULT_CITY_RADIUS_KM;
  return Math.min(50, Math.max(5, Math.ceil(Math.sqrt(area / Math.PI))));
}

function idFromUri(uri) {
  return String(uri ?? "").match(/Q\d+$/)?.[0] ?? null;
}

// One row per (item × P31), so an entity arrives several times and its types have to be
// collected rather than sampled — the same reason the locations query GROUP_CONCATs
// them. Nothing else about a row varies between its copies.
export function cityCandidatesFromBindings(payload) {
  const candidates = new Map();

  for (const row of payload?.results?.bindings ?? []) {
    const id = idFromUri(row?.item?.value);
    const point = coordinates(row?.coord?.value);
    if (!id || !point) continue;

    const existing = candidates.get(id);
    const typeLabel = row?.typeLabel?.value?.trim();
    if (existing) {
      if (typeLabel) existing.type_labels.push(typeLabel);
      continue;
    }

    const label = row?.itemLabel?.value ?? id;
    const areaM2 = finiteOrNull(row?.areaM2?.value);
    candidates.set(id, {
      wikidata_id: id,
      name: label,
      description: row?.itemDescription?.value ?? null,
      lat: point.lat,
      lng: point.lng,
      population: finiteOrNull(row?.population?.value),
      sitelinks: finiteOrNull(row?.sitelinks?.value) ?? 0,
      area_km2: areaM2 === null ? null : areaM2 / SQUARE_METRES_PER_SQUARE_KM,
      // An event, not a place: see the query.
      dated: Boolean(row?.startTime?.value || row?.pointInTime?.value),
      type_labels: typeLabel ? [typeLabel] : [],
    });
  }

  return [...candidates.values()];
}

function isPlaceCandidate(candidate) {
  // The label service answers a missing English label with the bare Q-id. A row whose
  // only name is "Q1490" is not something to offer anybody as a destination.
  if (/^Q\d+$/.test(candidate.name)) return false;
  // Something with a date on it is an occurrence — an Olympiad, a festival, a battle —
  // and it is in this list only because the venue carries the coordinate.
  if (candidate.dated) return false;
  // An entity carries several P31s and only needs one of them to be a place; requiring
  // all of them would drop a city that is also a "former municipality".
  return candidate.type_labels.length === 0 || candidate.type_labels.some(isPlaceType);
}

// Somewhere people LIVE, as opposed to somewhere that merely has a coordinate. A
// settlement or an administrative area states how many live there or how big it is;
// a university, a bridge and a pub state neither. The group is called cities and
// places, in that order, and this is the order.
function isInhabited(candidate) {
  return candidate.population !== null || candidate.area_km2 !== null;
}

// Fame decides the order within each band, never the answer — the same rule the work
// search follows. A candidate nobody wrote an article about sorts last rather than being
// refused: a small town is still where somebody means to go, it is just not what
// "London" means.
export function rankCitySuggestions(candidates, { limit = MAX_CITY_SUGGESTIONS } = {}) {
  return (Array.isArray(candidates) ? candidates : [])
    .filter(isPlaceCandidate)
    .sort((left, right) =>
      (isInhabited(right) ? 1 : 0) - (isInhabited(left) ? 1 : 0)
      || right.sitelinks - left.sitelinks
      || (right.population ?? 0) - (left.population ?? 0)
      || left.name.length - right.name.length)
    .slice(0, Math.max(1, limit));
}

// How close the map comes in on a picked place (QA 13.11). Picking a place used to PAN only,
// at whatever zoom the map was at — so "France" from a street view landed in a field near
// Orléans, and "Baker Street" from a country view showed half of England. The zoom follows
// the size of the thing: its stated area when it has one, and street level when it states
// neither an area nor a population (a street, a building, an address).
export function zoomForRadiusKm(radiusKm) {
  const r = finiteOrNull(radiusKm);
  if (r === null || r <= 0) return 16;
  if (r <= 0.5) return 16;
  if (r <= 1.5) return 15;
  if (r <= 4) return 14;
  if (r <= 10) return 13;
  if (r <= 30) return 12;
  if (r <= 80) return 10;
  if (r <= 250) return 8;
  if (r <= 700) return 6;
  if (r <= 1500) return 5;
  return 4;
}

export function zoomForPlace({ area_km2: areaKm2 = null, population = null } = {}) {
  const area = finiteOrNull(areaKm2);
  if (area !== null && area > 0) return zoomForRadiusKm(Math.sqrt(area / Math.PI));
  // A settlement that states people but no area: the old default, a city view.
  if (finiteOrNull(population) !== null) return 12;
  return 16;
}

// The same, for a gazetteer answer that carries a bounding box [south, north, west, east]
// instead of an area — the OpenStreetMap lookup. Half the box's larger side is the radius.
export function zoomForBoundingBox(boundingBox) {
  if (!Array.isArray(boundingBox) || boundingBox.length !== 4) return 12;
  const [south, north, west, east] = boundingBox.map(Number);
  if (![south, north, west, east].every(Number.isFinite)) return 12;
  const midLat = ((south + north) / 2) * (Math.PI / 180);
  const heightKm = Math.abs(north - south) * 111.32;
  const widthKm = Math.abs(east - west) * 111.32 * Math.cos(midLat);
  return zoomForRadiusKm(Math.max(heightKm, widthKm) / 2);
}

export function formatCitySuggestions(candidates, query) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
    wikidata_id: candidate.wikidata_id,
    name: candidate.name,
    description: candidate.description,
    lat: candidate.lat,
    lng: candidate.lng,
    radius_km: radiusFromAreaKm2(candidate.area_km2),
    zoom: zoomForPlace(candidate),
    population: candidate.population,
    match: matchRange(candidate.name, normalizeWorkTitle(query)),
  }));
}
