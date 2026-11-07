// The pin vocabulary, said again as GPU style expressions (#202, phase 2).
//
// `map-pin.mjs` decides what a pin MEANS and draws it as HTML for a Leaflet `divIcon`. That
// is one DOM element per pin, and with 1,008 of them on screen dragging the map runs at
// ~30 fps because the compositor redraws all of them every frame (#197).
//
// MapLibre draws the same vocabulary as two data-driven layers — a circle and a text label —
// and the GPU does not care whether there are ten of them or ten thousand. So the meaning
// has to be restated as expressions over feature properties instead of classes over
// elements. This module is that restatement, and it is kept pure and separate so the
// vocabulary can be tested without a GPU, exactly as `pinClasses` is tested without a DOM.
//
// **The one thing that cannot survive the move, stated plainly:** an unchecked pin is drawn
// with a DASHED outline in CSS, and a circle in MapLibre has no dashed stroke. The
// distinction it carries is far too important to lose — 32,138 located rows are unchecked
// and only 92 facts are not — so it survives as fill: a checked pin is solid, an unchecked
// pin is hollow, with the same amber ring around a near-transparent middle. Filled against
// outlined is the meaning; the dash was how that meaning was spelled.

import { MAX_PIN, MIN_PIN, PIN_KIND, pinKind, pinLabel, pinSize } from "./map-pin.mjs";

// The same colours the CSS uses, because the pin must not change appearance when the engine
// under it changes. Amber is somewhere you can stand, violet is a studio lot, teal is where
// the story happens and nobody claims a camera was there.
export const PIN_COLORS = Object.freeze({
  [PIN_KIND.place]: "#f7b733",
  [PIN_KIND.studio]: "#b98cff",
  [PIN_KIND.narrative]: "#6fd3c7",
});

// What a checked pin prints its number in — dark, because the pin behind it is filled.
export const PIN_INK = Object.freeze({
  [PIN_KIND.place]: "#16130c",
  [PIN_KIND.studio]: "#17102b",
  [PIN_KIND.narrative]: "#0b2320",
});

// The hollow middle of an unchecked pin. Not fully transparent: a count printed straight
// onto a dark street at night cannot be read, which is the same reason the CSS gives a
// multi-film unchecked pin a more opaque ground.
export const PIN_HOLLOW = "rgba(12, 10, 7, 0.55)";
export const PIN_HOLLOW_MANY = "rgba(12, 10, 7, 0.88)";

// The ring that answers "what did I just click?". It never changes the other three answers:
// a selected studio lot is still violet and still hollow if nobody checked it.
export const PIN_SELECTED_RING = "#fff3a5";

// What each feature must carry for the expressions below to draw it. Built here rather than
// read ad hoc in a component so that the map layer and the legend cannot disagree about
// what a pin is — they read the same function.
export function pinFeatureProperties(props = {}) {
  const count = Number(props.work_count ?? props.filmCount ?? 1);
  const kind = pinKind({
    depicts_elsewhere: props.depicts_elsewhere,
    narrative: props.narrative,
  });

  return {
    kind,
    checked: props.checked === true || props.status === "verified",
    // Precomputed rather than expressed, because `pinSize` is a logarithm and MapLibre
    // expressions have no log. Keeping the arithmetic in JS also keeps ONE definition of
    // how a pin grows — the DOM path and the GPU path cannot drift apart.
    diameter: pinSize(count),
    label: pinLabel(count),
    many: Number.isFinite(count) && count > 1,
    selected: props.selected === true,
    // What the pin says under itself once the reader has zoomed in to street level: the
    // film, because that is what they came for, and the place's own name when we hold no
    // film title for it. A row of bare dots at z16 was "просто точки" on a phone.
    title: pinTitle(props),
  };
}

// The first film's title, plus "+N" when the point holds more, else the place name.
export function pinTitle(props = {}) {
  const films = Array.isArray(props.films) ? props.films : [];
  const first = films.find((film) => film?.title)?.title;
  if (!first) return String(props.name ?? "");
  const total = Number(props.work_count ?? films.length);
  return Number.isFinite(total) && total > 1 ? `${first} +${total - 1}` : first;
}

