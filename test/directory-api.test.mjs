import assert from "node:assert/strict";
import test from "node:test";

import { createDirectoryCitiesHandler } from "../app/api/directory/cities/route.js";
import { createDirectoryCityHandler } from "../app/api/directory/city/route.js";
import { createDirectoryFilmsHandler } from "../app/api/directory/films/route.js";
import { createDirectoryPlacesHandler } from "../app/api/directory/places/route.js";

const ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://db.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };

const get = (path) => new Request(`https://glorymap.local${path}`);

const row = (overrides = {}) => ({
  work_id: "d0296dd7-a372-4fe1-869b-2e189a002cce",
  title: "Skyfall",
  year: 2012,
  kind: "film",
  place_count: 36,
  places: ["Broadgate Tower", "Whitehall"],
  total_works: 656,
  total_points: 2300,
  ...overrides,
});

// ---------- one city ----------

test("an unknown city is a 404 decided here, and the database is never asked", () => {
  // Otherwise /city/<anything> is a way to make us scan the queue for free.
  let asked = false;
  const handler = createDirectoryCityHandler({
    env: ENV,
    createReader: () => ({ loadCity: async () => { asked = true; return []; } }),
  });
  return handler(get("/api/directory/city?slug=atlantis")).then(async (response) => {
    assert.equal(response.status, 404);
    assert.equal(asked, false);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });
});

test("a city page asks for its own anchor and radius", async () => {
  const calls = [];
  const handler = createDirectoryCityHandler({
    env: ENV,
    perPage: 48,
    createReader: () => ({
      loadCity: async (args) => { calls.push(args); return [row()]; },
    }),
  });

  const payload = await (await handler(get("/api/directory/city?slug=london"))).json();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].radiusKm, 20);
  assert.equal(calls[0].offset, 0);
  assert.equal(calls[0].limit, 48);
  // The anchor is the gazetteer's, to four decimal places, not something re-derived.
  assert.equal(calls[0].lat, 51.5089);
  assert.equal(calls[0].lng, -0.1241);

  assert.equal(payload.city.name, "London");
  assert.equal(payload.city.country, "UK");
  assert.equal(payload.works[0].title, "Skyfall");
  assert.equal(payload.works[0].place_count, 36);
  assert.equal(payload.points, 2300);
  assert.deepEqual([payload.page.page, payload.page.pages, payload.page.total], [1, 14, 656]);
});

test("the total rides on the rows, so one query answers both questions", async () => {
  // `count(*) over ()` is evaluated before LIMIT, which is what lets a 48-row page know
  // it is 48 of 656 without a second round trip.
  let calls = 0;
  const handler = createDirectoryCityHandler({
    env: ENV,
    perPage: 48,
    createReader: () => ({ loadCity: async () => { calls += 1; return [row()]; } }),
  });
  await handler(get("/api/directory/city?slug=london&page=3"));
  assert.equal(calls, 1);
});

test("a page past the end is re-asked at the first page rather than shown empty", async () => {
  // An empty page under a link we generated ourselves reads as lost data. This can only
  // be detected after the fact: an over-long offset returns no rows, and no rows carry
  // no total.
  const offsets = [];
  const handler = createDirectoryCityHandler({
    env: ENV,
    perPage: 48,
    createReader: () => ({
      loadCity: async ({ offset }) => {
        offsets.push(offset);
        return offset === 0 ? [row({ total_works: 12, total_points: 30 })] : [];
      },
    }),
  });

  const payload = await (await handler(get("/api/directory/city?slug=london&page=900"))).json();
  assert.deepEqual(offsets, [(900 - 1) * 48, 0]);
  assert.equal(payload.page.page, 1);
  assert.equal(payload.page.total, 12);
  assert.equal(payload.works.length, 1);
});

test("a city we hold nothing for is an empty page, not an error", async () => {
  const handler = createDirectoryCityHandler({
    env: ENV,
    createReader: () => ({ loadCity: async () => [] }),
  });
  const response = await handler(get("/api/directory/city?slug=jamestown"));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.works, []);
  assert.equal(payload.page.total, 0);
});

