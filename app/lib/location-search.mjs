import { haversineKm } from "./geo.mjs";
import { commonsFileUrl, commonsWidth, SURFACES } from "./image-budget.mjs";

// Every place photo on the map is drawn in one box — the "place today" figure on the
// place card — so every place photo is asked for at that box's size. Before #198 this
// file built the URL twice, at 1200 and at no width at all, and the second one is the
// full original upload: measured, 5.1 MB mean and 7.0 MB at worst, for a figure 192 CSS
// px wide. Fifteen of fifteen places in a central-London viewport carried one.
//
// The desktop box decides the stored URL; a phone, where the figure is the full width of
// the sheet, is served the larger bucket through `commonsSrcSet` at render time. That
// only works because Special:FilePath renders on demand — see image-budget.mjs.
const PLACE_PHOTO_WIDTH = commonsWidth(SURFACES.placePhoto.box);

const WORK_KIND_CONFIG = {
  film: {
    label: "film",
    plural: "films",
    rootType: "Q11424",
    locationProperty: "P915",
    relationKind: "filming_location",
    relationLabel: "Filming location",
  },
  series: {
    label: "series",
    plural: "series",
    rootType: "Q5398426",
    locationProperty: "P915",
    relationKind: "filming_location",
    relationLabel: "Filming location",
  },
  book: {
    label: "book",
    plural: "books",
    rootType: "Q7725634",
    locationProperty: "P840",
    relationKind: "narrative_location",
    relationLabel: "Story setting",
  },
};

// Every kind at once — the answer to "what was shot around here", which is the question
// a visitor arrives with. The panel asked it of FILMS only and never said so: the select
// offered Film / Series / Book and no way to stop choosing, so a first-time reader could
// not see a single series or book location and was never told one existed.
export const EVERY_KIND = "all";
export const WORK_KINDS = Object.freeze(["film", "series", "book"]);

export function workKindConfig(kind) {
  return WORK_KIND_CONFIG[kind] ?? null;
}

export function isEveryKind(kind) {
  return kind === EVERY_KIND;
}

// What to call the set on screen. "works" rather than "films" when all three are drawn,
// because naming one of them is how the panel came to be lying in the first place.
export function workKindLabel(kind, { plural = false } = {}) {
  if (isEveryKind(kind)) return plural ? "works" : "work";
  const config = workKindConfig(kind);
  if (!config) return plural ? "works" : "work";
  return plural ? config.plural : config.label;
}

// What to say about a work that has no filming locations at all.
//
// An empty map does not read as "nobody has recorded where this was shot". It reads as
// "we do not have that film" — which is the one impression this product cannot afford,
// and measured on 24 famous titles it happened to three of them. Two were animation:
// Spirited Away and Parasite carry no P915 because there was nothing to film on location
// (and in Parasite's case the sets were built), but both state where the story is set
// and where they were made.
//
// So the fallback is ordered by how much it claims, weakest last, and each rung says
// plainly what it is. A country is not a stop on a walk — `place-grade` renders it as an
// area — but it is an honest answer, and honest beats blank.
const LOCATION_FALLBACKS = {
  film: [
    { property: "P840", relationKind: "narrative_location", relationLabel: "Story setting" },
    { property: "P495", relationKind: "origin_country", relationLabel: "Country of origin" },
  ],
  series: [
    { property: "P840", relationKind: "narrative_location", relationLabel: "Story setting" },
    { property: "P495", relationKind: "origin_country", relationLabel: "Country of origin" },
  ],
  book: [
    { property: "P495", relationKind: "origin_country", relationLabel: "Country of origin" },
  ],
};

export function locationFallbacks(kind) {
  return LOCATION_FALLBACKS[kind] ?? [];
}

export function isWorkKind(kind) {
  return isEveryKind(kind) || Boolean(workKindConfig(kind));
}

export function isWikidataId(value) {
  return /^Q\d+$/.test(value ?? "");
}

export function numberInRange(value, fallback, { min, max }) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function wikidataId(uri) {
  return uri?.match(/Q\d+$/)?.[0] ?? null;
}

