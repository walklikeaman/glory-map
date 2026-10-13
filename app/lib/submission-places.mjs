// The queue, on the map.
//
// Measured 05.08: the database holds **38,270 submissions, every one of them pending,
// 30,212 with a coordinate**, covering 6,054 works — and **not one route in `app/` reads
// that table**. The live map answers from Wikidata alone, which is why a title search
// finds places for 15 works while the ingest has facts for six thousand.
//
// So this is not a new source. It is the door to the work we already did.
//
// WHAT IT MUST NOT DO is promote them. A submission is `pending` because nobody has
// checked it: it arrives on the map as a CANDIDATE — the same hollow pin, the same
// "unverified" note and the same link to its source as an inverted-search hit — and it
// stays out of `places`, out of the graph, and out of anything that claims to be
// verified. Showing an unchecked claim, labelled as unchecked, is honest. Quietly
// turning 30,000 of them into map pins that look like the verified ones would undo the
// whole grounding rule in one commit.

import { finiteOrNull } from "./numbers.mjs";
import { metresApart, namesMatch } from "./place-dedup.mjs";
import { studioLotAccessNote, studioLotAt, studioLotSentence } from "./studio-lots.mjs";

export const SUBMISSION_RELATION_KIND = "candidate";

// Owner's decision, 05.08: take every source and mark it unverified rather than throwing
// candidates away. "Somebody said something happened here" is a lead worth showing, as
// long as the card says exactly that and links to whoever said it.
//
// The list is kept — empty — because the mechanism is the point: the day a source has to
// be pulled from the product, this is where it goes, and no other code has to change.
export const REFUSED_SOURCES = Object.freeze([]);

// What each source is called on the card, and what its link is called.
const SOURCE_LABELS = {
  moviemaps: { evidence: "moviemaps", title: "MovieMaps entry", who: "MovieMaps" },
  wikipedia: { evidence: "wikipedia_extract", title: "Wikipedia article", who: "Wikipedia" },
  permit_record: { evidence: "film_permit", title: "Filming permit record", who: "a city filming permit" },
  reelstreets: { evidence: "reelstreets", title: "Reelstreets entry", who: "Reelstreets" },
  movielocations: { evidence: "movielocations", title: "MovieLocations entry", who: "MovieLocations" },
  // A named wiki page at a named revision. "a fan wiki" rather than the wiki's own name,
  // because the reader needs to know the KIND of source before they need to know which
  // one — and the link goes to the exact revision the claim was read from.
  fandom: { evidence: "fandom", title: "The wiki page this came from", who: "a fan wiki" },
  // The only source whose sentence a person can check by standing in front of it.
  // A signed-in reader's suggestion that a moderator has checked (#48). It reaches the
  // queue only as `verified`, and the link is the page the moderator checked it against.
  reader: { evidence: "reader", title: "The page it was checked against", who: "a reader, checked by us" },
  open_plaques: {
    evidence: "open_plaques",
    title: "The plaque on the wall",
    who: "a commemorative plaque at this address",
  },
};

export function isRefusedSource(sourceKind) {
  return REFUSED_SOURCES.includes(String(sourceKind ?? ""));
}

// How this row was tied to the work the person searched for. It belongs on the card,
// because the two are not equally strong and pretending otherwise is the quiet kind of
// lie this project keeps finding in itself.
export const MATCHED_BY = Object.freeze({
  id: "id",       // the same IMDb or TMDB identifier — one work, no doubt
  title: "title", // the same title and kind — probably the same work, possibly a namesake
});

// A sentence that says exactly what this is: somebody's claim, from a named source, not
// yet checked by us. The source's own sentence leads when it has one — a permit record
// and a Wikipedia line both say more than any template could.
// A row that has been through the review and survived it. It is still NOT a place in the
// graph — nothing here is — but "nobody has looked at this" and "we looked, and the
// source is one a stranger can check" are different sentences, and saying the first about
// the second is its own small dishonesty.
function checkedNote(row) {
  if (row?.status !== "verified") return "";
  const reason = String(row?.status_reason ?? "").trim();
  return reason
    ? ` We have checked the source: ${reason}. It is still a candidate, not part of our graph.`
    : " We have checked the source. It is still a candidate, not part of our graph.";
}

// A row whose coordinate falls inside a studio lot, said before anything else on the row.
//
// It leads because it changes what the address MEANS. "860 N Gower St, Los Angeles" reads
// as somewhere to walk to, and it is Paramount's New York backlot — the Cloverfield row
// that names it is about New York. Printing the street first and the lot later, or not at
// all, is how a reader ends up outside a gate expecting a city block.
function studioLotPrefix(row) {
  return studioLotSentence(studioLotAt(row?.lat, row?.lng), row?.place_name);
}

