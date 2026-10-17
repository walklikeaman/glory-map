// GET /api/genres?kind=film&id=603 — a work's TMDB genres, for the voice guide's tone (#68).
//
// Not stored: we have no genre column, and a tone is a nicety that must not need a
// migration. TMDB's answer is cached a week at the edge, so each work costs one call.

import { requestTmdb } from "../../lib/tmdb-request.mjs";
import { parseTmdbMovieId } from "../../lib/tmdb-images.mjs";

export const runtime = "nodejs";

const TIMEOUT_MS = 2500;
const cacheHeaders = { "Cache-Control": "public, max-age=604800, stale-while-revalidate=2592000" };
const KINDS = new Set(["film", "series"]);

export function createGenresHandler({
  env = process.env,
  fetchImpl = fetch,
  logError = console.error,
} = {}) {
  return async function GET(request) {
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind") ?? "film";
    const id = parseTmdbMovieId(params.get("id"));
    if (!KINDS.has(kind) || !id) {
      return Response.json({ error: "Provide a film or series TMDB id." }, { status: 400 });
    }

    // No genre is a valid answer: the guide keeps its warm default. So every failure
    // below is an empty list, not an error the player would have to handle.
    const none = (reason) => Response.json({ genres: [], reason });
    if (!env.TMDB_API_READ_ACCESS_TOKEN && !env.TMDB_API_KEY) return none("no_credentials");

    try {
      const attempt = await requestTmdb(kind, id, { env, fetchImpl, timeoutMs: TIMEOUT_MS });
      if (!attempt?.response?.ok) {
        logError(`genres: tmdb ${kind}/${id} responded ${attempt?.response?.status}`);
        return none(`http_${attempt?.response?.status ?? "unknown"}`);
      }
      const detail = await attempt.response.json();
      const genres = (Array.isArray(detail?.genres) ? detail.genres : [])
        .map((genre) => genre?.name)
        .filter((name) => typeof name === "string" && name.trim());
      return Response.json({ genres }, { headers: cacheHeaders });
    } catch (error) {
      logError(`genres: tmdb lookup failed for ${kind}/${id}`, error);
      return none("threw");
    }
  };
}

export const GET = createGenresHandler();