export function coordinates(wkt) {
  const match = wkt?.match(/^Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/);
  return match ? { lng: Number(match[1]), lat: Number(match[2]) } : null;
}

function releaseYear(value) {
  return Number(value?.match(/^([+-]?\d{1,6})-/)?.[1]) || null;
}

function isPlaceholderLabel(value) {
  return /^Q\d+(?:\s|$)/.test(value?.trim() ?? "");
}

// One branch per kind, each binding the kind it matched so the row can be labelled with
// the right relation afterwards — a filming location and a story setting are different
// claims and the UNION must not blur them.
//
// **Each branch carries its OWN limit**, and that is the whole point. A single LIMIT over
// the union is spent in branch order: measured against the live endpoint over London, 60
// rows came back and **all 60 were films** — series and books were starved by the cap, so
// "every kind" would have drawn exactly what "film" already drew while claiming more.
//
// Measured after the split: 0.5–1.9 s for the same 60 rows, the same order as the
// single-kind query it replaces.
function everyKindPattern({ lat, lng, radius, perKind, excludedLocation }) {
  return WORK_KINDS.map((kind) => {
    const config = WORK_KIND_CONFIG[kind];
    return `    {
      SELECT DISTINCT ?work ?location ?coord ?workKind WHERE {
        SERVICE wikibase:around {
          ?location wdt:P625 ?coord .
          bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral .
          bd:serviceParam wikibase:radius "${radius}" .
        }
        ?work wdt:P31/wdt:P279* wd:${config.rootType} ;
              wdt:${config.locationProperty} ?location .${excludedLocation}
        BIND("${kind}" AS ?workKind)
      }
      LIMIT ${perKind}
    }`;
  }).join("\n    UNION\n");
}

function coreLocationPattern({ lat, lng, radius, workIds, config, excludeLocationId, everyKind = false, perKindLimit = 60 }) {
  const instancePattern = everyKind ? null
    : (workIds?.length || config.label !== "film"
      ? `wdt:P31/wdt:P279* wd:${config.rootType}`
      : `wdt:P31 wd:${config.rootType}`);

  if (workIds?.length) {
    const values = workIds.map((id) => `wd:${id}`).join(" ");
    return `
      VALUES ?work { ${values} }
      ?work ${instancePattern} ;
            wdt:${config.locationProperty} ?location .
      ?location wdt:P625 ?coord .`;
  }

  const excludedLocation = isWikidataId(excludeLocationId)
    ? `\n      FILTER(?location != wd:${excludeLocationId})`
    : "";

  const around = `
      SERVICE wikibase:around {
        ?location wdt:P625 ?coord .
        bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral .
        bd:serviceParam wikibase:radius "${radius}" .
      }`;

  if (everyKind) {
    // The FULL budget to each branch, not a third each. Splitting it starved the result
    // twice over: measured on London, a 20-row film branch ranked so thinly that the
    // merged list came back with 5 places where the film-only query returned 11. Each
    // kind is asked the same question the single-kind query asks, and the merge happens
    // after — three independent subqueries, ~3× the work of one, still under two seconds.
    return everyKindPattern({ lat, lng, radius, excludedLocation, perKind: perKindLimit });
  }

  return `${around}
      ?work ${instancePattern} ;
            wdt:${config.locationProperty} ?location .${excludedLocation}`;
}

