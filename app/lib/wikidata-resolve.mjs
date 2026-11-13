// Finding the Wikidata entity that IS a submission's place — pure helpers.
//
// The existing cascade (geocode-wikidata.mjs) runs the other way: a name from
// prose, out comes a coordinate. Here the coordinate is already known and the
// entity is what is missing, which is a much easier question — the search is
// bounded to 150 m rather than the whole planet, so "Cambridge or Cambridge"
// never arises.
//
// Rules were chosen by measurement, not taste. On 196 real MovieMaps pins:
//
//   exact label                      47 (24.0%)   2 ambiguous
//   + alternative labels             54 (27.6%)   3 ambiguous
//   + one name contains the other    49 (25.0%)  24 ambiguous   <- rejected
//   + generic word dropped           58 (29.6%)   6 ambiguous   <- chosen
//
// Containment was the surprise: it resolves FEWER than the strict rule, because
// a substring catches neighbours, the case turns ambiguous, and an ambiguous
// case is correctly thrown away. A rule that looks looser can be worse.
//
// The ceiling is the data. 138 of those 196 had SOME entity within 150 m but
// only 58 matched by name — the rest are genuine neighbours. In a city there is
// almost always something notable within a block, so proximity alone proves
// nothing, and Wikidata simply does not hold an entry for an ordinary house.

import { normalizePlaceName } from "./place-dedup.mjs";

// The radius the review gate already calls "the same place" for two geocoders.
export const SEARCH_RADIUS_KM = 0.15;

// Words that name a KIND of place rather than the place. Dropping them lets
// "Point Fermin Lighthouse" meet "Point Fermin Light" and "David Thompson
// Secondary" meet "David Thompson Secondary School" — both verified by hand.
const GENERIC = new Set([
  "pool", "trail", "park", "station", "house", "building", "centre", "center",
  "hall", "club", "hotel", "school", "college", "library", "theatre", "theater",
  "cinema", "bridge", "street", "road", "avenue", "lane", "court", "square",
  "garden", "gardens", "the", "of", "at", "light", "lighthouse", "deli",
  "delicatessen", "restaurant", "museum", "palace", "gate", "tower", "fort",
  "fortress", "castle", "church", "cathedral", "abbey", "monastery", "beach",
  // School naming is regional and abbreviates hard: "David Thompson Secondary"
  // is the same institution as "David Thompson Secondary School".
  "secondary", "high", "primary", "elementary", "academy", "university",
]);

export function bareName(value) {
  const words = normalizePlaceName(value).split(" ").filter((w) => w && !GENERIC.has(w));
  return words.join(" ");
}

// Whether a name carries a generic word at all. This is the guard that stops
// "Victoria Park" collapsing onto "Victoria": stripping is only meaningful when
// BOTH names say what kind of thing they are, so that what remains is the same
// proper noun described two ways. One side with a generic and one without are
// simply two different things that share a word — a park and the city it is in.
export function hasGeneric(value) {
  return normalizePlaceName(value).split(" ").some((w) => GENERIC.has(w));
}

// Does this candidate name the same place? Label or any alternative label,
// exactly or with the generic words removed.
// Wikidata labels often carry Wikipedia's disambiguator: "Pile Gate, Dubrovnik",
// "Rector's Palace (Dubrovnik)". Within 150 m the town adds nothing, so each label is
// also compared without it. Measured 13.11 on Game of Thrones and Stranger Things:
// 1 of 202 moviemaps pins resolved, most misses being exactly this.
export function withoutDisambiguator(value) {
  return String(value ?? "").replace(/\s*\([^)]*\)\s*$/, "").replace(/,\s*[^,]+$/, "").trim();
}

export function namesTheSamePlace(placeName, candidate) {
  const want = normalizePlaceName(placeName);
  const wantBare = bareName(placeName);
  const names = [candidate?.label, ...(candidate?.alts ?? [])]
    .filter(Boolean)
    .flatMap((name) => [name, withoutDisambiguator(name)])
    .filter(Boolean);
  return names.some((n) => {
    if (normalizePlaceName(n) === want) return true;
    // A bare form of one or two characters would match almost anything, and
    // stripping only compares like with like — see hasGeneric.
    if (wantBare.length < 4) return false;
    if (!hasGeneric(placeName) || !hasGeneric(n)) return false;
    return bareName(n) === wantBare;
  });
}

// The entity, or null with the reason. Several DIFFERENT entities matching is a
// refusal, not a coin toss: it means the name does not pick one place out.
export function chooseEntity(placeName, candidates) {
  const matched = (candidates ?? []).filter((c) => namesTheSamePlace(placeName, c));
  const distinct = new Map(matched.map((m) => [m.qid, m]));
  if (distinct.size === 0) return { entity: null, reason: "no entity of that name within 150 m" };
  if (distinct.size > 1) {
    return { entity: null, reason: `${distinct.size} entities share this name here` };
  }
  return { entity: [...distinct.values()][0], reason: null };
}

export function buildAroundQuery(lat, lng, radiusKm = SEARCH_RADIUS_KM) {
  return `SELECT ?item ?itemLabel ?alt ?typeLabel ?dist WHERE {
  SERVICE wikibase:around { ?item wdt:P625 ?loc .
    bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
    bd:serviceParam wikibase:distance ?dist . }
  ?item wdt:P31 ?type .
  OPTIONAL { ?item skos:altLabel ?alt FILTER(lang(?alt) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 60`;
}

// SPARQL rows are one per (item, altLabel, type); fold them back into entities.
export function foldBindings(bindings) {
  const byItem = new Map();
  for (const b of bindings ?? []) {
    const qid = b.item.value.split("/").pop();
    if (!byItem.has(qid)) {
      byItem.set(qid, {
        qid,
        label: b.itemLabel?.value ?? "",
        type: b.typeLabel?.value ?? null,
        distanceM: Math.round(Number(b.dist?.value ?? 0) * 1000),
        alts: [],
      });
    }
    if (b.alt?.value) byItem.get(qid).alts.push(b.alt.value);
  }
  return [...byItem.values()];
}