// From this zoom every unclustered pin carries its title (the ranked names in
// `placeLabels` show earlier). Bubbles split at CLUSTER_UNCHECKED_UNTIL_ZOOM + 1, so this is
// the first zoom where every pin stands alone.
export const TITLES_FROM_ZOOM = 15;

// The label under a pin: the ranked name when it earned one, and from TITLES_FROM_ZOOM
// every other pin's title too. MapLibre drops names that collide, so a crowded street
// shows the ones that fit rather than a smear.
export function pinNameTextField() {
  return [
    "step", ["zoom"],
    ["get", "placeLabel"],
    TITLES_FROM_ZOOM,
    ["case", ["!=", ["get", "placeLabel"], ""], ["get", "placeLabel"], ["get", "title"]],
  ];
}

// MapLibre measures a circle by its radius; the vocabulary is written in diameters.
export function circleRadiusExpression() {
  return ["/", ["get", "diameter"], 2];
}

// Filled means somebody looked. That is evidence, not decoration.
export function circleColorExpression() {
  return [
    "case",
    ["get", "checked"], ["get", "kindColor"],
    ["get", "many"], PIN_HOLLOW_MANY,
    PIN_HOLLOW,
  ];
}

// The outline carries the colour on a hollow pin, and a quiet white edge on a filled one so
// an amber pin on amber-lit satellite imagery still has a border.
export function circleStrokeColorExpression() {
  return [
    "case",
    // Pointing at a row in the list lights its places. It reads like selection because it
    // IS the same question — "which one is this?" — asked from the other side.
    ["get", "highlighted"], PIN_SELECTED_RING,
    ["get", "selected"], PIN_SELECTED_RING,
    ["get", "checked"], "rgba(255, 255, 255, 0.85)",
    ["get", "kindColor"],
  ];
}

export function circleStrokeWidthExpression() {
  return ["case", ["get", "highlighted"], 4, ["get", "selected"], 4, ["get", "checked"], 2, 1.5];
}

// One film prints nothing. A "1" on every pin is noise, and the number exists to mark the
// points that hide something.
export function labelTextExpression() {
  return ["get", "label"];
}

export function labelColorExpression() {
  return ["case", ["get", "checked"], ["get", "kindInk"], ["get", "kindColor"]];
}

// Everything a MapLibre circle layer needs to draw the vocabulary, in one object, so a
// component never assembles paint properties by hand.
export function pinCirclePaint({ quiet = false } = {}) {
  return {
    "circle-radius": quiet ? quietRadiusExpression() : circleRadiusExpression(),
    "circle-color": circleColorExpression(),
    "circle-stroke-color": circleStrokeColorExpression(),
    "circle-stroke-width": circleStrokeWidthExpression(),
  };
}

export function pinLabelLayout() {
  return {
    "text-field": labelTextExpression(),
    "text-size": 11,
    "text-font": ["Noto Sans Bold"],
    "text-allow-overlap": true,
    "text-ignore-placement": true,
  };
}

export function pinLabelPaint({ quiet = false } = {}) {
  const paint = { "text-color": labelColorExpression() };
  // A dot has no room for a number, so a quiet pin's count waits for the zoom where the pin
  // is full size again.
  if (quiet) paint["text-opacity"] = ["step", ["zoom"], ["case", loudExpression(), 1, 0], QUIET_UNTIL_ZOOM, 1];
  return paint;
}

// A GeoJSON feature the layers above can draw, from one row of the map API. The colour and
// the ink are resolved HERE rather than in an expression, because a `match` over three kinds
// repeated in four expressions is four places to add a fourth kind and forget one.
export function pinFeature(feature) {
  const props = feature?.properties ?? {};
  const shape = pinFeatureProperties(props);

  return {
    type: "Feature",
    geometry: feature?.geometry,
    properties: {
      ...shape,
      kindColor: PIN_COLORS[shape.kind],
      kindInk: PIN_INK[shape.kind],
    },
  };
}