// The label language is "en,mul", NOT "en,ru".
//
// It asked for Russian as the fallback, which is what put "Форрест Гамп" on an otherwise
// English card: the label service walks the list in order, so any entity without an English
// label fell through to Russian. Every other query in this project asks for "en" alone;
// this one was the outlier. "mul" is Wikidata's language-agnostic label, added for exactly
// this — a proper name that is the same in every language, which is a better fallback than
// a translation into somebody else's.
//
// This is a DISPLAY preference, not a filter, and the distinction is the owner's rule
// (11.09): the interface is English for now and will offer other languages later, so
// nothing may DISCARD non-English text. Where a source wrote in its own language that
// wording is the original and is kept verbatim — the 15 Cyrillic sentences in the queue are
// somebody's actual words about a place, and stripping them would throw away evidence to
// tidy a page. This only says which label to ASK Wikidata for.
export function buildLocationsSparql({
  lat,
  lng,
  radius,
  sourceLimit,
  kind,
  workIds = [],
  excludeLocationId = null,
}) {
  const everyKind = isEveryKind(kind);
  const config = everyKind ? null : workKindConfig(kind);
  if (!everyKind && !config) throw new Error(`Unsupported work kind: ${kind}`);
  // A title search names ONE work, and a work is of one kind — so "every kind" is a
  // question about an AREA and nothing else.
  if (everyKind && workIds.length) throw new Error("A work list has a kind of its own");
  if (workIds.some((id) => !isWikidataId(id))) throw new Error("Invalid Wikidata work id");

  const core = coreLocationPattern({
    lat,
    lng,
    radius,
    workIds,
    config,
    excludeLocationId,
    everyKind,
    perKindLimit: sourceLimit,
  });

  // `?types` is what a place IS, and it decides whether the place may be a pin at all
  // ([[three-axes]]). GROUP_CONCAT rather than SAMPLE, because a place carries several
  // P31s and SAMPLE picks one at random: the Isle of Skye is an island AND a place with
  // a Council area, and grading it on whichever arrives first is a coin toss over
  // whether it appears as a dot you could stand on.
  // `?workKind` rides through the subquery so each row knows which branch matched it.
  const kindColumn = everyKind ? " ?workKind" : "";

  return `
SELECT ?work ?workLabel ?location ?locationLabel ?coord ?locationDescription${kindColumn}
       (MIN(?date) AS ?releaseDate)
       (SAMPLE(?placeImage) AS ?image)
       (SAMPLE(?tmdb) AS ?tmdbId)
       (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?types)
WHERE {
  {
    SELECT DISTINCT ?work ?location ?coord${kindColumn} WHERE {${core}
    }
    LIMIT ${everyKind ? sourceLimit * WORK_KINDS.length : sourceLimit}
  }
  OPTIONAL { ?work wdt:P577 ?date . }
  OPTIONAL { ?work wdt:P4947 ?tmdb . }
  OPTIONAL { ?location wdt:P18 ?placeImage . }
  OPTIONAL {
    ?location wdt:P31 ?type .
    ?type rdfs:label ?typeLabel .
    FILTER(LANG(?typeLabel) = "en")
  }
  OPTIONAL {
    ?location schema:description ?locationDescription .
    FILTER(LANG(?locationDescription) = "en")
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul" . }
}
GROUP BY ?work ?workLabel ?location ?locationLabel ?coord ?locationDescription${kindColumn}`;
}

// **The nearby question, asked the same way by everyone near the same spot.** The map
// sends its exact centre and a radius from the viewport, so no two pans wrote the same
// SPARQL, and the query service and our fetch cache only ever answer a query text they
// have seen before. Measured on production 11.10: an unseen nearby query took 3–11.5 s,
// the same text again 0.27 s. So the query goes out for a cell: the centre snapped to a
// 0.005° grid (about 550 m) and the radius widened by the distance snapped, then rounded
// up to half a kilometre. The answer is still cut to the exact centre and radius
// afterwards (`locationsWithinRadius`), so the widening adds no place outside the circle
// asked about.
export const NEARBY_CELL_DEGREES = 0.005;
export const NEARBY_RADIUS_STEP_KM = 0.5;

function onGrid(value, step) {
  // toFixed then Number: 51.505000000000003 must print as 51.505, or the text differs.
  return Number((Math.round(value / step) * step).toFixed(6));
}

export function nearbyQueryCell({ lat, lng, radius }) {
  const cellLat = onGrid(lat, NEARBY_CELL_DEGREES);
  const cellLng = onGrid(lng, NEARBY_CELL_DEGREES);
  const drift = haversineKm([lat, lng], [cellLat, cellLng]);
  const steps = Math.ceil((radius + drift) / NEARBY_RADIUS_STEP_KM - 1e-9);
  return {
    lat: cellLat,
    lng: cellLng,
    radius: Number((Math.max(1, steps) * NEARBY_RADIUS_STEP_KM).toFixed(1)),
  };
}

