// Street addresses → points, through OpenStreetMap's Nominatim. Pure helpers; the
// network half is scripts/geocode-addresses.mjs.
//
// Wikidata places a landmark by name, but "322 16th Street SW, Albuquerque" (Jesse
// Pinkman's house) is no entity at all. Nominatim knows the house. It does not know
// "Jesse Pinkman's house, 322 16th Street SW", so the address is asked on its own first,
// and the name only with the area around it.
//
// The usage policy is one request a second, a real User-Agent, and no bulk dumps, so
// the script asks at most a few questions per row and waits between them.

export const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";
export const NOMINATIM_LICENSE = "ODbL-1.0";
export const NOMINATIM_GAP_MS = 1100;

// Results that name an area rather than a spot. A pin at a city's centroid looks
// exactly like a pin at a door, which is why it is refused rather than kept as "close".
const AREA_TYPES = new Set([
  "country", "state", "region", "province", "county", "state_district", "municipality",
  "city", "town", "village", "hamlet", "city_district", "district", "borough", "suburb",
  "quarter", "neighbourhood", "postcode", "island", "archipelago", "continent",
]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// "Twisters (Los Pollos Hermanos exterior)" → "Twisters": the bracket is our caption.
export function bareName(name) {
  return clean(name).replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// The questions to ask for one row, most specific first. An area hint that starts with
// a house number is an address; one that does not is only the area around the name.
export function queriesFor(row) {
  const name = bareName(row?.place_name);
  const hint = clean(row?.area_hint);
  const parts = hint.split(",").map(clean).filter(Boolean);
  const hasAddress = parts.length > 1 && /\d/.test(parts[0]);
  const around = hasAddress ? parts.slice(1).join(", ") : hint;
  const queries = [];
  if (hasAddress) queries.push(hint);
  if (name && around) queries.push(`${name}, ${around}`);
  return [...new Set(queries)];
}

// The first result that is a spot, and only when the results do not disagree about
// where the thing is. Returns { point } or { refused }.
export const SPREAD_KM = 5;

function km(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function chooseResult(results) {
  const list = (Array.isArray(results) ? results : [])
    .map((r) => ({ ...r, lat: Number(r?.lat), lng: Number(r?.lon) }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  if (!list.length) return { refused: "no_result" };
  const spots = list.filter((r) => !AREA_TYPES.has(String(r.addresstype ?? r.type ?? "")));
  if (!spots.length) return { refused: "area_not_a_spot" };
  const [best] = spots;
  // Two "Union Station"s in one answer: the name is a homonym and the first is a guess.
  if (spots.some((r) => km(best, r) > SPREAD_KM)) return { refused: "results_disagree" };
  return {
    point: {
      lat: best.lat,
      lng: best.lng,
      sourceId: best.osm_type && best.osm_id ? `${best.osm_type}/${best.osm_id}` : null,
      kind: String(best.addresstype ?? best.type ?? "place"),
    },
  };
}

// The patch for a row that got a point.
export function geocodePatch(point, queryIndex) {
  return {
    lat: point.lat,
    lng: point.lng,
    geocode_source: "nominatim",
    geocode_source_id: point.sourceId,
    geocode_license: NOMINATIM_LICENSE,
    geocode_reason: `nominatim_${queryIndex === 0 ? "first" : "fallback"}_query_${point.kind}`,
  };
}
