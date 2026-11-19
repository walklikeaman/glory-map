// Alignment coach (#53): one on-demand look at the camera view next to the film frame.
//
// POST /api/coach   { reference: "data:image/jpeg;base64,…", camera: "data:image/jpeg;base64,…" }
//                   with Authorization: Bearer <supabase access token>
//
// Signed-in only, capped per account and per day (paid vision call). Both pictures are
// downscaled on the device and sent inline; nothing is stored.

import { createClient } from "@supabase/supabase-js";

import {
  coachSentence, coachShot, createCoachLimiter, dailyLimitFrom, validateCoachRequest,
} from "../../lib/align-coach.mjs";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" };

function json(body, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

function bearer(request) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

function defaultGetUser(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  return async (token) => {
    const { data, error } = await service.auth.getUser(token);
    return error || !data?.user?.id ? null : { id: data.user.id };
  };
}

export function createCoachHandlers({
  env = process.env,
  getUser = defaultGetUser(env),
  coach = (input) => coachShot({ ...input, apiKey: env.ANTHROPIC_API_KEY, model: env.COACH_MODEL }),
  limiter = createCoachLimiter({ perDay: dailyLimitFrom(env.COACH_DAILY_LIMIT) }),
  logError = (...args) => console.error(...args),
} = {}) {
  async function POST(request) {
    if (!getUser || !env.ANTHROPIC_API_KEY) return json({ error: "The coach is not available right now" }, 503);
    const token = bearer(request);
    const user = token ? await getUser(token).catch(() => null) : null;
    if (!user) return json({ error: "Sign in to use the coach" }, 401);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Send a JSON body" }, 400); }
    const { value, error } = validateCoachRequest(body);
    if (error) return json({ error }, 400);

    const slot = limiter.take(user.id);
    if (!slot.ok) {
      return json({
        error: slot.reason === "user"
          ? "That's all the coaching for today. Line it up with the outlines and the grid."
          : "The coach is resting for today. Line it up with the outlines and the grid.",
      }, 429);
    }

    try {
      const { coach: result } = await coach(value);
      if (!result) return json({ error: "The coach couldn't read this one. Try again." }, 502);
      return json({ ...result, sentence: coachSentence(result), left: slot.left });
    } catch (coachError) {
      logError("Coach failed", { message: coachError?.message });
      return json({ error: "The coach couldn't answer. Try again in a moment." }, 502);
    }
  }

  return { POST };
}

const handlers = createCoachHandlers();
export const POST = (request) => handlers.POST(request);
