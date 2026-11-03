import assert from "node:assert/strict";
import test from "node:test";

import { haversineKm } from "../app/lib/geo.mjs";
import {
  NEARBY_CELL_DEGREES,
  buildLocationsSparql,
  nearbyQueryCell,
} from "../app/lib/location-search.mjs";

test("two pans a few hundred metres apart ask Wikidata the same question", () => {
  const a = nearbyQueryCell({ lat: 51.50731, lng: -0.12764, radius: 9.83 });
  const b = nearbyQueryCell({ lat: 51.50689, lng: -0.12801, radius: 9.91 });
  assert.deepEqual(a, b);
  const query = (cell) => buildLocationsSparql({ ...cell, sourceLimit: 30, kind: "all" });
  assert.equal(query(a), query(b));
});

test("the cell's circle always covers the circle asked about", () => {
  for (let i = 0; i < 500; i += 1) {
    const lat = -60 + ((i * 37.17) % 120);
    const lng = -179 + ((i * 71.31) % 358);
    const radius = 0.1 + ((i * 3.7) % 40);
    const cell = nearbyQueryCell({ lat, lng, radius });
    const drift = haversineKm([lat, lng], [cell.lat, cell.lng]);
    assert.ok(cell.radius >= radius + drift - 1e-9, `${JSON.stringify({ lat, lng, radius, cell })}`);
    // Not wildly bigger: at most one step plus the drift.
    assert.ok(cell.radius <= radius + drift + 0.5 + 1e-9);
  }
});

test("the centre lands on the grid and prints without float noise", () => {
  const cell = nearbyQueryCell({ lat: 51.50500000000001, lng: -0.12749999, radius: 5 });
  assert.equal(cell.lat, 51.505);
  assert.equal(cell.lng, -0.125);
  assert.ok(Math.abs(cell.lat / NEARBY_CELL_DEGREES - Math.round(cell.lat / NEARBY_CELL_DEGREES)) < 1e-6);
  assert.match(String(cell.lat), /^-?\d+(\.\d{1,3})?$/);
  assert.match(String(cell.radius), /^\d+(\.5)?$/);
});

test("a tiny radius still asks for one whole step", () => {
  assert.equal(nearbyQueryCell({ lat: 51.505, lng: -0.125, radius: 0.1 }).radius, 0.5);
});
