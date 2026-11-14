---
type: source
created: 2026-08-06
updated: 2026-08-07
sources: [web, research]
---
# Commemorative plaques — the claim is written on the wall

**Built in #138 and extended in #140: 53 rows across 40 works are in the live queue**, and
works carrying a Wikidata id went 15 → 28. The numbers that matter are in the two log
entries at the top of `wiki/log.md`; the short version is that the matcher's rules did the
work — 4,643 naive hits became 346 with case sensitivity and 46 with proximity — and that
the ceiling on volume is the SOURCE, not the filter.

**Correcting an earlier claim on this page: "811 titles we do not hold" was an artefact of
a crude Title Case sweep**, not a measurement. Read properly — quoted or introduced by the
word naming its kind, and beside the production claim — the extractor yields **49
candidate titles, of which 13 resolve** to a film, series or book safely
(`plaque-title-resolve.mjs`). Do not plan volume against 811.

Research 05.08.2026, live queries. Task: issue #125. The owner's observation: the round
plaques on London and Edinburgh facades say things like "filmed here", "recorded here",
"wrote here" — which is a statement about a place, carved in stone, at an address.

## Two independent sources, both usable

**Open Plaques** — a dedicated registry. Licence, verbatim from their data page: *"Please
re-use the data in any way you see fit. It is released under the Public Domain Dedication
and License 1.0"* — **PDDL, public domain**. Stronger than anything else this project
uses: stronger than ODbL (OSM), stronger than CC BY-SA (Wikipedia). They publish CSV /
JSON / GeoJSON dumps and explicitly ask people not to crawl, so **take the dump**.

| | total | with a coordinate |
|---|---|---|
| world | 55,115 | **47,064** |
| United Kingdom | 18,524 | **17,371** — every one with its inscription text |
| United States | — | 16,512 |
| Germany | — | 6,759 |

Dumps: `https://openplaques.s3.eu-west-2.amazonaws.com/open-plaques-all-2025-12-14.csv`
(42 MB) and `…-United-Kingdom-2025-12-14.csv` (14 MB).

**OpenStreetMap** — `memorial=plaque`, or `historic=memorial` with `inscription`. ODbL,
the same Overpass endpoint `/api/access` already uses. Measured: London 1,844 plaques
(1,606 with the text, 845 linked to Wikidata), Edinburgh 172 (145 with the text). Useful
as a second, independent source for the same wall.

## Why it fits this project better than any source before it

The rule here is a quote checked verbatim. **On a plaque the quote is the object** — it
is already in the `inscription` field, put up by a named organisation, at an address,
with a date. Nothing to extract and nothing to paraphrase.

And it lands on the half of the product that Wikidata barely covers — where a thing was
**written or made**, not only where it was shot:

- `My Beautiful Laundrette 1985 … was filmed on this road` — a film already in our data
- `J. K. Rowling wrote some of the early chapters of Harry Potter in the rooms on the first floor of this building`
- `David Bowie … His albums Hunky Dory & The Rise of Ziggy Stardust … were recorded here`
- `This marks the location of the cover photograph for … 'The Rise and Fall of Ziggy Stardust'`
- `In diesem Hause wohnte von 1976 bis 1978 David Bowie … Low, Heroes und Lodger` (Berlin)

Plaques are also almost always **building precision at a street address**, which is the
rung [[three-axes]] wants and Wikidata rarely gives: a stop somebody stands in front of,
not "somewhere in this city".

## How many are ours

By the structured subject-role field, United Kingdom: film **538**, music **1,248**,
books **1,802** — **3,187 unique** of 17,371.

By the verb on the wall, worldwide: `filmed here` 29, `recorded here` 33, `wrote here`
33, `performed here` 80, `lived here` 4,322. The verb is what decides the relation — a
matching role with no verb is an `author_place` at most, never "filmed here".

## Two refusals, measured, that must be coded before anything else

**Stolpersteine and victim memorials — 6,269 of the world dump**, 6,252 of them in
Germany, and **1,413 fall inside the phrase "lived here / wohnte hier"**. Pulling those
into a celebrity walking tour would be grotesque. They are excluded first, by series,
organisation and the markers `deportiert` / `ermordet` / `Jg.`, with a test — not left to
a role filter to miss quietly.

**Name matching is not identification.** Searching the world dump for `Bowie` returns
over a hundred Texas historical markers — Jim Bowie, Bowie County, cemeteries and Baptist
churches. Not one is about David Bowie. Works are matched by identifier (Wikidata / IMDb)
the way the MovieMaps ingest does it, never by string.

## Open product question

**Music is a new kind of work.** `work_kind` knows film / series / book. Music is the
biggest single category of plaque subject, and "this album was recorded here" is neither
`filming_location` nor `narrative_location`. Either a `music` kind with a `recorded_at`
relation, or an explicit decision to leave music out — the owner's call, not a
technical one.

See also: [[source-evaluation]], [[three-axes]], [[location-discovery]], [[film-permits]].
