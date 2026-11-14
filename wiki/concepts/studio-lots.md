---
type: concept
created: 2026-09-10
updated: 2026-09-10
sources: [code, log]
---
# Studio lots — a fence is a polygon, and Los Angeles is why it matters

The question the product answers in Los Angeles is not *"was this filmed here"* — almost
everything was. It is **"can I go and stand there?"**, and the answer splits in two:

| | |
|---|---|
| a street, a house, a diner | you can walk to it, and it **is** the place in the film |
| a lot, a soundstage, a ranch | you cannot walk in, and what it filmed is set **somewhere else** |

Courthouse Square at Universal is Hill Valley in three *Back to the Future* films. New York
Street at Warner Bros. is New York in *Blade Runner*, *Batman Returns*, *Cloverfield* and
*The Artist*, and has never been within 3,000 km of it. Printing either beside a real
address without a word is the confident false claim the grounding rule exists to prevent.

Implementation: [app/lib/studio-lots.mjs](../../app/lib/studio-lots.mjs).
Related: [[three-axes]], [[place-card]], [[queue-review]], [[directory]].

## Why a polygon, and not a name

`work-profile` already records what a name test costs: the old scene-image matcher ran
`/studio/i` over place names, which calls the Studio Ghibli Museum a soundstage. Measured
on the **5,266 Los Angeles rows** in the queue, the same regex gets it wrong in both
directions:

| row | name test | truth |
|---|---|---|
| Disney **Hall** | studio | Walt Disney Concert Hall, a Gehry building on Grand Avenue |
| **Hilton Universal** City | studio | a hotel across the street from the lot |
| **Culver** City High School | studio | a school |
| New York City Backlot | not a studio | inside Paramount |
| Courthouse Square | not a studio | inside Universal |
| Hennesy Street | not a studio | inside Warner Bros. |

A coordinate cannot be argued with, and every row in this queue already has one. The test
is **is the point inside the fence**, against boundaries from OpenStreetMap, each entry
naming the way or relation it came from so it can be re-checked.

## Why not a radius, which is what a city gets

A city is a fuzzy idea and a lot is a legal parcel with a wall around it. [[directory]]
gives a city a point and a radius for good reasons; the same shape here fails on the first
case tried. **A radius over Universal wide enough to cover the backlot also covers the
Hilton — and so does the bounding box.** There is a test that asserts exactly this: the
hotel is inside Universal's box and outside Universal.

Two details the OSM data forced:

- **A relation that declares an `outer` ring means it.** Universal's carries one outer plus
  103 building footprints. Using them all would put the backlot STREETS — the whole point —
  *outside* the lot.
- **Paramount's carries no outer at all.** Its six members are the parcels the lot is
  assembled from, so there every member is used.

Simplified to 2.2 m (Ramer–Douglas–Peucker) and stored at five decimals, 668 points for 25
lots. Both steps were checked against all 5,266 rows before being applied: **no row changes
which lot it is in, or whether it is in one.** A lot boundary is a fence, not a survey.

## What it changes, measured

**212 of the 5,266 Los Angeles rows are inside a lot — 4.0%.** That number is low and it is
the honest one: MovieMaps and MovieLocations are *filming-location* databases, and nobody
lists "Stage 16" as a location. **What we hold answers "where in Los Angeles can I go
stand"; it barely answers "which films were made on the lots"** — that needs production
data we do not have. The 212 are mostly the cases where a backlot was standing in for a
real place, which is exactly the set that would otherwise mislead.

Across the whole queue the flag reaches three surfaces from one definition: the film card,
the place card, and the map. `placeRole()` consults it **last, and only where nobody has
classified the place** — an explicit `place_class` is somebody's decision and outranks a
shape on a map, and a narrative or inspiration row keeps its own meaning whatever the
coordinate says.

## Access, in the vocabulary that already existed

`access` is `ACCESS` from [[three-axes]], not a new word: `ticketed` for the four lots that
run a public tour, `open` for Paramount Ranch (National Park Service land), `view_only` for
a working lot where the gate is as close as you get.

It deliberately carries **no price and no opening hours**. Those change every season, and a
number this file cannot keep true is worse than no number. One thing worth knowing and
therefore not baked into the data: Paramount Ranch's Western Town **burned down in the 2018
Woolsey Fire**, and the $26 M rebuild was still finishing as of September 2026.

## Not Los Angeles-only

The list is Los Angeles because Los Angeles is what was asked for; the mechanism is not.
Pinewood already sits in the graph carrying `depicts_elsewhere` and belongs here the day
somebody adds its ring — so do Leavesden, Cinecittà and Babelsberg.
