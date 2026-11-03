import assert from "node:assert/strict";
import test from "node:test";

import {
  claimSentence,
  findTitleClaim,
  isMatchableTitle,
  isVictimMemorial,
  matchPlaque,
  plaqueSubmission,
  relationFromInscription,
} from "../app/lib/plaque-source.mjs";

const plaque = (over = {}) => ({
  id: "12345",
  title: "The Blackwood Arms",
  inscription: "Midsomer 'Midsomer Murders' filming location The Blackwood Arms Littleworth Common",
  address: "The Blackwood Arms, Common Lane",
  area: "Slough",
  latitude: "51.5905",
  longitude: "-0.6382",
  organisations: '["Visit Midsomer"]',
  erected: "2012",
  ...over,
});

const WORK = { id: "w-1", title: "Midsomer Murders", kind: "series" };

// --- the refusal that runs before anything else -------------------------------------

test("a memorial to victims never enters this pipeline", () => {
  // 6,269 rows of the world dump are Stolpersteine, and 1,413 of them fall inside the
  // phrase "lived here / wohnte hier" — exactly the phrase a naive filter keeps. A
  // walking tour of celebrity addresses must not touch them, and a filter that merely
  // tends to miss them is not good enough.
  assert.equal(isVictimMemorial({ inscription: "Hier wohnte Else Fritsche Jg. 1891 deportiert 1945" }), true);
  assert.equal(isVictimMemorial({ inscription: "Lived here", series: "Stolpersteine" }), true);
  assert.equal(isVictimMemorial({ inscription: "Ermordet in Auschwitz" }), true);
  assert.equal(isVictimMemorial(plaque()), false);

  assert.equal(matchPlaque(plaque({ series: "Stolpersteine" }), [WORK]), null);
});

// --- a mention is not a claim ---------------------------------------------------------

test("the title must be written as a title, not matched as lowercase prose", () => {
  // Matching a normalised substring produced 4,643 "hits" dominated by "the club", "the
  // beach", "the office". Case-sensitive matching against the original text took that
  // to 346.
  const work = { id: "w", title: "The Club", kind: "film" };
  assert.equal(findTitleClaim("the club met here every friday to watch films", work), null);
  assert.ok(findTitleClaim('Stars of the film "The Club" drank here', work));
});

test("the claim word must sit beside the title, not three sentences later", () => {
  // A pub called The Crown is not the series The Crown. Proximity took 346 hits to 46
  // and this is the case it removed.
  const crown = { id: "w", title: "The Crown", kind: "series" };
  assert.equal(
    findTitleClaim(
      "The Crown This building is believed to have been built in the 16th century and was "
      + "used as a coaching inn for many years, later becoming a filming location for local news",
      crown,
    ),
    null,
    "sixty characters is about a clause, and the verb here is far away",
  );
  assert.ok(findTitleClaim("The international blockbuster Hot Fuzz filmed at The Crown 2006",
    { id: "w", title: "Hot Fuzz", kind: "film" }));
});

test("a one-word title is refused, and length is only the weak half of the guard", () => {
  // "Up", "M" and "It" match everything, so they are refused outright. "The Room" is a
  // real film and is allowed through — case and proximity are what actually protect it,
  // and the length floor only removes the hopeless cases.
  assert.equal(isMatchableTitle("Up"), false);
  assert.equal(isMatchableTitle("M"), false);
  assert.equal(isMatchableTitle("Pi"), false);
  assert.equal(isMatchableTitle("The Room"), true);
  assert.equal(isMatchableTitle("Midsomer Murders"), true);

  // And the guard that does the work: lowercase prose about a room is not the film.
  const room = { id: "w", title: "The Room", kind: "film" };
  assert.equal(findTitleClaim("the room upstairs was used as a store", room), null);
});

// --- what the plaque says happened -----------------------------------------------------

test("the verb decides the relation, not the subject's job title", () => {
  assert.equal(relationFromInscription("Quadrophenia 1979 Filming location"), "filming_location");
  assert.equal(relationFromInscription("John Huston's location for film Moby Dick 1954"), "filming_location");
  assert.equal(relationFromInscription("Bands who recorded here include"), "filming_location");
  assert.equal(relationFromInscription("who wrote Abide With Me here"), "author_place");
  assert.equal(relationFromInscription("Sir Henry Irving, actor, lived here"), "author_place");
});

// --- the record ------------------------------------------------------------------------

