// "Build my film tour" (2026-11-27): a tour of a work's places that fits the time you have,
// on foot or with a car, ferries included.
//
// Stops come from our own stores, each saying whether we verified it. Every distance and
// time comes from haversine on stored coordinates and from the OpenStreetMap router —
// never from a model. When the router is down a leg is marked `estimate`, not hidden.

import { createClient } from "@supabase/supabase-js";

import {
  BUDGET_TOLERANCE,
  DEFAULT_DWELL_MINUTES,
  FILM_TOUR_MAX_MINUTES,
  FILM_TOUR_MIN_MINUTES,
  applyMeasurements,
  buildRouterUrl,
  legRuns,
  normalizeModes,
  parseRouterRun,
  planTourOrder,
  poolForTour,
  scheduleStops,
  stopToDrop,
  tourHonesty,
  tourLegs,
  tourTotals,
} from "../../../lib/film-tour.mjs";
import { findFilmTourTemplate } from "../../../lib/film-tour-templates.mjs";
import { finiteOrNull } from "../../../lib/numbers.mjs";
import { factDistance } from "../../../lib/facts.mjs";
import { isRefusedSource } from "../../../lib/submission-places.mjs";
import { collapseSameSpot, splitTripStops, toStop } from "../../../lib/trip-plan.mjs";
import { USER_AGENT } from "../../../lib/user-agent.mjs";

export const runtime = "nodejs";

const ROUTER_TIMEOUT_MS = 10_000;
const MAX_WORKS = 20;
const MAX_CLIENT_STOPS = 300;
const MAX_FIT_ROUNDS = 3;
const QUEUE_ROW_LIMIT = 3000;
// PostgREST answers at most 1,000 rows a request, so larger reads are paged.
const PAGE_ROWS = 1000;

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function parsePosition(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const lat = finiteOrNull(value[0]);
  const lng = finiteOrNull(value[1]);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return [lat, lng];
}

export function parseTourBody(body) {
  const template = body?.template ? findFilmTourTemplate(String(body.template)) : null;
  if (body?.template && !template) return { error: "Unknown tour template" };

  const works = Array.isArray(body?.works) ? body.works.map(String).filter((id) => /^Q\d+$/.test(id)) : [];
  if (works.length > MAX_WORKS) return { error: `At most ${MAX_WORKS} works` };

  let stops = null;
  if (body?.stops !== undefined) {
    if (!Array.isArray(body.stops) || body.stops.length > MAX_CLIENT_STOPS) {
      return { error: `stops must be an array of at most ${MAX_CLIENT_STOPS}` };
    }
    stops = body.stops
      .map((stop, index) => ({
        id: `client:${String(stop?.id ?? index).slice(0, 80)}`,
        name: String(stop?.name ?? "").trim().slice(0, 200),
        position: parsePosition(stop?.position),
        works: (Array.isArray(stop?.works) ? stop.works : []).map(String).slice(0, 50),
        // A stop the browser sends is the map's own row; it cannot vouch for itself.
        verified: false,
        grounding: { verified: false, store: "client" },
      }))
      .filter((stop) => stop.name && stop.position);
  }

  if (!template && works.length === 0 && !stops) {
    return { error: "Provide a template, works or stops" };
  }

  const origin = body?.origin === undefined || body?.origin === null
    ? (template ? [template.hub.lat, template.hub.lng] : null)
    : parsePosition(body.origin);
  if (!origin) return { error: "origin must be [lat, lng]" };

  const budgetMinutes = Math.round(finiteOrNull(body?.budgetMinutes) ?? template?.minutes ?? 240);
  if (budgetMinutes < FILM_TOUR_MIN_MINUTES || budgetMinutes > FILM_TOUR_MAX_MINUTES) {
    return { error: `budgetMinutes must be between ${FILM_TOUR_MIN_MINUTES} and ${FILM_TOUR_MAX_MINUTES}` };
  }

  const dwellMinutes = Math.round(finiteOrNull(body?.dwellMinutes) ?? DEFAULT_DWELL_MINUTES);
  if (dwellMinutes < 5 || dwellMinutes > 120) return { error: "dwellMinutes must be between 5 and 120" };

  return {
    template,
    works: works.length ? works : (template?.works ?? []),
    stops,
    origin,
    budgetMinutes,
    dwellMinutes,
    modes: normalizeModes(body?.modes ?? template?.modes ?? ["walk"]),
    returnToStart: body?.returnToStart !== false,
    radiusKm: template?.radiusKm ?? null,
  };
}

