// ShotSync (#50): the film frame as a ghost over the live camera.
//
// Everything here is pure so it can be tested without a browser: whether a camera can be
// asked for at all, what to say when the browser refuses, the gesture maths for moving
// the ghost, and the geometry that makes the saved photo match what was on screen. The
// component (ShotSync.jsx) only performs it.
//
// The geometry rule that matters: the screen shows the video with `object-fit: cover` and
// the ghost "contained" in the same box, then moved by the user's transform. The snapshot
// has to draw exactly that, at the camera's own resolution, or the photo someone lined up
// on screen comes out shifted in the file.

export const OPACITY_DEFAULT = 55;
export const SCALE_MIN = 0.25;
export const SCALE_MAX = 6;

export const IDENTITY = Object.freeze({ x: 0, y: 0, scale: 1, rotation: 0 });

// The constraints asked for. `ideal`, not `exact`: a laptop has no rear camera, and an
// exact facingMode fails there with OverconstrainedError instead of using the one it has.
export const CAMERA_CONSTRAINTS = Object.freeze({
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
});

// Can this page ask for a camera at all? Checked before the button, so the person is not
// sent through a permission prompt that cannot succeed.
export function cameraSupport({ navigator: nav, isSecureContext } = {}) {
  if (isSecureContext === false) {
    return { ok: false, reason: "insecure" };
  }
  if (typeof nav?.mediaDevices?.getUserMedia !== "function") {
    return { ok: false, reason: "unsupported" };
  }
  return { ok: true, reason: null };
}

const MESSAGES = {
  insecure: "The camera only opens on a secure (https) page.",
  unsupported:
    "This browser can't open the camera here. In-app browsers often block it, so try Safari or Chrome.",
  denied:
    "Camera access is off for this site. Allow it in the browser's site settings, then try again.",
  missing: "No camera was found on this device.",
  busy: "The camera is in use by another app. Close it and try again.",
  failed: "The camera didn't start. Try again, or upload a photo instead.",
};

// getUserMedia rejects with a DOMException whose `name` says why. Map it to one sentence a
// person can act on; anything unknown gets the generic one rather than a raw error.
export function cameraErrorReason(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "missing";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "busy";
    default:
      return "failed";
  }
}

export function cameraMessage(reason) {
  return MESSAGES[reason] ?? MESSAGES.failed;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clampScale(scale) {
  return Number.isNaN(scale) || typeof scale !== "number" ? 1 : clamp(scale, SCALE_MIN, SCALE_MAX);
}

// Wrap to (-180, 180] so repeated twists do not grow the number without bound.
export function normalizeDegrees(degrees) {
  if (!Number.isFinite(degrees)) return 0;
  const wrapped = ((degrees % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function span(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function angle(a, b) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

// One gesture step. `start` is the transform when the fingers went down, `from` and `to`
// are the pointer positions then and now (one pointer drags; two also pinch and twist).
// Working from the gesture's start instead of the last frame keeps rounding from creeping.
export function gestureTransform(start, from, to) {
  const base = { ...IDENTITY, ...start };
  if (!Array.isArray(from) || !Array.isArray(to) || from.length === 0 || from.length !== to.length) {
    return base;
  }

  if (from.length === 1) {
    return {
      ...base,
      x: base.x + (to[0].x - from[0].x),
      y: base.y + (to[0].y - from[0].y),
    };
  }

  const [a0, b0] = from;
  const [a1, b1] = to;
  const m0 = midpoint(a0, b0);
  const m1 = midpoint(a1, b1);
  const startSpan = span(a0, b0);
  const ratio = startSpan > 0 ? span(a1, b1) / startSpan : 1;

  return {
    x: base.x + (m1.x - m0.x),
    y: base.y + (m1.y - m0.y),
    scale: clampScale(base.scale * ratio),
    rotation: normalizeDegrees(base.rotation + (angle(a1, b1) - angle(a0, b0))),
  };
}

// A mouse wheel or trackpad pinch on desktop: zoom in small steps.
export function wheelTransform(transform, deltaY) {
  const base = { ...IDENTITY, ...transform };
  if (!Number.isFinite(deltaY) || deltaY === 0) return base;
  return { ...base, scale: clampScale(base.scale * Math.exp(-deltaY * 0.0015)) };
}

export function transformCss(transform) {
  const t = { ...IDENTITY, ...transform };
  return `translate(${t.x}px, ${t.y}px) rotate(${t.rotation}deg) scale(${t.scale})`;
}

// The part of a source (w × h) that `object-fit: cover` shows in a box of the given aspect.
export function coverCrop(sourceWidth, sourceHeight, boxWidth, boxHeight) {
  const sourceAspect = sourceWidth / sourceHeight;
  const boxAspect = boxWidth / boxHeight;
  if (sourceAspect > boxAspect) {
    const width = sourceHeight * boxAspect;
    return { sx: (sourceWidth - width) / 2, sy: 0, sw: width, sh: sourceHeight };
  }
  const height = sourceWidth / boxAspect;
  return { sx: 0, sy: (sourceHeight - height) / 2, sw: sourceWidth, sh: height };
}

// The size an image takes when "contained" in a box: whole frame visible, centred.
export function containSize(imageWidth, imageHeight, boxWidth, boxHeight) {
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
  return { width: imageWidth * scale, height: imageHeight * scale };
}

// The geometry of the saved photo. The output keeps the camera's resolution for the part
// the screen showed; `k` turns on-screen pixels into output pixels, so the ghost lands
// where it was lined up. Returns null when any size is still unknown (video not ready).
export function snapshotLayout({ video, stage, frame, transform }) {
  const sizes = [video?.width, video?.height, stage?.width, stage?.height, frame?.width, frame?.height];
  if (!sizes.every((n) => Number.isFinite(n) && n > 0)) return null;

  const crop = coverCrop(video.width, video.height, stage.width, stage.height);
  const width = Math.round(crop.sw);
  const height = Math.round(crop.sh);
  const k = width / stage.width;
  const t = { ...IDENTITY, ...transform };
  const ghost = containSize(frame.width, frame.height, stage.width, stage.height);

  return {
    width,
    height,
    crop,
    ghost: {
      centerX: width / 2 + t.x * k,
      centerY: height / 2 + t.y * k,
      rotation: (t.rotation * Math.PI) / 180,
      scale: t.scale,
      width: ghost.width * k,
      height: ghost.height * k,
    },
  };
}

// The saved file's name: the work and the place, safe for any file system.
export function snapshotFileName({ film, place } = {}, kind = "recreation") {
  const slug = [film, place]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `glorymap-${slug || "shot"}-${kind}.jpg`;
}
