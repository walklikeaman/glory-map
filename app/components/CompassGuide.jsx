"use client";

import { useEffect, useRef, useState } from "react";
import { Compass, Navigation2 } from "lucide-react";

import { canGuide, compassGuide, headingFromOrientation } from "../lib/compass.mjs";

// Compass guide (#52): an arrow that walks the person to the pin, then hands over to
// the camera. Uses GPS and, where the phone has one, the compass. Nothing is sent
// anywhere: positions and headings stay in this component.

const NO_COMPASS_AFTER_MS = 2500;

function screenAngle() {
  return window.screen?.orientation?.angle ?? (typeof window.orientation === "number" ? window.orientation : 0);
}

async function askOrientation() {
  // iOS 13+ asks once, and only from a tap. Newer Chrome has the same call and may answer
  // "prompt" while still sending events, so only an explicit "denied" turns the compass off.
  const request = window.DeviceOrientationEvent?.requestPermission;
  if (typeof request !== "function") return true;
  try {
    return (await request.call(window.DeviceOrientationEvent)) !== "denied";
  } catch {
    return false;
  }
}

export default function CompassGuide({ location }) {
  const [status, setStatus] = useState("idle"); // idle | locating | on | denied | unsupported
  const [fix, setFix] = useState(null);
  const [heading, setHeading] = useState(null);
  const [compass, setCompass] = useState("waiting"); // waiting | on | none
  const cleanupRef = useRef(() => {});

  useEffect(() => () => cleanupRef.current(), []);

  if (!canGuide(location)) return null;

  async function start() {
    if (!navigator.geolocation) {
      setStatus("unsupported");
      return;
    }
    setStatus("locating");
    const orientationAllowed = await askOrientation();

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setFix({
          position: [position.coords.latitude, position.coords.longitude],
          accuracy: position.coords.accuracy,
        });
        setStatus("on");
      },
      (error) => setStatus(error?.code === 1 ? "denied" : "unsupported"),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );

    let seen = false;
    const onOrientation = (event) => {
      const value = headingFromOrientation(event, screenAngle());
      if (value === null) return;
      seen = true;
      setCompass("on");
      setHeading(value);
    };
    // Chrome on Android sends north-based readings only on the "absolute" event.
    const events = orientationAllowed ? ["deviceorientationabsolute", "deviceorientation"] : [];
    events.forEach((name) => window.addEventListener(name, onOrientation));
    const timer = window.setTimeout(() => { if (!seen) setCompass("none"); }, NO_COMPASS_AFTER_MS);
    if (!orientationAllowed) setCompass("none");

    cleanupRef.current = () => {
      navigator.geolocation.clearWatch(watchId);
      events.forEach((name) => window.removeEventListener(name, onOrientation));
      window.clearTimeout(timer);
    };
  }

  function stop() {
    cleanupRef.current();
    cleanupRef.current = () => {};
    setStatus("idle");
    setFix(null);
    setHeading(null);
    setCompass("waiting");
  }

  if (status === "idle") {
    return (
      <div className="compass-guide is-idle">
        <button className="ghost-button" onClick={start} type="button">
          <Compass size={18} />
          Guide me to the spot
        </button>
        <span className="shotsync-note">Uses your location and compass. Nothing leaves this device.</span>
      </div>
    );
  }

  if (status === "denied" || status === "unsupported") {
    return (
      <div className="compass-guide" role="status">
        <span>
          {status === "denied"
            ? "Location is off for this site, so the guide can't point the way. Allow it in your browser settings, or use the map."
            : "This device can't share its location here, so use the map to find the spot."}
        </span>
        <button className="ghost-button" onClick={stop} type="button">Close</button>
      </div>
    );
  }

  const guide = fix
    ? compassGuide({ position: fix.position, target: location.position, heading: compass === "on" ? heading : null, accuracy: fix.accuracy })
    : null;
  const arrow = guide?.turn ?? null;

  return (
    <div className={`compass-guide is-on${guide?.phase === "arrived" ? " is-arrived" : ""}`} role="status" aria-live="polite">
      <span className="compass-dial" aria-hidden="true">
        {arrow === null ? (
          <Compass size={26} />
        ) : (
          <Navigation2 size={26} style={{ transform: `rotate(${Math.round(arrow)}deg)` }} />
        )}
      </span>
      <span className="compass-text">
        <strong>{guide ? guide.title : "Finding you…"}</strong>
        {guide?.detail && <span>{guide.detail}</span>}
        {guide && compass === "waiting" && <span>Checking for a compass…</span>}
      </span>
      <button className="ghost-button compass-stop" onClick={stop} type="button">Stop</button>
    </div>
  );
}
