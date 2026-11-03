import assert from "node:assert/strict";
import test from "node:test";

import {
  aiReviewInput,
  aiReviewSchema,
  decideFromAi,
  isPublicWebUrl,
  mentions,
  obviousJunk,
  pageText,
  readSource,
} from "../app/lib/suggestion-ai-review.mjs";
import { reviewOutcomeLabel, submissionFromSuggestion } from "../app/lib/suggestion-review.mjs";
import { createAiReviewHandler } from "../app/api/review/suggestions/ai/route.js";

const WORK_ID = "22222222-2222-4222-8222-222222222222";
const CANDIDATES = [{ work_id: WORK_ID, title: "Harry Potter and the Philosopher's Stone", year: 2001, kind: "film" }];
const SUGGESTION = {
  id: "11111111-1111-4111-8111-111111111111",
  place_name: "Leadenhall Market",
  work_title: "Harry Potter",
  scene: "Diagon Alley",
  lat: 51.51275,
  lng: -0.08347,
  source_url: "https://example.com/hp",
  status: "pending",
};

test("a confident pass needs a work from the candidates and a source link", () => {
  const pass = { verdict: "pass", work_id: WORK_ID, confidence: 0.9, reason: "Known location." };
  assert.equal(decideFromAi(pass, { suggestion: SUGGESTION, candidates: CANDIDATES }).verdict, "pass");
  assert.equal(decideFromAi({ ...pass, work_id: "made-up" }, { suggestion: SUGGESTION, candidates: CANDIDATES }).verdict, "unsure");
  assert.equal(decideFromAi(pass, { suggestion: { ...SUGGESTION, source_url: null }, candidates: CANDIDATES }).verdict, "unsure");
  assert.equal(decideFromAi({ ...pass, confidence: 0.6 }, { suggestion: SUGGESTION, candidates: CANDIDATES }).verdict, "unsure");
});

test("a rejection needs confidence and a reason the reader can read", () => {
  const reject = { verdict: "reject", work_id: null, confidence: 0.95, reason: "This looks like an advert." };
  const decided = decideFromAi(reject, { suggestion: SUGGESTION, candidates: CANDIDATES });
  assert.equal(decided.verdict, "reject");
  assert.equal(decided.reason, "This looks like an advert.");
  assert.equal(decideFromAi({ ...reject, confidence: 0.5 }, { suggestion: SUGGESTION, candidates: CANDIDATES }).verdict, "unsure");
  assert.equal(decideFromAi({ ...reject, reason: "" }, { suggestion: SUGGESTION, candidates: CANDIDATES }).verdict, "unsure");
});

test("obvious junk is refused without a model", () => {
  assert.match(obviousJunk({ place_name: "buy now www.spam.biz", work_title: "x" }), /link/);
  assert.match(obviousJunk({ place_name: "aaaaaaaaaa", work_title: "x" }), /place/);
  assert.match(obviousJunk({ place_name: "12345", work_title: "x" }), /place/);
  assert.equal(obviousJunk(SUGGESTION), null);
});

test("the model sees the suggestion as data, with the candidate works", () => {
  const input = JSON.parse(aiReviewInput(SUGGESTION, CANDIDATES));
  assert.equal(input.suggestion.place, "Leadenhall Market");
  assert.equal(input.candidate_works[0].work_id, WORK_ID);
  assert.equal(aiReviewSchema.safeParse({ verdict: "pass", work_id: null, confidence: 2, reason: "", problems: [] }).success, false);
  assert.equal(JSON.parse(aiReviewInput(SUGGESTION, CANDIDATES, { url: "u", text: "page" })).source_page.text, "page");
});

test("a pass enters the map's queue as an unchecked candidate, never as verified", () => {
  const row = submissionFromSuggestion(SUGGESTION, {
    workId: WORK_ID, workTitle: "HP", sourceUrl: SUGGESTION.source_url, status: "pending", statusReason: "passed the AI pre-check",
  });
  assert.equal(row.status, "pending");
  assert.equal(row.reviewed_at, null);
  assert.match(row.source_title, /citing example\.com/);
  assert.equal(reviewOutcomeLabel({ status: "verified", status_reason: "passed the AI pre-check" }), "On the map · passed an automatic check");
});

