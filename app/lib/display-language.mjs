// English first, the original underneath.
//
// Israel brought the first big batch of places named in a script most readers cannot
// read: 86 of the 118 queue pins there were titled in Hebrew ("דרך רוטשילד" for
// Rothschild Boulevard) and half the scene notes were Hebrew sentences. A card nobody can
// read is a card that says nothing, so every name and note shown on the map goes through
// one rule: if it is written in a non-Latin script and we hold an English rendering, the
// English leads and the original sits under it in small type, for the street sign.
//
// The renderings live in `text_translations`, keyed by the md5 of the exact string the
// map serves, and are written by scripts/translate-display-text.mjs. Nothing is
// translated at request time: a card must not wait on, or pay for, a model call.

import { createHash } from "node:crypto";

// Letters from scripts outside Latin. Latin with diacritics (Zürich, São Paulo, Łódź)
// reads fine for an English reader and stays as it is. Digits, punctuation and spaces
// are neutral and never decide anything on their own.
const NON_LATIN_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Ethiopic}]/u;

export function needsEnglish(text) {
  return typeof text === "string" && NON_LATIN_LETTER.test(text);
}

// The key a rendering is stored under. md5 of the string exactly as served, so the
// lookup never has to put a 400-character Hebrew sentence into a URL.
export function textKey(text) {
  return createHash("md5").update(String(text), "utf8").digest("hex");
}

// The note the map serves is `left(source_sentence, 400)` — 400 CODE POINTS, which is
// what Postgres counts. The script keys its renderings on the same cut.
export function servedNote(sentence, limit = 400) {
  if (typeof sentence !== "string") return null;
  return Array.from(sentence).slice(0, limit).join("");
}

// { text, original } — `original` only when the English replaced something, so a card can
// render the second line on its presence alone.
export function englishFirst(text, english) {
  if (!needsEnglish(text)) return { text, original: null };
  const rendering = english?.get?.(textKey(text));
  if (typeof rendering !== "string" || !rendering.trim()) return { text, original: null };
  return { text: rendering.trim(), original: text };
}

// Every string on these rows that could use an English rendering — the lookup list.
export function stringsToLookUp(rows) {
  const out = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const value of [row?.place_name, row?.name, row?.sample_name]) {
      if (needsEnglish(value)) out.add(value);
    }
    for (const film of Array.isArray(row?.films) ? row.films : []) {
      if (needsEnglish(film?.place_name)) out.add(film.place_name);
      if (needsEnglish(film?.note)) out.add(film.note);
    }
  }
  return [...out];
}

export function workIdsOf(rows) {
  const out = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const film of Array.isArray(row?.films) ? row.films : []) {
      if (film?.work_id) out.add(film.work_id);
    }
  }
  return [...out];
}

// The language a Wikipedia source is written in, for the link's label — "Wikipedia (he)"
// tells a reader before they tap that the page will not be in English.
export function sourceLanguage(url) {
  try {
    const wiki = new URL(url).hostname.match(/^([a-z-]+)\.(?:m\.)?wikipedia\.org$/);
    return wiki && wiki[1] !== "en" ? wiki[1] : null;
  } catch {
    return null;
  }
}

// The map's rows, made readable: English names and notes where we have them, and on each
// listed film the two things a reader asks first — which film is this (the poster) and
// where can I read about it (IMDb). The Wikipedia link stays, as the source of the
// "filmed here" claim it always was; it is no longer the only way to the film.
//
// `works` maps work id → { imdb_id, poster_path }; `english` maps textKey → rendering.
// Both are optional: a row with neither comes back as it went in.
export function localiseMapRows(rows, { works = new Map(), english = new Map(), posterUrl = () => null, imdbUrl = () => null } = {}) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const out = { ...row };
    for (const field of ["place_name", "name", "sample_name"]) {
      if (typeof row?.[field] !== "string") continue;
      const shown = englishFirst(row[field], english);
      out[field] = shown.text;
      if (shown.original && field !== "sample_name") out[`${field}_original`] = shown.original;
    }
    if (Array.isArray(row?.films)) {
      out.films = row.films.map((film) => {
        const work = works.get(film?.work_id);
        const name = englishFirst(film?.place_name, english);
        const note = englishFirst(film?.note, english);
        const extra = {};
        if (work?.imdb_id) extra.imdb_url = imdbUrl(work.imdb_id);
        if (work?.poster_path) extra.poster = posterUrl(work.poster_path);
        if (film?.source_url) extra.source_lang = sourceLanguage(film.source_url);
        return Object.fromEntries(Object.entries({
          ...film,
          place_name: name.text ?? film?.place_name,
          note: note.text ?? film?.note,
          ...extra,
        }).filter(([, value]) => value !== null && value !== undefined));
      });
    }
    return out;
  });
}
