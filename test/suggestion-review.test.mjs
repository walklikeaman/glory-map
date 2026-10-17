import assert from "node:assert/strict";
import test from "node:test";

import {
  isModerator,
  moderatorEmails,
  parseReviewDecision,
  readReviewOutcomes,
  readerSentence,
  reviewOutcomeLabel,
  submissionFromSuggestion,
  suggestionAfterReview,
} from "../app/lib/suggestion-review.mjs";
import { createReviewHandlers } from "../app/api/review/suggestions/route.js";

const SUGGESTION_ID = "11111111-1111-4111-8111-111111111111";
const WORK_ID = "22222222-2222-4222-8222-222222222222";
const MOD = { id: "mod-1", email: "Nikita@Example.com", email_confirmed_at: "2026-01-01T00:00:00Z" };
const ENV = { MODERATOR_EMAILS: "nikita@example.com, other@example.com" };

const SUGGESTION = {
  id: SUGGESTION_ID,
  place_name: "Leadenhall Market",
  work_title: "Harry Potter",
  scene: "Diagon Alley entrance",
  lat: 51.51275,
  lng: -0.08347,
  source_url: "https://example.com/hp",
  status: "pending",
  created_at: "2026-10-12T10:00:00Z",
};

test("the moderator list is read from the environment and fails closed", () => {
  assert.deepEqual(moderatorEmails(ENV), ["nikita@example.com", "other@example.com"]);
  assert.deepEqual(moderatorEmails({}), []);
  assert.equal(isModerator(MOD, ENV), true);
  assert.equal(isModerator(MOD, {}), false);
  assert.equal(isModerator({ ...MOD, email: "someone@example.com" }, ENV), false);
});

test("an unconfirmed email is not a moderator", () => {
  assert.equal(isModerator({ id: "x", email: "nikita@example.com" }, ENV), false);
});

test("a rejection needs a reason, a verification a work and a source", () => {
  assert.match(parseReviewDecision({ id: "nope", action: "reject", reason: "dup" }).error, /suggestion/);
  assert.match(parseReviewDecision({ id: SUGGESTION_ID, action: "reject" }).error, /why/);
  assert.equal(parseReviewDecision({ id: SUGGESTION_ID, action: "reject", reason: "Not a filming location" }).decision.action, "reject");
  assert.match(parseReviewDecision({ id: SUGGESTION_ID, action: "verify", sourceUrl: "https://a.b" }).error, /work/);
  assert.match(parseReviewDecision({ id: SUGGESTION_ID, action: "verify", workId: WORK_ID }).error, /web page/);
  assert.match(parseReviewDecision({ id: SUGGESTION_ID, action: "verify", workId: WORK_ID, sourceUrl: "javascript:alert(1)" }).error, /web page/);
  const { decision } = parseReviewDecision({ id: SUGGESTION_ID, action: "verify", workId: WORK_ID, sourceUrl: " https://a.b/x " });
  assert.equal(decision.sourceUrl, "https://a.b/x");
  assert.match(parseReviewDecision({ id: SUGGESTION_ID, action: "approve" }).error, /verify or reject/);
});

test("a verified suggestion becomes a checked 'reader' row that carries its evidence", () => {
  const row = submissionFromSuggestion(SUGGESTION, {
    workId: WORK_ID, workTitle: "Harry Potter and the Philosopher's Stone", sourceUrl: "https://www.example.com/hp", reason: "",
  });
  assert.equal(row.source_kind, "reader");
  assert.equal(row.status, "verified");
  assert.equal(row.source_record_id, SUGGESTION_ID);
  assert.ok(row.source_sentence.length >= 10);
  assert.match(row.source_sentence, /^A reader placed Harry Potter and the Philosopher's Stone at Leadenhall Market: Diagon/);
  assert.match(row.source_title, /example\.com/);
  assert.ok(row.geocode_source && row.geocode_license, "a coordinate carries its provenance");
  assert.equal(row.lat, SUGGESTION.lat);
});

test("a suggestion without a scene still has a sentence", () => {
  assert.equal(readerSentence({ place_name: "Tate Modern" }, "Paddington 2"), "A reader placed Paddington 2 at Tate Modern.");
});

test("the suggestion row records who decided and when", () => {
  const now = new Date("2026-10-13T00:00:00Z");
  const verified = suggestionAfterReview({ action: "verify", reason: "" }, { moderatorId: "mod-1", submissionId: "sub-1", now });
  assert.deepEqual(verified, {
    status: "verified", status_reason: "checked by a moderator", reviewed_at: now.toISOString(), reviewed_by: "mod-1", submission_id: "sub-1",
  });
  const rejected = suggestionAfterReview({ action: "reject", reason: "duplicate" }, { moderatorId: "mod-1", submissionId: "x", now });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.submission_id, null);
});

test("the reader is told what became of a reviewed suggestion", () => {
  assert.equal(reviewOutcomeLabel({ status: "pending" }), null);
  assert.match(reviewOutcomeLabel({ status: "verified" }), /on the map/);
  assert.equal(reviewOutcomeLabel({ status: "rejected", status_reason: "not a filming location" }), "Not accepted · not a filming location");
});

