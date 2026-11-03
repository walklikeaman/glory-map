// One place that decides which model provider a call goes to, and in what shape.
//
// The shape is not a detail. Measured against OpenRouter live:
//
//   POST /api/v1/responses with text.format  → HTTP 200, status "completed",
//                                              and the schema SILENTLY IGNORED.
//                                              The body came back as the model's
//                                              reasoning prose.
//   POST /api/v1/chat/completions
//        with response_format json_schema    → schema honoured, valid JSON.
//
// A structured-output request that returns 200 and unstructured text is the worst
// failure available: nothing throws, and the caller sees a parse error far from the
// cause. So everything goes through chat/completions, which BOTH providers honour —
// one code path rather than a provider abstraction.
//
// Support is per-ENDPOINT, not per-model. One provider serving a model advertises
// structured outputs and another does not, which is how a schema failure reproduces
// 40% of the time and never in dev. `require_parameters` refuses an endpoint that
// cannot do what we asked, rather than quietly downgrading.

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Verified live on the real extraction schema. Of the free models advertising
// structured outputs, this was the only one that returned valid JSON with every quote
// copied verbatim — gpt-oss-20b wrapped its answer in a ```json fence and
// nemotron-3-super returned a shape the SDK could not read at all.
// **Re-measured 12.09, because the old default stopped working.** OpenRouter answered
// `404 No endpoints found that can handle the requested parameters` for
// `google/gemma-4-26b-a4b-it:free`: it still advertises `response_format` but no longer
// `structured_outputs`, and the schema request needs the latter. The catalogue moved
// under us — a model id in a config file is a claim about somebody else's inventory.
//
// Of the five free models now advertising structured outputs, three survived the REAL
// extraction schema and one of them read the passage best:
//
//   liquid/lfm-2.5-2.6b:free              4 of 4 places, filming and author told apart
//   nvidia/nemotron-3-super-120b-a12b     2 of 4 — missed both author places
//   dots-studio/dots-3-note-preview       2 of 4 — missed both author places
//   nex-agi/nex-n2.5-pro:free             truncated
//
// A 2.6B model beating a 120B one is not what anybody would guess, which is the whole
// argument for testing against the real schema rather than a toy one.
export const DEFAULT_FREE_MODEL = "liquid/lfm-2.5-2.6b:free";
export const DEFAULT_OPENAI_MODEL = "gpt-5-nano";

// OpenRouter attributes traffic by these and shows the app on its site. Neither is a
// secret; both are ordinary courtesy.
const APP_HEADERS = {
  "HTTP-Referer": "https://codex-hackathon-starter.vercel.app",
  "X-Title": "GloryMap",
};

// Which tier a call belongs to. This is a property of the TASK, not of which key
// happens to be in the environment, so it is named at the call site.
//
//   cheap   — the answer is checked by code afterwards, or a bad one is visibly bad
//             and costs only a retry. Narration, ordering, extraction behind a
//             verbatim-quote gate.
//   careful — a wrong answer is stored as fact and is expensive or impossible to
//             undo. Frame matching writes a location claim; a negative still verdict
//             is cached permanently with no invalidation path, so a weak model's
//             mistake hides a real frame for good.
//
// Getting this backwards is not a cost problem, it is a data problem, which is why
// the choice does not live in an env var.
export const TIERS = Object.freeze({ CHEAP: "cheap", CAREFUL: "careful" });

export function chooseProvider(env = process.env, tier = TIERS.CHEAP) {
  if (tier === TIERS.CAREFUL) {
    // Fall back to OpenRouter rather than refusing outright — a paid key may simply
    // not be configured yet, and the caller can see `tier` did not get what it asked.
    if (env?.OPENAI_API_KEY) return "openai";
    return env?.OPENROUTER_API_KEY ? "openrouter" : null;
  }
  if (env?.OPENROUTER_API_KEY) return "openrouter";
  if (env?.OPENAI_API_KEY) return "openai";
  return null;
}

