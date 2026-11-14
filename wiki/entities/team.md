---
type: entity
created: 2026-07-22
updated: 2026-07-22
sources: [code, log]
---
# Team — who does what (per git history)

Roles in TASKS.md are not formally filled in; the actual split is visible from the
commits (as of 22.07.2026):

- **Andrey (GitHub timido22, commits as vitebskiy.andrey — apparently
  one person)** — the de facto integrator (merges most PRs into main:
  #27, #29, #32, #34, #35, #36, #39) and backend quality: live
  Wikidata locations, walking routes, scene matching, multi-location search,
  viewport refresh, sourced discovery.
- **Nikita Nakonechnyi / walklikeaman (owner)** — documentation and README
  (the Devpost series), the GloryMap rebrand, deploy gates, Letterboxd ZIP import;
  owner of the Supabase/Vercel infrastructure.
- **ystalinskaya (Ilana)** — branch feature/yana: city search, personal media
  connectors, current-location-to-map.
- Efim — no repo access (owner's decision on 21.07).

GitHub access: walklikeaman (admin), timido22 (write), yanastalin99 (write,
invitation), gordonefim (write, invitation).

Rules: `feature/*` branches, into main — only the integrator via a PR
(`TEAMWORK.md`); prod deploy — a manual gate ([[deployment-pipeline]]).