// How many title candidates to consider before deciding which work was meant.
//
// It was 8, and 8 is where the demo breaks. Measured on the live search: "Skyfall"
// returns Adele's song, her lyric video and the soundtrack before the film — the film
// is not in the top eight at all — and "Parasite" returns a parasitology journal, two
// video games and the biological concept. `wbsearchentities` ranks by how well a label
// matches the string, and nothing else.
export const WORK_SEARCH_CANDIDATES = 15;

export function buildWikidataSearchUrl(query, limit = WORK_SEARCH_CANDIDATES) {
  const endpoint = new URL("https://www.wikidata.org/w/api.php");
  endpoint.searchParams.set("action", "wbsearchentities");
  endpoint.searchParams.set("search", query);
  endpoint.searchParams.set("language", "en");
  endpoint.searchParams.set("uselang", "en");
  endpoint.searchParams.set("type", "item");
  endpoint.searchParams.set("limit", String(limit));
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("origin", "*");
  return endpoint;
}

// **When the name is a prefix of everything, ask for the TYPE as well.** `wbsearchentities`
// matches labels by prefix, and "Psycho" begins Psychology, Psychological Medicine,
// Psychotria, Psychodidae and psychosis. Measured 21.09: the fifteen candidates it returns
// for "Psycho" hold not one work — Hitchcock's film is twentieth — so fame ranking had
// nothing to rank and the search answered `matched_work: null`: the film a juror is most
// likely to name when asked for a Hitchcock was not there.
//
// Wikidata's own search takes a type filter. `Psycho haswbstatement:P31=Q11424` returns the
// 1960 film first, in one request to wikidata.org — not to the query service, which spent
// the same day nine hours behind and answering 429. It sees only the three root types
// exactly, so it cannot replace the label search: Spirited Away is an "animated feature
// film", a subclass, and only the label search finds it. So it is the last resort: asked
// in parallel so it costs no waiting, read only when every other way came back empty.
//
// The title is searched as a phrase, with its own double quotes removed: a title is text,
// and an unquoted "-" or a stray keyword would otherwise become search syntax.
export const TYPED_WORK_SEARCH_CANDIDATES = 8;

export function buildTypedWorkSearchUrl(query, limit = TYPED_WORK_SEARCH_CANDIDATES) {
  const text = String(query ?? "").replace(/"/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const types = WORK_KINDS.map((kind) => `P31=${workKindConfig(kind).rootType}`).join("|");
  const endpoint = new URL("https://www.wikidata.org/w/api.php");
  endpoint.searchParams.set("action", "query");
  endpoint.searchParams.set("list", "search");
  endpoint.searchParams.set("srsearch", `"${text}" haswbstatement:${types}`);
  endpoint.searchParams.set("srnamespace", "0");
  endpoint.searchParams.set("srlimit", String(limit));
  endpoint.searchParams.set("srprop", "");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("origin", "*");
  return endpoint;
}

// Q-ids only: this search returns no label, and the entities the route fetches next carry
// one. A candidate without a label is filled in from its entity, never invented.
export function typedMatchesFromSearch(payload) {
  const results = payload?.query?.search;
  if (!Array.isArray(results)) return [];
  return results
    .map((result) => result?.title)
    .filter(isWikidataId)
    .map((id) => ({ id, label: null, description: null }));
}

// **Only the title that was typed.** The typed search ranks by text relevance, not by what
// somebody meant: for "Heat" its first answer was "In the Heat of the Night", a television
// series. As a last resort that is worse than nothing, so this fallback takes a work only if
// its own label IS the title — ignoring case, accents, punctuation and a leading article, so
// "The Godfather" answers "godfather" and "Amélie" answers "Amelie".
function comparableTitle(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(?:the|a|an) /, "");
}

export function labelIsTitle(label, title) {
  const left = comparableTitle(label);
  return left.length > 0 && left === comparableTitle(title);
}

