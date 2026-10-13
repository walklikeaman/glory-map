// Commemorative plaques: the only source where the quote is already on the wall.
//
// Everything else in this project extracts a claim from prose. A plaque IS the claim —
// text at a street address, put up by a named organisation, with a date — and it lands
// on the half the map is weakest at: where a thing was filmed, written or recorded,
// at building precision. See [[commemorative-plaques]] and #125.
//
// Measured on the Open Plaques dump (PDDL, public domain), 47,064 plaques with a
// coordinate. What matters is not how many mention a film but how few of those mentions
// are real, and this module is almost entirely about the difference.

import { finiteOrNull } from "./numbers.mjs";
import { plaqueYears, preferredKinds, yearFits } from "./plaque-title-resolve.mjs";

export const PLAQUE_SOURCE_KIND = "open_plaques";
export const PLAQUE_LICENSE = "PDDL 1.0";
export const PLAQUE_LICENSE_URL = "https://opendatacommons.org/licenses/pddl/1-0/";

// Memorials to victims, refused before anything else is considered.
//
// 6,269 rows of the world dump are Stolpersteine and their kin — 6,252 in Germany — and
// 1,413 of them fall inside the phrase "lived here / wohnte hier", which is exactly the
// phrase a naive filter keeps. A walking tour of celebrity addresses must not touch
// them, and a filter that merely tends to miss them is not good enough: this runs first,
// on the inscription, the series and the erecting organisation together.
const VICTIM_MEMORIAL =
  /stolperstein|stumbling stone|deportiert|ermordet|auschwitz|theresienstadt|buchenwald|\bJg\.\s*\d{4}|holocaust|kindertransport|concentration camp/i;

export function isVictimMemorial(row) {
  return VICTIM_MEMORIAL.test([row?.inscription, row?.series, row?.organisations].join(" "));
}

// What makes a mention a CLAIM about this place rather than a word in a sentence.
//
// A normalised substring is not evidence — the same lesson as `Bowie` returning a
// hundred Texas markers about Jim Bowie and Bowie County. Two rules, measured:
//
// 1. CASE. A title on a wall is written as a title: "My Beautiful Laundrette", not
//    "the room" mid-sentence. Matching the ORIGINAL text case-sensitively took a set of
//    4,643 "hits" — dominated by "the club", "the beach", "the office" — down to 346.
//
// 2. PROXIMITY. In every true hit the title sits beside the word that makes it a claim:
//    "filming location The Blackwood Arms", "location for film Moby Dick", "Stars of the
//    film 'Brassed Off'". In the noise it opens a sentence about a 16th-century pub.
//    346 → 46, and a pub called The Crown stopped being the series The Crown.
const CLAIM_WORDS = {
  film: /\b(film(s|ed|ing)?|movie|cinema|screen|shot here|location for|filming location|starring|stars of|premiere)\b/i,
  series: /\b(film(s|ed|ing)?|series|episode|tv|television|location for|filming location)\b/i,
  book: /\b(wrote|written|novel|book|author|poem|chapters?|set in)\b/i,
};

// How far from the title the claim word may sit. Sixty characters is about a clause —
// wide enough for "the location of one of the greatest British films The Italian Job",
// narrow enough that a title at the start of a plaque is not justified by a verb three
// sentences later.
export const CLAIM_WINDOW = 60;

// A title short enough to occur by accident is not usable, for the same reason a
// one-word character name is not usable in the inverted search: it has to be a
// near-unique string in running prose.
export const MIN_TITLE_WORDS = 2;
export const MIN_TITLE_CHARS = 8;

