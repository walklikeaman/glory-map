// Alignment coach for "Recreate the shot" (#53): one vision call on demand compares
// what the camera sees now with the film frame and answers with one short instruction
// ("turn a little left, tilt down, step back"). Never per frame: the person taps a button.
// Pure module apart from `coachShot`, which makes the one Messages API call.

// Measured 19.11 on synthetic pairs (a frame vs crops of it): Opus 5.5 at low effort read
// pan and distance right (~$0.012 a call); Sonnet 5.5 added a wrong move to most answers
// (~$0.005); Haiku 5.5 called shifted crops "not the same place". See wiki/log.md.
export const DEFAULT_COACH_MODEL = "claude-opus-5-5";
export const COACH_EFFORT = "low";
// Per signed-in account and per server instance across everyone, per UTC day. The second
// cap is the spend guard: 60 calls ≈ $0.70 a day at most. COACH_DAILY_LIMIT overrides it.
export const COACH_PER_USER_DAY = 15;
export const DEFAULT_COACH_DAILY_LIMIT = 60;
// Both images are downscaled on the device first; a JPEG data URL above this is refused.
export const MAX_IMAGE_BYTES = 400_000;

// The model only measures (where the scene sits, how big); the code turns the numbers into
// moves. Asked for "turn left/right" directly, Sonnet 5.5 got pan backwards (19.11), the
// classic mirror confusion; the signs below are unambiguous. Roll is left to the on-device
// grid and horizon line: no model read a 9° rotation, and two gave the wrong sign.
export function coachPrompt() {
  return [
    "Two photos of the same street scene. Image 1 is a film frame (the target). Image 2 is a phone camera view right now.",
    "Ignore people, cars, light and season. Compare only the fixed scene: buildings, horizon, roads, landmarks.",
    "Pick two or three landmarks visible in both images and measure where they sit in image 2 compared with image 1:",
    "- dx: horizontal shift, as a fraction of image width. Negative when the landmarks sit further LEFT in image 2, positive when further RIGHT.",
    "- dy: vertical shift, as a fraction of image height. Negative when the landmarks sit HIGHER in image 2, positive when LOWER.",
    "- scale: how large the landmarks look in image 2 relative to image 1 (1 = same size, 2 = twice as large, 0.5 = half).",
    "If image 2 does not show the same place, set same_place to false.",
    "Answer with JSON only:",
    '{"same_place": true, "match": 0-100, "dx": 0, "dy": 0, "scale": 1}',
  ].join("\n");
}

function asObject(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const finite = (value, fallback) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : fallback);

function amountFor(size, [small, medium, large]) {
  if (size < small) return null;
  if (size < medium) return "slightly";
  if (size < large) return "a bit";
  return "a lot";
}

// Measurements → moves, largest first. A scene sitting too far left means the camera
// points too far right, so the person turns left; too low means aim down, and so on.
export function movesFromMeasure({ dx = 0, dy = 0, scale = 1 } = {}) {
  const moves = [];
  const pan = amountFor(Math.abs(dx), [0.05, 0.15, 0.3]);
  if (pan) moves.push({ move: "pan", direction: dx < 0 ? "left" : "right", amount: pan, size: Math.abs(dx) / 0.3 });
  const tilt = amountFor(Math.abs(dy), [0.05, 0.15, 0.3]);
  if (tilt) moves.push({ move: "tilt", direction: dy > 0 ? "down" : "up", amount: tilt, size: Math.abs(dy) / 0.3 });
  const zoom = scale > 0 ? Math.abs(Math.log(scale)) : 0;
  const step = amountFor(zoom, [0.1, 0.25, 0.6]);
  if (step) moves.push({ move: "step", direction: scale > 1 ? "back" : "forward", amount: step, size: zoom / 0.6 });
  return moves
    .sort((left, right) => right.size - left.size)
    .slice(0, 3)
    .map(({ move, direction, amount }) => ({ move, direction, amount }));
}

// The model's answer, checked and clamped. Anything unusable gives null.
export function parseCoach(text) {
  const raw = asObject(text);
  if (!raw || typeof raw !== "object") return null;
  const samePlace = raw.same_place !== false;
  const match = Number.isFinite(Number(raw.match)) ? Math.max(0, Math.min(100, Math.round(Number(raw.match)))) : null;
  const measure = {
    dx: Math.max(-1, Math.min(1, finite(raw.dx, 0))),
    dy: Math.max(-1, Math.min(1, finite(raw.dy, 0))),
    scale: Math.max(0.1, Math.min(10, finite(raw.scale, 1))),
  };
  return { samePlace, match, measure, moves: samePlace ? movesFromMeasure(measure) : [] };
}

const PHRASES = {
  pan: (direction) => `turn ${direction}`,
  tilt: (direction) => `tilt ${direction}`,
  step: (direction) => (direction === "back" ? "step back" : "step forward"),
};

// One sentence to show and read aloud.
export function coachSentence(coach) {
  if (!coach) return null;
  if (!coach.samePlace) return "This doesn't look like the same place yet. Check the map and the compass guide.";
  if (!coach.moves.length) return "That's it, you've got the shot. Take the photo.";
  const parts = coach.moves.map(({ move, direction, amount }) => `${PHRASES[move](direction)} ${amount}`);
  const sentence = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}.`;
}

// "data:image/jpeg;base64,…" → { mediaType, data } or null.
export function parseImageDataUrl(value) {
  if (typeof value !== "string") return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  // base64 is 4 chars per 3 bytes.
  if (Math.floor((match[2].length * 3) / 4) > MAX_IMAGE_BYTES) return null;
  return { mediaType: match[1], data: match[2] };
}

export function validateCoachRequest(body) {
  const reference = parseImageDataUrl(body?.reference);
  const camera = parseImageDataUrl(body?.camera);
  if (!reference || !camera) return { error: "Send both pictures as small JPEG data URLs" };
  return { value: { reference, camera } };
}

// In-memory counters: enough to stop a loop or a script on one instance. The account cap
// is also what the button shows when it is reached.
export function createCoachLimiter({ perUser = COACH_PER_USER_DAY, perDay = DEFAULT_COACH_DAILY_LIMIT } = {}) {
  let day = null;
  let total = 0;
  const byUser = new Map();
  return {
    take(userId, now = new Date()) {
      const today = now.toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        total = 0;
        byUser.clear();
      }
      const used = byUser.get(userId) ?? 0;
      if (used >= perUser) return { ok: false, reason: "user" };
      if (total >= perDay) return { ok: false, reason: "day" };
      byUser.set(userId, used + 1);
      total += 1;
      return { ok: true, left: perUser - used - 1 };
    },
  };
}

export function dailyLimitFrom(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_COACH_DAILY_LIMIT;
}

export async function coachShot({ reference, camera, apiKey, model, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || DEFAULT_COACH_MODEL,
      // Opus 5.5 always thinks; low effort keeps it short, and the room above the JSON
      // is for that thinking (it filled a 200-token cap on its own in the first test).
      max_tokens: 4000,
      output_config: { effort: COACH_EFFORT },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: reference.mediaType, data: reference.data } },
          { type: "image", source: { type: "base64", media_type: camera.mediaType, data: camera.data } },
          { type: "text", text: coachPrompt() },
        ],
      }],
    }),
  });
  if (!response.ok) throw new Error(`coach request failed: ${response.status}`);
  const payload = await response.json();
  const text = (payload?.content ?? []).filter((part) => part?.type === "text").map((part) => part.text).join("");
  return { coach: parseCoach(text), usage: payload?.usage ?? null, model: payload?.model ?? model };
}
