"use client";

// Listen as you walk (#190): the guide talks about what you pass, with no route chosen.
//
// The choosing, pacing and wording are in app/lib/ambient-walk.mjs, where they are
// measured and tested. This component only does the three things a browser makes hard:
//
//   * Audio must be unlocked by a tap. iOS allows playback only from an element that was
//     first played inside a user gesture, so the start button plays a silent clip on the
//     ONE <audio> element every telling then reuses. A new Audio() per telling would be
//     blocked on the first place, with nothing left to tap.
//   * The screen must stay on, or watchPosition stops firing in a pocket.
//   * The feed is re-read as the walker moves, not polled on a timer: standing still
//     costs nothing.

import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, SkipForward, Square } from "lucide-react";

import useTellingPlayer from "./useTellingPlayer.js";
import useWakeLock from "./useWakeLock.js";
import {
  QUIET_GAP_MS, feedNeedsRefresh, feedUrl, nearbyFromMapResponse, pickAmbient, tellingFor,
} from "../lib/ambient-walk.mjs";
import { hasMovedEnough, isUsableFix } from "../lib/geo-trigger.mjs";
import { ROAD_SAFETY_REMINDER } from "../lib/walk-mode.mjs";

export default function AmbientGuide({ onPlace, onListeningChange }) {
  const [listening, setListening] = useState(false);
  const [nearbyCount, setNearbyCount] = useState(null);
  const [told, setTold] = useState(0);
  const [gpsWarning, setGpsWarning] = useState(false);
  const player = useTellingPlayer({ gapMs: QUIET_GAP_MS });

  const placesRef = useRef([]);
  const feedCentreRef = useRef(null);
  const feedAbortRef = useRef(null);
  const lastFixRef = useRef(null);
  const spokenRef = useRef([]);
  const playerRef = useRef(player);
  playerRef.current = player;
  // A new arrow from the parent on every render; as a dependency of `tell` it would
  // re-create the position watch on every map move.
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;

  useWakeLock(listening);
  useEffect(() => { onListeningChange?.(listening); }, [listening, onListeningChange]);

  const tell = useCallback((place) => {
    // Recorded as told BEFORE anything is fetched: every fix that arrives while the
    // sentence is being prepared would otherwise pick the same place again.
    spokenRef.current = [...spokenRef.current, { id: place.id, position: place.position }];
    onPlaceRef.current?.(place);
    setTold((count) => count + 1);
    playerRef.current.say({
      meta: { name: place.name, checked: place.checked },
      resolveText: (signal) => tellingFor(place, { signal }),
    });
  }, []);

  const refreshFeed = useCallback(async (position) => {
    const url = feedUrl(position);
    if (!url) return;
    feedCentreRef.current = position;
    feedAbortRef.current?.abort();
    const controller = new AbortController();
    feedAbortRef.current = controller;
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return;
      placesRef.current = nearbyFromMapResponse(await response.json());
      setNearbyCount(placesRef.current.length);
    } catch {
      // Offline or a failed read keeps the last feed: the places behind the walker are
      // still true, and the service worker may still answer the next one.
    }
  }, []);

  useEffect(() => {
    if (!listening || typeof navigator === "undefined" || !navigator.geolocation) return undefined;

    const watch = navigator.geolocation.watchPosition(
      async (fix) => {
        const position = { coords: [fix.coords.latitude, fix.coords.longitude], accuracy: fix.coords.accuracy };
        if (!isUsableFix(position)) { setGpsWarning(true); return; }
        setGpsWarning(false);
        if (!hasMovedEnough(lastFixRef.current, position.coords)) return;
        lastFixRef.current = position.coords;

        if (feedNeedsRefresh(feedCentreRef.current, position.coords)) await refreshFeed(position.coords);

        // Ambient tellings are never queued: a place passed while the guide was talking
        // is behind the walker by the time it would be said.
        const hit = pickAmbient(placesRef.current, position, {
          spoken: spokenRef.current,
          busy: playerRef.current.isBusy(),
          quietUntil: playerRef.current.quietUntil(),
        });
        if (hit) tell(hit.place);
      },
      () => setGpsWarning(true),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [listening, refreshFeed, tell]);

  const start = () => {
    // Inside the tap: this is the unlock.
    player.unlock();
    spokenRef.current = [];
    feedCentreRef.current = null;
    lastFixRef.current = null;
    setTold(0);
    setNearbyCount(null);
    setListening(true);
  };

  const stop = () => {
    setListening(false);
    feedAbortRef.current?.abort();
    player.stop();
  };

  useEffect(() => () => feedAbortRef.current?.abort(), []);

  const current = player.current;
  const status = player.state;

  if (!listening) {
    return (
      <button className="walk-start ambient-start" type="button" onClick={start}>
        <Headphones size={16} />
        <span>Listen as I walk</span>
      </button>
    );
  }

  return (
    <div className="walk-active ambient-active" role="region" aria-label="Listening as you walk" aria-live="polite">
      <div className="walk-row">
        <strong>
          {current
            ? current.name ?? "A place nearby"
            : nearbyCount === null
              ? "Finding where you are…"
              : nearbyCount === 0
                ? "Nothing recorded around here"
                : `${nearbyCount} place${nearbyCount === 1 ? "" : "s"} around you`}
        </strong>
        <button aria-label="Stop listening" className="walk-stop" onClick={stop} type="button">
          <Square size={14} />
        </button>
      </div>

      {current && (
        <div className="walk-row">
          {/* The hollow pin cannot be seen while listening, so its meaning is written. */}
          <small className={current.checked ? "ambient-checked" : "ambient-unchecked"}>
            {status === "preparing" ? "Getting ready… · " : ""}
            {current.checked ? "Confirmed place" : "Reported by a source · unconfirmed"}
          </small>
          <button aria-label="Skip this place" className="walk-stop" onClick={player.skip} type="button">
            <SkipForward size={14} />
          </button>
        </div>
      )}

      {!current && (
        <small>
          {told > 0 ? `${told} told so far. ` : ""}The guide speaks when you pass within 45 m of a place.
        </small>
      )}

      {gpsWarning && (
        <small className="walk-warning">Waiting for a better GPS fix — nothing will play until then.</small>
      )}
      <small className="walk-safety">{ROAD_SAFETY_REMINDER}</small>
    </div>
  );
}
