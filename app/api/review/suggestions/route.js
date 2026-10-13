// The review step for readers' suggestions (#48).
//
//   GET  /api/review/suggestions            the pending ones, oldest first
//   POST /api/review/suggestions            { id, action: "verify", workId, sourceUrl, reason? }
//                                           { id, action: "reject", reason }
//
// The caller sends their own Supabase session (Authorization: Bearer <access token>); the
// account must be a moderator (MODERATOR_EMAILS, see suggestion-review.mjs). Reading and
// writing happen under the service role, because row-level security lets nobody but the
// author see a suggestion. Without the service role or the moderator list the route is
// shut (503), not open.

import { createClient } from "@supabase/supabase-js";

import {
  isModerator,
  moderatorEmails,
  parseReviewDecision,
  REVIEW_ACTIONS,
  submissionFromSuggestion,
  suggestionAfterReview,
} from "../../../lib/suggestion-review.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const PAGE = 50;
const SUGGESTION_COLUMNS = "id, place_name, work_title, scene, lat, lng, source_url, status, status_reason, created_at";

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function defaultServices(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  return {
    async authenticate(token) {
      const { data, error } = await admin.auth.getUser(token);
      return error ? null : data?.user ?? null;
    },
    async listPending() {
      const { data, error, count } = await admin
        .from("reader_place_suggestions")
        .select(SUGGESTION_COLUMNS, { count: "exact" })
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(PAGE);
      if (error) throw new Error(`pending read failed: ${error.message}`);
      return { rows: data ?? [], total: count ?? (data ?? []).length };
    },
    async getSuggestion(id) {
      const { data, error } = await admin
        .from("reader_place_suggestions").select(SUGGESTION_COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error(`suggestion read failed: ${error.message}`);
      return data;
    },
    async getWork(id) {
      const { data, error } = await admin.from("works").select("id, title").eq("id", id).maybeSingle();
      if (error) throw new Error(`work read failed: ${error.message}`);
      return data;
    },
    async findSubmission(workId, placeName) {
      const { data, error } = await admin
        .from("location_submissions").select("id")
        .eq("work_id", workId).eq("place_key", placeName.trim().toLowerCase())
        .maybeSingle();
      if (error) throw new Error(`queue read failed: ${error.message}`);
      return data?.id ?? null;
    },
    async insertSubmission(row) {
      const { data, error } = await admin.from("location_submissions").insert(row).select("id").single();
      if (error) throw new Error(`queue insert failed: ${error.message}`);
      return data.id;
    },
    // Only a still-pending row is changed, so two moderators cannot both decide it.
    async updateSuggestion(id, patch) {
      const { data, error } = await admin
        .from("reader_place_suggestions").update(patch)
        .eq("id", id).eq("status", "pending")
        .select("id");
      if (error) throw new Error(`suggestion update failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}

export function createReviewHandlers({
  env = process.env,
  services,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeServices = services ?? (() => defaultServices(env));

  // Returns { svc, user } or { response }.
  async function moderatorOf(request) {
    if (moderatorEmails(env).length === 0) return { response: jsonError("Review is not configured", 503) };
    const svc = makeServices(env);
    if (!svc) return { response: jsonError("Review is not configured", 503) };

    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return { response: jsonError("Sign in to review suggestions", 401) };

    let user = null;
    try {
      user = await svc.authenticate(token);
    } catch (error) {
      logError("Review sign-in check failed", { message: error?.message });
      return { response: jsonError("Could not check who is signed in", 502) };
    }
    if (!user) return { response: jsonError("Sign in to review suggestions", 401) };
    if (!isModerator(user, env)) return { response: jsonError("This account does not review suggestions", 403) };
    return { svc, user };
  }

  async function GET(request) {
    const { svc, response } = await moderatorOf(request);
    if (response) return response;
    try {
      const { rows, total } = await svc.listPending();
      return Response.json({ suggestions: rows, total }, { headers: noStoreHeaders });
    } catch (error) {
      logError("Review list failed", { message: error?.message });
      return jsonError("Could not read the suggestions", 502);
    }
  }

  async function POST(request) {
    const { svc, user, response } = await moderatorOf(request);
    if (response) return response;

    let body = null;
    try {
      body = await request.json();
    } catch {
      return jsonError("Send a JSON body", 400);
    }
    const { decision, error } = parseReviewDecision(body);
    if (error) return jsonError(error, 400);

    try {
      const suggestion = await svc.getSuggestion(decision.id);
      if (!suggestion) return jsonError("No such suggestion", 404);
      if (suggestion.status !== "pending") return jsonError("It has already been reviewed", 409);

      let submissionId = null;
      let linked = false;
      if (decision.action === REVIEW_ACTIONS.verify) {
        const work = await svc.getWork(decision.workId);
        if (!work) return jsonError("That work is not in the graph", 404);
        // The same place for the same work is one queue row: (work_id, place_key) is unique.
        // A suggestion that names a place we already hold links to it.
        submissionId = await svc.findSubmission(work.id, suggestion.place_name);
        linked = Boolean(submissionId);
        if (!submissionId) {
          submissionId = await svc.insertSubmission(submissionFromSuggestion(suggestion, {
            workId: work.id,
            workTitle: work.title,
            sourceUrl: decision.sourceUrl,
            reason: decision.reason,
          }));
        }
      }

      const patch = suggestionAfterReview(decision, { moderatorId: user.id, submissionId });
      const changed = await svc.updateSuggestion(decision.id, patch);
      if (!changed) return jsonError("It has already been reviewed", 409);

      return Response.json(
        { id: decision.id, status: patch.status, submission_id: submissionId, linked },
        { headers: noStoreHeaders },
      );
    } catch (failure) {
      logError("Review failed", { message: failure?.message });
      return jsonError("Could not save the review", 502);
    }
  }

  return { GET, POST };
}

const handlers = createReviewHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
