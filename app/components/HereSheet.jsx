"use client";

// "What's interesting around here" (Nikita, 2026-11-07). On a first run it replaces the
// old welcome text: the app opens on the reader, says what was filmed nearby, and only
// then offers to bring in their own films. After that the map's "What's here?" button
// opens it again for wherever the map is. The ranking lives in [[around-here]].

import { useEffect, useState } from "react";
import { Book, Film, LogIn, MapPin, Tv, X } from "lucide-react";

import { AROUND_KM, ENOUGH_WORKS, WIDER_KM, aroundBox, aroundHere, distanceLabel } from "../lib/around-here.mjs";
import { ratingOf } from "../lib/notable-here.mjs";

const KIND_ICON = { series: Tv, book: Book };

async function pointsAround(center, km, signal) {
  const box = aroundBox(center, km);
  const query = new URLSearchParams({
    west: box.west.toFixed(4), east: box.east.toFixed(4),
    south: box.south.toFixed(4), north: box.north.toFixed(4),
    z: "12", candidates: "1",
  });
  const response = await fetch(`/api/map/points?${query}`, { signal });
  if (!response.ok) throw new Error(`points responded ${response.status}`);
  const body = await response.json();
  return [...(body.features ?? []), ...(body.candidates ?? [])];
}

export default function HereSheet({ center, placeLabel, locating = false, firstRun = false, onOpenPlace, onPickFilms, onClose }) {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  const key = center ? `${center[0].toFixed(3)},${center[1].toFixed(3)}` : "";

  useEffect(() => {
    if (locating || !center) return undefined;
    const controller = new AbortController();
    setRows(null);
    setFailed(false);
    (async () => {
      try {
        let found = aroundHere(await pointsAround(center, AROUND_KM, controller.signal), center);
        if (found.length < ENOUGH_WORKS) {
          const wider = aroundHere(await pointsAround(center, WIDER_KM, controller.signal), center);
          if (wider.length > found.length) found = wider;
        }
        setRows(found);
      } catch (error) {
        if (error?.name !== "AbortError") setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [key, locating]);

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="onboarding is-here" role="dialog" aria-modal="true" aria-labelledby="here-title">
      <div className="onboarding-panel here-panel">
        <button type="button" className="onboarding-skip" onClick={onClose}>
          {firstRun ? "Skip" : "Close"}
          <X size={16} aria-hidden="true" />
        </button>
        <header className="here-head">
          {firstRun && <p className="here-kicker">GloryMap · places from films, series and books</p>}
          <h2 id="here-title">Filmed around {placeLabel}</h2>
        </header>

        {locating && <p className="section-empty">Finding where you are…</p>}
        {!locating && failed && <p className="section-empty">Could not load the places nearby. The map still has them.</p>}
        {!locating && !failed && !rows && <p className="section-empty">Looking for stories nearby…</p>}
        {rows && rows.length === 0 && (
          <p className="section-empty">Nothing we know of was filmed within {WIDER_KM} km yet. Search any city or film from the map.</p>
        )}
        {rows && rows.length > 0 && (
          <ul className="here-list">
            {rows.map(({ film, place, feature }) => {
              const Icon = KIND_ICON[film.kind] ?? Film;
              const rating = ratingOf(film);
              return (
                <li key={film.work_id ?? film.title}>
                  <button
                    type="button"
                    className="here-row"
                    disabled={!feature}
                    onClick={() => { onOpenPlace(feature); onClose(); }}
                  >
                    <Icon size={18} aria-hidden="true" className="here-kind" />
                    <span className="here-text">
                      <span className="here-title">
                        {film.title}
                        {film.year ? <span className="here-year"> {film.year}</span> : null}
                      </span>
                      {place && (
                        <span className="here-place">
                          <MapPin size={12} aria-hidden="true" />
                          <span className="here-place-name">{place.name ?? "A filming spot"}</span>
                          <span className="here-distance">· {distanceLabel(place.km)}</span>
                        </span>
                      )}
                    </span>
                    {rating && <span className="here-rating">{rating.score.toFixed(1)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="onboarding-stack">
          {firstRun && onPickFilms && (
            <button type="button" className="ghost-button" onClick={onPickFilms}>
              <LogIn size={16} aria-hidden="true" />
              Add my films to the map
            </button>
          )}
          <button type="button" className="wide-button" onClick={onClose}>Show the map</button>
        </div>
      </div>
    </div>
  );
}
