---
type: entity
created: 2026-07-22
updated: 2026-07-22
sources: [code, log]
---
# Wikidata — the canonical source of locations

The single source of truth about the "work → place" link (LLM web research is
only a supplement, [[location-discovery]]). Everything is live, nothing is persisted
([[supabase]] is empty). Uses [[api-layer]] (`/api/locations`,
`/api/film-image`), with the logic in `app/lib/location-search.mjs`.

## Property glossary

- **P915** filming location (film, series) · **P840** narrative location (book)
- **P625** coordinates (WKT `Point(lng lat)` — longitude first!)
- **P18** photo of the place (Commons) · **P4947** TMDB ID (films only)
- rootType: Q11424 film · Q5398426 series · Q7725634 book;
  config — `WORK_KIND_CONFIG`.

## Endpoints and limits

- SPARQL `query.wikidata.org/sparql`: nearby via `SERVICE wikibase:around`,
  timeout 18 s, cache 3600, 1 retry on 429/503.
- Entity API `wbsearchentities` (limit 8) + `wbgetentities` in chunks of 5,
  cache 86400, timeout 6 s.
- User-Agent is required.

## Gotchas

- Placeholder labels: a label starting with `Q\d+` is discarded — entities without
  an en/ru name silently drop out.
- The SPARQL LIMIT is applied BEFORE the exact-radius filter — in dense areas
  some results are lost already in Wikidata.
- BFS over P31/P279 at depth 4 — a work with a deeper subclass chain
  won't pass type validation in work mode.
- Nearby ranking: at most 5 works × 6 locations, with a preference for
  works that have several places within the radius.
- Dedup by the key work:location:relation_kind; the order of claims decides which
  coordinate/date wins (only rank deprecated is filtered out).
