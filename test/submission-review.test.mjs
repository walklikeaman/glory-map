import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_NAME_WORDS,
  STATUS,
  blocker,
  disqualification,
  echoesItsOwnGeocode,
  independentSources,
  reviewSubmission,
  statesSomething,
  submissionSignals,
  tallyVerdicts,
} from "../app/lib/submission-review.mjs";

const row = (overrides = {}) => ({
  id: "s1",
  place_name: "Alnwick Castle",
  place_key: "alnwick castle",
  lat: 55.4157,
  lng: -1.7057,
  source_kind: "moviemaps",
  source_sentence: null,
  source_url: "https://moviemaps.org/movies/x",
  status: "pending",
  wikidata_id: null,
  corroborated_by: null,
  ...overrides,
});

// --- refusals: claims the product must not make ---------------------------------

test("a link label is not a place", () => {
  // "Google Maps" is filed against 155 works in the live queue. It is the caption of a
  // map link that the scraper read as a location.
  assert.equal(disqualification(row({ place_name: "Google Maps", place_key: "google maps" })), "not_a_place");
  assert.equal(
    disqualification(row({ place_name: "Google StreetView", place_key: "google streetview" })),
    "not_a_place",
  );
});

test("the non-place list matches a whole name, never a fragment", () => {
  // The Googleplex is a place; "Google Maps" is not. This project has twice shipped a
  // rule that matched a name inside another name — Bowie the town, Notting Hill the
  // district — and both times it looked right.
  assert.equal(disqualification(row({ place_name: "Googleplex", place_key: "googleplex" })), null);
  assert.equal(disqualification(row({ place_name: "Map Room, Kew", place_key: "map room, kew" })), null);
  assert.equal(
    disqualification(row({ place_name: "National Gallery", place_key: "national gallery" })),
    null,
  );
});

test("a kind of place is not a place", () => {
  // "Bridge" and "Street" came in from location guides as the name of a pin.
  assert.equal(disqualification(row({ place_name: "Bridge", place_key: "bridge" })), "vague_not_a_place");
  assert.equal(disqualification(row({ place_name: "Library", place_key: "library" })), "vague_not_a_place");
  assert.equal(disqualification(row({ place_name: "Van Buren Street Bridge", place_key: "van buren street bridge" })), null);
});

test("a photo credit in the name column is refused", () => {
  assert.equal(
    disqualification(row({ place_name: "Wikipedia / David Leigh Ellis", place_key: "wikipedia / david leigh ellis" })),
    "photo_credit_not_a_place",
  );
});

test("Null Island is refused, and a legal zero is not", () => {
  // 0 is finite and a legal latitude. Four incidents so far, the last a Leeds cinema
  // arriving at latitude 0.0 with a correct longitude.
  assert.equal(disqualification(row({ lat: 0, lng: 0 })), "null_island");
  assert.equal(disqualification(row({ lat: 0, lng: -1.5 })), null);
  assert.equal(disqualification(row({ lat: 51.5, lng: 0 })), null);
  assert.equal(disqualification(row({ lat: 91, lng: 0 })), "impossible_coordinate");
});

test("a name with no letters at all is refused", () => {
  assert.equal(disqualification(row({ place_name: "—", place_key: "—" })), "name_has_no_letters");
  assert.equal(disqualification(row({ place_name: "  " })), "no_place_name");
});

// --- blockers: true perhaps, unusable certainly ---------------------------------

test("a caption is not a name, and says whose fault that is", () => {
  // 54% of movie-locations rows still carry the prefix the extractor was meant to cut,
  // which is why zero of its 5,783 rows have a coordinate. The row is not wrong; our
  // extraction is, and the reason has to say so or the next session rejects real places.
  const caption = "John Wick Chapter 2 location: Wick gets the plans: Antica Libreria "
    + "Cascianelli, Largo Febo, Rome | Photograph: Alamy Stock Photo";
  assert.equal(blocker(row({ place_name: caption, lat: null, lng: null })), "unusable_name:photo_credit_appended");
  assert.equal(
    blocker(row({ place_name: "My Week With Marilyn location: Pinewood Studio Gate", lat: null, lng: null })),
    "unusable_name:caption_prefix_not_cut",
  );
});

test("a sentence longer than twelve words is not a name", () => {
  // Measured, not picked: MovieMaps has TWO rows over twelve words in 30,153; movie
  // locations has 2,722 in 5,783. The threshold separates the two populations.
  const prose = Array.from({ length: MAX_NAME_WORDS + 1 }, (_, i) => `word${i}`).join(" ");
  assert.equal(blocker(row({ place_name: prose })), "unusable_name:sentence_not_a_name");
  const name = Array.from({ length: MAX_NAME_WORDS }, (_, i) => `word${i}`).join(" ");
  assert.equal(blocker(row({ place_name: name })), null);
});

