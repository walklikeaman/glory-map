# 🗺️ GloryMap Roadmap

> **Where we are (25.07.2026).** The backbone is walkable end to end: a work can be
> imported, cross-walked to Wikidata, resolved into grounded places, drawn on the map
> from the graph, given cover art and ratings, found by type-ahead, photographed
> ("the place today"), credited, extracted into a story trail, and protected from
> spoilers. What is *not* yet placed is the UI for walk mode, geo-triggered narration
> and the trail polyline — held for **#114** (responsive layout), after the map turned
> out to be 32px tall on an iPhone.

> **Where we're going and why.** This is the roadmap — themed milestones over
> time. The concrete, pick-up-able tasks live as
> [GitHub issues](https://github.com/walklikeaman/glory-map/issues),
> grouped into [Milestones](https://github.com/walklikeaman/glory-map/milestones).

**Roadmap** = the themes and the order (this file).
**Backlog** = the prioritized list of concrete issues, ready to take
([open issues](https://github.com/walklikeaman/glory-map/issues?q=is%3Aissue+is%3Aopen)).
Everything is **ranked by importance** in [`PRIORITIES.md`](PRIORITIES.md) — start there.

## How we work the board

- Each issue has a **theme** (`theme:*`), a **priority** (`P1`/`P2`/`P3`) and a
  **size** (`size-S/M/L`). Pick something that matches your time and interest.
- **Assign it to yourself**, move it in the milestone, open a `feature/<slug>`
  branch, and ship a PR (see [`TEAMWORK.md`](TEAMWORK.md)).
- Start with **P1** items in the lowest-numbered phase — they unblock the rest.
- 🟢 `good first issue` and `size-S` are the easiest on-ramps.

---

## ✅ Shipped — v1.0 (OpenAI Build Week)

Live map · Letterboxd/IMDb import · vision-verified film stills · then/now
imagery · recreate-the-shot · OSRM walking routes · timed tours (30/60/120) ·
AI voice guide · "what's nearby" · Google sign-in + cloud libraries.
See [Releases](https://github.com/walklikeaman/glory-map/releases).

---

## 🏛️ Phase F · Foundation — the grounded content graph *(do first)*
**Goal:** the spine that makes every later phase possible — one canonical content
graph where **every point is backed by evidence, never invented**, and studio /
street / fiction are distinguished at the schema level.
**Design:** [`ARCHITECTURE.md`](ARCHITECTURE.md) — read it before building here.

Build order (each step unblocks the next):

- ~~**Step 0**~~ ✅ `content_graph` migration + `grounding.mjs`
- 🟡 **Step 1** — Letterboxd RSS + import route + ID cross-walk **done**; Trakt / Kinopoisk / Goodreads / Open Library / Last.fm remain
- ~~**Step 2**~~ ✅ Location Resolution Engine MVP (Wikidata Stage 0 + P31 classification, persist/dedup)
- ~~**Step 3**~~ ✅ map reads from the graph: `place_class`+confidence inline, PostGIS bbox/cluster RPC, canvas markers
- **Step 4** — growth (gated): budgeted web_search + one deferred GeoCLIP + Mapillary/Commons grounding module
- 🟡 **Step 5** — TTS cache **done**; geo-trigger logic **done**; ambient audio reading `place_class` still to wire
- 🟡 **Step 6** — trail extraction + spoiler shield **done**; the numbered narrative polyline remains

*Why first:* the current phases below assume trustworthy, deduped, classified
places. Phase F is the schema and grounding that guarantees them. The thematic
phases are the features; Phase F is the engine underneath.

---

## 🎯 Phase 1 · Precision & Trust
**Goal:** make every pin trustworthy — city, street, or exact building, with its
source shown. Accuracy is the foundation everything else stands on.
**Milestone:** [Phase 1](https://github.com/walklikeaman/glory-map/milestone/1) · 6 issues

- Precision badge (city/street/building + source) · OSM building-footprint snap
- Dedup one place shared by many works · Wikipedia-prose AI enrichment (spike)
- Vision-verify AI/community locations · Fix-the-pin feedback loop

*Why first:* competitors hide precision; provable accuracy is our credibility
and unlocks better routes and trips.

## 📸 Phase 2 · Recreate the Shot 2.0
**Goal:** turn our signature feature into the best-in-class, web-first "stand
where the camera stood" experience.
**Milestone:** [Phase 2](https://github.com/walklikeaman/glory-map/milestone/2) · 6 issues

- Live-camera ghost overlay (ShotSync) · Edge-ghost contour alignment
- Compass navigator to the exact spot · AI alignment coach (vision + voice)
- "Film \| My photo" share card · My recreations gallery + community feed

*Why:* SetJetters charges for this and it's mobile-only — we do it free in the
browser, and the share cards drive organic growth.

## 🖼️ Phase 3 · Living Imagery
**Goal:** fresh, legally-clean photography for every place — no Street View
lock-in, community-fed, correctly attributed.
**Milestone:** [Phase 3](https://github.com/walklikeaman/glory-map/milestone/3) · 7 issues

- Source cascade Mapillary → Wikimedia → Street View · Before/after slider
- Community uploads with auto-moderation · Vision auto-attach uploads
- Universal attribution component · Report/DMCA flow · Cinema Trip Reel

*Why:* imagery is the wow, but Street View can't be stored — free-license
sources make before/after composites and sharing legal at scale.

## 🎧 Phase 4 · AI Guide on the Move
**Goal:** narration that unlocks on location and follows you as you walk — in
your language, grounded in sources.
**Milestone:** [Phase 4](https://github.com/walklikeaman/glory-map/milestone/4) · 8 issues

- Scene-nearby GPS-triggered narration · Walk mode (Wake Lock) — *both built*
- **Ambient narration: triggers on what you walk past, not a route you built**
  ([#190](https://github.com/walklikeaman/glory-map/issues/190))
- Streaming narration · TTS cache · Multilingual · Genre-styled voice
- Fact-checked & sourced narration · Offline tour download

*Why:* this is the audio-guide genre's core loop (Autio/VoiceMap) — but tied to
**your** films and our verified places, not generic POIs.

## 🔌 Phase 6 · Let other software use this
**Goal:** an outside planner, an agent, or the traveller's own maps app can act on
what we hold — without our sources' terms being breached in our name.
**Issue:** [#191](https://github.com/walklikeaman/glory-map/issues/191)

- Licence review per source *(first, and everything is contingent on it)*
- "Open in Google Maps" + KML/GPX export · MCP server over the existing routes
- Read API with keys and rate limits · *(webhooks: explicitly not being built)*

*Why:* `POST /api/trip/plan` already answers a planning agent; what is missing is the
transport, and the written answer to what we may redistribute. **We own 92 facts; the
other 44,032 rows belong to somebody else**, and serving them is a different act from
showing them with a link.

## 📖 Phase 5 · Story Trails
**Goal:** follow a film or book by its **plot** — walk the story as it unfolds,
spoiler-safe. The most differentiated thing we can build.
**Milestone:** [Phase 5](https://github.com/walklikeaman/glory-map/milestone/5) · 7 issues

- Story-trail mode (numbered narrative path) · Spoiler shield
- Story-order ↔ walking-order toggle · Auto city-chapters
- Timeline scrubber · Character filter · Export/share a trail

*Why:* no competitor auto-generates a narrative-ordered trail from your own
library — and it unifies our films **and** books in one sequence.

## 🧭 Phase 0 · Product Polish *(parallel track)*
**Goal:** turn the demo into a product people keep — onboarding, a real profile,
check-ins and achievements.
**Milestone:** [Phase 0](https://github.com/walklikeaman/glory-map/milestone/6) · 4 issues

- Onboarding + interest selection · Interactive place card
- Bottom nav + profile · Check-in, progress, first achievement

*Why:* retention scaffolding — can be picked up anytime alongside the themed
phases (these are the original MVP issues #15/#19/#22/#23).

---

## Themes at a glance

| Theme | What it covers |
|---|---|
| `theme:locations` | accuracy, coverage, dedup, verification |
| `theme:recreate-shot` | live camera, overlays, alignment, sharing |
| `theme:imagery` | photo sources, before/after, UGC, attribution |
| `theme:ai-tours` | geo-triggered audio, TTS, multilingual, offline |
| `theme:plot-routes` | story trails, spoilers, timeline, characters |
| `theme:social` / `theme:onboarding` | profile, check-ins, first-run |

*Research behind this roadmap (competitors, APIs, legal notes) lives in
[`wiki/sources/feature-research.md`](wiki/sources/feature-research.md).*
