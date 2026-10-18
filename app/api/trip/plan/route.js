// The door the trip agent knocks on (#trip-agent).
//
// **What this route is, and what it deliberately is not.** The owner plans travel with an
// agent that is not this codebase, and the four shapes that agent could take — an MCP
// server, a third-party product with its own API, a custom GPT, or something he is still
// building — want four different transports and the SAME answer. This is the answer. It is
// the part every one of the four needs: an MCP tool wraps this, a GPT action calls it, a
// product integration posts to it, an export saves what it returns. The transport that
// wraps it is not built here, because which one to build is a question only the owner can
// settle and guessing it would be the expensive kind of wrong.
//
// **Why POST and not GET.** The body may carry the traveller's own film list. That list
// lives in the browser's localStorage and has never left it ([[personal-library]]); the one
// way to keep that true while still filtering by it is for the CLIENT to pass the titles it
// wants matched. A URL is the wrong place for them — it is logged, cached and refer(r)ed —
// so they travel in a body, are compared in memory, and are never written down. When a
// library is present this route refuses edge caching outright.
//
// **What it may never do** is hand over an unchecked queue row shaped like a verified
// place. In Los Angeles that is not a corner case, it is the whole city: measured
// 2026-09-10 15:08 UTC, the graph holds ONE place inside the LA viewport (the city
// centroid) against 4,665 queue rows. Every stop states which store it came from and who
// said it.

import { createClient } from "@supabase/supabase-js";

import { attachPlaceFilms, buildTripPlan, TRIP_MIN_STOPS } from "../../../lib/trip-plan.mjs";
import { TOUR_BUDGETS } from "../../../lib/timed-tour.mjs";
import { MAX_ROWS_PER_RESPONSE } from "../../../lib/map-points.mjs";
import { buildFootRouteUrl, parseFootRoute } from "../../../lib/walking-route.mjs";
import { finiteOrNull } from "../../../lib/numbers.mjs";
import { USER_AGENT } from "../../../lib/user-agent.mjs";

export const runtime = "nodejs";

const ROUTER_TIMEOUT_MS = 8_000;

// A library of a few thousand films is normal — a real Letterboxd export is 2,422 rows —
// and a body big enough to hold one is fine. This is a bound on abuse, not on the reader.
const MAX_LIBRARY_ENTRIES = 20_000;

// The router takes 2 to 5 stops. A plan with more than 5 cannot be drawn as one walk, and
// `timed-tour.mjs` never produces one, so this is a floor check and not a cap.
const MAX_ROUTER_STOPS = 5;

const PLACE_WORKS_BATCH = 100;

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

// Public read: the graph and the queue are both public-read under RLS, so the anon key is
// enough and no session is required to plan a walk.
function defaultCreateReader(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const call = async (fn, params) => {
    const { data, error } = await client.rpc(fn, params);
    if (error) throw new Error(`${fn} failed: ${error.message}`);
    return data ?? [];
  };

  // The same two readers the map uses, at the same zoom the map calls "individual points".
  // Reusing them rather than writing a third query is what keeps a plan and the pins a
  // traveller sees on the map from ever disagreeing about what is there.
  return {
    points: (params) => call("map_points_in_view", params),
    candidatePoints: (params) => call("map_candidate_points_in_view", params),
    // The films behind the graph places in view, which `map_points_in_view` does not
    // return (see attachPlaceFilms). Batched so a London viewport of 221 places stays a
    // few short requests rather than a URL PostgREST refuses.
    async placeWorks(placeIds) {
      const rows = [];
      for (let start = 0; start < placeIds.length; start += PLACE_WORKS_BATCH) {
        const { data, error } = await client
          .from("work_place_links")
          .select("place_id, works ( id, title, year, kind )")
          .in("place_id", placeIds.slice(start, start + PLACE_WORKS_BATCH));
        if (error) throw new Error(`place works failed: ${error.message}`);
        rows.push(...(data ?? []));
      }
      return rows;
    },
  };
}

