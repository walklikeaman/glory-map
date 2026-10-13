// Visual vocabulary for the graph layer — pure, so what a pin MEANS is decided here
// and unit-tested, not buried in a Leaflet callback.
//
// The point of distinct styling is honesty (ARCHITECTURE.md §3): a filmed-on-this-street
// point, a studio that merely stands in for the story, a book's real setting, and a
// city-centroid approximation are four different claims and must not look identical.

import { CLUSTER_BELOW_ZOOM } from "./map-points.mjs";

export const BADGE_STYLES = Object.freeze({
  // Filmed right here, coordinates good to the point.
  exact: Object.freeze({
    color: "#f7b733", fillColor: "#f7b733", fillOpacity: 0.85,
    radius: 7, weight: 2, dashArray: null,
    label: "Filmed here", hint: "The exact spot is confirmed",
  }),
  // We only know the city/country: drawn deliberately larger and dashed so it reads
  // as a region, never as a doorstep.
  approximate: Object.freeze({
    color: "#f7b733", fillColor: "#f7b733", fillOpacity: 0.18,
    radius: 12, weight: 2, dashArray: "3 4",
    label: "Approximate", hint: "Only the city or country is known",
  }),
  // Named by a checked source, but the spot itself is unconfirmed: the pin may sit at
  // the street's or the district's geocode rather than the doorway. Dashed like
  // `approximate`, at pin size, because it claims a place rather than a region.
  unconfirmed: Object.freeze({
    color: "#f7b733", fillColor: "#f7b733", fillOpacity: 0.35,
    radius: 7, weight: 2, dashArray: "3 3",
    label: "Spot unconfirmed", hint: "The source names this place; its exact spot is not confirmed yet",
  }),
  // Real, correctly located — but it depicts somewhere else.
  studio: Object.freeze({
    color: "#b98cff", fillColor: "#b98cff", fillOpacity: 0.8,
    radius: 8, weight: 2, dashArray: null,
    label: "Studio", hint: "Shot on a set — the story is set elsewhere",
  }),
  // A book's setting: real place, but narrative rather than a shooting location.
  narrative: Object.freeze({
    color: "#6fd3c7", fillColor: "#6fd3c7", fillOpacity: 0.75,
    radius: 7, weight: 2, dashArray: null,
    label: "Set here", hint: "Where the story takes place",
  }),
});

// A queue row. HOLLOW — no fill at all — because that is the one thing on this map that
// reads instantly as "an outline of something, not the thing". Every badge above is
// filled, and the difference between "we checked this" and "somebody said this" has to
// survive being glanced at on a phone in the street.
//
// It borrows no badge colour. A candidate that looked like a dimmer `exact` would read as
// a weaker version of a verified place, and it is not weaker — it is unexamined, which is
// a different axis ([[three-axes]]).
export const CANDIDATE_STYLE = Object.freeze({
  color: "#9aa0a6", fillColor: "#9aa0a6", fillOpacity: 0,
  radius: 5, weight: 1.5, dashArray: "2 3",
  label: "In review", hint: "Named by a source. Nobody has checked it.",
});

// A candidate inside a studio lot keeps the hollow ring — it is still unchecked — and
// takes the studio colour, so the two facts stay separable: unexamined AND a backlot.
export const CANDIDATE_STUDIO_STYLE = Object.freeze({
  ...CANDIDATE_STYLE,
  color: "#b98cff", fillColor: "#b98cff",
  label: "In review · studio lot",
  hint: "Named by a source, and inside a studio lot. The camera was here; the story is set elsewhere.",
});

// A point with ninety-six films on it is not the same size as one with a single film.
// Growing it logarithmically for the same reason the clusters do: a linear scale saturates
// against the clamp almost at once, and 5 films and 96 draw identically.
export function candidateRadius(workCount) {
  const n = Number.isFinite(workCount) && workCount > 0 ? workCount : 1;
  if (n <= 1) return CANDIDATE_STYLE.radius;
  return Math.min(16, CANDIDATE_STYLE.radius + Math.log10(n) * 6);
}

export function candidateStyle(feature, { selected = false } = {}) {
  const props = feature?.properties ?? {};
  const shape = props.depicts_elsewhere ? CANDIDATE_STUDIO_STYLE : CANDIDATE_STYLE;
  const base = { ...shape, radius: candidateRadius(props.work_count) };
  if (!selected) return base;
  // Selection FILLS it, which is the one moment a candidate may look solid: the reader
  // is pointing at it, so it is no longer competing with the verified pins for meaning.
  return { ...base, radius: base.radius + 3, weight: 2.5, color: "#fff3a5", fillOpacity: 0.35 };
}

// The queue's clusters are hollow for the same reason, and grey, so a zoomed-out map
// never suggests the graph covers a city it has barely looked at.
export function candidateClusterStyle(count) {
  return {
    radius: clusterRadius(count),
    color: "#9aa0a6",
    fillColor: "#16130c",
    fillOpacity: 0.45,
    weight: 1.5,
    dashArray: "3 4",
  };
}

const FALLBACK_BADGE = "exact";

export function badgeStyle(badge) {
  return BADGE_STYLES[badge] ?? BADGE_STYLES[FALLBACK_BADGE];
}

