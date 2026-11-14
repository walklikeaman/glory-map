import assert from "node:assert/strict";
import test from "node:test";

import {
  bestName,
  evidenceFromRows,
  geocodePrecisionFor,
  groupIntoPlaces,
  linksFromGroup,
  matchExistingPlace,
  placeFromGroup,
  quoteFrom,
  MAX_QUOTE_CHARS,
} from "../app/lib/promote-submission.mjs";

// Real shapes from `location_submissions`: two sites naming the Millennium Biltmore for two
// different films, at coordinates 11 m apart.
const biltmoreA = {
  id: "s1", work_id: "w1", place_name: "Millennium Biltmore Hotel",
  lat: 34.05025, lng: -118.25353, source_kind: "moviemaps",
  source_url: "https://moviemaps.org/locations/1", source_sentence: 'Appears as "the ballroom".',
  status_reason: "wikidata_entity+cited_source", wikidata_id: "Q1748031",
};
const biltmoreB = {
  id: "s2", work_id: "w2", place_name: "Millennium Biltmore",
  lat: 34.05034, lng: -118.25349, source_kind: "movielocations",
  source_url: "https://movie-locations.com/x", source_sentence: "the lobby staircase",
  status_reason: "independent_corroboration+cited_source", wikidata_id: null,
};

test("two rows at one address under one name become one place", () => {
  const groups = groupIntoPlaces([{ ...biltmoreA, wikidata_id: null }, biltmoreB]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 2);
  // The shortest name is the least likely to be a sentence about the scene.
  assert.equal(bestName(groups[0].rows), "Millennium Biltmore");
});

test("the shortest name is never a bare kind of place", () => {
  const rows = [{ place_name: "Bridge" }, { place_name: "Van Buren Street Bridge" }];
  assert.equal(bestName(rows), "Van Buren Street Bridge");
  assert.equal(bestName([{ place_name: "Road" }]), null);
});

// A wrong merge is a false claim that two films were shot in one building.
test("a different building at the same corner stays a different place", () => {
  const groups = groupIntoPlaces([
    { ...biltmoreA, wikidata_id: null },
    { ...biltmoreB, place_name: "Pershing Square" },
  ]);
  assert.equal(groups.length, 2);
});

test("a Wikidata id is an identity, and it decides before geometry does", () => {
  const far = { ...biltmoreA, id: "s3", work_id: "w3", lat: 51.5, lng: -0.12, place_name: "Somewhere else entirely" };
  const groups = groupIntoPlaces([biltmoreA, far]);
  assert.equal(groups.length, 1, "same Q-id, however differently spelled or placed");
  assert.equal(groups[0].wikidataId, "Q1748031");
});

// A row without an id must not be swallowed by one that has: their coordinates agreeing
// says nothing about whether the scraper meant that entity.
test("an unidentified row is never merged into an identified group", () => {
  const groups = groupIntoPlaces([biltmoreA, biltmoreB]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.wikidataId), ["Q1748031", null]);
});

test("a row with no usable coordinate cannot become a place", () => {
  assert.deepEqual(groupIntoPlaces([{ ...biltmoreA, lat: null, lng: null }]), []);
  assert.deepEqual(groupIntoPlaces([{ ...biltmoreA, lat: 0, lng: 0 }]), []);
});

// A precision we did not measure is a precision we may not claim.
test("only a Wikidata coordinate is called a point", () => {
  assert.equal(geocodePrecisionFor(biltmoreA), "point");
  assert.equal(geocodePrecisionFor(biltmoreB), "none");
  assert.equal(geocodePrecisionFor({ wikidata_id: "not-a-qid" }), "none");
});

// A row the geocoder resolved through Wikidata holds that entity's coordinate as much as
// a row that arrived carrying the entity — Tate Modern was promoted as `none` for this.
test("a coordinate the geocoder took from a Wikidata entity is a point too", () => {
  const tate = { place_name: "Tate Modern, Bankside, London", geocode_source: "wikidata", geocode_source_id: "Q193375" };
  assert.equal(geocodePrecisionFor(tate), "point");
  assert.equal(geocodePrecisionFor({ ...tate, geocode_source_id: null }), "none");
  assert.equal(geocodePrecisionFor({ ...tate, geocode_source: "moviemaps" }), "none");
});

test("the place a group becomes says what we know and no more", () => {
  const [group] = groupIntoPlaces([biltmoreB]);
  const place = placeFromGroup(group, { scoreOf: () => 0.72 });

  assert.equal(place.name, "Millennium Biltmore");
  assert.equal(place.place_class, "unknown", "we know where it is, not what it is");
  assert.equal(place.confidence_band, "verified");
  assert.equal(place.status, "verified");
  assert.equal(place.confidence, 0.72);
  assert.equal(place.shot_on_set, false);
  assert.equal(place.status_reason, "independent_corroboration+cited_source");
});

// A group is as good as its best evidence; averaging would let two weak rows dilute one
// strong one into pending.
test("confidence is the strongest row in the group, not the mean", () => {
  const [group] = groupIntoPlaces([{ ...biltmoreA, wikidata_id: null }, biltmoreB]);
  const scores = new Map([["s1", 0.9], ["s2", 0.5]]);
  assert.equal(placeFromGroup(group, { scoreOf: (row) => scores.get(row.id) }).confidence, 0.9);
});

