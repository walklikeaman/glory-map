// A verdict on one row of the queue, and the reason it can be argued with.
//
// Measured 08.08: **43,888 submissions, every one `pending`, none ever reviewed.** The
// number is usually read as "nobody has clicked yet". It is not. Three things came out
// of measuring the corpus before writing a line of this:
//
//   * **30,153 of the 30,257 geolocated rows are MovieMaps alone.** Their names are
//     clean (22 characters on average) and their coordinates are one per place — 3,187
//     of 3,313 name-clusters hold exactly ONE distinct point. So the obvious offline
//     check, "do the rows agree with each other", proves nothing: they are the same
//     number copied, not independent observations.
//   * **13,637 rows have no coordinate at all** — and the reason is not what this comment
//     said first. It blamed captions: 47% of movie-locations names running past twelve
//     words, 54% still carrying the "<Film> location:" prefix. Re-measured 08.08 after
//     the source was re-ingested, that is **71 of 5,580** and **zero**. The extractor was
//     fixed; the rows stayed pointless anyway, because **no geocoder has ever been run on
//     them** — every located row in the queue got its point from the source it was
//     scraped from. See [[queue-review]] and app/lib/place-name-head.mjs.
//   * Everything that would actually settle a MovieMaps row — is there a Wikidata entity
//     here, does another site say the same thing — needs the network.
//
// So a human queue of 30,257 rows is not a product: the reviewer would have no more
// information than we do. What this module does instead is say, per row and in words a
// person can check, **which of those three situations the row is in** — and verify the
// rows whose claim somebody outside this project can already check.
//
// The vocabulary of evidence is `place-review.mjs`. It was written for `places` and has
// had no caller since; using it here is deliberate, because two definitions of "what
// counts as evidence" is how the two surfaces start disagreeing.

import { STATUS, VERIFY_THRESHOLD, combineSignals } from "./place-review.mjs";
import { isRefusedSource } from "./submission-places.mjs";
import { finiteOrNull } from "./numbers.mjs";
import { isVaguePlaceName } from "./vague-place-name.mjs";

export { STATUS };

// Names that are not places. Every one of these was found in the live queue, and every
// one is a scraper picking up furniture from the page: the label of a map link, the
// credit line under a photograph. "Google Maps" appears against 155 works.
//
// Matched on the whole normalised name, never as a substring — "Google Maps" is not a
// place and the Googleplex is. The project has paid twice for a rule that matched a name
// inside another name.
const NOT_A_PLACE = new Set([
  "google maps", "google map", "google streetview", "google street view", "street view",
  "map", "maps", "see map", "photo", "photograph", "image", "picture",
  "link", "here", "click here", "unknown", "none", "n/a", "na", "tbc", "tbd",
  "various", "various locations", "multiple locations", "imdb", "wikipedia",
]);

// A photo credit that landed in the name column: "Wikipedia / David Leigh Ellis".
const CREDIT_ONLY = /^(wikipedia|wikimedia|photograph|photo|image|courtesy)\s*[/|:]/i;

// A caption is not a name. Two markers, both taken from the live rows:
//   "John Wick Chapter 2 location: … : Antica Libreria Cascianelli, Rome | Photograph: Alamy"
//   "Midtown Manhattan, New York, where the view looks towards the Helmsley Building, …"
const PHOTO_CREDIT_TAIL = /\|\s*photograph\b/i;
const CAPTION_MARKER = /\blocation\s*:/i;

// Twelve words. Measured rather than picked: MovieMaps, whose extraction is fine, has TWO
// rows over twelve words out of 30,153. After the movie-locations re-ingest it has 71 of
// 5,580 and ReelStreets has 508 of 8,062 — and those 508 are not captions but written
// descriptions of where a camera stood ("Bristol Temple Meads station on Station Approach
// off Bath Road in Bristol, Avon"). They are unusable for a GAZETTEER, not wrong, which is
// what place-name-head.mjs exists to unpick.
export const MAX_NAME_WORDS = 12;

// Sources whose claim somebody who is not us can check, and what makes that true. These
// are facts about the SOURCE, not scores — writing them as weights and then tuning the
// weights until plaques passed would be the scoring model quietly starting to lie, which
// is the failure place-review.mjs was written against.
const CHECKABLE_SOURCE = {
  // The sentence is engraved on a wall, at the coordinate, in public. Anyone can stand
  // in front of it and read it. Nothing else in this corpus is checkable that cheaply.
  open_plaques: "the inscription is on a wall at this coordinate and anyone can read it",
  // A government record naming the production and the address. The city that issued the
  // permit is the authority on whether it issued it.
  permit_record: "a filming permit issued by the city for this address",
};

