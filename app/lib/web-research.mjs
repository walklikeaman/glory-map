// Filming locations researched on the open web, one work at a time: fan sites, location
// blogs, fan wikis, tourism pages. The model searches and reads; this module decides what
// it is allowed to send back and what a row in `location_submissions` may say.
//
// Everything found lands as `pending` under source_kind `web_research`, which the map
// draws as "Unconfirmed" and the review can promote when a second source agrees. One web
// page saying so is a lead, not a fact (Nikita, 13.11: keep every point, mark the
// unconfirmed ones as unconfirmed).

import { finiteOrNull } from "./numbers.mjs";

export const SOURCE_KIND = "web_research";
// A page somebody else wrote, quoted in one sentence with a link back. The licence of the
// page itself is unknown; what we store is a short factual claim and its address.
export const SOURCE_LICENSE = "quotation with link (fact, not copied text)";
export const MAX_QUOTE = 300;
export const MAX_LOCATIONS = 40;

// Prices for the run's spend guard (claude-haiku-5-5, 2026-11). Web search is billed per
// search; web fetch only through the tokens it adds.
export const PRICES = Object.freeze({
  "claude-haiku-5-5": { input: 0.10, output: 0.50 },
  "claude-sonnet-5-5": { input: 2.00, output: 10.00 },
});
export const PER_SEARCH = 0.01;

export function costOf(usage, model) {
  const price = PRICES[model] ?? PRICES["claude-sonnet-5-5"];
  const input = (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0)
    + (usage?.cache_read_input_tokens ?? 0) * 0.1;
  const output = usage?.output_tokens ?? 0;
  const searches = usage?.server_tool_use?.web_search_requests ?? 0;
  return (input * price.input + output * price.output) / 1e6 + searches * PER_SEARCH;
}

export const SYSTEM = `You research where films and TV series were filmed, for a map people walk with.
Search the web: fan sites, location blogs (movie-locations.com, reelstreets, filmaps, atlas of wonders,
travel and tourism boards), fan wikis, news about the shoot, and the work's Wikipedia article.
Report only real places a person could stand at. A city, region or country alone is not a location;
a studio sound stage is only worth listing if it is named. Never invent: every location needs the URL
of a page you actually read or saw in results that says it was filmed there.
Give coordinates only when a page you read gives them or the place is a well-known landmark whose
position you are sure of; otherwise leave lat and lng null.
Do not narrate your searches. Answer with one JSON object in a \`\`\`json fence, nothing before it but one line, nothing after it:
{"locations":[{"place_name":"","address":"","city":"","country":"","lat":null,"lng":null,
"scene":"what was filmed there, one sentence","source_url":"","quote":"short quote from that page"}]}`;

export function userPrompt(work, knownNames = []) {
  const kind = work.kind === "series" ? "TV series" : work.kind === "book" ? "book" : "film";
  const ids = [work.imdb_id && `IMDb ${work.imdb_id}`, work.wikidata_id && `Wikidata ${work.wikidata_id}`]
    .filter(Boolean).join(", ");
  const known = knownNames.slice(0, 120);
  return [
    `Find the filming locations of the ${kind} "${work.title}"${work.year ? ` (${work.year})` : ""}${ids ? ` [${ids}]` : ""}.`,
    known.length
      ? `We already list these, so prioritise places NOT in this list, but you may confirm a listed one if a new source names it: ${known.join("; ")}.`
      : "We list no locations for it yet.",
    `Up to ${MAX_LOCATIONS} locations, the best-documented first.`,
  ].join("\n");
}

// The last ```json fence, or the outermost {...}, of the model's text.
export function extractJson(text) {
  const source = String(text ?? "");
  const fences = [...source.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const candidates = fences.length ? [fences.at(-1)[1]] : [];
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(source.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next shape
    }
  }
  return null;
}

const AREA_ONLY = /^(the )?(city|town|village|region|county|state|province|country) of /i;

