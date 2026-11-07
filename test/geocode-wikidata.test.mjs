import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_NAMES_PER_QUERY,
  NOTABLE_POPULATION,
  QUERY_GAP_MS,
  RIVAL_DISTANCE_KM,
  WIKIDATA_LICENSE,
  buildGeocodeQuery,
  buildHeadquartersQuery,
  cacheRow,
  chooseCandidate,
  areaNamesCountry,
  contradictsArea,
  hintNamesAnAdministrativeArea,
  isAreaNotAPoint,
  dominantByPopulation,
  gazetteerName,
  groupByName,
  inheritedPointIds,
  inheritsEnclosingPoint,
  isGeocodableName,
  isPlaceType,
  retryPlan,
  sparqlLiteral,
  FAR_FROM_HINT_KM,
  hintTownTheChainDoesNotName,
  isFarFromHintTown,
} from "../app/lib/geocode-wikidata.mjs";

const at = (lat, lng, extra = {}) => ({ wikidata_id: "Q1", name: "X", lat, lng, ...extra });

// --- what is worth asking about --------------------------------------------------

test("a phrase that names no place is never sent", () => {
  // "various locations" matches hundreds of entities; a population tiebreak between
  // them is a coin toss dressed as a decision.
  assert.equal(isGeocodableName("various locations"), false);
  assert.equal(isGeocodableName("the studio"), false);
  assert.equal(isGeocodableName("1953"), false);
  assert.equal(isGeocodableName("a"), false);
  assert.equal(isGeocodableName(""), false);
  assert.equal(isGeocodableName(null), false);
});

test("a real place name is", () => {
  assert.equal(isGeocodableName("Hankley Common"), true);
  assert.equal(isGeocodableName("Hashima Island"), true);
});

// --- the query --------------------------------------------------------------------

test("the query demands a coordinate, and never walks the subclass tree", () => {
  // The closure `wdt:P31/wdt:P279* wd:Q618123` was correct and unusable: measured live
  // it took 65 SECONDS and returned 504 for ONE name, while a trivial query to the same
  // service answered in 0.45s. Requiring a coordinate does the same work — "Skyfall"
  // returns nothing because the film has no P625.
  const query = buildGeocodeQuery(["Hankley Common"]);
  assert.doesNotMatch(query, /P279/);
  assert.match(query, /wikibase:geoLatitude/);
  // The direct type comes back so non-places can be dropped in code.
  assert.match(query, /wdt:P31 \?type/);
  // An alias must count: prose rarely uses the canonical label.
  assert.match(query, /rdfs:label\|skos:altLabel/);
});

test("a thing with a coordinate that is not a place is dropped", () => {
  // "Victoria" matches a shipwreck and a bark, and both carry coordinates.
  assert.equal(isPlaceType("shipwreck"), false);
  assert.equal(isPlaceType("Sailing Ship"), false);
  assert.equal(isPlaceType("city"), true);
  assert.equal(isPlaceType("common"), true);
  // An untyped entity that has a coordinate is still a place.
  assert.equal(isPlaceType(null), true);
});

test("one entity with several types is one candidate, not several", () => {
  // Each P31 value returns its own row; without deduplication a place with three types
  // looks like three records of itself and skews the population tiebreak.
  const rows = ["island", "ghost town", "tourist attraction"].map((typeLabel) => ({
    name: { value: "Hashima Island" },
    place: { value: "http://www.wikidata.org/entity/Q285468" },
    placeLabel: { value: "Hashima Island" },
    lat: { value: "32.6277" }, lng: { value: "129.7383" },
    typeLabel: { value: typeLabel },
  }));
  assert.equal(groupByName(rows).get("hashima island").length, 1);
});

test("a quote in a place name cannot rewrite the query", () => {
  // Prose contains quotes and backslashes; an unescaped one does not merely fail, it
  // changes what is asked.
  assert.equal(sparqlLiteral('The "Blue" Bar'), 'The \\"Blue\\" Bar');
  assert.equal(sparqlLiteral("back\\slash"), "back\\\\slash");
  assert.equal(sparqlLiteral("two\nlines"), "two lines");

  const query = buildGeocodeQuery(['The "Blue" Bar']);
  assert.match(query, /\\"Blue\\"/);
});

