---
type: source
created: 2026-07-22
updated: 2026-07-22
sources: [web, research]
---
# Feature research — competitors, approaches, legal notes

Research 22.07.2026 (5 parallel agents, live web sources) behind the
the roadmap ([`ROADMAP.md`](../../ROADMAP.md)). Feeds the backlog issues #44–#77.
Related: [[personal-collections-matrix]], [[film-imagery]], [[tours-and-voice]].

## Competitor map

| Product | Area | Their approach | Their gap (our opening) |
|---|---|---|---|
| **SetJetters** (Reel to Real) | locations + recreate | 10k+ curated locations, ShotSync manual overlay, UGC visits, badges; mobile-only | Manual alignment (no vision verification), no web, no Letterboxd import, no AI guide |
| **CineMapper** | locations | "Google Maps of Movies", discovery-first | Shallow per-point photos, no recreate, no vision match |
| **Atlas of Wonders** | imagery | editorial before/after, big catalog | Blog not app: no map/routes/UGC/personalization, manual = doesn't scale |
| **movie-locations.com** | locations | huge manual text DB, first-hand photos | No interactive map/routes, no UGC, dated UX |
| **Autio / VoiceMap / GuideAlong** | ai-tours | geo-triggered pro-narrated audio, native apps | Generic POIs not your films; studio production doesn't scale (Detour died here) |
| **Placing Literature / Google Lit Trips** | plot-routes | crowd/teacher-built literary pins & tours | Fixed manual tours per title, unconnected pins, no auto-generation, no spoiler logic |
| **Polarsteps** | imagery | auto Trip Reel from visited places (2025) | Not cinema — but the auto-reel UX is a direct reference |

## Load-bearing technical + legal notes (verified where possible)

- **Film stills copyright**: TMDB may display but not redistribute/archive — hotlink
  with attribution, ~1 frame per title (closer to fair-use commentary); do **not**
  build a stills archive. Stronger licensing risk than plain screenshots.
- **Google Street View / Places Photos**: ToS forbids pre-fetch/cache/store of images
  (only `pano_id`/`place_id` cacheable) → live-embed only, never in saved before/after
  composites or Supabase Storage.
- **Mapillary** Graph API: free, 2.5B+ images, faces/plates auto-blurred, **CC BY-SA 4.0**
  (attribution + possible share-alike on composites); thumb URLs have a TTL — re-request
  by `image_id`. bbox must be < 0.01°/side. → primary free "place now".
- **Wikimedia Commons** Geosearch + imageinfo: free, no key, **per-file** license
  (CC-BY/CC-BY-SA/PD/sometimes non-free) — parse `extmetadata`, attribute per file.
  Cacheable (unlike Google).
- **OpenAI `omni-moderation-latest`**: free, multimodal (images ≤20MB), 13 categories →
  first-line UGC moderation, cheaper than Rekognition/Hive/SafeSearch.
- **Supabase Storage**: $0.021/GB store, $0.03/GB egress (250GB incl. on Pro),
  transforms $5/1000 **origin** images — normalize to one origin; don't store external
  sources (hotlink instead).
- **Geocoding at scale**: public Nominatim hard cap 1 req/s, no bulk → self-host or cache
  for the 23k+ address enrichment; Photon for typo-tolerant autocomplete.
- **OSM Overpass** (building footprints): free, **ODbL** (attribution + share-alike on
  derived DB) → house-level precision snap.
- **Web geofencing is foreground-only**: `watchPosition` throttles with screen off; W3C
  Geofencing API abandoned → Wake Lock "walk mode" now, Capacitor wrapper for true
  background later.
- **Copyright on narration/plot**: keep summaries short + transformative, ground in
  CC sources (Wikidata/Wikipedia), never recite protected scripts/long text.
- **Privacy/ethics**: strip EXIF GPS from uploads (home addresses); flag `private residence`
  locations; explicit geolocation consent, never coords in URLs.

## Cross-cutting differentiators (why GloryMap wins)

1. **Personal**: built around the user's imported library, not a generic catalog.
2. **Provable accuracy**: vision-verified stills + precision/source badges vs "trust us".
3. **Films *and* books** in one product and one story sequence.
4. **Web-first**: open by link, no install — every competitor is native-only.
5. **One journey**: map → route → timed tour → recreate → audio guide, not separate apps.
6. **AI-generated at scale**: solves the content-production problem that killed Detour.
