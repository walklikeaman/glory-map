import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMERA_CONSTRAINTS,
  IDENTITY,
  SCALE_MAX,
  SCALE_MIN,
  cameraErrorReason,
  cameraMessage,
  cameraSupport,
  clampScale,
  containSize,
  coverCrop,
  gestureTransform,
  normalizeDegrees,
  snapshotFileName,
  snapshotLayout,
  transformCss,
  wheelTransform,
} from "../app/lib/shot-sync.mjs";

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} ≉ ${expected}`);

test("asks for the rear camera without failing where there is none", () => {
  assert.deepEqual(CAMERA_CONSTRAINTS.video.facingMode, { ideal: "environment" });
  assert.equal(CAMERA_CONSTRAINTS.audio, false);
});

test("a page that cannot ask for the camera says why before the prompt", () => {
  const mediaDevices = { getUserMedia() {} };
  assert.deepEqual(cameraSupport({ navigator: { mediaDevices }, isSecureContext: true }), { ok: true, reason: null });
  assert.equal(cameraSupport({ navigator: { mediaDevices }, isSecureContext: false }).reason, "insecure");
  assert.equal(cameraSupport({ navigator: {}, isSecureContext: true }).reason, "unsupported");
  assert.equal(cameraSupport({}).reason, "unsupported");
});

test("every getUserMedia refusal becomes a sentence a person can act on", () => {
  assert.equal(cameraErrorReason({ name: "NotAllowedError" }), "denied");
  assert.equal(cameraErrorReason({ name: "NotFoundError" }), "missing");
  assert.equal(cameraErrorReason({ name: "OverconstrainedError" }), "missing");
  assert.equal(cameraErrorReason({ name: "NotReadableError" }), "busy");
  assert.equal(cameraErrorReason(new Error("boom")), "failed");
  assert.equal(cameraErrorReason(undefined), "failed");
  for (const reason of ["insecure", "unsupported", "denied", "missing", "busy", "failed", "nonsense"]) {
    assert.match(cameraMessage(reason), /\w+.*\./);
  }
  assert.equal(cameraMessage("nonsense"), cameraMessage("failed"));
});

test("one finger drags the ghost", () => {
  const next = gestureTransform(IDENTITY, [{ x: 10, y: 10 }], [{ x: 40, y: -5 }]);
  assert.deepEqual(next, { x: 30, y: -15, scale: 1, rotation: 0 });
});

test("two fingers pinch, twist and move together", () => {
  const from = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  // Spread to twice the distance, turned a quarter, midpoint moved by (10, 20).
  const to = [{ x: 60, y: -80 }, { x: 60, y: 120 }];
  const next = gestureTransform({ x: 5, y: 5, scale: 1.5, rotation: 10 }, from, to);
  close(next.x, 5 + (60 - 50));
  close(next.y, 5 + (20 - 0));
  close(next.scale, 3);
  close(next.rotation, 100);
});

test("a pinch cannot shrink the ghost to nothing or blow it up without bound", () => {
  const from = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  assert.equal(gestureTransform(IDENTITY, from, [{ x: 0, y: 0 }, { x: 1, y: 0 }]).scale, SCALE_MIN);
  assert.equal(gestureTransform(IDENTITY, from, [{ x: 0, y: 0 }, { x: 10000, y: 0 }]).scale, SCALE_MAX);
  assert.equal(clampScale(Number.NaN), 1);
});

test("a gesture with mismatched pointers changes nothing", () => {
  const start = { x: 3, y: 4, scale: 2, rotation: 5 };
  assert.deepEqual(gestureTransform(start, [{ x: 0, y: 0 }], []), start);
  assert.deepEqual(gestureTransform(start, null, null), start);
});

test("rotation wraps instead of growing forever", () => {
  assert.equal(normalizeDegrees(190), -170);
  assert.equal(normalizeDegrees(-190), 170);
  assert.equal(normalizeDegrees(720), 0);
  assert.equal(normalizeDegrees(180), 180);
  assert.equal(normalizeDegrees(Number.NaN), 0);
});

test("the wheel zooms in small, bounded steps", () => {
  assert.ok(wheelTransform(IDENTITY, -100).scale > 1);
  assert.ok(wheelTransform(IDENTITY, 100).scale < 1);
  assert.equal(wheelTransform(IDENTITY, 0).scale, 1);
  assert.equal(wheelTransform(IDENTITY, -1e6).scale, SCALE_MAX);
});

test("the CSS applies translate, then rotate, then scale — the order the snapshot draws in", () => {
  assert.equal(
    transformCss({ x: 12, y: -4, scale: 1.25, rotation: -8 }),
    "translate(12px, -4px) rotate(-8deg) scale(1.25)",
  );
});

test("cover crops the wider side, centred", () => {
  // A landscape 1920×1080 camera shown in a portrait 300×400 box.
  const crop = coverCrop(1920, 1080, 300, 400);
  close(crop.sh, 1080);
  close(crop.sw, 810);
  close(crop.sx, (1920 - 810) / 2);
  assert.equal(crop.sy, 0);
  // A portrait camera in a landscape box crops top and bottom.
  const tall = coverCrop(1080, 1920, 400, 300);
  close(tall.sw, 1080);
  close(tall.sh, 810);
  close(tall.sy, (1920 - 810) / 2);
});

test("contain keeps the whole frame visible", () => {
  assert.deepEqual(containSize(1600, 900, 300, 400), { width: 300, height: 168.75 });
  assert.deepEqual(containSize(900, 1600, 400, 300), { width: 168.75, height: 300 });
});

test("the saved photo puts the ghost where it was lined up on screen", () => {
  const layout = snapshotLayout({
    video: { width: 1920, height: 1080 },
    stage: { width: 300, height: 400 },
    frame: { width: 1600, height: 900 },
    transform: { x: 30, y: -20, scale: 2, rotation: 90 },
  });
  // Output keeps the camera's own pixels for the visible part: 810 × 1080.
  assert.equal(layout.width, 810);
  assert.equal(layout.height, 1080);
  const k = 810 / 300;
  close(layout.ghost.centerX, 405 + 30 * k);
  close(layout.ghost.centerY, 540 - 20 * k);
  close(layout.ghost.width, 300 * k);
  close(layout.ghost.height, 168.75 * k);
  close(layout.ghost.rotation, Math.PI / 2);
  assert.equal(layout.ghost.scale, 2);
});

test("no layout until the camera reports its size", () => {
  const base = { stage: { width: 300, height: 400 }, frame: { width: 1, height: 1 }, transform: IDENTITY };
  assert.equal(snapshotLayout({ ...base, video: { width: 0, height: 0 } }), null);
  assert.equal(snapshotLayout({}), null);
});

test("file names are safe and say what the photo is of", () => {
  assert.equal(
    snapshotFileName({ film: "Amélie", place: "Café des 2 Moulins, Paris" }),
    "glorymap-amelie-cafe-des-2-moulins-paris-recreation.jpg",
  );
  assert.equal(snapshotFileName({}, "photo"), "glorymap-shot-photo.jpg");
});