test("the batch is bounded and unaskable names are dropped, not sent", () => {
  const many = Array.from({ length: MAX_NAMES_PER_QUERY + 20 }, (_, i) => `Place Number ${i}`);
  const values = (buildGeocodeQuery(many).match(/"Place Number/g) ?? []).length;
  assert.equal(values, MAX_NAMES_PER_QUERY);

  assert.equal(buildGeocodeQuery(["various locations", "the set"]), null);
  assert.equal(buildGeocodeQuery([]), null);
});

test("the batch is small because a big one times out", () => {
  // Measured live: 40 names returns HTTP 504. The label|altLabel union across the
  // geographic class tree is expensive per name, and WDQS hard-fails at 60 seconds.
  assert.ok(MAX_NAMES_PER_QUERY <= 10);
  assert.ok(QUERY_GAP_MS >= 5000);
});

test("a timeout and a rate limit call for opposite responses", () => {
  // 504 means the query was too heavy — waiting longer changes nothing.
  assert.equal(retryPlan(504).action, "shrink_batch");
  // 429 means we were too fast — a smaller batch changes nothing.
  assert.equal(retryPlan(429).action, "back_off");
  assert.ok(retryPlan(429).waitMs > retryPlan(504).waitMs);
  assert.equal(retryPlan(404).action, "give_up");
});

// --- reading the answer -------------------------------------------------------------

test("rows are grouped by the name that was asked for", () => {
  const grouped = groupByName([
    { name: { value: "Hashima Island" }, place: { value: "http://www.wikidata.org/entity/Q285468" },
      lat: { value: "32.6277" }, lng: { value: "129.7383" }, placeLabel: { value: "Hashima Island" } },
  ]);
  const [candidate] = grouped.get("hashima island");
  assert.equal(candidate.wikidata_id, "Q285468");
  assert.equal(candidate.lat, 32.6277);
});

test("a row without a coordinate is not an answer", () => {
  const grouped = groupByName([
    { name: { value: "X" }, place: { value: ".../Q1" }, lat: { value: "" }, lng: { value: "2" } },
    { name: { value: "Y" }, place: { value: ".../notaqid" }, lat: { value: "1" }, lng: { value: "2" } },
  ]);
  assert.equal(grouped.size, 0);
});

test("an empty latitude never becomes zero", () => {
  // Number("") is 0, which is a real coordinate in the Gulf of Guinea.
  const grouped = groupByName([
    { name: { value: "X" }, place: { value: ".../Q1" }, lat: { value: "" }, lng: { value: "" } },
  ]);
  assert.equal(grouped.size, 0);
});

// --- choosing, and refusing ---------------------------------------------------------

test("one candidate is the answer", () => {
  const chosen = chooseCandidate([at(51.5, -0.12)]);
  assert.equal(chosen.reason, "unique");
  assert.ok(chosen.place);
});

test("two genuinely different places sharing a name are REFUSED, not ranked", () => {
  // Cambridge England and Cambridge Massachusetts. The prose said "Cambridge" and we
  // do not know which — writing the bigger one's coordinate invents an answer.
  const chosen = chooseCandidate([
    at(52.2053, 0.1218, { name: "Cambridge", population: 145000 }),
    at(42.3736, -71.1097, { name: "Cambridge", population: 118000 }),
  ]);
  assert.equal(chosen.place, null);
  assert.equal(chosen.reason, "ambiguous_homonyms");
});

test("several records of the SAME place are merged, not refused", () => {
  // A settlement and its centre are not rivals; they cluster.
  const chosen = chooseCandidate([
    at(51.5074, -0.1278, { population: 8000000 }),
    at(51.5155, -0.1410, { population: null }),
  ]);
  assert.equal(chosen.reason, "same_place_multiple_records");
  assert.equal(chosen.place.population, 8000000);
});

test("a hint from the same prose may break a tie", () => {
  const chosen = chooseCandidate([
    at(52.2053, 0.1218, { name: "Cambridge, England" }),
    at(42.3736, -71.1097, { name: "Cambridge, Massachusetts" }),
  ], { near: { lat: 51.5, lng: -0.12 } });
  assert.equal(chosen.reason, "nearest_to_hint");
  assert.equal(chosen.place.name, "Cambridge, England");
});

test("a hint that favours neither does not decide", () => {
  // Equidistant is not a preference, and pretending otherwise is the failure this
  // whole function exists to avoid.
  const chosen = chooseCandidate([
    at(51.0, 0), at(53.0, 0),
  ], { near: { lat: 52.0, lng: 0 } });
  assert.equal(chosen.place, null);
  assert.equal(chosen.reason, "ambiguous_homonyms");
});

test("no candidates is a clean refusal", () => {
  assert.equal(chooseCandidate([]).reason, "no_candidate");
  assert.equal(chooseCandidate(null).reason, "no_candidate");
});

test("rivals are judged by distance, not by name", () => {
  assert.ok(RIVAL_DISTANCE_KM > 10 && RIVAL_DISTANCE_KM < 100);
});

// --- what gets cached ---------------------------------------------------------------

test("a cached coordinate records where it came from and under what licence", () => {
  // Once CC0, CC BY and ODbL results are mixed without these, nobody can say what
  // attribution the data owes.
  const row = cacheRow("Hashima Island", chooseCandidate([at(32.6, 129.7, { wikidata_id: "Q285468" })]));
  assert.equal(row.source, "wikidata");
  assert.equal(row.license, WIKIDATA_LICENSE.name);
  assert.equal(row.source_id, "Q285468");
  assert.equal(row.query_norm, "hashima island");
});

test("a refusal caches nothing", () => {
  assert.equal(cacheRow("Cambridge", { place: null, reason: "ambiguous_homonyms" }), null);
  assert.equal(cacheRow("X", null), null);
});

// --- the label is evidence; the hint is only local ------------------------------------

test("an entity's own label beats one that merely lists the name as an alias", () => {
  // Checked live: "Istanbul" matches the city by label and a Manchester pub called
  // "Istanbul Grill" by alias. Without this the pub is a rival.
  const chosen = chooseCandidate([
    at(41.0082, 28.9784, { wikidata_id: "Q406", name: "Istanbul", exact_label: true, population: 15655924 }),
    at(53.5330, -2.2850, { wikidata_id: "Q136769547", name: "Istanbul Grill", exact_label: false }),
  ]);
  assert.equal(chosen.place.wikidata_id, "Q406");
});

test("a hint speaks only about its own neighbourhood", () => {
  // The bug this exists to prevent: with London as the hint, "Istanbul" resolved to a
  // pub in Manchester, because Manchester is closer to London than Turkey is. The hint
  // separates Cambridge from Cambridge; it does not rank the world by distance.
  const chosen = chooseCandidate([
    at(41.0082, 28.9784, { name: "Istanbul", exact_label: true }),
    at(53.5330, -2.2850, { name: "Istanbul Grill", exact_label: true }),
  ], { near: { lat: 51.5072, lng: -0.1276 } });

  assert.notEqual(chosen.reason, "nearest_to_hint");
});

test("a hint still decides between two candidates that are actually near it", () => {
  const chosen = chooseCandidate([
    at(52.2053, 0.1218, { name: "Cambridge, England", exact_label: true }),
    at(42.3736, -71.1097, { name: "Cambridge, Massachusetts", exact_label: true }),
  ], { near: { lat: 51.5072, lng: -0.1276 } });

  assert.equal(chosen.reason, "nearest_to_hint");
  assert.equal(chosen.place.name, "Cambridge, England");
});

// --- population as evidence, and as a coin toss ----------------------------------------

test("a city beside rivals with no recorded population at all is the answer", () => {
  // Shanghai (24.8m) against three unincorporated communities Wikidata records no
  // population for. Refusing this cost real recall for no safety.
  const chosen = chooseCandidate([
    at(31.2304, 121.4737, { name: "Shanghai", exact_label: true, population: 24870895 }),
    at(37.61, -95.0, { name: "Shanghai", exact_label: true, population: null }),
    at(18.45, -66.0, { name: "Shanghai", exact_label: true, population: null }),
  ]);
  assert.equal(chosen.reason, "dominant_population");
  assert.equal(chosen.place.population, 24870895);
});

test("one rival with a recorded population is enough to refuse", () => {
  // "Victoria": the state of Australia (7,074,468) beats a Canadian district (110,942)
  // by 63x, so any ratio rule picks it — among 110 real places. Ratios cannot tell a
  // city beside a hamlet from a state beside a city.
  const chosen = chooseCandidate([
    at(-36.85, 144.28, { name: "Victoria", exact_label: true, population: 7074468 }),
    at(48.43, -123.37, { name: "Victoria", exact_label: true, population: 110942 }),
  ]);
  assert.equal(chosen.place, null);
  assert.equal(chosen.reason, "ambiguous_homonyms");
});

test("two comparable cities are still a coin toss", () => {
  assert.equal(dominantByPopulation([
    { lat: 52.2, lng: 0.1, population: 145000 },
    { lat: 42.3, lng: -71.1, population: 118000 },
  ]), null);
});

test("a small place among silent rivals is not promoted either", () => {
  // A missing population is missing data, not a measured zero, so the winner has to be
  // large in absolute terms before silence on the other side counts for anything.
  assert.equal(dominantByPopulation([
    { lat: 1, lng: 1, population: 400 },
    { lat: 50, lng: 50, population: null },
  ]), null);
  assert.ok(NOTABLE_POPULATION >= 50_000);
});

test("a prose name is reduced to one a gazetteer can answer", () => {
  // The first live run asked Wikidata about "the Old Royal Naval College in Greenwich"
  // and got nothing, while "Old Royal Naval College" resolves immediately. The area is
  // already carried in area_hint, so repeating it here is duplication, not information.
  assert.equal(gazetteerName("the Old Royal Naval College in Greenwich"), "Old Royal Naval College");
  assert.equal(gazetteerName("Hankley Common in Surrey"), "Hankley Common");
  assert.equal(gazetteerName("the National Gallery"), "National Gallery");
});

test("a comma clause is left alone — it IS the gazetteer name", () => {
  // Stripping it would turn an answerable name into an ambiguous one.
  assert.equal(gazetteerName("Cambridge, Massachusetts"), "Cambridge, Massachusetts");
  assert.equal(gazetteerName("Hashima Island"), "Hashima Island");
});

// --- an entity that has no place of its own, only its city's (#152) --------------

test("the New York Public Library sits on New York City and is refused", () => {
  // Q219555's own P625 is -74.0059728, 40.7127753. New York City's is -74.006111111,
  // 40.712777777 — the same point to about twenty metres. The film used the Fifth Avenue
  // main branch, five kilometres away.
  assert.equal(
    inheritsEnclosingPoint({ lat: 40.7127753, lng: -74.0059728 }, { lat: 40.712777777, lng: -74.006111111 }),
    true,
  );
});

test("an organisation that really is where it says is kept", () => {
  // Measured across all 1,063 placed rows: the closest genuine headquarters gap is
  // Brasenose College at 252 m from Oxford's own point. Everything correct sits above the
  // threshold, and the three worst offenders are kilometres away — which is exactly why
  // the rule refuses instead of preferring P159.
  const brasenose = { lat: 51.753194, lng: -1.254722 };
  const oxford = { lat: 51.7548, lng: -1.2544 };
  assert.equal(inheritsEnclosingPoint(brasenose, oxford), false);

  // Columbia University: own point is the Morningside campus, headquarters is New York
  // City 11.2 km away. Preferring the headquarters would have moved a correct pin.
  assert.equal(
    inheritsEnclosingPoint({ lat: 40.8075, lng: -73.961944 }, { lat: 40.712777, lng: -74.006111 }),
    false,
  );
});

test("a missing coordinate on either side proves nothing", () => {
  assert.equal(inheritsEnclosingPoint({ lat: 51.5, lng: -0.1 }, null), false);
  assert.equal(inheritsEnclosingPoint(null, { lat: 51.5, lng: -0.1 }), false);
  // Null Island is a legal pair of numbers and the signature of one never parsed.
  assert.equal(inheritsEnclosingPoint({ lat: 0, lng: 0 }, { lat: 51.5, lng: -0.1 }), false);
});

test("the headquarters question is asked separately, of the winners only", () => {
  // Never folded into buildGeocodeQuery: that query already answers 500, 502 and 504
  // under sustained load, and a second hop to the headquarters' coordinate is the kind
  // of weight that made the class closure time out at 65 seconds.
  const query = buildHeadquartersQuery(["Q219555", "Q49088", "not-an-id", "Q219555"]);
  assert.match(query, /VALUES \?place \{ wd:Q219555 wd:Q49088 \}/);
  assert.match(query, /wdt:P159/);
  assert.ok(!query.includes("rdfs:label"), "the winner is already chosen; this only checks it");
  assert.equal(buildHeadquartersQuery([]), null);
  assert.equal(buildHeadquartersQuery(["nonsense"]), null);
});

test("only the entities that sit on their headquarters come back", () => {
  const point = (lat, lng) => ({ value: String(lat) });
  const rows = [
    { place: { value: "http://www.wikidata.org/entity/Q219555" },
      lat: { value: "40.7127753" }, lng: { value: "-74.0059728" },
      hqLat: { value: "40.712777777" }, hqLng: { value: "-74.006111111" } },
    { place: { value: "http://www.wikidata.org/entity/Q49088" },
      lat: { value: "40.8075" }, lng: { value: "-73.961944" },
      hqLat: { value: "40.712777" }, hqLng: { value: "-74.006111" } },
  ];
  const inherited = inheritedPointIds(rows);
  assert.ok(inherited.has("Q219555"));
  assert.ok(!inherited.has("Q49088"));
  assert.equal(inheritedPointIds(null).size, 0);
});


// --- the area the prose named, which may refuse but never choose -----------------------

test("a candidate in the wrong country is refused, even when it is the only one", () => {
  // Bognor. The prose said Joyce wrote there and area_hint said England; the gazetteer
  // returned Bognor, Ontario and the row was stored with a Canadian coordinate. It was
  // never a tie — plain "Bognor" has one candidate, the English town is Bognor Regis — so
  // no tie-break could have helped. Only a contradiction can.
  const ontario = at(44.67, -80.83, { name: "Bognor", country: "Canada" });
  assert.equal(chooseCandidate([ontario], { area: "England" }).reason, "contradicts_area");
  assert.equal(chooseCandidate([ontario], { area: "England" }).place, null);
  // Unchanged where nothing contradicts: no hint, or a hint that agrees.
  assert.equal(chooseCandidate([ontario], {}).reason, "unique");
  assert.equal(chooseCandidate([ontario], { area: "Canada" }).reason, "unique");
  // The candidates still travel with the refusal, as every other refusal does.
  assert.equal(chooseCandidate([ontario], { area: "England" }).candidates.length, 1);
});

test("a named country refuses the rivals outside it, and only a country does", () => {
  // Until 07.11.2026 the hint could refuse only the WINNER, never the rivals. That kept
  // Jerusalem, Tiberias and the Dead Sea off the map: a hamlet of the same name elsewhere
  // has a population too, so "Jerusalem, Israel" stayed a tie. A named country now removes
  // the candidates outside it; what is left still has to win on the old rules, and every
  // row it produces still lands pending for review.
  const rivals = [
    at(52.2053, 0.1218, { name: "Cambridge", population: 145000, country: "United Kingdom" }),
    at(42.3736, -71.1097, { name: "Cambridge", population: 118000, country: "United States" }),
  ];
  assert.equal(chooseCandidate(rivals, { area: "England" }).place?.country, "United Kingdom");
  // A hint that names no country still cannot choose between them.
  assert.equal(chooseCandidate(rivals, { area: "the university town" }).reason, "ambiguous_homonyms");
  assert.equal(chooseCandidate(rivals, {}).place, null);
});

test("a hint that names no country says nothing", () => {
  const place = at(44.67, -80.83, { name: "Bognor", country: "Canada" });
  for (const area of ["Edinburgh", "the north coast", "", null, undefined]) {
    assert.equal(chooseCandidate([place], { area }).reason, "unique", `area ${area}`);
  }
  // And neither does a candidate with no country of its own.
  const countryless = at(1, 1, { name: "Somewhere" });
  assert.equal(chooseCandidate([countryless], { area: "England" }).reason, "unique");
});

test("constituent countries resolve to the state the gazetteer names", () => {
  // Wikidata's P17 for a place in Scotland is "United Kingdom", so a hint of "Scotland"
  // has to mean that or it would contradict every true answer.
  assert.equal(areaNamesCountry("Scotland"), "United Kingdom");
  assert.equal(areaNamesCountry("England"), "United Kingdom");
  assert.equal(areaNamesCountry("USA"), "United States");
  const scottish = at(56.8, -5.1, { name: "Glencoe", country: "United Kingdom" });
  assert.equal(contradictsArea(scottish, "Scotland"), false);
});

test("a name that is both a country and a state says nothing", () => {
  // "Savannah, Georgia" must not be read as the Caucasus. Silence is the safe answer:
  // refusing a true coordinate costs a place, and so does storing a false one.
  assert.equal(areaNamesCountry("Savannah, Georgia"), null);
  assert.equal(areaNamesCountry("Georgia"), null);
  const savannah = at(32.05, -81.1, { name: "Savannah", country: "United States" });
  assert.equal(contradictsArea(savannah, "Savannah, Georgia"), false);
});

test("a country the gazetteer itself named is recognised without a list to maintain", () => {
  // The hint is matched against the countries that came back for these candidates, so the
  // two cannot drift apart as the world's country names change.
  const french = at(48.86, 2.35, { name: "Paris", country: "France" });
  const american = at(33.66, -95.55, { name: "Paris", country: "United States" });
  assert.equal(contradictsArea(american, "Paris, France", ["France", "United States"]), true);
  assert.equal(contradictsArea(french, "Paris, France", ["France", "United States"]), false);
});


// --- the chain, for a hint that names a city rather than a country ---------------------

const withChain = (name, chain, country) => ({ name, country, chain: new Set(chain), lat: 0, lng: 0, exact_label: true });

test("a city-level hint refuses a candidate the chain puts elsewhere", () => {
  // New-York for the film Big resolved to Niu-York in the Donetsk region and was stored at
  // 48.33, 37.84. No country is named in a hint of "New York", so the country test could
  // not see it; the chain says Toretsk Hromada / Bakhmut Raion / Ukraine and none of it is
  // New York.
  const ukraine = withChain("Niu-York", ["Toretsk Hromada", "Bakhmut Raion", "Ukraine"], "Ukraine");
  assert.equal(contradictsArea(ukraine, "New York"), true);
  assert.equal(chooseCandidate([ukraine], { area: "New York" }).reason, "contradicts_area");
});

test("the chain must be transitive, or it refuses the right answers", () => {
  // Wildwood Regional Park's IMMEDIATE P131 is Ventura County. A hint of "Thousand Oaks,
  // California" matches nothing there, and on the immediate parent alone this rule refused
  // 127 of 246 correct coordinates. Transitively the chain reaches California and agrees.
  const park = withChain("Wildwood Regional Park", ["Ventura County", "California", "United States"], "United States");
  assert.equal(contradictsArea(park, "Thousand Oaks, California"), false);
  // ANY token agreeing is agreement: a hint names a place and its enclosing areas, and the
  // widest of them still says the two are talking about the same part of the world.
  assert.equal(contradictsArea(park, "California"), false);
});

test("a chain that knows only the country cannot contradict a city", () => {
  // Studios, parks and railways often carry no P131 at all. Refusing on such a chain cost
  // seven correct coordinates in the measurement — it does not disagree, it does not know.
  const studio = withChain("Culver Studios", ["United States"], "United States");
  assert.equal(contradictsArea(studio, "Culver City, California"), false);
});

test("a hint that is prose or an informal region is not an area", () => {
  // Both are common in what a model writes into area_hint, and neither can appear in an
  // administrative chain however right the coordinate is.
  assert.equal(hintNamesAnAdministrativeArea("Primary filming location for the movie"), false);
  assert.equal(hintNamesAnAdministrativeArea("city where principal photography took place"), false);
  assert.equal(hintNamesAnAdministrativeArea("French Alps"), false);
  assert.equal(hintNamesAnAdministrativeArea("Cape Ann area"), false);
  assert.equal(hintNamesAnAdministrativeArea("Asia"), false);
  // And the ones that are.
  assert.equal(hintNamesAnAdministrativeArea("Thousand Oaks, California"), true);
  assert.equal(hintNamesAnAdministrativeArea("Bristol, England"), true);
  const megeve = withChain("Megève", ["Haute-Savoie", "France"], "France");
  assert.equal(contradictsArea(megeve, "French Alps"), false);
});

// --- when the chain is silent about the town, distance decides --------------------------

const placed = (name, lat, lng, chain, country) => ({ name, lat, lng, chain: new Set(chain), country });
const town = (name, lat, lng, chain, country, types = ["city"]) => ({ name, lat, lng, chain: new Set(chain), country, types: new Set(types) });

test("Clifton is 188 km from the Bristol its hint names, and is refused", () => {
  const clifton = placed("Clifton Village", 52.909, -1.19, ["City of Nottingham", "Nottinghamshire", "England", "United Kingdom"], "United Kingdom");
  assert.equal(hintTownTheChainDoesNotName(clifton, "Bristol, England"), "Bristol");
  const bristol = town("Bristol", 51.4545, -2.5879, ["Bristol", "England", "United Kingdom"], "United Kingdom");
  assert.equal(isFarFromHintTown(clifton, [bristol], "Bristol, England"), true);
});

test("a loose hint near a right coordinate is left alone", () => {
  // Pinewood Studios is in Iver; the model wrote "London". 29 km — the nearest big name.
  const pinewood = placed("Pinewood Studios", 51.5496, -0.5363, ["Iver", "Buckinghamshire", "England", "United Kingdom"], "United Kingdom");
  const london = town("London", 51.5072, -0.1276, ["Greater London", "England", "United Kingdom"], "United Kingdom");
  assert.equal(isFarFromHintTown(pinewood, [london], "London, England"), false);
  // Wildwood, whose chain skips Thousand Oaks for Ventura County: 5 km.
  const wildwood = placed("Wildwood Regional Park", 34.2227, -118.9011, ["Ventura County", "California", "United States"], "United States");
  const thousandOaks = town("Thousand Oaks", 34.1706, -118.8376, ["Ventura County", "California", "United States"], "United States");
  assert.equal(isFarFromHintTown(wildwood, [thousandOaks], "Thousand Oaks, California"), false);
});

test("a chain that already names the town is never measured", () => {
  const matthew = placed("The Matthew", 51.449, -2.598, ["Bristol", "England", "United Kingdom"], "United Kingdom");
  assert.equal(hintTownTheChainDoesNotName(matthew, "Bristol, United Kingdom"), null);
  // A one-part hint has no town more specific than itself; contradictsArea already reads it.
  assert.equal(hintTownTheChainDoesNotName(matthew, "Bristol"), null);
  // Prose is not an area.
  assert.equal(hintTownTheChainDoesNotName(matthew, "Location of the house, Bristol"), null);
});

test("a town that is itself a region cannot refuse anything", () => {
  // North Shore Studios is in North Vancouver; the hint names the province. A province's
  // centroid is 586 km away and means nothing.
  const northShore = placed("North Shore Studios", 49.32, -123.07, ["North Vancouver", "Canada"], "Canada");
  const province = town("British Columbia", 53.7, -127.6, ["Canada"], "Canada", ["province of Canada"]);
  assert.equal(isFarFromHintTown(northShore, [province], "British Columbia, Canada"), false);
});

test("a town only counts if it agrees with the rest of the hint", () => {
  // Milton Academy was placed in Wisconsin for "Cambridge, Massachusetts". There is a
  // Cambridge in Wisconsin a few miles away; it disagrees with "Massachusetts", so it cannot
  // excuse the pin. The Massachusetts one is 1,400 km off.
  const milton = placed("Milton Academy", 42.78, -89.0, ["Milton", "Rock County", "Wisconsin", "United States"], "United States");
  const cambridgeWI = town("Cambridge", 43.003, -89.017, ["Dane County", "Wisconsin", "United States"], "United States");
  const cambridgeMA = town("Cambridge", 42.3736, -71.1097, ["Middlesex County", "Massachusetts", "United States"], "United States");
  assert.equal(isFarFromHintTown(milton, [cambridgeWI], "Cambridge, Massachusetts"), false, "no agreeing town: no evidence");
  assert.equal(isFarFromHintTown(milton, [cambridgeWI, cambridgeMA], "Cambridge, Massachusetts"), true);
});

test("a town too thin to agree with the hint cannot testify against a pin", () => {
  // Leavesden Studios, hint "Windsor, Buckinghamshire" — a wrong hint: Windsor is in
  // Berkshire. The right Windsor contradicts "Buckinghamshire" and is set aside; a far
  // Windsor whose chain says only "United Kingdom" cannot agree with anything, so it cannot
  // refuse anything. Measured live: without this, Leavesden was refused.
  const leavesden = placed("Leavesden Film Studios", 51.6917, -0.4194,
    ["Abbots Langley", "Three Rivers", "Hertfordshire", "England", "United Kingdom"], "United Kingdom");
  const windsorBerkshire = town("Windsor", 51.4817, -0.6136,
    ["Royal Borough of Windsor and Maidenhead", "Berkshire", "England", "United Kingdom"], "United Kingdom", ["town"]);
  const thinWindsor = town("Windsor", 54.58, -5.95, ["United Kingdom"], "United Kingdom", ["human settlement"]);
  assert.equal(isFarFromHintTown(leavesden, [windsorBerkshire, thinWindsor], "Windsor, Buckinghamshire"), false);
});

test("no town found is no evidence", () => {
  const clifton = placed("Clifton Village", 52.909, -1.19, ["City of Nottingham", "England", "United Kingdom"], "United Kingdom");
  assert.equal(isFarFromHintTown(clifton, [], "Bristol, England"), false);
  assert.equal(isFarFromHintTown(clifton, undefined, "Bristol, England"), false);
  assert.equal(FAR_FROM_HINT_KM, 150);
});

test("a hint sharing only a wide ancestor is NOT caught, and that is the known limit", () => {
  // Clifton Village, Bristol resolved to Clifton in Nottingham on a hint of "Bristol,
  // England". The chain holds England and so does the hint, so they agree on the widest
  // token and the rule stays silent. Catching it needs the hint's MOST SPECIFIC token to be
  // required — and measured, that refused Wildwood Regional Park and 126 others like it.
  // Written down rather than papered over.
  const nottingham = withChain("Clifton", ["Nottingham", "England", "United Kingdom"], "United Kingdom");
  assert.equal(contradictsArea(nottingham, "Bristol, England"), false);
});


// --- a region is an area, not a point --------------------------------------------------

const typed = (name, types) => ({
  name, types: new Set(types), lat: 1, lng: 1, exact_label: true,
  chain: new Set(["United States"]), country: "United States",
});

test("a state has no point to stand on", () => {
  // Measured over the 246 coordinates of the first real run: six rows are a "U.S. state"
  // and one a "province of Canada" — New Jersey at 40.0,-74.5, Minnesota at 46.0,-94.0.
  // Those are centroids of a polygon, and standing on one tells a reader nothing. The
  // owner's rule of 04.08 already said it for islands: an island named as a location goes
  // on the map as an AREA, never as a point.
  assert.equal(isAreaNotAPoint(typed("New Jersey", ["U.S. state"])), true);
  assert.equal(isAreaNotAPoint(typed("British Columbia", ["province of Canada"])), true);
  assert.equal(chooseCandidate([typed("New Jersey", ["U.S. state"])], {}).reason, "area_not_a_point");
  assert.equal(chooseCandidate([typed("New Jersey", ["U.S. state"])], {}).place, null);
});

test("a city is not a region, however the type is worded", () => {
  // 27 of the 246 are cities and a city centroid is where a reader would aim. The patterns
  // are anchored so that "state capital" and "city in the state of New York" — both city
  // types — do not read as states.
  for (const [name, types] of [
    ["New York City", ["city in the state of New York"]],
    ["Mumbai", ["state capital"]],
    ["Honolulu", ["county seat", "consolidated city-county"]],
    ["Kaneohe", ["census-designated place in the United States"]],
    ["Wildwood Regional Park", ["regional park"]],
  ]) {
    assert.equal(isAreaNotAPoint(typed(name, types)), false, name);
  }
});

test("every P31 is read, not whichever row arrived first", () => {
  // An entity comes back once per type and the order is arbitrary — Honolulu is a "county
  // seat" on one row and a "consolidated city-county" on another. A rule reading one of
  // them is a coin toss.
  assert.equal(isAreaNotAPoint(typed("Somewhere", ["city", "U.S. state"])), true);
  assert.equal(isAreaNotAPoint(typed("Somewhere", ["U.S. state", "city"])), true);
});

// --- the edition's own language ---------------------------------------------------------

test("a name from a French article is asked in French as well as English", () => {
  // observatoire Griffith, Colombie-Britannique and Sony Pictures Studios de Culver City
  // all came back no_candidate: asked in English they are nothing. Nothing is translated —
  // the name is the one the source used, asked in the language the source is written in.
  const query = buildGeocodeQuery(["observatoire Griffith"], { languages: new Map([["observatoire Griffith", "fr"]]) });
  assert.match(query, /"observatoire Griffith"@en/);
  assert.match(query, /"observatoire Griffith"@fr/);
});

test("without a language, and for English itself, only the English tag is asked", () => {
  assert.match(buildGeocodeQuery(["Pinewood Studios"]), /"Pinewood Studios"@en/);
  assert.ok(!buildGeocodeQuery(["Pinewood Studios"]).includes("@fr"));
  const english = buildGeocodeQuery(["Pinewood Studios"], { languages: new Map([["Pinewood Studios", "en"]]) });
  assert.equal((english.match(/"Pinewood Studios"@/g) ?? []).length, 1);
});

test("Jerusalem, Israel: a place with two countries, and a named country that removes rivals", () => {
  // Measured 07.11.2026: the city carries P17 Israel and Palestine, and a town of 4,405 in
  // New York has a population too, so the hint "Israel" refused the city and the rest tied.
  const city = { wikidata_id: "Q1218", name: "Jerusalem", lat: 31.7767, lng: 35.2342, population: 1050151,
    type_label: "city", exact_label: true, country: "Palestine", countries: new Set(["Palestine", "Israel"]),
    chain: new Set(["Palestine", "Israel", "Jerusalem District"]), types: new Set(["city"]) };
  const town = { wikidata_id: "Q3708812", name: "Jerusalem", lat: 42.6, lng: -77.1, population: 4405,
    type_label: "town of New York", exact_label: true, country: "United States", countries: new Set(["United States"]),
    chain: new Set(["United States", "New York", "Yates County"]), types: new Set(["town of New York"]) };

  assert.equal(contradictsArea(city, "Israel", ["Israel", "Palestine", "United States"]), false);
  assert.equal(chooseCandidate([town, city], { area: "Israel" }).place?.wikidata_id, "Q1218");
  // Without a country there is still no way to choose, exactly as before.
  assert.equal(chooseCandidate([town, city], {}).place, null);
  // A hint in another script cannot be compared with English labels, so it says nothing.
  assert.equal(contradictsArea(city, "ירושלים, ישראל"), false);
});
