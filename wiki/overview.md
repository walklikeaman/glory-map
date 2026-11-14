---
type: concept
created: 2026-07-20
updated: 2026-11-13
sources: [code, log]
---
# GloryMap — project overview

Synthesis as of 22.07.2026, after a full read-through of the code (89 tests, ~4400 lines excluding
the frontend). Product: [[glorymap-app]] — a map of real places from your favorite
films, series, and books; a walking "story route" is built from a personal collection.
Brand: SceneMap → **GloryMap** (PR #31; internal names and localStorage keys
`scenemap-*` were kept on purpose).

> **State on 2026-11-13** (this page is the July synthesis; newer facts are in the
> [log](log.md)): the map is MapLibre, not Leaflet; the app has accounts, account
> connections (Letterboxd RSS, Simkl), visitors' shots and an iPhone shell; the
> catalogue holds ~8k works and the harvest queue 55k+ rows. The project runs
> autonomously under [[autonomous-operations]]; how the agents are organised is
> [[agent-harness]].

## How it works (one paragraph)

The client is one big Leaflet component [[frontend]]. It talks to 7 server
routes [[api-layer]]: the city is geocoded via Nominatim, locations are searched live
in [[wikidata]] (P915 "filming location" / P840 "narrative location"), and when the
result is thin they're followed up via OpenAI web_search with mandatory source
verification ([[location-discovery]]). The personal library is imported from
Letterboxd ZIP / IMDb CSV and lives only in the browser ([[personal-library]]).
The film still for a location is picked by a vision model with a strict confidence threshold
([[film-imagery]]). The route is built by OSRM, tours by time budget and the audio guide —
[[tours-and-voice]]. "What's nearby" — [[nearby-geolocation]].

## Key facts that are easy to forget

- **Supabase is NOT used at runtime** — data is not persisted, everything is live
  from Wikidata + Next/CDN caches. The `locations`/`scenes` schema exists, but is empty
  ([[supabase]]).
- Demo fallback: until `/api/locations` responds, the map shows 10
  hardcoded London points — the app is never empty.
- Prod deploy is **manual** via a GitHub Actions gate; a merge into main gives only
  a staging preview ([[deployment-pipeline]]).
- The UI is strictly English-only (a contract after the PR #13 review).
- Models: `gpt-5.6-terra` (tours), `gpt-5-mini` (vision still matching),
  `gpt-4o-mini-tts` (voice), web_search — `gpt-5.6` ([[openai]]).

## Knowledge map

- Entities: [[frontend]] · [[api-layer]] · [[wikidata]] · [[openai]] ·
  [[external-services]] · [[supabase]] · [[deployment-pipeline]] · [[team]]
- Concepts: [[demo-path]] · [[personal-library]] · [[location-discovery]] ·
  [[film-imagery]] · [[tours-and-voice]] · [[nearby-geolocation]] ·
  [[testing-conventions]]
- Sources: [[personal-collections-matrix]] ·
  `Context/brief-scenemap-design.md` · `.planning/codebase/` (7 doc references)
