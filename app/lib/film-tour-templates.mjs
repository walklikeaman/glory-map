// Film tours people already pay for, as starting points for a tour you build yourself.
//
// Researched 2026-11-27 from the operators' own listings (Belfast coach day trips, the
// Dubrovnik walking tours with a Lokrum boat, Edinburgh's Glenfinnan coach day, the
// Salzburg Sound of Music bus, Wellington's half-day minibus, the Albuquerque trolley).
// What a template keeps from them is the SHAPE: the hub a tour leaves from, how long it
// runs, and how it moves. The stops are never copied from a brochure — they come from our
// own places for these works, so every stop carries its source and its verified flag.
//
// Hub coordinates are each city's Wikidata P625 (fetched 2026-11-27), not typed from
// memory: the whole point of this feature is that no number in a tour is a guess.

export const FILM_TOUR_TEMPLATES = Object.freeze([
  {
    id: "got-northern-ireland",
    title: "Game of Thrones: the Causeway Coast",
    works: ["Q23572"],
    hub: { name: "Belfast", wikidata: "Q10686", lat: 54.5967, lng: -5.93 },
    minutes: 600,
    modes: ["walk", "car"],
    radiusKm: 130,
    like: "Coach day trips from Belfast run 9–11 hours: Dark Hedges, Ballintoy Harbour and the Giant's Causeway.",
  },
  {
    id: "got-dubrovnik",
    title: "Game of Thrones: King's Landing",
    works: ["Q23572"],
    hub: { name: "Dubrovnik", wikidata: "Q1722", lat: 42.6403, lng: 18.1083 },
    minutes: 180,
    modes: ["walk"],
    radiusKm: 30,
    like: "Old Town walking tours take about 2 hours; many add the 15-minute boat to Lokrum.",
  },
  {
    id: "got-malta",
    title: "Game of Thrones: Malta",
    works: ["Q23572"],
    hub: { name: "Valletta", wikidata: "Q23800", lat: 35.8978, lng: 14.5125 },
    minutes: 360,
    modes: ["walk", "car"],
    radiusKm: 40,
    like: "Half-day and day tours by minibus: Mdina Gate, Fort Manoel, Fort Ricasoli.",
  },
  {
    id: "got-iceland",
    title: "Game of Thrones: beyond the Wall",
    works: ["Q23572"],
    hub: { name: "Reykjavík", wikidata: "Q1764", lat: 64.1475, lng: -21.935 },
    minutes: 600,
    modes: ["walk", "car"],
    radiusKm: 200,
    like: "Day tours by jeep from Reykjavík, built around Þingvellir.",
  },
  {
    id: "hp-london",
    title: "Harry Potter: London on foot",
    works: ["Q102438", "Q102244", "Q102448", "Q102225", "Q102235", "Q161687", "Q161678", "Q232009"],
    hub: { name: "London", wikidata: "Q84", lat: 51.5072, lng: -0.1275 },
    minutes: 180,
    modes: ["walk"],
    radiusKm: 6,
    like: "Walking tours take 2.5–3 hours: King's Cross, Leadenhall Market, the Millennium Bridge.",
  },
  {
    id: "hp-oxford",
    title: "Harry Potter: Oxford",
    works: ["Q102438", "Q102244", "Q102448", "Q102225", "Q102235", "Q161687", "Q161678", "Q232009"],
    hub: { name: "Oxford", wikidata: "Q34217", lat: 51.7519, lng: -1.2578 },
    minutes: 120,
    modes: ["walk"],
    radiusKm: 4,
    like: "Two-hour college walks: Christ Church, the Bodleian, New College.",
  },
  {
    id: "hp-scotland",
    title: "Harry Potter: north from Edinburgh",
    works: ["Q102438", "Q102244", "Q102448", "Q102225", "Q102235", "Q161687", "Q161678", "Q232009"],
    hub: { name: "Edinburgh", wikidata: "Q23436", lat: 55.9533, lng: -3.1892 },
    minutes: 720,
    modes: ["walk", "car"],
    radiusKm: 250,
    like: "Coach day trips of about 12 hours reach the Glenfinnan Viaduct and Glencoe.",
  },
  {
    id: "outlander-scotland",
    title: "Outlander: central Scotland",
    works: ["Q15072906"],
    hub: { name: "Edinburgh", wikidata: "Q23436", lat: 55.9533, lng: -3.1892 },
    minutes: 600,
    modes: ["walk", "car"],
    radiusKm: 120,
    like: "Day tours of 9–10 hours: Midhope Castle, Culross, Doune Castle, Linlithgow.",
  },
  {
    id: "sound-of-music-salzburg",
    title: "The Sound of Music: Salzburg",
    works: ["Q60072"],
    hub: { name: "Salzburg", wikidata: "Q34713", lat: 47.8, lng: 13.045 },
    minutes: 240,
    modes: ["walk", "car"],
    radiusKm: 60,
    like: "The classic bus tour runs about 4 hours, out to the lakes and Mondsee.",
  },
  {
    id: "lotr-wellington",
    title: "The Lord of the Rings: Wellington",
    works: ["Q127367", "Q164963", "Q131074", "Q719915", "Q919649"],
    hub: { name: "Wellington", wikidata: "Q23661", lat: -41.2889, lng: 174.7772 },
    minutes: 300,
    modes: ["walk", "car"],
    radiusKm: 80,
    like: "Half-day minibus tours of about 4–5 hours: Mount Victoria, Kaitoke, the Hutt Valley.",
  },
  {
    id: "breaking-bad-albuquerque",
    title: "Breaking Bad: Albuquerque",
    works: ["Q1079"],
    hub: { name: "Albuquerque", wikidata: "Q34804", lat: 35.0844, lng: -106.6503 },
    minutes: 210,
    modes: ["walk", "car"],
    radiusKm: 40,
    like: "The trolley tour runs about 3.5 hours past the show's houses and shops.",
  },
  {
    id: "la-la-land-los-angeles",
    title: "La La Land: Los Angeles",
    works: ["Q20856802"],
    hub: { name: "Hollywood", wikidata: "Q34006", lat: 34.0983, lng: -118.3267 },
    minutes: 300,
    modes: ["walk", "car"],
    radiusKm: 40,
    like: "Hollywood bus tours run 2–5 hours; this one follows the film from Griffith to Hermosa.",
  },
  {
    id: "before-sunrise-vienna",
    title: "Before Sunrise: one night in Vienna",
    works: ["Q659609"],
    hub: { name: "Vienna", wikidata: "Q1741", lat: 48.2083, lng: 16.3725 },
    minutes: 180,
    modes: ["walk"],
    radiusKm: 8,
    like: "Self-guided walks follow the film's night across the centre.",
  },
]);

export function findFilmTourTemplate(id) {
  return FILM_TOUR_TEMPLATES.find((template) => template.id === id) ?? null;
}