test("outcomes are read by the browser's id and never throw", async () => {
  const client = {
    from: () => ({
      select: () => ({
        neq: async () => ({ data: [
          { client_id: "s-1", status: "verified" },
          { client_id: "s-2", status: "rejected", status_reason: "duplicate" },
        ], error: null }),
      }),
    }),
  };
  const outcomes = await readReviewOutcomes(client);
  assert.equal(outcomes.size, 2);
  assert.match(outcomes.get("s-2"), /duplicate/);
  const broken = { from: () => { throw new Error("offline"); } };
  assert.equal((await readReviewOutcomes(broken)).size, 0);
});

// --- the route ---------------------------------------------------------------------------

function request({ token = "tok", body, method = "GET" } = {}) {
  return {
    method,
    headers: { get: (name) => (name.toLowerCase() === "authorization" && token ? `Bearer ${token}` : null) },
    json: async () => { if (body === undefined) throw new Error("no body"); return body; },
  };
}

function fakeServices({ user = MOD, suggestion = SUGGESTION, work = { id: WORK_ID, title: "HP" }, existing = null, updated = true } = {}) {
  const calls = { inserted: [], updates: [] };
  return {
    calls,
    services: () => ({
      authenticate: async () => user,
      listPending: async () => ({ rows: [suggestion], total: 1 }),
      getSuggestion: async () => suggestion,
      getWork: async () => work,
      findSubmission: async () => existing,
      insertSubmission: async (row) => { calls.inserted.push(row); return "sub-new"; },
      updateSuggestion: async (id, patch) => { calls.updates.push({ id, patch }); return updated; },
    }),
  };
}

function handlers(options = {}, env = ENV) {
  const fake = fakeServices(options);
  return { ...fake, ...createReviewHandlers({ env, services: fake.services, logError: () => {} }) };
}

test("the route is shut without a moderator list", async () => {
  const { GET } = handlers({}, {});
  assert.equal((await GET(request())).status, 503);
});

test("the route asks for a session, then for a moderator", async () => {
  assert.equal((await handlers().GET(request({ token: null }))).status, 401);
  assert.equal((await handlers({ user: null }).GET(request())).status, 401);
  assert.equal((await handlers({ user: { ...MOD, email: "reader@example.com" } }).GET(request())).status, 403);
});

test("a moderator reads the pending suggestions", async () => {
  const response = await handlers().GET(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total, 1);
  assert.equal(body.suggestions[0].place_name, "Leadenhall Market");
});

test("verifying inserts a queue row and records it on the suggestion", async () => {
  const { POST, calls } = handlers();
  const response = await POST(request({ method: "POST", body: { id: SUGGESTION_ID, action: "verify", workId: WORK_ID, sourceUrl: "https://example.com/hp" } }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { id: SUGGESTION_ID, status: "verified", submission_id: "sub-new", linked: false });
  assert.equal(calls.inserted.length, 1);
  assert.equal(calls.inserted[0].work_id, WORK_ID);
  assert.equal(calls.updates[0].patch.reviewed_by, MOD.id);
  assert.equal(calls.updates[0].patch.submission_id, "sub-new");
});

test("a place the queue already holds for that work is linked, not duplicated", async () => {
  const { POST, calls } = handlers({ existing: "sub-old" });
  const body = await (await POST(request({ method: "POST", body: { id: SUGGESTION_ID, action: "verify", workId: WORK_ID, sourceUrl: "https://example.com/hp" } }))).json();
  assert.equal(body.linked, true);
  assert.equal(body.submission_id, "sub-old");
  assert.equal(calls.inserted.length, 0);
});

test("rejecting writes nothing to the queue", async () => {
  const { POST, calls } = handlers();
  const body = await (await POST(request({ method: "POST", body: { id: SUGGESTION_ID, action: "reject", reason: "Not a filming location" } }))).json();
  assert.equal(body.status, "rejected");
  assert.equal(calls.inserted.length, 0);
  assert.equal(calls.updates[0].patch.status_reason, "Not a filming location");
});

test("a suggestion already decided is not decided twice", async () => {
  const done = handlers({ suggestion: { ...SUGGESTION, status: "verified" } });
  assert.equal((await done.POST(request({ method: "POST", body: { id: SUGGESTION_ID, action: "reject", reason: "late" } }))).status, 409);
  const raced = handlers({ updated: false });
  assert.equal((await raced.POST(request({ method: "POST", body: { id: SUGGESTION_ID, action: "reject", reason: "late" } }))).status, 409);
});

test("bad input and unknown works are refused before anything is written", async () => {
  const { POST, calls } = handlers({ work: null });
  assert.equal((await POST(request({ method: "POST" }))).status, 400);
  assert.equal((await POST(request({ method: "POST", body: { id: SUGGESTION_ID, action: "verify" } }))).status, 400);
  assert.equal((await POST(request({ method: "POST", body: { id: SUGGESTION_ID, action: "verify", workId: WORK_ID, sourceUrl: "https://a.b" } }))).status, 404);
  assert.equal(calls.inserted.length + calls.updates.length, 0);
});
