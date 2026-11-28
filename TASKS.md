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
- [x] UX-1 Pin soup: real clustering below zoom ~14, unchecked pins as small dots or off by default (one clustered layer for graph + queue; dots at z15)
- [x] UX-2 Left panel / phone sheet: 12 blocks → Search, Results (Works / Places), Plan; filters behind one chip; legal text to Profile
- [x] UX-3 Phone: search field floating on the map; "Listen as I walk" off the top of the map
- [x] UX-3b Phone pass after Nikita tried the iPhone app (2026-11-07): the queue's bubbles drawn when zoomed out, ~36 px tap target, film titles under pins from z15, a popup that lists the films (a sheet on a phone), plain badge words, a blue "you" dot and radius, walk button on the legend's row
- [x] UX-4 One home for routes: stop list, build route and timed tour all in the Routes section
- [x] UX-5 Copy pass: no engineering words ("candidates", "unchecked", "gazetteer", raw coordinates)

**UX pass (P2):**
- [x] UX-6 Place card: no empty hero, Recreate disabled without a frame, one Play/Pause, one "Open in maps" menu
- [x] UX-7 Work page: poster + mini-map on top, first 10 places then "Show all"
- [x] UX-8 City page: posters, small map, "Walk London" call to action
- [x] UX-9 Onboarding: one welcome screen for guests, a 20-poster left/right deck after sign-in, Skip in the top corner, no repeat after sign-in
- [x] UX-10 Desktop: section rail on the screen edge, sections replace the left panel
- [x] UX-11 Works without a poster: kind icon on a neutral tile
- [x] UX-12 Work picked from search frames ALL its places (incl. its unconfirmed ones); "Unconfirmed places" in the map's layers menu; places zoom by size; address lookup always offered (2026-11-13)

**Features, after the UX pass (order from PRIORITIES.md):**
- [x] #57 + #157 then/now wipe and visitors' shots (PR #340)
- [x] #48 AI pre-moderation of suggestions (PR #327)
- [x] #97 story trail: the numbered polyline on the map (already shipped in #71/#74, `StoryTrail.jsx`; issue closed 2026-10-03, line was stale)
- [x] #96 / #190 ambient audio that reads place_class: fictional never speaks, a studio lot or a story setting says so first (2026-11-15)
- [x] #92 Letterboxd linked by username (public RSS, re-syncs on open) (PR #349)
- [x] #92 Simkl sign-in, Netflix CSV, own CSV/JSON list; connections only for signed-in users, kept on the account (PR #357)
- [x] #92 Open Library reading-log CSV, as a books source beside Goodreads (2026-11-16)
- [ ] #92 connectors left: Trakt live sign-in (needs a Trakt OAuth app; its JSON export already works through "Other list"), Kinopoisk (no export or public API), Last.fm (music, unclear fit)
- [ ] #95 growth: budgeted web search + GeoCLIP grounding. Web search runs nightly (data routine); GeoCLIP is blocked in the cloud (huggingface.co answers 403), so it needs the allowlist or a Mac run
- [x] #47 Wikipedia-prose enrichment: shipped 2026-08-01 (`scripts/enrich-from-wikipedia.mjs`, source kind `wikipedia`, ~7.4k rows; Hebrew read 07.11). Line was stale, closed 23.11
- [x] Recreate 2.0 #51: outline ghost (Sobel edges on the device), Photo/Outlines switch, thirds grid with a horizon line (2026-11-17)
- [x] Recreate 2.0 #52: compass guide to the pin (GPS + compass arrow, distance and map direction without a compass, "You're at the spot") (2026-11-18)
- [x] Recreate 2.0 #53: "Coach me" in the live camera, one Opus 5.5 call per tap (pan + distance + tilt, read aloud on the device), signed-in only, 15 a day per account, 60 a day per server (2026-11-19)
- [x] #54 rest (24.11): a public page for a visitor's approved shot, `/shot/<id>`, with its own preview card (then | now for a recreation with a TMDB frame) and "Share" on each approved shot of the place card. Pending, rejected and unknown ids answer 404; a failed read answers 500
- [x] Build a film trip (27.11): 13 templates shaped like the paid film tours (Belfast GoT coast, Dubrovnik, Glenfinnan, Salzburg, Wellington, Albuquerque…), or the films on the map; from the hub or where you are; 2–12 h; on foot or foot + car with ferries. Every leg measured by the OpenStreetMap router or marked as an estimate. Left: confirm car/ferry legs on production; a transit mode needs a transit router; multi-day trips
- [ ] Recreate 2.0: #52 rest, the camera direction and tilt at the spot (needs recreations to save heading + tilt first)
- [ ] #53 rest: a persistent coach counter (in-memory caps reset per server instance; a table needs a prod migration)
- [x] #114 rest (22.11): measured at 320, 360, 844×390, 768 and 1024 with the touch audit; 44 small controls (summed over the five sizes) → 0, the pin key no longer covers the layers button on its side, iPhone home-screen icon + standalone tags; Chromium reports the app installable. Still device-only: sheet swipe, soft keyboard, notch
- [x] #70 rest (25.11): a kept walk also keeps its spoken stops. The trail's arrival sentences (`trailStopText`, up to 12) are fetched through /api/narration when the route is built and stored in the walk's cache under `/walk-audio/neutral?t=<text>`; the walk's voice looks there first, so a stop is heard without a signal. The card says "N map tiles and M spoken stops kept". 23.11: tiles in their own cache, real size, "Remove offline copy". Not kept: "Listen as I walk" tellings, which depend on the live nearby feed
- [x] #65 streaming narration (26.11): /api/narration also answers a GET, streamed as OpenAI speaks (`speech.body.tee()`, one copy to the listener, one to the TTS cache once the stream ends). The voice guide and the walk's voice point an `<audio>` element at it, so sound starts at the first bytes; a stream that errors or stays silent 12 s falls back to the whole-clip POST
- [x] #77 rest (27.11): a shared link to a work unfurls with a picture. `/work/<slug>` has a preview card (poster, title, "N places on the map", the first three place names, never a scene), and the map link that "Share trail" sends (`/?work=<uuid>`) carries the same card and a title ("Walk Notting Hill (1999)" for walking order). The map page is now a server shell over the client app; its preview read gives up after 2.5 s and falls back to the plain GloryMap preview
- [x] #69 fact-checked narration (28.11): the tour guide's words are checked against the facts it was given (`narration-check.mjs`). A stop that adds a year, a figure or (in English) a name nobody supplied is read as a plain line from our record instead; the title and intro the same way. The voice guide says where its words come from, links the place's source, and says when the AI's line was replaced. Not yet: Wikipedia prose or a verified frame as extra facts for the prompt

