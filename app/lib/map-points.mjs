// Map read path — pure query parsing and GeoJSON shaping for /api/map/points.
// The map serves the persistent graph (places / work_place_links / place_evidence)
// rather than a live SPARQL query, so a viewport is one indexed database call.
//
// The point of shipping the grounding fields inline is honesty: the client must be
// able to show WHAT a pin is (street vs studio vs coarse city centroid) and how well
// it is evidenced, instead of drawing every point as an equally confident dot.

import { studioLotAt } from "./studio-lots.mjs";
import { hasValidCoordinate, MAP_THRESHOLD } from "./grounding.mjs";
import { isPinnable } from "./place-grade.mjs";

// Below this zoom the database returns grid clusters instead of individual places.
export const CLUSTER_BELOW_ZOOM = 12;
export const MAX_MAP_POINTS = 2000;

// What PostgREST will actually hand back, which is NOT what the function was asked for.
//
// Found by looking: `map_candidate_points_in_view` returned 2,000 rows for a viewport
// over central Los Angeles and `/api/map/points` answered with exactly 1,000. PostgREST
// caps a response at `db-max-rows` (1,000 on this project) and says nothing about it —
// no header, no error — so a ceiling of 2,000 could never be reached and
// `truncated: length >= 2000` could never be true. The map would have drawn half the
// queue and told the reader it had drawn all of it.
//
// That is the silent-truncation failure #158 already paid for once, when a film card
// printed its own display cap as though it were the number we hold. The ceiling is now
// the number that can actually arrive, so "truncated" means truncated.
//
// The graph path has the same latent cap and has never reached it — 70 places worldwide —
// but it is the same number for the same reason, and the day it grows it should already
// be honest.
export const MAX_ROWS_PER_RESPONSE = 1000;
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 22;

const WORK_KINDS = new Set(["film", "series", "book", "track", "album"]);
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Number(null) and Number("") are both 0, so a missing bbox parameter would silently
// become a perfectly valid coordinate at Null Island. Reject absent values outright.
function finite(value, { min, max }) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

// Same trap on the row side: a place with lat/lng NULL must not coerce to 0,0.
function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Parse a viewport request. Returns { error } instead of a query when the request is
// unusable, so the caller can say WHICH part was wrong rather than blaming the bbox.
//
// A filter that was asked for but could not be honoured is an error, never a silent
// widening: quietly dropping an unparseable workId would answer "your film's places"
// with the entire graph, which reads as a wrong answer rather than a rejected one.
export function parseMapQuery(searchParams) {
  const west = finite(searchParams.get("west"), { min: -180, max: 180 });
  const east = finite(searchParams.get("east"), { min: -180, max: 180 });
  const south = finite(searchParams.get("south"), { min: -90, max: 90 });
  const north = finite(searchParams.get("north"), { min: -90, max: 90 });
  if (west === null || east === null || south === null || north === null) {
    return { error: "Provide a valid bbox (west, south, east, north)" };
  }

  const zoomRaw = searchParams.get("z");
  const zoom = zoomRaw === null ? CLUSTER_BELOW_ZOOM : finite(zoomRaw, { min: MIN_ZOOM, max: MAX_ZOOM });
  if (zoom === null) return { error: `Zoom must be between ${MIN_ZOOM} and ${MAX_ZOOM}` };

  const workIdRaw = searchParams.get("workId");
  if (workIdRaw !== null && !UUID.test(workIdRaw)) {
    return { error: "workId must be a uuid" };
  }

  const kinds = parseKindsParam(searchParams.get("kinds"));
  if (kinds?.error) return { error: kinds.error };

  const roundedZoom = Math.round(zoom);
  return {
    // Longitude is NOT normalized: west > east is meaningful — it is a viewport
    // crossing the antimeridian, and the SQL reads it as [west,180] ∪ [-180,east].
    // Sorting the pair would turn that window into its own complement.
    west,
    east,
    south: Math.min(south, north),
    north: Math.max(south, north),
    zoom: roundedZoom,
    workId: workIdRaw,
    kinds: kinds?.value ?? null,
    clustered: roundedZoom < CLUSTER_BELOW_ZOOM,
    // Opt-in. Every caller written before the queue reached the map keeps getting the
    // graph and nothing else, and a client that wants the other 32,148 rows asks.
    candidates: searchParams.get("candidates") === "1",
  };
}

