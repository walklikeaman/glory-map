// A name that is one common noun says what KIND of place it is, not which one.
//
// The location guides write what a place plays in a film as a label — "Appears as
// "Bridge"", "Appears as "Street"", "Appears as "Funeral"" — and a story trail used that
// label as the stop's name. The Dark Knight's trail read "Bridge" for the Van Buren Street
// Bridge. As a scraped place name the same word is worse: a pin called "Road" cannot be
// found by anyone.
//
// Matched against a closed list, never by length or capitals: "Rules", "Koko" and
// "Strand" are one-word places that exist.

const GENERIC_WORDS = new Set([
  // places
  "street", "road", "lane", "avenue", "alley", "corner", "square", "bridge", "tunnel",
  "underpass", "overpass", "highway", "motorway", "roadblock", "tracks", "railway",
  "station", "platform", "train", "tube", "subway", "bus", "stop", "airport", "terminal",
  "ferry", "dock", "docks", "harbour", "harbor", "pier", "port", "river", "lake", "beach",
  "field", "forest", "woods", "hill", "hilltop", "park", "garden", "gardens", "cemetery",
  "graveyard", "church", "chapel", "cathedral", "house", "home", "flat", "apartment",
  "building", "office", "offices", "tower", "warehouse", "factory", "garage", "lobby",
  "rooftop", "roof", "basement", "hospital", "school", "college", "university", "library",
  "museum", "gallery", "prison", "jail", "court", "courthouse", "hotel", "motel", "resort",
  "restaurant", "cafe", "café", "diner", "bar", "pub", "club", "nightclub", "casino",
  "cinema", "theatre", "theater", "movie", "opera", "shop", "store", "market", "mall",
  "shopping", "center", "centre", "newsstand", "arches", "estate", "camp", "site", "set",
  "exterior", "interior", "entrance", "steps", "stairs", "courtyard", "car",
  // events a guide writes in place of a place
  "funeral", "wedding", "party", "concert", "execution", "shoot", "film", "chase",
  "crash", "fight", "celebration", "launch", "performance",
]);

// One word only. Measured on the 55k-row queue: a rule over every word of a longer name
// refused "Tower Bridge", "Park Lane" and "Victory Square" — real names built from common
// words — so two words are always a name here. Brackets count as words: "Alley (south of
// Cordova, west of Gore)" is an address.
export function isVaguePlaceName(name) {
  const text = String(name ?? "").trim().toLowerCase();
  return /^[\p{L}]+$/u.test(text) && GENERIC_WORDS.has(text);
}
