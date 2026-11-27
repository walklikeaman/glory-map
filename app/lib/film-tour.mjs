// A film tour you build yourself: where you start, how long you have, how you move.
//
// The walking tour (`timed-tour.mjs`) answers "an hour on foot around here". The tours
// people actually pay for are shaped differently: a coach day from Belfast to the Causeway
// Coast, a walk round Dubrovnik with a boat to Lokrum, twelve hours from Edinburgh to
// Glenfinnan. Those mix walking and driving, sometimes a ferry, and run for hours.
//
// **No number in a tour is a guess.** Nikita's complaint, 2026-11-27: model-estimated
// distances keep coming out wrong. So the model is nowhere in this file. Straight-line
// distance is haversine on our stored coordinates; travel time is what the OpenStreetMap
// router answers for that leg; and when the router cannot be reached, the leg is labelled
// `estimate` with the formula that produced it, never presented as measured.
//
// Everything here is pure: the route handler does the fetching and passes answers in.

import { WALKING_SPEED_KMH, haversineKm, isFinitePair } from "./geo.mjs";

export const TOUR_MODES = Object.freeze(["walk", "car"]);

// Budgets offered in the planner, in minutes. Any value in [MIN, MAX] is accepted by the
// planner itself; these are just the buttons.
export const FILM_TOUR_BUDGETS = Object.freeze([120, 240, 480, 720]);
export const FILM_TOUR_MIN_MINUTES = 30;
export const FILM_TOUR_MAX_MINUTES = 900;

export const DEFAULT_DWELL_MINUTES = 20;
export const MAX_TOUR_STOPS = 12;
export const POOL_SIZE = 40;
// How many of the most valuable stops each seed a day of their own (see planTourOrder).
export const SEEDS = 5;

// With a car available, anything further than this in a straight line is driven. 1.5 km
// is about a 25-minute walk once streets bend it, which is where tours switch to the bus.
export const WALK_MAX_KM = 1.5;

// Streets are longer than straight lines. 1.3 for walking is what `timed-tour.mjs` has
// used since the first tour; 1.35 for roads is the usual circuity factor for road networks.
export const WALK_DETOUR = 1.3;
export const DRIVE_DETOUR = 1.35;

// Getting into and out of a car, and finding somewhere to leave it. The router cannot
// know this, so it is added to measured legs as well, and said out loud.
export const PARK_MINUTES = 5;

// A ferry's crossing time is in OpenStreetMap; its timetable is not. Half an hour is
// budgeted for waiting at the quay, and the leg says so.
export const FERRY_WAIT_MINUTES = 30;

// A measured tour may overrun its budget by this much before a stop is dropped.
export const BUDGET_TOLERANCE = 1.1;

function round1(value) {
  return Math.round(value * 10) / 10;
}

// Average door-to-door road speed by how far apart two points are. Short hops are city
// streets; longer ones reach A-roads. Used ONLY for an estimate.
function driveSpeedKmh(straightKm) {
  if (straightKm <= 3) return 20;
  if (straightKm <= 20) return 40;
  return 65;
}

export function normalizeModes(modes) {
  const list = (Array.isArray(modes) ? modes : []).filter((mode) => TOUR_MODES.includes(mode));
  // Walking is always possible: you walk from the car to the castle.
  return [...new Set(["walk", ...list])];
}

// The estimate for one leg, with the formula it came from. Only used to pick stops and
// when the router is down.
export function estimateLeg(from, to, mode) {
  const straightKm = haversineKm(from, to);
  if (mode === "car") {
    const km = straightKm * DRIVE_DETOUR;
    return {
      mode,
      straightKm: round1(straightKm),
      km: round1(km),
      minutes: Math.ceil((km / driveSpeedKmh(straightKm)) * 60) + PARK_MINUTES,
      source: "estimate",
      ferry: null,
    };
  }
  const km = straightKm * WALK_DETOUR;
  return {
    mode: "walk",
    straightKm: round1(straightKm),
    km: round1(km),
    minutes: Math.max(1, Math.ceil((km / WALKING_SPEED_KMH) * 60)),
    source: "estimate",
    ferry: null,
  };
}

// How far from the start a stop can be and still be worth considering: half the budget
// spent travelling out at the fastest allowed mode.
export function reachKm(budgetMinutes, modes) {
  const allowed = normalizeModes(modes);
  const kmh = allowed.includes("car") ? 65 / DRIVE_DETOUR : WALKING_SPEED_KMH / WALK_DETOUR;
  return round1((budgetMinutes / 2 / 60) * kmh);
}

