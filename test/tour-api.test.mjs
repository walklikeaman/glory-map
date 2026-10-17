import assert from "node:assert/strict";
import test from "node:test";

import { createTourHandler } from "../app/api/tour/route.js";

const LOCATIONS = [
  { id: "a", place: "Notting Hill Bookshop", scene: "The bookshop", description: "Where Will works.", film: "Notting Hill" },
  { id: "b", place: "Portobello Road Market", scene: "The market walk", description: "The street market.", film: "Notting Hill" },
];

const tourRequest = (body) => new Request("http://localhost/api/tour", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const validTour = {
  title: "A Notting Hill morning",
  intro: "Two stops through the film's London.",
  stops: [
    { locationId: "a", narration: "Start at the bookshop where Will works." },
    { locationId: "b", narration: "Walk on to the market that opens the film." },
  ],
};

function handlerWith(overrides = {}) {
  const calls = {};
  const handler = createTourHandler({
    env: overrides.env ?? { OPENROUTER_API_KEY: "free" },
    createRuntime: () => ("runtime" in overrides ? overrides.runtime : {
      provider: "openrouter", tier: "cheap", model: "free-model", extraBody: {},
      client: { chat: { completions: { create: async (body) => {
        calls.body = body;
        return overrides.reply ?? {
          model: "free-model",
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(overrides.tour ?? validTour) } }],
        };
      } } } },
    }),
  });
  return { handler, calls };
}

// --- the shape that actually reaches the provider ---------------------------------------

test("a tour comes back with every supplied stop and the model that wrote it", async () => {
  // This route had no test at all, and migrating it left `response.model` behind as a
  // dangling reference. `node --check` cannot see a runtime lookup, so it reached a
  // live request instead of a test run.
  const { handler } = handlerWith();
  const response = await handler(tourRequest({ city: "London", durationMinutes: 60, locations: LOCATIONS }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.stops.length, 2);
  assert.equal(body.model, "free-model");
});

test("the request goes out as a schema-constrained chat completion", async () => {
  const { handler, calls } = handlerWith();
  await handler(tourRequest({ city: "London", durationMinutes: 60, locations: LOCATIONS }));

  assert.equal(calls.body.response_format.type, "json_schema");
  assert.equal(calls.body.model, "free-model");
  // The locations are handed over as data, and the rules as the system message.
  assert.match(calls.body.messages[0].content, /never quote dialogue/i);
  assert.match(calls.body.messages[1].content, /Portobello Road Market/);
});

test("a tour can be written in another language, and an unknown one is English (#67)", async () => {
  const { handler, calls } = handlerWith();
  const french = await (await handler(tourRequest({ city: "Paris", language: "fr-FR", locations: LOCATIONS }))).json();
  assert.equal(french.language, "fr");
  assert.match(calls.body.messages[0].content, /in French\. Keep place names/);

  const unknown = await (await handler(tourRequest({ city: "Paris", language: "klingon", locations: LOCATIONS }))).json();
  assert.equal(unknown.language, "en");
  assert.match(calls.body.messages[0].content, /in English\./);
});

// --- refusing, and saying why -------------------------------------------------------------

test("no model key configured is a 503 that names the capability, not a vendor", async () => {
  const { handler } = handlerWith({ runtime: null });
  const response = await handler(tourRequest({ city: "London", durationMinutes: 60, locations: LOCATIONS }));

  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/i);
});

test("a bad request is refused before any model call", async () => {
  const { handler, calls } = handlerWith();
  const response = await handler(tourRequest({ city: "London" }));

  assert.equal(response.status, 400);
  assert.equal(calls.body, undefined);
});

test("a refusal carries its reason, because retrying costs a slot of the daily quota", async () => {
  // On a free endpoint "the model refused" and "it ran out of tokens" call for
  // different responses, and a bare 422 cannot tell them apart.
  const { handler } = handlerWith({
    reply: { choices: [{ finish_reason: "length", message: { content: "{" } }] },
  });
  const response = await handler(tourRequest({ city: "London", durationMinutes: 60, locations: LOCATIONS }));
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.reason, "truncated");
});

test("a tour that drops a location fails loudly rather than shipping a short walk", async () => {
  // assertCompleteTour throws, the catch returns 502, and the UI falls back to the
  // scripted guide. A weak model omitting a stop must not look like a deliberate one.
  // The array is length-constrained, so a short tour is refused by the schema; a tour
  // of the right length that repeats a stop gets past it and is caught by
  // assertCompleteTour. Both must fail, and neither may ship a partial walk.
  const { handler } = handlerWith({
    tour: { ...validTour, stops: [validTour.stops[0], validTour.stops[0]] },
  });
  const response = await handler(tourRequest({ city: "London", durationMinutes: 60, locations: LOCATIONS }));

  assert.equal(response.status, 502);
});

test("an id the model invented does not reach the client", async () => {
  const { handler } = handlerWith({
    tour: { ...validTour, stops: [validTour.stops[0], { locationId: "invented", narration: "Nowhere." }] },
  });
  const response = await handler(tourRequest({ city: "London", durationMinutes: 60, locations: LOCATIONS }));

  assert.ok(response.status >= 400, "an unknown id must not be returned as a stop");
});
