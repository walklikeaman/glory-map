import { createClient } from "@supabase/supabase-js";

import {
  buildMapResponse,
  CLUSTER_BELOW_ZOOM,
  MAX_ROWS_PER_RESPONSE,
  parseMapQuery,
  viewportCenter,
} from "../../../lib/map-points.mjs";
import { RANKED_SOURCES } from "../../../lib/notable-here.mjs";
import { localiseMapRows, stringsToLookUp, textKey, workIdsOf } from "../../../lib/display-language.mjs";
import { tmdbUrlForSurface } from "../../../lib/tmdb-images.mjs";
import { imdbUrl } from "../../../lib/work-ratings.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

// Classify a graph failure for the response. Deliberately coarse — enough to point an
// operator at the cause (credentials vs schema vs upstream), never enough to expose
// the key, the SQL, or row data.
export function graphFailureReason(error) {
  const message = String(error?.message ?? "").toLowerCase();
  if (message.includes("api key") || message.includes("jwt") || message.includes("unauthorized")) {
    return "graph_auth_rejected";
  }
  if (message.includes("could not find") || message.includes("does not exist") || message.includes("schema cache")) {
    return "graph_schema_mismatch";
  }
  return "graph_query_failed";
}

// Public read: the content graph is public-read under RLS, so the anon key is enough
// and no user session is required to look at the map.
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

  // PostgREST puts `in.(…)` into the URL, so long lists go in slices.
  const inSlices = async (table, columns, column, values) => {
    const slices = [];
    for (let i = 0; i < values.length; i += 120) slices.push(values.slice(i, i + 120));
    const pages = await Promise.all(slices.map(async (slice) => {
      const { data, error } = await client.from(table).select(columns).in(column, slice);
      if (error) throw new Error(`${table} failed: ${error.message}`);
      return data ?? [];
    }));
    return pages.flat();
  };

  return {
    points: (params) => call("map_points_in_view", params),
    works: (ids) => inSlices("works", "id, imdb_id, poster_path", "id", ids),
    translations: (keys) => inSlices("text_translations", "source_md5, english", "source_md5", keys),
    clusters: (params) => call("map_clusters_in_view", params),
    // The queue in the same viewport. Separate calls rather than a union, because the two
    // are different things and the response keeps them apart all the way to the client.
    candidatePoints: (params) => call("map_candidate_points_in_view", params),
    candidateClusters: (params) => call("map_candidate_clusters_in_view", params),
    fictional: ({ workId, kinds }) =>
      call("fictional_places", { p_work_id: workId ?? null, p_kinds: kinds ?? null }),
    nearest: ({ lat, lng, workId, kinds, limit = 3 }) =>
      call("remote_points", {
        p_lat: lat, p_lng: lng, p_limit: limit,
        p_work_id: workId ?? null, p_kinds: kinds ?? null,
      }),
  };
}

// GET /api/map/points?west&south&east&north&z&workId&kinds
// The map's read path: it serves the persistent graph, not a live SPARQL query, so a
// viewport costs one indexed query. Zoomed out it returns grid clusters; zoomed in,
// individual places carrying their grounding fields (place_class, confidence,
// precision, shot_on_set) so the UI can be honest about what each pin is.
// English names, posters and IMDb links on top of what the map RPCs return (see
// display-language.mjs). Best effort by design: if either lookup fails — the translations
// table not yet migrated, a slow works query — the map still draws, in the original
// language and without posters, rather than going blank over a nicety.
// A lookup that hangs is a failure too: the map waits this long for it, then draws without.
const LOOKUP_TIMEOUT_MS = 1500;

function bestEffort(promise, label, logError, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => { logError(`${label} timed out`, { timeoutMs }); resolve([]); }, timeoutMs);
  });
  const settled = promise.then(
    (value) => value ?? [],
    (error) => { logError(`${label} failed`, { message: error?.message }); return []; },
  );
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
}