// How much a stop is worth. Paid tours go to the famous spots, and the best signal we
// have for "famous" is how sure we are of it: a verified place beats a checked source,
// which beats a row nobody has looked at. Each further film at the spot and each further
// source naming it adds a little — the Glenfinnan Viaduct is in four Harry Potter films.
export function stopValue(stop) {
  const base = stop.verified ? 3 : (stop.grounding?.status === "verified" ? 2 : 1);
  const works = Array.isArray(stop.works) ? stop.works.length : 0;
  const sources = Math.min(2, Math.max(0, (stop.merged_count ?? 1) - 1));
  return base + 0.5 * Math.max(0, works - 1) + 0.5 * sources;
}

// Two rows this close are one stop to walk to, even when their names differ ("Durham
// Cathedral" and "Cathédrale de Durham"). The richer row leads and keeps every film.
export const SPACING_M = 120;

function normalName(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// A sound stage is where a show was made, not somewhere a visitor can walk in: Titanic
// Studios in Belfast and Stone Street in Wellington came up as tour stops on the first
// run. The studio tours that do take visitors are booked separately, so a stage is left
// out of a tour you build yourself. LA's lots are handled earlier by `studio-lots.mjs`.
// The ones that DO take visitors say so in their name — "Warner Bros. Studio Tour London",
// a studio museum, a theme park — and are kept.
export function isWorkingStudio(stop) {
  const name = String(stop?.name ?? "");
  return /\bstudios?\b/i.test(name) && !/\b(tour|museum|experience|park|theme)\b/i.test(name);
}

export function mergeNearbyStops(stops, spacingM = SPACING_M) {
  const ranked = [...stops].sort((a, b) =>
    stopValue(b) - stopValue(a) || String(a.id).localeCompare(String(b.id)));
  const kept = [];
  for (const stop of ranked) {
    const host = kept.find((other) => haversineKm(other.position, stop.position) * 1000 <= spacingM);
    if (!host) {
      kept.push({ ...stop, works: [...(stop.works ?? [])] });
      continue;
    }
    for (const work of stop.works ?? []) if (!host.works.includes(work)) host.works.push(work);
    host.merged_count = (host.merged_count ?? 1) + (stop.merged_count ?? 1);
    if (normalName(stop.name) !== normalName(host.name)) {
      host.also_known_as = [...new Set([...(host.also_known_as ?? []), stop.name])];
    }
  }
  return kept;
}

// The POOL_SIZE best stops inside reach: most valuable first, then nearest, then by id so
// the same request answers the same way twice. Nearest-only was tried first and kept
// Belfast's forty suburban estates while the Dark Hedges, 60 km out, never made the pool. A stop named after the hub itself ("Dubrovnik", from Dubrovnik) is a
// city, not somewhere to stand, and is left out.
export function poolForTour(stops, origin, { budgetMinutes, modes, radiusKm = null, hubName = null, onStudio = null }) {
  const limit = Math.min(radiusKm ?? Infinity, reachKm(budgetMinutes, modes));
  const hub = hubName ? normalName(hubName) : null;
  const inReach = (Array.isArray(stops) ? stops : [])
    .filter((stop) => isFinitePair(stop?.position))
    .filter((stop) => !hub || normalName(stop.name) !== hub)
    .filter((stop) => {
      if (!isWorkingStudio(stop)) return true;
      onStudio?.(stop);
      return false;
    })
    .filter((stop) => haversineKm(origin, stop.position) <= limit);
  return mergeNearbyStops(inReach)
    .map((stop) => ({ stop, km: haversineKm(origin, stop.position) }))
    .sort((a, b) => stopValue(b.stop) - stopValue(a.stop)
      || a.km - b.km || String(a.stop.id).localeCompare(String(b.stop.id)))
    .slice(0, POOL_SIZE)
    .map(({ stop }) => stop);
}

// Estimated minutes for a stop order, travel plus dwell, with the car tracked.
function estimatedTotal(origin, stops, { modes, returnToStart, dwellMinutes }) {
  return tourLegs(origin, stops, { modes, returnToStart }).reduce((sum, leg) => sum + leg.minutes, 0)
    + stops.length * dwellMinutes;
}

// Two-opt over the stops between a fixed start and (optional) fixed end. Deterministic:
// it always takes the first improving swap.
function twoOpt(origin, stops, options) {
  let order = [...stops];
  let best = estimatedTotal(origin, order, options);
  let improved = true;
  let guard = 0;
  while (improved && guard < 50) {
    improved = false;
    guard += 1;
    for (let i = 0; i < order.length - 1 && !improved; i += 1) {
      for (let k = i + 1; k < order.length && !improved; k += 1) {
        const candidate = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        const next = estimatedTotal(origin, candidate, options);
        if (next < best) {
          order = candidate;
          best = next;
          improved = true;
        }
      }
    }
  }
  return order;
}

// Which stops, in which order, fit the budget — on ESTIMATES. The route handler then
// measures the legs and `fitMeasuredTour` trims anything the measurement pushed over.
//
// Greedy insertion by value per added minute, then two-opt, then one more insertion pass
// with whatever time two-opt freed. Cheapest-insertion is the textbook heuristic for this
// (an orienteering problem); it never builds a zig-zag the way nearest-neighbour does.
export function planTourOrder(pool, origin, {
  budgetMinutes,
  modes,
  dwellMinutes = DEFAULT_DWELL_MINUTES,
  returnToStart = true,
} = {}) {
  const options = { modes, returnToStart, dwellMinutes };
  const total = (list) => estimatedTotal(origin, list, options);

  // The cheapest place to put `stop` into `list`, or null if nowhere fits the budget.
  const cheapestInsert = (list, stop) => {
    let best = null;
    for (let at = 0; at <= list.length; at += 1) {
      const next = [...list.slice(0, at), stop, ...list.slice(at)];
      const minutes = total(next);
      if (minutes > budgetMinutes) continue;
      if (!best || minutes < best.minutes) best = { next, minutes };
    }
    return best;
  };

  // Value per added minute: fills a budget with many close stops.
  const ratioPass = (start) => {
    let chosen = start;
    for (;;) {
      if (chosen.length >= MAX_TOUR_STOPS) return chosen;
      const current = total(chosen);
      let best = null;
      for (const stop of pool) {
        if (chosen.includes(stop)) continue;
        const fit = cheapestInsert(chosen, stop);
        if (!fit) continue;
        const score = stopValue(stop) / Math.max(1, fit.minutes - current);
        if (!best || score > best.score + 1e-9
          || (Math.abs(score - best.score) <= 1e-9 && String(stop.id) < String(best.stop.id))) {
          best = { stop, next: fit.next, score };
        }
      }
      if (!best) return chosen;
      chosen = best.next;
    }
  };

  // Most valuable first: reaches the famous spot an hour out that the ratio pass would
  // trade for three hedges next to the hotel. This is how the paid tours are built.
  //
  // Seeded from each of the top few stops in turn, because the first pick decides the
  // direction of the day: from Edinburgh, Durham Cathedral and the Glenfinnan Viaduct are
  // worth the same and lie 340 km apart, and whichever is taken first shuts out the other's
  // whole region. Each seed builds its own day and the richest day wins.
  const ranked = [...pool].sort((a, b) =>
    stopValue(b) - stopValue(a) || String(a.id).localeCompare(String(b.id)));
  const valuePass = (seed) => {
    let chosen = cheapestInsert([], seed)?.next ?? [];
    for (const stop of ranked) {
      if (chosen.length >= MAX_TOUR_STOPS) break;
      if (chosen.includes(stop)) continue;
      const fit = cheapestInsert(chosen, stop);
      if (fit) chosen = fit.next;
    }
    return chosen;
  };

  const finish = (list) => ratioPass(twoOpt(origin, list, options));
  const plans = [finish(ratioPass([])), ...ranked.slice(0, SEEDS).map((seed) => finish(valuePass(seed)))];
  const worth = (list) => list.reduce((sum, stop) => sum + stopValue(stop), 0);
  plans.sort((a, b) => worth(b) - worth(a) || total(a) - total(b));
  return plans[0];
}

// The legs a stop order needs, with the car kept where it was left.
//
// The first version chose each leg's mode from that leg alone, so "walk 1 km to the
// abbey, then drive 60 km to the coast" drove from the abbey — where no car had ever
// been. Now the car is a thing on the map: a short hop is walked only while it stays
// near the car, the next drive starts with a walk back to it, and the tour ends with the
// car (home, or beside the last stop).
//
// Each leg says what it arrives at: `stop` (with its index), `car` or `home`.
export function tourLegs(origin, stops, { modes, returnToStart = true } = {}) {
  const hasCar = normalizeModes(modes).includes("car");
  const legs = [];
  let here = origin;
  let car = hasCar ? origin : null;

  const push = (from, to, mode, kind, stop = null) => {
    legs.push({ index: legs.length, kind, stop, from, to, ...estimateLeg(from, to, mode) });
  };
  const driveTo = (to, kind, stop) => {
    if (haversineKm(here, car) > 0.001) push(here, car, "walk", "car");
    push(car, to, "car", kind, stop);
    car = to;
    here = to;
  };
  const walkable = (to) => haversineKm(here, to) <= WALK_MAX_KM
    && (!car || haversineKm(car, to) <= WALK_MAX_KM * 2);

  stops.forEach((stop, index) => {
    if (!hasCar || walkable(stop.position)) {
      push(here, stop.position, "walk", "stop", index);
      here = stop.position;
    } else {
      driveTo(stop.position, "stop", index);
    }
  });

  if (stops.length > 0) {
    if (returnToStart) {
      if (!hasCar || haversineKm(car, origin) <= 0.001) {
        // The car never left the start (or there is none): walk home.
        push(here, origin, "walk", "home");
      } else {
        driveTo(origin, "home", null);
      }
    } else if (car && haversineKm(here, car) > 0.001) {
      // A one-way tour still ends with the car.
      push(here, car, "walk", "car");
    }
  }
  return legs;
}

// Consecutive legs of one mode, so a car run of five legs is one router request rather
// than five. OSRM answers a multi-waypoint route with one `legs[]` entry per pair.
export function legRuns(legs, maxWaypoints = 25) {
  const runs = [];
  for (const leg of legs) {
    const last = runs.at(-1);
    const joins = last && last.mode === leg.mode
      && last.positions.at(-1)[0] === leg.from[0] && last.positions.at(-1)[1] === leg.from[1];
    if (joins && last.legIndexes.length < maxWaypoints - 1) {
      last.legIndexes.push(leg.index);
      last.positions.push(leg.to);
    } else {
      runs.push({ mode: leg.mode, legIndexes: [leg.index], positions: [leg.from, leg.to] });
    }
  }
  return runs;
}

export function buildRouterUrl(positions, mode, base = "https://routing.openstreetmap.de") {
  const profile = mode === "car" ? "routed-car" : "routed-foot";
  const coordinates = positions.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const url = new URL(`${base.replace(/\/$/, "")}/${profile}/route/v1/driving/${coordinates}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  // Steps are asked for only to read each step's `mode`: that is how a ferry is found.
  url.searchParams.set("steps", "true");
  return url;
}

// One router answer, split back into the legs it covers. Throws on anything that is not a
// complete route, so the caller falls back to estimates rather than trusting half of one.
export function parseRouterRun(payload, run) {
  const route = payload?.code === "Ok" ? payload.routes?.[0] : null;
  const legs = route?.legs;
  if (!Array.isArray(legs) || legs.length !== run.legIndexes.length) {
    throw new Error("Router answered a different number of legs");
  }
  const measured = legs.map((leg, position) => {
    if (!Number.isFinite(leg?.distance) || !Number.isFinite(leg?.duration) || leg.distance < 0 || leg.duration < 0) {
      throw new Error("Router leg has no distance or duration");
    }
    const ferrySeconds = (Array.isArray(leg.steps) ? leg.steps : [])
      .filter((step) => step?.mode === "ferry" && Number.isFinite(step.duration))
      .reduce((sum, step) => sum + step.duration, 0);
    return {
      index: run.legIndexes[position],
      km: round1(leg.distance / 1000),
      routerMinutes: Math.max(1, Math.round(leg.duration / 60)),
      ferryMinutes: ferrySeconds > 0 ? Math.max(1, Math.round(ferrySeconds / 60)) : 0,
    };
  });
  const coordinates = route?.geometry?.type === "LineString" ? route.geometry.coordinates : [];
  const positions = coordinates
    .filter((pair) => Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
    .map(([lng, lat]) => [lat, lng]);
  return { measured, path: { mode: run.mode, positions, source: "router" } };
}

// Measured numbers replace the estimate on each leg they cover. Parking and the ferry
// queue are added on top and named, because the router knows neither.
export function applyMeasurements(legs, measurements) {
  const byIndex = new Map(measurements.map((entry) => [entry.index, entry]));
  return legs.map((leg) => {
    const measured = byIndex.get(leg.index);
    if (!measured) return leg;
    const ferry = measured.ferryMinutes > 0
      ? { minutes: measured.ferryMinutes, waitMinutes: FERRY_WAIT_MINUTES }
      : null;
    const extra = (leg.mode === "car" ? PARK_MINUTES : 0) + (ferry ? FERRY_WAIT_MINUTES : 0);
    return {
      ...leg,
      km: measured.km,
      minutes: measured.routerMinutes + extra,
      routerMinutes: measured.routerMinutes,
      source: "router",
      ferry,
    };
  });
}

export function tourTotals(legs, stops, dwellMinutes = DEFAULT_DWELL_MINUTES) {
  const travelMinutes = legs.reduce((sum, leg) => sum + leg.minutes, 0);
  const stayMinutes = stops.length * dwellMinutes;
  return {
    travelMinutes,
    dwellMinutes: stayMinutes,
    totalMinutes: travelMinutes + stayMinutes,
    km: round1(legs.reduce((sum, leg) => sum + leg.km, 0)),
    walkKm: round1(legs.filter((leg) => leg.mode === "walk").reduce((sum, leg) => sum + leg.km, 0)),
    driveKm: round1(legs.filter((leg) => leg.mode === "car").reduce((sum, leg) => sum + leg.km, 0)),
    ferries: legs.filter((leg) => leg.ferry).length,
    measuredLegs: legs.filter((leg) => leg.source === "router").length,
    estimatedLegs: legs.filter((leg) => leg.source !== "router").length,
  };
}

// The stop whose removal saves the most time for the least value lost. Used when the
// measured tour runs over: the router's real numbers are longer than the estimate.
export function stopToDrop(stops, origin, { modes, returnToStart = true, dwellMinutes = DEFAULT_DWELL_MINUTES } = {}) {
  if (stops.length === 0) return -1;
  const options = { modes, returnToStart, dwellMinutes };
  const whole = estimatedTotal(origin, stops, options);
  let best = -1;
  let bestRatio = -Infinity;
  stops.forEach((stop, index) => {
    const saved = whole - estimatedTotal(origin, stops.filter((_, other) => other !== index), options);
    const ratio = saved / stopValue(stop);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = index;
    }
  });
  return best;
}

// Clock times for each stop, from minute 0 at the start.
export function scheduleStops(stops, legs, dwellMinutes = DEFAULT_DWELL_MINUTES) {
  const arrivals = new Map();
  let clock = 0;
  for (const leg of legs) {
    clock += leg.minutes;
    if (leg.kind === "stop") {
      arrivals.set(leg.stop, clock);
      clock += dwellMinutes;
    }
  }
  return stops.map((stop, index) => ({
    ...stop,
    order: index + 1,
    arriveAtMinute: arrivals.get(index) ?? null,
    dwellMinutes,
  }));
}

export function tourHonesty({ stops, totals }) {
  const unverified = stops.filter((stop) => !stop.verified).length;
  const parts = [];
  if (totals.estimatedLegs === 0) {
    parts.push("Every distance and time comes from the OpenStreetMap router.");
  } else if (totals.measuredLegs === 0) {
    parts.push("The router could not be reached, so every leg is an estimate from straight-line distance.");
  } else {
    parts.push(`${totals.estimatedLegs} of ${totals.measuredLegs + totals.estimatedLegs} legs are estimates; the rest come from the OpenStreetMap router.`);
  }
  if (unverified > 0) {
    parts.push(`${unverified} of ${stops.length} stops are unchecked places from our sources.`);
  }
  if (totals.ferries > 0) {
    parts.push(`Ferry crossings include ${FERRY_WAIT_MINUTES} minutes of waiting; check the timetable.`);
  }
  return parts.join(" ");
}

// "2 h 05 min", "45 min". Clock-ish rather than decimal hours: 1.75 h reads as nothing.
export function formatTourMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")} min` : `${hours} h`;
}

// The tour handed to Google Maps for turn-by-turn. Google takes at most 9 waypoints in a
// directions link; a longer tour is cut and says so through `truncated`.
export const GOOGLE_MAX_WAYPOINTS = 9;

export function googleMapsTourUrl({ origin, stops, returnToStart = true, modes = ["walk"] }) {
  if (!isFinitePair(origin) || !Array.isArray(stops) || stops.length === 0) return null;
  const points = stops.map((stop) => stop.position).filter(isFinitePair);
  if (points.length === 0) return null;
  // Cut to the first stops rather than skipping from the ninth to the last.
  const kept = returnToStart ? points : points.slice(0, GOOGLE_MAX_WAYPOINTS + 1);
  const destination = returnToStart ? origin : kept.at(-1);
  const via = returnToStart ? kept : kept.slice(0, -1);
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", origin.join(","));
  url.searchParams.set("destination", destination.join(","));
  if (via.length) url.searchParams.set("waypoints", via.slice(0, GOOGLE_MAX_WAYPOINTS).map((point) => point.join(",")).join("|"));
  url.searchParams.set("travelmode", normalizeModes(modes).includes("car") ? "driving" : "walking");
  return { href: url.toString(), truncated: points.length > GOOGLE_MAX_WAYPOINTS + (returnToStart ? 0 : 1) };
}
