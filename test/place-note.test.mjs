import test from "node:test";
import assert from "node:assert/strict";

import {
  NOTE_LIMIT, describedFilms, listingLine, sceneNote, sourceLabel,
} from "../app/lib/place-note.mjs";

// Every sentence below is a real row from `location_submissions`, so the rules are checked
// against what the sources actually write rather than against what they ought to.

test("a moviemaps row keeps what the place plays and loses the attribution", () => {
  assert.equal(
    sceneNote('Appears as "Mike Tyson\'s Home". Source: I Am Not a Stalker'),
    'Appears as "Mike Tyson\'s Home"',
  );
  assert.equal(
    sceneNote("Appears in “Basics: Part I” & “Basics: Part II”. Source: IMDb"),
    "Appears in “Basics: Part I” & “Basics: Part II”",
  );
});

// 6,842 rows are this and nothing else. It says where we looked, in the place reserved for
// what the reader came to find out.
test("a row that is only an attribution has no note at all", () => {
  assert.equal(sceneNote("Source: IMDb"), null);
  assert.equal(sceneNote("Source: Clatsop County Historical Society"), null);
  assert.equal(sceneNote(""), null);
  assert.equal(sceneNote(null), null);
});

// Movie-Locations writes the title into every line, and the title is printed directly
// above the note.
test("the title prefix and the trailing address are both the heading again", () => {
  assert.equal(
    sceneNote(
      "Skyfall film location: the entrance to the MI6 underground facility: West Smithfield, London",
      { placeName: "West Smithfield, London" },
    ),
    "the entrance to the MI6 underground facility",
  );
  assert.equal(
    sceneNote(
      "Before Sunrise location: Jesse and Celine hear a harpsichord being played: Preßgaße, Vienna, Austria",
      { placeName: "Preßgaße, Vienna, Austria" },
    ),
    "Jesse and Celine hear a harpsichord being played",
  );
});

// A trailing segment that is NOT the place is part of the sentence. Dropping it would
// delete the answer.
test("a trailing segment that is not the address survives", () => {
  const sentence = "Appears as \"Portwenn School\": Louisa teaches inside, in episode 1x01";
  assert.equal(
    sceneNote(sentence, { placeName: "Port Isaac School, Cornwall" }),
    sentence,
  );
});

test("a note that only repeats the pin's own name is not a note", () => {
  assert.equal(sceneNote("RMS Queen Mary.", { placeName: "RMS Queen Mary" }), null);
  assert.equal(sceneNote("Bronson Canyon", { placeName: "Bronson Canyon, Griffith Park" }), null);
});

test("reelstreets loses its bracketed credit and keeps its scene", () => {
  assert.equal(
    sceneNote("After using the 'Instant Costume Change Lever' they depart from the Batcave as Batman and Robin. Bronson Caves, Bronson Canyon, Griffith Park, Los Angeles (IMDb)."),
    "After using the 'Instant Costume Change Lever' they depart from the Batcave as Batman and Robin. Bronson Caves, Bronson Canyon, Griffith Park, Los Angeles",
  );
});

// Wikipedia prose is already a sentence about the production, and nothing in it is ours to
// rewrite.
test("a wikipedia sentence passes through untouched", () => {
  const sentence = "Shooting took place in Paris, London, Bordeaux, and Iceland.";
  assert.equal(sceneNote(sentence), "Shooting took place in Paris, London, Bordeaux, and Iceland");
});

// A cut mid-word reads as a bug.
test("a long note is cut at a word and marked as cut", () => {
  const long = `${"scene ".repeat(60)}end`;
  const note = sceneNote(long);
  assert.ok(note.length <= NOTE_LIMIT + 1, `got ${note.length}`);
  assert.ok(note.endsWith("…"));
  assert.ok(!note.includes("  "));
  assert.equal(sceneNote("a b c", { limit: 4 }), "a b c");
});

test("a short answer is still an answer", () => {
  assert.equal(sceneNote('Appears as "Diner".'), 'Appears as "Diner"');
});

test("the source is named the way a reader would name it", () => {
  assert.equal(sourceLabel("movielocations"), "Movie-Locations");
  assert.equal(sourceLabel("wikipedia"), "Wikipedia");
  assert.equal(sourceLabel("permit_record"), "Film permit");
  assert.equal(sourceLabel("something_new"), "the source");
  assert.equal(sourceLabel(null), "the source");
});

// With no note, the popup says what we know and no more: somebody listed it, nobody
// checked it.
test("the fallback line never dresses a listing up as a scene", () => {
  assert.equal(listingLine({ source_kind: "moviemaps" }), "Reported by MovieMaps · unconfirmed");
  assert.equal(
    listingLine({ source_kind: "wikipedia", status: "verified" }),
    "Checked against Wikipedia",
  );
});

// Wilton's Music Hall really does list Chaplin twice — two sources, two spellings of one
// address, one work. With a description under each title the duplicate reads as a bug.
test("one film listed by two sources becomes one row with the fuller description", () => {
  const rows = describedFilms([
    { work_id: "w1", title: "Chaplin", source_kind: "moviemaps", note: 'Appears as "Aldershot Music Hall"' },
    {
      work_id: "w1", title: "Chaplin", source_kind: "movielocations",
      note: "Chaplin location: Charlie saves the day at the ‘Aldershot’ theatre: Graces Alley, London",
    },
  ], { placeName: "Graces Alley, London" });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].note, "Charlie saves the day at the ‘Aldershot’ theatre");
});

test("films without a work id are still told apart, and a note-less row survives", () => {
  const rows = describedFilms([
    { title: "A", year: 1999, note: "Source: IMDb" },
    { title: "B", year: 2003, note: 'Appears as "The Diner"' },
  ]);
  assert.deepEqual(rows.map((row) => [row.title, row.note]), [["A", null], ["B", 'Appears as "The Diner"']]);
});

test("nothing in gives nothing out", () => {
  assert.deepEqual(describedFilms(null), []);
  assert.deepEqual(describedFilms(undefined), []);
});
