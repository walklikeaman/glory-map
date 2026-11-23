// The walk is the moment with the worst signal (#161).
//
// The deliverable is a route somebody walks: outdoors, on a phone, between streets. Every
// surface this product has assumes a live network — the tiles, `/api/map/points`, the
// walking route, the cards. Lose signal on a pavement in Whitechapel and the map goes grey
// under your thumb.
//
// This worker does the cheap half of the fix: what has already been fetched keeps working.
// It does not pre-download a city, and it does not pretend to. A tile nobody has looked at
// is not in here.
//
// ---------------------------------------------------------------------------------------
//
// **What is cached, and why each one is safe to keep.**
//
//   the app shell      network-first, so a deploy is picked up; the cached page is the
//                      fallback, because a grey screen is worse than a page one version old
//   /_next/static/*    cache-first — Next puts a content hash in the filename, so a given
//                      URL never changes meaning
//   map tiles          cache-first with a cap: the same square kilometre is re-fetched
//                      every time the map moves back over it, and on a walk that is the
//                      same twenty tiles all afternoon
//   GET /api/*         network-first, cached answer as the fallback. The map's own points
//                      and the place cards, which is what a tapped pin needs
//
// **What is never cached, and the rule is the point:** anything carrying an `Authorization`
// header. That is the owner's library token; a copy of that answer in a cache on a shared
// phone is a copy of his film list. POSTs are not cached either — `/api/trip/plan` takes a
// body, and a cache keyed on the URL would answer one plan with another's.

const VERSION = "v1";
const SHELL = `glorymap-shell-${VERSION}`;
const STATIC = `glorymap-static-${VERSION}`;
const TILES = `glorymap-tiles-${VERSION}`;
const API = `glorymap-api-${VERSION}`;
// A kept walk's tiles (#70), written by the page (app/lib/keep-the-walk.mjs WALK_CACHE) and
// never trimmed here: the capped tile cache below used to evict them during an afternoon
// of panning before the walk began.
const WALK = "glorymap-walk-v1";

// Roughly a walking afternoon: MapLibre holds ~40 tiles for one screen, and a route walked
// across a city at z14–16 touches a few hundred. Beyond that the oldest go, because a cache
// that grows without limit is evicted by the browser wholesale at the worst moment.
const TILE_LIMIT = 500;
const API_LIMIT = 200;

const TILE_HOSTS = new Set(["api.maptiler.com", "tiles.openfreemap.org"]);

self.addEventListener("install", (event) => {
  // The shell, so the first offline load has something to open. One page: the map is the
  // whole product.
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.add(new Request("/", { cache: "reload" })).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, STATIC, TILES, API, WALK]);
    for (const name of await caches.keys()) {
      if (name.startsWith("glorymap-") && !keep.has(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// Oldest-first, which for a cache written in fetch order is close enough to least-recently
// used and costs no bookkeeping.
async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) {
    await cache.delete(key);
  }
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // Only a real answer. A 404 or a 500 cached is a 404 or a 500 for the rest of the walk.
  if (response.ok) {
    await cache.put(request, response.clone());
    if (limit) trim(cacheName, limit);
  }
  return response;
}

async function networkFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      if (limit) trim(cacheName, limit);
    }
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // The owner's library travels under this header. Nothing carrying it is written down.
  if (request.headers.has("authorization")) return;

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (error) {
        const cache = await caches.open(SHELL);
        return (await cache.match("/")) ?? Response.error();
      }
    })());
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC));
    return;
  }

  if (TILE_HOSTS.has(url.hostname)) {
    event.respondWith((async () => {
      const kept = await caches.match(request, { cacheName: WALK });
      return kept ?? cacheFirst(request, TILES, TILE_LIMIT);
    })());
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    // `/api/library` answers about one person even without the header reaching us here.
    if (url.pathname.startsWith("/api/library")) return;
    event.respondWith(networkFirst(request, API, API_LIMIT));
  }
});
