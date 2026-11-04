// The "film frame | my photo" share card (#54): two halves side by side over a strip
// that says what the picture is and whose frame the left half is.
//
// Pure layout, so the numbers are testable without a canvas. The browser draws it.

// The same object-fit: cover crop the live-camera overlay uses.
import { coverCrop } from "./shot-sync.mjs";

export { coverCrop };

export const DIPTYCH = Object.freeze({
  width: 1200,
  panelHeight: 630,
  footerHeight: 120,
  gap: 8,
});

// Where each half and the footer go on the card.
export function diptychLayout(spec = DIPTYCH) {
  const panelWidth = (spec.width - spec.gap) / 2;
  return {
    width: spec.width,
    height: spec.panelHeight + spec.footerHeight,
    then: { x: 0, y: 0, width: panelWidth, height: spec.panelHeight },
    now: { x: panelWidth + spec.gap, y: 0, width: panelWidth, height: spec.panelHeight },
    footer: { x: 0, y: spec.panelHeight, width: spec.width, height: spec.footerHeight },
  };
}

// What the footer and the share sheet say. The left half is somebody else's picture, so
// it is credited on the card itself, where a re-post cannot drop it (#54).
// Who made the left half, judged from where it came from: a visitor's shot, a TMDB
// frame, or anything else (credited generically rather than to the wrong owner).
export function referenceSource({ referenceLabel, thenSrc } = {}) {
  if (typeof referenceLabel === "string" && /visitor/i.test(referenceLabel)) return "visitor";
  try {
    if (/(^|\.)tmdb\.org$/i.test(new URL(thenSrc).hostname)) return "tmdb";
  } catch { /* a relative or blob URL is not TMDB */ }
  return "other";
}

const CREDITS = {
  visitor: "Left: a visitor's photo shared on GloryMap",
  tmdb: "Left: film frame via TMDB, shown for personal, non-commercial comparison",
  other: "Left: reference image, shown for personal, non-commercial comparison",
};

export function diptychText({ film, place, referenceLabel, kind, thenSrc } = {}) {
  const title = [film, place].filter(Boolean).join(" · ") || "Then and now";
  const source = referenceSource({ referenceLabel, thenSrc });
  const visitor = source === "visitor";
  return {
    title,
    thenTag: visitor ? "Their shot" : "Then",
    nowTag: "Now · my photo",
    credit: CREDITS[source],
    shareText: film
      ? `I stood where ${film} ${kind === "book" ? "is set" : "was filmed"}${place ? `: ${place}` : ""}.`
      : `Then and now${place ? `: ${place}` : ""}.`,
  };
}

// A file name a phone will keep: letters, digits and hyphens only.
export function diptychFileName({ film, place } = {}) {
  const base = [film, place].filter(Boolean).join(" ")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${base || "then-and-now"}-glorymap.jpg`;
}
