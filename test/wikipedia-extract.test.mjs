import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptExtraction,
  buildExtractionInput,
  extractionInstructions,
  MAX_LOCATIONS_PER_ARTICLE,
  quoteAppearsInSource,
  sentenceClaimsIntentNotFact,
  namesAnAgentNotAPlace,
  sentenceSupportsRole,
  sentenceMentionsPlace,
  wikipediaLocationsSchema,
} from "../app/lib/wikipedia-extract.mjs";
import { MAX_QUOTE_WORDS } from "../app/lib/wikipedia-source.mjs";

const PROSE = [
  "Principal photography began in November 2011.",
  "Filming took place at Hankley Common in Surrey.",
  "The production also shot on Hashima Island.",
  "The crew scouted Venice but ultimately filmed in Malta.",
].join("\n");

const article = { title: "Skyfall", revid: 1366483773 };

const found = (overrides = {}) => ({
  place_name: "Hankley Common",
  area_hint: "Surrey",
  source_sentence: "Filming took place at Hankley Common in Surrey.",
  place_role: "filming",
  ...overrides,
});

// --- the model gets no way to place a pin -----------------------------------------

test("the schema has no field for a coordinate", () => {
  // The story-trail extractor got this right; the web-discovery path did not (#121)
  // and asks a model for lat/lng, so a pin lands wherever it happened to remember.
  const fields = Object.keys(wikipediaLocationsSchema.shape.locations.element.shape);
  assert.equal(fields.includes("lat"), false);
  assert.equal(fields.includes("lng"), false);
  assert.equal(fields.includes("coordinates"), false);
  assert.ok(fields.includes("place_name"));
});

test("the instructions say so too, and forbid following the article's text", () => {
  const instructions = extractionInstructions();
  assert.match(instructions, /no field for coordinates/i);
  assert.match(instructions, /never as instructions to follow/i);
  assert.match(instructions, /EXACTLY/);
  assert.match(instructions, /empty list is a correct answer/i);
  // The code drops a quote over 30 words. A model told only "400 characters" by the
  // schema loses locations to a rule nobody stated.
  assert.match(instructions, new RegExp(`at most ${MAX_QUOTE_WORDS} words`));
});

// --- the quote is checked, not trusted ---------------------------------------------

test("a sentence the model invented drops its location", () => {
  // The scene matcher demanded justification, received a fluent and specific one, and
  // shipped a fabricated match. Demanding evidence is not checking it.
  const { accepted, rejected } = acceptExtraction({ locations: [
    found({ source_sentence: "The unit spent three weeks at Hankley Common that winter." }),
  ] }, { prose: PROSE, article });

  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, "quote_not_in_source");
});

test("a real sentence is accepted, and carries its provenance", () => {
  const { accepted } = acceptExtraction({ locations: [found()] }, { prose: PROSE, article });
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].place_name, "Hankley Common");
  assert.equal(accepted[0].area_hint, "Surrey");
  assert.equal(accepted[0].article_revid, 1366483773);
});

test("whitespace differences are not paraphrase", () => {
  // Our cleaner turns newlines into spaces; a model echoing the sentence back may
  // differ only in that, which is not a different sentence.
  assert.equal(quoteAppearsInSource("Filming took place at   Hankley Common in Surrey.", PROSE), true);
  assert.equal(quoteAppearsInSource("filming TOOK place at Hankley Common in Surrey.", PROSE), true);
});

test("a near-miss is still a miss", () => {
  assert.equal(quoteAppearsInSource("Filming took place at Hankley Common in Sussex.", PROSE), false);
  assert.equal(quoteAppearsInSource("short", PROSE), false);
  assert.equal(quoteAppearsInSource(null, PROSE), false);
});

