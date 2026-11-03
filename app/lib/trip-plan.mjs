// A day plan an outside agent can act on — and the labels that stop it lying.
//
// The owner plans his travel with a trip agent that is not this codebase. It wants
// something narrower than the map: "give me stops for an afternoon here, from these
// films, that I can actually walk to." Everything needed to answer that already existed
// in pieces — the queue reaches the map, `studio-lots.mjs` knows a fence from an address,
// `place-access.mjs` knows a gate from a street, `timed-tour.mjs` orders stops against a
// budget. What did not exist was one answer carrying all four at once.
//
// **The measurement that decided the shape of this file.** The obvious bridge is "export
// the verified graph". Measured against the city the owner is actually going to, on
// 2026-09-10 15:08 UTC:
//
//   places in the graph, worldwide                        70
//   places in the graph inside the Los Angeles viewport    1   — "Los Angeles", Q65,
//                                                              city precision, badge
//                                                              `approximate`
//   queue rows inside the same viewport                4,665   (1 verified, 4,664 pending)
//
// So a bridge that exports only what we have verified answers a Los Angeles day with one
// stop, and that stop is the city the traveller is standing in. The bridge is therefore
// built on candidates, and **the labelling is not a courtesy on top of the payload — it
// is the payload**. Every stop states who said it and whether anybody checked.
//
// The second measurement, over the same 4,665 rows: **150 (3.2%) are inside a studio lot
// and 4,515 (96.8%) are on the street.** The 96.8% is the product. The 150 are the thing
// that would embarrass us — a backlot street printed beside a real address sends somebody
// to a gate they cannot pass, which is precisely the failure [[three-axes]] exists for.

import { DISTANCE_INFLUENCE, DISTANCE_SELF } from "./facts.mjs";
import { haversineKm, isFinitePair } from "./geo.mjs";
import { libraryEntryFor } from "./media-library.mjs";
import { ACCESS, accessNote } from "./place-access.mjs";
import { isPinnable } from "./place-grade.mjs";
import { DEDUP_RADIUS_M, metresApart, normalizePlaceName } from "./place-dedup.mjs";
import { studioLotAccessNote, studioLotAt, studioLotSentence } from "./studio-lots.mjs";
import { createTimedTourCandidates, TOUR_BUDGETS } from "./timed-tour.mjs";
import { ROUTE_BLOCK_DISTANCES } from "./work-card.mjs";

// Why a stop did not make the walk. A reason is returned rather than the row being
// dropped, because an agent that cannot see what was removed will re-propose it from its
// own sources — and "Universal Studios" is exactly the row it would re-propose.
export const TRIP_EXCLUSION = Object.freeze({
  studio_lot_no_entry: "studio_lot_no_entry",
  studio_lot_needs_booking: "studio_lot_needs_booking",
  closed: "closed",
  not_a_route_stop: "not_a_route_stop",
  not_a_spot: "not_a_spot",
  not_in_library: "not_in_library",
  no_position: "no_position",
});

// How many stops the ordering may consider.
//
// `createTimedTourCandidates` runs a nearest-neighbour pass from each of 8 seeds, and each
// pass sorts the whole remaining set at every step — O(n² log n) per seed. Handing it the
// Los Angeles viewport whole means n = 4,515, which is not a planner, it is a hang. The
// pool is taken nearest-first from the origin, which is also the only ordering that means
// anything for a day plan: a stop 40 km up the coast was never a candidate for this
// afternoon.
export const TRIP_POOL_SIZE = 60;

// 2 is the walking router's floor (`validateRouteStops`) and 3 is the product's — the map
// has refused to build a route from fewer than three stops since the first tour shipped.
// A trip agent asking for a day gets the product's answer, not the router's.
export const TRIP_MIN_STOPS = 3;