export function parseTripBody(body) {
  const bbox = body?.bbox ?? {};
  const west = finiteOrNull(bbox.west);
  const east = finiteOrNull(bbox.east);
  const south = finiteOrNull(bbox.south);
  const north = finiteOrNull(bbox.north);
  if ([west, east, south, north].some((value) => value === null)) {
    return { error: "Provide a bbox with west, south, east and north" };
  }
  if (Math.abs(west) > 180 || Math.abs(east) > 180 || Math.abs(south) > 90 || Math.abs(north) > 90) {
    return { error: "bbox is out of range" };
  }

  const budgetMinutes = body?.budgetMinutes ?? 120;
  if (!TOUR_BUDGETS.includes(budgetMinutes)) {
    return { error: `budgetMinutes must be one of ${TOUR_BUDGETS.join(", ")}` };
  }

  // Optional. Absent means "start at the first stop", which is what a plan for a city you
  // have not arrived in should do.
  let origin = null;
  if (Array.isArray(body?.origin)) {
    const lat = finiteOrNull(body.origin[0]);
    const lng = finiteOrNull(body.origin[1]);
    if (lat === null || lng === null) return { error: "origin must be [lat, lng]" };
    origin = [lat, lng];
  }

  const library = body?.library;
  if (library !== undefined && library !== null) {
    if (!Array.isArray(library)) return { error: "library must be an array of { title, year }" };
    if (library.length > MAX_LIBRARY_ENTRIES) {
      return { error: `library may hold at most ${MAX_LIBRARY_ENTRIES} entries` };
    }
  }

  return {
    bbox: { west, east, south: Math.min(south, north), north: Math.max(south, north) },
    budgetMinutes,
    origin,
    library: Array.isArray(library) && library.length > 0 ? library : null,
    // "Use the list on my account" — for a caller that has an account and does not want to
    // carry 2,798 titles in every request. A list in the body always wins: it is the more
    // specific instruction, and it is also the only one a caller without an account has.
    useStoredLibrary: body?.useStoredLibrary === true || body?.mineOnly === true,
    includeStudioLots: body?.includeStudioLots === true,
    includeCandidates: body?.includeCandidates !== false,
  };
}

