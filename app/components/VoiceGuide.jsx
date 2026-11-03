"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Pause, Play, Square, Volume2 } from "lucide-react";
import { NARRATOR_PROFILES, narrationText, resolveNarrator } from "../lib/voice-guide.mjs";

// Genres by work, for the visit: the tone of a film does not change while it is open.
const genresByWork = new Map();

export default function VoiceGuide({ location, story, storyLanguage }) {
  const audioRef = useRef(null);
  const audioUrlRef = useRef("");
  const abortRef = useRef(null);
  const requestIdRef = useRef(0);
  const [supported, setSupported] = useState(null);
  // "auto" follows the work's genre (#68); any named profile overrides it, and the warm
  // guide is how somebody switches the genre tones off.
  const [profileId, setProfileId] = useState("auto");
  const [genres, setGenres] = useState([]);
  const narratorId = resolveNarrator(profileId, genres);
  const workKind = location?.kind ?? "film";
  const workTmdbId = location?.filmTmdbId ?? null;
  const [spoilerFree, setSpoilerFree] = useState(true);
  const [speechState, setSpeechState] = useState("idle");
  const [message, setMessage] = useState("");
  const text = useMemo(
    () => narrationText({ location, story, spoilerFree }),
    [location, spoilerFree, story],
  );
  // Only the tour's own story is in the tour's language; the spoiler-free line and the
  // place description are our English data, and an English text read "in French" is
  // English with an accent.
  const language = story?.trim() && text === story.trim() ? storyLanguage ?? "en" : "en";

  function releaseAudio() {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    audioRef.current = null;

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
  }

  function cancelCurrentRequest() {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    releaseAudio();
  }

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
      typeof window.Audio === "function" &&
      typeof window.URL?.createObjectURL === "function",
    );

    return () => {
      requestIdRef.current += 1;
      abortRef.current?.abort();
      releaseAudio();
    };
  }, []);

  useEffect(() => {
    cancelCurrentRequest();
    setSpeechState("idle");
    setMessage("");
  }, [location?.id, narratorId, spoilerFree, story]);

  useEffect(() => {
    if (!workTmdbId || !["film", "series"].includes(workKind)) {
      setGenres([]);
      return undefined;
    }
    const key = `${workKind}:${workTmdbId}`;
    if (genresByWork.has(key)) {
      setGenres(genresByWork.get(key));
      return undefined;
    }
    setGenres([]);
    let current = true;
    fetch(`/api/genres?kind=${encodeURIComponent(workKind)}&id=${encodeURIComponent(workTmdbId)}`)
      .then((response) => (response.ok ? response.json() : { genres: [] }))
      .then((payload) => {
        const found = Array.isArray(payload?.genres) ? payload.genres : [];
        genresByWork.set(key, found);
        if (current) setGenres(found);
      })
      // No genre is the warm guide, which is a fine way to hear a place.
      .catch(() => {});
    return () => { current = false; };
  }, [workKind, workTmdbId]);

  async function play() {
    if (!supported || !text) return;

    cancelCurrentRequest();
    const requestId = requestIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setSpeechState("loading");
    setMessage("Generating high-quality narration…");

    try {
      const response = await fetch("/api/narration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, profileId: narratorId, language }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Voice generation failed.");
      }

      const audioBlob = await response.blob();
      if (requestId !== requestIdRef.current) return;

      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audioUrlRef.current = audioUrl;
      audioRef.current = audio;
      abortRef.current = null;

      audio.onended = () => {
        if (requestId !== requestIdRef.current) return;
        releaseAudio();
        setSpeechState("idle");
        setMessage("Narration finished.");
      };
      audio.onerror = () => {
        if (requestId !== requestIdRef.current) return;
        releaseAudio();
        setSpeechState("idle");
        setMessage("Audio playback failed. You can still read the story above.");
      };

      await audio.play();
      if (requestId !== requestIdRef.current) return;
      setSpeechState("playing");
      setMessage("");
    } catch (error) {
      if (error?.name === "AbortError" || requestId !== requestIdRef.current) return;
      releaseAudio();
      abortRef.current = null;
      setSpeechState("idle");
      setMessage(error?.message || "Voice generation failed. Try again.");
    }
  }

  async function togglePause() {
    const audio = audioRef.current;
    if (!audio) return;

    if (speechState === "playing") {
      audio.pause();
      setSpeechState("paused");
      setMessage("Narration paused.");
      return;
    }

    if (speechState === "paused") {
      try {
        await audio.play();
        setSpeechState("playing");
        setMessage("");
      } catch {
        setMessage("Press Play again to continue narration.");
      }
    }
  }

  function stop() {
    if (!supported) return;
    cancelCurrentRequest();
    setSpeechState("idle");
    setMessage("Narration stopped.");
  }

  if (supported === false) {
    return (
      <section className="voice-guide is-unavailable" aria-label="Voice guide">
        <Volume2 size={18} />
        <span>Audio playback is not supported in this browser. The story remains available above.</span>
      </section>
    );
  }

  return (
    <section className="voice-guide" aria-label="Voice guide">
      <div className="voice-guide-heading">
        <span><Volume2 size={18} /> Voice guide</span>
        <label className="spoiler-toggle">
          <input
            type="checkbox"
            checked={spoilerFree}
            onChange={(event) => setSpoilerFree(event.target.checked)}
          />
          Spoiler-free
        </label>
      </div>
      <label className="narrator-select">
        <span>Narrator</span>
        <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
          <option value="auto">Match the work · {NARRATOR_PROFILES[resolveNarrator("auto", genres)].label}</option>
          {Object.entries(NARRATOR_PROFILES).map(([id, profile]) => (
            <option key={id} value={id}>{profile.label}</option>
          ))}
        </select>
      </label>
      <div className="voice-controls">
        <button type="button" onClick={play} disabled={supported !== true || speechState !== "idle"}>
          {speechState === "loading" ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}
          {speechState === "loading" ? "Generating" : "Play"}
        </button>
        <button type="button" onClick={togglePause} disabled={!["playing", "paused"].includes(speechState)}>
          {speechState === "paused" ? <Play size={15} /> : <Pause size={15} />}
          {speechState === "paused" ? "Resume" : "Pause"}
        </button>
        <button type="button" onClick={stop} disabled={speechState === "idle"}>
          <Square size={14} /> Stop
        </button>
      </div>
      <p className="voice-status" aria-live="polite">
        {message || (speechState === "playing" ? `Playing as ${NARRATOR_PROFILES[narratorId].label.toLowerCase()}.` : "Ready to stream an AI-generated original recap.")}
      </p>
    </section>
  );
}
