"use client";

import { useEffect, useState } from "react";
import { Camera, Clapperboard } from "lucide-react";

import { getSupabaseBrowserClient } from "../lib/supabase-browser.mjs";
import { SHOT_MAX_BYTES, SHOT_MIME, SHOTS_BUCKET, fitWithin, shotPathFor, shotStatusLabel } from "../lib/place-shots.mjs";

async function accessToken() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

// Re-draw the photo through a canvas: it brings the size down and, as a side effect
// that matters, drops EXIF, GPS included.
async function reencode(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const size = fitWithin(bitmap.width, bitmap.height);
  if (!size) throw new Error("That image could not be read.");
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close?.();
  for (const quality of [0.86, 0.75, 0.6]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, SHOT_MIME, quality));
    if (blob && blob.size <= SHOT_MAX_BYTES) return blob;
  }
  throw new Error("That photo is too large to share.");
}

// Upload to the private bucket under the reader's own folder, then record it. Returns
// the shot's state as the server decided it: approved, pending or rejected.
export async function shareShot({ file, userId, placeKey, placeName, workKey, kind, referenceUrl }) {
  const supabase = getSupabaseBrowserClient();
  const token = await accessToken();
  if (!supabase || !token) throw new Error("Sign in to share a shot.");
  const path = shotPathFor(userId, crypto.randomUUID());
  if (!path) throw new Error("Sign in to share a shot.");

  const blob = await reencode(file);
  const { error: uploadError } = await supabase.storage.from(SHOTS_BUCKET).upload(path, blob, {
    contentType: SHOT_MIME,
    upsert: false,
  });
  if (uploadError) throw new Error("The upload failed. Try again in a moment.");

  let response;
  try {
    response = await fetch("/api/shots", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ placeKey, placeName, workKey, kind, referenceUrl, storagePath: path }),
    });
  } catch {
    response = null;
  }
  const payload = response ? await response.json().catch(() => ({})) : {};
  if (!response?.ok) {
    // No row points at the file, so it is removed rather than left in storage.
    await supabase.storage.from(SHOTS_BUCKET).remove([path]).catch(() => {});
    throw new Error(payload.error || "The shot could not be saved.");
  }
  return payload.shot;
}

export function shareResultMessage(shot) {
  if (shot?.status === "approved") return "Shared. Your shot is on this place now.";
  if (shot?.status === "rejected") return `Not shared: ${shot.reason ?? "the check turned it down."}`;
  return "Saved. Only you can see it until the check is done.";
}

// The strip of visitors' shots on a place card. Each one can be recreated in turn.
// It renders nothing at all when shots are not configured, so a deployment without the
// table looks exactly as it did.
export function VisitorShots({ placeKey, signedIn, refreshKey = 0, onRecreate, onAdd }) {
  const [state, setState] = useState({ placeKey: null, shots: [], available: false });

  useEffect(() => {
    if (!placeKey) return undefined;
    const controller = new AbortController();
    (async () => {
      try {
        const token = signedIn ? await accessToken() : null;
        const response = await fetch(`/api/shots?${new URLSearchParams({ place: placeKey })}`, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
        if (!response.ok) {
          setState({ placeKey, shots: [], available: false });
          return;
        }
        const payload = await response.json();
        setState({ placeKey, shots: Array.isArray(payload.shots) ? payload.shots : [], available: true });
      } catch (error) {
        if (error?.name !== "AbortError") setState({ placeKey, shots: [], available: false });
      }
    })();
    return () => controller.abort();
  }, [placeKey, signedIn, refreshKey]);

  if (state.placeKey !== placeKey || !state.available) return null;

  return (
    <section className="visitor-shots" aria-label="Visitors' shots of this place">
      <div className="visitor-shots-heading">
        <strong>Visitors&rsquo; shots</strong>
        {state.shots.length > 0 && <span>{state.shots.length}</span>}
        <button className="ghost-button visitor-shots-add" onClick={onAdd} type="button">
          <Camera size={15} aria-hidden="true" />
          Add your shot
        </button>
      </div>
      {state.shots.length === 0 ? (
        <p className="visitor-shots-empty">No shots yet. Be the first to share how it looks today.</p>
      ) : (
        <div className="visitor-shots-list">
          {state.shots.map((shot) => (
            <figure key={shot.id}>
              <img src={shot.url} alt={shot.caption ?? "A visitor's photo of this place"} loading="lazy" />
              <figcaption>
                {shotStatusLabel(shot) && <span className="visitor-shot-status">{shotStatusLabel(shot)}</span>}
                {shot.caption && <span>{shot.caption}</span>}
                <button className="visitor-shot-recreate" onClick={() => onRecreate(shot)} type="button">
                  <Clapperboard size={14} aria-hidden="true" />
                  Recreate
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