function cleanText(value, limit = 200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// What a returned location must carry to be kept, and the cleaned shape it is kept in.
// Returns { location } or { refused: reason }.
export function checkLocation(raw) {
  const place_name = cleanText(raw?.place_name, 160);
  if (!place_name || !/\p{L}/u.test(place_name)) return { refused: "no_name" };
  if (AREA_ONLY.test(place_name)) return { refused: "area_not_a_spot" };
  const city = cleanText(raw?.city, 80);
  const country = cleanText(raw?.country, 80);
  // "Dubrovnik" for a work filmed all over Dubrovnik names the city, not a spot in it.
  if ([city, country].some((area) => area && area.toLowerCase() === place_name.toLowerCase())) {
    return { refused: "area_not_a_spot" };
  }
  if (!isHttpUrl(raw?.source_url)) return { refused: "no_source_url" };
  // The row has to say what the page said; the table refuses a web_research row without
  // a sentence of at least ten characters, and so does this.
  if (`${cleanText(raw?.scene)} ${cleanText(raw?.quote)}`.trim().length < 10) return { refused: "no_sentence" };
  let lat = finiteOrNull(raw?.lat);
  let lng = finiteOrNull(raw?.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    lat = null;
    lng = null;
  }
  return {
    location: {
      place_name,
      address: cleanText(raw?.address, 200),
      city,
      country,
      lat,
      lng,
      scene: cleanText(raw?.scene, 300),
      source_url: String(raw.source_url).trim(),
      quote: cleanText(raw?.quote, MAX_QUOTE),
    },
  };
}

export function parseResearch(text) {
  const parsed = extractJson(text);
  const list = Array.isArray(parsed?.locations) ? parsed.locations.slice(0, MAX_LOCATIONS) : null;
  if (!list) return { ok: false, reason: "no_json", locations: [], refused: {} };
  const locations = [];
  const refused = {};
  const seen = new Set();
  for (const raw of list) {
    const { location, refused: why } = checkLocation(raw);
    if (why) {
      refused[why] = (refused[why] ?? 0) + 1;
      continue;
    }
    const key = location.place_name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push(location);
  }
  return { ok: true, locations, refused };
}

export function areaHint(location) {
  return [location.address, location.city, location.country].filter(Boolean).join(", ") || null;
}

function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "a web page";
  }
}

// One `location_submissions` row. `point` is the coordinate the caller settled on
// (gazetteer first, the model's own only when it sits near the named city), with its
// source and reason, or null.
export function submissionRow(work, location, point) {
  const sentence = [location.scene, location.quote && `"${location.quote}"`].filter(Boolean).join(" ");
  return {
    work_id: work.id,
    place_name: location.place_name,
    area_hint: areaHint(location),
    source_sentence: sentence || null,
    source_title: host(location.source_url),
    source_url: location.source_url,
    source_license: SOURCE_LICENSE,
    source_kind: SOURCE_KIND,
    relation_kind: "filming_location",
    ...(point
      ? {
        lat: point.lat,
        lng: point.lng,
        geocode_source: point.source,
        geocode_source_id: point.sourceId ?? null,
        geocode_reason: point.reason,
      }
      : { geocode_reason: "no_point_from_research" }),
  };
}

// Distance in km, for the check that the model's coordinate is in the city it named.
export function kmBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export const MODEL_POINT_MAX_KM = 40;

// The coordinate a row gets. The gazetteer's answer for the place itself wins (when it
// sits in the named city). The
// model's own coordinate is kept only when the gazetteer places the named city within
// MODEL_POINT_MAX_KM of it, so a confident wrong number cannot land on another continent.
export function choosePoint(location, { placeHit = null, cityHit = null } = {}) {
  // A gazetteer hit is a name match, and "Union Station" exists in forty cities: when we
  // know the city, the hit has to be in it.
  if (placeHit && (!cityHit || kmBetween(placeHit, cityHit) <= MODEL_POINT_MAX_KM)) {
    return { lat: placeHit.lat, lng: placeHit.lng, source: "wikidata", sourceId: placeHit.wikidata_id ?? null, reason: "gazetteer_place" };
  }
  if (location.lat === null || location.lng === null) return null;
  if (!cityHit) return null;
  const km = kmBetween(location, cityHit);
  if (km > MODEL_POINT_MAX_KM) return null;
  return { lat: location.lat, lng: location.lng, source: SOURCE_KIND, sourceId: null, reason: `model_point_within_${Math.ceil(km)}km_of_city` };
}