// Which of the candidates is the one somebody meant.
//
// A label match cannot tell "Skyfall the film" from "Skyfall the lyric video", and the
// type check alone does not either — a music video IS a film in Wikidata's hierarchy, so
// the video passes and answers with no filming locations. What separates them is how
// many Wikipedias bothered to write about the thing:
//
//   Skyfall        film 78 · song 36 · soundtrack 9 · literary work 1
//   Parasite       film 81 · the biological concept 46 · video games 14
//   Spirited Away  film 109 · album 4 · a TV episode 2
//
// Measured, all three. The same signal that orders the character fan-out in
// `place-search.mjs`, used here for the question it answers best: of several things
// with one name, which is the famous one.
export function buildWorkFameQuery(ids) {
  const valid = [...new Set(ids ?? [])].filter(isWikidataId);
  if (!valid.length) return null;
  return `SELECT ?item ?sitelinks WHERE {
  VALUES ?item { ${valid.map((id) => `wd:${id}`).join(" ")} }
  OPTIONAL { ?item wikibase:sitelinks ?sitelinks . }
}`;
}

export function fameFromBindings(payload) {
  const fame = new Map();
  for (const row of payload?.results?.bindings ?? []) {
    const id = String(row?.item?.value ?? "").split("/").pop();
    const count = Number(row?.sitelinks?.value);
    if (isWikidataId(id)) fame.set(id, Number.isFinite(count) ? count : 0);
  }
  return fame;
}

// Fame decides the ORDER, never the answer: the type check still has the last word, so
// a famous song can outrank a film in this list and still be refused for not being one.
// A candidate whose count we could not read sorts last rather than first.
export function rankWorksByFame(matches, fame) {
  const counts = fame instanceof Map ? fame : new Map(Object.entries(fame ?? {}));
  return [...(matches ?? [])].sort((left, right) =>
    (counts.get(right.id) ?? 0) - (counts.get(left.id) ?? 0));
}

export function buildWikidataEntitiesUrl(ids) {
  const validIds = [...new Set(ids ?? [])].filter(isWikidataId);
  if (!validIds.length || validIds.length > 50) {
    throw new Error("Wikidata entity requests require between 1 and 50 valid ids");
  }

  const endpoint = new URL("https://www.wikidata.org/w/api.php");
  endpoint.searchParams.set("action", "wbgetentities");
  endpoint.searchParams.set("ids", validIds.join("|"));
  endpoint.searchParams.set("props", "labels|descriptions|claims");
  endpoint.searchParams.set("languages", "en|ru");
  endpoint.searchParams.set("languagefallback", "1");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("origin", "*");
  return endpoint;
}

export function entityClaimValues(entity, property) {
  return (entity?.claims?.[property] ?? [])
    .filter((claim) => claim.rank !== "deprecated")
    .map((claim) => claim.mainsnak?.datavalue?.value)
    .filter((value) => value !== undefined && value !== null);
}

export function entityClaimIds(entity, property) {
  return entityClaimValues(entity, property)
    .map((value) => value?.id)
    .filter(isWikidataId);
}

export function entityText(entity, property) {
  return entity?.[property]?.en?.value
    ?? entity?.[property]?.ru?.value
    ?? null;
}

const EARTH_GLOBE = "http://www.wikidata.org/entity/Q2";

export function entityCoordinate(entity) {
  const value = entityClaimValues(entity, "P625")[0];
  if (!Number.isFinite(value?.latitude) || !Number.isFinite(value?.longitude)) return null;
  // Every P625 states which celestial body it belongs to. The Moon's own coordinate
  // is 0,0 — pinning it on an Earth map puts it in the Gulf of Guinea — and Mars
  // longitudes run 0..360, which no Earth map (or our lat/lng CHECK) accepts.
  if (value.globe && value.globe !== EARTH_GLOBE) return null;
  return {
    lat: value.latitude,
    lng: value.longitude,
    // Wikidata states how precise its own coordinate is, in degrees. Kept so callers
    // never record a precision bucket finer than the source itself claims.
    precisionDeg: Number.isFinite(value.precision) ? value.precision : null,
  };
}

function entityReleaseYear(entity) {
  const value = entityClaimValues(entity, "P577")[0]?.time;
  return releaseYear(value);
}

