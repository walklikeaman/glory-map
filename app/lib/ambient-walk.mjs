// The guide that talks about what you walk past, without a route (#190).
//
// Walk mode already speaks on arrival — but only at the stops of a route somebody built
// first. This is the other way round: the trigger set is whatever is near the walker
// now, re-read as they move, and nothing has to be chosen before leaving the house.
//
// ---------------------------------------------------------------------------------------
//
// **The data is no longer sparse, and it is bunched.** #190 was written against a graph
// of 70 places and predicted one trigger every two kilometres. Measured on 2026-09-21,
// after the queue was promoted, with the 45 m radius walk mode already uses:
//
//   Hollywood Blvd, La Brea → Vine → Sunset   2.0 km   28 places   one every 72 m
//   Downtown LA, Broadway 3rd → 9th → Spring  3.0 km   35 places   one every 85 m
//   London, Trafalgar Sq → Soho → Covent Gdn  1.6 km   16 places   one every 97 m
//
// Walked in simulation at 4.2 km/h with a fix every 5 s, the real feed and the real
// sentences, the guide spoke 20, 24 and 8 times and was TALKING only 15%, 12% and 5% of
// the walk — a telling lasts 7 to 22 seconds. The places come in clusters (the Broadway
// theatres, a block of Soho), so the silences between clusters run to 4, 15 and 10
// minutes. Neither "one every two kilometres" nor "the guide never stops" is what this
// data does; the work here is choosing within a cluster: one voice at a time, a short
// breath after it, the better-evidenced place first, and never one building twice
// under two names.
//
// **The radius stays at 45 m.** Widening it was the plan when the data was sparse; now
// it only adds places across the block that the walker is not looking at.
//
// **What is said about an unchecked place is decided here, before any of it is spoken.**
// A hollow pin reads as "not checked" at a glance. Said into headphones in front of a
// building it reads as fact, and the walker cannot see the outline. So the qualifier
// comes FIRST — a sentence cut off after the claim must not be a stronger claim than we
// hold — and the source is named, because a spoken sentence needs a source a listener
// could check.

import { haversineKm, isLatLng } from "./geo.mjs";
import { DEFAULT_TRIGGER_RADIUS_M, isUsableFix } from "./geo-trigger.mjs";
import { describedFilms, sceneNote, sourceLabel } from "./place-note.mjs";

export const AMBIENT_RADIUS_M = DEFAULT_TRIGGER_RADIUS_M;

// The neighbourhood fetched around the walker, and how far they may move before it is
// fetched again. The margin between the two (130 m) is always wider than the trigger
// radius, so a place cannot come into range without first being in the feed.
export const FEED_HALF_SIZE_M = 250;
export const FEED_REFRESH_M = 120;

// Two pins this close are one building to somebody standing in front of it. After one
// speaks, the other is treated as spoken: "Pantages Theatre" from the graph and
// "Hollywood Pantages Theatre" from the queue are not two stops.
export const SAME_SPOT_M = 30;

// A breath after each telling, so two places in a cluster are not read back to back.
// Short on purpose: in the simulation above a 15 s gap cost one or two tellings per walk
// and a 60 s gap cost five to seven, while talking time was already at most 15%.
export const QUIET_GAP_MS = 15_000;

// Two films, then a count. A walker can hold two titles; a list of six is a
// catalogue read aloud, and the next place arrives before it ends.
export const MAX_SPOKEN_FILMS = 2;

function metres(a, b) {
  if (!isLatLng(a) || !isLatLng(b)) return null;
  return haversineKm(a, b) * 1000;
}

export function coordsOf(position) {
  if (isLatLng(position)) return position;
  return isLatLng(position?.coords) ? position.coords : null;
}

// A degree box around a point, metres converted at that latitude.
export function feedBox(position, halfSizeM = FEED_HALF_SIZE_M) {
  const at = coordsOf(position);
  if (!at) return null;
  const dLat = halfSizeM / 111_320;
  const dLng = halfSizeM / (111_320 * Math.max(0.2, Math.cos((at[0] * Math.PI) / 180)));
  return { south: at[0] - dLat, north: at[0] + dLat, west: at[1] - dLng, east: at[1] + dLng };
}

