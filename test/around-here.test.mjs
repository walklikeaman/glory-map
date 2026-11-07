import assert from "node:assert/strict";
import test from "node:test";

import { aroundBox, aroundHere, distanceLabel } from "../app/lib/around-here.mjs";

const point = (lat, lng, name, films) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties: { name, films },
});

const godfather = { work_id: "w1", title: "The Godfather", year: 1972, imdb: 9.2, imdb_votes: 2_000_000 };
const lotus = { work_id: "w2", title: "The White Lotus", year: 2021, imdb: 8, imdb_votes: 200_000 };
const local = { work_id: "w3", title: "A Local Short", year: 2019 };

test("a box around a point is wider in longitude away from the equator", () => {
  const box = aroundBox([38, 15], 20);
  assert.ok(Math.abs((box.north - box.south) / 2 - 20 / 111.32) < 1e-9);
  assert.ok(box.east - box.west > box.north - box.south);
  assert.ok(box.west < 15 && box.east > 15);
});

test("the best-known work comes first, at its place nearest to the reader", () => {
  const taormina = [37.852, 15.288];
  const features = [
    point(37.85, 15.29, "San Domenico Palace", [lotus]),
    point(37.95, 15.34, "Bar Vitelli, Savoca", [godfather]),
    point(38.3, 15.6, "Far Godfather spot", [godfather]),
    point(37.853, 15.287, "Taormina station", [local]),
  ];
  const rows = aroundHere(features, taormina);
  assert.deepEqual(rows.map((row) => row.film.title), ["The Godfather", "The White Lotus", "A Local Short"]);
  assert.equal(rows[0].place.name, "Bar Vitelli, Savoca");
  assert.equal(rows[0].feature, features[1]);
  assert.ok(rows[0].place.km > 5 && rows[0].place.km < 20);
});

test("unrated works still fill a short list, clusters are ignored, the limit holds", () => {
  const cluster = { geometry: { coordinates: [15, 38] }, properties: { cluster: true, films: [godfather] } };
  const rows = aroundHere([cluster, point(38, 15, "Somewhere", [local])], [38, 15]);
  assert.deepEqual(rows.map((row) => row.film.title), ["A Local Short"]);
  assert.equal(aroundHere([point(38, 15, "A", [godfather, lotus, local])], [38, 15], { limit: 2 }).length, 2);
  assert.deepEqual(aroundHere(null, [38, 15]), []);
});

test("distances read the way a walker says them", () => {
  assert.equal(distanceLabel(0.004), "10 m");
  assert.equal(distanceLabel(0.346), "350 m");
  assert.equal(distanceLabel(3.26), "3.3 km");
  assert.equal(distanceLabel(42.4), "42 km");
  assert.equal(distanceLabel(NaN), "");
});
