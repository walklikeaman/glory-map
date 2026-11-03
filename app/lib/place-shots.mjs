// Visitors' shots of a place: a reader's own photograph, often a recreation of a film
// frame or of another visitor's shot, shared on the place card so the next person can
// recreate it in turn.
//
// A shot is a claim from a stranger, so it lands `pending` and nobody but its author sees
// it until a check says otherwise. A photo confirms what the place looks like today,
// never that a film was shot there (#129, #157).

export const SHOTS_BUCKET = "place-shots";
export const SHOT_KINDS = Object.freeze(["photo", "recreation"]);
export const SHOT_STATUSES = Object.freeze(["pending", "approved", "rejected"]);

// What the browser re-encodes to before upload. Re-drawing through a canvas is also what
// strips EXIF, GPS included: a photo of somebody's street must not carry their home.
export const SHOT_MAX_EDGE = 1600;
export const SHOT_MAX_BYTES = 2 * 1024 * 1024;
export const SHOT_MIME = "image/jpeg";
export const SHOT_CAPTION_MAX = 200;
// Shares one account may make in a UTC day. Each share can cost an AI check, so one
// account must not be able to spend the whole day's checks for everybody.
export const SHOTS_PER_USER_DAY = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[\w:.-]{1,120}$/;

// The longest edge brought down to `maxEdge`, the shape kept. Never scaled up.
export function fitWithin(width, height, maxEdge = SHOT_MAX_EDGE) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return null;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

// Each user writes only under their own folder; the storage policy says the same.
export function shotPathFor(userId, shotId) {
  if (!UUID.test(String(userId)) || !UUID.test(String(shotId))) return null;
  return `${userId}/${shotId}.jpg`;
}

export function pathBelongsTo(path, userId) {
  if (typeof path !== "string" || !UUID.test(String(userId))) return false;
  const [folder, file, ...rest] = path.split("/");
  return rest.length === 0 && folder === userId && /^[0-9a-f-]{36}\.jpg$/i.test(file ?? "");
}

// Only an https image may be named as the reference a shot recreates; anything else is
// dropped rather than stored, since the card links to it.
function cleanReference(url) {
  if (typeof url !== "string" || url.length > 600) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function cleanCaption(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, SHOT_CAPTION_MAX) : null;
}

// The body of POST /api/shots, checked against the signed-in user.
export function validateShotRequest(body, userId) {
  if (!body || typeof body !== "object") return { error: "Send a JSON body" };
  const placeKey = typeof body.placeKey === "string" ? body.placeKey.trim() : "";
  if (!KEY.test(placeKey)) return { error: "placeKey is required" };
  const workKey = typeof body.workKey === "string" && KEY.test(body.workKey.trim()) ? body.workKey.trim() : null;
  if (!pathBelongsTo(body.storagePath, userId)) return { error: "storagePath must be your own upload" };
  const kind = SHOT_KINDS.includes(body.kind) ? body.kind : "photo";
  return {
    value: {
      place_key: placeKey,
      work_key: workKey,
      storage_path: body.storagePath,
      kind,
      reference_url: kind === "recreation" ? cleanReference(body.referenceUrl) : null,
      caption: cleanCaption(body.caption),
      place_name: cleanCaption(body.placeName)?.slice(0, 120) ?? null,
    },
  };
}

// What the card may show: approved shots for everybody, and the reader's own shots in
// any state, labelled, so a pending upload does not look lost.
export function visibleShots(rows, viewerId = null) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.status === "approved" || (viewerId && row?.user_id === viewerId && row?.status !== "rejected"))
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      caption: row.caption ?? null,
      referenceUrl: row.reference_url ?? null,
      status: row.status,
      // A pending shot the check has already looked at was held back, not queued.
      checked: Boolean(row.ai_checked_at),
      mine: Boolean(viewerId && row.user_id === viewerId),
      createdAt: row.created_at ?? null,
      storagePath: row.storage_path,
    }));
}

// One label per state, for the strip under a shot.
export function shotStatusLabel(shot) {
  if (shot?.status === "approved") return shot.mine ? "Your shot · shared" : null;
  if (shot?.status === "pending") {
    return shot.checked ? "Your shot · held back for a closer look" : "Your shot · being checked";
  }
  return null;
}