export function feedNeedsRefresh(lastCentre, position, { refreshM = FEED_REFRESH_M } = {}) {
  const at = coordsOf(position);
  if (!at) return false;
  if (!coordsOf(lastCentre)) return true;
  return metres(coordsOf(lastCentre), at) >= refreshM;
}

// The map's own response → one flat list of places to speak about. Checked places and
// queue points stay distinguishable all the way to the sentence, because that
// difference is the one thing the wording must never lose.
export function nearbyFromMapResponse(payload) {
  const places = [];
  for (const feature of Array.isArray(payload?.features) ? payload.features : []) {
    const [lng, lat] = feature?.geometry?.coordinates ?? [];
    const props = feature?.properties ?? {};
    if (!isLatLng([lat, lng]) || !props.place_id) continue;
    places.push({
      id: `place:${props.place_id}`,
      placeId: props.place_id,
      checked: true,
      name: props.name ?? null,
      position: [lat, lng],
      workCount: Number(props.work_count) || 0,
      shotOnSet: props.shot_on_set === true,
    });
  }
  for (const feature of Array.isArray(payload?.candidates) ? payload.candidates : []) {
    const [lng, lat] = feature?.geometry?.coordinates ?? [];
    const props = feature?.properties ?? {};
    if (!isLatLng([lat, lng])) continue;
    places.push({
      id: `candidate:${lat.toFixed(5)},${lng.toFixed(5)}`,
      checked: false,
      name: props.name ?? null,
      position: [lat, lng],
      workCount: Number(props.work_count) || 0,
      films: Array.isArray(props.films) ? props.films : [],
    });
  }
  return places;
}

// Which place speaks now, if any. At most one, and none while the guide is already
// talking or still inside its quiet gap.
//
// Among places in range the better-evidenced one wins: a checked place over a queue
// point, then the place more works were shot at, then the nearer. Nearest-first alone
// would pick whichever pin the geocoder happened to put closest to the pavement.
export function pickAmbient(places, position, {
  radiusM = AMBIENT_RADIUS_M,
  spoken = [],
  busy = false,
  now = Date.now(),
  quietUntil = 0,
} = {}) {
  if (busy || now < quietUntil) return null;
  if (!isUsableFix(position)) return null;
  const at = coordsOf(position);

  const spokenIds = new Set(spoken.map((entry) => entry.id));
  const spokenSpots = spoken.map((entry) => entry.position).filter(isLatLng);

  const inRange = [];
  for (const place of Array.isArray(places) ? places : []) {
    if (!place?.id || spokenIds.has(place.id)) continue;
    const distance = metres(at, place.position);
    if (distance === null || distance > radiusM) continue;
    // The same building under another name, already told.
    if (spokenSpots.some((spot) => (metres(spot, place.position) ?? Infinity) <= SAME_SPOT_M)) continue;
    inRange.push({ place, distance });
  }

  inRange.sort((left, right) =>
    Number(right.place.checked) - Number(left.place.checked)
    || right.place.workCount - left.place.workCount
    || left.distance - right.distance);

  return inRange[0] ? { place: inRange[0].place, distance_m: Math.round(inRange[0].distance) } : null;
}

function yearOf(value) {
  const year = Number(value);
  return Number.isInteger(year) && year > 1880 && year < 2100 ? year : null;
}

function titled(title, year) {
  const when = yearOf(year);
  return when ? `${title}, ${when}` : title;
}

