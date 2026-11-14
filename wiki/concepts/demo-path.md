---
type: concept
created: 2026-07-22
updated: 2026-07-22
sources: [code, log]
---
# Demo path (sacred)

The one scenario that must work on stage (the "Project" section in
`AGENTS.md`). Everything else is out of scope until it is green.

1. Open [[glorymap-app]] → map of London with locations (or your own films from
   [[personal-library]]).
2. Pick a city / "Use my location" ([[nearby-geolocation]]).
3. Open a location card: link to the work, a "the place now" photo,
   an AI film still ([[film-imagery]]), an audio guide ([[tours-and-voice]]).
4. Add 3 points → walking route (or a tour on a 30/60/120-minute budget).

Demo safeguards baked into the code: London fallback dataset, dashed
route when OSRM fails, deterministic fallback guide without AI, demo-location
(Trafalgar) when geo is denied. A 60–90 sec screencast of the green path is insurance
against the stage Wi-Fi.

Out of scope (owner's decisions): auth, audio clips from films, live Letterboxd/Amazon
APIs, scraping, Tel Aviv as a demo city (empty in the data).
