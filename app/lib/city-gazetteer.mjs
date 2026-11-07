// The cities the directory offers (#158) — a coordinate and a radius each, never a name.
//
// **Why this file is data and not a query.** The obvious way to build a city directory is
// to group the located rows by the city written in their address. Measured on 18.08.2026
// against production, that gives:
//
//   "London"       spread 10,959 km   — London, Ontario is also called London
//   "Richmond"     spread  8,097 km   — British Columbia, Virginia, and upon Thames
//   "Ontario"         48 works        — a province, and also a city in California
//   "Unnamed Road"    80 works        — not a place at all
//   "France"         190 works        — a country, whose median point is Paris
//
// A name in an address is a LABEL. Only a point is an identity. So a city page here is a
// disc: an anchor and a radius, and the films on it are the films with a located row
// inside it. The name is decoration, exactly as the readable half of a work slug is
// ([[work-url]]) — which is why London, Ontario cannot appear on the London page however
// its address is spelled, and why Paris appears whether the address says "Paris", "75001"
// or nothing at all.
//
// **How this list was derived**, by `scripts/build-city-gazetteer.sql` against production:
//
//   1. Every comma-separated component of every located row's `area_hint` is a candidate.
//   2. A candidate is dropped when it is a COUNTRY — measured as the share of occurrences
//      where it is the LAST component. Canada scores 1.000, France 0.912, Ireland 0.813;
//      Vancouver, Madrid and Almería score 0.000. Without this rule "Canada" wins 902
//      names, lands on Vancouver's coordinate, and shadows Vancouver itself.
//   3. A candidate is dropped when it names one address rather than an area: fewer than
//      three DISTINCT full hints behind it. This is what removes "Mini Hollywood",
//      "Bryant Park", "Tate Modern" and "Bonneville Salt Flats", each of which otherwise
//      arrives with 40-50 works and looks exactly like a small city.
//   4. The anchor is the MEDIAN of its own points, which is what survives homonyms: a
//      third of everything called "Paris" is in Texas or Ontario and the median is still
//      in the 4th arrondissement. The mean is not — it lands in the Atlantic. Nor is the
//      densest point, which was tried and moved London to Greenwich, where 51 rows share
//      one coordinate.
//   5. A candidate is dropped when its interquartile spread exceeds 50 km, so a name that
//      means several places is not given one page.
//   6. Of two candidates within 40 km, only the more-named survives. This is the rule that
//      makes the directory a directory rather than a padded one: at a 20 km radius
//      Westminster, Lambeth, St. James's and City of Westminster return the SAME 656 works
//      as London, and each would have been its own page.
//
// **One entry was added by hand and it is marked.** Paris fails rule 5 because two thirds
// of the rows naming it are Paris, Texas and Paris, Ontario — the rule is right about the
// name and wrong about the place, and we hold 123 works within 20 km of the anchor its own
// median gives. It is added rather than the threshold loosened, because loosening it to
// admit Paris also admits "s/n" (Spanish for "no street number"), which was measured to
// take 87 works and shadow Madrid.
//
// **What this list is not.** It is Anglo-American by construction, because our sources are:
// Prague, Rome and Vienna hold too few rows to clear rule 1, and they are absent rather
// than padded. The counts shown to a reader are always LIVE — this file carries no numbers,
// only anchors, so the directory can never quote a total it no longer holds.

import { slugifyTitle } from "./work-url.mjs";

// 20 km, and the number is doing work. Rule 6 keeps accepted anchors more than 40 km
// apart, so at 20 km no two discs overlap and no film is counted into two cities. A wider
// radius would swallow Long Beach into Los Angeles and make the two counts add to more
// than we hold.
export const CITY_RADIUS_KM = 20;

