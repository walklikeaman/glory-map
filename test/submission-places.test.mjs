import assert from "node:assert/strict";
import test from "node:test";

import {
  isRefusedSource,
  MATCHED_BY,
  REFUSED_SOURCES,
  selectSubmissionPlaces,
  submissionToLocation,
} from "../app/lib/submission-places.mjs";

const WORK = { id: "Q41668", title: "Notting Hill", year: 1999 };
const LONDON = { lat: 51.5074, lng: -0.1278 };

const row = (over = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  place_name: "Portobello Road",
  area_hint: "London",
  lat: 51.5165,
  lng: -0.2055,
  source_url: "https://moviemaps.org/movies/xyz",
  source_sentence: null,
  source_kind: "moviemaps",
  ...over,
});

test("a pending submission reaches the map as a candidate, never as a verified place", () => {
  // 38,270 rows are pending because nobody has checked them. Showing an unchecked claim
  // labelled unchecked is honest; showing 30,000 of them as pins that look like the
  // verified ones would undo the grounding rule in one commit.
  const location = submissionToLocation(row(), { work: WORK, kind: "film" });

  assert.equal(location.relation_kind, "candidate");
  assert.equal(location.relation_label, "Unconfirmed");
  assert.equal(location.loc_wikidata_id, null, "a queue row is not a Wikidata item");
  assert.match(location.loc_source_id, /^submission:/);
  assert.match(location.relation_description, /not confirmed yet/i);
});

test("a plaque says where its sentence can be checked", () => {
  // The card has to name the plaque, because the plaque is the reason to believe it —
  // "Source record" tells a person nothing they can act on.
  const location = submissionToLocation(
    row({ source_kind: "open_plaques", source_sentence: "The classic film The Railway Children was filmed at Oakworth Station 1970" }),
    { work: WORK, kind: "film" },
  );
  assert.equal(location.source_title, "The plaque on the wall");
  assert.match(location.relation_description, /commemorative plaque at this address/);
});

test("the source's own sentence leads when it has one", () => {
  const location = submissionToLocation(
    row({ source_sentence: "The blue door on Westbourne Park Road" }),
    { work: WORK, kind: "film" },
  );
  assert.match(location.relation_description, /^The blue door on Westbourne Park Road/);
});

test("a row without a usable coordinate is dropped rather than placed at Null Island", () => {
  // Number("") is 0 and 0 is finite — the coercion that has put places at 0,0 four times
  // in this codebase.
  assert.equal(submissionToLocation(row({ lat: "", lng: "" }), { work: WORK, kind: "film" }), null);
  assert.equal(submissionToLocation(row({ lat: null }), { work: WORK, kind: "film" }), null);
  assert.equal(submissionToLocation(row({ place_name: "  " }), { work: WORK, kind: "film" }), null);
});

test("every source reaches the map, and every card names who said it", () => {
  // Owner's decision 05.08: collect any source and mark it unverified rather than
  // discarding the lead. "Somebody said something happened here" is worth showing as
  // long as the card says exactly that and links to whoever said it.
  assert.deepEqual([...REFUSED_SOURCES], [], "nothing is withheld by default");
  assert.equal(isRefusedSource("reelstreets"), false);

  // Different places, because two sources naming the SAME place are deduplicated into
  // one pin — correct, and a separate question from which sources we accept.
  const chosen = selectSubmissionPlaces(
    [
      row({ source_kind: "reelstreets", place_name: "Westbourne Park Road", lat: 51.5188, lng: -0.2011 }),
      row({ id: "22222222-2222-2222-2222-222222222222" }),
    ],
    { work: WORK, kind: "film", center: LONDON },
  );
  assert.equal(chosen.length, 2);
  assert.match(chosen.find((place) => place.evidence_source === "reelstreets").relation_description, /Reelstreets/);
  assert.match(chosen.find((place) => place.evidence_source === "moviemaps").relation_description, /MovieMaps/);
  for (const place of chosen) assert.match(place.relation_description, /not confirmed yet/i);
});