export function isMatchableTitle(title) {
  const text = String(title ?? "").trim();
  return text.split(/\s+/).filter(Boolean).length >= MIN_TITLE_WORDS
    && text.length >= MIN_TITLE_CHARS;
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Where a work's title is stated on this plaque as a claim about the place — or null.
// Returns the surrounding text too, because that is what a reviewer reads and what goes
// into the evidence.
export function findTitleClaim(inscription, work) {
  const text = String(inscription ?? "");
  const title = String(work?.title ?? "");
  if (!text || !isMatchableTitle(title)) return null;

  const pattern = new RegExp(`(^|[^A-Za-z0-9])(${escapeRegex(title)})([^A-Za-z0-9]|$)`);
  const match = pattern.exec(text);
  if (!match) return null;

  const at = match.index + match[1].length;
  const context = text.slice(
    Math.max(0, at - CLAIM_WINDOW),
    at + title.length + CLAIM_WINDOW,
  );
  const claimWords = CLAIM_WORDS[work.kind] ?? CLAIM_WORDS.film;
  if (!claimWords.test(context)) return null;

  return { at, context: context.trim(), sentence: claimSentence(text, at) };
}

// The one sentence that carries the claim, not the whole wall.
//
// A plaque can be an essay: the One Tun's runs to nine hundred characters about saffron
// crops and cask sizes, with the claim about Oliver Twist in the first line. Storing all
// of it as `source_sentence` buries the evidence in the noise — and this project already
// settled the rule for Wikipedia prose: ONE sentence, quoted verbatim, checkable against
// the source. The same rule earns the same benefit here.
export function claimSentence(inscription, at) {
  const text = String(inscription ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const index = Math.min(Math.max(0, at ?? 0), text.length - 1);

  // A boundary needs a WORD before the full stop, not an initial: "J. R. R. Tolkien"
  // and "No. 5" must not split the claim in half, and the first attempt returned
  // "Tolkien author of The Lord of the Rings…" with the name beheaded.
  const BOUNDARY = /(?<=[a-z0-9)"'\]])[.!?]\s+(?=[A-Z"'“‘])/g;
  let start = 0;
  for (const match of text.slice(0, index).matchAll(BOUNDARY)) {
    start = match.index + match[0].length;
  }
  const rest = text.slice(index);
  const boundary = /(?<=[a-z0-9)"'\]])[.!?](\s+[A-Z"'“‘]|$)/g;
  let end = rest.search(boundary);
  let sentence = text.slice(start, end === -1 ? text.length : index + end + 1).trim();

  // A plaque often opens with the title as a heading — "Local Hero. Bill Forsyth's
  // worldwide success was filmed in and around Pennan 1983" — and the sentence holding
  // the title is then two words long and proves nothing. Take the next one too.
  if (sentence.length < 40 && end !== -1) {
    const after = text.slice(index + end + 1);
    const next = after.search(boundary);
    sentence = text.slice(start, next === -1
      ? text.length
      : index + end + 1 + next + 1).trim();
  }
  return sentence;
}

// What the plaque says happened here. The verb decides, not the subject's job title:
// "filmed here" is a filming location, "wrote here" is where the author worked, and a
// plaque that names a work without either is a mention and nothing stronger.
const RELATION_BY_VERB = [
  [/\b(filmed|filming location|was shot|shot here|location for (the )?film|premiered)\b/i, "filming_location"],
  [/\b(recorded here|were recorded|recording studio)\b/i, "filming_location"],
  [/\b(wrote|written here|composed)\b/i, "author_place"],
  [/\b(lived|born|died|stayed|worked)\b/i, "author_place"],
];

export function relationFromInscription(inscription, kind = "film") {
  const text = String(inscription ?? "");
  for (const [pattern, relation] of RELATION_BY_VERB) {
    if (pattern.test(text)) return relation;
  }
  return kind === "book" ? "narrative_location" : "filming_location";
}

// A submission, shaped the way `location_submissions` expects it.
//
// `source_sentence` is the inscription itself — not a summary of it. That is the whole
// value of this source: the sentence can be checked against the wall by anybody standing
// in front of it, which is the strongest verification this project has ever had.
// The organisations field is a JSON array written as text: `["Leeds Civic Trust"]`, and
// an empty one is the string `[]`. Rendering that into "Plaque erected by []" credits
// nobody in a way that looks like a bug, because it is one.
function erectedBy(row) {
  const raw = String(row?.organisations ?? "").trim();
  if (!raw || raw === "[]") return null;
  let names = [];
  try {
    const parsed = JSON.parse(raw);
    names = Array.isArray(parsed) ? parsed.filter(Boolean) : [raw];
  } catch {
    names = [raw];
  }
  if (!names.length) return null;
  const year = String(row?.erected ?? "").trim();
  return `Plaque erected by ${names.join(", ")}${year ? ` (${year})` : ""}`;
}

export function plaqueSubmission(row, work, claim) {
  const lat = finiteOrNull(row?.latitude);
  const lng = finiteOrNull(row?.longitude);
  if (lat === null || lng === null) return null;
  // The dump itself carries Null Island. The Majestic Cinema in Leeds arrives as
  // `latitude 0.0, longitude -1.5475` — the longitude is right and the latitude was
  // lost, which puts a Yorkshire cinema in the Gulf of Guinea. `finiteOrNull` cannot
  // catch this: 0 is a perfectly finite number and a legal latitude. Nothing in this
  // dataset sits on either line, so an exact zero is a lost value rather than a place.
  if (lat === 0 || lng === 0) return null;
  const id = String(row?.id ?? "").trim();
  if (!id) return null;

  // The pin must name the PLACE, not the plaque. The dump's `title` is the plaque's own
  // name — "Midsomer Murders red plaque", "plaque № 70000" — which tells a person
  // nothing about where to stand. `address` carries the venue: "The Blackwood Arms,
  // Common Lane", "The Chequers Inn, Fingest Lane". Its first segment is the thing you
  // walk to; the rest is where it is.
  const [venue, ...rest] = String(row?.address ?? "").split(",").map((part) => part.trim());
  const place = venue || String(row?.title ?? "").trim();
  // Some rows carry "?" as the address. A pin labelled "?" is worse than no pin: it
  // occupies a spot on a walk and tells nobody where to stand.
  if (!place || place === "?" || place.length < 3) return null;
  const area = [...rest, row?.area].filter(Boolean).join(", ") || null;

  return {
    work_id: work.id,
    place_name: place,
    area_hint: area,
    source_kind: PLAQUE_SOURCE_KIND,
    source_record_id: id,
    // The claim sentence, not the whole wall — see `claimSentence`. The full inscription
    // is one click away at `source_url`, and what we store is what a reviewer checks.
    source_sentence: claim?.sentence
      || String(row.inscription ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
    source_title: `Open Plaques #${id}`,
    source_url: `https://openplaques.org/plaques/${id}`,
    source_license: PLAQUE_LICENSE,
    source_license_url: PLAQUE_LICENSE_URL,
    source_attribution: erectedBy(row),
    lat,
    lng,
    geocode_source: "open_plaques",
    geocode_source_id: id,
    geocode_license: PLAQUE_LICENSE,
    geocode_reason: claim?.context ? `Inscription states: "${claim.context}"` : null,
    status: "pending",
  };
}

// Everything a dump row can contribute, given the works we know about.
//
// Deliberately one work per plaque at most: a plaque naming several films is usually a
// person's credit list ("Among his film credits are Oklahoma, Doctor Dolittle, The
// Graduate") where the PLACE is that person's birthplace, not a location of any of them.
// Taking the first claim keeps the honest one and drops the list.
export function matchPlaque(row, works) {
  if (isVictimMemorial(row)) return null;
  const inscription = String(row?.inscription ?? "");
  if (!inscription.trim()) return null;

  // The same two checks the Wikidata resolver applies, because a title we already hold
  // is no less ambiguous than one we look up. Measured on the live graph: plaque #8600,
  // "The Gainsborough Film Studios 1924-1949 … 'The Wicked Lady'", was linked to the 1983
  // remake; #2361, Roger Moore "starred in The Saint television series (1962-9)", to the
  // 1997 Val Kilmer film; #3288, "Ian Fleming … novelist wrote 'You Only Live Twice' here
  // in 1964", to the 1967 film. A work with no year is not refused for lacking one.
  const years = plaqueYears(inscription);
  const kinds = preferredKinds(inscription);

  for (const work of works) {
    if (kinds && !kinds.includes(work.kind)) continue;
    if (years.length && work.year && !yearFits(work.year, years)) continue;
    const claim = findTitleClaim(inscription, work);
    if (!claim) continue;
    const submission = plaqueSubmission(row, work, claim);
    if (submission) return { work, claim, submission };
  }
  return null;
}
