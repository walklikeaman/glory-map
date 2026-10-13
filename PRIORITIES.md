# ⭐ Priorities — what to do now, and why

> **Status 25.07.2026** — backbone Steps 0, 2, 3 are **done**; Step 1 is partial
> (connectors remain). Shipped since: image attribution (#60), place-photo cascade
> (#56), spoiler shield (#72), TTS cache (#66), plus the logic layers for walk mode
> (#64), geo-triggered narration (#63) and story trails (#71) — those three wait on
> **#114** for their place in the mobile layout, by the rule that nothing new enters
> the side panel until its phone home is decided. 20 issues closed, 49 open.

> This is a **ranking, not a flat list.** It orders every open issue by real
> importance: what unblocks the most, what's a genuine bug, what's polish. The
> star tier is also on every issue as a label chip (`P1 ★★★` / `P2 ★★` / `P3 ★`),
> so you see the rating in the [issue list](https://github.com/walklikeaman/glory-map/issues) too.

**How to read it**

| Tier | Label | Meaning |
|---|---|---|
| ★★★★★ | `P1 ★★★` | **Critical path** — the backbone; everything else assumes it |
| ★★★★ | `P1 ★★★` / `bug` | **Do now, parallel-safe** — real bugs + cheap foundations |
| ★★★ | `P1 ★★★` | Core feature, once its enabling backbone step exists |
| ★★ | `P2 ★★` | Enhancement — makes a good feature better |
| ★ | `P3 ★` | Polish / nice-to-have — later |

The architecture pass ([`ARCHITECTURE.md`](ARCHITECTURE.md)) changed the order:
most thematic "P1" features actually **depend on the content graph existing**. So
the true "now" is the backbone, not the features on top of it.

---

## 🔴 The backbone — do in this exact order (each blocks the next)

This is the critical path. Nothing downstream is trustworthy until it exists.

1. ~~**#91 · Step 0**~~ ✅ **DONE** — `content_graph` + `grounding.mjs` applied
   ([PR #89](https://github.com/walklikeaman/glory-map/pull/89) is
   ready). *Why first: it's the schema + the "never invent a place" invariant every
   other issue relies on. Blocks all of Phase F.*
2. **★★★★★ #92 · Step 1** — 🟡 **PARTIAL**: Letterboxd RSS core, import route and
   the tmdb/imdb/isbn/mbid → wikidata cross-walk shipped. Remaining: Trakt,
   Kinopoisk, Goodreads, Open Library, Last.fm connectors.
   *Why: the funnel floor. The resolver can't anchor a work without a `wikidata_id`;
   nothing has content without import. No code exists yet.*
3. ~~**#93 · Step 2**~~ ✅ **DONE** — Location Resolution Engine MVP (Wikidata + P31
   classification). *Why: this is what actually produces classified, grounded,
   deduped places — the thing every map/tour/audio feature reads.*
4. ~~**#94 · Step 3**~~ ✅ **DONE** — map reads from the graph (PostGIS clusters, canvas).
   *Why: makes the graph visible and handles thousands of points; unblocks the
   "zoom out, see my whole library" experience.*
5. **★★★ #95 · Step 4** — gated web_search + one GeoCLIP+grounding module.
   *Why: growth — extends coverage and adds frame→GPS. Gated, so it comes after the
   free canonical layer works.*
6. **★★★ #96 · Step 5** — ambient audio reads `place_class` from the graph.
7. **★★ #97 · Step 6** — Story Trails. 🟡 Extraction and the spoiler shield exist
   (#71/#72), so this is no longer blocked — the numbered polyline is what remains.

*(#90 is the tracking epic for this sequence.)*

---

## ✅ Do now, parallel-safe (independent of the backbone)

These don't wait for the graph and are cheap + high-value — good first pickups:

- **★★★★ #83 · [bug]** cloud-save race — a real data-loss bug (stale library can
  overwrite fresh). Fix regardless of everything else.
- **★★★★ #60** universal attribution/license component — foundational for all
  imagery, `size-S`, closes legal risk across every source at once.
- **★★★★ #80** single `geo.mjs` (haversine ×4 + coord validation) — foundational
  hygiene used everywhere; prevents drift as new geo code lands.
- **★★★ #84** tests for SPARQL sanitizers + tour/discover handlers — safety on the
  paid/injection paths, `size-S`.

---

## ★★★ Core features — start once their backbone step lands

Ranked within tier; each notes the step that enables it.

| ★ | # | Feature | Enabled by | Why it's high |
|---|---|---|---|---|
| ✅ | ~~44~~ | Precision badge — **shipped** in the film profile (City / Street / Building, Building wins on an OSM snap) | Step 2/3 | The trust signal — the whole "grounded" promise made visible |
| 🟡 | 48 | Vision-verify AI/community locations — **status gate shipped** (pending/verified/rejected, only verified drawn); needs a submission path to gate | Step 2 | The anti-hallucination gate; keeps the map honest |
| ✅ | ~~46~~ | Dedup one place ↔ many works — **shipped**; verified 63 places → 63 groups, 0 false merges | Step 0/2 | Largely absorbed by `work_place_links`; the helper now guards places created without a QID |
| ✅ | ~~56~~ | Source cascade for "place now" — **shipped** | Step 3 | The wow imagery, legally clean, no Street-View lock |
| ★★★ | 50 | ShotSync live-camera ghost overlay | — | The signature feature, web-first; standalone |
| ✅ | ~~63~~ | Scene-nearby GPS narration — **shipped and visible**: triggers wired to the on-map walk control | Step 5 | The audio-guide core loop |
| ✅ | ~~64~~ | Walk mode (Wake Lock) — **shipped and visible** on the map, walking the work's real locations | — | Cheap enabler that makes geo-triggers actually work |
| ✅ | ~~66~~ | TTS cache by content hash — **shipped**, replay verified free | — | Cheap; makes replays free — cost control before scaling audio |
| ✅ | ~~71~~ | Story-trail mode — **shipped**: Skyfall walks Istanbul → London → National Gallery → Shanghai → Hashima → London, spoiler-free by default | Step 6 | The differentiator; needs `scenes` first |
| ✅ | ~~72~~ | Spoiler shield — **shipped**, enforced in SQL | Step 6 | No competitor has it; small once trails exist |
| ✅ | ~~45~~ | OSM building-footprint snap — **shipped**, live on production | Step 2 | House-level precision |
| ★★★ | 47 | Wikipedia-prose AI enrichment (spike) | Step 1/2 | Big coverage expansion; `size-L` spike |
| ✅ | ~~120~~ | Enrich/snap/trail routes closed behind a token — fail-closed, constant-time, verified on production | — | Was required before the map is shown to anyone outside the team |
| 🟡 | 114 | Adaptive layout — **the rule is set** (outdoor features live on the map, not the panel), which unblocked #63/#64/#71; tablet, landscape, ≤360px and PWA still open | — | The pattern that kept burying finished work |

---

## ★★ Enhancements (P2 — after the core works)

Recreate: **51** edge-ghost · **52** compass-to-shot · **53** AI alignment coach ·
**54** share diptych.
Imagery: **57** before/after slider · **58** community uploads · **59** vision
auto-attach · **61** report/DMCA flow.
Audio: **65** streaming narration · **67** multilingual · **69** fact-checked
narration.
Story: **73** order toggle · **74** city-chapters.
Product: **19** check-ins · **22** bottom nav + profile · **23** interactive card ·
**49** fix-the-pin.
Tech-debt: **81** OpenAI-route helper · **82** split buildTimedTour.

## ★ Later (P3 — polish / someday)

Recreate **55** gallery · Imagery **62** trip reel · Audio **68** genre voice ·
**70** offline tours · Story **75** timeline scrubber · **76** character filter ·
**77** export trail · Product **15** onboarding · Tech-debt **85**/**86**/**87**/**88**.

---

## What NOT to start yet

The thematic features are tempting but most **read from the graph**. Building a
precision badge (#44) or a source cascade (#56) before Step 2 exists means
building against nothing. **Land the backbone (Steps 0→3) first**, pick from
"Do now, parallel-safe" alongside it, then the ★★★ features unlock in order.