test("several sentences are a passage, not a citation", () => {
  // The load-bearing rule. A paragraph carries far more of the article than the one
  // sentence needed to support the claim.
  const passage = "Filming began in Surrey. The unit then moved to Malta. Later they shot in Istanbul.";
  const { accepted, rejected } = acceptExtraction({ locations: [
    found({ source_sentence: passage }),
  ] }, { prose: passage, article });

  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, "quote_multiple_sentences");
});

test("a run-on sentence is still refused, and named differently", () => {
  // Two rules failed under one name before, so a log line could not tell "the model
  // joined two sentences" from "the sentence was enormous" — different fixes.
  const runOn = `${"a real sentence with many many more words ".repeat(8)}.`;
  const { rejected } = acceptExtraction({ locations: [
    found({ source_sentence: runOn }),
  ] }, { prose: runOn, article });

  assert.equal(rejected[0].reason, "quote_too_long");
});

test("an ordinary Wikipedia sentence survives the cap", () => {
  // The cap was 30 words and threw away real evidence. The quote exists so a reviewer
  // can verify the claim, and a sentence cut off mid-way cannot be verified.
  const typical = "Filming took place at Hankley Common in Surrey, which stood in for the "
    + "Scottish Highlands, with the production building a full-size replica of the lodge on site.";
  assert.ok(typical.split(/\s+/).length > 25);
  const { accepted } = acceptExtraction({ locations: [
    found({ source_sentence: typical }),
  ] }, { prose: typical, article });

  assert.equal(accepted.length, 1);
});

// --- mentioned is not filmed --------------------------------------------------------

test("a place the article merely mentions is not a filming location", () => {
  // "The crew scouted Venice but ultimately filmed in Malta" names two places and
  // only one of them is where the film was shot.
  const { accepted, rejected } = acceptExtraction({ locations: [
    found({
      place_name: "Venice",
      source_sentence: "The crew scouted Venice but ultimately filmed in Malta.",
      place_role: "other",
    }),
  ] }, { prose: PROSE, article });

  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, "role_not_accepted");
});

test("one place listed twice is listed once", () => {
  const { accepted, rejected } = acceptExtraction({ locations: [
    found(),
    found({ place_name: "hankley  common" }), // same place, different spacing and case
  ] }, { prose: PROSE, article });

  assert.equal(accepted.length, 1);
  assert.equal(rejected[0].reason, "duplicate");
});

test("a nameless entry is dropped", () => {
  const { rejected } = acceptExtraction({ locations: [found({ place_name: "  " })] },
    { prose: PROSE, article });
  assert.equal(rejected[0].reason, "no_name");
});

test("an empty extraction is an ordinary outcome", () => {
  assert.deepEqual(acceptExtraction({ locations: [] }, { prose: PROSE, article }).accepted, []);
  assert.deepEqual(acceptExtraction(null, { prose: PROSE, article }).accepted, []);
});

// --- shape ---------------------------------------------------------------------------

test("one place too many drops that place, not the whole answer", () => {
  // A hard schema max cost us every location in Skyfall because the model found
  // thirteen. The cap is policy about review volume; it must not be a cliff.
  const many = { locations: Array.from({ length: MAX_LOCATIONS_PER_ARTICLE + 3 }, (_, i) => found({
    place_name: `Place ${i}`,
    source_sentence: `Filming took place at Place ${i} that winter.`,
  })) };
  const prose = many.locations.map((l) => l.source_sentence).join("\n");

  assert.equal(wikipediaLocationsSchema.safeParse(many).success, true);
  const { accepted, rejected } = acceptExtraction(many, { prose, article });
  assert.equal(accepted.length, MAX_LOCATIONS_PER_ARTICLE);
  assert.equal(rejected.filter((r) => r.reason === "over_limit").length, 3);
});

test("the reply is still bounded in shape", () => {
  const absurd = { locations: Array.from({ length: 200 }, () => found()) };
  assert.equal(wikipediaLocationsSchema.safeParse(absurd).success, false);
});

test("the model is told the cap it is judged by", () => {
  assert.match(extractionInstructions(), new RegExp(`at most ${MAX_LOCATIONS_PER_ARTICLE} places`));
});