function positionOf(row) {
  const lat = Number(row?.lat);
  const lng = Number(row?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // (0, 0) is not a place. Four Null Island incidents in this project, all from
  // `Number("")` being 0 and 0 being finite.
  if (lat === 0 && lng === 0) return null;
  return [lat, lng];
}

// A graph place and a queue row become the same shape here and are never allowed to
// become the same CLAIM. `verified` is set from which store the row came out of, not from
// any field on it, so there is no way for a candidate to acquire the flag by carrying a
// confidence somebody computed for something else.
function groundingForPlace(row) {
  return {
    verified: true,
    store: "graph",
    status: "verified",
    source_kind: row.wikidata_id ? "wikidata" : null,
    source_url: row.wikidata_id ? `https://www.wikidata.org/wiki/${row.wikidata_id}` : null,
    confidence_band: row.confidence_band ?? null,
    geocode_precision: row.geocode_precision ?? null,
  };
}

function groundingForCandidate(row) {
  // A grouped row carries the source on each film rather than on itself; the lead film is
  // the one that names the stop, so it is the one whose source is quoted.
  const lead = Array.isArray(row?.films) ? row.films[0] : null;
  return {
    verified: false,
    store: "queue",
    // "pending" means nobody has looked yet; "verified" here means a reviewer checked the
    // SOURCE, not that the place entered the graph. Both are printed as they are.
    status: row.status ?? lead?.status ?? "pending",
    source_kind: row.source_kind ?? lead?.source_kind ?? null,
    source_url: row.source_url ?? lead?.source_url ?? null,
    confidence_band: null,
    geocode_precision: null,
  };
}

// The queue reader changed shape underneath this file and nothing said so.
//
// `map_candidate_points_in_view` used to return one row per SUBMISSION — `submission_id`,
// `name`, `work_title`. Since 10.09 it returns one row per COORDINATE, carrying the films
// listed there: `place_name` and a `films` array. This file kept reading the old field
// names, so `row.name` was undefined, `.filter((stop) => stop.name)` dropped every queue
// row before anything could refuse it, and `POST /api/trip/plan` answered "No stops." for
// the whole of Los Angeles while reporting 162 candidates in view — the count and the
// answer disagreeing, with nothing in `excluded` to explain it.
//
// Both shapes are read, because the graph reader still returns the old one.
function normalizeRow(row) {
  const films = Array.isArray(row?.films) ? row.films : [];
  if (films.length === 0) return { row, films: [], lead: null };
  // Best-known first is the order the query already fixed; the lead names the stop and the
  // rest ride along in `works`, which is what makes a point with 39 films one stop.
  return { row, films, lead: films[0] };
}

// The films behind each graph place, in the shape a grouped queue row already carries.
//
// `map_points_in_view` answers a graph place with `work_count` and no titles, so every
// verified stop came back naming no film at all. Measured live 18.10 on Rome: the Spanish
// Steps stop had `work: null` and `works: []` — and because the library filter matches on
// titles, a traveller whose list held Roman Holiday and To Rome with Love got a plan of
// three unchecked queue rows, with the Spanish Steps, the Trevi Fountain and Piazza del
// Popolo — verified places from exactly those two films — refused as "not in library".
//
// `links` are work_place_links rows, `{ place_id, works: { id, title, year, kind } }`.
// Oldest first, so the film a place is known for leads rather than whichever row the
// database returned first.
export function attachPlaceFilms(places, links) {
  const byPlace = new Map();
  for (const link of Array.isArray(links) ? links : []) {
    const work = link?.works;
    if (!link?.place_id || !work?.title) continue;
    const films = byPlace.get(link.place_id) ?? [];
    if (!films.some((film) => film.work_id === work.id)) {
      films.push({ work_id: work.id ?? null, title: work.title, year: work.year ?? null, kind: work.kind ?? null });
    }
    byPlace.set(link.place_id, films);
  }
  return (Array.isArray(places) ? places : []).map((place) => {
    const films = byPlace.get(place?.place_id);
    if (!films || Array.isArray(place?.films)) return place;
    films.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title));
    return { ...place, films };
  });
}

