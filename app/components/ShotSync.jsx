"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Download, RotateCcw, Share2 } from "lucide-react";

import {
  CAMERA_CONSTRAINTS,
  IDENTITY,
  OPACITY_DEFAULT,
  cameraErrorReason,
  cameraMessage,
  cameraSupport,
  gestureTransform,
  snapshotFileName,
  snapshotLayout,
  transformCss,
  wheelTransform,
} from "../lib/shot-sync.mjs";

// ShotSync (#50): the film frame as a ghost over the live rear camera. Drag the ghost with
// one finger, pinch and twist with two, then take the photo. The photo is composed on the
// device and stays there until the person saves or shares it. Loaded lazily from the
// Recreate dialog, so nobody pays for the camera code until they open it.

function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("empty"))), "image/jpeg", 0.9);
    } catch (error) {
      // A frame from a host without CORS taints the canvas, and toBlob throws SecurityError.
      reject(error);
    }
  });
}

function loadCorsImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("frame unavailable"));
    image.src = src;
  });
}

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

export default function ShotSync({ location, onUsePhoto, onUpload }) {
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const streamRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const resultUrlsRef = useRef([]);

  const [support, setSupport] = useState({ ok: true, reason: null });
  const [phase, setPhase] = useState("intro"); // intro | starting | live | result | error
  const [errorReason, setErrorReason] = useState(null);
  const [opacity, setOpacity] = useState(OPACITY_DEFAULT);
  const [transform, setTransformState] = useState(IDENTITY);
  // Handlers read the latest transform from here: a pointer can lift before React has
  // re-rendered with the last move, and a gesture must start from where the ghost really is.
  const transformRef = useRef(IDENTITY);

  const setTransform = useCallback((next) => {
    const value = typeof next === "function" ? next(transformRef.current) : next;
    transformRef.current = value;
    setTransformState(value);
  }, []);
  const [result, setResult] = useState(null);

  useEffect(() => {
    setSupport(cameraSupport({ navigator, isSecureContext: window.isSecureContext }));
  }, []);

  const releaseResult = useCallback(() => {
    resultUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    resultUrlsRef.current = [];
  }, []);

  // The camera light must go off the moment this view does.
  useEffect(() => () => {
    stopStream(streamRef.current);
    streamRef.current = null;
    releaseResult();
  }, [releaseResult]);

  async function startCamera() {
    setPhase("starting");
    setErrorReason(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      stopStream(streamRef.current);
      streamRef.current = stream;
      setPhase("live");
    } catch (error) {
      setErrorReason(cameraErrorReason(error));
      setPhase("error");
    }
  }

  // Attach the stream once the <video> exists (it renders only in the live phase).
  useEffect(() => {
    const video = videoRef.current;
    if (phase !== "live" || !video || !streamRef.current) return;
    if (video.srcObject !== streamRef.current) video.srcObject = streamRef.current;
    video.play().catch(() => {});
  }, [phase]);

  function pointerList() {
    return [...pointersRef.current.values()].slice(0, 2);
  }

  function beginGesture() {
    gestureRef.current = { start: transformRef.current, from: pointerList() };
  }

  function onPointerDown(event) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginGesture();
  }

  function onPointerMove(event) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = gestureRef.current;
    if (!gesture) return;
    setTransform(gestureTransform(gesture.start, gesture.from, pointerList()));
  }

  function onPointerUp(event) {
    pointersRef.current.delete(event.pointerId);
    // A finger lifting mid-pinch starts a fresh one-finger drag from where things are now.
    gestureRef.current = pointersRef.current.size
      ? { start: transformRef.current, from: pointerList() }
      : null;
  }

  function onWheel(event) {
    setTransform((current) => wheelTransform(current, event.deltaY));
  }

  async function takePhoto() {
    const video = videoRef.current;
    const stage = stageRef.current;
    if (!video || !stage) return;

    const rect = stage.getBoundingClientRect();
    let frame = null;
    try {
      frame = await loadCorsImage(location.backdrop);
    } catch {
      frame = null;
    }

    const layout = snapshotLayout({
      video: { width: video.videoWidth, height: video.videoHeight },
      stage: { width: rect.width, height: rect.height },
      frame: frame
        ? { width: frame.naturalWidth, height: frame.naturalHeight }
        : { width: rect.width, height: rect.height },
      transform: transformRef.current,
    });
    if (!layout) return;

    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext("2d");
    const { crop } = layout;
    ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, layout.width, layout.height);
    const clean = await toBlob(canvas);

    let composite = null;
    if (frame) {
      const { ghost } = layout;
      ctx.save();
      ctx.globalAlpha = opacity / 100;
      ctx.translate(ghost.centerX, ghost.centerY);
      ctx.rotate(ghost.rotation);
      ctx.scale(ghost.scale, ghost.scale);
      ctx.drawImage(frame, -ghost.width / 2, -ghost.height / 2, ghost.width, ghost.height);
      ctx.restore();
      composite = await toBlob(canvas).catch(() => null);
    }

    releaseResult();
    const cleanUrl = URL.createObjectURL(clean);
    const compositeUrl = composite ? URL.createObjectURL(composite) : null;
    resultUrlsRef.current = [cleanUrl, compositeUrl].filter(Boolean);
    setResult({ clean, cleanUrl, composite, compositeUrl });
    setPhase("result");
  }

  function retake() {
    releaseResult();
    setResult(null);
    setPhase(streamRef.current ? "live" : "intro");
  }

  const shareFile = result?.composite ?? result?.clean;
  const shareName = snapshotFileName(location, result?.composite ? "recreation" : "photo");
  const canShare = typeof navigator !== "undefined"
    && shareFile
    && typeof navigator.canShare === "function"
    && navigator.canShare({ files: [new File([shareFile], shareName, { type: "image/jpeg" })] });

  async function share() {
    try {
      await navigator.share({
        files: [new File([shareFile], shareName, { type: "image/jpeg" })],
        title: `${location.film} · ${location.place}`,
      });
    } catch {
      // Cancelled or refused: the photo is still on screen to save.
    }
  }

  if (!support.ok || phase === "error") {
    const reason = support.ok ? errorReason : support.reason;
    return (
      <div className="shotsync shotsync-fallback" role="status">
        <strong>Live camera isn't available</strong>
        <span>{cameraMessage(reason)}</span>
        <div className="shotsync-actions">
          {support.ok && (
            <button className="ghost-button" onClick={startCamera} type="button">
              Try again
            </button>
          )}
          <button className="wide-button" onClick={onUpload} type="button">
            Upload a photo instead
          </button>
        </div>
      </div>
    );
  }

  if (phase === "intro" || phase === "starting") {
    return (
      <div className="shotsync shotsync-intro">
        <strong>Line it up live</strong>
        <span>
          Stand where the camera stood. The film frame floats over your camera so you can
          match it: drag to move, pinch to resize, twist to rotate.
        </span>
        <span className="shotsync-note">
          Your browser will ask for the camera. The picture stays on this device.
        </span>
        <button
          className="wide-button"
          disabled={phase === "starting"}
          onClick={startCamera}
          type="button"
        >
          <Camera size={18} />
          {phase === "starting" ? "Opening camera…" : "Start camera"}
        </button>
      </div>
    );
  }

  if (phase === "result" && result) {
    const shown = result.compositeUrl ?? result.cleanUrl;
    return (
      <div className="shotsync shotsync-result">
        <img alt={`Your recreation of ${location.film} at ${location.place}`} src={shown} />
        {!result.composite && (
          <span className="shotsync-note">
            This frame's host doesn't let it be saved into a photo, so this is your camera shot alone.
          </span>
        )}
        <div className="shotsync-actions">
          <a className="wide-button" download={shareName} href={shown}>
            <Download size={18} />
            Save photo
          </a>
          {canShare && (
            <button className="ghost-button" onClick={share} type="button">
              <Share2 size={18} />
              Share
            </button>
          )}
          <button className="ghost-button" onClick={() => onUsePhoto(result.clean)} type="button">
            Compare then / now
          </button>
          <button className="ghost-button" onClick={retake} type="button">
            <RotateCcw size={18} />
            Retake
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shotsync shotsync-live">
      <div
        className="shotsync-stage"
        onPointerCancel={onPointerUp}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        ref={stageRef}
      >
        <video autoPlay muted playsInline ref={videoRef} />
        <img
          alt=""
          aria-hidden="true"
          className="shotsync-ghost"
          draggable={false}
          src={location.backdrop}
          style={{ opacity: opacity / 100, transform: transformCss(transform) }}
        />
      </div>
      <div className="shotsync-controls">
        <label className="recreate-opacity">
          <span>Film frame opacity</span>
          <input
            aria-label="Film frame opacity"
            max="100"
            min="0"
            onChange={(event) => setOpacity(Number(event.target.value))}
            type="range"
            value={opacity}
          />
          <output>{opacity}%</output>
        </label>
        <div className="shotsync-actions">
          <button className="ghost-button" onClick={() => setTransform(IDENTITY)} type="button">
            Reset alignment
          </button>
          <button className="wide-button shotsync-shutter" onClick={takePhoto} type="button">
            <Camera size={18} />
            Take photo
          </button>
        </div>
      </div>
    </div>
  );
}
