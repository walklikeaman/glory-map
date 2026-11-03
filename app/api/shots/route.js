// Visitors' shots of a place (#157): list what may be shown, and take a new one.
//
// GET  /api/shots?place=<key>   approved shots, plus the caller's own when a token is sent
// POST /api/shots               { placeKey, workKey, storagePath, kind, referenceUrl, caption, placeName }
//                               with Authorization: Bearer <supabase access token>
//
// The browser uploads the file to the private `place-shots` bucket under its own folder
// first; this route records it (under the caller's token, so RLS decides), then runs the
// AI check with the service role. A check that cannot run leaves the shot pending.

import { createClient } from "@supabase/supabase-js";

import { SHOTS_BUCKET, SHOTS_PER_USER_DAY, validateShotRequest, visibleShots } from "../../lib/place-shots.mjs";
import {
  dailyLimitFrom, dailyLimitReached, moderateShot, startOfUtcDay, statusForVerdict,
} from "../../lib/shot-moderation.mjs";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" };
const SIGNED_URL_SECONDS = 60 * 60;
const LIST_LIMIT = 24;

function json(body, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

function bearer(request) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

export function defaultShotsStore(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) return null;

  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const asUser = (token) => createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  return {
    async getUser(token) {
      const { data, error } = await service.auth.getUser(token);
      return error || !data?.user?.id ? null : { id: data.user.id };
    },
    async insertShot(token, row) {
      const { data, error } = await asUser(token).from("place_shots").insert(row).select("id").single();
      if (error) throw new Error(`shot insert failed: ${error.message}`);
      return data;
    },
    // Approved shots, plus the viewer's own pending ones — never other people's pending
    // rows, which would otherwise crowd the approved ones out of the limit.
    async listShots(placeKey, viewerId = null) {
      let query = service
        .from("place_shots")
        .select("id, user_id, kind, caption, reference_url, status, storage_path, created_at, ai_checked_at")
        .eq("place_key", placeKey);
      query = viewerId
        ? query.or(`status.eq.approved,and(status.eq.pending,user_id.eq.${viewerId})`)
        : query.eq("status", "approved");
      const { data, error } = await query.order("created_at", { ascending: false }).limit(LIST_LIMIT);
      if (error) throw new Error(`shot list failed: ${error.message}`);
      return data ?? [];
    },
    async signUrls(paths) {
      if (!paths.length) return {};
      const { data, error } = await service.storage.from(SHOTS_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
      if (error) throw new Error(`signing failed: ${error.message}`);
      return Object.fromEntries((data ?? []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
    },
    async downloadShot(path) {
      const { data, error } = await service.storage.from(SHOTS_BUCKET).download(path);
      if (error || !data) throw new Error(`download failed: ${error?.message ?? "empty"}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async updateShot(id, patch) {
      const { error } = await service.from("place_shots").update(patch).eq("id", id);
      if (error) throw new Error(`shot update failed: ${error.message}`);
    },
    async removeObject(path) {
      await service.storage.from(SHOTS_BUCKET).remove([path]);
    },
    async countSharedSince(userId, iso) {
      const { count, error } = await service
        .from("place_shots")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", iso);
      if (error) throw new Error(`count failed: ${error.message}`);
      return count ?? 0;
    },
    async countCheckedSince(iso) {
      const { count, error } = await service
        .from("place_shots")
        .select("id", { count: "exact", head: true })
        .gte("ai_checked_at", iso);
      if (error) throw new Error(`count failed: ${error.message}`);
      return count ?? 0;
    },
  };
}

export function createShotsHandlers({
  env = process.env,
  store = defaultShotsStore(env),
  moderate = (input) => moderateShot({
    ...input, apiKey: env.ANTHROPIC_API_KEY, model: env.SHOT_MODERATION_MODEL,
  }),
  now = () => new Date(),
  logError = (...args) => console.error(...args),
} = {}) {
  async function GET(request) {
    if (!store) return json({ error: "Shots are not configured" }, 503);
    const placeKey = new URL(request.url).searchParams.get("place")?.trim();
    if (!placeKey) return json({ error: "place is required" }, 400);
    try {
      const token = bearer(request);
      // A failed token check makes the caller anonymous; it must not hide public shots.
      const viewer = token ? await store.getUser(token).catch(() => null) : null;
      const viewerId = viewer?.id ?? null;
      const shots = visibleShots(await store.listShots(placeKey, viewerId), viewerId).slice(0, LIST_LIMIT);
      const urls = await store.signUrls(shots.map((shot) => shot.storagePath));
      return json({
        shots: shots
          .filter((shot) => urls[shot.storagePath])
          .map(({ storagePath, ...shot }) => ({ ...shot, url: urls[storagePath] })),
      });
    } catch (error) {
      logError("Shots list failed", { message: error?.message });
      return json({ error: "Could not read shots" }, 502);
    }
  }

  async function POST(request) {
    if (!store) return json({ error: "Shots are not configured" }, 503);
    const token = bearer(request);
    if (!token) return json({ error: "Sign in to share a shot" }, 401);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Send a JSON body" }, 400); }

    let user;
    try { user = await store.getUser(token); } catch { user = null; }
    if (!user) return json({ error: "Sign in to share a shot" }, 401);

    const { value, error } = validateShotRequest(body, user.id);
    if (error) return json({ error }, 400);

    // Past the per-account cap the upload is dropped: the file is the reader's own
    // (validated above), and keeping it with no row would leave it in storage for good.
    try {
      if (await store.countSharedSince(user.id, startOfUtcDay(now())) >= SHOTS_PER_USER_DAY) {
        await store.removeObject(value.storage_path).catch(() => {});
        return json({ error: "That is a lot of shots for one day. Try again tomorrow." }, 429);
      }
    } catch (countError) {
      logError("Shot count failed", { message: countError?.message });
      return json({ error: "Could not save the shot" }, 502);
    }

    let inserted;
    try {
      inserted = await store.insertShot(token, { ...value, user_id: user.id, status: "pending" });
    } catch (insertError) {
      logError("Shot insert failed", { message: insertError?.message });
      await store.removeObject(value.storage_path).catch(() => {});
      return json({ error: "Could not save the shot" }, 502);
    }

    // From here the shot exists. Anything that goes wrong leaves it pending, never lost.
    const pending = (reason) => json({ shot: { id: inserted.id, status: "pending", reason } }, 201);
    if (!env.ANTHROPIC_API_KEY) return pending("Waiting for a check.");
    try {
      const checked = await store.countCheckedSince(startOfUtcDay(now()));
      if (dailyLimitReached(checked, dailyLimitFrom(env.SHOT_MODERATION_DAILY_LIMIT))) {
        return pending("Waiting for a check.");
      }
      const bytes = await store.downloadShot(value.storage_path);
      const verdict = await moderate({ bytes });
      const status = statusForVerdict(verdict.verdict);
      await store.updateShot(inserted.id, {
        status, status_reason: verdict.reason, ai_checked_at: now().toISOString(),
      });
      // A rejected shot is removed from storage, not only hidden from the list (#157).
      if (status === "rejected") await store.removeObject(value.storage_path);
      return json({ shot: { id: inserted.id, status, reason: verdict.reason } }, 201);
    } catch (checkError) {
      logError("Shot check failed", { message: checkError?.message });
      return pending("Waiting for a check.");
    }
  }

  return { GET, POST };
}

const handlers = createShotsHandlers();
export const GET = (request) => handlers.GET(request);
export const POST = (request) => handlers.POST(request);