test("the inscription is stored as the evidence, verbatim", () => {
  // The whole value of this source: the sentence can be checked against the wall by
  // anybody standing in front of it.
  const claim = findTitleClaim(plaque().inscription, WORK);
  const submission = plaqueSubmission(plaque(), WORK, claim);

  assert.equal(submission.source_kind, "open_plaques");
  assert.equal(submission.source_record_id, "12345");
  assert.match(submission.source_sentence, /Midsomer Murders' filming location/);
  assert.equal(submission.source_url, "https://openplaques.org/plaques/12345");
  assert.equal(submission.source_license, "PDDL 1.0");
  assert.match(submission.source_attribution, /Visit Midsomer \(2012\)/);
  assert.equal(submission.status, "pending");
  assert.equal(submission.lat, 51.5905);
  // The pin names the PLACE, not the plaque: the dump's title is "Midsomer Murders red
  // plaque", which tells nobody where to stand.
  assert.equal(submission.place_name, "The Blackwood Arms");
  assert.equal(submission.area_hint, "Common Lane, Slough");
});

test("a row without a usable coordinate is dropped rather than placed at Null Island", () => {
  // Number("") is 0 and 0 is finite — the coercion that has put places at 0,0 four times.
  assert.equal(plaqueSubmission(plaque({ latitude: "", longitude: "" }), WORK, null), null);
  assert.equal(plaqueSubmission(plaque({ id: "" }), WORK, null), null);
});

test("a place the dump could not name is refused", () => {
  // Some rows carry "?" as the address, and a pin labelled "?" occupies a stop on a
  // walk while telling nobody where to stand.
  assert.equal(plaqueSubmission(plaque({ address: "?", title: "" }), WORK, null), null);
  assert.equal(plaqueSubmission(plaque({ address: "", title: "" }), WORK, null), null);
});

test("the dump's own Null Island is refused", () => {
  // The Majestic Cinema in Leeds arrives as latitude 0.0, longitude -1.5475: the
  // longitude is right and the latitude was lost, which puts a Yorkshire cinema in the
  // Gulf of Guinea. `finiteOrNull` cannot catch it — 0 is finite and a legal latitude.
  assert.equal(plaqueSubmission(plaque({ latitude: "0.0", longitude: "-1.5475" }), WORK, null), null);
  assert.equal(plaqueSubmission(plaque({ latitude: "51.5", longitude: "0" }), WORK, null), null);
  assert.ok(plaqueSubmission(plaque(), WORK, null), "a real coordinate still passes");
});

test("the erecting organisation is credited by name, not as an empty array", () => {
  // The field is a JSON array written as text. Rendering it raw produced "Plaque erected
  // by []", which credits nobody in a way that looks like a bug.
  assert.equal(plaqueSubmission(plaque(), WORK, null).source_attribution,
    "Plaque erected by Visit Midsomer (2012)");
  assert.equal(plaqueSubmission(plaque({ organisations: "[]" }), WORK, null).source_attribution, null);
  assert.equal(plaqueSubmission(plaque({ organisations: '["A","B"]', erected: "" }), WORK, null)
    .source_attribution, "Plaque erected by A, B");
});

test("one plaque contributes one work, because a credit list is not a location list", () => {
  // "Among his film credits are Oklahoma, Doctor Dolittle, The Graduate" is a plaque
  // about a cinematographer's birthplace. Taking every title would claim four filming
  // locations that nobody stated.
  const credits = plaque({
    id: "999",
    title: "Gower House",
    inscription: 'Robert L. Surtees, 1906-1985. Among his film credits are "Doctor Dolittle," "The Graduate," "Summer of \'42."',
  });
  const works = [
    { id: "a", title: "Doctor Dolittle", kind: "film" },
    { id: "b", title: "The Graduate", kind: "film" },
  ];
  const matched = matchPlaque(credits, works);
  assert.equal(matched.work.id, "a", "the first claim wins and the rest are dropped");
});

test("the claim sentence is stored, not the whole wall", () => {
  // The One Tun's inscription runs to nine hundred characters about saffron crops and
  // cask sizes, with the claim about Oliver Twist in the first line. This project
  // already settled the rule for Wikipedia prose — one sentence, verbatim, checkable —
  // and the same rule earns the same benefit here.
  const long = plaque({
    id: "71884",
    title: "125 Saffron Hill",
    address: "125 Saffron Hill, London",
    inscription: "The One Tun was patronised by the author Charles Dickens and was mentioned "
      + "in his book 'Oliver Twist' under the fictional name of 'The Three Cripples'. By that "
      + "time it was already over half a century old and was run by William Dixie. Saffron "
      + "Hill derives its name from the crops of saffron that used to be grown here.",
  });
  const work = { id: "w", title: "Oliver Twist", kind: "book" };
  const claim = findTitleClaim(long.inscription, work);
  const submission = plaqueSubmission(long, work, claim);

  assert.match(submission.source_sentence, /^The One Tun was patronised/);
  assert.match(submission.source_sentence, /The Three Cripples'\.$/);
  assert.doesNotMatch(submission.source_sentence, /saffron crops|William Dixie/);
});

test("a title used as a heading takes the sentence after it", () => {
  // "Local Hero. Bill Forsyth's worldwide success was filmed in and around Pennan 1983"
  // — the sentence holding the title is two words long and proves nothing.
  const text = "Local Hero. Bill Forsyth's worldwide success was filmed in and around Pennan 1983";
  assert.match(claimSentence(text, 0), /Bill Forsyth's worldwide success was filmed/);
});

test("a sentence is not split on an initial", () => {
  // "J. R. R. Tolkien author of The Lord of the Rings convalesced here" must survive
  // whole; splitting on every full stop would leave "R." as the evidence.
  const text = "J. R. R. Tolkien author of The Lord of the Rings convalesced here in 1917.";
  assert.equal(claimSentence(text, text.indexOf("The Lord")), text);
});

test("the motivating plaques come through", () => {
  const laundrette = plaque({
    id: "7",
    title: "Powders launderette site",
    inscription: "My Beautiful Laundrette 1985 A Landmark of British Cinema was filmed on this road.",
  });
  const matched = matchPlaque(laundrette, [{ id: "w", title: "My Beautiful Laundrette", kind: "film" }]);
  assert.ok(matched, "a film we already hold, with the claim on the wall");
  assert.match(matched.submission.geocode_reason, /Inscription states/);
});

// --- the same title, a different work -------------------------------------------------
// Three links found in the live graph on 13.10.2026, each with its real inscription.

test("a plaque's dates refuse a remake made after them", () => {
  const studios = plaque({
    id: "8600",
    address: "Poole Street, London",
    inscription: "The Gainsborough Film Studios 1924-1949 Alfred Hitchcock, Michael Balcon, Ivor "
      + "Novello, Gracie Fields, 'The Lady Vanishes', 'The Wicked Lady' worked and were filmed here",
  });
  const remake = { id: "1983", title: "The Wicked Lady", kind: "film", year: 1983 };
  const original = { id: "1945", title: "The Wicked Lady", kind: "film", year: 1945 };
  assert.equal(matchPlaque(studios, [remake]), null);
  assert.equal(matchPlaque(studios, [remake, original]).work.id, "1945");
});

test("a plaque about a 1960s television series is not the 1997 film", () => {
  const moore = plaque({
    id: "2361",
    address: "Elstree Film Studios, Shenley Road",
    inscription: "This plaque honours Sir Roger Moore KBE distinguished actor who starred in The "
      + "Saint television series (1962-9) and feature films Crossplot (1969) and The Man Who "
      + "Haunted Himself (1970) made at Elstree Studios",
  });
  assert.equal(matchPlaque(moore, [{ id: "f", title: "The Saint", kind: "film", year: 1997 }]), null);
  assert.equal(
    matchPlaque(moore, [{ id: "s", title: "The Saint", kind: "series", year: 1962 }]).work.id,
    "s",
  );
});

test("a novelist writing a book is not the film made of it", () => {
  const fleming = plaque({
    id: "3288",
    address: "Duck Inn, Pett Bottom",
    inscription: "Ian Fleming 1908-1964 novelist wrote 'You Only Live Twice' here in 1964",
  });
  assert.equal(
    matchPlaque(fleming, [{ id: "f", title: "You Only Live Twice", kind: "film", year: 1967 }]),
    null,
  );
  assert.equal(
    matchPlaque(fleming, [{ id: "b", title: "You Only Live Twice", kind: "book", year: 1964 }]).work.id,
    "b",
  );
});

test("a work with no recorded year is not refused for lacking one", () => {
  const filmed = plaque({ inscription: "Billy Liar the classic comedy of the Swinging Sixties was filmed here 1962" });
  assert.ok(matchPlaque(filmed, [{ id: "w", title: "Billy Liar", kind: "film", year: null }]));
});
