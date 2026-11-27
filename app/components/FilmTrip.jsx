"use client";

// "Build a film trip" (2026-11-27): the paid film tours' shape — a hub, a day, a car or
// your feet, sometimes a ferry — filled with our own places. The panel asks three things
// (which tour, from where, how long and how) and shows every leg with where its number
// came from. The map draws the legs: walking amber, driving blue, a dashed line for a leg
// the router could not measure.

import { useMemo, useState } from "react";
import { Car, Footprints, LoaderCircle, LocateFixed, Route, Ship } from "lucide-react";

import { FILM_TOUR_TEMPLATES, findFilmTourTemplate } from "../lib/film-tour-templates.mjs";
import { FILM_TOUR_BUDGETS, formatTourMinutes, googleMapsTourUrl } from "../lib/film-tour.mjs";
import { MapMarker, RouteLine } from "./map/layers.jsx";

const MAP_FILMS = "map";
const MODE_COLOR = { walk: "#f7b733", car: "#5aa9ff" };

export function FilmTripLayer({ trip, onSelect }) {
  if (!trip) return null;
  return (
    <>
      {(trip.paths ?? []).map((path, index) => (
        <RouteLine
          key={`film-trip-${index}`}
          id={`film-trip-${index}`}
          positions={path.positions}
          color={MODE_COLOR[path.mode] ?? MODE_COLOR.walk}
          dashed={path.source !== "router"}
        />
      ))}
      {(trip.stops ?? []).map((stop) => (
        <MapMarker
          key={stop.id}
          position={stop.position}
          className="trail-stop is-walk"
          onClick={onSelect ? () => onSelect(stop) : undefined}
          title={`${stop.order}. ${stop.name}`}
        >
          {stop.order}
        </MapMarker>
      ))}
    </>
  );
}

function LegLine({ leg }) {
  const Icon = leg.ferry ? Ship : leg.mode === "car" ? Car : Footprints;
  const how = leg.kind === "car" ? "Walk back to the car" : leg.mode === "car" ? "Drive" : "Walk";
  return (
    <li className={`film-trip-leg is-${leg.mode}`}>
      <Icon size={14} aria-hidden="true" />
      <span>
        {how} {leg.km.toFixed(1)} km · {formatTourMinutes(leg.minutes)}
        {leg.ferry ? ` · ferry ${leg.ferry.minutes} min + ${leg.ferry.waitMinutes} min wait` : ""}
      </span>
      <em className={leg.source === "router" ? "is-measured" : "is-estimate"}>
        {leg.source === "router" ? "router" : `≈ estimate, ${leg.straightKm.toFixed(1)} km straight`}
      </em>
    </li>
  );
}

