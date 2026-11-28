import assert from "node:assert/strict";
import test from "node:test";

import { checkTour, guideSourceNote, scriptedStopLine, unsupportedClaims } from "../app/lib/narration-check.mjs";
import { createTourHandler } from "../app/api/tour/route.js";

const BOOKSHOP = { id: "a", place: "Notting Hill Bookshop", scene: "The bookshop", description: "Where Will works.", film: "Notting Hill" };
const MARKET = { id: "b", place: "Portobello Road Market", scene: "The market walk", description: "The street market, opened 1864.", film: "Notting Hill" };
const ctx = { city: "London", film: { title: "Notting Hill", year: 1999 } };

test("a sentence built from the facts passes", () => {
  assert.deepEqual(unsupportedClaims("Start at the bookshop where Will works in Notting Hill.", [BOOKSHOP.place, BOOKSHOP.description]), []);
  assert.deepEqual(unsupportedClaims("The market dates from 1864.", [MARKET.description]), []);
});

test("a year, a figure or a name nobody supplied is caught", () => {
  assert.deepEqual(unsupportedClaims("Filmed here in 1998.", [BOOKSHOP.description]), ["1998"]);
  assert.deepEqual(unsupportedClaims("Over 2,000 fans visit.", [BOOKSHOP.description]), ["2000"]);
  assert.deepEqual(unsupportedClaims("Here Hugh Grant met Julia Roberts.", [BOOKSHOP.description]), ["Hugh", "Grant", "Julia", "Roberts"]);
});

test("a possessive is the name it belongs to", () => {
  assert.deepEqual(unsupportedClaims("Here is Will’s shop, and Will's door.", [BOOKSHOP.description]), []);
});

test("a sentence's first word and 'I' are not names", () => {
  assert.deepEqual(unsupportedClaims("Walk on. Then turn left, and I will wait.", ["walk"]), []);
});

test("names are only checked in English; numbers in every language", () => {
  assert.deepEqual(unsupportedClaims("Ici travaille Guillaume.", [BOOKSHOP.description], { language: "fr" }), []);
  assert.deepEqual(unsupportedClaims("Tourné en 1998.", [BOOKSHOP.description], { language: "fr" }), ["1998"]);
});

test("a stop that adds a claim is replaced by our own line, the rest stay", () => {
  const tour = {
    title: "Notting Hill in 90 Minutes",
    intro: "Two stops in London from Notting Hill.",
    stops: [
      { locationId: "a", narration: "Start at the bookshop where Will works." },
      { locationId: "b", narration: "Hugh Grant shot this scene in 1998." },
    ],
  };
  const checked = checkTour(tour, [BOOKSHOP, MARKET], ctx);
  assert.equal(checked.stops[0].factCheck, "ok");
  assert.equal(checked.stops[0].narration, tour.stops[0].narration);
  assert.equal(checked.stops[1].factCheck, "replaced");
  assert.equal(checked.stops[1].narration, "Portobello Road Market: The market walk.");
  assert.deepEqual(checked.stops[1].unsupported, ["1998", "Grant"]);
  assert.equal(checked.intro, tour.intro);
  assert.equal(checked.title, "Notting Hill on foot");
  assert.deepEqual(checked.factCheck, { stops: 2, replaced: 1, introReplaced: false, titleReplaced: true });
});

test("the length that was asked for is a fact", () => {
  const checked = checkTour({ title: "Notting Hill in 60 Minutes", intro: "A 60-minute walk.", stops: [] }, [BOOKSHOP], { ...ctx, durationMinutes: 60 });
  assert.equal(checked.title, "Notting Hill in 60 Minutes");
  assert.equal(checked.factCheck.introReplaced, false);
});

test("a Title Case title is not a list of names", () => {
  const checked = checkTour({ title: "Walking Through Notting Hill", intro: "Two stops.", stops: [] }, [BOOKSHOP], ctx);
  assert.equal(checked.title, "Walking Through Notting Hill");
});

test("the scripted line never repeats the place as its scene", () => {
  assert.equal(scriptedStopLine({ place: "Kenwood House", scene: "Kenwood House" }), "Kenwood House.");
  assert.equal(scriptedStopLine({ place: "", scene: "", description: "A park." }), "A park.");
});

test("the guide says where its words come from", () => {
  const location = { sourceUrl: "https://www.wikidata.org/wiki/Q1", sourceTitle: "Wikidata" };
  assert.match(guideSourceNote({ location }).note, /our record/);
  assert.equal(guideSourceNote({ location }).link.url, "https://www.wikidata.org/wiki/Q1");
  assert.match(guideSourceNote({ location, spokenIsStory: true, factCheck: "ok" }).note, /checked/);
  assert.match(guideSourceNote({ location, spokenIsStory: true, factCheck: "replaced" }).note, /don't say/);
  assert.match(guideSourceNote({ location, spokenIsStory: true, factCheck: "scripted" }).note, /^Read from our record/);
  assert.equal(guideSourceNote({ location: { sourceUrl: "javascript:alert(1)" } }).link, null);
});

test("the tour route returns the checked tour", async () => {
  const reply = {
    title: "A Notting Hill morning",
    intro: "Two stops through the film's London.",
    stops: [
      { locationId: "a", narration: "Start at the bookshop where Will works." },
      { locationId: "b", narration: "Opened by Queen Victoria in 1870." },
    ],
  };
  const handler = createTourHandler({
    env: { OPENROUTER_API_KEY: "free" },
    createRuntime: () => ({
      provider: "openrouter", tier: "cheap", model: "free-model", extraBody: {},
      client: { chat: { completions: { create: async () => ({
        model: "free-model",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(reply) } }],
      }) } } },
    }),
  });
  const response = await handler(new Request("http://localhost/api/tour", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ city: "London", locations: [BOOKSHOP, MARKET] }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.stops[1].factCheck, "replaced");
  assert.equal(body.factCheck.replaced, 1);
});
