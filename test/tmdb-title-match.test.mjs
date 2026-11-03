import assert from "node:assert/strict";
import test from "node:test";

import { matchByImdb, matchByTitleYear, normalizeTitle } from "../app/lib/tmdb-title-match.mjs";

test("an IMDb id with exactly one TMDB record is an exact match", () => {
  assert.deepEqual(matchByImdb([{ id: 253, title: "Live and Let Die", release_date: "1973-06-27" }]),
    { status: "imdb_exact", tmdb_id: 253, tmdb_title: "Live and Let Die", tmdb_year: 1973 });
  assert.equal(matchByImdb([]), null);
  assert.equal(matchByImdb([{ id: 1 }, { id: 2 }]), null);
});

test("one film with the title within a year is the match", () => {
  const verdict = matchByTitleYear({ title: "The Omen", year: 1976 }, [
    { id: 794, title: "The Omen", release_date: "1976-06-25" },
    { id: 9806, title: "The Omen", release_date: "2006-06-06" },
  ]);
  assert.equal(verdict.status, "title_year_unique");
  assert.equal(verdict.tmdb_id, 794);
});

test("two same-titled films in one year are left alone", () => {
  assert.equal(matchByTitleYear({ title: "Twins", year: 1988 }, [
    { id: 1, title: "Twins", release_date: "1988-12-09" },
    { id: 2, title: "Twins", release_date: "1988-01-01" },
  ]).status, "several");
});

test("a title with the wrong year is not a match", () => {
  assert.equal(matchByTitleYear({ title: "Poltergeist", year: 1982 },
    [{ id: 243688, title: "Poltergeist", release_date: "2015-05-21" }]).status, "title_other_year");
});

test("a work with no year is never matched by title", () => {
  assert.equal(matchByTitleYear({ title: "Ghost", year: null }, [{ id: 1, title: "Ghost" }]).status, "no_year");
});

test("the original title counts, and punctuation does not", () => {
  assert.equal(normalizeTitle("Amélie & Co."), "amelie and co");
  assert.equal(matchByTitleYear({ title: "El precio del aborto", year: 1975 },
    [{ id: 510476, title: "The Price of Abortion", original_title: "El Precio del Aborto", release_date: "1975-01-01" }]).status,
  "title_year_unique");
});
