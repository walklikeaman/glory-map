---
type: concept
created: 2026-09-11
updated: 2026-09-11
sources: [code, log]
---
# The trip-agent bridge — one plan, four possible transports

`POST /api/trip/plan` + [app/lib/trip-plan.mjs](../../app/lib/trip-plan.mjs). The door an
outside planning agent knocks on to put a GloryMap place into a day.

## What was asked, and the one question that is still open

The owner plans travel with a trip agent that is not this codebase, and wants it to build
day plans out of our places and routes. **What that agent actually IS has not been
answered** — another agent session speaking MCP, a third-party product with its own API, a
custom GPT, or something he is still building. The four want four different transports.

So what is built here is the half that is identical in all four: **the answer**. An MCP tool
wraps this route, a GPT action calls it, a product integration posts to it, an export saves
what it returns. The wrapper is not built, because choosing it is the owner's call and
guessing it is the expensive kind of wrong.

## The measurement that decided the shape

The obvious bridge is "export the verified graph". Measured against the city he is actually
going to, **2026-09-10 15:08 UTC**:

| | |
|---|---|
| places in the graph, worldwide | 70 |
| places in the graph inside the Los Angeles viewport | **1** — "Los Angeles", Q65, city precision |
| queue rows inside the same viewport | **4,665** (1 verified, 4,664 pending), 1,500 works |

A bridge over the graph alone answers a Los Angeles day with one stop, and that stop is the
city the traveller is standing in. So the bridge is built on **candidates**, and the
labelling stops being a courtesy on top of the payload and becomes the payload: every stop
states which store it came from, who said it, and whether anybody has looked.

Second measurement, same 4,665 rows: **150 (3.2%) are inside a studio lot, 4,515 (96.8%) are
on the street.** The 96.8% is the product. The 150 are what would embarrass us.

The name test [[studio-lots]] rejected, re-run here over all 4,665: a regex of studio words
calls **87 rows a lot that are not** (Culver City High School, The Century Plaza, Red
Studios) and **misses 93 that are** (Western Town, Courthouse Square, Former Western
Backlot) — 180 wrong against the 150 it is trying to find. The polygon is not a nicety.

## What the plan refuses, and why each refusal is a different question

Nothing is silently dropped: a refused row comes back in `excluded[]` with its reason, its
`note` (what the place is) and its `access_note` (whether the gate opens). An agent that
cannot see the refusal re-proposes it from its own sources — and "Universal Studios" is
exactly the row it would re-propose.

| reason | the question it answers |
|---|---|
| `not_a_route_stop` | is this even a stop? `ROUTE_BLOCK_DISTANCES` — an influence is where an idea came from |
| `not_a_spot` | is there anywhere to stand? `isPinnable` — a city is not a doorway |
| `closed` | is there anything to walk to? |
| `studio_lot_no_entry` | can they pass the gate? `view_only` says never |
| `studio_lot_needs_booking` | can they pass it today, on foot, mid-walk? A studio tour is a booking and half a day |
| `not_in_library` | is it one of the traveller's own films? |

**A lot on public land is kept.** Paramount Ranch is a National Park Service site, `ACCESS.open`,
and you can walk in. It is the case that proves the rule is about the fence and not the word.

## The four defects live data found, in the order it found them

Each was invisible in a unit test and obvious the moment the planner met the real viewport.

1. **Five stops that were one theatre.** `timed-tour.mjs` keys its multi-film merge on
   `locationId`, and ours is per SUBMISSION — one row per (work, place) pair — so every key
   was unique and the merge never fired. The first Hollywood plan was Grauman's Chinese
   Theatre five times over, with a one-minute walk. Withholding the id is what makes a
   multi-film stop one stop.