// Build the client and everything that travels with it. Returns null when no key is
// configured, so a caller can say which key is missing rather than throwing an SDK
// error about an empty string.
export function createModelClient(env = process.env, { tier = TIERS.CHEAP, OpenAIImpl = OpenAI } = {}) {
  const provider = chooseProvider(env, tier);
  if (!provider) return null;

  if (provider === "openrouter") {
    return {
      provider,
      tier,
      // A careful task routed to OpenRouter did not get what it asked for. It still
      // runs — but on the strongest model available, not the default free one.
      downgraded: tier === TIERS.CAREFUL,
      model: tier === TIERS.CAREFUL
        ? (env.OPENROUTER_CAREFUL_MODEL || env.OPENROUTER_MODEL || DEFAULT_FREE_MODEL)
        : (env.OPENROUTER_MODEL || env.MODEL || DEFAULT_FREE_MODEL),
      client: new OpenAIImpl({
        apiKey: env.OPENROUTER_API_KEY,
        baseURL: OPENROUTER_BASE_URL,
        defaultHeaders: APP_HEADERS,
      }),
      // Refuse an endpoint that cannot honour the schema instead of being routed to
      // one that ignores it.
      extraBody: { provider: { require_parameters: true } },
    };
  }

  const model = env.OPENAI_MODEL || env.MODEL || DEFAULT_OPENAI_MODEL;
  return {
    provider,
    tier,
    downgraded: false,
    model,
    client: new OpenAIImpl({ apiKey: env.OPENAI_API_KEY }),
    extraBody: cheapReasoning(model, tier),
  };
}

// The gpt-5 family reasons before it answers, and the reasoning is billed against the
// same `max_completion_tokens` as the answer. Measured live 18.10 on /api/tour with
// gpt-5-nano at the default effort: three Rome stops, 3,000 of 3,000 tokens spent on
// reasoning, finish_reason "length", and the tour came back 422 "truncated" every time.
// At "low" the same request used 320 reasoning tokens of 470 and kept to the supplied
// facts; at "minimal" it started attributing Trevi to the wrong film. A cheap task is
// checked afterwards, so it does not need the long think — a careful one keeps it.
function cheapReasoning(model, tier) {
  return tier === TIERS.CHEAP && /^gpt-5/.test(model) ? { reasoning_effort: "low" } : {};
}