export async function localise(reader, groups, logError = () => {}, { timeoutMs = LOOKUP_TIMEOUT_MS } = {}) {
  const all = Object.values(groups).flatMap((list) => list ?? []);
  const strings = stringsToLookUp(all);
  const workIds = workIdsOf(groups.candidateRows);
  const [works, english] = await Promise.all([
    workIds.length && reader.works
      ? bestEffort(reader.works(workIds), "Map works lookup", logError, timeoutMs)
      : [],
    strings.length && reader.translations
      ? bestEffort(reader.translations(strings.map(textKey)), "Map translations lookup", logError, timeoutMs)
      : [],
  ]);
  const options = {
    works: new Map(works.map((work) => [work.id, work])),
    english: new Map(english.map((row) => [row.source_md5, row.english])),
    posterUrl: (path) => tmdbUrlForSurface(path, "pointFilmPoster"),
    imdbUrl,
  };
  return Object.fromEntries(Object.entries(groups).map(([key, list]) => [key, localiseMapRows(list, options)]));
}

export function createMapPointsHandler({
  env = process.env,
  createReader,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeReader = createReader ?? (() => defaultCreateReader(env));

  return async function GET(request) {
    const query = parseMapQuery(new URL(request.url).searchParams);
    if (query.error) return jsonError(query.error, 400);

    const reader = makeReader(env);
    if (!reader) return jsonError("Map graph is not configured", 503);

    const params = {
      p_west: query.west,
      p_south: query.south,
      p_east: query.east,
      p_north: query.north,
      p_zoom: query.zoom,
      p_work_id: query.workId,
      p_kinds: query.kinds,
    };

    // The queue rows the map may draw. They are asked for only when the caller wants
    // them, because they are the expensive half — 32,148 located rows against a graph of
    // 70 — and because every existing caller of this endpoint was written before they
    // existed and must keep getting exactly what it got yesterday.
    //
    // `workId` deliberately does NOT filter them: a work-scoped map already has its own
    // candidate path through `/api/locations`, and running both would draw every row
    // twice.
    const wantCandidates = query.candidates && !query.workId;

    try {
      const [rows, fictional, candidateRows] = await Promise.all([
        query.clustered
          ? reader.clusters({ ...params, p_max_clusters: MAX_ROWS_PER_RESPONSE })
          : reader.points({ ...params, p_max_points: MAX_ROWS_PER_RESPONSE, p_cluster_below_zoom: CLUSTER_BELOW_ZOOM }),
        // Same work/kind filters as the map, so the strip always describes the same query.
        reader.fictional({ workId: query.workId, kinds: query.kinds }),
        wantCandidates && reader.candidatePoints
          ? (query.clustered
            ? reader.candidateClusters({
              p_west: params.p_west, p_south: params.p_south, p_east: params.p_east,
              p_north: params.p_north, p_zoom: params.p_zoom, p_kinds: params.p_kinds,
              p_max_clusters: MAX_ROWS_PER_RESPONSE,
            })
            : reader.candidatePoints({
              p_west: params.p_west, p_south: params.p_south, p_east: params.p_east,
              p_north: params.p_north, p_zoom: params.p_zoom, p_kinds: params.p_kinds,
              p_max_points: MAX_ROWS_PER_RESPONSE, p_cluster_below_zoom: CLUSTER_BELOW_ZOOM,
              // The same list "Known for" ranks by, so the map sends the number the ranking
              // is allowed to use — and nothing of IMDb's once "imdb" is out of it (#224).
              p_rating_sources: [...RANKED_SOURCES],
            }))
          : [],
      ]);

      // Only when the viewport is genuinely empty: one extra KNN query so the answer is
      // "nothing HERE, the nearest is X km away" rather than a blank map that reads as
      // "there is nothing". Never paid for on a populated viewport.
      let nearest = [];
      if ((rows?.length ?? 0) === 0 && (candidateRows?.length ?? 0) === 0 && reader.nearest) {
        const center = viewportCenter(query);
        nearest = await reader.nearest({
          lat: center.lat, lng: center.lng, workId: query.workId, kinds: query.kinds,
        });
      }

      const readable = await localise(reader, { rows, fictional, nearest, candidateRows }, logError);

      return Response.json(buildMapResponse(
        query, readable.rows, readable.fictional, readable.nearest, readable.candidateRows,
      ), {
        headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
      });
    } catch (error) {
      logError("Map points request failed", { message: error?.message });
      // A bare "could not load" is undiagnosable in a deployed environment: a wrong
      // anon key, a missing grant and a real outage all look identical. The reason
      // code names the class of failure without leaking the key or the SQL.
      return Response.json(
        { error: "Could not load map points", reason: graphFailureReason(error) },
        { status: 502, headers: noStoreHeaders },
      );
    }
  };
}

export const GET = createMapPointsHandler();