test("a row matched only by title says so, because a title is not an identifier", () => {
  // Doctor Who is two series under one name: Wikidata points at tt0056751 (1963) and the
  // queue was filled under tt0436992 (2005). Both are Doctor Who and both should show —
  // but "same title" and "same identifier" are not the same claim, and Gladiator is two
  // different films.
  const [byTitle] = selectSubmissionPlaces([row()], {
    work: WORK, kind: "film", center: LONDON, matchedBy: MATCHED_BY.title,
  });
  assert.equal(byTitle.matched_by, "title");
  assert.match(byTitle.relation_label, /matched by title/i);
  assert.match(byTitle.relation_description, /by title, not by identifier/i);

  const [byId] = selectSubmissionPlaces([row()], { work: WORK, kind: "film", center: LONDON });
  assert.equal(byId.matched_by, "id");
  assert.equal(byId.relation_label, "Unconfirmed");
  assert.doesNotMatch(byId.relation_description, /by title/i);
});

test("nearest first, and bounded — one series has 961 rows in the queue", () => {
  const far = row({ id: "33333333-3333-3333-3333-333333333333", place_name: "Far Away", lat: 55.9, lng: -3.2 });
  const near = row({ id: "44444444-4444-4444-4444-444444444444", place_name: "Near Here", lat: 51.51, lng: -0.13 });
  const chosen = selectSubmissionPlaces([far, near], { work: WORK, kind: "film", center: LONDON, limit: 5 });

  assert.deepEqual(chosen.map((place) => place.loc_name), ["Near Here", "Far Away"]);

  const many = Array.from({ length: 40 }, (_, index) => row({
    id: `5${index}`.padEnd(36, "0"), place_name: `Place ${index}`, lat: 51.5 + index / 500,
  }));
  assert.equal(selectSubmissionPlaces(many, { work: WORK, kind: "film", center: LONDON, limit: 12 }).length, 12);
});

test("a place the live search already found is not shown twice", () => {
  // MovieMaps and Wikidata both know Alnwick Castle, and two pins for one place — one
  // labelled verified, one not — is the map contradicting itself.
  const chosen = selectSubmissionPlaces(
    [row({ place_name: "Alnwick Castle", lat: 55.4158, lng: -1.7061 })],
    {
      work: WORK, kind: "film", center: LONDON,
      exclude: [{ loc_name: "Alnwick Castle", lat: 55.4157, lng: -1.7060 }],
    },
  );
  assert.deepEqual(chosen, []);
});

// --- the same rows, on the film card (#158) ---------------------------------------

import { candidatesNote, coverageLine } from "../app/lib/work-card.mjs";
import { selectWorkCandidates, submissionToCandidate } from "../app/lib/submission-places.mjs";

test("a candidate on the card is badged by review state, not by precision", () => {
  // On this block the review state is the single thing a reader most needs before
  // believing anything else on the row, so it takes the badge the graph uses for
  // geocode precision.
  const pending = submissionToCandidate(row(), { work: WORK });
  assert.equal(pending.precision, "Unconfirmed");
  assert.equal(
    submissionToCandidate(row({ status: "verified" }), { work: WORK }).precision,
    "Source checked",
  );
});

test("a candidate carries who said it and where to check it", () => {
  const candidate = submissionToCandidate(row(), { work: WORK });
  assert.equal(candidate.role_label, "MovieMaps");
  assert.equal(candidate.source_url, "https://moviemaps.org/movies/xyz");
  assert.match(candidate.sentence, /Not confirmed yet/);
  // The area the source named, printed as the hint it is: location_submissions has no
  // city column and nothing here resolved one.
  assert.equal(candidate.city, "London");
});

test("a candidate's evidence count is null and never zero", () => {
  // On a fact, `evidence_count` means "how many sources back this". A queue row has not
  // been through the process that counts them, and a 0 would read as "nobody backs it" —
  // the opposite of what an unreviewed row means.
  assert.equal(submissionToCandidate(row(), { work: WORK }).evidence_count, null);
});

test("a rejected row never reaches the card", () => {
  // The queue's rule, and the map's: read NOT REJECTED. Filtering on `pending` once meant
  // believing a row a reviewer had already thrown out.
  const chosen = selectWorkCandidates(
    [row({ id: "a", status: "rejected" }), row({ id: "b", place_name: "Golborne Road" })],
    { work: WORK },
  );
  assert.deepEqual(chosen.map((c) => c.name), ["Golborne Road"]);
});

test("a row somebody checked leads the ones nobody has", () => {
  const chosen = selectWorkCandidates(
    [
      row({ id: "a", place_name: "Alpha" }),
      row({ id: "b", place_name: "Zulu", status: "verified" }),
    ],
    { work: WORK },
  );
  assert.deepEqual(chosen.map((c) => c.name), ["Zulu", "Alpha"]);
});