// One stop, in the vocabulary the rest of the product already uses.
//
// `distance` is the fact's degree of separation ([[fact-architecture]]). It defaults to
// DISTANCE_SELF because a queue row is always a claim about the work itself; a distance-2
// row can only arrive from the graph, and `ROUTE_BLOCK_DISTANCES` refuses it below.
function toStop(row, { verified }) {
  const position = positionOf(row);
  const lot = position ? studioLotAt(position[0], position[1]) : null;
  const { films, lead } = normalizeRow(row);
  const name = String(row.name ?? row.place_name ?? "").trim();

  return {
    // A grouped row has no submission id — it is several of them — so the coordinate is
    // the identity, which is also what makes two films at one address one stop.
    id: verified
      ? `place:${row.place_id}`
      : (row.submission_id ? `submission:${row.submission_id}` : `point:${position?.join(",") ?? name}`),
    name,
    position,
    address: row.area_hint ?? null,
    distance: Number.isFinite(row.distance) ? row.distance : DISTANCE_SELF,
    work: {
      id: row.work_id ?? lead?.work_id ?? null,
      title: row.work_title ?? lead?.title ?? null,
      year: Number.isFinite(row.work_year) ? row.work_year
        : (Number.isFinite(lead?.year) ? lead.year : null),
      kind: row.work_kind ?? lead?.kind ?? null,
    },
    // Every film listed at this point, so the walk can say what a reader is standing in
    // front of rather than naming one of thirty-nine.
    works: films.map((film) => film.title).filter(Boolean),
    grounding: verified ? groundingForPlace(row) : groundingForCandidate(row),
    // Lifted out of `grounding` so the routing rule can read it without caring which
    // store the row came from. Null for a queue row, which has never been graded.
    geocode_precision: row.geocode_precision ?? null,
    // A lot's access is known from the lot itself and costs no network call — unlike a
    // street address, where silence stays `unknown` rather than becoming `open`.
    access: lot
      ? { verdict: lot.access, note: studioLotAccessNote(lot), source: "studio-lots" }
      : { verdict: ACCESS.unknown, note: accessNote(null), source: null },
    studio_lot: lot ? { slug: lot.slug, name: lot.name, access: lot.access } : null,
    depicts_elsewhere: Boolean(lot),
    // The sentence a reader needs before doing anything with the row. Null for the 96.8%
    // that are ordinary streets, because there is nothing to warn them about.
    note: lot ? studioLotSentence(lot, name) : null,
  };
}

// Which stops may be walked to, and why the others may not.
//
// The four refusals, in the order they are applied, each answering a different question:
//
//   distance 2      — is this even a stop? `ROUTE_BLOCK_DISTANCES` says an influence is
//                     not one. It is a fact about where an idea came from.
//   closed          — is there anything to walk to at all?
//   a working lot   — can the traveller pass the gate? `view_only` says no, ever.
//   a ticketed lot  — can they pass it TODAY, on foot, mid-walk? A studio tour is a
//                     booking and half a day. Routing a walk through one turns up at a
//                     gate that wants $110 and a reservation.
//
// A lot that is public land — Paramount Ranch is a National Park Service site — is KEPT.
// It is the case that proves the rule is about the gate and not about the word "studio".
// "none" is not an area. It is the grade a place gets when nobody could say how good its
// pin is — on the live London viewport it covered 113 verified places, from Westminster
// Abbey to The Shard (pinned on the Tower of London) and five rows sitting on the London
// centroid at Charing Cross. Refusing them is right; telling the traveller Westminster
// Abbey is "an area, not a spot" — "none precision" — is not.
function notASpotNote(precision) {
  if (String(precision ?? "").toLowerCase() === "none") {
    return "We do not know how precisely this place is pinned, so it is not routed to.";
  }
  return `The source names this area, not a spot inside it — ${precision} precision.`;
}

