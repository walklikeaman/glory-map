// What was actually filmed here (#244).
//
// A pin said "Forrest Gump" and the card under it said "Filming location". Both are true
// and neither answers the question a person clicking a pin is asking, which is *what
// happens here* — which scene, which building plays what, why this corner is worth the
// walk. We were holding that answer the whole time and never showing it: every queue row
// carries `source_sentence`, the line of prose the place was found in.
//
// Measured over the 32,368 located rows, 12.09.2026:
//
//   moviemaps       30,122 rows   77% carry a description once the attribution is removed
//   movielocations   1,501 rows  100%
//   reelstreets        412 rows  100%
//   wikipedia          270 rows  100%
//   open_plaques        53 rows  100%
//   permit_record       10 rows    0%  — a permit is a date and an address, never a scene
//
// So **78% of the map can say what was shot there**, and the rest must say nothing rather
// than something invented. That is the whole design of this module: it subtracts, and when
// subtraction leaves nothing it returns null.
//
// ---------------------------------------------------------------------------------------
//
// The three things it removes, each measured against real rows:
//
//   **The attribution tail.** 6,842 moviemaps rows are the literal string "Source: IMDb"
//   and nothing else. Printing that under a film title tells a reader where we looked, in
//   the place reserved for what they came to find out — and the popup already carries the
//   source as a link, which is a better answer to the same question.
//
//   **The "<Title> film location:" prefix.** Movie-Locations writes every line as
//   "Skyfall film location: the entrance to the MI6 underground facility: West Smithfield,
//   London". The title is printed directly above the note; repeating it costs the width
//   the description needs.
//
//   **The trailing address.** The same rows end with the street, which is the pin's own
//   name. Dropped only when it actually matches the place we are drawing — a segment that
//   does not match is part of the sentence, not a duplicate of the heading.

// Below this, what survived is not a description. "Diner" is, at 5 characters, so the floor
// is deliberately low — it is here to reject fragments of punctuation, not short answers.
const MIN_NOTE = 5;

// Two lines in the popup at its width. A note is a glance, not a paragraph; the full
// sentence is one click away at the source.
export const NOTE_LIMIT = 160;

const SOURCE_NAMES = Object.freeze({
  wikipedia: "Wikipedia",
  moviemaps: "MovieMaps",
  movielocations: "Movie-Locations",
  reelstreets: "Reelstreets",
  open_plaques: "Open Plaques",
  permit_record: "Film permit",
  fandom: "Fandom",
});

// The name a reader recognises, never the column value. An unknown kind falls back to
// "the source" rather than printing a database identifier at somebody.
export function sourceLabel(kind) {
  if (typeof kind !== "string" || !kind) return "the source";
  return SOURCE_NAMES[kind] ?? "the source";
}

