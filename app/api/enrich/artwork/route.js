import { createClient } from "@supabase/supabase-js";

import { buildWikidataEntitiesUrl } from "../../../lib/location-search.mjs";
import {
  artworkCandidates,
  artworkFromTmdb,
  artworkUpdates,
  tmdbIdFromEntity,
} from "../../../lib/work-artwork.mjs";
import { enrichGuard } from "../../../lib/enrich-auth.mjs";
import { USER_AGENT } from "../../../lib/user-agent.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";
const MAX_WORKS = 60;
const WIKIDATA_BATCH = 50;

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

// The graph is public-read under RLS, so a dry run can list the works that still need
// artwork with the anon key alone.
async function loadWorksAnon(env, fetchImpl, limit) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase is not configured");

  const endpoint = new URL(`${url}/rest/v1/works`);
  endpoint.searchParams.set("select", "id,kind,title,wikidata_id,tmdb_id,poster_path");
  endpoint.searchParams.set("poster_path", "is.null");
  endpoint.searchParams.set("wikidata_id", "not.is.null");
  endpoint.searchParams.set("artwork_updated_at", "is.null");
  endpoint.searchParams.set("limit", String(limit));

  const response = await fetchImpl(endpoint, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`works read failed with ${response.status}`);
  return response.json();
}

const UNIQUE_VIOLATION = "23505";

