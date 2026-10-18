import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  chooseProvider,
  createModelClient,
  createThrottle,
  DEFAULT_FREE_MODEL,
  OPENROUTER_BASE_URL,
  parseStructured,
  TIERS,
  unwrapJson,
  dailyQuotaSpent,
} from "../app/lib/model-client.mjs";

// A stand-in for the OpenAI SDK that records how it was constructed.
function fakeSdk(reply) {
  const built = [];
  class Fake {
    constructor(options) {
      built.push(options);
      this.chat = { completions: { create: async (body, opts) => {
        built.at(-1).lastCall = { body, opts };
        if (reply instanceof Error) throw reply;
        return reply;
      } } };
    }
  }
  return { OpenAIImpl: Fake, built };
}

const schema = z.object({ places: z.array(z.string()) });
const call = (runtime) => parseStructured({
  runtime, schema, schemaName: "places", instructions: "list them", input: "some prose",
});

// --- which provider, and how it is addressed ----------------------------------------

test("OpenRouter wins when its key is present", () => {
  assert.equal(chooseProvider({ OPENROUTER_API_KEY: "k", OPENAI_API_KEY: "j" }), "openrouter");
  assert.equal(chooseProvider({ OPENAI_API_KEY: "j" }), "openai");
  assert.equal(chooseProvider({}), null);
});

test("no key configured is a null runtime, not a thrown SDK error", () => {
  // So the caller can name the missing variable instead of reporting "401".
  assert.equal(createModelClient({}), null);
});

test("the OpenRouter client is pointed at OpenRouter and identifies the app", () => {
  const { OpenAIImpl, built } = fakeSdk({});
  const runtime = createModelClient({ OPENROUTER_API_KEY: "k" }, { OpenAIImpl });

  assert.equal(runtime.provider, "openrouter");
  assert.equal(built[0].baseURL, OPENROUTER_BASE_URL);
  assert.equal(built[0].defaultHeaders["X-Title"], "GloryMap");
  assert.equal(runtime.model, DEFAULT_FREE_MODEL);
});

test("an endpoint that cannot honour the schema is refused, not silently accepted", () => {
  // Structured-output support is per-endpoint, not per-model: one provider serving a
  // model advertises it and another does not. Without this the schema is dropped for
  // some requests and not others.
  const { OpenAIImpl } = fakeSdk({});
  const runtime = createModelClient({ OPENROUTER_API_KEY: "k" }, { OpenAIImpl });
  assert.equal(runtime.extraBody.provider.require_parameters, true);
});

test("the OpenAI client keeps its own base URL and takes no provider hint", () => {
  const { OpenAIImpl, built } = fakeSdk({});
  const runtime = createModelClient({ OPENAI_API_KEY: "j", OPENAI_MODEL: "gpt-5-nano" }, { OpenAIImpl });

  assert.equal(runtime.provider, "openai");
  assert.equal(built[0].baseURL, undefined);
  assert.equal(runtime.extraBody.provider, undefined);
});

test("a cheap gpt-5 call reasons briefly, so the reasoning cannot eat the answer", () => {
  // Measured live: gpt-5-nano at the default effort spent all 3,000 tokens of a tour
  // request on reasoning and every tour came back "truncated".
  const { OpenAIImpl } = fakeSdk({});
  const cheap = createModelClient({ OPENAI_API_KEY: "j", OPENAI_MODEL: "gpt-5-nano" }, { OpenAIImpl });
  assert.deepEqual(cheap.extraBody, { reasoning_effort: "low" });

  const careful = createModelClient(
    { OPENAI_API_KEY: "j", OPENAI_MODEL: "gpt-5-mini" }, { OpenAIImpl, tier: TIERS.CAREFUL });
  assert.deepEqual(careful.extraBody, {}, "a careful task keeps the model's own effort");

  const older = createModelClient({ OPENAI_API_KEY: "j", OPENAI_MODEL: "gpt-4o-mini" }, { OpenAIImpl });
  assert.deepEqual(older.extraBody, {}, "a model without reasoning is not sent the parameter");
});

// --- the call shape ------------------------------------------------------------------

test("the request goes to chat/completions with a json_schema response_format", async () => {
  // Measured live: OpenRouter's /responses endpoint returns HTTP 200 and status
  // "completed" while ignoring text.format entirely. chat/completions honours the
  // schema, and BOTH providers accept this shape — so there is one code path.
  const { OpenAIImpl, built } = fakeSdk({
    choices: [{ finish_reason: "stop", message: { content: '{"places":["Malta"]}' } }],
    model: "m",
  });
  const runtime = createModelClient({ OPENROUTER_API_KEY: "k" }, { OpenAIImpl });
  await call(runtime);

  const { body } = built[0].lastCall;
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.name, "places");
  assert.equal(body.provider.require_parameters, true);
  assert.equal(body.messages[0].role, "system");
});

