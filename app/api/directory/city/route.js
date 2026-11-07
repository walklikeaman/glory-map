// One city page's data (#158): the films we hold a place for within its radius.
//
// The slug resolves against the committed gazetteer and never against the database. That
// is what stops /city/anything from becoming a query: an unknown slug is a 404 decided in
// this process, so a stranger cannot make us scan the queue by inventing city names.

import { createClient } from "@supabase/supabase-js";

import { CITY_RADIUS_KM, findCity } from "../../../lib/city-gazetteer.mjs";
import { CITY_WORKS_PER_PAGE, paginate } from "../../../lib/directory.mjs";

export const runtime = "nodejs";

const cacheHeaders = { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" };
const noStoreHeaders = { "Cache-Control": "private, no-store" };

function defaultCreateReader(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  return {
    async loadCity({ lat, lng, radiusKm, limit, offset }) {
      const { data, error } = await client.rpc("city_catalogue", {
        p_lat: lat,
        p_lng: lng,
        p_radius_km: radiusKm,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw new Error(`city_catalogue failed: ${error.message}`);
      return data ?? [];
    },
  };
}

export function createDirectoryCityHandler({
  env = process.env,
  createReader,
  perPage = CITY_WORKS_PER_PAGE,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeReader = createReader ?? (() => defaultCreateReader(env));

  return async function GET(request) {
    const params = new URL(request.url).searchParams;
    const city = findCity(params.get("slug"));
    if (!city) {
      return Response.json({ error: "No such city" }, { status: 404, headers: noStoreHeaders });
    }

    const reader = makeReader(env);
    if (!reader) {
      return Response.json({ error: "The directory is not configured" }, { status: 503, headers: noStoreHeaders });
    }

    const radiusKm = city.radius_km ?? CITY_RADIUS_KM;

    try {
      // The total is not known until the first answer arrives — every row carries it as a
      // window count — so the page is requested optimistically and the page number is
      // clamped against the real total afterwards. A page past the end is then re-asked
      // ONCE at the last page rather than shown empty, because an empty page under a link
      // we generated ourselves reads as lost data.
      const requested = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
      let rows = await reader.loadCity({
        lat: city.lat,
        lng: city.lng,
        radiusKm,
        limit: perPage,
        offset: (requested - 1) * perPage,
      });

      const total = rows[0]?.total_works ?? 0;
      const points = rows[0]?.total_points ?? 0;
      let page = paginate({ total, page: requested, perPage });

      if (rows.length === 0 && total === 0 && requested > 1) {
        // Nothing came back, so nothing said how many there are. Ask for the first page to
        // learn whether the city is empty or the page number was simply too high.
        rows = await reader.loadCity({ lat: city.lat, lng: city.lng, radiusKm, limit: perPage, offset: 0 });
        page = paginate({ total: rows[0]?.total_works ?? 0, page: 1, perPage });
      }

      return Response.json(
        {
          city: {
            slug: city.slug,
            name: city.name,
            country: city.country,
            lat: city.lat,
            lng: city.lng,
            radius_km: radiusKm,
            // Where the centre came from, so the page does not claim to have measured it.
            anchor: city.anchor ?? null,
          },
          works: rows.map((row) => ({
            id: row.work_id,
            title: row.title,
            year: row.year,
            kind: row.kind,
            place_count: row.place_count,
            places: row.places ?? [],
          })),
          points: rows[0]?.total_points ?? points,
          page,
        },
        { headers: cacheHeaders },
      );
    } catch (error) {
      logError("directory-city", error);
      return Response.json({ error: "The directory is unavailable" }, { status: 502, headers: noStoreHeaders });
    }
  };
}

export const GET = createDirectoryCityHandler();
