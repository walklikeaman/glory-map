// The "then / now" wipe on a place card (#57): the matched film frame laid over the
// photo of the place today, with a divider the reader drags across.
//
// A wipe needs two images. With one, there is nothing to wipe between, so the card
// keeps the side-by-side pair (which already says which half is missing and why).

// Both halves present and neither known to be broken. A broken URL is as good as
// none: a wipe over a broken image shows half a picture and half an error icon.
export function wipeMode({ thenUrl, nowUrl, broken } = {}) {
  const usable = (url) => typeof url === "string" && url.length > 0 && !broken?.has?.(url);
  return usable(thenUrl) && usable(nowUrl) ? "wipe" : "pair";
}

// The divider's position, as a whole percent of the width shown as "then".
// Anything unreadable lands in the middle, which is where the wipe starts.
export function clampReveal(value) {
  // Number(null) and Number("") are 0, which would hide the frame entirely.
  if (value === null || value === "") return 50;
  const number = Number(value);
  if (!Number.isFinite(number)) return 50;
  return Math.min(100, Math.max(0, Math.round(number)));
}

// Where a pointer is across the image, as that same percent. A zero-width box (an
// image still laying out) gives the middle rather than a division by zero.
export function revealFromPointer(clientX, rect) {
  const width = Number(rect?.width);
  if (!Number.isFinite(width) || width <= 0) return 50;
  return clampReveal(((Number(clientX) - Number(rect.left)) / width) * 100);
}

// What a screen reader hears as the slider moves.
export function revealLabel(reveal) {
  const then = clampReveal(reveal);
  if (then === 100) return "Film frame only";
  if (then === 0) return "Today's photo only";
  return `${then}% film frame, ${100 - then}% today`;
}