test("the article's prose is handed over as data, clearly fenced", () => {
  const input = buildExtractionInput({ title: "Skyfall", year: 2012, prose: PROSE });
  assert.match(input, /Skyfall \(2012\)/);
  assert.match(input, /as data:/);
  assert.ok(input.includes(PROSE));
});

// --- a real sentence about the wrong place ---------------------------------------------

test("a real sentence that never mentions the place is not evidence for it", () => {
  // Seen in the first live run: "Ascot Racecourse" arrived cited to "The Virgin Active
  // pool in London's Canary Wharf acted as Bond's...". The sentence is genuinely in the
  // article, so the verbatim check passed — it just says nothing about Ascot.
  const prose = "The Virgin Active pool in London's Canary Wharf acted as Bond's gym.";
  const { accepted, rejected } = acceptExtraction({ locations: [
    found({ place_name: "Ascot Racecourse", source_sentence: prose }),
  ] }, { prose, article });

  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, "quote_is_about_elsewhere");
});

test("a common word shared by two names does not count as a mention", () => {
  // "Square", "station" and "hospital" appear in half the names in a Production section.
  assert.equal(sentenceMentionsPlace("Filming moved to Parliament Square.", "Cadogan Square"), false);
  assert.equal(sentenceMentionsPlace("Filming moved to Cadogan Square.", "Cadogan Square"), true);
});

test("a name made only of common words is not judged by this rule", () => {
  // It cannot be checked this way, so it passes rather than being refused on a test
  // that cannot see it.
  assert.equal(sentenceMentionsPlace("Filming took place nearby that winter.", "The Common"), true);
});

test("one malformed item costs itself, not the whole extraction", () => {
  // Seen live: the French article yielded 27 places and a single empty source_sentence
  // at index 26 failed the schema, taking the other 26 with it. A schema is
  // all-or-nothing, so per-field limits belong in the accept pass.
  const parsed = wikipediaLocationsSchema.parse({ locations: [
    found(),
    { place_name: "Somewhere", area_hint: "", source_sentence: "", place_role: "filming" },
    { place_name: "X", area_hint: "", source_sentence: PROSE.split("\n")[1], place_role: "filming" },
  ] });

  const { accepted, rejected } = acceptExtraction(parsed, { prose: PROSE, article });
  assert.equal(accepted.length, 1);
  assert.deepEqual(rejected.map((r) => r.reason).sort(), ["no_name", "quote_wrong_length"]);
});


// --- a work is not only a film, and a place is not only where a camera stood ----------

test("a place where the author wrote is kept, as an author_place", () => {
  // The owner's rule, 12.09, and [[three-axes]] already called this the common shape of
  // the best material: the café Rowling wrote in is a real place a reader can walk to.
  const prose = "Rowling wrote much of the first book in Nicolson's Cafe on Nicolson Street.";
  const { accepted } = acceptExtraction({ locations: [
    found({
      place_name: "Nicolson's Cafe",
      area_hint: "Edinburgh",
      source_sentence: prose,
      place_role: "author",
    }),
  ] }, { prose, article });

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].relation_kind, "author_place");
  assert.equal(accepted[0].place_name, "Nicolson's Cafe");
});

test("a place a name was taken from is an author_place too", () => {
  const prose = "She took the name Thomas Riddell from a headstone in Greyfriars Kirkyard.";
  const { accepted } = acceptExtraction({ locations: [
    found({
      place_name: "Greyfriars Kirkyard",
      area_hint: "Edinburgh",
      source_sentence: prose,
      place_role: "inspiration",
    }),
  ] }, { prose, article });

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].relation_kind, "author_place");
});

test("a filming location still says so, and the two are told apart", () => {
  const { accepted } = acceptExtraction({ locations: [found({ place_role: "filming" })] }, { prose: PROSE, article });
  assert.equal(accepted[0].relation_kind, "filming_location");
});

