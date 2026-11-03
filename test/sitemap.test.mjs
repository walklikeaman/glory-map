// The sitemap's one promise: a URL it prints is a URL the app serves (#158, and #129 step 4
// for the places). Every entry is built by the same function the page parses, so the tests
// here are about which pages are enumerated and where they land — never about spelling.
//
// The catalogue half is not reachable without a database, so these run with no Supabase
// configured: the film route answers 503, the loop stops, and what is left is exactly the
// fixed pages plus whatever places are handed in.

import assert from "node:assert/strict";
import test from "node:test";

import robots from "../app/robots.js";
import sitemap, { generateSitemaps, placesInTheGraph, worksForLetter } from "../app/sitemap.js";
import { GET as sitemapIndex } from "../app/sitemap.xml/route.js";
import { ALL_CITIES, cityPath } from "../app/lib/city-gazetteer.mjs";
import { DIRECTORY_LETTERS } from "../app/lib/directory.mjs";
import { placePath } from "../app/lib/place-url.mjs";
import { SITE_URL } from "../app/lib/site-url.mjs";

// Pinned rather than assumed. A shell with the team's .env exported would otherwise send
// the film loop at the real database, and a test suite that reaches the network is a test
// suite that passes or fails on the wifi.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const A = "40d442dd-257e-424b-8043-50677eb30ca6";
const B = "75f7b94d-feb7-429f-bcd9-3f1d02a589e5";

const noPlaces = async () => [];
const urls = (entries) => entries.map((entry) => entry.url);

// A route that hands back one page of places per call, in the shape the real one returns.
const routeReturning = (pages) => async (request) => {
  const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
  const places = pages[page - 1] ?? [];
  return Response.json({ places, page: { page, hasNext: page < pages.length } });
};

test("the split is one file per letter, and '#' travels as a slug", () => {
  const ids = generateSitemaps().map((entry) => entry.id);
  assert.equal(ids.length, DIRECTORY_LETTERS.length);
  assert.ok(ids.includes("other"));
  assert.ok(!ids.includes("#"));
});

test("an id nobody generated is refused, not answered with an empty file", async () => {
  // Next validates nothing before calling the sitemap — /sitemap/zzz.xml answered 200 with
  // an empty <urlset> on production 10.09, and so did qqq and 1. An empty <urlset> is not
  // "no such file", it is the claim that nothing is filed under that letter.
  for (const id of ["zzz", "index", "1", "", "#"]) {
    await assert.rejects(
      () => sitemap({ id }, { loadPlaces: noPlaces }),
      (error) => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404",
      `/sitemap/${id}.xml was answered instead of refused`,
    );
  }
});

test("every id generateSitemaps names is served", async () => {
  // The other direction of the same pin, and the one that matters more: a guard that
  // disagreed with the list would 404 all 27 files at once, which is a sitemap that has
  // stopped existing while still building cleanly.
  for (const { id } of generateSitemaps()) {
    const entries = await sitemap({ id }, { loadPlaces: noPlaces });
    assert.ok(Array.isArray(entries), `/sitemap/${id}.xml was refused`);
  }
});

test("the fixed pages ride on the first file and nowhere else", async () => {
  const first = urls(await sitemap({ id: "a" }, { loadPlaces: noPlaces }));
  const second = urls(await sitemap({ id: "b" }, { loadPlaces: noPlaces }));

  // 84 of them, measured 10.09: the map, the directory, 27 letters and 55 cities.
  assert.equal(first.length, 2 + DIRECTORY_LETTERS.length + ALL_CITIES.length);
  assert.ok(first.some((url) => url.endsWith("/directory")));
  assert.ok(first.some((url) => url.endsWith(cityPath(ALL_CITIES[0]))));
  assert.deepEqual(second, []);
});

test("a place is addressed by placePath, absolutely, on the first file", async () => {
  const places = [{ id: A, name: "Trafalgar Square" }, { id: B, name: "Marseille" }];
  const first = urls(await sitemap({ id: "a" }, { loadPlaces: async () => places }));
  const second = urls(await sitemap({ id: "b" }, { loadPlaces: async () => places }));

  for (const place of places) {
    const url = first.find((candidate) => candidate.endsWith(placePath(place)));
    assert.ok(url, `no entry for ${place.name}`);
    // A relative URL in a sitemap is ignored by every crawler that reads it.
    assert.ok(new URL(url).protocol.startsWith("http"));
  }
  assert.deepEqual(second, []);
});

test("a place placePath cannot address is dropped rather than printed half-formed", async () => {
  // `/place/<not a uuid>` is a 404 by the page's own rule, so the URL must not exist. The
  // readable half is decorative: a place with no name keeps its address, unnamed.
  const entries = await sitemap(
    { id: "a" },
    { loadPlaces: async () => [{ id: "queue-row-17", name: "A candidate" }, { id: B, name: null }] },
  );
  const places = urls(entries).filter((url) => url.includes("/place/"));
  assert.deepEqual(places.map((url) => new URL(url).pathname), [`/place/${B}`]);
});

test("a place page is weighted like a work page, and expires like one", async () => {
  const entry = (await sitemap({ id: "a" }, { loadPlaces: async () => [{ id: A, name: "London" }] }))
    .find((candidate) => candidate.url.includes("/place/"));
  assert.equal(entry.priority, 0.6);
  assert.equal(entry.changeFrequency, "monthly");
});