// The camera was here; the scene is set somewhere else. Decided by the polygon.
test("a point inside a studio lot is marked as shot on set", () => {
  // Inside the 20th Century Studios ring in studio-lots.mjs.
  const [group] = groupIntoPlaces([{
    ...biltmoreB, place_name: "Stage 20", lat: 34.0520, lng: -118.4140,
  }]);
  assert.equal(placeFromGroup(group, { scoreOf: () => 1 }).shot_on_set, true);
});

// The ledger's rule is one row = one signal.
test("every submission in the group files its own evidence", () => {
  const evidence = evidenceFromRows("p1", [biltmoreA, biltmoreB]);
  assert.equal(evidence.length, 2);
  assert.deepEqual(evidence.map((row) => row.source_ref), ["moviemaps", "movielocations"]);
  assert.equal(evidence[0].method, "text_mention");
  assert.equal(evidence[0].agrees, true);
  assert.equal(evidence[0].snippet, 'Appears as "the ballroom".');
});

// Somebody did search for a web_research row, so its evidence says so.
test("a web research row files web_search_cited evidence", () => {
  const [evidence] = evidenceFromRows("p1", [{ ...biltmoreA, source_kind: "web_research" }]);
  assert.equal(evidence.method, "web_search_cited");
});

// Two sources naming the same film at the same address are one claim, not two.
test("one link per work, at the strongest confidence for it", () => {
  const rows = [biltmoreA, { ...biltmoreB, work_id: "w1" }];
  const scores = new Map([["s1", 0.7], ["s2", 0.85]]);
  const links = linksFromGroup("p1", rows, { scoreOf: (row) => scores.get(row.id) });

  assert.equal(links.length, 1);
  assert.equal(links[0].work_id, "w1");
  assert.equal(links[0].confidence, 0.85);
  assert.equal(links[0].relation_kind, "filming_location");
});

// A promotion must land ON the places the graph already holds, not beside them.
test("an existing graph place is matched by id, then by point and name", () => {
  const places = [
    { id: "p-old", wikidata_id: "Q1748031", name: "Millennium Biltmore Hotel", lat: 34.0502, lng: -118.2535 },
    { id: "p-other", wikidata_id: null, name: "Pershing Square", lat: 34.0489, lng: -118.2519 },
  ];
  const [identified] = groupIntoPlaces([biltmoreA]);
  assert.equal(matchExistingPlace(identified, places).id, "p-old");

  const [byGeometry] = groupIntoPlaces([biltmoreB]);
  assert.equal(matchExistingPlace(byGeometry, places).id, "p-old");

  const [elsewhere] = groupIntoPlaces([{ ...biltmoreB, lat: 51.5, lng: -0.12, wikidata_id: null }]);
  assert.equal(matchExistingPlace(elsewhere, places), null);
});

// ---------- a fact says what its source said ----------

test("a plaque's inscription becomes the fact's own sentence", () => {
  // The card read "Crime and Punishment was filmed at 14 ulitsa Kaznacheiskaia"; the plaque says:
  assert.equal(
    quoteFrom({ source_kind: "open_plaques", source_sentence: "The novel Crime and Punishment was written here." }),
    "The novel Crime and Punishment was written here.",
  );
});

test("a Wikipedia sentence is quoted verbatim, whitespace aside", () => {
  assert.equal(
    quoteFrom({ source_kind: "wikipedia", source_sentence: "Filming took place at  Alnwick Castle\nover three nights." }),
    "Filming took place at Alnwick Castle over three nights.",
  );
});

test("a fan site's prose is evidence, never a published statement", () => {
  for (const source_kind of ["moviemaps", "movielocations", "reelstreets", "fandom", "permit_record", undefined]) {
    assert.equal(quoteFrom({ source_kind, source_sentence: "The chase was filmed on this very corner." }), null, source_kind);
  }
});

test("a quote is never shortened to fit", () => {
  const long = "Filming took place here. ".repeat(40).trim();
  assert.ok(long.length > MAX_QUOTE_CHARS);
  assert.equal(quoteFrom({ source_kind: "wikipedia", source_sentence: long }), null);
});

test("a sentence that states nothing is not a statement", () => {
  assert.equal(quoteFrom({ source_kind: "wikipedia", source_sentence: "" }), null);
  assert.equal(quoteFrom({ source_kind: "wikipedia", source_sentence: null }), null);
  assert.equal(quoteFrom({ source_kind: "open_plaques", source_sentence: "Photo: J. Smith" }), null);
  assert.equal(quoteFrom(null), null);
});

test("a wikitext list item is not a sentence", () => {
  // Found in the dry run: a French edition's bullet, kept by the extractor.
  assert.equal(quoteFrom({ source_kind: "wikipedia", source_sentence: "* Hankley en Surrey, Angleterre" }), null);
  assert.equal(quoteFrom({ source_kind: "wikipedia", source_sentence: "# Second item of a list" }), null);
});

test("an apostrophe our ingest doubled is the wall's single one again", () => {
  assert.equal(
    quoteFrom({ source_kind: "open_plaques", source_sentence: "In Langley Lane, at his parents'' house Little Balgair, Frederick Knott wrote 'Dial M For Murder'." }),
    "In Langley Lane, at his parents' house Little Balgair, Frederick Knott wrote 'Dial M For Murder'.",
  );
});