test("a failing query is a 502 that says nothing about the database", async () => {
  const logged = [];
  const handler = createDirectoryCityHandler({
    env: ENV,
    createReader: () => ({ loadCity: async () => { throw new Error("connection refused at 10.0.0.4"); } }),
    logError: (...args) => logged.push(args),
  });
  const response = await handler(get("/api/directory/city?slug=london"));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "The directory is unavailable");
  assert.equal(logged.length, 1);
});

test("no configuration is a 503 and not a crash", async () => {
  const handler = createDirectoryCityHandler({ env: {} });
  const response = await handler(get("/api/directory/city?slug=london"));
  assert.equal(response.status, 503);
});

// ---------- one letter ----------

test("an unknown letter is a 404 decided before any query", async () => {
  let asked = false;
  const handler = createDirectoryFilmsHandler({
    env: ENV,
    createReader: () => ({ loadLetter: async () => { asked = true; return []; } }),
  });
  for (const slug of ["zz", "1", "", "%23"]) {
    assert.equal((await handler(get(`/api/directory/films?letter=${slug}`))).status, 404);
  }
  assert.equal(asked, false);
});

test("the other bucket is asked for as a null letter, not as '#'", async () => {
  // The function takes "anything that is not a single a-z character" as everything else,
  // which is the same rule letterBucket() applies on this side.
  const letters = [];
  const handler = createDirectoryFilmsHandler({
    env: ENV,
    createReader: () => ({
      loadLetter: async ({ letter }) => {
        letters.push(letter);
        return [{ work_id: "x", title: "1917", title_norm: "1917", year: 2019, kind: "film", place_count: 4, total_works: 87 }];
      },
    }),
  });

  const payload = await (await handler(get("/api/directory/films?letter=other"))).json();
  assert.deepEqual(letters, ["#"]);
  assert.equal(payload.letter, "#");
  assert.equal(payload.works[0].title, "1917");
  assert.equal(payload.page.total, 87);
});

test("a letter page carries the work id the film card is addressed by", async () => {
  const handler = createDirectoryFilmsHandler({
    env: ENV,
    createReader: () => ({
      loadLetter: async () => [{
        work_id: "d0296dd7-a372-4fe1-869b-2e189a002cce",
        title: "Skyfall", title_norm: "skyfall", year: 2012, kind: "film",
        place_count: 36, total_works: 640,
      }],
    }),
  });
  const payload = await (await handler(get("/api/directory/films?letter=s"))).json();
  assert.equal(payload.works[0].id, "d0296dd7-a372-4fe1-869b-2e189a002cce");
});

// ---------- the index ----------

test("the index lists the gazetteer, and the database only says how much is in each", async () => {
  const handler = createDirectoryCitiesHandler({
    env: ENV,
    cities: [
      { slug: "london", name: "London", country: "UK", lat: 51.5089, lng: -0.1241, radius_km: 20 },
      { slug: "sofia", name: "Sofia", country: "Bulgaria", lat: 42.6932, lng: 23.325, radius_km: 20 },
    ],
    createReader: () => ({
      loadCityTotals: async () => [{ slug: "london", works: 656, points: 2300 }],
      loadLetterTotals: async () => [
        { letter: "s", works: 640, points: 3100 },
        { letter: "#", works: 87, points: 300 },
      ],
    }),
  });

  const payload = await (await handler(get("/api/directory/cities"))).json();

  // Sofia was not in the answer. It is shown at zero rather than dropped: a directory
  // that silently loses its empty entries is a directory that hides a broken query.
  assert.deepEqual(payload.cities.map((c) => [c.slug, c.works]), [["london", 656], ["sofia", 0]]);
  assert.equal(payload.letters.s, 640);
  assert.equal(payload.works, 727);
  // Both halves of the headline come from the letters, never one from the letters and the
  // other from the cities: 656 + 0 city points beside 727 works would be two different sets
  // in one sentence.
  assert.equal(payload.points, 3400);
});

