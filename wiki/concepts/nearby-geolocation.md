---
type: concept
created: 2026-07-22
updated: 2026-07-22
sources: [code, log]
---
# "What's nearby" — geolocation (issue #17, PR #25)

The CTA requests geolocation only on click; the states locating / denied /
unavailable / timeout — each with a message and a "Use demo location" button
(a deterministic fallback — Trafalgar Square, chosen because it
falls within the London dataset so the nearest card is always populated).

- Radii 100 m / 300 m / 1 km / 3 km; the map flies to the user with a zoom
  matched to the radius, a radius circle, a pulsing user pin, the nearest pin with a glow.
- The nearest point is shown even outside the radius — with an "outside radius" label.
- Library: `app/lib/nearby.mjs` (haversine in meters, findNearby,
  formatDistanceMeters, mapSearchRadiusKm, zoomForRadius) — pure functions,
  covered by tests ([[testing-conventions]]).
- Map drag also updates locations: RefreshLocationsOnDrag → browseCenter +
  radius from the viewport, preserving the selection/route ([[frontend]]).

Environment gotcha: in headless browsers without requestAnimationFrame, Leaflet flyTo
freezes — check animations on a real device.
