---
type: entity
created: 2026-07-22
updated: 2026-07-22
sources: [code, log]
---
# External services (besides Wikidata and OpenAI)

Separate pages: [[wikidata]], [[openai]]. Here is everything else that
[[api-layer]] and [[frontend]] call.

## OpenStreetMap family

- **Nominatim** (`/api/cities`): geocode a city, format=jsonv2, limit=5,
  radius from the bounding box (clamped 5–50 km), User-Agent `GloryMap/1.0`, cache 86400.
- **OSRM foot** (`/api/route`): `routing.openstreetmap.de/routed-foot/route/v1/driving`
  — the `driving` segment in the URL is an OSRM formality, the walking profile is set by
  `routed-foot`. Overridden via the env `WALKING_ROUTER_URL`. Timeout 8 s;
  client-side fallback — straight lines.
- **Tiles**: CARTO dark_all over OSM — free, no key.

## TMDB

- Server only: `api.themoviedb.org/3/movie/{id}/images` → backdrops for
  [[film-imagery]]. Auth: Bearer `TMDB_API_READ_ACCESS_TOKEN` (or
  `TMDB_API_KEY`). Stills at `image.tmdb.org/t/p/w780{path}`.
- `selectTmdbBackdrops`: dedup by file_path, sort by vote_count →
  vote_average → width, up to 24 candidates into vision.
- file_path is validated by the regex `^\/[A-Za-z0-9._-]+$` — protection against injection into the URL.
- Unused reserve: episode stills for TV series
  (`/tv/{id}/season/{s}/episode/{e}/images`) — see [[personal-collections-matrix]].

## Wikimedia Commons

- "The place today" photos from P18: `commons.wikimedia.org/wiki/Special:FilePath/...`,
  forced to https. Part of the vision reference allowlist alongside
  upload.wikimedia.org and images.unsplash.com (demo fallbacks).

## Bing Images

- The "Find scenes filmed here" link — just an external search URL with no keys;
  a historical fallback from before vision matching appeared.