test("no coordinate is a blocker, not a refusal", () => {
  // 13,841 rows are here. They are waiting on a geocode, not on a judgement.
  const verdict = reviewSubmission(row({ lat: null, lng: null }));
  assert.equal(verdict.status, STATUS.pending);
  assert.equal(verdict.reason, "no_coordinate");
});

// --- sources a stranger can check ------------------------------------------------

test("a plaque verifies because anyone can stand there and read it", () => {
  const verdict = reviewSubmission(row({
    source_kind: "open_plaques",
    place_name: "Duck Inn",
    place_key: "duck inn",
    source_sentence: "Ian Fleming wrote You Only Live Twice at this inn in 1963.",
  }));
  assert.equal(verdict.status, STATUS.verified);
  assert.match(verdict.reason, /on a wall/);
});

test("a filming permit verifies because the city that issued it is the authority", () => {
  const verdict = reviewSubmission(row({ source_kind: "permit_record" }));
  assert.equal(verdict.status, STATUS.verified);
  assert.match(verdict.reason, /permit/);
});

test("a checkable source with no coordinate still cannot be a pin", () => {
  // Order matters: a plaque we cannot place is not a verified pin, it is a plaque we
  // cannot place.
  const verdict = reviewSubmission(row({ source_kind: "open_plaques", lat: null, lng: null }));
  assert.equal(verdict.status, STATUS.pending);
  assert.equal(verdict.reason, "no_coordinate");
});

test("a checkable source that is not a place is still refused first", () => {
  const verdict = reviewSubmission(row({
    source_kind: "permit_record", place_name: "Google Maps", place_key: "google maps",
  }));
  assert.equal(verdict.status, STATUS.rejected);
});

// --- the signals the resolver is producing next ----------------------------------

test("a scrape on its own produces no signal, and says so", () => {
  const verdict = reviewSubmission(row());
  assert.equal(verdict.status, STATUS.pending);
  assert.equal(verdict.reason, "no_signal_yet");
  assert.deepEqual(verdict.signals, []);
});

test("corroboration counts SOURCES, not rows", () => {
  // One site repeating itself is not a second opinion.
  assert.deepEqual(
    independentSources(row({
      source_kind: "moviemaps",
      corroborated_by: [{ source_kind: "moviemaps" }, { source_kind: "moviemaps" }],
    })),
    [],
  );
  assert.deepEqual(
    independentSources(row({
      source_kind: "moviemaps",
      corroborated_by: [{ source_kind: "reelstreets" }, { source_kind: "movielocations" }],
    })),
    ["reelstreets", "movielocations"],
  );
});

test("two agreeing scrapes are evidence and are not enough on their own", () => {
  // Both are scrapes of secondary material and may be repeating a common upstream.
  const verdict = reviewSubmission(row({
    corroborated_by: [{ source_kind: "reelstreets" }],
  }));
  assert.equal(verdict.status, STATUS.pending);
  assert.deepEqual(verdict.signals, ["independent_corroboration"]);
  assert.match(verdict.reason, /^insufficient:/);
});

test("a resolved Q-id alone proves the building, not the film, and does not verify", () => {
  // The resolver finds the Q-id by asking what sits at the coordinate the scraper gave.
  // That confirms the address is real. Publishing "this film was shot here" on it would
  // be asserting the claim from the geography — and it scores 0.6, exactly the
  // threshold, so without this rule it would sail through.
  const verdict = reviewSubmission(row({ wikidata_id: "Q207149" }));
  assert.equal(verdict.status, STATUS.pending);
  assert.deepEqual(verdict.signals, ["wikidata_entity"]);
  assert.ok(verdict.score >= 0.6);
});

test("a Q-id plus a statement the source made verifies", () => {
  const verdict = reviewSubmission(row({
    wikidata_id: "Q207149",
    source_sentence: "The chase was filmed at Alnwick Castle over three nights.",
  }));
  assert.equal(verdict.status, STATUS.verified);
  assert.deepEqual(verdict.signals, ["wikidata_entity", "cited_source"]);
});

test("a Q-id that only echoes our own geocode is not a second source", () => {
  // Clifton Village, 21.09: our geocoder placed it in Nottingham for "Bristol" by looking
  // the name up in Wikidata; the resolver then asked what sat at that point under that name
  // and got the same entity back. 472 of 476 Wikipedia Q-ids written that day did exactly
  // this. With it counted, one cited sentence became `verified`.
  const echoed = row({
    place_name: "Clifton Village",
    source_kind: "wikipedia",
    source_url: "https://en.wikipedia.org/w/index.php?oldid=1",
    source_sentence: "Scenes were shot in Clifton Village.",
    geocode_source: "wikidata",
    geocode_source_id: "Q5133339",
    wikidata_id: "Q5133339",
  });
  assert.equal(echoesItsOwnGeocode(echoed), true);
  assert.ok(!submissionSignals(echoed).includes("wikidata_entity"));
  assert.equal(reviewSubmission(echoed).status, STATUS.pending);
  assert.equal(reviewSubmission(echoed).reason, "insufficient:cited_source");
});