test("the index sends anchors and not names", async () => {
  let sent = null;
  const handler = createDirectoryCitiesHandler({
    env: ENV,
    cities: [{ slug: "london", name: "London", country: "UK", lat: 51.5089, lng: -0.1241, radius_km: 20 }],
    createReader: () => ({
      loadCityTotals: async (anchors) => { sent = anchors; return []; },
      loadLetterTotals: async () => [],
    }),
  });
  await handler(get("/api/directory/cities"));
  assert.deepEqual(sent, [{ slug: "london", lat: 51.5089, lng: -0.1241, radius_km: 20 }]);
});

test("the index is cached at the edge, and its failures are not", async () => {
  // An ingest moves these numbers a few times a week; a stale count only understates
  // what we hold. An error cached for an hour is an outage that outlives its cause.
  const ok = createDirectoryCitiesHandler({
    env: ENV,
    cities: [],
    createReader: () => ({ loadCityTotals: async () => [], loadLetterTotals: async () => [] }),
  });
  const good = await ok(get("/api/directory/cities"));
  assert.match(good.headers.get("Cache-Control"), /max-age=3600/);

  const bad = createDirectoryCitiesHandler({
    env: ENV,
    cities: [],
    createReader: () => ({ loadCityTotals: async () => { throw new Error("nope"); }, loadLetterTotals: async () => [] }),
    logError: () => {},
  });
  const failed = await bad(get("/api/directory/cities"));
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get("Cache-Control"), "private, no-store");
});

// ---------- every place with an address ----------

const place = (id, name) => ({ id, name });

const A = "40d442dd-257e-424b-8043-50677eb30ca6";
const B = "75f7b94d-feb7-429f-bcd9-3f1d02a589e5";
const C = "dba56b0b-f313-44a4-a8c1-cac4a4afeb88";

test("a place row without a fact is not listed, because it has no page", async () => {
  // `/api/place` 404s a place with no facts, so listing one would put a 404 in the sitemap
  // — the single thing the sitemap is written to make impossible. Measured 10.09 the graph
  // holds no such row; /api/resolve writes places and links in two statements, so it can.
  const handler = createDirectoryPlacesHandler({
    env: ENV,
    createReader: () => ({
      loadPlaces: async () => ({ places: [place(A, "London"), place(B, "Marseille")], total: 2 }),
      loadFactPlaceIds: async () => [A],
    }),
  });

  const payload = await (await handler(get("/api/directory/places"))).json();
  assert.deepEqual(payload.places, [{ id: A, name: "London" }]);
});

test("membership is asked about the page in hand, not about the whole view", async () => {
  // The cost of the second read is tied to the page size rather than to the size of the
  // graph, which is what lets this stay two reads as the graph grows.
  let asked = null;
  const handler = createDirectoryPlacesHandler({
    env: ENV,
    perPage: 2,
    createReader: () => ({
      loadPlaces: async () => ({ places: [place(A, "London"), place(B, "Marseille")], total: 9 }),
      loadFactPlaceIds: async (ids) => { asked = ids; return ids; },
    }),
  });

  await handler(get("/api/directory/places?page=2"));
  assert.deepEqual(asked, [A, B]);
});

test("the page walks the whole graph and says when it is done", async () => {
  const offsets = [];
  const handler = createDirectoryPlacesHandler({
    env: ENV,
    perPage: 2,
    createReader: () => ({
      loadPlaces: async ({ offset }) => {
        offsets.push(offset);
        return { places: offset === 0 ? [place(A, "London"), place(B, "Marseille")] : [place(C, "Aix")], total: 3 };
      },
      loadFactPlaceIds: async (ids) => ids,
    }),
  });

  const first = await (await handler(get("/api/directory/places"))).json();
  assert.equal(first.page.hasNext, true);
  const second = await (await handler(get("/api/directory/places?page=2"))).json();
  assert.equal(second.page.hasNext, false);
  assert.deepEqual(offsets, [0, 2]);
  assert.deepEqual(second.places, [{ id: C, name: "Aix" }]);
});

