import { zoomForBoundingBox } from "../../lib/city-search.mjs";
import { cityRadiusKm, isWikidataId } from "../../lib/location-search.mjs";
import { USER_AGENT } from "../../lib/user-agent.mjs";
import { upstreamFailed } from "../../lib/upstream-error.mjs";

export const runtime = "nodejs";

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

export async function GET(request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query || query.length > 80) {
    return Response.json({ error: "Enter a city name up to 80 characters" }, { status: 400 });
  }

  const endpoint = new URL(NOMINATIM_ENDPOINT);
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("addressdetails", "1");
  endpoint.searchParams.set("extratags", "1");
  endpoint.searchParams.set("limit", "5");

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en",
        "User-Agent": USER_AGENT,
      },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error(`Nominatim responded with ${response.status}`);

    const results = await response.json();
    const isSettlement = (result) =>
      ["city", "town", "village", "municipality", "administrative"].includes(result?.addresstype);
    const city = results.find(isSettlement) ?? results[0];
    const lat = Number(city?.lat);
    const lng = Number(city?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return Response.json({ error: "City not found" }, { status: 404 });
    }

    const boundingBox = city.boundingbox?.map(Number);
    const radiusKm = cityRadiusKm({ lat, lng, boundingBox });
    const wikidataId = city.extratags?.wikidata;
    // A street or an address is named as itself. Naming it by its city turned
    // "Abbey Road" into "London" in the status line, as if the lookup had missed.
    // A house has no name of its own: "12 Fournier Street" is its number and its road.
    const address = [city.address?.house_number, city.address?.road].filter(Boolean).join(" ");
    const name = !isSettlement(city)
      ? (city.name || address || String(city.display_name ?? query).split(",")[0])
      : city.address?.city
      ?? city.address?.town
      ?? city.address?.village
      ?? city.address?.municipality
      ?? String(city.display_name ?? query).split(",")[0];

    return Response.json(
      {
        name,
        lat,
        lng,
        radius_km: radiusKm,
        zoom: zoomForBoundingBox(boundingBox),
        bounding_box: boundingBox,
        wikidata_id: isWikidataId(wikidataId) ? wikidataId : null,
      },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (error) {
    console.error("City search failed", error);
    return upstreamFailed(error, { timeoutMessage: "City search timed out", failureMessage: "Unable to search for a city" });
  }
}