function defaultCreateWriter(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  return {
    async loadWorks(limit) {
      // Only what still needs artwork AND has not been looked up yet. Without the last two
      // filters a work with no Wikidata id, or none on TMDB, came back in every batch:
      // measured 18.10, 16 of a 60-work dry run found nothing, and 6,489 of 7,054 films
      // and series lack a tmdb_id — so batches fill with misses and the run stops moving.
      const { data, error } = await client
        .from("works")
        .select("id, kind, title, wikidata_id, tmdb_id, poster_path")
        .is("poster_path", null)
        .not("wikidata_id", "is", null)
        .is("artwork_updated_at", null)
        .limit(limit);
      if (error) throw new Error(`works load failed: ${error.message}`);
      return data ?? [];
    },
    async saveArtwork(rows) {
      let saved = 0;
      for (const row of rows) {
        const { error } = await client
          .from("works")
          .update({
            tmdb_id: row.tmdb_id,
            poster_path: row.poster_path,
            backdrop_path: row.backdrop_path,
            artwork_updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        // `works.tmdb_id` is unique, and two of our rows can resolve to one TMDB record
        // (a duplicate work). That is one row to review, not a reason to lose the batch:
        // it is stamped as looked at and left without the id.
        if (error?.code === UNIQUE_VIOLATION) {
          await this.markChecked([row.id]);
          continue;
        }
        if (error) throw new Error(`artwork update failed: ${error.message}`);
        saved += 1;
      }
      return saved;
    },
    // Looked up and found nothing on TMDB. Stamped so the next batch moves on.
    async markChecked(ids) {
      if (ids.length === 0) return;
      const { error } = await client
        .from("works")
        .update({ artwork_updated_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw new Error(`artwork stamp failed: ${error.message}`);
    },
  };
}

// POST /api/enrich/artwork — fill in cover art for works that have none.
//
// Chain: work.wikidata_id → P4947 (film) / P4983 (series) → tmdb_id → poster_path.
// Posters are TMDB's, the licensed official source; nothing here scrapes IMDb.
// Only the path is stored — image.tmdb.org serves the file publicly with no key.
export function createArtworkEnrichHandler({
  env = process.env,
  fetchImpl = (...args) => fetch(...args),
  createWriter,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeWriter = createWriter ?? (() => defaultCreateWriter(env));

  return async function POST(request) {
    // Before anything is read, parsed, or paid for.
    const refusal = enrichGuard(request, env);
    if (refusal) return refusal;

    const tmdbToken = env.TMDB_API_READ_ACCESS_TOKEN;
    const tmdbKey = env.TMDB_API_KEY;
    if (!tmdbToken && !tmdbKey) return jsonError("TMDB is not configured", 503);

    // ?dry=1 resolves the artwork and reports it without touching the database, so a
    // pass can be inspected before it is written — and so lookups still work while the
    // service-role key is absent.
    const dryRun = new URL(request.url).searchParams.get("dry") === "1";

    const writer = makeWriter(env);
    if (!writer && !dryRun) return jsonError("Enrichment is not configured", 503);

    try {
      const works = writer
        ? await writer.loadWorks(MAX_WORKS)
        : await loadWorksAnon(env, fetchImpl, MAX_WORKS);
      const candidates = artworkCandidates(works);
      if (candidates.length === 0) {
        return Response.json(
          { checked: works.length, enriched: 0, skipped: works.length },
          { headers: noStoreHeaders },
        );
      }

      // One batched Wikidata call for every work still missing its TMDB id.
      const needIds = candidates.filter((candidate) => !candidate.tmdbId);
      // wbgetentities takes at most 50 ids, and a batch of 60 works with no TMDB id yet
      // asks for 60 — the request builder throws and the whole pass is lost.
      for (let start = 0; start < needIds.length; start += WIKIDATA_BATCH) {
        const chunk = needIds.slice(start, start + WIKIDATA_BATCH);
        const entitiesUrl = buildWikidataEntitiesUrl(chunk.map((c) => c.wikidataId));
        const response = await fetchImpl(entitiesUrl, {
          headers: { Accept: "application/json", "User-Agent": USER_AGENT },
          signal: request.signal,
          next: { revalidate: 86400 },
        });
        if (!response.ok) throw new Error(`Wikidata responded with ${response.status}`);
        const payload = await response.json();
        for (const candidate of chunk) {
          candidate.tmdbId = tmdbIdFromEntity(payload?.entities?.[candidate.wikidataId], candidate.kind);
        }
      }

      const results = [];
      // Definite misses only: Wikidata names no TMDB id, or TMDB says the id is gone. A
      // 5xx or a timeout is not an answer and must not take a work out of the queue.
      const misses = [];
      for (const candidate of candidates) {
        if (!candidate.tmdbId) { misses.push(candidate.workId); continue; }
        const segment = candidate.kind === "series" ? "tv" : "movie";
        const endpoint = new URL(`${TMDB_API_BASE_URL}/${segment}/${candidate.tmdbId}`);
        if (tmdbKey) endpoint.searchParams.set("api_key", tmdbKey);

        const response = await fetchImpl(endpoint, {
          headers: tmdbToken
            ? { Accept: "application/json", Authorization: `Bearer ${tmdbToken}` }
            : { Accept: "application/json" },
          signal: request.signal,
          next: { revalidate: 86400 },
        });
        if (!response.ok) { // one missing title must not fail the whole pass
          if (response.status === 404) misses.push(candidate.workId);
          continue;
        }

        results.push({
          workId: candidate.workId,
          tmdb_id: candidate.tmdbId,
          ...artworkFromTmdb(await response.json()),
        });
      }

      const updates = artworkUpdates(results);
      if (dryRun) {
        return Response.json(
          { dry_run: true, checked: works.length, found: updates.length, misses: misses.length, updates },
          { headers: noStoreHeaders },
        );
      }
      const saved = updates.length > 0 ? await writer.saveArtwork(updates) : 0;
      if (writer.markChecked) await writer.markChecked(misses);

      return Response.json(
        {
          checked: works.length,
          enriched: saved,
          with_poster: updates.filter((row) => row.poster_path).length,
          skipped: works.length - saved,
          not_on_tmdb: misses.length,
        },
        { headers: noStoreHeaders },
      );
    } catch (error) {
      logError("Artwork enrichment failed", { message: error?.message });
      return jsonError("Could not enrich artwork", 502);
    }
  };
}

export const POST = createArtworkEnrichHandler();
