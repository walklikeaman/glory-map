// "What is interesting around here" — the first thing the app says on a first run, and
// what the map's "What's here?" button asks again later (Nikita, 2026-11-07: "оказались
// мы в Палермо, и здесь снимали «Крестного отца»").
//
// It is NOT the panel's "Known for", which ranks what is in the current VIEW. A first run
// opens at street zoom on the reader, where the view is a kilometre wide and usually holds
// nothing famous; the question is about the town and its surroundings. So it asks the map
// for a box around a point instead, and widens once when the box is thin.
//
// The best-known works come first (the same rating × reach score as [[notable-here]]); an
// unrated work still fills a short list, because "two films were shot here" beats an empty
// card. Each work is shown at its place nearest to the reader, with the distance.

import { filmsInView } from "./films-in-view.mjs";
import { haversineKm } from "./geo.mjs";
import { notableHere } from "./notable-here.mjs";

export const AROUND_KM = 20;
export const WIDER_KM = 60;
// Below this many works the first box is thin and the wider one is asked for.
export const ENOUGH_WORKS = 3;

// A square around a point, in the shape /api/map/points reads.
export function aroundBox([lat, lng], km) {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
  return {
    west: clamp(lng - dLng, 180),
    east: clamp(lng + dLng, 180),
    south: clamp(lat - dLat, 90),
    north: clamp(lat + dLat, 90),
  };
}

export function distanceLabel(km) {
  if (!Number.isFinite(km)) return "";
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

// The works worth naming around `center`, each with its nearest place and the map feature
// that place came from, so a tap can open the same card a pin opens.
export function aroundHere(features, center, { limit = 5 } = {}) {
  const list = Array.isArray(features) ? features.filter((feature) => !feature?.properties?.cluster) : [];
  const byCoordinate = new Map();
  for (const feature of list) {
    const [lng, lat] = feature?.geometry?.coordinates ?? [];
    if (Number.isFinite(lat) && Number.isFinite(lng)) byCoordinate.set(`${lat},${lng}`, feature);
  }

  const films = filmsInView(list);
  const ranked = notableHere(films, { limit });
  const rest = films.filter((film) => !ranked.includes(film));
  const chosen = [...ranked, ...rest].slice(0, Math.max(0, limit));

  return chosen.map((film) => {
    let nearest = null;
    for (const place of film.places) {
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue;
      const km = haversineKm(center, [place.lat, place.lng]);
      if (!nearest || km < nearest.km) nearest = { ...place, km };
    }
    return {
      film,
      place: nearest,
      feature: nearest ? byCoordinate.get(`${nearest.lat},${nearest.lng}`) ?? null : null,
    };
  });
}
