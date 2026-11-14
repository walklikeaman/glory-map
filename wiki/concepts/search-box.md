---
type: concept
created: 2026-08-18
updated: 2026-08-18
sources: [code, log]
---
# The search box — one field, two kinds of answer, two latencies

Issue #145. The box is the only way into everything this project holds: 7,063 works,
~31,000 submitted places and two surfaces. Before it there were two fields side by side —
a city field and a title field — each hitting a different service and neither able to
suggest the other's kind.

Related: [[geocoding-cascade]], [[demo-path]], [[fact-architecture]].

## The rule the whole component is built around

**Never await the two halves together.** `/api/search` is one indexed query over our own
database; `/api/cities/suggest` is Wikidata over the network. A combined endpoint that
returns when both are ready makes the fast half as slow as the slow half on every
keystroke, which is the one thing a type-ahead may not be.

So: two requests, two debounces (140 ms for our index, 320 ms for the gazetteer), two
groups that paint independently.

**Films are listed first, and that is a correctness decision rather than a preference.**
The slower group must grow the list DOWNWARD; if cities were first, their arrival would
push the row under the cursor out from under it mid-keystroke.

Two more consequences of the same asynchrony:

- **The cursor is held by key, not by index.** An index into a list that two sources
  append to independently points at a different row the moment the slower one lands.
- **A stale response can never win.** Every keystroke aborts the request before it AND
  carries a serial number, because an abort and a resolve can race and the loser still
  calls `setState`.

## Why the city half is not Nominatim

`/api/cities` — the Nominatim route that has been here since the beginning — answers ONE
city per submitted form. That is a single request per Enter, and squarely inside the OSMF
usage policy. **A type-ahead is a different act**: it fires on keystrokes, and the policy
names auto-complete search on the public instance as unacceptable use outright. The same
policy already cost us the bulk path ([[geocoding-cascade]]), for the neighbouring
reason.

So the suggestions come from **Wikidata**, which is already this project's gazetteer of
record: CC0, nothing owed on attribution, results freely storable, and `wikibase:mwapi`
runs the same entity search Wikidata's own box uses.

`/api/cities` did not become dead code, and it did not become a per-keystroke fallback
either — that would hammer the service precisely on the queries Wikidata cannot answer.
It sits behind **one row in the dropdown**: "Look “<query>” up as a place", offered when
the gazetteer returns nothing or does not answer at all. One request, clicked for.

## What the city query does and does not do

```
mwapi EntitySearch (≤50 candidates)
  → require wdt:P625            a thing with no coordinate is not somewhere to go
  → drop P580 / P585            a thing with a date happened; it is not a place
  → direct P31 label only       NO P279* closure
  → rank inhabited first        a stated population or area, then sitelinks, then size
```

Both filters are inherited rather than invented, and both were measured elsewhere in this
project:

- **The subclass closure is the trap.** `wdt:P31/wdt:P279*` over every label match took
  65 seconds and returned 504 for a single name; requiring a coordinate does most of the
  same work, and `isPlaceType` drops the rest in code — the shipwreck and the bark that
  answer to "Victoria".
- **Label match is not a ranking.** `wbsearchentities` ranks by how well a label matches
  the string and nothing else, which is how "Skyfall" returns a lyric video first. How
  many Wikipedias wrote about a thing is what separates the London somebody means from
  the eleven they do not: London Q84 has ~400 sitelinks, London, Ontario has ~94.

**A thing that happened is not a thing that is**, and production found that before any
review did. The first live answer for "lond" put **the 2012 Summer Olympics second**,
above Derry: an Olympiad has a venue coordinate and 200 Wikipedias behind it, and
`isPlaceType` only knows about shipwrecks. One property separates the two classes with no
taxonomy and no subclass walk — **a city has no start time**. Candidates carrying P580 or
P585 are dropped.

**And cities come before places, in that order.** The same answer offered the University
of London above Derry on sitelinks alone. A settlement or an administrative area states
how many people live there or how big it is; a university, a bridge and a pub state
neither, so "somewhere inhabited" is the first sort key and fame only orders within each
band.

A pub called Istanbul Grill is still not refused — it sorts below every city, and its own
description says what it is. Refusing it outright would need the taxonomy this query
deliberately does not walk.

**The radius comes from the stated area** (P2046, normalised to m² by WDQS), turned into
the radius of a circle of the same size and clamped to 5–50 km. With no area stated it is
15 km, the same default the bounding-box version fell back to. The radius decides only
what counts as "here" once a city is picked; the viewport decides what is fetched.

## What a row does when you click it

- **A city** recentres the map.
- **A film** shows its places on the map — not a navigation. The map is what the box is
  attached to and it is the [[demo-path]]: a juror names a film, we type it, it is there.
- **The card** is the other surface and gets its own way out of the row: a real link to
  `/work/<slug>--<uuid>`, so it can be middle-clicked, copied or sent. The path is built
  by `workPath`, the same function the page parses, so the two cannot drift.

## Failure is a state, not an error

The suggest route answers `200 {suggestions: [], unavailable: true}` when WDQS is down or
slow — a gazetteer that is unreachable must not fail the box around it. The film half is
a separate request and is unaffected, and the empty group offers the Nominatim lookup, so
the box degrades into the search that existed before #145 rather than into an error
nobody can act on.

The empty states say which kind was searched, because "no results" over a box that
searches two things is not an answer:

| state | what the group says |
|---|---|
| our catalogue has nothing | Nothing in our catalogue is called “x”. Press Enter to look the title up on Wikidata. |
| our catalogue did not answer | Our catalogue did not answer. Press Enter … |
| Wikidata has no such place | No place on Wikidata is called “x”. + the lookup row |
| WDQS did not answer | The place gazetteer did not answer. + the lookup row |

## Verified in a browser, not only in tests

Driven with Playwright against a production build on 18.08: the film group paints while
the city request is still open, the city group appends below it without moving the
cursor, ArrowDown walks all three rows of the two groups as one list,
`aria-activedescendant` follows, Escape closes. Wikidata is unreachable from the
development machine (filtered egress), so what that run proved live is the **degraded**
path; the ranking is covered by fixtures in `test/city-search.test.mjs`.

The live shape was seen for the first time through the smoke step the production deploy
now runs, and it paid for itself immediately: `/api/cities/suggest?q=lond` answered in
1.10 s with London first, its radius 23 km derived from the stated area — and with the
Olympics second. **On a project whose development machine cannot reach any of its own
services, that step is the only measuring instrument there is.**
