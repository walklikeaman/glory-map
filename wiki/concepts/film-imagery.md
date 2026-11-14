---
type: concept
created: 2026-07-22
updated: 2026-07-22
sources: [code, log]
---
# Film still for a location — vision gate with a capability token

Goal: show in the location card a still shot filmed right here, not a random
backdrop. The pipeline is `/api/film-image` ([[api-layer]]); logic lives in
`app/lib/scene-image-match.mjs`, `scene-match-token.mjs`, `tmdb-images.mjs`.

## Pipeline

1. **HMAC token**: `/api/locations` signs the triple `v1:tmdbId:workId:locId`
   (HMAC-SHA256 → base64url, 43 chars) ONLY for kind=film with a known TMDB
   id — the client cannot order a paid vision call for arbitrary pairs.
2. In-memory rate limit of 12 req/10 min per IP.
3. SPARQL re-check of the work–P915–location link + a P4947 match.
4. Up to **24 backdrop candidates** from TMDB ([[external-services]]).
5. [[openai]] vision compares the reference photo of the place (allowlist of https hosts)
   against the candidates; ONLY `confidence='high'` is accepted — otherwise an honest
   placeholder + a link to Bing Images.

## Caching

- Query string canonicalization with a 307 redirect → maximum CDN hits; the
  `v=2` parameter is the matcher version (bumping it invalidates the cache).
- A successful match — 30 days; an honest no-match — one day; errors — private,
  no-store (NEVER cached as "no match").

## Gotchas

- Negative outcomes come back as 200 + `image_url:null` + `reason` — look
  at the reason, not the status.
- The signing secret falls back to OPENAI_API_KEY — rotating the key invalidates
  tokens ([[openai]]).
- Series and books get no stills (the token is film-only) — the reserve: TMDB
  episode stills, see [[personal-collections-matrix]].
- History: at first the place photo was duplicated as a "still" (which was
  misleading) → PR #24 split them; then the matcher only looked at the 6 most popular
  backdrops and kept missing → expanded to 24 (fixed 22.07).