// Which signals answer "was this work connected to this place at all", as opposed to
// "is the coordinate right". place-review.mjs makes the same split and puts
// `wikidata_entity` on the CLAIM side — correct there, wrong here, and the difference is
// worth being exact about because it decides 29 rows today and thousands later.
//
// For a candidate discovered FROM a work's Wikidata statement, the entity IS the claim:
// Wikidata says this film and this place are related. For a queue row, the Q-id is found
// the other way round — by asking what sits at the coordinate the scraper gave, under the
// name the scraper gave. That proves the BUILDING exists. It says nothing whatsoever
// about whether a film was shot in it.
//
// Publishing on it alone would be asserting "this film was shot here" on the strength of
// "this address is real", which is the quiet kind of false claim this project keeps
// finding in itself.
const SUBMISSION_CLAIM_SIGNALS = Object.freeze(["cited_source", "independent_corroboration"]);

function normalisedName(row) {
  return String(row?.place_key ?? row?.place_name ?? "").trim().toLowerCase();
}

function wordCount(text) {
  const trimmed = String(text ?? "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Refusals: claims the product must not make at all. Each is mechanical and can be
// re-derived by anyone from the row itself.
export function disqualification(row) {
  if (!row) return "no_row";
  if (isRefusedSource(row.source_kind)) return "refused_source";

  const name = String(row.place_name ?? "").trim();
  if (!name) return "no_place_name";
  if (!/\p{L}/u.test(name)) return "name_has_no_letters";
  if (NOT_A_PLACE.has(normalisedName(row))) return "not_a_place";
  if (CREDIT_ONLY.test(name)) return "photo_credit_not_a_place";
  if (isVaguePlaceName(name)) return "vague_not_a_place";

  const lat = finiteOrNull(row.lat);
  const lng = finiteOrNull(row.lng);
  if (lat !== null && lng !== null) {
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return "impossible_coordinate";
    // 0,0 is a legal coordinate and the signature of a number that was never parsed.
    // Four incidents in this project so far, one of them a Leeds cinema at latitude 0.
    if (lat === 0 && lng === 0) return "null_island";
  }
  return null;
}

// Why this row cannot become a pin YET. Not a refusal — the row may be perfectly true.
// It is a work list: `unusable_name` is our extractor's fault and is fixable, and
// `no_coordinate` is waiting on the resolver.
export function blocker(row) {
  const name = String(row?.place_name ?? "").trim();
  if (PHOTO_CREDIT_TAIL.test(name)) return "unusable_name:photo_credit_appended";
  if (CAPTION_MARKER.test(name)) return "unusable_name:caption_prefix_not_cut";
  if (wordCount(name) > MAX_NAME_WORDS) return "unusable_name:sentence_not_a_name";
  if (finiteOrNull(row?.lat) === null || finiteOrNull(row?.lng) === null) return "no_coordinate";
  return null;
}

// What a row demonstrates, in the shared vocabulary. Each is a lookup, not an opinion.
// **A Q-id our own geocoder chose is not a second opinion.** `resolve-wikidata` asks what
// entity sits at a row's coordinate under the row's name. For a scraped row that coordinate
// came from the scraper, and the answer is new evidence. For a row our geocoder placed, the
// coordinate CAME from that entity — the geocoder looked the name up in Wikidata and took its
// point — so asking again returns the same Q-id and proves nothing the placement did not.
// Measured 21.09: of 476 Wikipedia rows given a Q-id that morning, 472 matched their own
// `geocode_source_id` exactly, and counting them turned one cited sentence plus our own lookup
// into `verified`. Clifton Village was one — placed in Nottingham for "Bristol", and a step
// from being a verified wrong pin. The geocoder's pick is still evidence the place exists; it
// is not a second source for the claim, and it is not counted as one.
export function echoesItsOwnGeocode(row) {
  return row?.geocode_source === "wikidata"
    && typeof row?.geocode_source_id === "string"
    && row.geocode_source_id === row?.wikidata_id;
}

export function submissionSignals(row) {
  const signals = [];
  if (typeof row?.wikidata_id === "string" && /^Q[1-9]\d*$/.test(row.wikidata_id)
    && !echoesItsOwnGeocode(row)) {
    signals.push("wikidata_entity");
  }
  // Somebody else's site, independently, names this place for this work. Agreement
  // between scrapes is evidence; one scrape repeating itself is not, which is why this
  // counts sources rather than rows.
  if (independentSources(row).length > 0) signals.push("independent_corroboration");
  // The source stated a sentence and gave a page it can be read on. A sentence that does
  // not mention the place it was filed under is not evidence for that place.
  if (row?.source_url && statesSomething(row?.source_sentence)) signals.push("cited_source");
  if (borrowedCoordinateAgrees(row)) signals.push("coordinate_agreement");
  return signals;
}

// `corroborated_by` is written by the resolver as
// [{source_kind, submission_id, place_name, distance_m, gave_coordinate}].
export function independentSources(row) {
  const entries = Array.isArray(row?.corroborated_by) ? row.corroborated_by : [];
  const own = String(row?.source_kind ?? "");
  return [...new Set(
    entries
      .map((entry) => String(entry?.source_kind ?? ""))
      .filter((kind) => kind && kind !== own),
  )];
}

// A corroborating row that also carried a point, landing where this one says. Same
// 150 m as place-review.mjs uses, and for the same reason: a city block is the same
// place, a district is not.
export const COORDINATE_AGREEMENT_M = 150;

function borrowedCoordinateAgrees(row) {
  const entries = Array.isArray(row?.corroborated_by) ? row.corroborated_by : [];
  return entries.some((entry) => {
    if (entry?.gave_coordinate !== true) return false;
    if (String(entry?.source_kind ?? "") === String(row?.source_kind ?? "")) return false;
    const metres = finiteOrNull(entry?.distance_m);
    return metres !== null && metres <= COORDINATE_AGREEMENT_M;
  });
}

// Does the source STATE something, or does it only name itself?
//
// The first version of this asked whether the sentence mentions the place it was filed
// under. Checked against the live rows, that test is wrong for this corpus and wrong in
// both directions: "Bridge used in the first episode of series 1" passed for Vauxhall
// Bridge on the word "bridge", while "Jim wakes up from a coma in an abandoned hospital"
// FAILED for Central Middlesex Hospital — which is a real statement about a real row.
// Prose does not repeat its own heading, and requiring it to was rigour in appearance
// only.
//
// What is actually worth excluding is the row that carries no claim at all, just an
// attribution: "Source: Wikipedia", "Source: IMDb". Those are 34 of the rows a Q-id had
// already been found for, and taking them as evidence would mean the citation signal
// fires on the word "Source".
const ATTRIBUTION_ONLY = /\bsource\s*:\s*[^.]*/gi;
const MIN_STATEMENT_CHARS = 20;

export function statesSomething(sentence) {
  const remainder = String(sentence ?? "")
    .replace(ATTRIBUTION_ONLY, " ")
    .replace(/\s+/g, " ")
    .trim();
  return remainder.length >= MIN_STATEMENT_CHARS;
}

// The verdict. `pending` stays the honest middle: not enough to publish, not wrong
// enough to bury — and for most of this queue it is the correct and permanent answer
// until somebody produces a signal that does not exist yet.
export function reviewSubmission(row) {
  const refused = disqualification(row);
  if (refused) {
    return { status: STATUS.rejected, score: 0, signals: [], reason: refused };
  }

  const blocked = blocker(row);
  if (blocked) {
    return { status: STATUS.pending, score: 0, signals: submissionSignals(row), reason: blocked };
  }

  const checkable = CHECKABLE_SOURCE[row?.source_kind];
  if (checkable) {
    return {
      status: STATUS.verified,
      score: 1,
      signals: submissionSignals(row),
      reason: checkable,
    };
  }

  const signals = submissionSignals(row);
  const score = combineSignals(signals);
  const hasClaim = signals.some((signal) => SUBMISSION_CLAIM_SIGNALS.includes(signal));
  if (hasClaim && score >= VERIFY_THRESHOLD) {
    return { status: STATUS.verified, score, signals, reason: signals.join("+") };
  }
  return {
    status: STATUS.pending,
    score,
    signals,
    reason: signals.length === 0 ? "no_signal_yet" : `insufficient:${signals.join("+")}`,
  };
}

// One line per verdict, for the run report. A rule whose effect cannot be counted is a
// rule nobody can argue with.
export function tallyVerdicts(verdicts) {
  const tally = { verified: 0, rejected: 0, pending: 0, reasons: {} };
  for (const verdict of verdicts ?? []) {
    tally[verdict.status] = (tally[verdict.status] ?? 0) + 1;
    const key = `${verdict.status}:${verdict.reason}`;
    tally.reasons[key] = (tally.reasons[key] ?? 0) + 1;
  }
  return tally;
}