// Derived 18.08.2026. `name` and `country` are as the sources wrote them; `lat`/`lng` are
// the median of the rows that named the city, rounded to four places (~11 m, far below
// the radius).
const CITIES = [
  { name: "Los Angeles", country: "USA", lat: 34.0597, lng: -118.2856 },
  { name: "New York", country: "USA", lat: 40.7557, lng: -73.9818 },
  { name: "London", country: "UK", lat: 51.5089, lng: -0.1241 },
  { name: "Vancouver", country: "Canada", lat: 49.2801, lng: -123.1144 },
  { name: "Toronto", country: "Canada", lat: 43.6532, lng: -79.3818 },
  // Added by hand — see the note above. Anchor is the median of the rows naming Paris.
  { name: "Paris", country: "France", lat: 48.8639, lng: 2.3349, byHand: true },
  { name: "San Francisco", country: "USA", lat: 37.7915, lng: -122.4191 },
  { name: "Chicago", country: "USA", lat: 41.8866, lng: -87.631 },
  { name: "Almería", country: "Spain", lat: 37.02, lng: -2.4313 },
  { name: "Atlanta", country: "USA", lat: 33.7583, lng: -84.3892 },
  { name: "Tucson", country: "USA", lat: 32.2181, lng: -111.1303 },
  { name: "Berlin", country: "Germany", lat: 52.4823, lng: 13.3894 },
  { name: "Farnham", country: "UK", lat: 51.1929, lng: -0.7748 },
  { name: "Woodstock", country: "UK", lat: 51.8414, lng: -1.361 },
  { name: "Oshawa", country: "Canada", lat: 43.904, lng: -78.8682 },
  { name: "Dublin", country: "Ireland", lat: 53.3438, lng: -6.2546 },
  { name: "Barcelona", country: "Spain", lat: 41.4745, lng: 2.1503 },
  { name: "New Orleans", country: "USA", lat: 29.9549, lng: -90.0685 },
  { name: "Las Vegas", country: "USA", lat: 36.1213, lng: -115.169 },
  { name: "Seattle", country: "USA", lat: 47.6135, lng: -122.3344 },
  { name: "Hamilton", country: "Canada", lat: 43.2591, lng: -79.8702 },
  { name: "Cardiff", country: "UK", lat: 51.4822, lng: -3.179 },
  { name: "Madrid", country: "Spain", lat: 40.5891, lng: -3.8119 },
  { name: "Boston", country: "USA", lat: 42.3508, lng: -71.0694 },
  { name: "Washington", country: "USA", lat: 38.8969, lng: -77.0366 },
  { name: "Santa Fe", country: "USA", lat: 35.539, lng: -106.0834 },
  { name: "Philadelphia", country: "USA", lat: 39.9557, lng: -75.1639 },
  { name: "Lancaster", country: "USA", lat: 34.7024, lng: -117.8628 },
  { name: "Chippenham", country: "UK", lat: 51.4934, lng: -2.229 },
  { name: "Sofia", country: "Bulgaria", lat: 42.6932, lng: 23.325 },
  { name: "Budapest", country: "Hungary", lat: 47.5004, lng: 19.0563 },
  { name: "Sevilla", country: "Spain", lat: 37.3839, lng: -5.9917 },
  { name: "Portland", country: "USA", lat: 45.5239, lng: -122.677 },
  { name: "Salt Lake City", country: "USA", lat: 40.7648, lng: -111.8499 },
  { name: "Coleford", country: "UK", lat: 51.7706, lng: -2.6145 },
  { name: "Miami Beach", country: "USA", lat: 25.8179, lng: -80.1221 },
  { name: "Baltimore", country: "USA", lat: 39.297, lng: -76.6149 },
  { name: "Pittsburgh", country: "USA", lat: 40.4438, lng: -79.9896 },
  { name: "Palm Springs", country: "USA", lat: 33.8371, lng: -116.554 },
  { name: "Salisbury", country: "UK", lat: 51.1789, lng: -1.8262 },
  { name: "Honolulu", country: "USA", lat: 21.2849, lng: -157.8291 },
  { name: "Montréal", country: "Canada", lat: 45.5066, lng: -73.573 },
  { name: "Austin", country: "USA", lat: 30.2664, lng: -97.7466 },
  { name: "San Diego", country: "USA", lat: 32.7318, lng: -117.1579 },
  { name: "Granada", country: "Spain", lat: 37.1834, lng: -3.0655 },
  { name: "Wilmington", country: "USA", lat: 34.2355, lng: -77.9447 },
  { name: "Eugene", country: "USA", lat: 44.0448, lng: -123.0738 },
  { name: "Liverpool", country: "UK", lat: 53.4087, lng: -2.9802 },
  { name: "Waitakere", country: "New Zealand", lat: -36.8969, lng: 174.4451 },
  { name: "Wells", country: "UK", lat: 51.2104, lng: -2.6435 },
  { name: "Albuquerque", country: "USA", lat: 35.0935, lng: -106.6471 },
  { name: "New Delhi", country: "India", lat: 28.6129, lng: 77.2334 },
  { name: "Detroit", country: "USA", lat: 42.336, lng: -83.0488 },
  { name: "Hope", country: "Canada", lat: 49.3697, lng: -121.4339 },
  { name: "Dallas", country: "USA", lat: 32.7831, lng: -96.7969 },
  { name: "Jamestown", country: "USA", lat: 37.8661, lng: -120.5035 },
  // Added by hand, 07.11.2026, with the Israeli catalogue (scripts/ingest-country-works.mjs).
  // None could clear rule 1 — the harvested sources barely reach Israel — so the anchors
  // are each city's own Wikidata coordinate (P625), not a median of our rows. They sit
  // 54 km (Tel Aviv–Jerusalem) and 81 km (Tel Aviv–Haifa) apart, so rule 6 holds.
  { name: "Tel Aviv", country: "Israel", lat: 32.08, lng: 34.78, byHand: true },
  { name: "Jerusalem", country: "Israel", lat: 31.7767, lng: 35.2342, byHand: true },
  { name: "Haifa", country: "Israel", lat: 32.8192, lng: 34.9992, byHand: true },
];

// The same slugifier the work URL uses, so "Almería" and "Montréal" lose their accents
// the same way a title does and one rule governs every readable URL in the product.
export const CITIES_BY_SLUG = new Map(
  CITIES.map((city) => {
    const slug = slugifyTitle(city.name);
    return [slug, Object.freeze({ ...city, slug, radius_km: CITY_RADIUS_KM })];
  }),
);

export const ALL_CITIES = Object.freeze([...CITIES_BY_SLUG.values()]);

export function findCity(slug) {
  return CITIES_BY_SLUG.get(String(slug ?? "").toLowerCase()) ?? null;
}

export function cityPath(city) {
  return city?.slug ? `/city/${city.slug}` : null;
}

// What travels to `city_catalogue_totals` — anchors only. Deliberately not the names: the
// database is not asked to know what a city is called, only where to measure.
export function cityAnchors(cities = ALL_CITIES) {
  return cities.map(({ slug, lat, lng, radius_km: radius }) => ({
    slug,
    lat,
    lng,
    radius_km: radius ?? CITY_RADIUS_KM,
  }));
}