function entityImageUrl(entity) {
  const filename = entityClaimValues(entity, "P18")[0];
  if (typeof filename !== "string" || !filename.trim()) return null;
  return commonsFileUrl(filename, { width: PLACE_PHOTO_WIDTH });
}

// The SPARQL path states P18 as a bare `Special:FilePath/<file>` URL with no width, which
// is the original. The two paths must agree on the size, so both go through the same
// builder — and a URL that is not a Commons file URL is passed through untouched rather
// than guessed at.
function sparqlImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const filePath = value.match(/\/Special:FilePath\/([^?#]+)/);
  if (!filePath) return value;
  return commonsFileUrl(decodeURIComponent(filePath[1]), { width: PLACE_PHOTO_WIDTH });
}

// Every type reachable from an entity's P31 classes by walking P279* upward through
// the supplied type graph. The walk terminates on `visited`; how far the graph
// reaches is bounded by whatever the caller fetched, not by this function.
// Used for work-kind validation here and for place classification in
// app/lib/location-resolver.mjs.
export function typeAncestry(entity, typeEntities) {
  const graph = typeEntities instanceof Map
    ? typeEntities
    : new Map(Object.entries(typeEntities ?? {}));
  const pending = [...entityClaimIds(entity, "P31")];
  const ancestry = new Set();

  while (pending.length) {
    const typeId = pending.pop();
    if (ancestry.has(typeId)) continue;
    ancestry.add(typeId);
    pending.push(...entityClaimIds(graph.get(typeId), "P279"));
  }

  return ancestry;
}

export function workMatchesTypeGraph(workEntity, typeEntities, kind) {
  return resolveWorkKind(workEntity, typeEntities, kind) !== null;
}

// WHICH kind a work turned out to be. A title search under "every kind" still has to pick
// one, because the rest of the answer — which property holds the places, what the relation
// is called — is a fact about that kind and not about the search.
export function resolveWorkKind(workEntity, typeEntities, kind) {
  const ancestry = typeAncestry(workEntity, typeEntities);
  const candidates = isEveryKind(kind) ? WORK_KINDS : [kind];
  for (const candidate of candidates) {
    const rootType = workKindConfig(candidate)?.rootType;
    if (rootType && ancestry.has(rootType)) return candidate;
  }
  return null;
}

// `via` reads a DIFFERENT property than the kind's own, for a work that has none of its
// own — see `locationFallbacks`. It carries its own relation kind and label so the map
// never presents a country of origin as though somebody filmed there.
export function normalizeWikidataEntityLocations(
  workEntity,
  locationEntities,
  { kind, typeLabels = null, via = null } = {},
) {
  const config = workKindConfig(kind);
  if (!config || !isWikidataId(workEntity?.id)) return [];
  const property = via?.property ?? config.locationProperty;
  const relationKind = via?.relationKind ?? config.relationKind;
  const relationLabel = via?.relationLabel ?? config.relationLabel;

  const entities = locationEntities instanceof Map
    ? locationEntities
    : new Map(Object.entries(locationEntities ?? {}));
  const workTitle = entityText(workEntity, "labels") ?? workEntity.id;
  if (isPlaceholderLabel(workTitle)) return [];
  const workYear = entityReleaseYear(workEntity);

  return entityClaimIds(workEntity, property).flatMap((locationId) => {
    const locationEntity = entities.get(locationId);
    const point = entityCoordinate(locationEntity);
    if (!point) return [];

    const place = entityText(locationEntity, "labels") ?? locationId;
    if (isPlaceholderLabel(place)) return [];
    return [{
      work_wikidata_id: workEntity.id,
      work_title: workTitle,
      work_year: workYear,
      kind,
      loc_wikidata_id: locationId,
      loc_name: place,
      lat: point.lat,
      lng: point.lng,
      commons_image: entityImageUrl(locationEntity),
      film_tmdb_id: kind === "film"
        ? entityClaimValues(workEntity, "P4947")[0] ?? null
        : null,
      relation_kind: relationKind,
      relation_property: property,
      relation_label: relationLabel,
      relation_description: relationDescription({
        workTitle,
        place,
        kind,
        via,
        locationDescription: entityText(locationEntity, "descriptions"),
      }),
      // The entity path knows the place's P31 ids; their labels come from a second
      // batch the caller has already fetched, or not at all — an ungraded place is
      // still a place, and refusing to show it would be the worse mistake.
      place_types: entityClaimIds(locationEntity, "P31")
        .map((typeId) => (typeLabels instanceof Map ? typeLabels.get(typeId) : typeLabels?.[typeId]))
        .filter(Boolean),
      source_url: `https://www.wikidata.org/wiki/${locationId}`,
    }];
  });
}

export function distanceKm(first, second) {
  return haversineKm([first.lat, first.lng], [second.lat, second.lng]);
}

export function cityRadiusKm({ lat, lng, boundingBox }) {
  if (!Array.isArray(boundingBox) || boundingBox.length !== 4) return 15;
  const [south, north, west, east] = boundingBox.map(Number);
  if (![south, north, west, east].every(Number.isFinite)) return 15;

  const center = { lat, lng };
  const radius = Math.max(
    distanceKm(center, { lat: south, lng: west }),
    distanceKm(center, { lat: south, lng: east }),
    distanceKm(center, { lat: north, lng: west }),
    distanceKm(center, { lat: north, lng: east }),
  );

  return Math.min(50, Math.max(5, Math.ceil(radius)));
}

function relationDescription({ workTitle, place, kind, locationDescription, via = null }) {
  // A fallback rung must say what it is AND what is missing, in the same breath. "South
  // Korea" under a film with no caveat looks like a filming location the size of a
  // country; with the second sentence it is an honest answer to a question nobody else
  // could answer.
  const relation = via?.relationKind === "origin_country"
    ? `${workTitle} was made in ${place}. No exact filming locations are recorded for it yet.`
    : via?.relationKind === "narrative_location"
      ? `${workTitle} is set in ${place}. No exact filming locations are recorded for it yet.`
      : kind === "book"
        ? `The story of ${workTitle} is set in ${place}.`
        : kind === "series"
          ? `${place} is listed as a filming location for the series ${workTitle}.`
          : `${place} is listed as a filming location for ${workTitle}.`;

  if (!locationDescription) return relation;
  const detail = locationDescription.trim().replace(/^[a-z]/, (letter) => letter.toUpperCase());
  return `${relation} ${detail.replace(/[.!?]?$/, ".")}`;
}

export function normalizeWikidataLocations(bindings, { kind }) {
  const everyKind = isEveryKind(kind);
  const fallbackConfig = everyKind ? null : workKindConfig(kind);
  if (!everyKind && !fallbackConfig) return [];
  const locations = new Map();

  for (const row of bindings ?? []) {
    // With every kind drawn at once the row says which branch matched it, and the answer
    // decides the relation: P915 is "the camera was here", P840 is "the story is set
    // here". Blurring the two would be the same lie as a queue row shaped like a fact.
    const rowKind = everyKind ? (row.workKind?.value ?? null) : kind;
    const config = everyKind ? workKindConfig(rowKind) : fallbackConfig;
    if (!config) continue;
    const workWikidataId = wikidataId(row.work?.value);
    const locWikidataId = wikidataId(row.location?.value);
    const point = coordinates(row.coord?.value);
    if (!workWikidataId || !locWikidataId || !point) continue;

    const workTitle = row.workLabel?.value ?? workWikidataId;
    const place = row.locationLabel?.value ?? locWikidataId;
    if (isPlaceholderLabel(workTitle) || isPlaceholderLabel(place)) continue;
    const key = `${workWikidataId}:${locWikidataId}:${config.relationKind}`;
    if (locations.has(key)) continue;

    locations.set(key, {
      work_wikidata_id: workWikidataId,
      work_title: workTitle,
      work_year: releaseYear(row.releaseDate?.value),
      kind: rowKind,
      loc_wikidata_id: locWikidataId,
      loc_name: place,
      lat: point.lat,
      lng: point.lng,
      commons_image: sparqlImageUrl(row.image?.value),
      film_tmdb_id: rowKind === "film" ? row.tmdbId?.value ?? null : null,
      relation_kind: config.relationKind,
      relation_property: config.locationProperty,
      relation_label: config.relationLabel,
      relation_description: relationDescription({
        workTitle,
        place,
        kind,
        locationDescription: row.locationDescription?.value,
      }),
      // What the place IS, for the precision axis. Several, because a place is several
      // things and the finest of them decides whether it can be a pin.
      place_types: (row.types?.value ?? "").split("|").filter(Boolean),
      source_url: `https://www.wikidata.org/wiki/${locWikidataId}`,
    });
  }

  return [...locations.values()];
}

export function locationsWithinRadius(locations, center, radius) {
  return locations
    .map((location) => ({
      ...location,
      distance_km: distanceKm(center, { lat: location.lat, lng: location.lng }),
    }))
    .filter((location) => location.distance_km <= radius)
    .sort((first, second) => first.distance_km - second.distance_km);
}

// Every place a work touches, nearest first, each saying whether it falls inside the
// city currently on screen.
//
// A radius answers "what is near me", which is the right question for a place search
// and the wrong one for a work search. Asking for "Notting Hill" while looking at Paris
// returned an empty map — not because we lack the film's places, but because they are
// in London. The user typed a title, and a title is not a request about here.
//
// So the radius stops deciding what EXISTS and only decides what is marked as here.
export function locationsByDistance(locations, center, radius) {
  return locations
    .map((location) => {
      const distance_km = distanceKm(center, { lat: location.lat, lng: location.lng });
      return { ...location, distance_km, in_radius: distance_km <= radius };
    })
    .sort((first, second) => first.distance_km - second.distance_km);
}

export function selectFirstMatchingWork(locations, workIds, limit, excludeLocationId = null) {
  for (const workId of workIds) {
    const workLocations = locations.filter((location) => location.work_wikidata_id === workId);
    if (workLocations.length) {
      const preciseLocations = isWikidataId(excludeLocationId)
        ? workLocations.filter((location) => location.loc_wikidata_id !== excludeLocationId)
        : workLocations;
      return (preciseLocations.length ? preciseLocations : workLocations).slice(0, limit);
    }
  }
  return [];
}

export function rankNearbyLocations(locations, { limit, maxWorks = 5, maxPerWork = 6, balanced = false }) {
  const groups = new Map();
  for (const location of locations) {
    const group = groups.get(location.work_wikidata_id) ?? [];
    group.push(location);
    groups.set(location.work_wikidata_id, group);
  }

  const ordered = [...groups.values()].sort((first, second) => second.length - first.length);
  const chosen = balanced ? balanceKinds(ordered, maxWorks) : ordered.slice(0, maxWorks);

  return chosen
    .flatMap((group) => group.slice(0, maxPerWork))
    .slice(0, limit);
}

// Five works fit, and with three kinds merged the five biggest were all series and books:
// measured on London, "every kind" returned 6 places and **not one film**, where film
// alone returned 11. The cap is not the bug — losing a whole kind to it is.
//
// So the kinds take turns, biggest first within each. A kind with nothing here still
// yields its turn rather than holding a slot empty.
function balanceKinds(ordered, maxWorks) {
  const queues = new Map(WORK_KINDS.map((kind) => [kind, []]));
  const others = [];
  for (const group of ordered) {
    const queue = queues.get(group[0]?.kind);
    if (queue) queue.push(group);
    else others.push(group);
  }

  const chosen = [];
  while (chosen.length < maxWorks) {
    const before = chosen.length;
    for (const kind of WORK_KINDS) {
      if (chosen.length >= maxWorks) break;
      const next = queues.get(kind).shift();
      if (next) chosen.push(next);
    }
    if (chosen.length === before) break;
  }

  // Anything whose kind we could not read goes last, and only if there is room.
  for (const group of others) {
    if (chosen.length >= maxWorks) break;
    chosen.push(group);
  }

  return chosen;
}

export function safeSearchQuery(value) {
  const query = value?.trim();
  if (!query || query.length > 160) return null;
  return query;
}
