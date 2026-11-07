import test from "node:test";
import assert from "node:assert/strict";

import {
  PIN_COLORS, PIN_HOLLOW, PIN_HOLLOW_MANY, PIN_INK, PIN_SELECTED_RING,
  pinCirclePaint, pinFeature, pinFeatureProperties, pinLabelLayout, pinLabelPaint,
  CLUSTER_UNCHECKED_UNTIL_ZOOM, CLUSTERED, QUIET_UNTIL_ZOOM, UNCHECKED_DOT_RADIUS, UNCLUSTERED,
  pinClusterCirclePaint, pinClusterLabelPaint, pinClusterSource, quietRadiusExpression,
} from "../app/lib/pin-style.mjs";
import { MIN_PIN, PIN_KIND } from "../app/lib/map-pin.mjs";

// A style expression is data, so it can be run here instead of on a GPU. This is the subset
// MapLibre expressions the pin vocabulary actually uses — enough to assert what a pin LOOKS
// like rather than merely what shape the config has.
function evaluate(expression, properties) {
  if (!Array.isArray(expression)) return expression;

  const [op, ...args] = expression;
  if (op === "get") return properties[args[0]];
  if (op === "/") return evaluate(args[0], properties) / evaluate(args[1], properties);
  if (op === "case") {
    for (let i = 0; i + 1 < args.length; i += 2) {
      if (evaluate(args[i], properties)) return evaluate(args[i + 1], properties);
    }
    return evaluate(args[args.length - 1], properties);
  }
  throw new Error(`unsupported expression: ${op}`);
}

function draw(rawProperties) {
  const feature = pinFeature({ geometry: { type: "Point", coordinates: [0, 0] }, properties: rawProperties });
  // `highlighted` is set by the layer, not by `pinFeature`, so it is merged in here the way
  // the layer merges it.
  feature.properties.highlighted = rawProperties.highlighted === true;
  const paint = pinCirclePaint();
  return {
    radius: evaluate(paint["circle-radius"], feature.properties),
    fill: evaluate(paint["circle-color"], feature.properties),
    stroke: evaluate(paint["circle-stroke-color"], feature.properties),
    strokeWidth: evaluate(paint["circle-stroke-width"], feature.properties),
    label: evaluate(pinLabelLayout()["text-field"], feature.properties),
    ink: evaluate(pinLabelPaint()["text-color"], feature.properties),
  };
}

// Filled means somebody looked. 32,138 located rows are unchecked and 92 facts are not, so
// this is the distinction the whole map rests on.
test("a checked place is filled amber; an unchecked one is hollow with an amber ring", () => {
  const checked = draw({ work_count: 1, status: "verified" });
  const unchecked = draw({ work_count: 1, status: "pending" });

  assert.equal(checked.fill, PIN_COLORS[PIN_KIND.place]);
  assert.equal(unchecked.fill, PIN_HOLLOW);
  assert.equal(unchecked.stroke, PIN_COLORS[PIN_KIND.place]);
});

test("a studio lot is violet whether or not anybody checked it", () => {
  assert.equal(draw({ work_count: 1, status: "verified", depicts_elsewhere: true }).fill, PIN_COLORS[PIN_KIND.studio]);
  assert.equal(draw({ work_count: 1, depicts_elsewhere: true }).stroke, PIN_COLORS[PIN_KIND.studio]);
});

test("a narrative place is teal, and is not confused with a place the camera reached", () => {
  assert.equal(draw({ work_count: 1, status: "verified", narrative: true }).fill, PIN_COLORS[PIN_KIND.narrative]);
  assert.notEqual(PIN_COLORS[PIN_KIND.narrative], PIN_COLORS[PIN_KIND.place]);
});

// A count on a translucent disc over a dark street cannot be read — the same reason the CSS
// gives a multi-film unchecked pin a more opaque ground.
test("an unchecked pin holding several films gets a readable ground", () => {
  assert.equal(draw({ work_count: 12 }).fill, PIN_HOLLOW_MANY);
  assert.equal(draw({ work_count: 1 }).fill, PIN_HOLLOW);
});

test("selection is a ring and changes nothing else about the pin", () => {
  const plain = draw({ work_count: 3, depicts_elsewhere: true });
  const picked = draw({ work_count: 3, depicts_elsewhere: true, selected: true });

  assert.equal(picked.stroke, PIN_SELECTED_RING);
  assert.ok(picked.strokeWidth > plain.strokeWidth);
  // Still a studio lot, still hollow — the ring answers "what did I click", nothing more.
  assert.equal(picked.fill, plain.fill);
});

test("one film prints nothing; several print the number", () => {
  assert.equal(draw({ work_count: 1 }).label, "");
  assert.equal(draw({ work_count: 96 }).label, "96");
  assert.equal(draw({ work_count: 4000 }).label, "999+");
});

