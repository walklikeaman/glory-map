import assert from "node:assert/strict";
import test from "node:test";

import { matchLibrary } from "../app/lib/library-match.mjs";
import { parseMediaCsv } from "../app/lib/media-library.mjs";
import { mediaSource } from "../app/lib/media-sources.mjs";

// The header row of Open Library's "Export your Reading Log" CSV, with a few rows in its
// quoting. Shelves are "Want to Read", "Currently Reading" and "Already Read".
const HEADER = "Work Id,Title,Authors,First Publish Year,Edition Id,Edition Count,Bookshelf,My Ratings,Ratings Average,Ratings Count,Has Ebook,Subjects,Subject People,Subject Places,Subject Times";
const EXPORT = [
  HEADER,
  'OL27448W,The Lord of the Rings,J.R.R. Tolkien,1954,OL51711484M,186,Already Read,5,4.4,1520,True,"Fantasy, Middle Earth",Frodo,Middle Earth,',
  'OL893415W,Dune,Frank Herbert,1965,,120,Currently Reading,,4.3,800,True,,,,',
  'OL82563W,Harry Potter and the Philosopher\'s Stone,J.K. Rowling,1997,,300,Want to Read,,4.2,2000,True,,,,',
].join("\n");

test("an Open Library reading log becomes books you have read, on the ten-point scale", () => {
  const books = parseMediaCsv(EXPORT, "openlibrary");
  assert.deepEqual(books.map((book) => book.title), ["The Lord of the Rings", "Dune"]);
  const [rings, dune] = books;
  assert.equal(rings.kind, "book");
  assert.equal(rings.rating, 10);
  assert.equal(rings.year, 1954);
  assert.deepEqual(rings.sources, ["openlibrary"]);
  // An empty rating is "not rated", never 0/10.
  assert.equal(dune.rating, null);
});

test("a log with only the want-to-read shelf says so", () => {
  const only = [HEADER, 'OL1W,Emma,Jane Austen,1815,,10,Want to Read,,4,10,False,,,,'].join("\n");
  assert.throws(() => parseMediaCsv(only, "openlibrary"), /No read books/);
});

test("Open Library is a books source with a card and an export link", () => {
  const source = mediaSource("openlibrary");
  assert.equal(source.kind, "book");
  assert.equal(source.scale, 5);
  assert.match(source.exportUrl, /^https:\/\/openlibrary\.org\//);
});

test("its books are matched against books in the catalogue, never the film", () => {
  const catalogue = [
    { id: "film", title_norm: "dune", year: 2021, kind: "film", place_count: 5 },
    { id: "book", title_norm: "dune", year: 1965, kind: "book", place_count: 2 },
  ];
  const held = matchLibrary(parseMediaCsv(EXPORT, "openlibrary"), catalogue);
  assert.deepEqual(held.matched.map((entry) => entry.id), ["book"]);
});
