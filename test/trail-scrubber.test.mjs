import assert from "node:assert/strict";
import test from "node:test";

import { scrubIndex, scrubLabel, scrubStops } from "../app/lib/trail-scrubber.mjs";

test("the timeline runs in story order and skips what has no place on the map", () => {
  const stops = scrubStops([
    { id: "b", sequence_index: 7, place: "B", position: [1, 2] },
    { id: "a", sequence_index: 2, place: "A", position: [3, 4] },
    { id: "x", sequence_index: 4, place: "Withheld" },
    null,
  ]);
  assert.deepEqual(stops.map((stop) => stop.id), ["a", "b"]);
});

test("a stale slider value lands on a real stop", () => {
  assert.equal(scrubIndex(9, 3), 2);
  assert.equal(scrubIndex(-1, 3), 0);
  assert.equal(scrubIndex("1", 3), 1);
  assert.equal(scrubIndex("nope", 3), 0);
  assert.equal(scrubIndex(4, 0), 0);
});

test("the label says where in the story and where on the map", () => {
  assert.equal(
    scrubLabel({ sequence_index: 7, place: "Portobello Road" }, 1, 4),
    "2 of 4 · scene 7 · Portobello Road",
  );
  assert.equal(scrubLabel(null, 0, 0), "");
});
