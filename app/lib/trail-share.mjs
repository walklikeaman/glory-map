// Sharing a story trail (#77): a link that opens the same trail, and a file that carries it
// to other maps.
//
// **The link never carries spoilers.** The trail on the sender's screen may show the whole
// plot, because they ticked "Show the whole story trail"; that choice is theirs and is not
// in the address bar, so the person who opens the link starts at the spoiler-safe default
// and decides for themselves. The link carries only what is not a spoiler: the work (already
// in `?work=`), the map, the filters, and whether the trail is walked in story or walking
// order.

import { TRAIL_ORDER } from "./trail-order.mjs";

export const TRAIL_PARAM = "trail";

// Story order is the default and is not written. Anything unrecognised is the default too.
export function trailOrderFromParams(params) {
  const value = typeof params?.get === "function" ? params.get(TRAIL_PARAM) : null;
  return value === TRAIL_ORDER.walk ? TRAIL_ORDER.walk : TRAIL_ORDER.story;
}

export function trailShareUrl(href, { order = TRAIL_ORDER.story } = {}) {
  const url = new URL(href);
  if (order === TRAIL_ORDER.walk) url.searchParams.set(TRAIL_PARAM, TRAIL_ORDER.walk);
  else url.searchParams.delete(TRAIL_PARAM);
  url.hash = "";
  return url.toString();
}

function finite(value) {
  // Number(null) is 0, which is a real latitude; a missing coordinate must stay missing.
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// The trail as GeoJSON, for Google My Maps, uMap, QGIS or a GPS app. Points in story order,
// numbered, plus the dashed story line as a LineString. Coordinates are [lng, lat], which is
// GeoJSON's order and the opposite of the app's `position`.
//
// It holds what the reader's screen holds: a stop appears here only if it was on their map.
export function trailGeoJson({ title = null, stops = [] } = {}) {
  const ordered = [...(Array.isArray(stops) ? stops : [])]
    .filter((stop) => finite(stop?.position?.[0]) !== null && finite(stop?.position?.[1]) !== null)
    .sort((a, b) => a.sequence_index - b.sequence_index);

  const points = ordered.map((stop, index) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [finite(stop.position[1]), finite(stop.position[0])] },
    properties: {
      order: index + 1,
      scene: finite(stop.sequence_index),
      name: stop.place ?? null,
      description: stop.sentence ?? null,
    },
  }));

  const features = ordered.length >= 2
    ? [...points, {
      type: "Feature",
      geometry: { type: "LineString", coordinates: points.map((point) => point.geometry.coordinates) },
      properties: { name: title ? `${title} · story trail` : "Story trail" },
    }]
    : points;

  return { type: "FeatureCollection", name: title ? `${title} · story trail` : "Story trail", features };
}

export function trailFileName(title) {
  const slug = String(title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "story"}-trail.geojson`;
}