// --- the route ---------------------------------------------------------------------------

const ENV = { ENRICH_TOKEN: "secret" };

function request(token = "secret", body = {}) {
  return {
    headers: { get: (name) => (name.toLowerCase() === "x-enrich-token" ? token : null) },
    json: async () => body,
  };
}

function setup({ queue = [SUGGESTION], answer, existing = null } = {}) {
  const calls = { inserted: [], updates: [], modelCalls: 0 };
  const svc = {
    listForAi: async () => queue,
    searchWorks: async () => CANDIDATES,
    findSubmission: async () => existing,
    insertSubmission: async (row) => { calls.inserted.push(row); return "sub-new"; },
    updateSuggestion: async (id, patch) => { calls.updates.push({ id, patch }); return true; },
  };
  const runtime = {
    provider: "openai",
    model: "test-model",
    extraBody: {},
    client: { chat: { completions: { create: async () => {
      calls.modelCalls += 1;
      if (answer instanceof Error) throw answer;
      return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer) } }] };
    } } } },
  };
  const POST = createAiReviewHandler({
    env: ENV, services: () => svc, createRuntime: () => runtime, logError: () => {},
    fetchSource: async (url) => ({ url, text: "Harry Potter was filmed at Leadenhall Market." }), now: () => new Date("2026-10-13T12:00:00Z"),
  });
  return { POST, calls };
}

test("the route is shut without the enrich token", async () => {
  const { POST } = setup();
  assert.equal((await POST(request("wrong"))).status, 401);
  const open = createAiReviewHandler({ env: {}, services: () => ({}), createRuntime: () => ({}) });
  assert.equal((await open(request())).status, 503);
});

test("a confident pass puts it on the map as a candidate and closes the suggestion", async () => {
  const { POST, calls } = setup({ answer: { verdict: "pass", work_id: WORK_ID, confidence: 0.92, reason: "Well known.", problems: [] } });
  const body = await (await POST(request())).json();
  assert.deepEqual(body.tally, { pass: 1 });
  assert.equal(calls.inserted[0].status, "pending");
  assert.equal(calls.updates[0].patch.status, "verified");
  assert.equal(calls.updates[0].patch.submission_id, "sub-new");
  assert.ok(calls.updates[0].patch.ai_reviewed_at);
});

test("an unsure verdict only stamps the row, so it waits unseen", async () => {
  const { POST, calls } = setup({ answer: { verdict: "unsure", work_id: null, confidence: 0.4, reason: "Not sure.", problems: ["The scene does not match the plot."] } });
  const body = await (await POST(request())).json();
  assert.equal(calls.inserted.length, 0);
  assert.deepEqual(Object.keys(calls.updates[0].patch).sort(), ["ai_note", "ai_problems", "ai_reviewed_at"]);
  assert.ok(calls.updates[0].patch.ai_problems.includes("The scene does not match the plot."));
  assert.ok(body.results[0].problems.length >= 2, "the model's problem and the code's own");
});

test("junk is rejected without calling the model", async () => {
  const { POST, calls } = setup({ queue: [{ ...SUGGESTION, place_name: "visit www.spam.biz" }], answer: {} });
  const body = await (await POST(request())).json();
  assert.deepEqual(body.tally, { reject: 1 });
  assert.equal(calls.modelCalls, 0);
  assert.equal(calls.updates[0].patch.status, "rejected");
});

test("a failed model call leaves the row for the next run", async () => {
  const { POST, calls } = setup({ answer: Object.assign(new Error("busy"), { status: 429 }) });
  const body = await (await POST(request())).json();
  assert.deepEqual(body.tally, { error: 1 });
  assert.equal(calls.updates.length, 0);
});

