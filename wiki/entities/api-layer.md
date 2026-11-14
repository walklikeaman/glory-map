---
type: entity
created: 2026-07-22
updated: 2026-07-22
sources: [code, log]
---
# API layer — 7 Next.js routes

Backend-for-frontend: route handlers make the network calls, while all logic
lives in pure `app/lib/*.mjs` (testable without the network —
[[testing-conventions]]). The consumer is [[frontend]].

| Route | What it does | External |
|---|---|---|
| GET `/api/cities?q=` | geocode a city → {name, lat, lng, radius_km 5–50, wikidata_id} | Nominatim, cache 86400 |
| GET `/api/locations` | core: nearby mode (SPARQL `wikibase:around`) or work mode (`?q=` → wbsearchentities → type validation over the graph via P31/P279 BFS≤4 → locations via P915/P840) | [[wikidata]], cache 3600 |
| POST `/api/locations/discover` | AI follow-up investigation when the results are thin ([[location-discovery]]) | [[openai]] web_search |
| GET `/api/film-image` | a film still for a location through the vision gate ([[film-imagery]]) | Wikidata+TMDB+vision |
| POST `/api/route` | walking route of 2–5 points | OSRM ([[external-services]]) |
| POST `/api/tour` | tour texts via Structured Outputs, stop ids via z.enum | [[openai]] gpt-5.6-terra |
| POST `/api/narration` | TTS mp3 stream, text ≤600 characters | [[openai]] gpt-4o-mini-tts |

## Cross-cutting decisions

- Don't trust the models: every LLM response is validated in code (assertCompleteTour,
  normalizeDiscoveredLocations, only confidence='high').
- Every external call uses AbortSignal.timeout (6–20 s), timeout → 504,
  failure → 502; Wikidata — 1 retry on 429/503.
- Two-layer cache: `next:{revalidate}` on fetch + `s-maxage` on responses.
- Prompt-injection protection in all LLM instructions + an allowlist of https hosts
  for reference images.
- Missing TMDB/OpenAI keys — not a 5xx, but a 200 with `image_url:null` + `reason`.

## Gotchas

- The `/api/locations` default without lat/lng — silently London.
- Negative film-image responses come back with status 200 — the client looks at `reason`,
  not the HTTP status; they are cached on the CDN for a day.
- The film-image rate limiter is in-memory per instance — on serverless it's softer than the stated
  12/10min.
- The geo film search uses an exact `wdt:P31 wd:Q11424` without P279* (perf);
  film subclasses are found only in work mode.
