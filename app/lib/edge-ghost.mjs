// The edge ghost (#51): the film frame's outlines, not the frame, over the live camera.
//
// A faint photo is hard to line up: at 50% the frame and the street blur into one grey.
// Outlines are not. A roofline, a window edge and the horizon drawn as one bright line can
// be laid on the camera's own and seen to match, which is what lining up a shot is.
//
// Sobel on the luminance, computed once per frame on a downscaled copy, in plain JS: no
// shader, no OpenCV in the bundle. A 640-pixel frame is ~300k pixels and takes a few
// milliseconds; the camera never goes through it, only the still frame does.

// The longest side the edge map is computed at. Enough for building lines to read on a
// phone; more only costs time and draws texture (brick, leaves) as noise.
export const EDGE_MAX_SIDE = 640;

// The edge colour: cyan reads against sky, brick and foliage alike, and is not the gold the
// rest of the product uses for "selected".
export const EDGE_COLOR = Object.freeze([64, 232, 255]);

// Gradient magnitude, on 0-255 luminance, below which a pixel is not an edge. Chosen on
// film frames: lower draws grain and sky noise, higher drops the soft lines of a facade.
export const EDGE_THRESHOLD = 80;

// The size to compute at, keeping the frame's shape.
export function edgeSize(width, height, maxSide = EDGE_MAX_SIDE) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return null;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

// RGBA in, RGBA out: edge pixels in EDGE_COLOR, the rest fully transparent, so the camera
// shows through everywhere but the lines. The border row and column have no full
// neighbourhood and stay transparent.
export function sobelEdges(rgba, width, height, { threshold = EDGE_THRESHOLD, color = EDGE_COLOR } = {}) {
  const out = new Uint8ClampedArray(width * height * 4);
  if (!rgba || width < 3 || height < 3 || rgba.length < width * height * 4) return out;

  const luma = new Float32Array(width * height);
  for (let i = 0, p = 0; i < luma.length; i += 1, p += 4) {
    luma[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }

  const [r, g, b] = color;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const tl = luma[i - width - 1], t = luma[i - width], tr = luma[i - width + 1];
      const l = luma[i - 1], rr = luma[i + 1];
      const bl = luma[i + width - 1], bm = luma[i + width], br = luma[i + width + 1];
      const gx = (tr + 2 * rr + br) - (tl + 2 * l + bl);
      const gy = (bl + 2 * bm + br) - (tl + 2 * t + tr);
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      if (magnitude < threshold) continue;
      const p = i * 4;
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      // Stronger edges are more opaque, so the main lines lead and texture recedes.
      out[p + 3] = Math.min(255, Math.round(140 + (magnitude - threshold) * 0.6));
    }
  }
  return out;
}
