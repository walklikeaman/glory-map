# Knowledge Base Index

Read this FIRST each session. The wiki is the agent's compounding memory —
decisions, gotchas, and domain knowledge live here so the next session (and the
next teammate) starts smarter, not from zero.

Full rebuild on 22.07.2026 after reading through all the code; kept current since
(559 tests, main). Open the repository as an Obsidian vault — the `[[links]]` form a graph.

## Overview

- [overview.md](overview.md) — synthesis: how everything is wired + facts that are easy to forget

## How agents work here

Rules: [`docs/RULES.md`](../docs/RULES.md) · method: [`docs/agent-method.md`](../docs/agent-method.md)
· bans and lessons: [`.loops/`](../.loops/guardrails.md). Every page carries frontmatter
(`type`, `created`, `updated`, `sources`); `test/wiki.test.mjs` checks it.

- [agent-harness](concepts/agent-harness.md) — which layer answers which question; the
  habits before, during and after a task; what enforces them
- [autonomous-operations](concepts/autonomous-operations.md) — the three daily routines,
  what has a standing yes and what still needs Nikita, moderation, money
- [cloud-environment](concepts/cloud-environment.md) — what the cloud container reaches,
  the key-name workaround, DB writes, browser checks

## Entities (what exists)

- [glorymap-app](entities/glorymap-app.md) — the product, the graph hub
- [frontend](entities/frontend.md) — the SceneMapApp + VoiceGuide monolith, patterns and gotchas
- [api-layer](entities/api-layer.md) — the BFF routes: contracts, timeouts, caches
  (+ `POST /api/access` since 05.08 — one Overpass call per tour, see [[three-axes]])
- [wikidata](entities/wikidata.md) — P915/P840/P4947, SPARQL, limits, gotchas
- [openai](entities/openai.md) — 4 model roles, principles of distrust, incidents
- [external-services](entities/external-services.md) — Nominatim, OSRM, TMDB, Commons
- [supabase](entities/supabase.md) — auth + cloud libraries; locations stay live
- [deployment-pipeline](entities/deployment-pipeline.md) — staging automatically, prod manually
- [team](entities/team.md) — who does what per git history, access rights

- [handoff](handoff.md) — read first in a new session: unwired modules, traps, keys, next steps
- [handoff-local](handoff-local.md) — which work cannot be verified from a cloud container
  and why, the four pages step 4 of #129 is checked against, and the local traps

## Concepts (how it works)

- [demo-path](concepts/demo-path.md) — the one sacred scenario
- [search-box](concepts/search-box.md) — one field, two kinds of answer, two latencies; why the
  city half is Wikidata and not Nominatim
- [directory](concepts/directory.md) — a city is a point and a radius, never a name; how the
  gazetteer was derived, and the 6,378 empty cards the catalogue nearly pointed at
- [fact-architecture](concepts/fact-architecture.md) — a fact has identity, payload and its
  own sentence; degree of separation; and the on_conflict outage found while writing it
- [queue-review](concepts/queue-review.md) — what a rule may decide about a submission and
  what nobody can; the two rules that were wrong first, and why 13,841 rows have no point
- [personal-library](concepts/personal-library.md) — Letterboxd ZIP/CSV, privacy
- [location-discovery](concepts/location-discovery.md) — three paths; a model may name a place, never locate one
- [film-permits](concepts/film-permits.md) — the only primary source: the city that issued the permit
- [moviemaps-source](concepts/moviemaps-source.md) — 18k geocoded places from a scrape; a lead, not a licence
- [reelstreets-source](concepts/reelstreets-source.md) — prose read by a model, 53k photographs of the place today, no coordinates
- [movielocations-source](concepts/movielocations-source.md) — captions a regex can read; no model call anywhere
- [model-providers](concepts/model-providers.md) — which model answers, and the request shape both honour
- [geocoding-cascade](concepts/geocoding-cascade.md) — names → points via Wikidata; refusing homonyms is the feature
- [wikipedia-enrichment](concepts/wikipedia-enrichment.md) — Production prose → review queue, quote checked verbatim
- [film-frames](concepts/film-frames.md) — three tiers of frame, and what each may claim
- [film-imagery](concepts/film-imagery.md) — HMAC token → vision → only high confidence
- [tours-and-voice](concepts/tours-and-voice.md) — route, timed tour, AI tour, TTS
- [nearby-geolocation](concepts/nearby-geolocation.md) — "what's nearby", radii, demo fallback
- [three-axes](concepts/three-axes.md) — evidence, precision, access: never one number
- [place-card](concepts/place-card.md) — the panel and the page: one table read from both
  ends, why every fact needs its own source, and the ORDER BY tie that let the two ends
  disagree; tabs, a takeable coordinate, the `[hidden]` rule any class outranks
- [agent-tools](concepts/agent-tools.md) — GloryMap as six MCP tools; why they call the API
  rather than the database, and the one dedup rule deliberately looser than the graph's
- [demo-library](concepts/demo-library.md) — a real Letterboxd export locally, never
  committed, never shipped
- [studio-lots](concepts/studio-lots.md) — a fence is a polygon, never a name; why the
  Hilton is inside Universal's bounding box and outside Universal
- [place-precision](concepts/place-precision.md) — when a pin may move, when two pins are one place
- [trip-agent-bridge](concepts/trip-agent-bridge.md) — `POST /api/trip/plan`: one day plan an
  outside agent can act on, the four refusals it prints, and the four defects live Los
  Angeles found; the transport that wraps it is still the owner's open question
- [testing-conventions](concepts/testing-conventions.md) — node:test, zero network, DI pattern
- [fandom-discovery](concepts/fandom-discovery.md) — where to read Fandom, and what prose costs

## Sources (external knowledge)

- [scenemap-brief](sources/scenemap-brief.md) — the July brief in `Context/`: the idea,
  the sacred demo path, the data contract that is history now
- [planning-docs](sources/planning-docs.md) — TASKS, PRIORITIES, ROADMAP, IDEAS,
  ARCHITECTURE, GUIDE: which one answers what, and which are stale

- [personal-collections-matrix](sources/personal-collections-matrix.md) —
  where to read personal collections from (research 22.07, verified live) + ideas
  (film stills, "paste your Letterboxd handle")
- [source-evaluation](sources/source-evaluation.md) — IMDb, Fandom and frame corpora: what
  we looked at and refused; and the Fandom refusal overturned in September, because it held
  one fan project to a standard the other three were waved past
- [commemorative-plaques](sources/commemorative-plaques.md) — plaques on facades:
  47,064 public-domain points where the quote is already written on the wall (issue #125)
- [feature-research](sources/feature-research.md) — competitors, APIs and legal
  notes behind `ROADMAP.md` and backlog issues #44–#77
- `Context/brief-scenemap-design.md` — the original product brief
- `.planning/codebase/` — 7 reference documents (ARCHITECTURE, CONCERNS…)
- `wiki/log.md` — the chronicle of decisions (append-only, newest on top)

## Superseded

- (none yet)
