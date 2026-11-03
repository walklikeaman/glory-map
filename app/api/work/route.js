// The film profile (#107, #110): one work, everything we can say about it.
//
// Keyed by TMDB id rather than by our own uuid, because the film chips people click
// come from the LIVE Wikidata path and most of those works are not in our graph at
// all. A work we hold gets its places and ratings; one we do not still gets a poster,
// its stills and its external links, instead of an empty page.

import { createClient } from "@supabase/supabase-js";

import {
  MAX_PROFILE_STILLS,
  parseProfileQuery,
  placeTally,
  profilePlaces,
  profileRatings,
  sourceLinks,
} from "../../lib/work-profile.mjs";
import { selectWorkCandidates } from "../../lib/submission-places.mjs";
import { posterUrlFor, POSTER_SIZES } from "../../lib/work-artwork.mjs";
import { selectTmdbBackdrops, tmdbImageUrl, tmdbUrlForSurface } from "../../lib/tmdb-images.mjs";

export const runtime = "nodejs";

// A profile is opened deliberately and its contents barely change, so it may be
// cached hard. Nothing in it is user-specific.
const cacheHeaders = { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" };
const noStoreHeaders = { "Cache-Control": "private, no-store" };

export const TMDB_TIMEOUT_MS = 4000;
const TMDB_PATH = Object.freeze({ film: "movie", series: "tv" });

function defaultCreateStore(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const client = createClient(url, key, { auth: { persistSession: false } });
  return {
    async loadWork(query) {
      const columns = "id, title, kind, year, tmdb_id, imdb_id, wikidata_id, poster_path, backdrop_path, rt_path, mc_path";
      const builder = query.workId
        ? client.from("works").select(columns).eq("id", query.workId)
        : client.from("works").select(columns).eq("tmdb_id", String(query.tmdbId)).eq("kind", query.kind);
      const { data, error } = await builder.maybeSingle();
      if (error) throw new Error(`work load failed: ${error.message}`);
      return data;
    },
    async loadRatings(workId) {
      const { data, error } = await client
        .from("work_ratings")
        .select("source, score, display, votes, source_url")
        .eq("work_id", workId);
      if (error) throw new Error(`ratings load failed: ${error.message}`);
      return data ?? [];
    },
    // Verdicts from /api/enrich/stills. Present means the gallery has been looked at;
    // absent means it has not, and the caller must say so rather than imply it has.
    async loadClassifiedImages(workId) {
      const { data, error } = await client
        .from("work_images")
        .select("file_path, is_frame, width, height")
        .eq("work_id", workId);
      if (error) throw new Error(`images load failed: ${error.message}`);
      return data ?? [];
    },
    // Tier A: frames matched to a specific place, each carrying the evidence that
    // justified the claim.
    async loadPlaceFrames(workId) {
      const { data, error } = await client
        .from("place_frames")
        .select("place_id, file_path, evidence")
        .eq("work_id", workId);
      if (error) throw new Error(`place frames load failed: ${error.message}`);
      return data ?? [];
    },
    // One call for the whole card (#129). `work_facts` returns the work's own facts AND
    // the facts of the people who made it, each with the place it happened at, the
    // sentence the source stated, and how many degrees it stands from this work.
    //
    // It replaces a join on work_place_links, which by construction could only ever
    // return facts filed against the work — so "the director lived here" was reachable
    // only by copying it onto every film they made, and nobody did.
    async loadPlaces(workId) {
      const { data, error } = await client.rpc("work_facts", { p_work_id: workId });
      if (error) throw new Error(`places load failed: ${error.message}`);
      return data ?? [];
    },
    // The review queue for this work (#158). Measured 18.08: the graph holds 92 facts
    // across 15 works while the catalogue the directory is built on holds 6,392, so
    // without this the directory led 6,378 of its rows to a card saying "No places
    // recorded". These arrive as CANDIDATES and stay out of the graph — the map has
    // shown them on those terms since 05.08.
    //
    // NOT REJECTED rather than PENDING: filtering on `pending` once meant believing a
    // row a reviewer had already thrown out. Ordered so a card is deterministic, and
    // capped well above what a card prints so the cap never decides the content.
    async loadCandidates(workId) {
      // `count: "exact"` rides on the same request — PostgREST answers the total in
      // Content-Range while returning only the limited rows. It is here so the card can
      // say "60 of 62" rather than printing its own display cap as if it were the
      // number we hold: Person of Interest alone has 961 rows.
      const { data, count, error } = await client
        .from("location_submissions")
        .select(
          "id, place_name, area_hint, source_sentence, source_kind, source_url, status, status_reason, lat, lng",
          { count: "exact" },
        )
        .eq("work_id", workId)
        .neq("status", "rejected")
        // A row without a coordinate used to be dropped here, and the card is a LIST, not
        // a map: a name, a sentence and a link to whoever said it are all readable without
        // a point. Measured 10.09: 10,981 unlocated rows across 1,506 works, and **562 of
        // those works had nothing else** — so 562 cards said "No places recorded for this
        // work yet" about works we hold rows for. The map path filters on a coordinate on
        // its own, where it genuinely needs one.
        //
        // Located rows lead, so the 200 this fetches — and the 60 the card prints — are
        // the mappable ones first rather than whatever sorted alphabetically.
        .order("lat", { ascending: true, nullsFirst: false })
        .order("place_name", { ascending: true })
        .limit(200);
      if (error) throw new Error(`candidates load failed: ${error.message}`);
      return { rows: data ?? [], total: count ?? (data?.length ?? 0) };
    },
  };
}

// TMDB's "backdrops" mix two different things: photographic frames from the film and
// promotional key art — gun-barrel silhouettes, title treatments, cast montages.
//
// This drops images with text baked in, which TMDB marks with a language code. It
// helps, but it is NOT the separation we want, and Skyfall proves it: its gun-barrel
// art and its title card both come back with `iso_639_1: null` and survive untouched.
// A silhouette genuinely has no text — it is simply not a frame from the film. That
// is a semantic distinction, and no metadata field carries it.
//
// The real separation is the vision check the scene matcher already performs
// (`isPhotographicFrame` / `hasProminentTitleOrLogo` in scene-image-match.mjs). Until
// that runs here, the caption says what these images actually are rather than
// promising frames we have not verified.
export function textlessBackdrops(backdrops) {
  const all = Array.isArray(backdrops) ? backdrops : [];
  const textless = all.filter((image) => !image?.iso_639_1);
  return textless.length > 0 ? textless : all;
}

// Frames from the film. Tier B in the stills policy: these are real production
// images, but nothing has verified WHICH place any of them shows, so they are
// presented as belonging to the film and never pinned to a location.
async function stillsFromTmdb({ kind, tmdbId }, { env, fetchImpl, timeoutMs, logError }) {
  const path = TMDB_PATH[kind];
  const token = env.TMDB_API_READ_ACCESS_TOKEN;
  const apiKey = env.TMDB_API_KEY;
  if (!path || (!token && !apiKey)) return [];

  const attempts = [];
  if (token) {
    attempts.push({
      url: `https://api.themoviedb.org/3/${path}/${tmdbId}/images`,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
  }
  if (apiKey) {
    attempts.push({
      url: `https://api.themoviedb.org/3/${path}/${tmdbId}/images?api_key=${encodeURIComponent(apiKey)}`,
      headers: { Accept: "application/json" },
    });
  }

  for (const attempt of attempts) {
    try {
      const response = await fetchImpl(attempt.url, {
        headers: attempt.headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response?.ok) {
        const payload = await response.json();
        return selectTmdbBackdrops(textlessBackdrops(payload?.backdrops), MAX_PROFILE_STILLS)
          .map((image) => ({
            // The grid column never exceeds ~190 CSS px on either surface that renders
            // it, not 780 (#198). `full` is the link the caption offers, not something
            // the grid loads.
            url: tmdbUrlForSurface(image.file_path, "workStill"),
            full: tmdbImageUrl(image.file_path, "original"),
            width: image.width ?? null,
            height: image.height ?? null,
          }))
          .filter((still) => still.url);
      }
      // Same lesson as /api/artwork: the two credential schemes are not
      // interchangeable, so a rejected one is worth retrying with the other.
      if (response?.status !== 401 && response?.status !== 403) break;
    } catch (error) {
      logError(`work: stills lookup failed for ${kind}/${tmdbId}`, error);
      break;
    }
  }
  return [];
}

export function createWorkProfileHandler({
  env = process.env,
  createStore = defaultCreateStore,
  fetchImpl = fetch,
  timeoutMs = TMDB_TIMEOUT_MS,
  logError = console.error,
} = {}) {
  return async function GET(request) {
    const query = parseProfileQuery(new URL(request.url).searchParams);
    if (!query) {
      return Response.json(
        { error: "Provide film=<tmdbId>, series=<tmdbId> or id=<uuid>" },
        { status: 400 },
      );
    }

    const store = createStore(env);
    let work = null;
    let ratings = [];
    let places = [];
    let classified = [];
    let placeFrames = [];
    let submissions = { rows: [], total: 0 };
    let graphFailed = false;

    if (store) {
      try {
        work = await store.loadWork(query);
        if (work) {
          [ratings, places, classified, placeFrames, submissions] = await Promise.all([
            store.loadRatings(work.id),
            store.loadPlaces(work.id),
            store.loadClassifiedImages(work.id),
            store.loadPlaceFrames(work.id),
            // A store written before #158 has no loadCandidates. An older injected store
            // should lose the candidates block, not the whole card.
            store.loadCandidates ? store.loadCandidates(work.id) : { rows: [], total: 0 },
          ]);
        }
      } catch (error) {
        // A profile without our own data is thin but still useful; failing the whole
        // page because one join broke would be worse than showing the stills.
        logError("work: graph load failed", error);
        graphFailed = true;
      }
    }

    // Addressed by uuid, the kind and TMDB id are only known once the row is loaded.
    const stillsKey = {
      kind: query.kind ?? work?.kind ?? null,
      tmdbId: query.tmdbId ?? work?.tmdb_id ?? null,
    };
    // The switch is "has this gallery been looked at", NOT "did we find frames". A
    // film judged to be entirely promotional shows nothing — falling back there would
    // display the exact art the classifier just rejected and quietly undo the check we
    // paid for. Only a film nobody has judged falls back to the raw list.
    const verified = classified.filter((row) => row.is_frame);
    const stills = classified.length > 0
      ? verified
        .map((row) => ({
          url: tmdbUrlForSurface(row.file_path, "workStill"),
          full: tmdbImageUrl(row.file_path, "original"),
          width: row.width ?? null,
          height: row.height ?? null,
        }))
        .filter((still) => still.url)
        .slice(0, MAX_PROFILE_STILLS)
      : stillsKey.tmdbId
        ? await stillsFromTmdb(stillsKey, { env, fetchImpl, timeoutMs, logError })
        : [];

    // The caption has to match which of those two happened.
    const stillsVerified = classified.length > 0;
    // A matched frame belongs to its place, not to the gallery: this is the one
    // context where a frame IS a claim about where something happened.
    const frameByPlace = new Map(placeFrames.map((row) => [row.place_id, row]));
    const summarised = profilePlaces(places).map((place) => {
      const frame = frameByPlace.get(place.id);
      return frame
        ? {
          ...place,
          scene_frame: {
            // .place-scene-frame is 84x47, 64x36 on a phone (#198).
            url: tmdbUrlForSurface(frame.file_path, "placeSceneFrame"),
            full: tmdbImageUrl(frame.file_path, "original"),
            evidence: frame.evidence,
          },
        }
        : place;
    });

    // A card built around a failed read says "no places" about a work that has them.
    // Served once that is a blip; cached publicly for an hour it is an hour of every
    // reader being told the work has nothing — measured on the live check, a blocked
    // read came back 200 with `places: []` under `public, max-age=3600`.
    return Response.json({
      work: {
        // Our own id, and the card page needs it: a TMDB id addresses a film on TMDB,
        // not a work in this graph, and the permanent link has to point at ours.
        id: work?.id ?? null,
        title: work?.title ?? null,
        kind: stillsKey.kind,
        year: work?.year ?? null,
        tmdb_id: stillsKey.tmdbId,
        imdb_id: work?.imdb_id ?? null,
        wikidata_id: work?.wikidata_id ?? null,
        // .work-profile-poster is 76 px wide, 56 on a phone (#198).
        poster: posterUrlFor(work?.poster_path, "workProfilePoster"),
        in_graph: Boolean(work),
      },
      links: sourceLinks({ ...work, kind: stillsKey.kind, tmdb_id: stillsKey.tmdbId }),
      ratings: profileRatings(ratings),
      places: summarised,
      tally: placeTally(summarised),
      // Kept out of `places` on purpose. A fact has an identity, a subject and a degree
      // of separation; a queue row has none of those, and giving it a distance would put
      // it in a block beside things we checked.
      candidates: selectWorkCandidates(submissions?.rows ?? submissions, { work }),
      // What the queue holds, not what this page prints. Without it the card stated its
      // own display cap as a count — "60 unverified candidates" for a work with 62.
      candidates_total: submissions?.total ?? (Array.isArray(submissions) ? submissions.length : 0),
      stills,
      stills_verified: stillsVerified,
      // The caption states exactly which of the two cases this is. Promising verified
      // frames when nothing has looked at them would be the same class of mistake as
      // pinning an unmatched frame to a street.
      stills_note: stillsVerified
        ? "Frames from the film, checked one by one. Not matched to any location."
        : "From the film's image gallery — includes promotional art. Not matched to any location.",
    }, { headers: graphFailed ? noStoreHeaders : cacheHeaders });
  };
}

export const GET = createWorkProfileHandler();
