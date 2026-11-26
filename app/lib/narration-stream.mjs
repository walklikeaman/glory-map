// Narration that starts while it is still being spoken (#65).
//
// /api/narration answered a POST with the whole clip, so the player waited for every
// byte before the first word: a few seconds of "Generating…" for each telling. The same
// route now also answers a GET, and an <audio> element pointed at a GET plays an MP3 as
// it arrives, in every browser, iPhone included, with no MediaSource code of ours. The
// POST stays for anything that wants the whole clip (keeping a walk offline) and is the
// fallback when a stream does not start.

export const NARRATION_TEXT_MAX = 600;
// How long a stream may take to make a sound before the player gives up on it and asks
// for the whole clip instead. Generous: a cold clip takes ~1–2 s to start.
export const STREAM_START_TIMEOUT_MS = 12000;

export function narrationUrl({ text, profileId = "neutral", language } = {}) {
  const spoken = typeof text === "string" ? text.trim() : "";
  if (!spoken || spoken.length > NARRATION_TEXT_MAX) return null;
  const params = new URLSearchParams({ text: spoken, profileId: String(profileId || "neutral") });
  if (language && language !== "en") params.set("language", String(language));
  return `/api/narration?${params}`;
}

// The GET's query, read back into the body the POST takes, so both run one code path.
export function narrationBodyFromUrl(url) {
  const params = new URL(url, "http://local").searchParams;
  return {
    text: params.get("text") ?? "",
    profileId: params.get("profileId") ?? "",
    language: params.get("language") ?? undefined,
  };
}

// Points `audio` at the stream and resolves once sound is coming out; rejects if the
// element errors or stays silent past the timeout, so the caller can fall back to the
// whole clip. Listeners are removed either way.
export function startStreamedAudio(audio, url, { timeoutMs = STREAM_START_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const settle = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("error", onError);
      if (ok) resolve();
      else reject(new Error("The narration stream did not start."));
    };
    const onPlaying = () => settle(true);
    const onError = () => settle(false);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("error", onError);
    timer = setTimeout(onError, timeoutMs);
    audio.src = url;
    Promise.resolve(audio.play()).catch(onError);
  });
}