export default function FilmTripPlanner({ mapLocations = [], mapCenter = null, onShow, onClear }) {
  const [choice, setChoice] = useState(FILM_TOUR_TEMPLATES[0].id);
  const template = choice === MAP_FILMS ? null : findFilmTourTemplate(choice);
  const [budget, setBudget] = useState(FILM_TOUR_TEMPLATES[0].minutes);
  const [withCar, setWithCar] = useState(FILM_TOUR_TEMPLATES[0].modes.includes("car"));
  const [fromMe, setFromMe] = useState(null);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [trip, setTrip] = useState(null);

  const mapStops = useMemo(() => mapLocations
    .filter((location) => location.display !== "area" && Array.isArray(location.position))
    .slice(0, 300)
    .map((location) => ({
      id: location.locationId ?? location.id,
      name: location.place,
      position: location.position,
      works: [location.film].filter(Boolean),
    })), [mapLocations]);

  const budgets = useMemo(() => [...new Set([...FILM_TOUR_BUDGETS, budget])].sort((a, b) => a - b), [budget]);

  // Any change to the question takes the old answer off the panel AND the map.
  function reset() {
    setTrip(null);
    onClear?.();
  }

  function choose(id) {
    setChoice(id);
    reset();
    setMessage("");
    const next = id === MAP_FILMS ? null : findFilmTourTemplate(id);
    if (next) {
      setBudget(next.minutes);
      setWithCar(next.modes.includes("car"));
    }
  }

  function locate() {
    if (!navigator.geolocation) {
      setMessage("This browser cannot share where you are.");
      return;
    }
    setMessage("Finding where you are...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFromMe([position.coords.latitude, position.coords.longitude]);
        reset();
        setMessage("");
      },
      () => setMessage("Location was not shared, so the tour starts from its hub."),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  const origin = fromMe ?? (template ? [template.hub.lat, template.hub.lng] : mapCenter);
  const startLabel = fromMe ? "where you are" : template ? template.hub.name : "the map's centre";

  async function build() {
    setStatus("loading");
    setTrip(null);
    onClear?.();
    setMessage("Measuring every leg with the OpenStreetMap router...");
    try {
      const response = await fetch("/api/trip/tour", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(template ? { template: template.id } : { stops: mapStops }),
          origin,
          budgetMinutes: budget,
          modes: withCar ? ["walk", "car"] : ["walk"],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The trip could not be built.");
      if (!payload.stops?.length) {
        setStatus("error");
        setMessage(withCar
          ? "No places fit this time from here. Give it more time or start closer."
          : "No places are a walk from here in this time. Add the car or more time.");
        return;
      }
      setTrip({ ...payload, startLabel });
      setStatus("ready");
      setMessage("");
    } catch (error) {
      setStatus("error");
      setMessage(error.message || "The trip could not be built.");
    }
  }

  const google = trip ? googleMapsTourUrl(trip) : null;

  return (
    <section className="timed-tour-card film-trip-card" aria-labelledby="film-trip-title">
      <div className="timed-tour-heading">
        <span className="timed-tour-icon" aria-hidden="true"><Car size={18} /></span>
        <div>
          <p className="eyebrow">Like the paid film tours</p>
          <strong id="film-trip-title">Build a film trip</strong>
        </div>
      </div>

      <label className="guide-language">
        <span>Tour</span>
        <select value={choice} disabled={status === "loading"} onChange={(event) => choose(event.target.value)}>
          {FILM_TOUR_TEMPLATES.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.title}</option>
          ))}
          <option value={MAP_FILMS} disabled={mapStops.length < 2}>
            Films on the map ({mapStops.length} places)
          </option>
        </select>
      </label>
      {template && <p className="timed-tour-message film-trip-like">{template.like}</p>}

      <div className="film-trip-start">
        <span>From {startLabel}</span>
        <button type="button" onClick={fromMe ? () => { setFromMe(null); reset(); } : locate} disabled={status === "loading"}>
          <LocateFixed size={14} aria-hidden="true" />
          {fromMe ? (template ? `Start at ${template.hub.name}` : "Start at the map") : "Start where I am"}
        </button>
      </div>

      <div className="budget-options film-trip-budgets" role="group" aria-label="How long the trip may take">
        {budgets.map((minutes) => (
          <button
            key={minutes}
            type="button"
            className={budget === minutes ? "is-selected" : ""}
            aria-pressed={budget === minutes}
            disabled={status === "loading"}
            onClick={() => { setBudget(minutes); reset(); }}
          >
            {formatTourMinutes(minutes)}
          </button>
        ))}
      </div>

      <div className="budget-options film-trip-modes" role="group" aria-label="How you get around">
        <button type="button" className={!withCar ? "is-selected" : ""} aria-pressed={!withCar}
          disabled={status === "loading"} onClick={() => { setWithCar(false); reset(); }}>
          <Footprints size={14} aria-hidden="true" /> On foot
        </button>
        <button type="button" className={withCar ? "is-selected" : ""} aria-pressed={withCar}
          disabled={status === "loading"} onClick={() => { setWithCar(true); reset(); }}>
          <Car size={14} aria-hidden="true" /> Foot + car, ferries
        </button>
      </div>

      <button className="timed-tour-button" type="button" onClick={build} disabled={status === "loading" || !origin}>
        {status === "loading" ? <LoaderCircle className="loading-icon" size={17} /> : <Route size={17} />}
        {status === "loading" ? "Measuring..." : "Build the trip"}
      </button>

      {message && (
        <p className={`timed-tour-message${status === "error" ? " is-error" : ""}`} role={status === "error" ? "alert" : "status"}>
          {message}
        </p>
      )}

      {trip && (
        <div className="timed-tour-result film-trip-result" aria-live="polite">
          <div className="timed-tour-metrics">
            <span>{formatTourMinutes(trip.totals.totalMinutes)} of {formatTourMinutes(trip.budgetMinutes)}</span>
            <span>{trip.stops.length} stops</span>
            {trip.totals.walkKm > 0 && <span>{trip.totals.walkKm.toFixed(1)} km on foot</span>}
            {trip.totals.driveKm > 0 && <span>{trip.totals.driveKm.toFixed(1)} km by car</span>}
            {trip.totals.ferries > 0 && <span>{trip.totals.ferries} ferry</span>}
          </div>
          <p>{trip.honesty}{trip.overBudget ? " It still runs over the time you gave." : ""}</p>
          <ol className="film-trip-steps">
            {trip.legs.map((leg) => {
              const stop = leg.kind === "stop" ? trip.stops[leg.stop] : null;
              return (
                <li key={leg.index}>
                  <ul className="film-trip-legs"><LegLine leg={leg} /></ul>
                  {stop && (
                    <>
                      <strong>{stop.order}. {stop.name}</strong>
                      <span>
                        {formatTourMinutes(stop.arriveAtMinute)} in · {stop.works.slice(0, 2).join(", ")}
                        {stop.works.length > 2 ? ` +${stop.works.length - 2}` : ""}
                      </span>
                      <span className={`access-note${stop.verified ? " is-known" : ""}`}>
                        {stop.verified ? "Verified place" : "Unchecked: from our sources, not yet verified"}
                      </span>
                    </>
                  )}
                  {leg.kind === "home" && (
                    <>
                      <strong>Back at {trip.startLabel}</strong>
                      <span>{formatTourMinutes(trip.totals.totalMinutes)} in</span>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
          <button className="start-tour-button" type="button" onClick={() => onShow?.(trip)}>
            <Route size={17} /> Show on the map
          </button>
          {google && (
            <a className="film-trip-google" href={google.href} target="_blank" rel="noreferrer">
              Open in Google Maps{google.truncated ? " (first 9 stops)" : ""}
            </a>
          )}
        </div>
      )}
    </section>
  );
}