test("a Q-id found independently of the coordinate still counts", () => {
  // The coordinate came from the scraper, or from a different entity: then asking what sits
  // there IS a second look.
  const scraped = row({ wikidata_id: "Q207149", geocode_source: "moviemaps", geocode_source_id: "4d1" });
  assert.equal(echoesItsOwnGeocode(scraped), false);
  assert.ok(submissionSignals(scraped).includes("wikidata_entity"));
  const different = row({ wikidata_id: "Q207149", geocode_source: "wikidata", geocode_source_id: "Q99" });
  assert.equal(echoesItsOwnGeocode(different), false);
  assert.ok(submissionSignals(different).includes("wikidata_entity"));
});

test("an echo with a real second signal still verifies on that signal", () => {
  const corroborated = row({
    geocode_source: "wikidata", geocode_source_id: "Q207149", wikidata_id: "Q207149",
    source_sentence: "The chase was filmed at Alnwick Castle over three nights.",
    corroborated_by: [{ source_kind: "reelstreets", submission_id: "x", place_name: "Alnwick Castle", distance_m: 30, gave_coordinate: true }],
  });
  const verdict = reviewSubmission(corroborated);
  assert.equal(verdict.status, STATUS.verified);
  assert.ok(!verdict.signals.includes("wikidata_entity"));
});

test("a Q-id plus corroboration from another site verifies", () => {
  const verdict = reviewSubmission(row({
    wikidata_id: "Q207149",
    corroborated_by: [{ source_kind: "reelstreets" }],
  }));
  assert.equal(verdict.status, STATUS.verified);
  assert.ok(verdict.score >= 0.6);
});

test("a borrowed coordinate corroborates only across a city block, and only from elsewhere", () => {
  const near = row({
    wikidata_id: "Q207149",
    corroborated_by: [{ source_kind: "reelstreets", gave_coordinate: true, distance_m: 34 }],
  });
  assert.ok(submissionSignals(near).includes("coordinate_agreement"));

  const far = row({
    corroborated_by: [{ source_kind: "reelstreets", gave_coordinate: true, distance_m: 900 }],
  });
  assert.ok(!submissionSignals(far).includes("coordinate_agreement"));

  const itself = row({
    corroborated_by: [{ source_kind: "moviemaps", gave_coordinate: true, distance_m: 10 }],
  });
  assert.ok(!submissionSignals(itself).includes("coordinate_agreement"));
});

test("an attribution is not a statement", () => {
  // Checked against the live rows: of the queue rows a Q-id had been resolved for, a
  // third carry nothing but "Source: Wikipedia" or "Source: IMDb". Counting those as a
  // citation would mean the signal fires on the word "Source".
  assert.equal(statesSomething("Source: Wikipedia"), false);
  assert.equal(statesSomething("Source: Winter Is Coming"), false);
  assert.equal(statesSomething("  "), false);
  assert.equal(statesSomething(null), false);
});

test("a statement counts even when it does not repeat the place name", () => {
  // The first version of this rule asked whether the sentence mentions the place. It was
  // wrong in both directions on the real corpus: "Bridge used in the first episode of
  // series 1" PASSED for Vauxhall Bridge on the word "bridge", and "Jim wakes up from a
  // coma in an abandoned hospital" FAILED for Central Middlesex Hospital, which is a real
  // statement about a real row. Prose does not repeat its own heading.
  assert.equal(statesSomething("Jim wakes up from a coma in an abandoned hospital."), true);
  assert.equal(statesSomething('Appears as "Highway Rest Stop". Source: IMDb'), true);
});

test("a citation needs both a statement and a page it can be read on", () => {
  assert.ok(submissionSignals(row({
    source_sentence: "Anya meets Joe on the Spanish Steps.",
  })).includes("cited_source"));
  assert.ok(!submissionSignals(row({
    source_sentence: "Anya meets Joe on the Spanish Steps.", source_url: null,
  })).includes("cited_source"));
  assert.ok(!submissionSignals(row({ source_sentence: "Source: IMDb" })).includes("cited_source"));
});

test("a malformed Q-id is not a Wikidata entity", () => {
  assert.ok(!submissionSignals(row({ wikidata_id: "Q0" })).includes("wikidata_entity"));
  assert.ok(!submissionSignals(row({ wikidata_id: "alnwick castle" })).includes("wikidata_entity"));
  assert.ok(submissionSignals(row({ wikidata_id: "Q207149" })).includes("wikidata_entity"));
});

// --- the run has to be countable -------------------------------------------------

test("verdicts tally by status and by reason", () => {
  const tally = tallyVerdicts([
    { status: "rejected", reason: "not_a_place" },
    { status: "rejected", reason: "not_a_place" },
    { status: "pending", reason: "no_coordinate" },
  ]);
  assert.equal(tally.rejected, 2);
  assert.equal(tally.pending, 1);
  assert.equal(tally.reasons["rejected:not_a_place"], 2);
});