// Shared by every endpoint that filters by work kind, so the validation (and the
// refusal to silently widen) is defined once. Returns null when absent,
// { value } when valid, { error } when the caller asked for something we can't honour.
export function parseKindsParam(raw) {
  if (raw === null || raw === undefined) return null;
  const requested = String(raw).split(",").map((kind) => kind.trim()).filter(Boolean);
  if (requested.length === 0 || requested.some((kind) => !WORK_KINDS.has(kind))) {
    return { error: `kinds must be one or more of: ${[...WORK_KINDS].join(", ")}` };
  }
  return { value: [...new Set(requested)] };
}

// How a pin should read on the map. Kept here (not in the client) so every surface
// tells the same story about a point.
export function pointBadge(row) {
  if (row.shot_on_set) return "studio";
  if (row.place_class === "narrative_real") return "narrative";
  if (row.geocode_precision === "country" || row.geocode_precision === "city") return "approximate";
  // `none` is the 860 places whose spot nobody has confirmed — the coordinate is whatever
  // the source's geocoder gave, and eight different Vienna locations share one point in
  // the Prater. They used to fall through to `exact` and read "Filmed here" with a raw
  // "none" under it. Same rule the trip planner and the trails apply.
  if (!isPinnable(row.geocode_precision)) return "unconfirmed";
  return "exact";
}

function placeFeature(row) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [row.lng, row.lat] },
    properties: {
      place_id: row.place_id,
      wikidata_id: row.wikidata_id,
      name: row.name,
      place_class: row.place_class,
      geocode_precision: row.geocode_precision,
      shot_on_set: row.shot_on_set === true,
      confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
      confidence_band: row.confidence_band,
      work_count: row.work_count ?? 0,
      evidence_count: row.evidence_count ?? 0,
      badge: pointBadge(row),
      source_url: row.wikidata_id ? `https://www.wikidata.org/wiki/${row.wikidata_id}` : null,
    },
  };
}

function clusterFeature(row) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [row.lng, row.lat] },
    properties: {
      cluster: true,
      point_count: row.cluster_count ?? 0,
      sample_name: row.sample_name ?? null,
      has_studio: row.has_studio === true,
    },
  };
}

// A queue row on the map. It is NOT a place feature and must never be shaped like one:
// no confidence, no confidence_band, no evidence_count, no place_class. Those are answers
// the review process produces, and giving a candidate a null one puts it in the same
// vocabulary as something we checked. What it carries instead is who said it, whether
// anybody has looked, and — from `studio-lots.mjs` — whether it is inside a fence.
//
// `candidate: true` is the flag the client draws on. It rides in properties rather than
// being inferred from a missing field, because "no confidence" and "confidence we have
// not computed" would otherwise be the same shape.
// A pin is a PLACE, and a place can be in ninety-six films.
//
// Measured 11.09.2026 over Los Angeles: 5,266 queue rows sit on **2,024 distinct
// coordinates**, and 3,750 of those rows — 71% — were drawn on top of each other. The
// busiest single point is the Millennium Biltmore Hotel with 96 films stacked on it. One
// feature per ROW meant the map showed the topmost and hid the rest.
//
// So a feature is now a point, and it carries the films listed there. It is NOT shaped
// like a place feature: no confidence, no band, no evidence count. Those are answers the
// review produces, and a null one puts an unexamined row in the same vocabulary as
// something we checked.
function candidateFeature(row) {
  const lot = studioLotAt(row.lat, row.lng);
  const films = Array.isArray(row.films) ? row.films : [];
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [row.lng, row.lat] },
    properties: {
      candidate: true,
      name: row.place_name,
      area_hint: row.area_hint ?? null,
      // Two different numbers, and a point where one film was shot twice is not a point
      // where two films were shot. The pin is sized by films, not by rows.
      work_count: row.work_count ?? films.length,
      row_count: row.row_count ?? films.length,
      // "In review" / "Source checked" — the same two words the film card uses.
      status: row.status ?? "pending",
      // Capped at 40 by the query. `work_count` is the true total beside it, so a popup
      // listing forty of ninety-six can say so instead of printing its cap as the count.
      films,
      films_truncated: (row.work_count ?? films.length) > films.length,
      // The pin is real; what it filmed is set somewhere else. Decided by the polygon,
      // never by the name — see [[studio-lots]].
      studio_lot: lot ? { slug: lot.slug, name: lot.name, access: lot.access } : null,
      depicts_elsewhere: Boolean(lot),
    },
  };
}