function squash(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

// "West Smithfield, London" and "West Smithfield, London." are the same heading, and a
// note that only repeats the heading is not a note.
function normalisePlace(value) {
  return squash(value).toLowerCase().replace(/[.,;:'"“”‘’]/g, "").trim();
}

function sameAsPlace(segment, placeName) {
  const left = normalisePlace(segment);
  const right = normalisePlace(placeName);
  if (!left || !right) return false;
  return left === right || right.includes(left) || left.includes(right);
}

function onlyThePlace(note, placeName) {
  const left = normalisePlace(note);
  const right = normalisePlace(placeName);
  return Boolean(left && right) && (left === right || right.includes(left));
}

function trimEnds(value) {
  // Leading punctuation left behind by a removed prefix, and the dangling separators a
  // removed tail leaves at the end.
  return value.replace(/^[\s.,;:—–-]+/, "").replace(/[\s.,;:—–|·]+$/, "").trim();
}

// A cut mid-word reads as a bug; a cut at a space reads as an ellipsis.
function clamp(value, limit) {
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${trimEnds(space > limit * 0.6 ? cut.slice(0, space) : cut)}…`;
}

export function sceneNote(sentence, { placeName = null, limit = NOTE_LIMIT } = {}) {
  let note = squash(sentence);
  if (!note) return null;

  // "… Source: IMDb", "… Source: Clatsop County Historical Society" — always last, and
  // never part of what the place is.
  note = note.replace(/(^|[.;·|]\s*)Source:\s*[^.;|]*\.?\s*$/i, "$1");
  // Reelstreets closes with the crediting site in brackets.
  note = note.replace(/\(\s*(IMDb|imdb)\s*\)\.?\s*$/, "");
  // "Skyfall film location:", "Before Sunrise location:" — the title is already the line
  // above. Anchored to the start and bounded, so a colon inside prose survives.
  note = note.replace(/^[^:]{1,80}?\s(?:film\s)?location:\s*/i, "");

  note = trimEnds(note);
  if (!note) return null;

  // "…: West Smithfield, London" — the address, which is the pin's own name. Only the
  // last segment, and only when it is the place we are drawing.
  const cut = note.lastIndexOf(": ");
  if (cut > 0 && sameAsPlace(note.slice(cut + 2), placeName)) {
    note = trimEnds(note.slice(0, cut));
  }

  if (note.length < MIN_NOTE) return null;
  // Whatever is left that is only the heading again is not worth a second line. Only the
  // heading, though: a sentence that MENTIONS the place is the description. Testing it
  // with "contains" threw away every note in Jaffa, because they all say "Jaffa".
  if (onlyThePlace(note, placeName)) return null;

  return clamp(note, Math.max(MIN_NOTE, limit));
}

// One row per film, with the best description anybody gave it.
//
// A point can hold the same work twice — the unique index is per (work, place NAME), and
// two sources spell one address differently, so Wilton's Music Hall lists "Chaplin" from
// Movie-Locations and "Chaplin" from MovieMaps. That was invisible while the popup printed
// titles; with a description under each, the reader sees one film twice and reads it as a
// bug rather than as two sources agreeing.
//
// The longest note wins, because these rows differ by how much the source bothered to
// write: "Charlie saves the day at the 'Aldershot' theatre" against "Appears as 'Aldershot
// Music Hall'". Ties keep the first, which is the title order the query already fixed.
export function describedFilms(films, { placeName = null, limit = NOTE_LIMIT } = {}) {
  const byWork = new Map();

  for (const film of Array.isArray(films) ? films : []) {
    const key = film?.work_id ?? `${film?.title ?? ""}|${film?.year ?? ""}`;
    const note = sceneNote(film?.note, { placeName, limit });
    const seen = byWork.get(key);
    if (!seen) {
      byWork.set(key, { ...film, note });
      continue;
    }
    if (betterRow({ ...film, note }, seen)) {
      byWork.set(key, { ...film, note });
    }
  }

  return [...byWork.values()];
}

// Any note beats none; between two notes, one from an English source beats one from
// another language, with or without notes (the reader follows its link, and Hebrew Wikipedia is a dead end for
// most of them); after that, the longer note. `source_lang` is set by the server only for
// a non-English source, so its absence means English or not a Wikipedia at all.
function betterRow(candidate, seen) {
  const hasNote = (row) => Boolean(row.note);
  if (hasNote(candidate) !== hasNote(seen)) return hasNote(candidate);
  const english = (row) => !row.source_lang;
  if (english(candidate) !== english(seen)) return english(candidate);
  return (candidate.note?.length ?? 0) > (seen.note?.length ?? 0);
}

// The link's label, with the language named when it is not English — "Wikipedia (Hebrew)"
// warns a reader before the tap rather than after.
const LANGUAGE_NAMES = Object.freeze({
  he: "Hebrew", ar: "Arabic", ru: "Russian", fr: "French", de: "German", es: "Spanish",
  it: "Italian", ja: "Japanese", zh: "Chinese", ko: "Korean", pt: "Portuguese", pl: "Polish",
  uk: "Ukrainian", tr: "Turkish", nl: "Dutch", sv: "Swedish", el: "Greek", fa: "Persian",
});

export function sourceLinkLabel(film) {
  const label = sourceLabel(film?.source_kind);
  const lang = typeof film?.source_lang === "string" ? film.source_lang : null;
  if (!lang) return label;
  return `${label} (${LANGUAGE_NAMES[lang] ?? lang})`;
}

// What the popup says when there is no note: the honest minimum, which is that somebody
// listed this place for this work and we have not checked it. Never dressed up as a scene.
export function listingLine(film) {
  const source = sourceLabel(film?.source_kind);
  return film?.status === "verified"
    ? `Checked against ${source}`
    : `Listed by ${source} · not checked by us`;
}
