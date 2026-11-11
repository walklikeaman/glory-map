// How the film card arranges what we know, and what it refuses to blur.
//
// `/api/work` already returns everything: each place with the sentence its source stated,
// its precision badge, its evidence count, and — since #129 — how many degrees it stands
// from the film. Nothing has ever rendered the last one. The card is where that stops
// being a column in a response and starts being the thing that keeps the product honest.
//
// **Distance is the spine.** The owner wants places reached through the crew and through
// what influenced a work, and that is also the way this product could quietly start lying:
// "Harry Potter places" becoming "places connected to anything Rowling ever touched". So
// the card never prints one flat list. It prints blocks, in order, and the block for
// distance 2 is worded so that nobody reads it as a stop on a walk.

import { DISTANCE_INFLUENCE, DISTANCE_PERSON, DISTANCE_SELF, distanceLabel } from "./facts.mjs";

// What each block promises, in the card's own words. `distanceLabel` gives the heading;
// this gives the sentence under it, which is where the promise is actually made or
// withheld.
const BLOCK_NOTE = {
  [DISTANCE_SELF]: "Filmed here, set here, or recorded here.",
  [DISTANCE_PERSON]: "Reached through the people who made it — they worked, lived or are remembered here.",
  [DISTANCE_INFLUENCE]:
    "Where an idea came from. Not a filming location, and not a stop on the walk.",
};

export const ROUTE_BLOCK_DISTANCES = Object.freeze([DISTANCE_SELF, DISTANCE_PERSON]);

// Group the card's places into blocks by distance, dropping blocks nobody has anything in.
//
// An empty block is not printed. A film with no crew places should not show an empty
// "Through the people who made it" heading — a heading over nothing reads as a gap in the
// data rather than as an absence of that kind of fact.
export function placeBlocks(places) {
  const byDistance = new Map();
  for (const place of Array.isArray(places) ? places : []) {
    const distance = Number.isFinite(place?.distance) ? place.distance : DISTANCE_SELF;
    if (!byDistance.has(distance)) byDistance.set(distance, []);
    byDistance.get(distance).push(place);
  }

  return [...byDistance.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([distance, items]) => ({
      distance,
      heading: distanceLabel(distance),
      note: BLOCK_NOTE[distance] ?? BLOCK_NOTE[DISTANCE_SELF],
      // A block whose places may be walked to is the route; distance 2 is not, and the
      // flag travels with the block so the button cannot appear over the wrong one.
      routable: ROUTE_BLOCK_DISTANCES.includes(distance),
      places: items,
    }));
}

// One line stating coverage, printed before the blocks.
//
// It exists because thin coverage and a broken page look identical otherwise. 39.8% of the
// works in the queue have exactly one place; a card that shows one pin with no comment
// invites the reader to assume something failed.
export function coverageLine({ places, tally, candidates = 0 }) {
  const all = Array.isArray(places) ? places : [];
  // The number the QUEUE holds, not the number this page prints. They differ on a work
  // with more candidates than a card should list, and printing the display cap as the
  // count is the silent-truncation failure this project has agreed not to ship.
  const waiting = Math.max(0, Number(candidates) || 0);

  if (all.length === 0) {
    // A card with nothing checked but a queue behind it used to say "No places recorded",
    // which was true of the graph and false of the page directly under it. Measured 18.08:
    // that was 6,378 of the 6,392 works the directory addresses.
    return waiting > 0
      ? `${waiting} place${waiting === 1 ? "" : "s"} reported by location guides, not confirmed yet. See below.`
      : "No places recorded for this work yet.";
  }

  const routable = all.filter((place) => place.routable !== false).length;
  const nearby = all.length - routable;
  const onLocation = Number(tally?.on_location ?? 0);

  const parts = [`${all.length} place${all.length === 1 ? "" : "s"}`];
  if (onLocation > 0) parts.push(`${onLocation} filmed on location`);
  if (nearby > 0) parts.push(`${nearby} nearby rather than in the film`);
  // Counted separately from the places, never added to them: the number before the dot is
  // what we stand behind, and this is what we have not checked.
  if (waiting > 0) parts.push(`${waiting} more unconfirmed`);
  return `${parts.join(" · ")}.`;
}

// The sentence over the candidates block. It states the source of the rows and the fact
// that nobody has checked them, because the block below is the only part of this card
// that is not something we are willing to assert.
export function candidatesNote(shown, total = shown) {
  const n = Math.max(0, Number(shown) || 0);
  const all = Math.max(n, Number(total) || 0);
  if (all === 0) return null;
  // When the card cannot print them all, it says so. Person of Interest holds 961 rows,
  // and a page that lists 60 of them without a word reads as though 60 were all there is.
  const count = all > n
    ? `${n} of ${all} places`
    : `${n} place${n === 1 ? "" : "s"}`;
  return `${count} reported by a source, not confirmed yet. Each one links to where it was reported.`;
}

// Which stills may be shown and what the caption is allowed to claim.
//
// Two tiers, and conflating them is the failure this project already shipped once. A frame
// matched to a place carries a `place_frames` row and may say so. Everything else is a
// picture from the film's gallery: real, and evidence of nothing about any street.
export function stillsCaption({ stills, verified, note }) {
  const count = Array.isArray(stills) ? stills.length : 0;
  if (count === 0) return null;
  if (note) return note;
  return verified
    ? "Frames checked against this film's places."
    : "Frames from the film. Not matched to any location.";
}

// The external links a card may print for the work itself, already filtered. `/api/work`
// builds them from ids we hold; a work we hold no id for gets none rather than a row of
// dead buttons.
export function workLinks(links) {
  return (Array.isArray(links) ? links : []).filter((link) => link?.url && link?.label);
}

// ---------- UX-7: lead with a picture and a map, not 18,000 px of text ----------

// How many rows a block prints before "Show all". Ten fits a phone screen or two; the
// rest stay on the page (it is server-rendered and indexed) behind a <details>.
export const FIRST_PLACES = 10;

export function firstAndRest(list, limit = FIRST_PLACES) {
  const all = Array.isArray(list) ? list : [];
  return { first: all.slice(0, limit), rest: all.slice(limit) };
}

function finite(value) {
  const n = typeof value === "number" ? value : Number(value);
  return value !== null && value !== "" && Number.isFinite(n) ? n : null;
}

// The pins the mini-map draws: every place and every unconfirmed row with a usable
// coordinate, as [lat, lng] with a flag for which kind it is. Null Island is dropped,
// for the same reason the place card drops it.
export function miniMapPoints({ places = [], candidates = [] } = {}) {
  const toPoint = (row, confirmed) => {
    const lat = finite(row?.lat);
    const lng = finite(row?.lng);
    if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { position: [lat, lng], confirmed, name: row?.name ?? null };
  };
  return [
    ...(Array.isArray(places) ? places : []).map((row) => toPoint(row, true)),
    ...(Array.isArray(candidates) ? candidates : []).map((row) => toPoint(row, false)),
  ].filter(Boolean);
}

// Where "Open on the map" lands: the median point, not the mean, so one stray location on
// another continent does not drop the reader in the ocean between them.
export function mapLinkFor(points, { zoom = 13 } = {}) {
  const list = Array.isArray(points) ? points : [];
  if (!list.length) return null;
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const lat = median(list.map((point) => point.position[0]));
  const lng = median(list.map((point) => point.position[1]));
  return `/?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&z=${zoom}`;
}