// Free endpoints honour the schema's SHAPE but not always its packaging: measured
// live, gemma returned correct JSON wrapped in a ```json fence on a 17k-character
// article while answering a short passage unwrapped. Discarding a right answer over
// markdown decoration wastes the call and the quota.
//
// Stripping the fence is safe in a way that "be lenient with model output" usually is
// not, because nothing here decides what the answer MEANS — the content still has to
// pass the Zod schema unchanged. We remove wrapping, never content.
export function unwrapJson(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

// A structured call, in the one shape both providers honour.
//
// Returns a result object rather than throwing on a model-side failure: a refusal, a
// truncation and a schema miss are ordinary outcomes of asking a weak model, and a
// batch job must record them and continue rather than dying on the first one.
export async function parseStructured({
  runtime, schema, schemaName, instructions, input, maxTokens = 4000, timeout = 120_000,
}) {
  if (!runtime) return { ok: false, reason: "no_client" };

  let completion;
  try {
    // `create`, not `parse`: the SDK's parse helper rejects the whole response when the
    // body is fenced, and we would rather normalise the wrapper and still validate.
    completion = await runtime.client.chat.completions.create({
      model: runtime.model,
      // OpenAI's gpt-5 family refuses `max_tokens` outright ("Unsupported parameter …
      // use 'max_completion_tokens'"), so every careful-tier call on OpenAI failed with a
      // 400 before a single token was generated. OpenRouter takes `max_tokens`.
      ...(runtime.provider === "openai"
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens }),
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input },
      ],
      response_format: zodResponseFormat(schema, schemaName),
      ...runtime.extraBody,
    }, { timeout });
  } catch (failure) {
    return {
      ok: false,
      reason: failure?.status === 429 ? "rate_limited" : "request_failed",
      status: failure?.status ?? null,
      detail: String(failure?.message ?? "").slice(0, 300),
    };
  }

  const choice = completion?.choices?.[0];
  if (choice?.message?.refusal) {
    return { ok: false, reason: "refused", detail: choice.message.refusal };
  }
  // A truncated answer parses as far as it got; treating it as complete stores half a
  // result and calls it whole. `native_finish_reason` is OpenRouter's passthrough of
  // what the upstream provider said, and the two do not always agree.
  const finish = choice?.finish_reason ?? choice?.native_finish_reason;
  if (finish === "length" || finish === "max_tokens") {
    return { ok: false, reason: "truncated" };
  }

  const body = unwrapJson(choice?.message?.content);
  if (!body) return { ok: false, reason: "empty" };

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    // Distinguish "the model wrote prose" from "the model wrote JSON and was cut off".
    // They look identical to JSON.parse and need opposite responses — one is a bad
    // model, the other is a small budget — and a log showing only the first 160
    // characters cannot tell them apart, because valid JSON also starts with "{".
    const startsAsJson = /^[[{]/.test(body);
    return {
      ok: false,
      reason: startsAsJson ? "truncated" : "not_json",
      finish: finish ?? null,
      detail: startsAsJson
        ? `${body.length} chars, ends: …${body.slice(-90)}`
        : body.slice(0, 160),
    };
  }

  // The schema is still enforced in full. A model that returns valid JSON of the wrong
  // shape fails here exactly as it did before.
  const validated = schema.safeParse(json);
  if (!validated.success) {
    return {
      ok: false,
      reason: "schema_mismatch",
      detail: validated.error.issues.slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    };
  }

  return {
    ok: true,
    parsed: validated.data,
    model: completion.model,
    servedBy: completion.provider ?? null,
    fenced: body !== String(choice?.message?.content ?? "").trim(),
  };
}

// Free endpoints are shared and rate-limited per account, so pacing belongs to the
// caller, not to a retry loop that only discovers the limit by breaching it.
// **A refusal that lasts until tomorrow.** OpenRouter answers two different things with a
// 429. "Provider returned error" is a free endpoint busy for a moment, and the next work may
// well get through. "Rate limit exceeded: free-models-per-day…" is the account's daily
// allowance of free-model calls, spent — and every call until it resets will get the same
// answer.
//
// The enrichment treated both as the first kind. Measured on 22.09 over the log of the live
// run: the daily refusal first came on the morning of 21.09, and since then it had answered
// 15,386 times against 983 extractions that got through — each of those refusals a work whose
// Wikipedia article had been fetched for nothing, left unstamped, to be fetched again the
// next day. The run still converged, because most works need no model at all, but for most
// of every day it was reading Wikipedia to throw the reading away.
export function dailyQuotaSpent(result) {
  if (!result || result.ok) return false;
  if (result.status !== 429 && result.reason !== "rate_limited") return false;
  return /per[- ]day|daily/i.test(String(result.detail ?? ""));
}

export function createThrottle(requestsPerMinute = 12, { now = () => Date.now(), sleep } = {}) {
  const gapMs = Math.ceil(60_000 / requestsPerMinute);
  const pause = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  // When the next call may go out. Starts in the past so the first one never waits —
  // an opening delay buys nothing, since no request has been made to space it from.
  let nextAllowed = -Infinity;

  return async function waitTurn() {
    const current = now();
    if (current < nextAllowed) await pause(nextAllowed - current);
    // Measured from now, not from the previous slot: a model that thought for thirty
    // seconds has already served the gap, and sleeping again only wastes it.
    nextAllowed = Math.max(now(), nextAllowed) + gapMs;
  };
}
