"use client";

import { useRef, useState } from "react";

import { clampReveal, revealFromPointer, revealLabel } from "../lib/then-now-wipe.mjs";

// The film frame laid over today's photo, cut at a divider the reader drags (#57).
//
// Pointer drags move the divider from anywhere on the image; the range input under it
// carries keyboard and screen-reader control (arrows, Home/End, PageUp/PageDown come
// free with a native range). The input takes no pointer events, so a vertical swipe
// still scrolls the sheet and a horizontal one moves the divider.
//
// A mouse click jumps the divider to the click. A touch does not: the browser has not
// yet decided whether it is a scroll, and a scroll that started on the image should not
// move the divider. A touch moves it only once it moves sideways (a scroll cancels).
export function ThenNowWipe({ thenSrc, thenAlt, nowSrc, nowAlt, nowSrcSet, nowSizes, onThenError, onNowError }) {
  const [reveal, setReveal] = useState(50);
  const frameRef = useRef(null);
  const dragging = useRef(false);

  const moveTo = (event) => {
    const box = frameRef.current?.getBoundingClientRect();
    if (box) setReveal(revealFromPointer(event.clientX, box));
  };

  return (
    <div
      className="then-now-wipe"
      ref={frameRef}
      style={{ "--reveal": `${reveal}%` }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        dragging.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (event.pointerType === "mouse") moveTo(event);
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        // A lost pointerup (a context menu, a window switch) must not leave the
        // divider following a plain hover.
        if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
          dragging.current = false;
          return;
        }
        moveTo(event);
      }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      <img
        className="then-now-now"
        src={nowSrc}
        srcSet={nowSrcSet}
        sizes={nowSizes}
        alt={nowAlt}
        draggable={false}
        onError={onNowError}
      />
      <img
        className="then-now-then"
        src={thenSrc}
        alt={thenAlt}
        draggable={false}
        onError={onThenError}
      />
      <span className="then-now-tag is-then" aria-hidden="true">Then</span>
      <span className="then-now-tag is-now" aria-hidden="true">Now</span>
      <input
        className="then-now-range"
        type="range"
        min="0"
        max="100"
        step="1"
        value={reveal}
        aria-label="Wipe between the film frame and the place today"
        aria-valuetext={revealLabel(reveal)}
        onChange={(event) => setReveal(clampReveal(event.target.value))}
      />
      <span className="then-now-divider" aria-hidden="true">
        <span className="then-now-handle" />
      </span>
    </div>
  );
}