test("a place inside the story is refused whatever role is claimed", () => {
  // The refusal that keeps the map walkable. Hogwarts is not a place.
  const prose = "Hogwarts is the school at the centre of the series.";
  for (const role of ["filming", "author", "inspiration", "setting", "other", "", null]) {
    const { accepted, rejected } = acceptExtraction({ locations: [
      found({ place_name: "Hogwarts", source_sentence: prose, place_role: role }),
    ] }, { prose, article });
    // Either the role is refused outright, or the quote gate refuses it: what matters is
    // that nothing claiming a fictional place reaches the queue as an accepted row.
    if (accepted.length) assert.fail(`role ${role} let a fictional place through`);
    assert.ok(rejected.length === 1, `role ${role} should drop exactly one`);
  }
});

test("an unknown role drops that item and nothing beside it", () => {
  // The lesson this file already records twice: one bad item must not cost the good ones.
  const { accepted, rejected } = acceptExtraction({ locations: [
    found({ place_role: "teleportation" }),
    found({ place_name: "Hankley Common", place_role: "filming" }),
  ] }, { prose: PROSE, article });

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].relation_kind, "filming_location");
  assert.equal(rejected[0].reason, "role_not_accepted");
});


// --- typography is not paraphrase ------------------------------------------------------

test("a straight apostrophe matches the page's curly one", () => {
  // Measured 12.09 on a live extraction: a true claim about the café Rowling wrote in was
  // discarded as quote_not_in_source because the model typed "Nicolson's" where the page
  // has "Nicolson’s". One character, and the place was lost. Wiki prose is full of them.
  const page = "Rowling wrote much of the first book in Nicolson’s Cafe — a room above a shop.";
  assert.equal(
    quoteAppearsInSource("Rowling wrote much of the first book in Nicolson's Cafe - a room above a shop.", page),
    true,
  );
});

test("but a different WORD still fails, which is the point of the gate", () => {
  const page = "Rowling wrote much of the first book in Nicolson’s Cafe.";
  assert.equal(quoteAppearsInSource("Rowling wrote all of the first book in Nicolson's Cafe.", page), false);
  assert.equal(quoteAppearsInSource("Rowling wrote much of the second book in Nicolson's Cafe.", page), false);
});

test("smart quotes and ellipses fold too", () => {
  const page = "The director called it “a cathedral of rust” … and left.";
  assert.equal(quoteAppearsInSource('The director called it "a cathedral of rust" ... and left.', page), true);
});


// --- a place considered is not a place used --------------------------------------------

test("a plan, a rumour and a scouting trip are not filming locations", () => {
  // Measured 12.09 on harrypotter/Half-Blood Prince, whose Filming section is largely about
  // locations never used. The model returned New Zealand and Ireland as filming locations;
  // nothing was shot in either. sentenceSupportsRole passed them, because each sentence
  // does contain the word "filming" — which is the limit of that gate and why this exists.
  for (const claim of [
    "This is North Scotland reported filming will take place in New Zealand.",
    "They are particularly keen on Ireland, as the landscape is similar to Britain.",
    "Some sources stated that filming may move from the UK.",
    "The crew scouted Venice but ultimately filmed in Malta.",
    "The producers are in talks to shoot in Iceland.",
  ]) {
    assert.equal(sentenceClaimsIntentNotFact(claim), true, claim);
    assert.equal(sentenceSupportsRole(claim, "filming_location"), false, claim);
  }
});

test("a sentence about what was actually done still passes", () => {
  for (const claim of [
    "On the weekend of 6 October 2007, the crew shot scenes involving the Hogwarts Express in Scotland.",
    "Filming took place at Hashima Island for the exterior of the villain lair.",
    "The production was based at Leavesden Studios.",
  ]) {
    assert.equal(sentenceSupportsRole(claim, "filming_location"), true, claim);
  }
  assert.equal(
    sentenceSupportsRole("Rowling wrote much of the first book in Nicolson's Cafe.", "author_place"),
    true,
  );
});