## QA findings (routine check, 2026-11-03)

- [ ] Map, a picked work: "Known for" says "Nothing here passes your filters" while the work's pins are drawn (seen with Notting Hill over London). The Places list half is fixed (09.11: it now lists the picked work's own places). Needs a check on production with real tiles: the cloud browser can't load the basemap.
- [x] (21.11, fixed: `/api/work?id=` answers 502 on a failed read, the page reads it through `readRoute` and answers 500) `/work/<slug>` answers 404 when the database fails: `/api/work` swallows the load error and returns `work.title: null`. Same fix as the city/place/letter pages (#readRoute), but the route has to say 502 first.
- [ ] (04.11) The directory letter pages still hit a statement timeout now and then at runtime (`/directory/films/n?page=2` answered 500, then 0.23 s on the next 8 asks). `catalogue_letter` reads the `catalogue_index` view, which groups every `location_submissions` row on each call. Fix in the DB: a materialized view refreshed after ingest, or an index on `directory_sort_key(title_norm)`. Needs the schema owner.
- [x] (07.11) Hebrew Wikipedia read for the Israeli catalogue: 636 works, 253 places queued, 136 with a point; candidates in Israel 43 → 116 (PR #360, #362). The prompt now keeps names in the article's script, so drops for an English name on a Hebrew quote went from 75 to 2.
- [x] (20.11, fixed: nearby reads our own queue in parallel; Wikidata gets 6 s to add to it, and its failure no longer empties the list) (18.11) "What's nearby" depends on a live Wikidata geo query alone. Today a new spot took 13–18 s and one answered 504 at the 18 s timeout, so the phone onboarding said "Could not load the places nearby" (repeat asks are cached and fast). Same day: `map_candidate_points_in_view` and `catalogue_letter` hit statement timeouts. Fix: answer nearby from our own `locations`/`location_submissions` first and use Wikidata only to add to it, so a slow WDQS can't empty the map.
- [ ] Production (`glory-map.vercel.app`) is not reachable from cloud sessions; QA runs a local prod build against the live DB. Add the domain to the cloud allowlist to test the real deploy.

## Data coverage (audit 2026-11-13, numbers in wiki/log.md)

- [x] Country and city "pins" off the map; Wikidata filming locations resolved for all 5,009 works (PR #377)
- [ ] GoT 129 and Stranger Things 74 places are moviemaps-only "Unconfirmed": find a second source (Wikidata P915 on the place, fandom, reelstreets) so they can be confirmed
- [x] Add missing big series: Peaky Blinders, The Wire, Succession, Dark, Squid Game (`ingest-country-works.mjs --works`)
- [ ] Web research of filming locations, most IMDb votes first (`scripts/research-locations.mjs`, Haiku + web search, ~$0.06 per work, ~80 works per $5 night, scheduled task "Исследование локаций" nightly). Source kind `web_research` live 2026-11-13. Progress: ledger in /mnt/project-files/glorymap-research/
- [x] Street addresses → points via Nominatim (`scripts/geocode-addresses.mjs`, run with NODE_USE_ENV_PROXY=1 until a new session resolves the host). 48 of 87 research rows placed
- [ ] Geocode the ~19k older rows with an address and no point (reelstreets 7.6k, wikipedia 7.4k, movielocations 4k), ~2,000 a night
- [ ] **City pass** (Nikita 2026-11-19): every country's top-100 cities → the films and series shot there (`scripts/ingest-city-works.mjs --country Q.. --cities 100 --write`: Wikidata P915 + "Films shot in <city>"), then web research in queue order (`research-locations.mjs --queue cities/<Q>.json`). One country a night in the order of `/mnt/project-files/glorymap-research/cities/countries.json` (197 states, big film countries first). Test 19.11: Italy's 10 biggest cities named 1,017 works, 932 not in the catalogue; 10 researched for $0.52 → 90 places
- [ ] 124 of 204 world capitals have no works (mostly Africa, Asia, Oceania): `ingest-country-works.mjs` per country, then the resolver
- [ ] Paris candidates have lower-case address names ("2 rue françois ier, 75008 paris"): give them a real name
- [ ] Places whose Wikidata entity has no English label stay in their own script ("замок де Сонне"): read the label by Q-id, not by search

## In progress

- [ ] …

## Done

- [x] 2026-11-07: Israel on the map. 879 Israeli and shot-in-Israel works (`source='wikidata'`), 23 verified points + 43 candidates in Israel, city pages for Tel Aviv, Jerusalem and Haifa. Fixed `/api/resolve`, which had written no links since 05.08 (RPC `write_resolved_links`) (PR #355, #358)

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
