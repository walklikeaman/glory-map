// The story trail as a timeline (#75): a slider over the scenes, in the order the story
// tells them, that moves the map to the scene under the thumb.
//
// **It cannot be dragged past the reader's progress, and that needs no rule of its own.**
// A scene the reader has not reached arrives from /api/scenes as a placeholder with no
// place and no coordinates, so it never becomes a stop, so it is never on the slider.
// Showing the whole trail is the reader's own switch, and only then do later scenes appear.

export function scrubStops(stops) {
  return [...(Array.isArray(stops) ? stops : [])]
    .filter((stop) => Array.isArray(stop?.position) && Number.isFinite(stop.sequence_index))
    .sort((a, b) => a.sequence_index - b.sequence_index);
}

// The slider's value is a position in that list, so a stale value from a longer trail
// (the reader switched the spoiler toggle off) lands on the last stop, not on nothing.
export function scrubIndex(value, length) {
  if (!length) return 0;
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 0;
  return Math.min(Math.max(number, 0), length - 1);
}

// What the screen reader hears and the caption says: where we are in the story, and where.
export function scrubLabel(stop, index, total) {
  if (!stop) return "";
  return `${index + 1} of ${total} · scene ${stop.sequence_index} · ${stop.place ?? "an unnamed place"}`;
}
