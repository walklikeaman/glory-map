"use client";

// One voice for everything the guide says while walking (#190).
//
// Both walks need the same four things, and the second copy of any of them is where
// the two would drift apart:
//
//   * an unlock that happens INSIDE a tap, on the one audio element every telling then
//     reuses — iOS allows playback only from an element first played in a gesture, so
//     a new Audio() per telling is blocked, with nothing left to tap;
//   * the text turned into speech through /api/narration, which caches by text;
//   * one telling at a time;
//   * nothing that fails turned into a retry loop at somebody's ear.
//
// `say` while already speaking keeps the NEWEST request and drops older waiting ones: a
// walker who arrived at two stops during one telling wants the one they are standing
// at, not a backlog read out in order behind them.

import { useCallback, useEffect, useRef, useState } from "react";

import { keptWalkClip } from "../lib/keep-the-walk.mjs";
import { narrationUrl, startStreamedAudio } from "../lib/narration-stream.mjs";

const SILENCE = "/silence.mp3";

export default function useTellingPlayer({ gapMs = 0 } = {}) {
  const [state, setState] = useState("locked");
  const [current, setCurrent] = useState(null);

  const audioRef = useRef(null);
  const abortRef = useRef(null);
  const objectUrlRef = useRef("");
  const busyRef = useRef(false);
  const quietUntilRef = useRef(0);
  const pendingRef = useRef(null);
  const playRef = useRef(null);

  const releaseClip = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = "";
  }, []);

  const finish = useCallback(() => {
    busyRef.current = false;
    quietUntilRef.current = Date.now() + gapMs;
    releaseClip();
    setCurrent(null);
    setState((value) => (value === "locked" ? value : "ready"));
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next) playRef.current?.(next);
  }, [gapMs, releaseClip]);

  const play = useCallback(async ({ text, meta = null, resolveText = null }) => {
    busyRef.current = true;
    setCurrent(meta);
    setState("preparing");

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const spoken = text ?? (resolveText ? await resolveText(controller.signal) : null);
      if (!spoken) { finish(); return; }
      // A walk kept for offline holds its stops' clips (#70): played from the phone, with
      // or without a signal, and the server is not asked again.
      let blob = await keptWalkClip(typeof caches === "undefined" ? null : caches, spoken);
      // Otherwise streamed (#65): the walker hears the first words while the rest is still
      // being spoken. A stream that does not start falls through to the whole clip.
      const streamUrl = blob ? null : narrationUrl({ text: spoken, profileId: "neutral" });
      if (streamUrl && audioRef.current) {
        const audio = audioRef.current;
        releaseClip();
        audio.onended = finish;
        audio.onerror = null;
        try {
          await startStreamedAudio(audio, streamUrl);
          if (controller.signal.aborted) return;
          audio.onerror = finish;
          setState("speaking");
          return;
        } catch {
          if (controller.signal.aborted) return;
          audio.onended = null;
          audio.pause();
        }
      }
      if (!blob) {
        const response = await fetch("/api/narration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: spoken, profileId: "neutral" }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`narration ${response.status}`);
        blob = await response.blob();
      }
      const audio = audioRef.current;
      if (!audio || controller.signal.aborted) return;
      releaseClip();
      objectUrlRef.current = URL.createObjectURL(blob);
      audio.src = objectUrlRef.current;
      audio.onended = finish;
      audio.onerror = finish;
      setState("speaking");
      await audio.play();
    } catch (error) {
      if (error?.name === "AbortError") return;
      // Not retried: the walker has moved on, and a retry loop at one spot is worse
      // than one silence.
      finish();
    }
  }, [finish, releaseClip]);

  useEffect(() => { playRef.current = play; }, [play]);

  // Must be called from inside a tap handler, synchronously. That is the whole point.
  const unlock = useCallback(() => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    // Left over from a previous walk, these would treat the silent clip's end as a
    // telling finishing and start a quiet gap before anything was said.
    audio.onended = null;
    audio.onerror = null;
    audio.src = SILENCE;
    audio.play().catch(() => {});
    busyRef.current = false;
    quietUntilRef.current = 0;
    pendingRef.current = null;
    setState("ready");
  }, []);

  // `text` when the words are already known; `resolveText(signal)` when they have to be
  // fetched first — the fetch then counts as part of the telling, so nothing else can
  // start while it is under way.
  const say = useCallback((request) => {
    if (!audioRef.current) return false;
    if (busyRef.current) { pendingRef.current = request; return true; }
    play(request);
    return true;
  }, [play]);

  const skip = useCallback(() => {
    abortRef.current?.abort();
    audioRef.current?.pause();
    finish();
  }, [finish]);

  const stop = useCallback(() => {
    pendingRef.current = null;
    abortRef.current?.abort();
    audioRef.current?.pause();
    busyRef.current = false;
    releaseClip();
    setCurrent(null);
    setState("locked");
  }, [releaseClip]);

  useEffect(() => () => {
    abortRef.current?.abort();
    audioRef.current?.pause();
    releaseClip();
  }, [releaseClip]);

  return {
    state,
    current,
    unlock,
    say,
    skip,
    stop,
    // Read by the ambient picker on every fix, so they are refs rather than state.
    isBusy: () => busyRef.current,
    quietUntil: () => quietUntilRef.current,
  };
}