// Selection is shown by growing the ring rather than recolouring it, so the badge
// (what the point IS) survives the interaction state.
export function pointStyle(feature, { selected = false } = {}) {
  const base = badgeStyle(feature?.properties?.badge);
  if (!selected) return base;
  return {
    ...base,
    radius: base.radius + 4,
    weight: 3,
    color: "#fff3a5",
    fillOpacity: Math.min(1, base.fillOpacity + 0.15),
  };
}

// Cluster bubbles scale LOGARITHMICALLY. A sqrt (or linear) scale saturates against
// the upper clamp almost immediately — with sqrt*3 a cluster of 50 and one of 5000
// were both drawn at the maximum radius, which tells the reader they are the same
// size. log10 keeps 1 → 10 → 100 → 1000 visibly distinct across the whole range.
export function clusterRadius(count) {
  const n = Number.isFinite(count) && count > 0 ? count : 1;
  return Math.max(12, Math.min(30, 12 + Math.log10(n) * 4.5));
}

export function clusterStyle(count, { hasStudio = false } = {}) {
  return {
    radius: clusterRadius(count),
    color: hasStudio ? "#b98cff" : "#f7b733",
    fillColor: "#16130c",
    fillOpacity: 0.78,
    weight: 2,
  };
}

// Leaflet bounds → the query the endpoint expects. Longitude is passed through as
// west/east without sorting: Leaflet reports a date-line-crossing viewport that way and
// the API reads it as a crossing window, not as its complement.
const COORDINATE_DECIMALS = 5;

function roundCoordinate(value) {
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}

export function viewportQuery(bounds, zoom, { workId = null, kinds = null, candidates = false } = {}) {
  if (!bounds) return null;
  const west = bounds.getWest?.() ?? bounds.west;
  const east = bounds.getEast?.() ?? bounds.east;
  const south = bounds.getSouth?.() ?? bounds.south;
  const north = bounds.getNorth?.() ?? bounds.north;
  if (![west, east, south, north].every((value) => Number.isFinite(value))) return null;
  // A box with no area is not a viewport. Leaflet answers `getBounds()` on a map it has
  // not measured with `west === east`, and the query built from it asks the server about a
  // single point — which returns nothing, honestly, and looks exactly like "there is
  // nothing here". Observed as an empty Los Angeles with 1,000 points one fetch away.
  //
  // Refusing it here means the layer keeps what it had and asks again on the next event,
  // instead of replacing real pins with an empty answer.
  if (west === east || south === north) return null;

  const params = new URLSearchParams({
    // Leaflet can report longitudes outside [-180,180] after wrapping; clamp so the
    // API's own validation doesn't reject a legitimate viewport.
    //
    // And round to five decimals (~1 m). MapLibre reports the same view twice with bounds
    // differing in the 13th decimal — measured on production, `west=-118.3473980957035`
    // then `-118.34739809570293` 1.3 s apart — so the same question went out as two
    // different URLs: two requests, and two edge-cache misses where one would have hit.
    west: String(roundCoordinate(Math.max(-180, Math.min(180, west)))),
    east: String(roundCoordinate(Math.max(-180, Math.min(180, east)))),
    south: String(roundCoordinate(Math.max(-90, Math.min(90, south)))),
    north: String(roundCoordinate(Math.max(-90, Math.min(90, north)))),
    z: String(Math.round(zoom ?? CLUSTER_BELOW_ZOOM)),
  });
  if (workId) params.set("workId", workId);
  if (kinds?.length) params.set("kinds", kinds.join(","));
  // Opt-in, and never alongside workId: a work-scoped map already draws its own
  // candidates through /api/locations, and asking for both draws every row twice.
  if (candidates && !workId) params.set("candidates", "1");
  return params.toString();
}

// What a candidate's popup says. It names the film first — on a browsable map a reader
// arrives at a pin without having asked about any particular work, so "which film is this"
// is the question, where on a film card it is already answered.
export function candidateSummary(properties) {
  if (!properties) return "";
  const style = properties?.depicts_elsewhere ? CANDIDATE_STUDIO_STYLE : CANDIDATE_STYLE;
  const checked = properties.status === "verified"
    // The review checked the SOURCE, not the claim. Saying "verified" here would promote
    // a queue row to a fact in the one place nobody would notice.
    ? "Source checked — still a candidate, not part of our graph."
    : style.hint;
  return checked;
}

// How many films sit on one point, said in words. The count leads because it is the reason
// the pin is worth opening — "96 films" is the whole story of the Millennium Biltmore.
export function pointFilmLine(properties) {
  const works = Number(properties?.work_count) || 0;
  const rows = Number(properties?.row_count) || works;
  if (works === 0) return "";
  const films = `${works} film${works === 1 ? "" : "s"}`;
  // Two different numbers: one film listing a place twice is not two films.
  return rows > works ? `${films} · ${rows} listings` : films;
}

// A short, honest one-liner for a point's popup.
export function pointSummary(properties) {
  if (!properties) return "";
  const style = badgeStyle(properties.badge);
  const works = properties.work_count === 1 ? "1 work" : `${properties.work_count ?? 0} works`;
  return `${style.label} · ${works}`;
}

// The line under the label: what the badge means, in words. It replaced the raw
// "none · confidence 0.8", which told a reader nothing they could act on.
export function pointHint(properties) {
  if (!properties) return "";
  return badgeStyle(properties.badge).hint;
}
