// Fetching the corridor, once, so the cache has it before the walk does (#161).
//
// The arithmetic is in tile-corridor.mjs. This is the part that talks to the map and the
// network: where the tile URLs come from, and what to do with a source that will not say.
//
// **The URLs are asked of the style, not guessed.** MapLibre resolves a TileJSON `url` into
// a `tiles` array once the source loads, so the template we fetch is the template the map
// itself is drawing from — including its key. A hard-coded MapTiler URL would keep the
// wrong tiles the day the basemap changes, and keep nothing at all on OpenFreeMap.

import { corridorTiles, tileUrl } from "./tile-corridor.mjs";

// Every raster or vector source the style is drawing from, as URL templates.
export function tileTemplates(map) {
  const style = typeof map?.getStyle === "function" ? map.getStyle() : null;
  const sources = style?.sources ?? {};
  const templates = [];

  for (const id of Object.keys(sources)) {
    const declared = sources[id];
    if (declared?.type !== "vector" && declared?.type !== "raster") continue;

    // The loaded source knows more than the style declaration: a TileJSON `url` has become
    // a `tiles` array by the time the map has drawn anything.
    const loaded = typeof map.getSource === "function" ? map.getSource(id) : null;
    const tiles = loaded?.tiles ?? declared?.tiles;
    if (!Array.isArray(tiles)) continue;

    for (const template of tiles) {
      if (typeof template === "string" && template.includes("{z}")) templates.push(template);
    }
  }

  return [...new Set(templates)];
}

// Fetch politely: four at a time, and never let one failure stop the rest. A tile that does
// not arrive is a tile the walk will ask for again on the day — which is exactly what
// happened before this existed, so a failure here costs nothing that was not already lost.
//
// With a `cache`, each tile is written into it and its bytes counted (#70): the walk's own
// copy, which the service worker's capped tile cache can no longer evict, and a real size
// for the card instead of an estimate.
async function fetchAll(urls, { fetchImpl = fetch, concurrency = 4, cache = null } = {}) {
  let kept = 0;
  let failed = 0;
  let bytes = 0;

  for (let index = 0; index < urls.length; index += concurrency) {
    const batch = urls.slice(index, index + concurrency);
    const results = await Promise.all(batch.map(async (url) => {
      try {
        const response = await fetchImpl(url, { mode: "cors", credentials: "omit" });
        if (!response.ok) return { ok: false, size: 0 };
        if (!cache) return { ok: true, size: 0 };
        const body = await response.clone().arrayBuffer();
        await cache.put(url, response);
        return { ok: true, size: body.byteLength };
      } catch {
        return { ok: false, size: 0 };
      }
    }));
    for (const { ok, size } of results) {
      if (ok) { kept += 1; bytes += size; } else failed += 1;
    }
  }

  return { kept, failed, bytes };
}

// Keep the tiles along one route. Returns what happened, in numbers the UI can say out loud
// — a prefetch that reports nothing is indistinguishable from one that did nothing.
export async function keepTheWalk(map, positions, { fetchImpl, cache = null, ...options } = {}) {
  const templates = tileTemplates(map);
  if (templates.length === 0) return { kept: 0, failed: 0, tiles: 0, truncated: false, reason: "no_tile_source" };

  const { tiles, truncated, wanted } = corridorTiles(positions, options);
  if (tiles.length === 0) return { kept: 0, failed: 0, tiles: 0, truncated: false, reason: "no_route" };

  const urls = [];
  for (const tile of tiles) {
    for (const template of templates) {
      const url = tileUrl(template, tile);
      if (url) urls.push(url);
    }
  }

  const { kept, failed, bytes } = await fetchAll(urls, { fetchImpl, cache });
  return { kept, failed, bytes, tiles: tiles.length, wanted, truncated, reason: null };
}

// ---------- the walk's own copy (#70) ----------
//
// One walk at a time, in its own cache. The service worker's tile cache is capped at 500
// and trims oldest-first, so a kept walk used to be evicted by an afternoon of panning
// around the map before the walk began. This cache is never trimmed; it is replaced when a
// new walk is kept and emptied when the reader says so. The name is repeated in
// public/sw.js, which reads it first for tiles; a test holds the two together.
export const WALK_CACHE = "glorymap-walk-v1";
export const WALK_META_KEY = "glorymap.walk-offline";