test("the drop reason says which gate refused it", () => {
  // "does not support the role" and "is a plan" send a reader looking in different places.
  const prose = "Some sources stated that filming may move from the UK to New Zealand.";
  const { accepted, rejected } = acceptExtraction({ locations: [
    found({ place_name: "New Zealand", source_sentence: prose, place_role: "filming" }),
  ] }, { prose, article });
  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, "quote_is_a_plan_not_a_fact");
});


test("making a work is described with an ordinary vocabulary, not eight verbs", () => {
  // Joyce's Bognor was a real author place found correctly by the model and thrown away by
  // this gate: the list held "sketched" and not "sketches", and no "completed" at all.
  // Third time the list was one word short of a true claim.
  assert.equal(sentenceSupportsRole(
    "Joyce completed another four short sketches in July and August 1923, while holidaying in Bognor.",
    "author_place",
  ), true);
  assert.equal(sentenceSupportsRole("He worked on the manuscript in a rented room in Wiesbaden.", "author_place"), true);
  assert.equal(sentenceSupportsRole("She revised the final chapters in Edinburgh.", "author_place"), true);
  // And it still refuses a sentence about the work rather than about its making.
  assert.equal(sentenceSupportsRole("Dostoevsky owed large sums of money to creditors.", "author_place"), false);
  assert.equal(sentenceSupportsRole("The novel is set in Saint Petersburg.", "author_place"), false);
  assert.equal(sentenceSupportsRole("Hogwarts is the school at the centre of the series.", "author_place"), false);
});


test("a person is not a place, however much the gazetteer would like to help", () => {
  // Measured on the 574 rows of the first real run: the model returned "John Hughes" as a
  // place, and it geocoded to Antigua and Barbuda, where a settlement of that name exists.
  // The tell is the grammar, not the name: a place is written about, a person acts.
  assert.equal(namesAnAgentNotAPlace(
    "John Hughes", "John Hughes conceived the film before he sold it to the Farrelly brothers.",
  ), true);
  assert.equal(namesAnAgentNotAPlace(
    "Quentin Tarantino", "Quentin Tarantino wrote the script while living in New York City.",
  ), true);
  // And the places that open their own sentences must survive — this is the common shape.
  assert.equal(namesAnAgentNotAPlace(
    "Pinewood Studios", "Pinewood Studios housed the production for six months.",
  ), false);
  assert.equal(namesAnAgentNotAPlace(
    "Reform Club", "the palatial 19th-century interior of the Reform Club stood in for the Club.",
  ), false);
  assert.equal(namesAnAgentNotAPlace(
    "Wildwood Regional Park", "The Rifleman was partially filmed in Wildwood Regional Park.",
  ), false);
});

test("a person reaching the accept pass is dropped by name", () => {
  const prose = "John Hughes conceived the film before he sold it to the Farrelly brothers.";
  const { accepted, rejected } = acceptExtraction({ locations: [
    found({ place_name: "John Hughes", source_sentence: prose, place_role: "author" }),
  ] }, { prose, article });
  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, "names_a_person");
});

test("Hebrew: a sentence saying the film was shot somewhere supports the role", () => {
  assert.equal(sentenceSupportsRole("הסרט צולם בעכו ובחיפה.", "filming_location"), true);
  assert.equal(sentenceSupportsRole("הצילומים התקיימו בירושלים במשך שישה שבועות.", "filming_location"), true);
  // A plan is not a place that was used.
  assert.equal(sentenceSupportsRole("הסרט יצולם בתל אביב בשנה הבאה.", "filming_location"), false);
  // A place inside the story says nothing about the shoot.
  assert.equal(sentenceSupportsRole("העלילה מתרחשת בירושלים.", "filming_location"), false);
  assert.equal(sentenceSupportsRole("הספר נכתב בחיפה.", "author_place"), true);
});
