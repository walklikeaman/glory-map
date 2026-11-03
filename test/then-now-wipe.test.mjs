import assert from "node:assert/strict";
import test from "node:test";

import { clampReveal, revealFromPointer, revealLabel, wipeMode } from "../app/lib/then-now-wipe.mjs";

test("a wipe needs both images", () => {
  assert.equal(wipeMode({ thenUrl: "/f.jpg", nowUrl: "/n.jpg" }), "wipe");
  assert.equal(wipeMode({ thenUrl: "/f.jpg", nowUrl: null }), "pair");
  assert.equal(wipeMode({ thenUrl: null, nowUrl: "/n.jpg" }), "pair");
  assert.equal(wipeMode({ thenUrl: "", nowUrl: "/n.jpg" }), "pair");
  assert.equal(wipeMode(), "pair");
});

test("a broken image falls back to the pair", () => {
  assert.equal(wipeMode({ thenUrl: "/f.jpg", nowUrl: "/n.jpg", broken: new Set(["/n.jpg"]) }), "pair");
  assert.equal(wipeMode({ thenUrl: "/f.jpg", nowUrl: "/n.jpg", broken: new Set(["/f.jpg"]) }), "pair");
  assert.equal(wipeMode({ thenUrl: "/f.jpg", nowUrl: "/n.jpg", broken: new Set(["/other.jpg"]) }), "wipe");
});

test("the divider stays on the image", () => {
  assert.equal(clampReveal(-20), 0);
  assert.equal(clampReveal(140), 100);
  assert.equal(clampReveal("37.6"), 38);
  assert.equal(clampReveal("left"), 50);
  assert.equal(clampReveal(undefined), 50);
  assert.equal(clampReveal(null), 50);
  assert.equal(clampReveal(""), 50);
  assert.equal(clampReveal(0), 0);
});

test("a pointer maps to a percent across the image", () => {
  const rect = { left: 100, width: 400 };
  assert.equal(revealFromPointer(300, rect), 50);
  assert.equal(revealFromPointer(100, rect), 0);
  assert.equal(revealFromPointer(50, rect), 0);
  assert.equal(revealFromPointer(700, rect), 100);
  assert.equal(revealFromPointer(200, { left: 0, width: 0 }), 50);
  assert.equal(revealFromPointer(200, null), 50);
});

test("the slider says what is showing", () => {
  assert.equal(revealLabel(100), "Film frame only");
  assert.equal(revealLabel(0), "Today's photo only");
  assert.equal(revealLabel(30), "30% film frame, 70% today");
});
