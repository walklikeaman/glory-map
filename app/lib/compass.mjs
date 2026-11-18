// Compass guide for "Recreate the shot" (#52): walk the person to the spot with the
// phone's GPS and compass. Pure module; the component feeds it positions and headings.

import { haversineMeters, isLatLng } from "./geo.mjs";

// Close enough to stop walking and start framing. GPS on a phone in a street is good
// to 5–20 m, so the circle grows with the fix's own accuracy.
export const ARRIVED_M = 20;
// Under this the arrow says "straight ahead" instead of a turn of a few degrees.
export const AHEAD_DEG = 15;

const toRadians = (value) => (value * Math.PI) / 180;
const toDegrees = (value) => (value * 180) / Math.PI;

export function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

// Initial great-circle bearing from one [lat, lng] to another, 0 = north, clockwise.
export function bearingDegrees(from, to) {
  if (!isLatLng(from) || !isLatLng(to)) return null;
  const lat1 = toRadians(from[0]);
  const lat2 = toRadians(to[0]);
  const dLon = toRadians(to[1] - from[1]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeDegrees(toDegrees(Math.atan2(y, x)));
}

const CARDINALS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function cardinal(bearing) {
  if (!Number.isFinite(bearing)) return null;
  return CARDINALS[Math.round(normalizeDegrees(bearing) / 45) % 8];
}

// How far to turn from where the phone points to the target: -180..180, positive = right.
export function turnDegrees(target, heading) {
  if (!Number.isFinite(target) || !Number.isFinite(heading)) return null;
  const turn = normalizeDegrees(target - heading);
  return turn > 180 ? turn - 360 : turn;
}

// Compass heading from a DeviceOrientationEvent, or null when it has none.
// iOS Safari gives webkitCompassHeading (already clockwise from north). Elsewhere only an
// absolute event's alpha is tied to north; alpha counts counter-clockwise, and it is
// measured for the device's natural orientation, so the screen's rotation is added back.
export function headingFromOrientation(event, screenAngle = 0) {
  if (!event) return null;
  if (Number.isFinite(event.webkitCompassHeading)) return normalizeDegrees(event.webkitCompassHeading);
  if (event.absolute === true && Number.isFinite(event.alpha)) {
    return normalizeDegrees(360 - event.alpha + (Number.isFinite(screenAngle) ? screenAngle : 0));
  }
  return null;
}

export function distanceText(meters) {
  if (!Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

// A pin is a spot to walk to; an area (a whole town, a park) has no camera position.
export function canGuide(location) {
  return Boolean(location) && isLatLng(location.position) && location.display !== "area";
}

// Everything the guide shows for one GPS fix and (maybe) one compass reading.
export function compassGuide({ position, target, heading = null, accuracy = null }) {
  if (!isLatLng(position) || !isLatLng(target)) return null;
  const distance = haversineMeters(position, target);
  const bearing = bearingDegrees(position, target);
  const radius = Math.max(ARRIVED_M, Number.isFinite(accuracy) ? Math.min(accuracy, 40) : 0);

  if (distance <= radius) {
    return {
      phase: "arrived",
      distance,
      bearing,
      turn: null,
      title: "You're at the spot",
      detail: "Start the camera and match the frame: step back or forward until the edges line up.",
    };
  }

  const turn = turnDegrees(bearing, heading);
  const away = distanceText(distance);
  if (turn === null) {
    return {
      phase: "walk",
      distance,
      bearing,
      turn: null,
      title: `${away} to the ${cardinal(bearing)}`,
      detail: "No compass reading here, so follow the map direction.",
    };
  }

  const size = Math.abs(Math.round(turn));
  const title = size <= AHEAD_DEG
    ? `${away} straight ahead`
    : size >= 150
      ? `${away} behind you`
      : `${away}, turn ${size}° ${turn > 0 ? "right" : "left"}`;
  return { phase: "walk", distance, bearing, turn, title, detail: null };
}
