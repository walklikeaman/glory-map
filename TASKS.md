# Task board

Codex reads this file at the start of a session — here you can see who's working on
what and what's next. Keep it short and up to date; write the branch next to the task.
The working rules are in `TEAMWORK.md`. Update the board yourself after `/ship`.

## Project

- **Building:** GloryMap — a map of places from favorite films and walking cinema routes.
- **Demo path:** pick films → open a location on the map of London → add 3 points → build a walking route.

## Roles (write yourself in at the kickoff)

- Integrator / main: @—
- Backend (Supabase): @—
- Frontend: @—
- Demo and deploy: @—

## Data contract

<tables, fields, the shape of the API response — agree before splitting up work>

## To do: the queue the daily feature routine works from (top first)

Updated 2026-11-03 after the UX audit ([docs/ux-audit-2026-11-03.md](docs/ux-audit-2026-11-03.md)).
Take the first unchecked line that has no open PR. One line = one PR, checked on
1440 px and 390 px with Playwright, screenshots in the PR.

**UX pass (P1), before any new feature:**
- [ ] UX-1 Pin soup: real clustering below zoom ~14, unchecked pins as small dots or off by default
- [ ] UX-2 Left panel / phone sheet: 12 blocks → Search, Results (Works / Places), Plan; filters behind one chip; legal text to Profile
- [ ] UX-3 Phone: search field floating on the map; "Listen as I walk" off the top of the map
- [ ] UX-4 One home for routes: stop list, build route and timed tour all in the Routes section
- [ ] UX-5 Copy pass: no engineering words ("candidates", "unchecked", "gazetteer", raw coordinates)

**UX pass (P2):**
- [ ] UX-6 Place card: no empty hero, Recreate disabled without a frame, one Play/Pause, one "Open in maps" menu
- [ ] UX-7 Work page: poster + mini-map on top, first 10 places then "Show all"
- [ ] UX-8 City page: posters, small map, "Walk London" call to action
- [ ] UX-9 Onboarding: 2 screens, Skip as a top link
- [ ] UX-10 Desktop: section rail on the screen edge, sections replace the left panel
- [ ] UX-11 Works without a poster: kind icon on a neutral tile

**Features, after the UX pass (order from PRIORITIES.md):**
- [x] #57 + #157 then/now wipe and visitors' shots (PR #340)
- [x] #48 AI pre-moderation of suggestions (PR #327)
- [ ] #97 story trail: the numbered polyline on the map
- [ ] #96 / #190 ambient audio that reads place_class
- [ ] #92 connectors: Trakt, Kinopoisk, Open Library, Last.fm
- [ ] #95 growth: budgeted web search + GeoCLIP grounding
- [ ] #47 Wikipedia-prose enrichment (spike)
- [ ] Recreate 2.0: #51 edge-ghost, #52 compass, #53 AI coach, #54 share diptych
- [ ] #114 rest: tablet, landscape, ≤360 px, PWA install
- [ ] #65 streaming narration, #70 offline tours

## QA findings (routine check, 2026-11-03)

- [ ] Map, a picked work: "Known for" says "Nothing here passes your filters" while the work's pins are drawn, and the Locations list under it still lists other films' nearby places (seen with Notting Hill over London). Needs a check on production with real tiles: the cloud browser can't load the basemap.
- [ ] `/work/<slug>` answers 404 when the database fails: `/api/work` swallows the load error and returns `work.title: null`. Same fix as the city/place/letter pages (#readRoute), but the route has to say 502 first.
- [ ] Production (`codex-hackathon-starter.vercel.app`) is not reachable from cloud sessions; QA runs a local prod build against the live DB. Add the domain to the cloud allowlist to test the real deploy.

## In progress

- [ ] …

## Done

- [x] #54: "Then | now" share card from the recreate dialog (share sheet on a phone, download elsewhere; OG preview not yet) — @Claude — `claude/project-thread-li0oep`
- [x] 2026-11-03: merged #326, #337, #332, #338, #339, #341, #342, then #327 and #340 with their prod migrations, after green tests (Nikita: merge on green)
- [x] UX audit of web and phone, 2026-11-03: [docs/ux-audit-2026-11-03.md](docs/ux-audit-2026-11-03.md)
- [x] Visitors' shots on a place + "Recreate" any shot, AI-checked — @Claude — `claude/project-thread-li0oep`
- [x] #57: then/now wipe on the place card (drag, touch, keyboard; falls back to the pair when there is one image) — @Claude — `claude/project-thread-li0oep`
- [x] Refresh locations for the visible map area after user drag — @Codex — `feature/map-viewport-refresh` / PR #35
- [x] Letterboxd ZIP import with automatic personal-library map filtering — @walklikeaman — `codex/interactive`
- [x] Restore cited web research for sparse location results — @Codex — `feature/location-discovery-hotfix` / PR #33
- [x] Gated Vercel staging/production workflows — @walklikeaman — `codex/interactive`
- [x] Multi-place film/series/book search with city bounds, relation descriptions and cited sparse-result research — @Codex — `feature/multi-location-search`
- [x] Automatic high-confidence TMDB scene matching per film location — @Codex — `feature/automatic-scene-matching`
- [x] #18: 30/60/120-minute nearby tours from a city/geolocation with real walking-time validation and deterministic fallback — `feature/timed-voice-tour`
- [x] #20: OpenAI TTS voice guide with narrator profiles, spoiler-free mode and Play/Pause/Resume/Stop — `feature/timed-voice-tour`
- [x] Personal movie library: Letterboxd/IMDb CSV imports, merge, search and local persistence — @walklikeaman — `feature/personal-account-connectors`
- [x] Environment set up (clone the repo + `./setup.sh`)
- [x] GloryMap MVP: English UI, mapped-film search, 10 locations and street-level walking routes — @walklikeaman — `feature/scenemap-skeleton`
- [x] AI film guide: stories, stop ordering and walking-route integration — `feature/ai-film-tour`