function candidateClusterFeature(row) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [row.lng, row.lat] },
    properties: {
      cluster: true,
      candidate: true,
      point_count: row.cluster_count ?? 0,
      // Places and films are two different numbers. A cluster stating only the first
      // cannot tell "one series with 87 pins" from "87 films", and in Los Angeles the
      // busiest cell is 163 films.
      work_count: row.work_count ?? 0,
      sample_name: row.sample_name ?? null,
    },
  };
}

export function candidateFeatures(query, rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => hasValidCoordinate(numeric(row?.lat), numeric(row?.lng)))
    .map((row) => (query.clustered ? candidateClusterFeature(row) : candidateFeature(row)));
}

// The centre of the requested viewport, for "nothing here — the nearest is…".
// Handles a window that crosses the antimeridian, where the midpoint is not the mean.
export function viewportCenter(query) {
  const lat = (query.south + query.north) / 2;
  if (query.west <= query.east) return { lat, lng: (query.west + query.east) / 2 };
  const span = 360 - query.west + query.east;
  let lng = query.west + span / 2;
  if (lng > 180) lng -= 360;
  return { lat, lng };
}

function nearestEntry(row) {
  return {
    place_id: row.place_id,
    wikidata_id: row.wikidata_id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    place_class: row.place_class,
    badge: pointBadge(row),
    // Rounded to the kilometre: the point is "far away in that direction", and a
    // metre-precise figure would imply a precision the underlying point may not have.
    distance_km: Number.isFinite(Number(row.distance_m))
      ? Math.round(Number(row.distance_m) / 1000)
      : null,
  };
}

// Shape the RPC rows into GeoJSON. Rows without a usable coordinate are dropped here
// too — the database already filters them, but the map must never receive a pin it
// cannot honestly place.
export function buildMapResponse(query, rows, fictionalRows = [], nearestRows = [], candidateRows = []) {
  const source = Array.isArray(rows) ? rows : [];
  const features = source
    .filter((row) => hasValidCoordinate(numeric(row?.lat), numeric(row?.lng)))
    .map((row) => (query.clustered ? clusterFeature(row) : placeFeature(row)));
  // A SEPARATE collection, not appended to `features`. Mixing them would make every
  // existing reader of this response — the map layer, the count in the panel, the route
  // builder — start counting unchecked rows as places, silently, on the day this shipped.
  const candidates = candidateFeatures(query, candidateRows);

  return {
    type: "FeatureCollection",
    features,
    candidates,
    clustered: query.clustered,
    zoom: query.zoom,
    // Clusters truncate too, and in Los Angeles they do: 1,023 cells at zoom 11. A
    // count is checked whether or not the viewport is clustered.
    truncated: features.length >= MAX_ROWS_PER_RESPONSE,
    candidates_truncated: candidates.length >= MAX_ROWS_PER_RESPONSE,
    map_threshold: MAP_THRESHOLD,
    // Fiction is never a pin, but it is real content: the client shows it as a strip
    // so "set in Mordor" is visible instead of silently missing.
    fictional: (Array.isArray(fictionalRows) ? fictionalRows : []).map((row) => ({
      place_id: row.place_id,
      wikidata_id: row.wikidata_id,
      name: row.name,
      work_count: row.work_count ?? 0,
    })),
    // An empty viewport should say "we have nothing HERE", not imply we have nothing.
    // Only populated when there is genuinely nothing in view.
    // "Nothing HERE" has to mean nothing at all. With the queue on the map a viewport can
    // hold 4,729 candidates and no verified place, and telling that reader the nearest
    // thing is 90 km away would be false about the screen they are looking at.
    nearest: features.length === 0 && candidates.length === 0
      ? (Array.isArray(nearestRows) ? nearestRows : []).map(nearestEntry)
      : [],
  };
}
