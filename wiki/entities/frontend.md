---
type: entity
created: 2026-07-22
updated: 2026-07-22
sources: [code, log]
---
# Frontend — SceneMapApp

A single client-side monolith `app/components/SceneMapApp.jsx` (~2050 lines) +
`app/components/VoiceGuide.jsx`. No routing and no state manager: useState/
useRef/useMemo. `app/page.jsx` loads it via `next/dynamic ssr:false`
(Leaflet requires window). Part of [[glorymap-app]]; the server side is
[[api-layer]].

## What's inside

- Full-screen dark map (CARTO dark_all), a command panel, a bottom location
  sheet, the RecreateShot modal (your own shot over the reference, the photo never leaves the
  browser — objectURL).
- Map helpers: RecenterOnSelection, FitRoute, RefreshLocationsOnDrag, FlyToUser.
- Features: city and work search (film|series|book), [[nearby-geolocation]],
  a 3–5 stop route, a timed tour 30/60/120 and an AI tour ([[tours-and-voice]]),
  [[personal-library]], an AI location still ([[film-imagery]]).

## Patterns (repeat when making changes)

- **Races** are quenched with ref counters (locationRequestId, routeRequestId) +
  AbortController: only the current response is applied.
- **Two map-update modes**: drag (`refreshVisibleMap`) preserves the
  selection/route/tours; changing the city or work type resets the context.
- Any destructive operation explicitly invalidates the dependent artifacts
  (aiTour, timedTour, routeResult).
- **Graceful degradation**: /api/route failed → dashed straight lines
  (haversine, 4.6 km/h); tour without AI → createFallbackGuide; geo denied →
  "Use demo location" (Trafalgar).

## Gotchas

- localStorage — exactly one key `scenemap-library`; city/route/tours
  are lost on reload.
- After a library import, the `libraryMapOnly` filter is auto-enabled — the map
  may "empty out" if nothing was mapped (the toggle is in the My movies panel).
- Dragging the map clears workQuery — a work search result lives until the
  first drag.
- A backdrop without `backdrop_verified === true` is discarded already in
  locationsFromApi; commons images are forced to https.
- VoiceGuide: Play is blocked during playback — a restart is only possible
  via Stop; Spoiler-free is on by default and substitutes the story with a template.
