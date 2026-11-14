---
type: entity
created: 2026-07-22
updated: 2026-07-22
sources: [code, log]
---
# Supabase — auth and cloud libraries (since the evening of 22.07)

UPDATED: after PR #42/#43 Supabase is used at runtime — **Supabase Auth**
(Google/Facebook OAuth, a Login with Google button on the home screen) and
**cloud storage of the personal library** (normalized JSON, user-scoped
RLS; guest imports stay local and are merged after login —
[[personal-library]]). Locations are still NOT persisted — they're live from
[[wikidata]] with Next/CDN caches.

## What exists

- The team's shared project `codex-hackathon`, ref `quvxxqxowathrcyshhwj`,
  region Frankfurt. The URL + anon key are committed in `.env.example`
  (on purpose: public by design, protection is RLS; NOT a leak).
- Migration `scenemap_initial_schema` (created by the owner on 21.07):
  - `locations` (work_wikidata_id, work_tmdb_id, work_title, work_year,
    kind film|book, loc_wikidata_id, loc_name, lat, lng, commons_image, city;
    uniqueness on the work+loc pair)
  - `scenes` (location_id → locations, scene_title, description,
    source wikidata|ai)
  - RLS is permissive: anon reads and writes both tables; service_role is not needed.
- Both tables are **empty** — the Wikidata seed was never run: the team chose
  live queries over persistence.

## When it will come in handy

- Caching expensive AI results (scene descriptions, vision matches) across instances —
  right now the film-image cache is CDN/in-memory only.
- Shared features between users (a feed, saved routes, wishlist).
- Management — via the owner's Supabase MCP or `./setup.sh --infra`.