test("a row with no coordinate or no name is not a candidate", () => {
  const chosen = selectWorkCandidates(
    [row({ id: "a", place_name: "  " }), row({ id: "b", lat: null, lng: null })],
    { work: WORK },
  );
  // The nameless one is dropped outright; the one without a point keeps its name but
  // cannot claim a location.
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].lat, null);
});

test("the card counts what the queue holds, not what it managed to print", () => {
  // Person of Interest holds 961 rows. A card that lists 60 and says "60" states its own
  // display cap as a count — the silent truncation this project does not ship.
  const many = Array.from({ length: 62 }, (_, i) =>
    row({ id: `id-${i}`, place_name: `Place ${String(i).padStart(2, "0")}` }));
  const shown = selectWorkCandidates(many, { work: WORK });
  assert.equal(shown.length, 60);
  assert.match(candidatesNote(shown.length, 62), /^60 of 62 places/);
  assert.match(coverageLine({ places: [], candidates: 62 }), /62 places reported by location guides/);
});

test("a work with facts counts its candidates apart from them", () => {
  // The number before the dot is what we stand behind. Adding the two together is how a
  // card starts claiming 83 verified places for a film with 23.
  const line = coverageLine({
    places: [{ routable: true }, { routable: true }],
    tally: { on_location: 2 },
    candidates: 62,
  });
  assert.equal(line, "2 places · 2 filmed on location · 62 more unconfirmed.");
});

// ---------- rows nobody geocoded ----------
//
// Measured 10.09.2026: 10,981 queue rows have no coordinate across 1,506 works, and 562 of
// those works have nothing else — so 562 cards said "No places recorded for this work yet"
// about works we hold rows for. Nobody ever ran a geocoder over the queue ([[queue-review]]);
// the rows are not wrong, they are unlocated.

test("a row with no coordinate is still a candidate the card can print", () => {
  const candidate = submissionToCandidate(
    {
      id: "s1",
      place_name: "Somerset House in the Strand, London WC2",
      source_kind: "fandom",
      source_sentence: "SIS Building, MI6 Headquarters in Tomorrow Never Dies was filmed at Somerset House.",
      status: "pending",
      lat: null,
      lng: null,
    },
    { work: { title: "Tomorrow Never Dies" } },
  );
  assert.ok(candidate, "it is not dropped");
  assert.equal(candidate.mappable, false);
  assert.equal(candidate.lat, null);
  // A name, a sentence and a source are all readable without a point. The card is a list.
  assert.match(candidate.sentence, /Somerset House/);
});

test("a row that can be drawn says so, and leads one that cannot", () => {
  const rows = [
    { id: "a", place_name: "Zebra Crossing", source_kind: "moviemaps", status: "pending", lat: null, lng: null },
    { id: "b", place_name: "Yew Tree Lane", source_kind: "moviemaps", status: "pending", lat: 51.5, lng: -0.1 },
  ];
  const chosen = selectWorkCandidates(rows, { work: { title: "X" } });
  // Alphabetically "Yew" follows "Zebra"; it leads anyway because it has a point.
  assert.deepEqual(chosen.map((c) => c.name), ["Yew Tree Lane", "Zebra Crossing"]);
  assert.deepEqual(chosen.map((c) => c.mappable), [true, false]);
});

test("a checked row still outranks an unchecked one that happens to be located", () => {
  // Review state is the stronger signal; the coordinate breaks ties inside it.
  const rows = [
    { id: "a", place_name: "A", source_kind: "moviemaps", status: "pending", lat: 51.5, lng: -0.1 },
    { id: "b", place_name: "B", source_kind: "moviemaps", status: "verified", lat: null, lng: null },
  ];
  assert.deepEqual(selectWorkCandidates(rows, { work: { title: "X" } }).map((c) => c.name), ["B", "A"]);
});

test("a checked row says why in words, not in the review's codes", () => {
  const candidate = submissionToCandidate(
    row({ status: "verified", status_reason: "wikidata_entity+independent_corroboration+cited_source" }),
    { work: WORK },
  );
  assert.doesNotMatch(candidate.sentence, /_|\+/);
  assert.match(
    candidate.sentence,
    /checked the source: the place has a Wikidata entry, a second, independent source agrees and the source cites where it came from\./,
  );
  // A reason already written as a sentence (a plaque, a permit) passes through untouched.
  const plaque = submissionToCandidate(
    row({ status: "verified", status_reason: "a filming permit issued by the city for this address" }),
    { work: WORK },
  );
  assert.match(plaque.sentence, /checked the source: a filming permit issued by the city for this address\./);
});
