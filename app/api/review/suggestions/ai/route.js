// The AI pre-check of readers' suggestions (#48): POST /api/review/suggestions/ai
//
// Takes the oldest pending suggestions the model has not seen yet ({ limit } in the body,
// 10 by default, at most 25), and for each one: refuses obvious junk without a model,
// otherwise asks the model, then applies what code allows (see suggestion-ai-review.mjs).
// A pass goes into the map's queue as an unchecked candidate; a rejection tells the reader
// why; anything else waits. Every row it looks at is stamped, so a run never pays twice.
//
// Guarded like the other paid write routes (ENRICH_TOKEN, enrich-auth.mjs), and meant for a
// scheduler. Nothing schedules it yet: owner's decision, 13.10.2026, to have it ready and
// switch it on later.

import { enrichGuard } from "../../../../lib/enrich-auth.mjs";
import { createModelClient, parseStructured, TIERS } from "../../../../lib/model-client.mjs";
import {
  aiReviewInput,
  aiReviewInstructions,
  aiReviewSchema,
  AI_VERDICTS,
  decideFromAi,
  obviousJunk,
} from "../../../../lib/suggestion-ai-review.mjs";
import { promoteSuggestion } from "../../../../lib/suggestion-review.mjs";
import { prepareSearchQuery } from "../../../../lib/work-search.mjs";
import { defaultReviewServices } from "../route.js";

export const runtime = "nodejs";
export const maxDuration = 300;

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

export function createAiReviewHandler({
  env = process.env,
  services,
  // Careful tier: a pass puts a claim on the public map.
  createRuntime = (env) => createModelClient(env, { tier: TIERS.CAREFUL }),
  logError = (...args) => console.error(...args),
  now = () => new Date(),
} = {}) {
  const makeServices = services ?? (() => defaultReviewServices(env));

  async function reviewOne(svc, modelRuntime, suggestion) {
    const stamp = { ai_reviewed_at: now().toISOString() };
    const junk = obviousJunk(suggestion);
    let decision;
    if (junk) {
      decision = { verdict: AI_VERDICTS.reject, reason: junk, note: `rule: ${junk}` };
    } else {
      const prepared = prepareSearchQuery(suggestion.work_title, { limit: 5 });
      const candidates = prepared ? await svc.searchWorks(prepared.query, prepared.limit) : [];
      const result = await parseStructured({
        runtime: modelRuntime,
        schema: aiReviewSchema,
        schemaName: "suggestion_review",
        instructions: aiReviewInstructions(),
        input: aiReviewInput(suggestion, candidates),
        maxTokens: 2000,
        timeout: 60_000,
      });
      // A failed call is not a verdict: the row stays unstamped and the next run tries again.
      if (!result.ok) return { id: suggestion.id, verdict: "error", reason: result.reason };
      decision = decideFromAi(result.parsed, { suggestion, candidates });
    }

    if (decision.verdict === AI_VERDICTS.unsure) {
      await svc.updateSuggestion(suggestion.id, { ...stamp, ai_note: decision.note });
      return { id: suggestion.id, verdict: decision.verdict };
    }

    let submissionId = null;
    let linked = false;
    if (decision.verdict === AI_VERDICTS.pass) {
      ({ submissionId, linked } = await promoteSuggestion(svc, suggestion, {
        work: { id: decision.workId, title: decision.workTitle },
        sourceUrl: suggestion.source_url,
        status: "pending",
        statusReason: "a reader's suggestion that passed the AI pre-check; not checked by a person",
      }));
    }
    const passed = decision.verdict === AI_VERDICTS.pass;
    await svc.updateSuggestion(suggestion.id, {
      ...stamp,
      ai_note: decision.note,
      status: passed ? "verified" : "rejected",
      status_reason: passed ? "passed the AI pre-check" : decision.reason,
      reviewed_at: stamp.ai_reviewed_at,
      submission_id: submissionId,
    });
    return { id: suggestion.id, verdict: decision.verdict, submission_id: submissionId, linked };
  }

  return async function POST(request) {
    // Before anything is read or paid for.
    const refusal = enrichGuard(request, env);
    if (refusal) return refusal;

    const body = await request.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body?.limit) || DEFAULT_LIMIT, MAX_LIMIT));

    const svc = makeServices(env);
    if (!svc) return jsonError("Review is not configured", 503);
    const modelRuntime = createRuntime(env);
    if (!modelRuntime) return jsonError("No model key is configured.", 503);

    let queue;
    try {
      queue = await svc.listForAi(limit);
    } catch (error) {
      logError("AI review queue read failed", { message: error?.message });
      return jsonError("Could not read the suggestions", 502);
    }

    const results = [];
    for (const suggestion of queue) {
      try {
        results.push(await reviewOne(svc, modelRuntime, suggestion));
      } catch (error) {
        logError("AI review failed", { id: suggestion.id, message: error?.message });
        results.push({ id: suggestion.id, verdict: "error", reason: "write_failed" });
      }
    }

    const tally = results.reduce((counts, entry) => ({ ...counts, [entry.verdict]: (counts[entry.verdict] ?? 0) + 1 }), {});
    return Response.json({ reviewed: results.length, tally, results, model: modelRuntime.model }, { headers: noStoreHeaders });
  };
}

export const POST = createAiReviewHandler();
