import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  englishFirst, localiseMapRows, needsEnglish, servedNote, sourceLanguage,
  stringsToLookUp, textKey, workIdsOf,
} from "../app/lib/display-language.mjs";
import { describedFilms, sourceLinkLabel } from "../app/lib/place-note.mjs";
import { createMapPointsHandler } from "../app/api/map/points/route.js";

test("only non-Latin scripts need an English rendering", () => {
  assert.equal(needsEnglish("דרך רוטשילד"), true);
  assert.equal(needsEnglish("Красная площадь"), true);
  assert.equal(needsEnglish("東京タワー"), true);
  assert.equal(needsEnglish("Zürich Hauptbahnhof"), false);
  assert.equal(needsEnglish("Łódź, São Paulo"), false);
  assert.equal(needsEnglish("Route 234"), false);
  assert.equal(needsEnglish(null), false);
});

test("the key is md5 of the string as served, the same thing Postgres md5() gives", () => {
  assert.equal(textKey("יפו"), createHash("md5").update("יפו", "utf8").digest("hex"));
  assert.match(textKey("יפו"), /^[0-9a-f]{32}$/);
});

test("a served note is cut at 400 code points, like left() in Postgres", () => {
  assert.equal(servedNote("a".repeat(500)).length, 400);
  assert.equal(Array.from(servedNote("😀".repeat(401))).length, 400);
  assert.equal(servedNote(null), null);
});

test("English leads and the original is kept, only when we hold a rendering", () => {
  const english = new Map([[textKey("יפו"), "Jaffa"]]);
  assert.deepEqual(englishFirst("יפו", english), { text: "Jaffa", original: "יפו" });
  assert.deepEqual(englishFirst("עכו", english), { text: "עכו", original: null });
  assert.deepEqual(englishFirst("Jaffa", english), { text: "Jaffa", original: null });
});

test("a non-English Wikipedia names its language; English and other sites name none", () => {
  assert.equal(sourceLanguage("https://he.wikipedia.org/wiki/X"), "he");
  assert.equal(sourceLanguage("https://en.wikipedia.org/wiki/X"), null);
  assert.equal(sourceLanguage("not a url"), null);
});

const jaffaRow = {
  lat: 32.05, lng: 34.75, place_name: "יפו", area_hint: "Israel",
  films: [{
    work_id: "w1", title: "Appointment with Death", year: 1988, place_name: "יפו",
    note: "מרבית צילומי הסרט נעשו בישראל", source_kind: "wikipedia",
    source_url: "https://he.wikipedia.org/w/index.php?title=X",
  }],
};

test("lookups are asked for the non-Latin strings and the listed works only", () => {
  assert.deepEqual(stringsToLookUp([jaffaRow]).sort(), ["יפו", "מרבית צילומי הסרט נעשו בישראל"].sort());
  assert.deepEqual(workIdsOf([jaffaRow]), ["w1"]);
});

test("a row gets English names and notes, a poster and the film's IMDb page", () => {
  const [row] = localiseMapRows([jaffaRow], {
    works: new Map([["w1", { imdb_id: "tt0094666", poster_path: "/p.jpg" }]]),
    english: new Map([
      [textKey("יפו"), "Jaffa"],
      [textKey("מרבית צילומי הסרט נעשו בישראל"), "Most of the film was shot in Israel"],
    ]),
    posterUrl: (path) => `poster:${path}`,
    imdbUrl: (id) => `imdb:${id}`,
  });
  assert.equal(row.place_name, "Jaffa");
  assert.equal(row.place_name_original, "יפו");
  const [film] = row.films;
  assert.equal(film.place_name, "Jaffa");
  assert.equal(film.note, "Most of the film was shot in Israel");
  assert.equal(film.imdb_url, "imdb:tt0094666");
  assert.equal(film.poster, "poster:/p.jpg");
  assert.equal(film.source_lang, "he");
});

test("with nothing to add, a row comes back as it went in", () => {
  const plain = { lat: 1, lng: 2, place_name: "Notting Hill", films: [{ work_id: "x", title: "T", source_url: "https://en.wikipedia.org/wiki/T" }] };
  const [row] = localiseMapRows([plain]);
  assert.equal(row.place_name, "Notting Hill");
  assert.equal("place_name_original" in row, false);
  assert.deepEqual(row.films[0], plain.films[0]);
});

