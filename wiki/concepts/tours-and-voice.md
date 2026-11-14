---
type: concept
created: 2026-07-22
updated: 2026-07-22
sources: [code, log]
---
# Tours and voice — route, timed tour, AI tour, audio guide

Four related features in [[frontend]]; the server side is `/api/route`,
`/api/tour`, `/api/narration` ([[api-layer]]).

## Manual route

3–5 stops → POST `/api/route` (OSRM foot) → a line on the map + km/minutes.
Fallback: dashed straight lines (haversine, 4.6 km/h, minimum 8 min).

## Timed tour (30/60/120 minutes) — the client drives

`app/lib/timed-tour.mjs` (a pure planner): dedup locations, merging
different works at one physical point (multi-film stops),
nearest-neighbor from origin, minute estimation (4.6 km/h × street coefficient 1.3).
The client iterates over candidates 5→4→3 stops through the real `/api/route` until
the route fits within budget × tolerance 1.15 (`routeFitsBudget`). Only then does
`/api/tour` with `preserveOrder:true` write the narratives. Without AI — the deterministic
`createFallbackGuide`.

## AI tour of a work — the server drives

`/api/tour` without preserveOrder: the model picks the stop order itself.
A dynamic Zod schema `z.enum(locationIds)` + `assertCompleteTour` — the model
cannot invent, lose, or duplicate a stop ([[openai]]).

## Audio guide (VoiceGuide)

Text ≤600 characters → `/api/narration` → mp3 stream (gpt-4o-mini-tts). Profiles
that don't imitate real people: neutral "Warm guide" (marin), archivist "Curious
archivist" (cedar). **Spoiler-free is on by default** — it swaps the story
for a neutral recap. Cancels on a location/profile change.

## Gotchas

- buildTimedTour: the very first network error from /api/route stops the iteration —
  candidates[0] with a fallback route is taken.
- "Generate nearby tour" requires ≥3 visible locations; Build route — ≥3 stops.
- startTimedTour reads `stop.filmIds ?? [stop.filmId]` — stops can be
  multi-film.
