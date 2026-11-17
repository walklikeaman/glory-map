import assert from "node:assert/strict";
import test from "node:test";

import { EDGE_COLOR, EDGE_MAX_SIDE, edgeSize, sobelEdges } from "../app/lib/edge-ghost.mjs";

// A width x height image: black on the left half, white on the right.
function split(width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const v = x >= width / 2 ? 255 : 0;
      rgba[p] = v; rgba[p + 1] = v; rgba[p + 2] = v; rgba[p + 3] = 255;
    }
  }
  return rgba;
}
const alphaAt = (out, width, x, y) => out[(y * width + x) * 4 + 3];

test("the edge map is computed small, keeping the frame's shape", () => {
  assert.deepEqual(edgeSize(1920, 800), { width: EDGE_MAX_SIDE, height: 267 });
  assert.deepEqual(edgeSize(400, 300), { width: 400, height: 300 });
  assert.equal(edgeSize(0, 300), null);
  assert.equal(edgeSize(undefined, 300), null);
});

test("a hard edge becomes a line, and flat areas stay transparent", () => {
  const width = 8;
  const height = 6;
  const out = sobelEdges(split(width, height), width, height);
  // The step is between x=3 and x=4: both columns see it.
  assert.ok(alphaAt(out, width, 3, 2) > 0);
  assert.ok(alphaAt(out, width, 4, 2) > 0);
  assert.deepEqual([...out.slice((2 * width + 3) * 4, (2 * width + 3) * 4 + 3)], [...EDGE_COLOR]);
  // Far from the step there is nothing.
  assert.equal(alphaAt(out, width, 1, 2), 0);
  assert.equal(alphaAt(out, width, 6, 2), 0);
  // The border has no full neighbourhood.
  assert.equal(alphaAt(out, width, 3, 0), 0);
});

test("a soft step below the threshold is not drawn", () => {
  const width = 8;
  const height = 4;
  const rgba = split(width, height).map((v, i) => (i % 4 === 3 ? 255 : v ? 15 : 0));
  assert.ok(sobelEdges(rgba, width, height).every((v) => v === 0));
});

test("a buffer too small for its size gives an empty map instead of throwing", () => {
  assert.equal(sobelEdges(new Uint8ClampedArray(4), 8, 8).length, 8 * 8 * 4);
  assert.ok(sobelEdges(null, 2, 2).every((v) => v === 0));
});