test("between two sources for one film, the English one wins, then the longer note", () => {
  const rows = describedFilms([
    { work_id: "w", title: "T", note: "A long note from Hebrew Wikipedia, translated into English.", source_lang: "he" },
    { work_id: "w", title: "T", note: "Shot on this street in 1987.", source_url: "https://en.wikipedia.org/wiki/T" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_url, "https://en.wikipedia.org/wiki/T");
});

test("a note still beats no note, whatever the language", () => {
  const rows = describedFilms([
    { work_id: "w", title: "T", note: null },
    { work_id: "w", title: "T", note: "Shot on this street in 1987.", source_lang: "he" },
  ]);
  assert.equal(rows[0].source_lang, "he");
});

test("the source link names its language when it is not English", () => {
  assert.equal(sourceLinkLabel({ source_kind: "wikipedia", source_lang: "he" }), "Wikipedia (Hebrew)");
  assert.equal(sourceLinkLabel({ source_kind: "wikipedia", source_lang: "xx" }), "Wikipedia (xx)");
  assert.equal(sourceLinkLabel({ source_kind: "wikipedia" }), "Wikipedia");
});

function reader(overrides = {}) {
  return {
    points: async () => [],
    clusters: async () => [],
    candidatePoints: async () => [jaffaRow],
    candidateClusters: async () => [],
    fictional: async () => [],
    nearest: async () => [{ place_id: "p", name: "יפו", lat: 32.05, lng: 34.75, distance_m: 4000 }],
    works: async () => [{ id: "w1", imdb_id: "tt0094666", poster_path: "/p.jpg" }],
    translations: async () => [{ source_md5: textKey("יפו"), english: "Jaffa" }],
    ...overrides,
  };
}

const VIEW = "http://x/api/map/points?west=34.7&south=32&east=34.8&north=32.1&zoom=15&candidates=1";

test("the map route serves the English name, the original, a poster and IMDb", async () => {
  const response = await createMapPointsHandler({ createReader: () => reader() })(new Request(VIEW));
  assert.equal(response.status, 200);
  const body = await response.json();
  const props = body.candidates[0].properties;
  assert.equal(props.name, "Jaffa");
  assert.equal(props.name_original, "יפו");
  assert.equal(props.films[0].imdb_url, "https://www.imdb.com/title/tt0094666/");
  assert.match(props.films[0].poster, /^https:\/\/image\.tmdb\.org\/t\/p\/w\d+\/p\.jpg$/);
});

test("a failed lookup leaves the map drawn in the original language", async () => {
  const errors = [];
  const handler = createMapPointsHandler({
    createReader: () => reader({
      works: async () => { throw new Error("slow"); },
      translations: async () => { throw new Error("relation text_translations does not exist"); },
    }),
    logError: (...args) => errors.push(args),
  });
  const response = await handler(new Request(VIEW));
  assert.equal(response.status, 200);
  const props = (await response.json()).candidates[0].properties;
  assert.equal(props.name, "יפו");
  assert.equal(props.name_original, null);
  assert.equal(errors.length, 2);
});

test("a note that mentions the place is kept; only a note that IS the place is dropped", () => {
  const [film] = describedFilms([
    { work_id: "w", title: "Bethlehem", note: "The film was shot in Jerusalem, Bethlehem, Ramla and Jaffa." },
  ], { placeName: "Jaffa" });
  assert.equal(film.note, "The film was shot in Jerusalem, Bethlehem, Ramla and Jaffa");
  const [bare] = describedFilms([{ work_id: "w", title: "T", note: "Jaffa." }], { placeName: "Old Jaffa" });
  assert.equal(bare.note, null);
});

test("the nearest-place hint is in English too", async () => {
  const handler = createMapPointsHandler({ createReader: () => reader({ candidatePoints: async () => [] }) });
  const body = await (await handler(new Request(VIEW))).json();
  assert.equal(body.nearest[0].name, "Jaffa");
});

test("a lookup that hangs is given up on, and the map still answers", async () => {
  const { localise } = await import("../app/api/map/points/route.js");
  const logged = [];
  const out = await localise(
    reader({ translations: () => new Promise(() => {}) }),
    { candidateRows: [jaffaRow] },
    (label) => logged.push(label),
    { timeoutMs: 20 },
  );
  assert.equal(out.candidateRows[0].place_name, "יפו");
  assert.equal(out.candidateRows[0].films[0].imdb_url, "https://www.imdb.com/title/tt0094666/");
  assert.deepEqual(logged, ["Map translations lookup timed out"]);
});
