---
type: concept
created: 2026-08-19
updated: 2026-09-10
sources: [code, log]
---
# The place card — tabs, a takeable coordinate, and two different numbers

What the card does now, and the bugs found while making it do it (#160, then #129 step 4).
Related: [[three-axes]], [[place-precision]], [[directory]], [[fact-architecture]].

## Tabs, and the one that is not there

The card was a single scroll holding the sentence, the precision badge, the evidence, the
voice guide, two images, "Recreate this shot", three external links and "Add to route" —
unrelated things in one column, with the route controls pushing the sentence about the
place out of sight. It is now **Details / Route**.

**There is no Discussion tab.** The reference has one and #157 is not built; a tab that
opens onto nothing is the padding this project refuses elsewhere. `PLACE_TABS` in
[app/lib/place-card.mjs](../../app/lib/place-card.mjs) is where it goes the day #157 lands, one
line, without rearranging the card again.

**The card reopens on Details whenever the place changes.** Otherwise clicking a new pin
shows route controls where the sentence should be, which is the thing tabs were meant to
stop.

The Route tab says something before anything is on the route — *"Nothing on your route yet.
This place can be the first stop."* — and names the limits instead of enforcing them
silently: the old button simply did nothing at five stops, which reads as a broken button
rather than as a full route.

## The coordinate

Printed at four decimals and copied at four decimals. **A copy button that hands over more
precision than the page displayed is inventing digits** — most of these were located from a
gazetteer, not with a theodolite; six decimals is 11 cm.

The copied text is a bare pair, `51.4969, -0.1716`, with no label and no degree signs,
because it is pasted into a maps app and not into an essay. `(0, 0)` is never copyable:
`Number("")` is 0 and 0 is finite, and this project has had four Null Island incidents.

**Clipboard failure is reported, not swallowed.** `navigator.clipboard` is undefined outside
a secure context and rejects when the document is not focused. Verified: in a headless
context the write is refused and the card says *"Copying was blocked — select the number and
copy it by hand."* A copy button that silently does nothing is worse than one that admits it.

## Two numbers, and why one was not enough

The panel said `10 in London` — how many rows it was listing. That could not distinguish
**"we hold little here"** from **"you are zoomed too far out"**, which is the whole reason
the reference prints "8 LOCATIONS VISIBLE". It now says *"6 places from 4 films"*, places
first because places are what is drawn.

Three things this cost, each found by looking rather than by reasoning:

- **The count is not debounced and the fetch still is.** They are different costs: the fetch
  is a network request per gesture, the count is a filter over a list already in memory.
  Debouncing the count leaves the panel describing the previous viewport for 400 ms after
  every drag — the one moment somebody is actually reading it.
- **A map with no size has not said what is in view.** Leaflet answers `getBounds()` on a
  zero-sized container with a degenerate box. Observed on the first paint: *"No places in
  view"* printed over a map already drawing five pins. `isUsableBounds` treats a box with no
  height as *unknown*, and unknown means everything counts.
- **The list and its heading must be one truth.** Counting the viewport while listing the
  whole selection put "6 places from 4 films" above ten rows — a header contradicting the
  thing it heads. The list is now filtered by the same function, and when the selection has
  places but none are on screen it says so, which is exactly the distinction the issue asked
  for.

Longitude wraps and latitude does not, so a viewport across the antimeridian arrives with
`west > east`; a plain between-test answers zero for the entire Pacific, which reads as "we
hold nothing there" rather than as a broken test. There is a test.

## Two CSS bugs worth naming, because both looked like logic bugs

- **`[hidden]` loses to any class that sets `display`.** The browser's own
  `[hidden] { display: none }` is a bare attribute selector, so `.place-route-panel {
  display: grid }` outranked it and both tabs rendered at once — route controls underneath
  the voice guide. The rule is `.place-route-panel:not([hidden])`.
- **`.wide-button` had no disabled appearance.** `.primary-button:disabled` dims and
  `.wide-button:disabled` did not, so a button that refuses to act looked identical to one
  that would. It predates this work — "Recreate this shot" without a reference image has
  always looked clickable — and the Route tab put "Build route" in front of the reader every
  time, which is what made it visible.


## The page: one table, read from the other end (#129, step 4)

The card is a panel beside a map. `/place/<name>--<uuid>` is the same place as a page, and it
exists because **a film card can never show it**: a film card shows every place in one film,
and this shows every film at one place. Measured 02.09: 70 places, 92 facts, 11 places with
more than one fact and **6 with facts from more than one subject**. Six is small and it is
the number that matters — those six are the pages no work card can reach.

`place_facts_at(uuid)` is `work_facts(uuid)` entered from the opposite side of one table, and
that is the point: **if the two cards ever disagree about a place, the bug is a second query
somewhere, not a rendering difference.**

### What the page may promise

Only places IN the graph have an address. A queue candidate has no canonical place row, so a
stale or invented uuid is `notFound()`, exactly as `/work/[slug]` treats a dead one. There is
no fallback to the queue here — the card's whole claim is *"these are facts we checked"*, and
mixing labelled candidates in would undo the distinction the work card had to be corrected to
make. The same rule is why a work card's fact rows link to a place page and its **candidate
rows do not**: a queue row's id is not a place id.

A place row with no facts is not a state this graph can be in — all 70 have at least one — so
zero rows means the id was wrong, not that the place is empty.

### Every fact opens its own source, and that needed a second table

`place_facts_at` returns the evidence **count**, not the rows. A count cannot satisfy #129's
second acceptance line, so the route reads `place_evidence` once per card, keyed by the fact
ids that just arrived. It matters more here than on a film card: there every row pointed at
the same film's entry; here the sources are three different pages and are **the thing that
tells three facts apart**. A fact with nothing behind it says so rather than borrowing the
place's own Wikidata entry — 8 of the graph's 92 links carry zero evidence, and substituting
the place's page there would be inventing a source for a claim nobody backed.

### A tie in an ORDER BY is a page that disagrees with itself

London holds four Skyfall facts: one filming fact and three narrative facts, one per scene.
`place_facts_at` ordered by distance and subject name — a tie on all four — so PostgreSQL
returned them in scan order, and did: scene 9, the filming fact, scene 2, scene 7. Reloading
could differ. `work_facts` ties the same way on place name, so **the two ends of one table
could order the same four facts differently.**

Both now tie-break on `narrative_order nulls first, stated_year, fact_id`
(`20260902081645_facts_in_a_stable_order`). The last key is arbitrary and that is the point:
an arbitrary key applied consistently is a stable order.

The page also prints the **scene**, because those three rows are otherwise identical on
screen — same subject, same relation, no stated sentence — and one line printed three times
reads as a rendering bug rather than as three different scenes.

### A studio says so before the rows

Pinewood Studios is a real building and three films really were shot there, and none of them
are about Pinewood. A film card can leave that to a row label because the reader arrived
asking about the film. **A place card cannot**: the reader arrived asking about the address,
and "3 facts recorded here" invites exactly the reading the grounding rule exists to prevent.

### The address

`placeIdFromSlug` **is** `workIdFromSlug`, and the separator is exported rather than copied.
Two copies of a URL rule are two things that can drift apart while every link already sent
assumes they agree. The readable half is decorative in both, so a place renamed tomorrow does
not break links sent today.

**And the address is enumerable, which is a second thing entirely.** A page nothing links to
is a page nothing finds. `/api/directory/places` lists the graph's places for the sitemap of
[[directory]], and it lists **only the places a page can be built from**: the page is
`place_facts_at()` and that 404s a place with no facts, while `/api/resolve` writes `places`
and the links that make facts in two statements and has been seen to fail between them. On
10.09 all 70 rows carry a fact, so the filter drops nothing — it is there so that the day it
does, the sitemap loses a URL rather than gaining a 404.

The listing does the filter in two bounded reads instead of one `exists`, because PostgREST
cannot embed `place_facts`: it is a `union all` view and carries no foreign key to infer, so
the join would be new DDL, and a migration that lands after the code turns the route into a
502 and the sitemap into a silently empty one.

### Not built, and honestly empty

Distance 1 and 2 render nothing, because `creators` holds zero rows — one of the three
built-and-unwired things in [[handoff]]. The blocks are built anyway; `placeBlocks` prints no
heading over an empty one, so they cost nothing and will fill themselves the day the table
does.

## Not taken

**Their 1–5 safety score.** It exists because their readers climb into derelict buildings;
ours walk to a café on a public street. We already carry the two badges that matter here —
precision and evidence ([[three-axes]]) — and both are better calibrated than a number
nobody could source.
