import assert from "node:assert/strict";
import test from "node:test";

import {
  candidatesFromBindings, kindOf, newRows, titleFromArticle, workRowFrom,
} from "../app/lib/country-works.mjs";

const uri = (id) => ({ value: `http://www.wikidata.org/entity/${id}` });

test("an article title loses its disambiguator", () => {
  assert.equal(titleFromArticle("Homeland (TV series)"), "Homeland");
  assert.equal(titleFromArticle("Ajami"), "Ajami");
});

test("bindings fold into one candidate per item, earliest year kept", () => {
  const [fauda] = candidatesFromBindings([
    { item: uri("Q19866"), type: uri("Q5398426"), article: { value: "Fauda" }, tmdbTv: { value: "65834" }, date: { value: "2016-02-15T00:00:00Z" } },
    { item: uri("Q19866"), type: uri("Q15416"), imdb: { value: "tt4565380" }, date: { value: "2015-01-01T00:00:00Z" } },
  ]);
  assert.equal(fauda.year, 2015);
  assert.equal(kindOf(fauda), "series");
  assert.deepEqual(workRowFrom(fauda), {
    wikidata_id: "Q19866", kind: "series", title: "Fauda", title_norm: "fauda",
    year: 2015, imdb_id: "tt4565380", tmdb_id: "65834", source: "wikidata",
  });
});

test("a newsreel nobody outside Wikidata knows is not imported", () => {
  const [reel] = candidatesFromBindings([{ item: uri("Q1"), type: uri("Q24862"), itemLabel: { value: "Carmel newsreel" } }]);
  assert.equal(workRowFrom(reel), null);
});

test("a film's TMDB id is its movie id, never the TV one", () => {
  const [film] = candidatesFromBindings([{ item: uri("Q2"), type: uri("Q11424"), article: { value: "K (film)" }, tmdbMovie: { value: "10" }, tmdbTv: { value: "99" } }]);
  assert.equal(workRowFrom(film).tmdb_id, "10");
});

test("a row clashing on any held id, or repeated in the run, is dropped", () => {
  const rows = [
    { wikidata_id: "Q1", imdb_id: "tt1", tmdb_id: "1" },
    { wikidata_id: "Q2", imdb_id: "tt2", tmdb_id: "5" },
    { wikidata_id: "Q3", imdb_id: null, tmdb_id: "7" },
    { wikidata_id: "Q4", imdb_id: null, tmdb_id: "7" },
  ];
  assert.deepEqual(newRows(rows, { tmdb_id: ["5"] }).map((row) => row.wikidata_id), ["Q1", "Q3"]);
});