// The walk itself. A failure here loses the line on the map and never the plan: the stops,
// their order and their labels are all computed without the router, and a traveller with a
// list of five addresses in walking order still has a usable afternoon. Returning 502 for
// a missing polyline would throw away the part that matters for the part that is decoration.
async function walkFor(stops, { fetchImpl, routerUrl, logError }) {
  if (stops.length < 2 || stops.length > MAX_ROUTER_STOPS) return null;
  try {
    const url = buildFootRouteUrl(stops.map((stop) => stop.position), routerUrl);
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Walking router responded with ${response.status}`);
    const route = parseFootRoute(await response.json());
    return { ...route, source: "openstreetmap-foot" };
  } catch (error) {
    logError("Trip plan walking route failed", { message: error?.message });
    return null;
  }
}

// The traveller's own list, read from their account instead of from the request body.
//
// [[personal-library]] keeps the library in the browser and the body parameter exists so it
// never has to leave. That stays true for the site. An AGENT is the case it does not cover:
// it acts for the owner in another process, it has no localStorage, and carrying 2,798
// titles into every call is not a design, it is a workaround. So an account may now hold
// the list, and a caller that proves it owns that account gets to filter by it.
//
// The token is checked against Supabase Auth on every call — never trusted, never cached —
// and the row is read under the ANON key, so row-level security is what decides which
// library comes back. A service-role read here would work for any user id the caller
// named, which is the shape of the bug that ends up on a news site.
function defaultReadStoredLibrary(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  return async (token) => {
    if (!token) return null;
    const client = createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: auth, error: authError } = await client.auth.getUser(token);
    if (authError || !auth?.user?.id) return null;

    const { data, error } = await client
      .from("user_media_libraries")
      .select("movies")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (error) throw new Error(`stored library read failed: ${error.message}`);
    return Array.isArray(data?.movies) ? data.movies : [];
  };
}

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token || null;
}

export function createTripPlanHandler({
  env = process.env,
  createReader,
  readStoredLibrary,
  fetchImpl = fetch,
  routerUrl = process.env.WALKING_ROUTER_URL || undefined,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeReader = createReader ?? (() => defaultCreateReader(env));
  const makeLibraryReader = readStoredLibrary ?? (() => defaultReadStoredLibrary(env));

  return async function POST(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError("Send a JSON body", 400);
    }

    const query = parseTripBody(body);
    if (query.error) return jsonError(query.error, 400);

    const reader = makeReader(env);
    if (!reader) return jsonError("Map graph is not configured", 503);

    // Asked for, and either granted or refused OUT LOUD. Silently planning from the whole
    // catalogue when somebody asked for their own films is the failure this states instead:
    // they would read a list of films they have never seen as a list of films they have.
    let library = query.library;
    let storedLibrary = null;
    if (!library && query.useStoredLibrary) {
      const readLibrary = makeLibraryReader(env);
      const token = bearerToken(request);
      if (!readLibrary) return jsonError("Accounts are not configured", 503);
      if (!token) {
        return jsonError("useStoredLibrary needs an Authorization: Bearer <token> header", 401);
      }
      try {
        storedLibrary = await readLibrary(token);
      } catch (error) {
        logError("Stored library read failed", { message: error?.message });
        return jsonError("Could not read the library on this account", 502);
      }
      if (storedLibrary === null) return jsonError("That token does not identify an account", 401);
      if (storedLibrary.length === 0) {
        return jsonError("This account holds no library yet — import one first", 409);
      }
      library = storedLibrary;
    }

    const params = {
      p_west: query.bbox.west,
      p_south: query.bbox.south,
      p_east: query.bbox.east,
      p_north: query.bbox.north,
      // The zoom the map reads individual points at. Asking for clusters here would
      // return grid cells, which are not places and cannot be walked to.
      p_zoom: 15,
      p_kinds: null,
    };

    let places = [];
    let candidates = [];
    try {
      [places, candidates] = await Promise.all([
        reader.points({ ...params, p_work_id: null, p_max_points: MAX_ROWS_PER_RESPONSE, p_cluster_below_zoom: 0 }),
        query.includeCandidates && reader.candidatePoints
          ? reader.candidatePoints({ ...params, p_max_points: MAX_ROWS_PER_RESPONSE, p_cluster_below_zoom: 0 })
          : [],
      ]);
    } catch (error) {
      logError("Trip plan read failed", { message: error?.message });
      return jsonError("Could not read places for this area", 502);
    }

    // Losing the titles costs the stops their names and the library its matches, not the
    // plan — so a failed read is logged and the walk is still built.
    if (places.length > 0 && reader.placeWorks) {
      try {
        const ids = [...new Set(places.map((place) => place.place_id).filter(Boolean))];
        places = attachPlaceFilms(places, await reader.placeWorks(ids));
      } catch (error) {
        logError("Trip plan place works read failed", { message: error?.message });
      }
    }

    let plan;
    try {
      plan = buildTripPlan({
        places,
        candidates,
        origin: query.origin,
        budgetMinutes: query.budgetMinutes,
        library,
        includeStudioLots: query.includeStudioLots,
        includeCandidates: query.includeCandidates,
      });
    } catch (error) {
      logError("Trip plan build failed", { message: error?.message });
      return jsonError("Could not build a plan for this area", 500);
    }

    const walk = plan.stops.length >= 2
      ? await walkFor(plan.stops, { fetchImpl, routerUrl, logError })
      : null;

    return Response.json({
      ...plan,
      walk,
      // What the plan was drawn from, so a caller can tell "nothing here" from "we only
      // looked at the first thousand rows". The map caps a viewport at 1,000 and Los
      // Angeles holds 4,665 queue rows, so this is reached in practice, not in theory.
      // Which list the plan was filtered by, so a caller can tell "your films, and this is
      // what is left" from "everything we hold". Never the titles back — only where the
      // list came from and how long it was.
      filtered_by: library
        ? { source: storedLibrary ? "account" : "request", titles: library.length }
        : null,
      coverage: {
        verified_in_view: places.length,
        candidates_in_view: candidates.length,
        truncated: places.length >= MAX_ROWS_PER_RESPONSE || candidates.length >= MAX_ROWS_PER_RESPONSE,
      },
      // Stated rather than left for the caller to derive from `stops.length`.
      min_stops: TRIP_MIN_STOPS,
    }, {
      headers: {
        // A plan filtered by somebody's film library is about that person and is never
        // cached at the edge. Without one the answer is the same for everybody who asks
        // about that viewport, and an hour is short enough that a newly reviewed row
        // reaches a traveller the same day.
        "Cache-Control": library
          ? "private, no-store"
          : "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  };
}

export const POST = createTripPlanHandler();