export function splitTripStops(stops, { includeStudioLots = false } = {}) {
  const eligible = [];
  const excluded = [];
  // Two notes, not one. `note` says what the place IS ("the camera was here; what it
  // filmed is set somewhere else") and `access_note` says whether you can get in ("a
  // working lot — the gate is as close as you get"). The first version collapsed them
  // with `??` and the lot sentence always won, so the refusal that matters most —
  // there is no way through this gate — never reached the caller at all.
  const refuse = (stop, reason) => excluded.push({
    id: stop.id,
    name: stop.name,
    position: stop.position,
    work: stop.work,
    reason,
    note: stop.note ?? (reason === TRIP_EXCLUSION.not_a_spot ? notASpotNote(stop.geocode_precision) : null),
    access_note: stop.access?.note ?? null,
    studio_lot: stop.studio_lot ?? null,
    grounding: stop.grounding,
  });

  for (const stop of Array.isArray(stops) ? stops : []) {
    if (!stop.position) { refuse(stop, TRIP_EXCLUSION.no_position); continue; }
    if (!ROUTE_BLOCK_DISTANCES.includes(stop.distance)) {
      refuse(stop, TRIP_EXCLUSION.not_a_route_stop);
      continue;
    }
    if (stop.access?.verdict === ACCESS.closed) { refuse(stop, TRIP_EXCLUSION.closed); continue; }

    // A city is not somewhere to stand.
    //
    // Found end to end against the live LA basin: the one verified place inside that
    // viewport is "Los Angeles" itself — Q65, `geocode_precision: city`, badge
    // `approximate`, carrying no films — and it was routed to as stop 3 of 5. It is the
    // best-evidenced row in the whole plan and the worst possible stop, which is exactly
    // the case [[three-axes]] is built on: "Skyfall was shot in Istanbul" can carry a
    // permit, an article and a frame match, and Istanbul is fifteen million people.
    //
    // `isPinnable` is the rule already written for this and it is applied only where a
    // precision was actually recorded. A queue row carries none, and reading its silence
    // as "too coarse" would delete 4,664 of the 4,665 Los Angeles rows — the same
    // absent-tag-means-no mistake `place-access.mjs` refuses in the other direction.
    if (stop.geocode_precision && !isPinnable(stop.geocode_precision)) {
      refuse(stop, TRIP_EXCLUSION.not_a_spot);
      continue;
    }

    const lot = stop.studio_lot;
    if (lot && !includeStudioLots) {
      if (lot.access === ACCESS.view_only) {
        refuse(stop, TRIP_EXCLUSION.studio_lot_no_entry);
        continue;
      }
      if (lot.access === ACCESS.ticketed) {
        refuse(stop, TRIP_EXCLUSION.studio_lot_needs_booking);
        continue;
      }
    }

    eligible.push(stop);
  }

  return { eligible, excluded };
}

// The traveller's own films, matched against the stops — and the reason this takes a list
// rather than reading one.
//
// The library lives in the browser's localStorage and has never been sent anywhere
// ([[personal-library]]). Nothing here reads it, stores it or logs it: the caller passes
// the titles it wants matched, this compares them, and the list is gone when the request
// ends. `libraryEntryFor` is the project's one matcher — same normaliser, same one-year
// tolerance — so a trip plan and the map filter can never disagree about which film matched.
export function filterStopsByLibrary(stops, library) {
  if (!Array.isArray(library) || library.length === 0) {
    return { kept: stops, dropped: [] };
  }
  const kept = [];
  const dropped = [];
  for (const stop of stops) {
    // Every film at the stop, not only the one that names it: a point holding 39 films
    // is the traveller's stop if ANY of them is theirs. The lead keeps its year; the rest
    // travel as titles, so they match on the title alone.
    const works = [
      { title: stop.work?.title, year: stop.work?.year, kind: stop.work?.kind },
      ...(stop.works ?? []).filter((title) => title !== stop.work?.title).map((title) => ({ title })),
    ];
    if (works.some((work) => work.title && libraryEntryFor(work, library))) kept.push(stop);
    else dropped.push({ ...stop, reason: TRIP_EXCLUSION.not_in_library });
  }
  return { kept, dropped };
}