test("a page past the end is empty, and is not re-asked at the first page", async () => {
  // The opposite of the rule /api/directory/city follows, and deliberately: that one
  // protects a reader from a link of ours that looks like lost data. The reader here is a
  // crawler walking pages 1..n, and repeating page 1 would enumerate the same URLs twice.
  const offsets = [];
  const handler = createDirectoryPlacesHandler({
    env: ENV,
    perPage: 2,
    createReader: () => ({
      loadPlaces: async ({ offset }) => { offsets.push(offset); return { places: [], total: 3 }; },
      loadFactPlaceIds: async (ids) => ids,
    }),
  });

  const payload = await (await handler(get("/api/directory/places?page=900"))).json();
  assert.deepEqual(offsets, [(900 - 1) * 2]);
  assert.deepEqual(payload.places, []);
  assert.equal(payload.page.page, 2);
});

test("no rows at all is an empty list, not an error", async () => {
  // A graph we hold nothing in is a real state — it is the state this project started in.
  let asked = true;
  const handler = createDirectoryPlacesHandler({
    env: ENV,
    createReader: () => ({
      loadPlaces: async () => ({ places: [], total: 0 }),
      // No ids means nothing to ask about; the reader must not send an empty `in ()`.
      loadFactPlaceIds: async (ids) => { asked = ids.length > 0; return []; },
    }),
  });

  const response = await handler(get("/api/directory/places"));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.places, []);
  assert.equal(payload.page.total, 0);
  assert.equal(asked, false);
});

test("a failing listing is a 502 that says nothing about the database", async () => {
  const logged = [];
  const handler = createDirectoryPlacesHandler({
    env: ENV,
    createReader: () => ({
      loadPlaces: async () => { throw new Error("connection refused at 10.0.0.4"); },
      loadFactPlaceIds: async () => [],
    }),
    logError: (...args) => logged.push(args),
  });

  const response = await handler(get("/api/directory/places"));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "The directory is unavailable");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(logged.length, 1);
});

test("no configuration is a 503, and the places are cached at the edge", async () => {
  const unconfigured = createDirectoryPlacesHandler({ env: {} });
  const refused = await unconfigured(get("/api/directory/places"));
  assert.equal(refused.status, 503);
  assert.equal(refused.headers.get("Cache-Control"), "private, no-store");

  const handler = createDirectoryPlacesHandler({
    env: ENV,
    createReader: () => ({
      loadPlaces: async () => ({ places: [], total: 0 }),
      loadFactPlaceIds: async () => [],
    }),
  });
  assert.match((await handler(get("/api/directory/places"))).headers.get("Cache-Control"), /max-age=3600/);
});

// ---------- UX-8: posters on the city page ----------

test("a city page carries each work's poster, looked up once for the page", async () => {
  const asked = [];
  const handler = createDirectoryCityHandler({
    env: ENV,
    createReader: () => ({
      loadCity: async () => [row(), row({ work_id: "no-art", title: "Plain" })],
      loadPosters: async (ids) => { asked.push(ids); return [{ id: row().work_id, poster_path: "/abc.jpg" }]; },
    }),
  });
  const payload = await (await handler(get("/api/directory/city?slug=london"))).json();
  assert.deepEqual(asked, [[row().work_id, "no-art"]]);
  assert.match(payload.works[0].poster, /\/abc\.jpg$/);
  assert.equal(payload.works[1].poster, null);
});

test("a failed poster lookup still returns the city's list", async () => {
  const handler = createDirectoryCityHandler({
    env: ENV,
    logError: () => {},
    createReader: () => ({
      loadCity: async () => [row()],
      loadPosters: async () => { throw new Error("down"); },
    }),
  });
  const response = await handler(get("/api/directory/city?slug=london"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.works.length, 1);
  assert.equal(payload.works[0].poster, null);
});