// Graph places and queue rows for the works, in the rows `toStop` reads.
export function defaultCreateReader(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });

  return async function readWorkPlaces(wikidataIds) {
    const { data: works, error } = await client
      .from("works")
      .select("id, title, year, kind, wikidata_id")
      .in("wikidata_id", wikidataIds);
    if (error) throw new Error(`works read failed: ${error.message}`);
    const ids = (works ?? []).map((work) => work.id);
    if (ids.length === 0) return { works: [], places: [], candidates: [] };
    const byId = new Map(works.map((work) => [work.id, work]));

    // Paged, ordered, and told when it stopped short: a read cut at the server's cap would
    // otherwise drop places silently.
    const readPages = async (build, label) => {
      const rows = [];
      for (let start = 0; start < QUEUE_ROW_LIMIT; start += PAGE_ROWS) {
        const { data, error: pageError } = await build().range(start, start + PAGE_ROWS - 1);
        if (pageError) throw new Error(`${label} read failed: ${pageError.message}`);
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE_ROWS) return { rows, truncated: false };
      }
      return { rows, truncated: true };
    };

    const [links, queue] = await Promise.all([
      // Only places a reviewer verified: the map draws nothing else from the graph, and a
      // stop printed as "Verified place" must be one.
      readPages(() => client
        .from("work_place_links")
        .select("id, place_id, work_id, relation_kind, places!inner ( id, name, lat, lng, geocode_precision, wikidata_id, status )")
        .in("work_id", ids)
        .eq("places.status", "verified")
        .order("id"), "places"),
      // `place_id is null`: a row promoted into the graph is already there as a verified
      // place, and reading it again would print it a second time as unchecked.
      readPages(() => client
        .from("location_submissions")
        .select("id, work_id, place_name, area_hint, source_kind, source_url, status, lat, lng")
        .in("work_id", ids)
        .neq("status", "rejected")
        .is("place_id", null)
        .not("lat", "is", null)
        .order("id"), "queue"),
    ]);

    return { works, byId, links: links.rows, queue: queue.rows, truncated: links.truncated || queue.truncated };
  };
}

// Rows → stops. Graph places merge their films; queue rows keep their own source.
export function stopsFromRows({ byId, links = [], queue = [] }) {
  const places = new Map();
  for (const link of links) {
    const place = link?.places;
    const work = byId?.get(link?.work_id);
    if (!place?.id || !work) continue;
    // An influence ("the grave that gave a character its name") is never a stop.
    const distance = factDistance({ relation_kind: link.relation_kind });
    const key = `${place.id}:${distance}`;
    const row = places.get(key) ?? {
      place_id: place.id,
      distance,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      geocode_precision: place.geocode_precision,
      wikidata_id: place.wikidata_id,
      films: [],
    };
    if (!row.films.some((film) => film.work_id === work.id)) {
      row.films.push({ work_id: work.id, title: work.title, year: work.year, kind: work.kind });
    }
    places.set(key, row);
  }

  const candidates = queue
    .filter((row) => !isRefusedSource(row?.source_kind))
    .map((row) => {
      const work = byId?.get(row.work_id);
      return {
        submission_id: row.id,
        place_name: row.place_name,
        area_hint: row.area_hint,
        source_kind: row.source_kind,
        source_url: row.source_url,
        status: row.status,
        lat: row.lat,
        lng: row.lng,
        work_id: row.work_id,
        work_title: work?.title ?? null,
        work_year: work?.year ?? null,
        work_kind: work?.kind ?? null,
      };
    });

  const all = [
    ...[...places.values()].map((row) => toStop(row, { verified: true })),
    ...candidates.map((row) => toStop(row, { verified: false })),
  ].filter((stop) => stop.name);
  const { eligible, excluded } = splitTripStops(all);
  return {
    stops: collapseSameSpot(eligible).map((stop) => ({
      ...stop,
      works: stop.works?.length ? stop.works : [stop.work?.title].filter(Boolean),
      verified: Boolean(stop.grounding?.verified),
    })),
    excluded: excluded.length,
  };
}

