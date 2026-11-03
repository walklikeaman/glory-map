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

## To do (slicing the demo path into slices)

- [ ] <slice 1> — @— — `feature/—`
- [ ] <slice 2> — @— — `feature/—`
- [ ] <slice 3> — @— — `feature/—`
- [ ] <slice 4> — @— — `feature/—`

## QA findings (routine check, 2026-11-03)

- [ ] Map, a picked work: "Known for" says "Nothing here passes your filters" while the work's pins are drawn, and the Locations list under it still lists other films' nearby places (seen with Notting Hill over London). Needs a check on production with real tiles: the cloud browser can't load the basemap.
- [ ] `/work/<slug>` answers 404 when the database fails: `/api/work` swallows the load error and returns `work.title: null`. Same fix as the city/place/letter pages (#readRoute), but the route has to say 502 first.
- [ ] Production (`codex-hackathon-starter.vercel.app`) is not reachable from cloud sessions; QA runs a local prod build against the live DB. Add the domain to the cloud allowlist to test the real deploy.

## In progress

- [ ] …

## Done

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
