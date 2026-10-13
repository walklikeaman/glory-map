import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCloudLibrary } from "../app/lib/cloud-library.mjs";
import { libraryImportSummary, libraryNoun, matchLibrary } from "../app/lib/library-match.mjs";
import { libraryEntryFor, mergeLibraries, parseMediaCsv } from "../app/lib/media-library.mjs";

// The header row and quoting of a real Goodreads "Export Library" file, trimmed to the
// columns that matter plus a few that must be ignored.
const HEADER = "Book Id,Title,Author,ISBN,ISBN13,My Rating,Average Rating,Year Published,Original Publication Year,Date Read,Date Added,Exclusive Shelf";
const EXPORT = [
  HEADER,
  '5907,"The Hobbit, or There and Back Again",J.R.R. Tolkien,"=""0618260307""","=""9780618260300""",5,4.29,2002,1937,2025/03/01,2025/01/02,read',
  '3,"Harry Potter and the Sorcerer\'s Stone (Harry Potter, #1)",J.K. Rowling,"=""""","=""""",0,4.47,1998,1997,,2024/05/05,read',
  '234225,Dune,Frank Herbert,"=""""","=""""",4,4.27,2005,1965,,2024/06/06,currently-reading',
  '11,"The Hitchhiker\'s Guide to the Galaxy (Hitchhiker\'s Guide to the Galaxy, #1)",Douglas Adams,"=""""","=""""",0,4.22,2005,1979,,2024/07/07,to-read',
].join("\n");

test("a Goodreads export becomes books you have read, on the ten-point scale", () => {
  const books = parseMediaCsv(EXPORT, "goodreads");
  assert.deepEqual(books.map((book) => book.title), [
    "The Hobbit, or There and Back Again",
    "Harry Potter and the Sorcerer's Stone",
    "Dune",
  ]);
  const [hobbit, potter, dune] = books;
  assert.equal(hobbit.kind, "book");
  assert.equal(hobbit.rating, 10);
  // The year the work first came out, not the edition on the shelf.
  assert.equal(hobbit.year, 1937);
  assert.equal(hobbit.watchedDate, "2025/03/01");
  assert.deepEqual(hobbit.sources, ["goodreads"]);
  // 0 in the export is "not rated", never 0/10.
  assert.equal(potter.rating, null);
  assert.equal(dune.rating, 8);
  assert.equal(dune.year, 1965);
});

test("an export with only the want-to-read shelf says so", () => {
  const only = [HEADER, '1,Emma,Jane Austen,"=""""","=""""",0,4,2003,1815,,2024/01/01,to-read'].join("\n");
  assert.throws(() => parseMediaCsv(only, "goodreads"), /No read books/);
});

test("a book and the film of the same name stay two rows", () => {
  const films = parseMediaCsv("Name,Year,Rating\nDune,1965,4", "letterboxd");
  const books = parseMediaCsv(EXPORT, "goodreads");
  const merged = mergeLibraries(films, books);
  assert.equal(merged.filter((row) => row.title === "Dune").length, 2);
});

test("a book lights up the book on the map, never the film", () => {
  const library = parseMediaCsv(EXPORT, "goodreads");
  assert.ok(libraryEntryFor({ title: "Dune", year: 1965, kind: "book" }, library));
  assert.equal(libraryEntryFor({ title: "Dune", year: null, kind: "film" }, library), null);
  // And the other way: a film library does not claim a book.
  const films = parseMediaCsv("Name,Year,Rating\nDune,,4", "letterboxd");
  assert.equal(libraryEntryFor({ title: "Dune", year: 1965, kind: "book" }, films), null);
});

test("books are matched against books in the catalogue", () => {
  const catalogue = [
    { id: "w1", title_norm: "dune", year: null, kind: "film", place_count: 9 },
    { id: "w2", title_norm: "dune", year: 1965, kind: "book", place_count: 2 },
    { id: "w3", title_norm: "the hobbit or there and back again", year: 1937, kind: "book", place_count: 4 },
    { id: "w4", title_norm: "harry potter and the sorcerer s stone", year: null, kind: "book", place_count: 3 },
  ];
  const held = matchLibrary(parseMediaCsv(EXPORT, "goodreads"), catalogue);
  assert.deepEqual(held.matched.map((entry) => entry.id).sort(), ["w2", "w3", "w4"]);
  assert.equal(held.places, 9);
});

test("a film with no year still matches the only film of its title, not a book", () => {
  const catalogue = [
    { id: "f", title_norm: "dune", year: 2021, kind: "film", place_count: 1 },
    { id: "b", title_norm: "dune", year: 1965, kind: "book", place_count: 1 },
  ];
  const held = matchLibrary([{ title: "Dune", year: null }], catalogue);
  assert.deepEqual(held.matched.map((entry) => entry.id), ["f"]);
});

test("a synced library keeps its books as books", () => {
  const [book] = normalizeCloudLibrary(parseMediaCsv(EXPORT, "goodreads"));
  assert.equal(book.kind, "book");
  assert.deepEqual(book.sources, ["goodreads"]);
  const [film] = normalizeCloudLibrary([{ title: "Heat", sources: ["imdb"], kind: "film" }]);
  assert.equal(film.kind, undefined);
});

test("the import sentence names what was imported", () => {
  const books = parseMediaCsv(EXPORT, "goodreads");
  const films = parseMediaCsv("Name,Year,Rating\nHeat,1995,4", "letterboxd");
  assert.equal(libraryNoun(films), "films");
  assert.equal(libraryNoun(books), "books");
  assert.equal(libraryNoun([...films, ...books]), "titles");
  assert.match(
    libraryImportSummary({ imported: 3, works: 2, places: 6, noun: libraryNoun(books) }),
    /^3 books imported · we hold 2 of them, with 6 places between them\.$/,
  );
});