// gpt-5 models answer `max_tokens` with a 400 before generating anything, so every
// careful-tier call on OpenAI failed. OpenRouter takes the old name.
test("each provider is given the token limit by the name it accepts", async () => {
  const openai = fakeSdk({ choices: [{ finish_reason: "stop", message: { content: '{"places":[]}' } }] });
  await call(createModelClient({ OPENAI_API_KEY: "k" }, { tier: "careful", OpenAIImpl: openai.OpenAIImpl }));
  const sentToOpenAI = openai.built[0].lastCall.body;
  assert.equal(sentToOpenAI.max_completion_tokens, 4000);
  assert.equal("max_tokens" in sentToOpenAI, false);

  const router = fakeSdk({ choices: [{ finish_reason: "stop", message: { content: '{"places":[]}' } }] });
  await call(createModelClient({ OPENROUTER_API_KEY: "k" }, { OpenAIImpl: router.OpenAIImpl }));
  const sentToRouter = router.built[0].lastCall.body;
  assert.equal(sentToRouter.max_tokens, 4000);
  assert.equal("max_completion_tokens" in sentToRouter, false);
});

// --- bad answers are outcomes, not crashes -------------------------------------------

test("a good answer comes back with what served it", async () => {
  const { OpenAIImpl } = fakeSdk({
    choices: [{ finish_reason: "stop", message: { content: '{"places":["Malta"]}' } }],
    model: "gemma", provider: "Darkbloom",
  });
  const result = await call(createModelClient({ OPENROUTER_API_KEY: "k" }, { OpenAIImpl }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.parsed.places, ["Malta"]);
  assert.equal(result.servedBy, "Darkbloom");
});

test("a truncated answer is not a partial success", async () => {
  // It parses as far as it got. Accepting it stores half a result and calls it whole.
  const { OpenAIImpl } = fakeSdk({
    choices: [{ finish_reason: "length", message: { content: '{"places":["Mal"' } }],
  });
  const result = await call(createModelClient({ OPENROUTER_API_KEY: "k" }, { OpenAIImpl }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, "truncated");
});

test("prose instead of JSON is a bad answer, not a broken pipeline", async () => {
  const { OpenAIImpl } = fakeSdk({
    choices: [{ finish_reason: "stop", message: { content: "Sure! The places are Malta and Venice." } }],
  });
  const result = await call(createModelClient({ OPENROUTER_API_KEY: "k" }, { OpenAIImpl }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_json");
  assert.match(result.detail, /Sure/);
});

// --- packaging is not content ---------------------------------------------------------

test("a fenced answer is unwrapped, because the fence is decoration", async () => {
  // Measured live: gemma answered a short passage unwrapped and a 17k-character
  // article inside a ```json fence. Throwing away a correct answer over markdown
  // wastes the call and a slot of the daily quota.
  const { OpenAIImpl } = fakeSdk({
    choices: [{ finish_reason: "stop", message: { content: '```json\n{"places":["Malta"]}\n```' } }],
  });
  const result = await call(createModelClient({ OPENROUTER_API_KEY: "k" }, { OpenAIImpl }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.parsed.places, ["Malta"]);
  assert.equal(result.fenced, true);
});

test("unwrapping removes wrapping and never content", () => {
  assert.equal(unwrapJson('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(unwrapJson('```\n{"a":1}\n```'), '{"a":1}');
  assert.equal(unwrapJson('  {"a":1}  '), '{"a":1}');
  // A fence inside the JSON is content and must survive.
  assert.equal(unwrapJson('{"a":"```"}'), '{"a":"```"}');
  assert.equal(unwrapJson(null), "");
});

test("valid JSON of the wrong shape still fails the schema", async () => {
  // Unwrapping must not become leniency about what the answer says.
  const { OpenAIImpl } = fakeSdk({
    choices: [{ finish_reason: "stop", message: { content: '{"places":[{"nope":1}]}' } }],
  });
  const result = await call(createModelClient({ OPENROUTER_API_KEY: "k" }, { OpenAIImpl }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, "schema_mismatch");
});

test("a rate limit is named as one, because the response to it is different", async () => {
  const { OpenAIImpl } = fakeSdk(Object.assign(new Error("too many"), { status: 429 }));
  const result = await call(createModelClient({ OPENROUTER_API_KEY: "k" }, { OpenAIImpl }));

  assert.equal(result.reason, "rate_limited");
  assert.equal(result.status, 429);
});

test("a refusal is reported with what the model said", async () => {
  const { OpenAIImpl } = fakeSdk({ choices: [{ message: { refusal: "I cannot help with that" } }] });
  const result = await call(createModelClient({ OPENROUTER_API_KEY: "k" }, { OpenAIImpl }));

  assert.equal(result.reason, "refused");
  assert.match(result.detail, /cannot help/);
});

test("no runtime is a clean refusal rather than a null dereference", async () => {
  assert.equal((await call(null)).reason, "no_client");
});

// --- pacing ---------------------------------------------------------------------------

test("requests are spaced, and the first one does not wait", async () => {
  // Free endpoints are rate-limited per account. Pacing belongs here, not in a retry
  // loop that only learns the limit by breaching it.
  const waits = [];
  let clock = 0;
  const throttle = createThrottle(12, {
    now: () => clock,
    sleep: async (ms) => { waits.push(ms); clock += ms; },
  });

  await throttle();
  assert.deepEqual(waits, []);
  await throttle();
  assert.deepEqual(waits, [5000]);
});

test("a slow call absorbs its own gap", async () => {
  // If the model took longer than the interval, waiting again wastes the difference.
  const waits = [];
  let clock = 0;
  const throttle = createThrottle(12, {
    now: () => clock,
    sleep: async (ms) => { waits.push(ms); clock += ms; },
  });

  await throttle();
  clock += 30_000; // the model thought for half a minute
  await throttle();
  assert.deepEqual(waits, []);
});

test("JSON cut off mid-string is truncation, not prose", async () => {
  // Both fail JSON.parse and they need opposite responses — one is a small budget, the
  // other is a weak model. A log showing the first 160 characters cannot tell them
  // apart, because valid JSON also starts with "{".
  const { OpenAIImpl } = fakeSdk({
    choices: [{ finish_reason: "stop", message: { content: '{"places":["Malta","Ista' } }],
  });
  const result = await call(createModelClient({ OPENROUTER_API_KEY: "k" }, { OpenAIImpl }));

  assert.equal(result.reason, "truncated");
  assert.match(result.detail, /ends:/);
});

test("the provider's own stop reason counts when the standard one is absent", async () => {
  const { OpenAIImpl } = fakeSdk({
    choices: [{ native_finish_reason: "max_tokens", message: { content: '{"places":[]}' } }],
  });
  const result = await call(createModelClient({ OPENROUTER_API_KEY: "k" }, { OpenAIImpl }));

  assert.equal(result.reason, "truncated");
});

// --- the tier is a property of the task, not of the environment ------------------------

test("a careful task prefers the paid provider even when a free key is present", () => {
  // Getting this backwards is not a cost problem, it is a data problem: a frame match
  // writes a location claim, and a negative still verdict is cached permanently with
  // no invalidation path.
  const env = { OPENROUTER_API_KEY: "free", OPENAI_API_KEY: "paid" };
  assert.equal(chooseProvider(env, TIERS.CAREFUL), "openai");
  assert.equal(chooseProvider(env, TIERS.CHEAP), "openrouter");
});

test("a cheap task takes the free provider when there is one", () => {
  assert.equal(chooseProvider({ OPENROUTER_API_KEY: "free" }, TIERS.CHEAP), "openrouter");
  assert.equal(chooseProvider({ OPENAI_API_KEY: "paid" }, TIERS.CHEAP), "openai");
  assert.equal(chooseProvider({}, TIERS.CHEAP), null);
});

test("a careful task with no paid key still runs, and says it was downgraded", () => {
  // Silently running a careful task on a free endpoint is the failure this flag makes
  // visible; refusing outright would break a deployment that simply has no paid key.
  const { OpenAIImpl } = fakeSdk({});
  const runtime = createModelClient({ OPENROUTER_API_KEY: "free" },
    { tier: TIERS.CAREFUL, OpenAIImpl });

  assert.equal(runtime.provider, "openrouter");
  assert.equal(runtime.downgraded, true);
});

test("a task that got the tier it asked for is not marked downgraded", () => {
  const { OpenAIImpl } = fakeSdk({});
  assert.equal(createModelClient({ OPENAI_API_KEY: "paid" },
    { tier: TIERS.CAREFUL, OpenAIImpl }).downgraded, false);
  assert.equal(createModelClient({ OPENROUTER_API_KEY: "free" },
    { tier: TIERS.CHEAP, OpenAIImpl }).downgraded, false);
});

// ---------- a refusal that lasts until tomorrow ----------

test("the daily allowance, spent, is told apart from a busy endpoint", () => {
  // Both verbatim from the live run's log, 22.09.
  assert.equal(dailyQuotaSpent({
    ok: false, reason: "rate_limited", status: 429,
    detail: "429 Rate limit exceeded: free-models-per-day-high-balance. ",
  }), true);
  assert.equal(dailyQuotaSpent({
    ok: false, reason: "rate_limited", status: 429, detail: "429 Provider returned error",
  }), false, "a free endpoint busy for a moment: the next work may get through");
});

test("nothing but a refusal can spend the quota", () => {
  assert.equal(dailyQuotaSpent({ ok: true }), false);
  assert.equal(dailyQuotaSpent({ ok: false, reason: "refused", detail: "daily" }), false);
  assert.equal(dailyQuotaSpent({ ok: false, reason: "request_failed", status: 500, detail: "per-day" }), false);
  assert.equal(dailyQuotaSpent(null), false);
});
