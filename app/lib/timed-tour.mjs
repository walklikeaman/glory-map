import { WALKING_SPEED_KMH, haversineKm, isFinitePair } from "./geo.mjs";
import { canShow, isRoutable } from "./place-access.mjs";

export const TOUR_BUDGETS = [30, 60, 120];
const TOUR_MIN_STOPS = 3;
const TOUR_MAX_STOPS = 5;
export const TOUR_BUDGET_TOLERANCE = 1.15;

const STREET_DISTANCE_FACTOR = 1.3;
const MAX_SEEDS = 8;

export function distanceKm(from, to) {
  if (!isFinitePair(from) || !isFinitePair(to)) return Number.POSITIVE_INFINITY;
  return haversineKm(from, to);
}

function estimateTourMinutes(stops) {
  if (!Array.isArray(stops) || stops.length < 2) return 0;

  const directDistanceKm = stops.slice(1).reduce(
    (total, stop, index) =>
      total + distanceKm(stops[index].position, stop.position),
    0,
  );

  return Math.max(
    1,
    Math.ceil((directDistanceKm * STREET_DISTANCE_FACTOR * 60) / WALKING_SPEED_KMH),
  );
}

function nearestNeighborOrder(seed, locations) {
  const remaining = locations.filter((location) => location.id !== seed.id);
  const ordered = [seed];

  while (remaining.length > 0) {
    const previous = ordered.at(-1);
    remaining.sort((left, right) => {
      const distanceDelta =
        distanceKm(previous.position, left.position) -
        distanceKm(previous.position, right.position);

      return distanceDelta || left.id.localeCompare(right.id);
    });
    ordered.push(remaining.shift());
  }

  return ordered;
}

function locationKey(location) {
  if (location.locationId) return `location:${location.locationId}`;

  const [latitude, longitude] = location.position;
  return [
    location.place.trim().toLowerCase(),
    latitude.toFixed(4),
    longitude.toFixed(4),
  ].join(":");
}

function combineLocationWorks(locations) {
  const combined = new Map();

  for (const location of locations) {
    const key = locationKey(location);
    const current = combined.get(key);

    if (!current) {
      combined.set(key, {
        ...location,
        filmIds: location.filmId ? [location.filmId] : [],
        films: location.film ? [location.film] : [],
      });
      continue;
    }

    const filmIds = [...new Set([
      ...current.filmIds,
      ...(location.filmId ? [location.filmId] : []),
    ])];
    const films = [...new Set([
      ...current.films,
      ...(location.film ? [location.film] : []),
    ])];
    const visibleFilms = films.slice(0, 3);
    const filmLabel = [
      visibleFilms.join(", "),
      films.length > visibleFilms.length
        ? `and ${films.length - visibleFilms.length} more`
        : null,
    ].filter(Boolean).join(" ");

    combined.set(key, {
      ...current,
      film: filmLabel,
      filmIds,
      films,
      description: `Verified screen or story location connected to ${filmLabel}.`,
    });
  }

  return [...combined.values()];
}

// A route is a different promise from a pin.
//
// Showing a place says "this is connected to the work" — true whether or not the gate
// is open. A generated route says "go here, in this order, and it will be worth it",
// which is a claim about the world on a particular day. Midhope Castle is the case the
// whole axis exists for: building-precision, passes every other rule, and it is a
// ticketed gate on a private estate with 13+ closure days a year that the coach
// operator reroutes around on the morning.
//
// So access enters the tour in two ways, and the split is deliberate:
//
//   * A place OSM says is closed is not routed to at all. That is not a preference.
//   * Confirmed access WINS over unknown access when tours are ranked, rather than
//     unknown being excluded outright — because measured against twelve real tour stops
//     OSM knows about four, and all four are in cities. Refusing every unknown would
//     produce no Scottish tour at all, which is not a safer map, only an empty one.
//
// What must never happen is the third option: routing to an unknown and letting the
// wording imply it is open. The caller carries `accessNote` to every stop it shows.
function accessOf(access, location) {
  if (!access) return null;
  const key = location?.locationId ?? location?.id;
  return (access instanceof Map ? access.get(key) : access?.[key]) ?? null;
}

export function confirmedStopCount(stops, access) {
  if (!access) return 0;
  return stops.filter((stop) => {
    const record = accessOf(access, stop);
    return record ? isRoutable(record) : false;
  }).length;
}