test("the walk takes as many pages as the listing has", async () => {
  const places = await placesInTheGraph(routeReturning([
    [{ id: A, name: "London" }],
    [{ id: B, name: "Marseille" }],
  ]));
  assert.deepEqual(places.map((place) => place.name), ["London", "Marseille"]);
});

test("a listing that fails costs the places, never the deploy", async () => {
  // A sitemap that throws is a build that fails, and the fixed pages are still worth
  // serving. Both halves of that: the walk stops on a bad status, and a walk that throws
  // outright is caught by the file that asked for it.
  const stopped = await placesInTheGraph(async () => Response.json({ error: "no" }, { status: 502 }));
  assert.deepEqual(stopped, []);

  const entries = await sitemap({ id: "a" }, { loadPlaces: async () => { throw new Error("down"); } });
  assert.equal(entries.length, 2 + DIRECTORY_LETTERS.length + ALL_CITIES.length);
});

// ---------- the way in ----------
//
// A sitemap nothing points at is a sitemap nothing reads. Measured on production 10.09,
// before robots.txt and the index existed: /sitemap/a.xml answered 200 with 498 URLs while
// /robots.txt and /sitemap.xml both answered 404, so all 27 files were unreachable from the
// root. These tests are about the chain robots → index → files staying joined.

const indexLocs = async () => {
  const body = await (await sitemapIndex()).text();
  return [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
};

test("robots points at the index, and the index is the file the app serves", async () => {
  // The whole chain is one link long and this is the link. A robots.txt naming a path Next
  // does not serve is the 404 version of naming nothing at all.
  const { sitemap: pointer } = robots();
  assert.equal(pointer, `${SITE_URL}/sitemap.xml`);
  assert.equal(new URL(pointer).pathname, "/sitemap.xml");
});

test("robots disallows nothing, deliberately", async () => {
  // `Disallow: /api/` is the obvious line and it would cost the home page: Google's
  // renderer obeys robots.txt for a page's own requests, and the map fetches
  // /api/catalogue after it mounts. Written down as a test so it is not "fixed" later.
  const { rules } = robots();
  assert.deepEqual(rules, [{ userAgent: "*", allow: "/" }]);
});

test("the index names every file generateSitemaps makes, and nothing else", async () => {
  // Two lists of 27 that are written twice are two lists that disagree the day a letter is
  // added: a file the index skips is crawled by nobody, a file it invents is a 404 handed
  // to a crawler. Same list, one source.
  const ids = generateSitemaps().map((entry) => entry.id);
  const locs = await indexLocs();
  assert.deepEqual(
    locs.map((loc) => new URL(loc).pathname),
    ids.map((id) => `/sitemap/${id}.xml`),
  );
  assert.equal(locs.length, DIRECTORY_LETTERS.length);
});

test("the index carries absolute URLs and says it is an index", async () => {
  // A relative <loc> is ignored by every crawler that reads one, and a <urlset> where a
  // <sitemapindex> belongs is read as a sitemap holding 27 pages that do not exist.
  const response = await sitemapIndex();
  const body = await response.text();
  assert.equal(response.headers.get("Content-Type"), "application/xml");
  assert.match(body, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<sitemapindex /);
  assert.match(body, /<\/sitemapindex>\n$/);
  for (const loc of await indexLocs()) assert.ok(new URL(loc).protocol.startsWith("http"));
});

test("the index names the other bucket as a slug, never as '#'", async () => {
  const locs = await indexLocs();
  assert.ok(locs.some((loc) => loc.endsWith("/sitemap/other.xml")));
  assert.ok(!locs.some((loc) => loc.includes("#")));
});

// A route that answers 502 for the first `failures` asks, then one page of works.
const flakyFilms = (failures) => {
  let calls = 0;
  const route = async () => {
    calls += 1;
    if (calls <= failures) return Response.json({ error: "The directory is unavailable" }, { status: 502 });
    return Response.json({ works: [{ id: A, title: "Notting Hill", year: 1999 }], page: { page: 1, hasNext: false } });
  };
  return { route, calls: () => calls };
};
const noWait = async () => {};

test("a letter the database times out on is asked again, not shipped empty", async () => {
  // 03.11: 10 of 27 letters came out of the build as empty files because the prerender burst
  // hit the statement timeout. A second ask answers.
  const films = flakyFilms(2);
  const works = await worksForLetter("n", { route: films.route, wait: noWait });
  assert.equal(works.length, 1);
  assert.equal(films.calls(), 3);
});

test("the retries are bounded, and a database that stays down gives up", async () => {
  const films = flakyFilms(Infinity);
  const works = await worksForLetter("n", { route: films.route, wait: noWait });
  assert.deepEqual(works, []);
  assert.equal(films.calls(), 3);
});

test("a directory with no database is not retried", async () => {
  let calls = 0;
  const route = async () => {
    calls += 1;
    return Response.json({ error: "The directory is not configured" }, { status: 503 });
  };
  assert.deepEqual(await worksForLetter("n", { route, wait: noWait }), []);
  assert.equal(calls, 1);
});
