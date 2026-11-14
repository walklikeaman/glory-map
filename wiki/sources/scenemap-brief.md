---
type: source
created: 2026-11-13
updated: 2026-11-13
sources: [Context/brief-scenemap-design.md]
relates_to: [demo-path, glorymap-app]
---
# The original brief (SceneMap, July 2026)

[`Context/brief-scenemap-design.md`](../../Context/brief-scenemap-design.md) — the
hackathon handover for Codex, written before the first line of code. Raw material,
never edited.

- **The idea:** connect your film library or pick favourite films, and the map lights
  up with the places their scenes were shot; a point shows a frame next to the same
  place today; points join into a walking "movie stroll".
- **Why it wins:** a map of *your* films, not of all films (moviemaps.org already
  does that); the frame ↔ today pair; a route as a ready tourist product.
- **The sacred demo path:** pick films (poster gallery or Letterboxd CSV) → London or
  New York lights up → open a card → add 3 points → build the stroll. Not Tel Aviv:
  its open data was almost empty. Still the core of [[demo-path]].
- **The data contract:** tables `locations` and `scenes` (section 5). That schema is
  history now: places live in the graph tables and the harvest queue
  `location_submissions` (see [[supabase]]).

What changed since: the name (SceneMap → GloryMap, PR #31), the map (Leaflet →
MapLibre), and the scope, which grew from a demo into the product
[`ARCHITECTURE.md`](../../ARCHITECTURE.md) describes.
