import test from "node:test";
import assert from "node:assert/strict";

import {
  bearingDegrees,
  canGuide,
  cardinal,
  compassGuide,
  distanceText,
  headingFromOrientation,
  turnDegrees,
} from "../app/lib/compass.mjs";

test("bearing points north, east, south and west", () => {
  assert.equal(Math.round(bearingDegrees([51.5, -0.1], [51.6, -0.1])), 0);
  assert.equal(Math.round(bearingDegrees([0, 0], [0, 1])), 90);
  assert.equal(Math.round(bearingDegrees([51.6, -0.1], [51.5, -0.1])), 180);
  assert.equal(Math.round(bearingDegrees([0, 1], [0, 0])), 270);
  assert.equal(bearingDegrees([0, 0], null), null);
});

test("cardinal names the nearest of eight directions", () => {
  assert.equal(cardinal(0), "north");
  assert.equal(cardinal(44), "north-east");
  assert.equal(cardinal(359), "north");
  assert.equal(cardinal(-90), "west");
  assert.equal(cardinal(NaN), null);
});

test("turn is the short way round, positive to the right", () => {
  assert.equal(turnDegrees(90, 0), 90);
  assert.equal(turnDegrees(10, 350), 20);
  assert.equal(turnDegrees(350, 10), -20);
  assert.equal(turnDegrees(180, 0), 180);
  assert.equal(turnDegrees(90, null), null);
});

test("heading comes from iOS webkitCompassHeading or an absolute alpha only", () => {
  assert.equal(headingFromOrientation({ webkitCompassHeading: 120, alpha: 5 }), 120);
  assert.equal(headingFromOrientation({ absolute: true, alpha: 90 }), 270);
  // A landscape screen adds its rotation back.
  assert.equal(headingFromOrientation({ absolute: true, alpha: 90 }, 90), 0);
  // Relative alpha is tied to wherever the phone pointed at load, not to north.
  assert.equal(headingFromOrientation({ absolute: false, alpha: 90 }), null);
  assert.equal(headingFromOrientation(null), null);
});

test("distance text rounds to tens of metres, then km", () => {
  assert.equal(distanceText(3), "10 m");
  assert.equal(distanceText(124), "120 m");
  assert.equal(distanceText(1530), "1.5 km");
  assert.equal(distanceText(23400), "23 km");
});

test("only a pin can be walked to", () => {
  assert.equal(canGuide({ position: [51.5, -0.1], display: "pin" }), true);
  assert.equal(canGuide({ position: [51.5, -0.1], display: "area" }), false);
  assert.equal(canGuide({ position: null }), false);
});

const target = [51.5, -0.1];
const south = [51.499, -0.1]; // ~111 m south of the target

test("without a compass the guide gives distance and a map direction", () => {
  const guide = compassGuide({ position: south, target });
  assert.equal(guide.phase, "walk");
  assert.equal(guide.turn, null);
  assert.equal(guide.title, "110 m to the north");
});

test("with a compass the guide says which way to turn", () => {
  assert.equal(compassGuide({ position: south, target, heading: 5 }).title, "110 m straight ahead");
  assert.equal(compassGuide({ position: south, target, heading: 270 }).title, "110 m, turn 90° right");
  assert.equal(compassGuide({ position: south, target, heading: 60 }).title, "110 m, turn 60° left");
  assert.equal(compassGuide({ position: south, target, heading: 180 }).title, "110 m behind you");
});

test("arrival grows with a poor GPS fix, but not without limit", () => {
  const near = [51.49975, -0.1]; // ~28 m
  assert.equal(compassGuide({ position: near, target }).phase, "walk");
  assert.equal(compassGuide({ position: near, target, accuracy: 35 }).phase, "arrived");
  assert.equal(compassGuide({ position: south, target, accuracy: 500 }).phase, "walk");
  assert.equal(compassGuide({ position: null, target }), null);
});
