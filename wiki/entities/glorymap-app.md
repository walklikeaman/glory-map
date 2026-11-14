---
type: entity
created: 2026-07-22
updated: 2026-07-22
sources: [code, log]
---
# GloryMap — the product

A map of real places from your favorite films, series, and books: personal
collection → the city's notable places → a walking "story route" with an audio guide.
OpenAI Build Week hackathon, Tel Aviv, 21.07.2026. Lives at:
https://codex-hackathon-starter.vercel.app

- Name history: SceneMap → **GloryMap** (PR #31); the internal component names
  and localStorage keys `scenemap-*` were kept on purpose.
- Layers: [[frontend]] (client monolith) → [[api-layer]] (7 BFF routes) →
  [[wikidata]] / [[openai]] / [[external-services]]; [[supabase]] powers auth
  and cloud-synced libraries (locations stay live, not persisted).
- Main scenario: [[demo-path]]. Features: [[personal-library]],
  [[location-discovery]], [[film-imagery]], [[tours-and-voice]],
  [[nearby-geolocation]].
- Privacy: the user's library and photos never leave the browser; model keys —
  server-side only.
- Process: [[team]], [[deployment-pipeline]], [[testing-conventions]];
  the chronicle of decisions — `wiki/log.md` (append-only, newest on top).
- Product page — the root `README.md` (English, for Devpost); the
  original brief — `Context/brief-scenemap-design.md`.