2. **Three spellings of that theatre were still three stops.** Two sources name the same
   building three ways 11 m apart. `dedupePlaces` collapses nothing here — `place-dedup`'s
   rule turns on `geocode_precision` and `place_class`, which a queue row does not carry, so
   every candidate falls to precision "none" and is refused. Loosening `canMerge` would
   loosen it for the graph, where the six closest pairs are genuinely different places. So
   `collapseSameSpot` asks a narrower question with the same primitives. On the live
   Hollywood viewport it takes **296 rows to 128 stops**; of the 39 groups that merged, 30
   were exact duplicates and **all 9 cross-spelling merges are correct**, audited by hand.
   Grauman's *Chinese* and Grauman's *Egyptian* stay two stops.
3. **The collapse then ate the films.** 25 rows for Grauman's became one stop carrying
   "Forrest Gump" alone — losing the twenty other films that are the entire reason to stand
   there. Both merges are now unioned.
4. **The best-evidenced row in the plan was the worst stop.** The LA basin's one verified
   place is the city centroid, and it was routed to as stop 3 of 5 carrying zero films. This
   is [[three-axes]]' Istanbul case reaching a live path: perfect evidence, nowhere to
   stand. `isPinnable` now refuses it — but only where a precision was actually recorded,
   because 4,664 of the 4,665 LA rows carry none and reading that silence as "too coarse"
   would empty the city.

## The library never leaves the browser

If the agent wants "my films", the **client passes the titles**; nothing here reads a
library. That is why the route is POST — a URL is logged, cached and refer(r)ed, and a body
is not. The list is compared in memory with `libraryEntryFor` (the project's one matcher, so
a plan and the map filter can never disagree about which film matched), never stored, never
logged, and never echoed back. **A plan carrying a library is `private, no-store`** and is
not cached at the edge; without one the viewport's answer is the same for everybody and
caches for an hour.

Verified live: a four-film library over the Hollywood viewport returns Musso & Frank Grill,
the Frolic Room, 1648 Wilcox Avenue and Vine Street — 2.3 km, 31 minutes — and the ellipsis
in "Once Upon a Time… in Hollywood" does not lose the match.

## The budget is a ceiling, not a target

`createTimedTourCandidates` ranks by stop count, then confirmed access, then nearest to the
origin — right for a walking tour you start where you are standing. `pickForBudget` re-ranks
what it returns for a day plan (the longest walk that still fits), which on live Hollywood
moved the walk **from 5 minutes to 7** and made it cross the block rather than zig-zag.

**It does not fill the budget and no ranking could.** Every candidate is nearest-neighbour
from one of 8 seeds, and nearest-neighbour makes tight clusters by construction: against 120
minutes the longest walk available in Hollywood is seven. `budget_note` says so out loud
rather than letting a caller read 120 and imagine an afternoon.

## Verified end to end on live Los Angeles

Against the production graph and the real OSRM foot router, on the built server:

| viewport | result |
|---|---|
| Hollywood, no library | 5 stops, 0.7 km / 10 min, 706 ms. Grauman's carries **22 films**, the Roosevelt 11 |
| Hollywood, 4-film library | 4 stops, 2.3 km / 31 min, `private, no-store` |
| LA basin, 120 min | Arthur J. Will Fountain → Ahmanson Theatre → **2nd Street Tunnel (38 films)** → 3rd Street Tunnel → 650 S Spring St, 2.4 km / 33 min. 11 lot rows and the city centroid refused |

`coverage.truncated` is reached in practice, not in theory: the viewport cap is 1,000 rows
and Los Angeles holds 4,665.

## Gotchas

- The pool is the nearest **60** to the origin. Handing `createTimedTourCandidates` a whole
  city means n = 4,515 through an O(n² log n) pass per seed, which is not a planner, it is a
  hang.
- `TOUR_MIN_STOPS` is 3, so a viewport with two eligible stops returns `enough: false` and no
  walk. That is the product's floor, not the router's (which is 2).
- A dead router loses the line and never the plan — five addresses in walking order is still
  an afternoon.
- Nothing here writes. No migration, no new table, no new RPC: it reads
  `map_points_in_view` and `map_candidate_points_in_view`, the same two the map uses, so a
  plan and the pins can never disagree about what is there.

See also: [[studio-lots]], [[three-axes]], [[place-card]], [[personal-library]],
[[tours-and-voice]], [[fact-architecture]].