function submissionDescription(row, workTitle, matchedBy) {
  const place = row.place_name;
  const who = SOURCE_LABELS[row.source_kind]?.who ?? "an external source";
  const stated = String(row.source_sentence ?? "").trim();
  const checked = checkedNote(row);
  const lot = studioLotPrefix(row);
  // Said plainly rather than hedged: the title matched, the identifier did not, and a
  // work can share a title with a different work — Doctor Who is two series under one
  // name, and Gladiator is two films.
  const caveat = matchedBy === MATCHED_BY.title
    ? ` Matched to ${workTitle} by title, not by identifier — check it is the same work.`
    : "";

  const unchecked = checked ? "" : " Not yet verified by us.";
  // The lot goes in front of the source's own sentence rather than replacing it: the
  // source said something and we do not get to overwrite it, but a reader must not reach
  // the end of the row before learning they cannot go there.
  const head = lot ? `${lot} ` : "";
  if (stated) {
    return `${head}${stated} — recorded for ${workTitle} by ${who}.${unchecked}${checked}${caveat}`;
  }
  return `${head}${place} is listed as a location for ${workTitle} by ${who}.${unchecked}${checked}${caveat}`;
}

export function submissionToLocation(row, { work, kind, matchedBy = MATCHED_BY.id }) {
  const lat = finiteOrNull(row?.lat);
  const lng = finiteOrNull(row?.lng);
  if (lat === null || lng === null) return null;
  if (!String(row?.place_name ?? "").trim()) return null;

  const labels = SOURCE_LABELS[row.source_kind] ?? { evidence: "submission", title: "Source record" };

  return {
    work_wikidata_id: work.id,
    work_title: work.title,
    work_year: work.year ?? null,
    kind,
    // It is a queue row, not a canonical place. The id says which one, so a reviewer can
    // find it, and no part of the app can mistake it for a Wikidata item.
    loc_wikidata_id: null,
    loc_source_id: `submission:${row.id}`,
    loc_name: row.place_name,
    lat,
    lng,
    commons_image: null,
    film_tmdb_id: null,
    relation_kind: SUBMISSION_RELATION_KIND,
    relation_property: null,
    relation_label: row.status === "verified"
      ? (matchedBy === MATCHED_BY.title ? "Source checked · matched by title" : "Source checked")
      : (matchedBy === MATCHED_BY.title ? "In review · matched by title" : "In review"),
    review_status: row.status ?? "pending",
    relation_description: submissionDescription(row, work.title, matchedBy),
    matched_by: matchedBy,
    // Same flag as the card's, so a pin on a backlot cannot be drawn as a street address
    // on one surface and a soundstage on the other.
    depicts_elsewhere: Boolean(studioLotAt(lat, lng)),
    // The area the source named, when it gave one — "Top of Bevington Road" is more use
    // than a dot, and it is what a reviewer checks against.
    place_types: row.area_hint ? [row.area_hint] : [],
    evidence_source: labels.evidence,
    source_title: labels.title,
    source_url: row.source_url ?? null,
  };
}

// The same place found twice is the map contradicting itself, and here it is likely:
// MovieMaps and Wikidata both know Alnwick Castle.
export function isAlreadyShown(candidate, shown) {
  return (Array.isArray(shown) ? shown : []).some((known) => {
    if (!namesMatch(candidate.loc_name, known.loc_name)) return false;
    const metres = metresApart(
      { lat: candidate.lat, lng: candidate.lng },
      { lat: known.lat, lng: known.lng },
    );
    return metres !== null && metres <= 150;
  });
}