test("the number is drawn in ink a reader can see against its own pin", () => {
  assert.equal(draw({ work_count: 9, status: "verified" }).ink, PIN_INK[PIN_KIND.place]);
  // Hollow pin, so the number takes the pin's own colour rather than the dark ink.
  assert.equal(draw({ work_count: 9 }).ink, PIN_COLORS[PIN_KIND.place]);
});

// MapLibre measures circles by radius and the vocabulary is written in diameters. Getting
// this wrong draws every pin at twice its intended size and nothing fails loudly.
test("the circle radius is half the vocabulary's diameter", () => {
  assert.equal(draw({ work_count: 1 }).radius, MIN_PIN / 2);
});

test("a busier place is drawn bigger, and the growth does not saturate", () => {
  const one = draw({ work_count: 1 }).radius;
  const five = draw({ work_count: 5 }).radius;
  const ninetySix = draw({ work_count: 96 }).radius;

  assert.ok(five > one);
  assert.ok(ninetySix > five, "96 films must not draw the same as 5");
});

// The size and label come from the same functions the DOM path uses, so the two renderings
// cannot drift apart.
test("the shape is computed once, from the vocabulary, not restated here", () => {
  const shape = pinFeatureProperties({ work_count: 20, status: "verified" });
  assert.equal(shape.label, "20");
  assert.equal(shape.checked, true);
  assert.equal(shape.many, true);
  assert.equal(shape.kind, PIN_KIND.place);
});

test("a row with nothing in it still draws a pin rather than throwing", () => {
  assert.doesNotThrow(() => draw({}));
  assert.equal(draw({}).radius, MIN_PIN / 2);
  assert.equal(draw({}).label, "");
});

test("the feature keeps its geometry, so it lands where the place is", () => {
  const feature = pinFeature({
    geometry: { type: "Point", coordinates: [-118.3269, 34.1016] },
    properties: { work_count: 2 },
  });
  assert.deepEqual(feature.geometry.coordinates, [-118.3269, 34.1016]);
  assert.equal(feature.type, "Feature");
});

// The list and the map are one set seen twice. Pointing at a row lights its places, which
// is the same question selection answers — "which one is this?" — asked from the other side.
test("a pin whose film is under the pointer is lit like a selected one", () => {
  const plain = draw({ work_count: 2 });
  const lit = draw({ work_count: 2, highlighted: true });
  assert.equal(lit.stroke, PIN_SELECTED_RING);
  assert.ok(lit.strokeWidth > plain.strokeWidth);
});

test("highlighting changes nothing else about the pin", () => {
  const plain = draw({ work_count: 2, depicts_elsewhere: true });
  const lit = draw({ work_count: 2, depicts_elsewhere: true, highlighted: true });
  assert.equal(lit.fill, plain.fill);
  assert.equal(lit.radius, plain.radius);
  assert.equal(lit.label, plain.label);
});

// UX-1: the unchecked queue goes quiet at city zoom and clusters further out.
// Enough of `interpolate`/`step`/`any` over a fixed zoom to check what a quiet pin looks like.
function evaluateAt(expression, properties, zoom) {
  if (!Array.isArray(expression)) return expression;
  const [op, ...args] = expression;
  if (op === "zoom") return zoom;
  if (op === "any") return args.some((arg) => evaluateAt(arg, properties, zoom));
  if (op === "==") return evaluateAt(args[0], properties, zoom) === evaluateAt(args[1], properties, zoom);
  if (op === "interpolate") {
    const [, input, ...stops] = args;
    const z = evaluateAt(input, properties, zoom);
    const pairs = [];
    for (let i = 0; i < stops.length; i += 2) pairs.push([stops[i], evaluateAt(stops[i + 1], properties, zoom)]);
    if (z <= pairs[0][0]) return pairs[0][1];
    const last = pairs[pairs.length - 1];
    if (z >= last[0]) return last[1];
    const i = pairs.findIndex(([stop]) => stop >= z);
    const [z0, v0] = pairs[i - 1];
    const [z1, v1] = pairs[i];
    return v0 + ((z - z0) / (z1 - z0)) * (v1 - v0);
  }
  if (op === "step") {
    const [input, base, ...stops] = args;
    const z = evaluateAt(input, properties, zoom);
    let value = evaluateAt(base, properties, zoom);
    for (let i = 0; i < stops.length; i += 2) if (z >= stops[i]) value = evaluateAt(stops[i + 1], properties, zoom);
    return value;
  }
  if (op === "get") return properties[args[0]];
  if (op === "/") return evaluateAt(args[0], properties, zoom) / evaluateAt(args[1], properties, zoom);
  if (op === "case") {
    for (let i = 0; i + 1 < args.length; i += 2) {
      if (evaluateAt(args[i], properties, zoom)) return evaluateAt(args[i + 1], properties, zoom);
    }
    return evaluateAt(args[args.length - 1], properties, zoom);
  }
  throw new Error(`unsupported expression: ${op}`);
}

