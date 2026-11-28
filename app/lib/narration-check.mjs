// A light fact check of the AI guide's words against the facts it was given (#69).
//
// The tour model writes one or two sentences per stop from our verified data (place, scene,
// description, the work, the city). It can still slip in a year, a figure or a name that
// nobody supplied, and a guide spoken aloud on the street is believed. So every number and
// every capitalised name in the text must appear in the supplied facts; a stop that says
// something we cannot back is not spoken as written. It is replaced by a sentence built
// from the data itself, and the response says how many were replaced.
//
// Deliberately strict and deliberately simple. A false alarm costs one plainer sentence;
// a missed one costs a made-up fact read out at the place it is about. Names are only
// checked in English: a guide in another language translates and transliterates, and a
// name check there would replace every stop.

function normalise(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "'");
}

// Numbers as written: "1999", "3", "2,000", "1.5". A lone "1" is too common ("one of") to
// mean anything, so single digits are only claims when they stand with a unit-like word;
// keeping it simple, single digits are ignored.
const NUMBER = /\d[\d,.]*\d|\d{2,}/g;

function numbersIn(text) {
  return (String(text ?? "").match(NUMBER) ?? []).map((value) => value.replace(/[,.]$/, "").replace(/,/g, ""));
}

// Capitalised words that do not open a sentence: names of people, places, works. Words
// every sentence may use with a capital are not names.
const NOT_NAMES = new Set(["i", "i'm", "i've", "i'd", "i'll", "mr", "mrs", "ms", "dr", "st"]);

function namesIn(text) {
  const names = [];
  const sentences = String(text ?? "").split(/(?<=[.!?:;])\s+|\n+/);
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    words.forEach((raw, index) => {
      const word = raw.replace(/^[^\p{L}\d]+|[^\p{L}\d']+$/gu, "").replace(/['’]s$/, "");
      if (index === 0 || !word) return;
      // Quoted titles open with a capital after a quote mark; still a name, still checked.
      if (/^\p{Lu}/u.test(word) && !NOT_NAMES.has(word.toLowerCase())) names.push(word);
    });
  }
  return names;
}

// What the text says that the facts do not. Empty when everything is backed.
export function unsupportedClaims(text, facts, { language = "en" } = {}) {
  const factText = normalise((Array.isArray(facts) ? facts : [facts]).filter(Boolean).join(" \n "));
  const factNumbers = new Set(numbersIn(factText));
  const claims = [];
  for (const number of numbersIn(text)) {
    if (!factNumbers.has(number) && !factText.includes(number)) claims.push(number);
  }
  if (language === "en") {
    for (const name of namesIn(text)) {
      if (!factText.includes(normalise(name))) claims.push(name);
    }
  }
  return [...new Set(claims)];
}

// The tour's length is a fact too: "a 60-minute walk" is what was asked for.
function locationFacts(location, { city, film, durationMinutes }) {
  return [
    location?.place, location?.scene, location?.description, location?.film,
    city, film?.title, film?.year ? String(film.year) : null,
    durationMinutes ? String(durationMinutes) : null,
  ];
}

// The scripted sentence for a stop whose words we could not back: our own data, in English.
export function scriptedStopLine(location) {
  const place = String(location?.place ?? "").trim();
  const scene = String(location?.scene ?? "").trim().replace(/[.!?]+$/, "");
  if (place && scene && normalise(scene) !== normalise(place)) return `${place}: ${scene}.`;
  return place ? `${place}.` : String(location?.description ?? "").trim();
}

// The tour as it may be spoken. Each stop carries `factCheck`: "ok", or "replaced" with the
// claims that were dropped. The intro is checked against every stop's facts together.
export function checkTour(tour, locations, { city, film, durationMinutes, language = "en" } = {}) {
  const byId = new Map((locations ?? []).map((location) => [location.id, location]));
  const allFacts = (locations ?? []).flatMap((location) => locationFacts(location, { city, film, durationMinutes }));
  let replaced = 0;

  const stops = (tour?.stops ?? []).map((stop) => {
    const location = byId.get(stop.locationId);
    const claims = unsupportedClaims(stop.narration, locationFacts(location, { city, film, durationMinutes }), { language });
    if (claims.length === 0) return { ...stop, factCheck: "ok" };
    replaced += 1;
    return { ...stop, narration: scriptedStopLine(location), factCheck: "replaced", unsupported: claims };
  });

  const introClaims = unsupportedClaims(tour?.intro, allFacts, { language });
  const intro = introClaims.length === 0
    ? tour?.intro
    : `${stops.length} stop${stops.length === 1 ? "" : "s"}${film?.title ? ` from ${film.title}` : ""}${city ? ` in ${city}` : ""}.`;
  // A title is written in Title Case, so every word has a capital: only its numbers count.
  const titleClaims = unsupportedClaims(tour?.title, allFacts, { language: "numbers-only" });
  const title = titleClaims.length === 0 ? tour?.title : (film?.title ? `${film.title} on foot` : "A film walk");

  return {
    ...tour,
    title,
    intro,
    stops,
    factCheck: {
      stops: stops.length,
      replaced,
      introReplaced: introClaims.length > 0,
      titleReplaced: titleClaims.length > 0,
    },
  };
}

function safeLink(url) {
  try {
    const parsed = new URL(String(url ?? ""));
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

// What the voice guide prints under its controls: where the words come from, and whether
// the AI's version was trimmed. `spokenIsStory` is true when the text being read is the
// tour's own narration rather than our data.
export function guideSourceNote({ location, spokenIsStory = false, factCheck = null } = {}) {
  const url = safeLink(location?.sourceUrl);
  const link = url
    ? { url, label: String(location?.sourceTitle ?? "").trim() || "the place's source" }
    : null;
  let note;
  if (!spokenIsStory || factCheck === "scripted") note = "Read from our record of this place.";
  else if (factCheck === "replaced") note = "The AI's line added something the sources don't say, so a plain line from our record is read instead.";
  else if (factCheck === "ok") note = "AI-written from our record of this place and checked against it.";
  else note = "AI-written from our record of this place.";
  return { link, note };
}
