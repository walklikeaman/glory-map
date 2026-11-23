import assert from "node:assert/strict";
import test from "node:test";

import { keepTheWalk, tileTemplates } from "../app/lib/keep-the-walk.mjs";

const WALK = [[51.5194, -0.1270], [51.5100, -0.1340]];

function mapWith({ sources = {}, loaded = {} } = {}) {
  return {
    getStyle: () => ({ sources }),
    getSource: (id) => loaded[id] ?? null,
  };
}

// A hard-coded MapTiler URL would keep the wrong tiles the day the basemap changes, and
// nothing at all on OpenFreeMap.
test("the templates come from the style the map is actually drawing", () => {
  const map = mapWith({
    sources: { openmaptiles: { type: "vector", url: "https://api.maptiler.com/tiles/v3/tiles.json" } },
    loaded: { openmaptiles: { tiles: ["https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=k"] } },
  });
  assert.deepEqual(tileTemplates(map), ["https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=k"]);
});

test("a source that has not resolved its tiles yet contributes nothing, quietly", () => {
  const map = mapWith({ sources: { openmaptiles: { type: "vector", url: "https://x/tiles.json" } } });
  assert.deepEqual(tileTemplates(map), []);
});

test("geojson and image sources are not tile sources", () => {
  const map = mapWith({
    sources: {
      pins: { type: "geojson", data: {} },
      basemap: { type: "raster", tiles: ["https://x/{z}/{x}/{y}.png"] },
    },
  });
  assert.deepEqual(tileTemplates(map), ["https://x/{z}/{x}/{y}.png"]);
});

test("a walk with a tile source is fetched once, and counted", async () => {
  const asked = [];
  const map = mapWith({ sources: { v: { type: "vector", tiles: ["https://x/{z}/{x}/{y}.pbf"] } } });

  const result = await keepTheWalk(map, WALK, {
    fetchImpl: async (url) => { asked.push(url); return { ok: true }; },
  });

  assert.equal(result.reason, null);
  assert.ok(result.kept > 0);
  assert.equal(result.failed, 0);
  assert.equal(asked.length, result.kept);
  assert.ok(asked.every((url) => /^https:\/\/x\/\d+\/\d+\/\d+\.pbf$/.test(url)));
});

// A tile that does not arrive is a tile the walk will ask for on the day — which is what
// happened before this existed, so one failure must not stop the rest.
test("a refused tile is counted, not thrown", async () => {
  const map = mapWith({ sources: { v: { type: "vector", tiles: ["https://x/{z}/{x}/{y}.pbf"] } } });
  let call = 0;

  const result = await keepTheWalk(map, WALK, {
    fetchImpl: async () => { call += 1; if (call === 1) throw new Error("offline"); return { ok: true }; },
  });

  assert.equal(result.failed, 1);
  assert.ok(result.kept >= 1);
});

test("a style with no tile source, and a route that is not one, both say why", async () => {
  const empty = await keepTheWalk(mapWith(), WALK, { fetchImpl: async () => ({ ok: true }) });
  assert.equal(empty.reason, "no_tile_source");

  const map = mapWith({ sources: { v: { type: "vector", tiles: ["https://x/{z}/{x}/{y}.pbf"] } } });
  const short = await keepTheWalk(map, [[51.5, -0.1]], { fetchImpl: async () => ({ ok: true }) });
  assert.equal(short.reason, "no_route");
});

// ---------- the walk's own copy (#70) ----------

import { readFileSync } from "node:fs";
import {
  bytesLabel, forgetTheWalk, keptWalkSummary, openWalkCache, rememberKeptWalk, WALK_CACHE, WALK_META_KEY,
} from "../app/lib/keep-the-walk.mjs";

function fakeCaches() {
  const stores = new Map();
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return { put: async (url, response) => { store.set(url, response); } };
    },
    async delete(name) { return stores.delete(name); },
    async has(name) { return stores.has(name); },
  };
}

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test("a kept walk is written into its own cache, with its real size", async () => {
  const cacheStorage = fakeCaches();
  const map = mapWith({ sources: { v: { type: "vector", tiles: ["https://x/{z}/{x}/{y}.pbf"] } } });
  const cache = await openWalkCache(cacheStorage);
  const result = await keepTheWalk(map, WALK, {
    cache,
    fetchImpl: async () => new Response(new Uint8Array(1000)),
  });
  assert.equal(cacheStorage.stores.get(WALK_CACHE).size, result.kept);
  assert.equal(result.bytes, result.kept * 1000);
});

test("a new walk replaces the old one, and removing it forgets both cache and summary", async () => {
  const cacheStorage = fakeCaches();
  const storage = memoryStorage();
  (await openWalkCache(cacheStorage)).put("https://x/old", new Response("old"));
  await openWalkCache(cacheStorage);
  assert.equal(cacheStorage.stores.get(WALK_CACHE).size, 0);

  rememberKeptWalk(storage, { kept: 12, failed: 1, bytes: 300_000, truncated: false, reason: null });
  assert.deepEqual(await keptWalkSummary(cacheStorage, storage), { kept: 12, failed: 1, bytes: 300_000, truncated: false, reason: null });

  await forgetTheWalk(cacheStorage, storage);
  assert.equal(storage.getItem(WALK_META_KEY), null);
  assert.equal(await keptWalkSummary(cacheStorage, storage), null);
});

test("a summary whose cache the browser cleared is not reported as kept", async () => {
  const storage = memoryStorage();
  rememberKeptWalk(storage, { kept: 3, failed: 0, bytes: 9000, truncated: false, reason: null });
  assert.equal(await keptWalkSummary(fakeCaches(), storage), null);
  // A new keep that stored nothing drops the old walk's summary: its cache is gone too.
  rememberKeptWalk(storage, { kept: 0, failed: 4, bytes: 0, reason: null });
  assert.equal(storage.getItem(WALK_META_KEY), null);
  rememberKeptWalk(storage, { kept: 3, failed: 0, bytes: 9000, truncated: false, reason: null });
  rememberKeptWalk(storage, { kept: 0, failed: 0, reason: "no_tile_source" });
  assert.equal(storage.getItem(WALK_META_KEY), null);
});

test("sizes read as kB and MB", () => {
  assert.equal(bytesLabel(0), "");
  assert.equal(bytesLabel(300), "1 kB");
  assert.equal(bytesLabel(250_000), "244 kB");
  assert.equal(bytesLabel(3 * 1024 * 1024), "3.0 MB");
});

test("the service worker reads the same walk cache the page writes", () => {
  const worker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.ok(worker.includes(`const WALK = "${WALK_CACHE}";`));
  assert.match(worker, /new Set\(\[[^\]]*WALK\]\)/);
  assert.match(worker, /caches\.match\(request, \{ cacheName: WALK \}\)/);
});