// One building is one stop, however many ways our sources spell it.
//
// Found by running this planner against the live Hollywood viewport: the best 120-minute
// walk it produced had five stops, and three of them were Grauman's Chinese Theatre —
// "Grauman's Chinese Theatre" (moviemaps), "Grauman’s Chinese Theatre, Hollywood
// Boulevard, Hollywood, Los Angeles" and "Grauman's Chinese Theatre, Hollywood Boulevard,
// Hollywood" (movielocations), 11 m apart. `timed-tour.mjs` merges two works at one point
// only when the NAME matches exactly, so three spellings stayed three stops and the walk
// went in a circle. This is the same duplicate the handoff records against `city_catalogue`
// ("Broadgate Tower" beside "Broadgate Tower, Bishopsgate, London"), reaching a second query.
//
// **Why this is not `canMerge`.** [[place-dedup]]'s rule is written for the graph and turns
// on `geocode_precision` and `place_class`, which a queue row does not carry — every
// candidate falls to precision "none" and is refused, so `dedupePlaces` collapses nothing
// here. Loosening `canMerge` to fix that would loosen it for the graph too, where the
// six closest pairs we hold are all genuinely different places. So this asks a narrower
// question with the same primitives.
//
// **Why the prefix rule and not `namesMatch`.** `namesMatch` allows one extra word, on
// purpose — it is what stopped "Notting Hill Bookshop" being read as the district. Here
// the extra words are an address the source glued onto the name, which is four or five
// words, so `namesMatch` refuses all three Grauman's spellings. A word-boundary prefix
// within 40 m is the honest reading of that, and the risk is bounded in a way the OSM case
// was not: this compares two of OUR OWN rows, both already at the same spot, and a wrong
// merge costs one fewer stop rather than a false claim about where something was filmed.
// Nothing is discarded — the merged stop carries every source and every work behind it.
// Two rows on the same coordinate are one place to WALK TO, whatever they are called.
//
// The second duplicate the Hollywood measurement turned up, and the prefix rule cannot
// reach it: "The Hollywood Roosevelt" (moviemaps) and "Roosevelt Hotel, Hollywood
// Boulevard, Hollywood" (movielocations) sit on 34.10125, -118.34178 — the same point to
// five decimals — and neither name is a prefix of the other. Left apart they are two stops
// with a zero-metre leg between them.
//
// This is a claim about walking and not about identity, which is why it is allowed here
// and would not be allowed in [[place-dedup]]: routing somebody to one coordinate twice is
// wrong however the two rows are named, while the graph's question — are these the same
// PLACE — genuinely needs the name. Five metres rather than zero because the rows come
// from different geocoders and agree to about a building centroid, and both names are
// kept on the merged stop rather than the loser being deleted.
const SAME_POINT_M = 5;

function sameSpot(left, right) {
  const metres = metresApart(
    { lat: left.position[0], lng: left.position[1] },
    { lat: right.position[0], lng: right.position[1] },
  );
  if (metres === null || metres > DEDUP_RADIUS_M) return false;
  if (metres <= SAME_POINT_M) return true;

  const a = normalizePlaceName(left.name);
  const b = normalizePlaceName(right.name);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return longer.startsWith(`${shorter} `);
}

export function collapseSameSpot(stops) {
  const groups = [];
  for (const stop of Array.isArray(stops) ? stops : []) {
    // Every member, not just the first: merging is not transitive, and a group that
    // accepted a stop matching only its first member could chain two different venues
    // together through a shared middle name.
    const target = groups.find((group) => group.every((member) => sameSpot(member, stop)));
    if (target) target.push(stop);
    else groups.push([stop]);
  }

  return groups.map((group) => {
    // The shortest name wins: it is the venue, and the longer ones are the venue plus an
    // address the source appended. The coordinate comes from that same row rather than
    // being averaged into a spot no source ever named.
    const primary = [...group].sort((a, b) =>
      a.name.length - b.name.length || a.id.localeCompare(b.id))[0];
    if (group.length === 1) return primary;
    return {
      ...primary,
      merged_from: group.map((stop) => stop.id),
      merged_count: group.length,
      // A merged stop states every source behind it. Two sources agreeing on a place is
      // the strongest thing an unverified row can say, and throwing it away here would
      // lose the one signal the queue can offer.
      sources: [...new Set(group.map((stop) => stop.grounding.source_kind).filter(Boolean))],
      // The films of every row in the group, not just the survivor's. Dropping them was
      // the bug this collapse introduced and the live data caught: 25 rows for Grauman's
      // Chinese Theatre became one stop carrying "Forrest Gump" alone, losing the twenty
      // other films that are the entire reason to stand there.
      works: [...new Set(group.flatMap((stop) =>
        (stop.works?.length ? stop.works : [stop.work?.title]).filter(Boolean)))],
      // Kept so a merge on the coordinate alone can be read back. A stop the sources call
      // two things should say so rather than silently picking one.
      also_known_as: [...new Set(group.map((stop) => stop.name).filter((name) => name !== primary.name))],
    };
  });
}