// Nearest to what the person is looking at, and bounded. Person of Interest alone has
// 961 rows in the queue; a map that draws all of them is not a map.
export function selectSubmissionPlaces(rows, {
  work, kind, center, limit = 12, exclude = [], matchedBy = MATCHED_BY.id,
}) {
  const shown = [...exclude];
  const chosen = [];

  const ordered = (Array.isArray(rows) ? rows : [])
    .filter((row) => !isRefusedSource(row?.source_kind))
    .map((row) => submissionToLocation(row, { work, kind, matchedBy: row.matched_by ?? matchedBy }))
    .filter(Boolean)
    .map((location) => ({
      location,
      metres: metresApart(
        { lat: location.lat, lng: location.lng },
        { lat: finiteOrNull(center?.lat) ?? 0, lng: finiteOrNull(center?.lng) ?? 0 },
      ) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) => left.metres - right.metres);

  for (const { location } of ordered) {
    if (chosen.length >= limit) break;
    if (isAlreadyShown(location, shown)) continue;
    chosen.push(location);
    shown.push(location);
  }

  return chosen;
}

// ---------- the same rows, on the film card (#158) ----------
//
// Measured 18.08 while building the directory: the graph holds 92 facts across 15 works,
// and `catalogue_index` — the view the directory is built on — holds 6,392. So **14 of
// 6,392** works reachable from the directory had anything at all to show on their card.
// A directory whose every row led to "No places recorded for this work yet" would be a
// signpost to six thousand empty rooms, which is a worse answer to #158 than no directory.
//
// So the card shows these rows too, under the same rule the map has followed since 05.08:
// a candidate is shown, labelled as a candidate, with a link to whoever said it, and it
// does NOT become a fact. It is kept out of `placeBlocks` entirely rather than given a
// distance — a fact has an identity, a subject and a degree of separation
// ([[fact-architecture]]), and a queue row has none of those. Handing it a distance of 0
// would make it indistinguishable from something we checked.
//
// The sentence is built by the same `submissionDescription` the map uses. Two copies of
// "not yet verified by us" is how one of them quietly stops being true.

// Verified-then-alphabetical. A row somebody has actually looked at leads, and the rest
// is a stable order rather than whatever the database returned.
const CANDIDATE_ORDER = { verified: 0, pending: 1 };

// A row that can be put on a map leads one that cannot. Both are shown — the second is
// still a name, a sentence and a source — but a reader scanning a card is best served by
// the ones they could walk to first.
function candidateRank(candidate) {
  return (CANDIDATE_ORDER[candidate.status] ?? 2) * 2 + (candidate.mappable ? 0 : 1);
}

export function submissionToCandidate(row, { work, matchedBy = MATCHED_BY.id } = {}) {
  const name = String(row?.place_name ?? "").trim();
  if (!name) return null;

  const labels = SOURCE_LABELS[row?.source_kind] ?? { title: "Source record", who: "an external source" };
  const lat = finiteOrNull(row?.lat);
  const lng = finiteOrNull(row?.lng);
  const lot = studioLotAt(lat, lng);

  return {
    id: row?.id ?? null,
    name,
    // The badge carries the review state, because on this block that is the single thing
    // a reader most needs to know before believing anything else on the row.
    precision: row?.status === "verified" ? "Source checked" : "In review",
    sentence: submissionDescription(row, work?.title ?? "this work", matchedBy),
    // Whoever said it, in the meta line. Never "filmed on location": nobody has checked.
    // Inside a lot the meta line says whether a reader can get in instead, because that
    // is the more useful of the two things it could say and the source is already named
    // in the sentence above it.
    role_label: lot ? studioLotAccessNote(lot) : labels.who,
    // The pin is real; what it filmed is set somewhere else. Carried on a candidate for
    // the same reason it is carried on a fact — the map must not draw the two alike.
    depicts_elsewhere: Boolean(lot),
    studio_lot: lot ? { slug: lot.slug, name: lot.name, access: lot.access } : null,
    // The area the source named. It is not a city we resolved — `location_submissions`
    // has no city column — so it is printed as the hint it is.
    city: String(row?.area_hint ?? "").trim() || null,
    country: null,
    lat,
    lng,
    // Whether this row could be drawn at all. 10,981 of the queue's rows have no
    // coordinate — nobody ever ran a geocoder over them ([[queue-review]]) — and a card
    // that lists one without saying so invites the reader to look for a pin that is not
    // there.
    mappable: lat !== null && lng !== null,
    // Deliberately null rather than 0. `evidence_count` on a fact means "how many sources
    // back this", and a queue row has not been through the process that counts them; a 0
    // would read as "nobody backs it", which is the opposite of what it means.
    evidence_count: null,
    source_url: row?.source_url ?? null,
    status: row?.status ?? "pending",
    matched_by: row?.matched_by ?? matchedBy,
  };
}

export function selectWorkCandidates(rows, { work, limit = 60, matchedBy = MATCHED_BY.id } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => !isRefusedSource(row?.source_kind))
    // The queue's own rule, and the map's: read NOT REJECTED, never `pending`. Filtering
    // on `pending` once meant believing a row that a reviewer had deleted.
    .filter((row) => row?.status !== "rejected")
    .map((row) => submissionToCandidate(row, { work, matchedBy }))
    .filter(Boolean)
    .sort((left, right) =>
      candidateRank(left) - candidateRank(right)
      || left.name.localeCompare(right.name))
    // Person of Interest alone holds 961 rows. A card is a page somebody reads.
    .slice(0, Math.max(0, limit));
}
