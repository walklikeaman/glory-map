import { assertPosition, haversineMeters } from "./geo.mjs";

export const RADIUS_OPTIONS_METERS = [100, 300, 1000, 3000];

// Deterministic fallback for demos and denied-permission flows: Trafalgar
// Square sits inside the seeded London dataset, so the nearest-point card is
// always populated.
export const DEMO_LOCATION = {
  label: "Trafalgar Square (demo)",
  position: [51.508, -0.1281],
};

export function distanceMeters(from, to) {
  assertPosition(from, "from");
  assertPosition(to, "to");
  return haversineMeters(from, to);
}

export function findNearby(userPosition, locations, radiusMeters) {
  assertPosition(userPosition, "userPosition");

  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    throw new Error("radiusMeters must be a positive number");
  }

  const measured = (Array.isArray(locations) ? locations : [])
    .filter((location) => Array.isArray(location?.position))
    .map((location) => ({
      location,
      distanceMeters: distanceMeters(userPosition, location.position),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  return {
    nearest: measured[0] ?? null,
    inRadius: measured.filter((entry) => entry.distanceMeters <= radiusMeters),
  };
}

export function formatDistanceMeters(meters) {
  if (!Number.isFinite(meters) || meters < 0) {
    throw new Error("meters must be a non-negative number");
  }

  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(Math.round(meters / 100) / 10).toFixed(1)} km`;
}

// How far a single search may reach. A country, not a city: the product is a route
// through a region — Rowling's Edinburgh, the Antrim coast — and a viewport showing
// Britain must be able to ask about Britain. Beyond this the answer stops being a
// walkable set of stops and becomes a world map, which is a different product.
export const MAX_SEARCH_RADIUS_KM = 500;

export function mapSearchRadiusKm(distanceToCornerMeters) {
  if (!Number.isFinite(distanceToCornerMeters) || distanceToCornerMeters <= 0) {
    throw new Error("distanceToCornerMeters must be a positive number");
  }

  const radiusKm = Math.ceil(distanceToCornerMeters / 100) / 10;
  // The ceiling was 50km — a city. It made zooming out pointless: the view widened to
  // a country while the search kept asking about the same 50km, so Scotland's places
  // stayed invisible from a Britain-wide view. MAX_SEARCH_RADIUS_KM covers a country.
  return Math.min(MAX_SEARCH_RADIUS_KM, Math.max(0.5, radiusKm));
}

export function zoomForRadius(radiusMeters) {
  if (radiusMeters <= 100) return 17;
  if (radiusMeters <= 300) return 16;
  if (radiusMeters <= 1000) return 14;

  return 13;
}

// How many browsed places the map keeps at once. Each move asks /api/locations for 30, so
// this is roughly the last ten views.
export const BROWSE_KEEP = 300;

// What the map holds after a browse answer arrives: the new places first, then the ones
// already on the map, deduped by id. The browse used to REPLACE the set on every move, so
// zooming in or out made the yellow dots and the city rings vanish and come back (reported
// on the iPhone, 2026-11-07). Places the reader has already seen stay put; the cap keeps a
// long pan from growing without end.
export function mergeBrowsed(previous, next, keep = BROWSE_KEEP) {
  const merged = new Map();
  for (const location of [...(next ?? []), ...(previous ?? [])]) {
    if (location?.id != null && !merged.has(location.id)) merged.set(location.id, location);
  }
  return [...merged.values()].slice(0, keep);
}