test("an unsure suggestion carries every problem a person should look at", () => {
  const decided = decideFromAi(
    { verdict: "pass", work_id: "nope", confidence: 0.6, reason: "Plausible.", problems: ["Coordinate is 2 km off."] },
    { suggestion: { ...SUGGESTION, source_url: null }, candidates: CANDIDATES },
  );
  assert.equal(decided.verdict, "unsure");
  assert.deepEqual(decided.problems, [
    "Coordinate is 2 km off.",
    "No source link: find a page that backs the claim.",
    'None of the works in our graph is clearly "Harry Potter".',
    "The model is not sure (0.60): Plausible.",
  ]);
});

test("a confident pass whose source does not name the place goes to a person", () => {
  const decided = decideFromAi(
    { verdict: "pass", work_id: WORK_ID, confidence: 0.95, reason: "Known.", problems: [] },
    { suggestion: SUGGESTION, candidates: CANDIDATES, source: { problem: 'The source page does not mention "Leadenhall Market".' } },
  );
  assert.equal(decided.verdict, "unsure");
  assert.match(decided.problems[0], /does not mention/);
});

test("a weak rejection is not applied but is said", () => {
  const decided = decideFromAi(
    { verdict: "reject", work_id: null, confidence: 0.6, reason: "Probably a joke.", problems: [] },
    { suggestion: SUGGESTION, candidates: CANDIDATES },
  );
  assert.equal(decided.verdict, "unsure");
  assert.ok(decided.problems.includes("The model leans to reject (0.60): Probably a joke."));
});

test("only public web pages are fetched", () => {
  assert.equal(isPublicWebUrl("https://en.wikipedia.org/wiki/Leadenhall_Market"), true);
  for (const url of ["http://127.0.0.1/", "http://localhost/", "http://[::1]/", "http://metadata.internal/", "ftp://a.b/", "https://a.b:8443/", "https://u:p@a.b/", "http://10.0.0.1/x"]) {
    assert.equal(isPublicWebUrl(url), false, url);
  }
});

test("a page is read as text and checked for the place", () => {
  assert.equal(pageText("<style>x{}</style><p>Leadenhall&nbsp;Market</p>"), "Leadenhall Market");
  assert.equal(mentions("Filmed at the old market in Leadenhall.", "Leadenhall Market"), true);
  assert.equal(mentions("Filmed in Borough.", "Leadenhall Market"), false);
  assert.equal(mentions("Café de Flore, Paris", "Cafe de Flore"), true);
});

function page(status, body = "", headers = {}) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, text: async () => body };
}

test("the source is opened, redirects followed only to public hosts", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url === "http://example.com/hp") return page(301, "", { location: "https://example.com/hp" });
    return page(200, "<h1>Harry Potter at Leadenhall Market</h1>", { "content-type": "text/html" });
  };
  const read = await readSource("http://example.com/hp", { place: "Leadenhall Market", fetchImpl });
  assert.equal(read.problem, undefined);
  assert.match(read.text, /Leadenhall/);
  assert.deepEqual(seen, ["http://example.com/hp", "https://example.com/hp"]);

  const toInternal = async () => page(302, "", { location: "http://169.254.169.254/latest" });
  assert.match((await readSource("https://example.com/x", { fetchImpl: toInternal })).problem, /not a public/);
  assert.match((await readSource("https://example.com/x", { fetchImpl: async () => page(404) })).problem, /HTTP 404/);
  assert.match((await readSource("https://example.com/x", { fetchImpl: async () => { throw new Error("dns"); } })).problem, /could not be opened/);
  const elsewhere = async () => page(200, "<p>Borough Market</p>", { "content-type": "text/html" });
  const read2 = await readSource("https://example.com/x", { place: "Leadenhall Market", fetchImpl: elsewhere });
  assert.match(read2.problem, /does not mention/);
  assert.ok(read2.text, "the text still goes to the model");
});