function sentenceEnd(text) {
  const value = String(text ?? "").trim().replace(/…$/, "");
  if (!value) return "";
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function andMore(count) {
  if (count <= 0) return "";
  return count === 1 ? " And one more film." : ` And ${count} more films.`;
}

// A checked place, from the graph's own sentences. Each one was written against a
// source and already carries the claim at the strength we hold it; nothing is added —
// not even the place's name, which every one of those sentences already says.
export function checkedPlaceText({ facts }) {
  const sentences = (Array.isArray(facts) ? facts : [])
    .filter((fact) => fact?.subject_type === "work" && typeof fact.sentence === "string" && fact.sentence.trim())
    .map((fact) => sentenceEnd(fact.sentence));
  const unique = [...new Set(sentences)];
  if (unique.length === 0) return null;

  const told = unique.slice(0, MAX_SPOKEN_FILMS);
  return `${told.join(" ")}${andMore(unique.length - told.length)}`.trim();
}

// A queue point. The qualifier and the source come first, then the film, then what the
// source says happened here — so that stopping the audio at any point leaves the
// listener with no more than we know.
function spokenList(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function candidatePlaceText({ name, films }) {
  // Each listing is trimmed against the address ITS source wrote, not the pin's name:
  // the queue groups "Pantages Theatre, Hollywood Boulevard, Hollywood" under "Hollywood
  // Pantages Theatre", and read against the pin's name the address survived and was
  // spoken aloud after every film.
  const trimmed = (Array.isArray(films) ? films : []).map((film) => ({
    ...film,
    note: sceneNote(film?.note, { placeName: film?.place_name ?? name, limit: 120 }),
  }));
  const described = describedFilms(trimmed, { placeName: name, limit: 120 })
    .filter((film) => typeof film?.title === "string" && film.title.trim())
    .sort((left, right) => (Number(right.imdb_votes) || 0) - (Number(left.imdb_votes) || 0));
  if (described.length === 0) return null;

  // Named, not summarised: "film location sites" is not a source anybody can check.
  const sources = [...new Set(described.map((film) => sourceLabel(film.source_kind)))];
  const source = spokenList(sources.slice(0, 3));
  const verb = sources.length === 1 ? "lists" : "list";
  const told = described.slice(0, MAX_SPOKEN_FILMS);

  const lines = told.map((film) => {
    const head = titled(film.title.trim(), film.year);
    return film.note ? `${head}: ${sentenceEnd(film.note)}` : `${head}.`;
  });

  const where = name ? ` ${sentenceEnd(name).replace(/\.$/, "")}` : " this place";
  return `Not confirmed yet. ${source} ${verb}${where} as a filming location. ${lines.join(" ")}${andMore(described.length - told.length)}`
    .replace(/\s+/g, " ")
    .trim();
}

// How long a telling will last. Measured on four real tellings through /api/narration
// with the neutral voice: 12.4 to 15.0 characters a second, 13 as a middle.
export const SPOKEN_CHARS_PER_SECOND = 13;

export function spokenSeconds(text) {
  return Math.max(3, Math.round(String(text ?? "").length / SPOKEN_CHARS_PER_SECOND));
}

// The sentence for one place. A checked place is read from /api/place, whose sentences
// are the graph's own; a queue point already carries its listings in the feed. Null
// means there is nothing sourced to say, and then nothing is said.
export async function tellingFor(place, { fetchImpl = (...args) => fetch(...args), signal } = {}) {
  if (!place) return null;
  if (!place.checked) return candidatePlaceText(place);
  const response = await fetchImpl(`/api/place?id=${encodeURIComponent(place.placeId)}`, { signal });
  if (!response?.ok) return null;
  const payload = await response.json();
  return checkedPlaceText({ facts: payload?.facts });
}

// The map endpoint the feed reads, for a box around the walker. Zoom 17 so the answer is
// individual places rather than clusters, and the queue asked for explicitly.
export function feedUrl(position) {
  const box = feedBox(position);
  if (!box) return null;
  const query = new URLSearchParams({
    west: box.west.toFixed(6), south: box.south.toFixed(6),
    east: box.east.toFixed(6), north: box.north.toFixed(6),
    z: "17", candidates: "1",
  });
  return `/api/map/points?${query}`;
}

// What a built trail says on arrival: the graph's sentence for THIS work at this place.
// Not every film shot there — the walker chose a film, and a stop that lists five
// others is a stop about something else. Null when the stop carries no sentence, and
// then the arrival is silent rather than invented.
export function trailStopText(stop) {
  const sentence = typeof stop?.sentence === "string" ? stop.sentence.trim() : "";
  return sentence ? sentenceEnd(sentence) : null;
}