// A fresh, empty cache for a new walk: the old walk's tiles go first, or two walks would
// share the space and neither card could say how much it holds.
export async function openWalkCache(cacheStorage) {
  if (!cacheStorage?.open) return null;
  await cacheStorage.delete(WALK_CACHE);
  return cacheStorage.open(WALK_CACHE);
}

export async function forgetTheWalk(cacheStorage, storage) {
  try { storage?.removeItem(WALK_META_KEY); } catch { /* private mode */ }
  return cacheStorage?.delete ? cacheStorage.delete(WALK_CACHE) : false;
}

// What the card says about a kept walk, read back after a reload. Only when the cache is
// still there: a browser that cleared it under storage pressure must not be described as
// holding a walk it no longer has.
export async function keptWalkSummary(cacheStorage, storage) {
  let meta = null;
  try { meta = JSON.parse(storage?.getItem(WALK_META_KEY) ?? "null"); } catch { meta = null; }
  if (!meta || !Number.isFinite(meta.kept)) return null;
  if (!cacheStorage?.has || !(await cacheStorage.has(WALK_CACHE))) return null;
  return { ...meta, reason: null };
}

// The previous walk's cache is already gone by the time this runs (openWalkCache), so a
// keep that stored nothing must drop the old summary too, or a reload would describe the
// old walk over an empty cache.
export function rememberKeptWalk(storage, result) {
  try {
    if (!result || result.reason !== null || !(result.kept > 0)) {
      storage?.removeItem(WALK_META_KEY);
      return;
    }
    const { kept, failed, bytes, truncated, clips = 0 } = result;
    storage?.setItem(WALK_META_KEY, JSON.stringify({ kept, failed, bytes, truncated, clips }));
  } catch { /* private mode: the card just won't remember it */ }
}

export function bytesLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The walk's spoken stops, kept beside its tiles (#70 rest). What the trail says on
// arrival is known before the walk starts (`trailStopText`), so its audio can be fetched
// while there is a signal and played from the phone where there is none.
//
// /api/narration is a POST, which the Cache API cannot key on, so each clip is stored
// under a made-up GET address of its own text. Nothing ever requests that address over
// the network; the player looks it up in the walk's cache before asking the server.
export const WALK_AUDIO_LIMIT = 12;
export const WALK_AUDIO_PROFILE = "neutral";

export function walkAudioUrl(text, profileId = WALK_AUDIO_PROFILE) {
  const spoken = typeof text === "string" ? text.trim() : "";
  if (!spoken) return null;
  return `/walk-audio/${encodeURIComponent(profileId)}?t=${encodeURIComponent(spoken)}`;
}

// One request per stop, in turn: a dozen short clips, and the server caches each by text,
// so a walk kept twice costs nothing the second time. A stop that fails is counted and
// left to the network on the day, exactly as before.
export async function keepWalkAudio(texts, {
  cache, fetchImpl = fetch, profileId = WALK_AUDIO_PROFILE, limit = WALK_AUDIO_LIMIT,
} = {}) {
  const unique = [...new Set((Array.isArray(texts) ? texts : [])
    .map((text) => (typeof text === "string" ? text.trim() : ""))
    .filter(Boolean))];
  const result = { clips: 0, clipsFailed: 0, audioBytes: 0, clipsTruncated: unique.length > limit };
  if (!cache?.put) return result;
  for (const text of unique.slice(0, limit)) {
    try {
      const response = await fetchImpl("/api/narration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, profileId }),
      });
      if (!response.ok) throw new Error(`narration ${response.status}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error("empty clip");
      await cache.put(walkAudioUrl(text, profileId), new Response(blob, { headers: { "Content-Type": "audio/mpeg" } }));
      result.clips += 1;
      result.audioBytes += blob.size;
    } catch {
      result.clipsFailed += 1;
    }
  }
  return result;
}

// A kept clip for this text, or null. Never throws: a missing cache is just a miss.
export async function keptWalkClip(cacheStorage, text, profileId = WALK_AUDIO_PROFILE) {
  const url = walkAudioUrl(text, profileId);
  if (!url || !cacheStorage?.match) return null;
  try {
    const hit = await cacheStorage.match(url, { cacheName: WALK_CACHE });
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}