async function measureLegs(legs, { fetchImpl, routerBase, logError }) {
  const runs = legRuns(legs);
  const answers = await Promise.all(runs.map(async (run) => {
    try {
      const response = await fetchImpl(buildRouterUrl(run.positions, run.mode, routerBase), {
        cache: "no-store",
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`router responded ${response.status}`);
      return parseRouterRun(await response.json(), run);
    } catch (error) {
      logError("Film tour router failed", { mode: run.mode, message: error?.message });
      // The straight line between the stops, drawn dashed: a leg we could not measure.
      return { measured: [], path: { mode: run.mode, positions: run.positions, source: "estimate" } };
    }
  }));
  return {
    legs: applyMeasurements(legs, answers.flatMap((answer) => answer.measured)),
    paths: answers.map((answer) => answer.path),
  };
}

function publicStop(stop) {
  return {
    id: stop.id,
    order: stop.order,
    name: stop.name,
    position: stop.position,
    works: stop.works,
    verified: stop.verified,
    source_kind: stop.grounding?.source_kind ?? null,
    source_url: stop.grounding?.source_url ?? null,
    note: stop.note ?? null,
    arriveAtMinute: stop.arriveAtMinute,
    dwellMinutes: stop.dwellMinutes,
  };
}

export function createFilmTourHandler({
  env = process.env,
  createReader,
  fetchImpl = fetch,
  routerBase = process.env.TOUR_ROUTER_URL || undefined,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeReader = createReader ?? (() => defaultCreateReader(env));

  return async function POST(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError("Send a JSON body", 400);
    }
    const query = parseTourBody(body);
    if (query.error) return jsonError(query.error, 400);

    let stops = query.stops ?? [];
    let excluded = 0;
    let truncated = false;
    if (!query.stops) {
      const read = makeReader(env);
      if (!read) return jsonError("Places are not configured", 503);
      try {
        const rows = await read(query.works);
        ({ stops, excluded } = stopsFromRows(rows));
        truncated = Boolean(rows.truncated);
      } catch (error) {
        logError("Film tour read failed", { message: error?.message });
        return jsonError("Could not read places for these works", 502);
      }
    }

    const options = {
      budgetMinutes: query.budgetMinutes,
      modes: query.modes,
      dwellMinutes: query.dwellMinutes,
      returnToStart: query.returnToStart,
    };
    const pool = poolForTour(stops, query.origin, {
      ...options,
      radiusKm: query.radiusKm,
      hubName: query.template?.hub?.name ?? null,
      onStudio: () => { excluded += 1; },
    });
    let order = planTourOrder(pool, query.origin, options);

    let measured = { legs: [], paths: [] };
    let totals = tourTotals([], [], query.dwellMinutes);
    // Measure, and while the measured tour runs over, drop the stop that costs most per
    // value and measure again. `dirty` keeps the router from being asked twice for an
    // order it has already answered.
    let dirty = order.length > 0;
    for (let round = 0; round < MAX_FIT_ROUNDS && dirty; round += 1) {
      measured = await measureLegs(tourLegs(query.origin, order, options), { fetchImpl, routerBase, logError });
      totals = tourTotals(measured.legs, order, query.dwellMinutes);
      dirty = false;
      if (totals.totalMinutes <= query.budgetMinutes * BUDGET_TOLERANCE || order.length <= 1) break;
      const drop = stopToDrop(order, query.origin, options);
      order = order.filter((_, index) => index !== drop);
      dirty = order.length > 0;
      if (!dirty) {
        measured = { legs: [], paths: [] };
        totals = tourTotals([], [], query.dwellMinutes);
      }
    }
    if (dirty) {
      measured = await measureLegs(tourLegs(query.origin, order, options), { fetchImpl, routerBase, logError });
      totals = tourTotals(measured.legs, order, query.dwellMinutes);
    }

    const scheduled = scheduleStops(order, measured.legs, query.dwellMinutes).map(publicStop);
    const legs = measured.legs.map((leg) => ({
      index: leg.index,
      kind: leg.kind,
      stop: leg.stop,
      mode: leg.mode,
      from: leg.from,
      to: leg.to,
      straightKm: leg.straightKm,
      km: leg.km,
      minutes: leg.minutes,
      routerMinutes: leg.routerMinutes ?? null,
      source: leg.source,
      ferry: leg.ferry,
    }));

    return Response.json({
      template: query.template
        ? { id: query.template.id, title: query.template.title, hub: query.template.hub, like: query.template.like }
        : null,
      origin: query.origin,
      budgetMinutes: query.budgetMinutes,
      modes: query.modes,
      returnToStart: query.returnToStart,
      stops: scheduled,
      legs,
      paths: measured.paths,
      totals,
      overBudget: totals.totalMinutes > query.budgetMinutes * BUDGET_TOLERANCE,
      honesty: scheduled.length ? tourHonesty({ stops: scheduled, totals }) : "No stops fit this time from here.",
      counts: { places: stops.length, inReach: pool.length, excluded, truncated },
    }, { headers: { "Cache-Control": "private, no-store" } });
  };
}

export const POST = createFilmTourHandler();