export function createTimedTourCandidates(locations, origin, budgetMinutes, { access = null } = {}) {
  if (!TOUR_BUDGETS.includes(budgetMinutes)) {
    throw new Error("Tour budget must be 30, 60, or 120 minutes");
  }

  const uniqueLocations = combineLocationWorks([...new Map(
    (Array.isArray(locations) ? locations : [])
      .filter((location) => location?.id && isFinitePair(location.position))
      // Known closed is the one verdict that removes a stop. `canShow` is the same rule
      // the map uses for the pin, and a closed place fails both: there is nothing to
      // walk to.
      .filter((location) => {
        const record = accessOf(access, location);
        return record ? canShow(record) : true;
      })
      .map((location) => [location.id, location]),
  ).values()]);

  if (uniqueLocations.length < TOUR_MIN_STOPS) return [];

  const effectiveOrigin = isFinitePair(origin) ? origin : uniqueLocations[0].position;
  const nearbySeeds = [...uniqueLocations]
    .sort((left, right) => {
      const distanceDelta =
        distanceKm(effectiveOrigin, left.position) -
        distanceKm(effectiveOrigin, right.position);

      return distanceDelta || left.id.localeCompare(right.id);
    })
    .slice(0, MAX_SEEDS);
  const candidates = new Map();

  for (const seed of nearbySeeds) {
    const ordered = nearestNeighborOrder(seed, uniqueLocations);
    const maximumStops = Math.min(TOUR_MAX_STOPS, ordered.length);

    for (let stopCount = TOUR_MIN_STOPS; stopCount <= maximumStops; stopCount += 1) {
      const stops = ordered.slice(0, stopCount);
      const key = stops.map((stop) => stop.id).join("|");

      if (!candidates.has(key)) {
        candidates.set(key, {
          stops,
          estimatedMinutes: estimateTourMinutes(stops),
          startDistanceKm: distanceKm(effectiveOrigin, stops[0].position),
          confirmedStops: confirmedStopCount(stops, access),
        });
      }
    }
  }

  const limit = budgetMinutes * TOUR_BUDGET_TOLERANCE;

  return [...candidates.values()]
    .filter((candidate) => candidate.estimatedMinutes <= limit)
    .sort((left, right) =>
      right.stops.length - left.stops.length ||
      // Among tours of the same length, the one whose stops we can vouch for wins. This
      // sits above distance on purpose: a walk that is 200 m longer and gets you in is
      // a better walk than a short one to a locked gate.
      right.confirmedStops - left.confirmedStops ||
      left.startDistanceKm - right.startDistanceKm ||
      right.estimatedMinutes - left.estimatedMinutes ||
      left.stops.map((stop) => stop.id).join("|").localeCompare(
        right.stops.map((stop) => stop.id).join("|"),
      ),
    );
}

export function routeFitsBudget(route, budgetMinutes) {
  return (
    Number.isFinite(route?.durationMinutes) &&
    route.durationMinutes <= budgetMinutes * TOUR_BUDGET_TOLERANCE
  );
}

export function createFallbackGuide({ city, budgetMinutes, stops }) {
  return {
    title: `${budgetMinutes}-minute GloryMap walk · ${city}`,
    intro: `A nearby ${stops.length}-stop route built from verified screen and story locations.`,
    stops: stops.map((location) => ({
      locationId: location.id,
      narration: location.description,
    })),
  };
}

// The two halves of building a timed tour, out of the 124-line function in SceneMapApp
// that did them inline (#82). Both take what they call, so both are tested without a
// router or a model.

// Which candidate to walk: longest first, at most four tries per length, the first whose
// routed walk fits the budget. A router that fails falls back to straight lines for the
// best candidate, and is still held to the budget. Null when nothing fits.
export async function pickRouteThatFitsBudget(candidates, budgetMinutes, { requestRoute, fallbackRoute }) {
  try {
    const tries = [5, 4, 3].flatMap((stopCount) =>
      candidates.filter((candidate) => candidate.stops.length === stopCount).slice(0, 4));
    for (const candidate of tries) {
      const route = await requestRoute(candidate.stops);
      if (routeFitsBudget(route, budgetMinutes)) return { plan: candidate, route, usedRouteFallback: false };
    }
    return null;
  } catch {
    const plan = candidates[0];
    const route = fallbackRoute(plan.stops);
    return routeFitsBudget(route, budgetMinutes) ? { plan, route, usedRouteFallback: true } : null;
  }
}

// The written guide for the chosen stops. The model must return every stop, in the given
// order; anything else — a refusal, a reordering, a dropped stop — is the scripted guide.
//
// A guide asked for in another language that fails is asked for once more in English
// before falling back to the scripted one (#67): English is what our data is written in,
// so it is the request most likely to succeed.
async function requestGuide(stops, { city, budgetMinutes, language, fetchImpl }) {
  const response = await fetchImpl("/api/tour", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      city,
      durationMinutes: budgetMinutes,
      preserveOrder: true,
      ...(language && language !== "en" ? { language } : {}),
      locations: stops.map(({ id, place, scene, description, film }) => ({ id, place, scene, description, film })),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const expectedIds = stops.map((stop) => stop.id);
  const returnedIds = payload?.stops?.map((stop) => stop.locationId);
  if (!response.ok || !Array.isArray(returnedIds) || returnedIds.some((id, index) => id !== expectedIds[index])) {
    throw new Error(payload.error || "The AI guide returned an invalid route.");
  }
  return { ...payload, language: payload.language ?? language ?? "en" };
}

export async function fetchTimedTourGuide(stops, { city, budgetMinutes, language = "en", fetchImpl = fetch }) {
  const options = { city, budgetMinutes, fetchImpl };
  try {
    const guide = await requestGuide(stops, { ...options, language });
    return { guide, usedAiFallback: false, usedLanguageFallback: false };
  } catch {
    if (language !== "en") {
      try {
        const guide = await requestGuide(stops, { ...options, language: "en" });
        return { guide, usedAiFallback: false, usedLanguageFallback: true };
      } catch { /* the scripted guide below */ }
    }
    return {
      guide: { ...createFallbackGuide({ city, budgetMinutes, stops }), language: "en" },
      usedAiFallback: true,
      usedLanguageFallback: language !== "en",
    };
  }
}