// The nearest `TRIP_POOL_SIZE` to where the day starts. Ties break on id so the same
// request answers the same way twice — a plan that reshuffles between two identical calls
// is one an agent cannot cache or diff.
export function poolNearest(stops, origin, size = TRIP_POOL_SIZE) {
  const from = isFinitePair(origin) ? origin : stops[0]?.position;
  if (!isFinitePair(from)) return stops.slice(0, size);
  return [...stops]
    .sort((left, right) =>
      (haversineKm(from, left.position) - haversineKm(from, right.position))
      || left.id.localeCompare(right.id))
    .slice(0, size);
}

// One sentence stating what the plan is made of, printed before the stops.
//
// It exists because "4 stops in Los Angeles" and "4 unchecked candidates in Los Angeles"
// look identical in a payload and are not the same offer. An agent that renders the first
// wording over the second data is making our claim for us.
export function tripHonestyLine({ stops, verified, candidates }) {
  if (!stops) return "No stops.";
  if (verified === stops) return `All ${stops} stops are verified places from our graph.`;
  if (verified === 0) {
    return `None of these ${stops} stops is verified by us — ${candidates} `
      + `${candidates === 1 ? "is an unchecked candidate" : "are unchecked candidates"} `
      + "from our sources, each naming where it came from.";
  }
  return `${verified} of ${stops} stops are verified by us; the other ${candidates} `
    + "are unchecked candidates, each naming where it came from.";
}

// Which of the budget-fitting tours a DAY PLAN should take.
//
// `createTimedTourCandidates` ranks by stop count, then confirmed access, then **nearest
// to the origin** — right for the feature it was written for, a walking tour you start
// where you are standing. A day plan would rather traverse the stops than start next to
// them, so the bridge re-ranks what the planner returns instead of changing how it ranks:
// the tour feature keeps its ordering exactly, and nothing here can produce a tour the
// planner would have rejected.
//
// **Be honest about how much this buys: on the live Hollywood viewport it moved the walk
// from 5 minutes to 7**, and reordered it to cross the block rather than zig-zag across
// it. It does NOT fill the budget, and no ranking here could. Every candidate is built by
// nearest-neighbour from one of 8 seeds, and nearest-neighbour makes tight clusters by
// construction — against a 120-minute budget the longest tour available in Hollywood is
// seven minutes long. The budget is a ceiling, not a target, and `budget_note` below says
// so out loud rather than letting the caller read 120 and imagine an afternoon.
export function pickForBudget(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) return null;
  const mostStops = Math.max(...list.map((candidate) => candidate.stops.length));
  return list
    .filter((candidate) => candidate.stops.length === mostStops)
    .sort((left, right) =>
      right.estimatedMinutes - left.estimatedMinutes
      || right.confirmedStops - left.confirmedStops
      // Determinism: the same request must answer the same way twice, or an agent cannot
      // cache a plan or diff two of them.
      || left.stops.map((stop) => stop.id).join("|").localeCompare(
        right.stops.map((stop) => stop.id).join("|"),
      ))[0];
}

// Said when the walk uses less than half the budget. Half rather than any shortfall,
// because a 7-minute walk against 30 minutes is a normal compact cluster and does not need
// explaining; 7 against 120 does.
export function budgetNote(estimatedMinutes, budgetMinutes) {
  if (!estimatedMinutes || estimatedMinutes >= budgetMinutes / 2) return null;
  return `This walk is about ${estimatedMinutes} minutes against a ${budgetMinutes}-minute `
    + "budget. Film locations cluster, so a compact walk is the normal answer — widen the "
    + "viewport or plan another cluster to fill the rest of the time.";
}