function quietPin(raw, zoom) {
  const feature = pinFeature({ geometry: { type: "Point", coordinates: [0, 0] }, properties: raw });
  feature.properties.highlighted = raw.highlighted === true;
  const props = feature.properties;
  return {
    radius: evaluateAt(pinCirclePaint({ quiet: true })["circle-radius"], props, zoom),
    labelOpacity: evaluateAt(pinLabelPaint({ quiet: true })["text-opacity"], props, zoom),
  };
}

test("below z16 an unchecked pin is a small dot with no number", () => {
  const pin = quietPin({ work_count: 3 }, 15);
  assert.equal(pin.radius, UNCHECKED_DOT_RADIUS);
  assert.equal(pin.labelOpacity, 0);
});

test("from z16 an unchecked pin is full size again and shows its count", () => {
  const pin = quietPin({ work_count: 3 }, QUIET_UNTIL_ZOOM);
  assert.ok(pin.radius >= MIN_PIN / 2);
  assert.equal(pin.labelOpacity, 1);
});

test("checked, selected and highlighted pins never go quiet", () => {
  for (const raw of [{ work_count: 3, status: "verified" }, { work_count: 3, selected: true }, { work_count: 3, highlighted: true }]) {
    const pin = quietPin(raw, 12);
    assert.ok(pin.radius >= MIN_PIN / 2, JSON.stringify(raw));
    assert.equal(pin.labelOpacity, 1);
  }
});

test("a pin that is not quiet keeps the old paint, with no zoom in it", () => {
  assert.deepEqual(pinCirclePaint()["circle-radius"], ["/", ["get", "diameter"], 2]);
  assert.equal(pinLabelPaint()["text-opacity"], undefined);
  assert.equal(quietRadiusExpression()[0], "interpolate");
});

test("the queue clusters up to z14 and splits into pins before it goes full size", () => {
  const source = pinClusterSource();
  assert.equal(source.cluster, true);
  assert.equal(source.clusterMaxZoom, CLUSTER_UNCHECKED_UNTIL_ZOOM);
  // MapLibre clusters through z14.99, so the dot band (bubbles split, queue not yet full
  // size) needs a whole zoom between the two.
  assert.ok(QUIET_UNTIL_ZOOM - CLUSTER_UNCHECKED_UNTIL_ZOOM >= 2);
  assert.deepEqual(UNCLUSTERED, ["!", CLUSTERED]);
});

test("a cluster of unchecked reports is hollow; one holding a checked place is filled", () => {
  const paint = pinClusterCirclePaint();
  const fill = (props) => evaluateAt(paint["circle-color"], props, 12);
  const stroke = (props) => evaluateAt(paint["circle-stroke-color"], props, 12);
  const ink = (props) => evaluateAt(pinClusterLabelPaint()["text-color"], props, 12);
  const queue = { checked: false, studio: false, highlighted: false };

  assert.equal(fill(queue), PIN_HOLLOW_MANY);
  assert.equal(stroke(queue), PIN_COLORS[PIN_KIND.place]);
  assert.equal(fill({ ...queue, checked: true }), PIN_COLORS[PIN_KIND.place]);
  assert.equal(ink({ ...queue, checked: true }), PIN_INK[PIN_KIND.place]);
  assert.equal(stroke({ ...queue, studio: true }), PIN_COLORS[PIN_KIND.studio]);
  assert.equal(fill({ ...queue, checked: true, studio: true }), PIN_COLORS[PIN_KIND.studio]);
  assert.equal(stroke({ ...queue, checked: true, highlighted: true }), PIN_SELECTED_RING);
  assert.equal(stroke({ ...queue, selected: true }), PIN_SELECTED_RING);
});

test("a pin's title is its film, with how many more it hides, else the place", async () => {
  const { pinTitle, pinFeature, pinNameTextField, TITLES_FROM_ZOOM } = await import("../app/lib/pin-style.mjs");
  assert.equal(pinTitle({ films: [{ title: "Munich" }], work_count: 1, name: "Jaffa" }), "Munich");
  assert.equal(pinTitle({ films: [{ title: "Munich" }, { title: "Fauda" }], work_count: 5 }), "Munich +4");
  assert.equal(pinTitle({ name: "Tel Aviv" }), "Tel Aviv");
  assert.equal(pinTitle({}), "");
  assert.equal(pinFeature({ geometry: { type: "Point", coordinates: [0, 0] }, properties: { name: "Haifa" } }).properties.title, "Haifa");
  // Ranked names show at every zoom; every other pin's title from street zoom.
  const field = pinNameTextField();
  assert.equal(field[0], "step");
  assert.deepEqual(field[2], ["get", "placeLabel"]);
  assert.equal(field[3], TITLES_FROM_ZOOM);
});