// ---------------------------------------------------------------------------------------
// UX-1, "pin soup": at city zoom the queue drew hundreds of overlapping hollow circles, each
// as big as a checked pin, with "2" and "3" printed on half of them. Two changes, both
// mostly about the unchecked pins, because a checked pin is evidence:
//
// - Below QUIET_UNTIL_ZOOM an unchecked pin is a small dot with no number (z15 is the dot
//   band: bubbles split at z15 and the queue grows to full size by z16). It still says
//   "something was reported here", it just stops competing with the places somebody checked.
//   A selected or highlighted one keeps its full size: the reader asked about that one.
// - Up to CLUSTER_UNCHECKED_UNTIL_ZOOM nearby pins, checked and unchecked together, merge
//   into one numbered bubble (MapLibre's own clustering on the source), so a district reads
//   as "40 here" instead of forty rings stacked on each other.

export const QUIET_UNTIL_ZOOM = 16;
export const UNCHECKED_DOT_RADIUS = 4;
export const CLUSTER_UNCHECKED_UNTIL_ZOOM = 14;
// Pixels. Wide enough that a street of pins becomes one bubble, narrow enough that two
// districts stay two.
export const CLUSTER_RADIUS_PX = 48;

// The pins that keep their voice while the rest go quiet.
function loudExpression() {
  return ["any", ["get", "checked"], ["get", "selected"], ["get", "highlighted"]];
}

export function quietRadiusExpression() {
  return [
    "interpolate", ["linear"], ["zoom"],
    QUIET_UNTIL_ZOOM - 1, ["case", loudExpression(), circleRadiusExpression(), UNCHECKED_DOT_RADIUS],
    QUIET_UNTIL_ZOOM, circleRadiusExpression(),
  ];
}

// What the clustered source is created with. The cluster keeps four facts from what it
// swallowed: whether a checked place is inside (then it is filled, like the pin would be),
// whether a studio lot is (violet, the one colour the pins insist on), and whether the film
// the reader is pointing at, or the pin whose card is open, is inside (the selection ring),
// so "where is it?" still gets an answer at city zoom.
export function pinClusterSource() {
  return {
    cluster: true,
    clusterMaxZoom: CLUSTER_UNCHECKED_UNTIL_ZOOM,
    clusterRadius: CLUSTER_RADIUS_PX,
    clusterProperties: {
      checked: ["any", ["get", "checked"]],
      studio: ["any", ["==", ["get", "kind"], PIN_KIND.studio]],
      highlighted: ["any", ["get", "highlighted"]],
      selected: ["any", ["get", "selected"]],
    },
  };
}

// A point the clustering left alone. Every pin layer on a clustered source needs it, or
// MapLibre draws each bubble a second time as a pin with no colour.
export const UNCLUSTERED = ["!", ["has", "point_count"]];
export const CLUSTERED = ["has", "point_count"];

// Same growth curve as the server's cluster bubbles in GraphLayer, so a bubble means the
// same size at z11 (server) and z14 (here).
export function clusterRadiusExpression() {
  return ["min", 30, ["+", 14, ["*", 8, ["log10", ["max", 1, ["get", "point_count"]]]]]];
}

// Filled only when a checked place is inside; a bubble of unchecked reports stays hollow,
// because a filled one would claim somebody looked.
function clusterColorExpression() {
  return ["case", ["get", "studio"], PIN_COLORS[PIN_KIND.studio], PIN_COLORS[PIN_KIND.place]];
}

export function pinClusterCirclePaint() {
  return {
    "circle-radius": clusterRadiusExpression(),
    "circle-color": ["case", ["get", "checked"], clusterColorExpression(), PIN_HOLLOW_MANY],
    "circle-stroke-color": [
      "case",
      ["any", ["get", "highlighted"], ["get", "selected"]], PIN_SELECTED_RING,
      ["get", "checked"], "rgba(255, 255, 255, 0.85)",
      clusterColorExpression(),
    ],
    "circle-stroke-width": ["case", ["any", ["get", "highlighted"], ["get", "selected"]], 4, 2],
  };
}

export function pinClusterLabelLayout() {
  return {
    "text-field": ["get", "point_count_abbreviated"],
    "text-size": 12,
    "text-font": ["Noto Sans Bold"],
    "text-allow-overlap": true,
    "text-ignore-placement": true,
  };
}

export function pinClusterLabelPaint() {
  return {
    "text-color": [
      "case",
      ["get", "checked"], ["case", ["get", "studio"], PIN_INK[PIN_KIND.studio], PIN_INK[PIN_KIND.place]],
      "#f7e2b0",
    ],
  };
}

export { MAX_PIN, MIN_PIN };