// The plan, with no network in it.
//
// Ordering is `createTimedTourCandidates` rather than a second nearest-neighbour written
// here: it already merges two works at one physical point into one multi-film stop, it
// already refuses a closed place, and it already prefers the walk whose stops we can
// vouch for over the one that is 200 m shorter. A second implementation would drift from
// it, and the drift would be invisible.
export function buildTripPlan({
  places = [],
  candidates = [],
  origin = null,
  budgetMinutes = 120,
  library = null,
  includeStudioLots = false,
  includeCandidates = true,
} = {}) {
  if (!TOUR_BUDGETS.includes(budgetMinutes)) {
    throw new Error(`Budget must be one of ${TOUR_BUDGETS.join(", ")} minutes`);
  }

  const all = [
    ...places.map((row) => toStop(row, { verified: true })),
    ...(includeCandidates ? candidates.map((row) => toStop(row, { verified: false })) : []),
  ].filter((stop) => stop.name);

  const { eligible, excluded } = splitTripStops(all, { includeStudioLots });
  const { kept, dropped } = filterStopsByLibrary(eligible, library);
  const pool = poolNearest(collapseSameSpot(kept), origin);

  const ordered = createTimedTourCandidates(
    // `locationId` is deliberately NOT passed. `timed-tour.mjs` keys its multi-film merge
    // on it when present and falls back to name + coordinates when it is absent, and our
    // id is per SUBMISSION — one row per (work, place) pair. Passing it made every key
    // unique, so the merge never fired: measured on the live Hollywood viewport, the first
    // plan this file produced was five stops that were all Grauman's Chinese Theatre, once
    // each for Forrest Gump, Gangster Squad, The Majestic, Hollywood Homicide and The
    // Beverly Hillbillies, with an estimated walk of one minute. Withholding the id is what
    // makes a multi-film stop one stop.
    pool.map((stop) => ({
      id: stop.id,
      position: stop.position,
      place: stop.name,
      film: stop.work?.title ?? null,
      filmId: stop.work?.id ?? null,
    })),
    origin,
    budgetMinutes,
    { access: Object.fromEntries(pool.map((stop) => [stop.id, { access: stop.access.verdict }])) },
  );

  const byId = new Map(pool.map((stop) => [stop.id, stop]));
  const chosen = (pickForBudget(ordered)?.stops ?? []).map((stop, index) => {
    const source = byId.get(stop.id);
    return {
      order: index + 1,
      ...source,
      // Both merges, unioned. `collapseSameSpot` joins rows that are one building spelled
      // several ways; `timed-tour.mjs` joins rows that are one name at one point. Taking
      // only the second would throw away the first, which is how the twenty other films at
      // Grauman's went missing the first time.
      works: [...new Set([
        ...(source?.works ?? []),
        ...(stop.films ?? []),
        source?.work?.title,
      ].filter(Boolean))],
    };
  });

  const verified = chosen.filter((stop) => stop.grounding.verified).length;
  const counts = {
    stops: chosen.length,
    verified,
    candidates: chosen.length - verified,
    considered: pool.length,
    eligible: kept.length,
    excluded: excluded.length + dropped.length,
  };

  return {
    stops: chosen,
    // Ordered by reason so an agent can group them without re-sorting, and capped nowhere:
    // the whole point is that the caller sees what we refused.
    excluded: [...excluded, ...dropped].sort((a, b) => a.reason.localeCompare(b.reason)),
    counts,
    budgetMinutes,
    estimatedMinutes: pickForBudget(ordered)?.estimatedMinutes ?? 0,
    honesty: tripHonestyLine(counts),
    // The budget is a ceiling. Stated when the walk comes in far under it, because an
    // agent that asked for two hours and is handed seven minutes should be told to widen
    // the viewport or plan a second cluster — not left to infer it from two numbers.
    budget_note: budgetNote(pickForBudget(ordered)?.estimatedMinutes ?? 0, budgetMinutes),
    // Stated rather than implied. An agent reading `access: "unknown"` on 96.8% of stops
    // needs to know that is the truth about our coverage and not a bug in this response.
    caveat: "Access is read from OpenStreetMap and is mostly unknown; an absent tag never "
      + "means open. Studio lots are excluded from the walk because the gate is as close "
      + "as you get without a booking.",
    enough: chosen.length >= TRIP_MIN_STOPS,
  };
}
