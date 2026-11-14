---
type: concept
created: 2026-08-05
updated: 2026-08-05
sources: [code, log]
---
# MovieMaps — strong on geometry, silent on licence

Code: `tools/scraperai/`, `app/lib/moviemaps-source.mjs`,
`scripts/ingest-moviemaps-works.mjs`, `scripts/ingest-moviemaps.mjs`.

A contributor-maintained gazetteer where someone identified a place, put a pin on it,
and often credited where they got it. That makes it a **third kind** of source, sitting
between the two we had: a [[film-permits]] record is a primary document from the
authority that issued it, a [[wikipedia-enrichment]] sentence is prose that has to be
read, and this is neither.

Strong on geometry, weak on authority — and the two are recorded separately rather than
averaged into a confidence score.

## What the scrape yielded

24,089 pages, 0 errors, 102 minutes.

| | |
|---|---|
| locations, **every one** with coordinates and a street address | 18,048 |
| frames catalogued | 90,764 |
| films, **every one** with an IMDb id | 6,041 |
| location↔film links | 30,386 |

## The map payload is the whole find

Coordinates are **not in the rendered HTML** — the map is drawn client-side. Every detail
page ends with a call the site makes to its own JavaScript:

```js
moviemaps.loadPublic('MovieDetail', "1", [{"lid": "1", "llat": 49.358, "lcityName": "West Vancouver", "lmloc": ["The Cullen's House"]}, …])
```

carrying coordinates, city, country, **Street View camera pose**, and the fictional name
each place plays. One movie page geocodes an entire film.

Without it the pages that lack a "nearby locations" link have no coordinates at all.
Parsing the visible HTML would have produced a gazetteer with holes and no way to see
them.

Location pages add what movie pages do not carry: the street address, the per-scene
description, and the frame galleries.

## Licence: unstated, and that is the recorded fact

moviemaps.org publishes **no terms, no licence page and no copyright statement** —
`/about`, `/terms`, `/legal` and `/copyright` all 404, and the homepage says nothing
(checked 2026-08-05).

So every row carries `source_license = 'unstated'`. Not a guess at a permissive one, and
not the `CC BY-SA 4.0` default that [[film-permits]] had removed precisely because a
defaulted licence becomes a false statement the moment a second source writes.

**A MovieMaps row is a lead**: strong enough to put in front of a reviewer, not licensed
for its text or its images to be republished.

## The frames are evidence, never content

This does not contradict the Film-Grab refusal in [[film-frames]]'s sibling page — it
follows from it. Those corpora were refused because a permissive footer grants nothing
when the copyright is the studio's. MovieMaps is the same situation with **less** cover:
no footer at all, and each image page carries its own line, "Copyright Touchstone
Pictures".

So the frames are **not downloaded** and do **not** go into `work_images`. That table is
keyed on a TMDB `file_path` and holds the gallery the product renders, and the poster
pipeline already states the policy: artwork comes from the licensed API and is not
scraped. Copying a scraped still into it would launder a scrape into product content.

The URLs ride along in `location_submissions.source_media` as links, for the **reviewer**
— a frame beside the place is the best evidence this kind of submission can offer. If the
product should show frames, the licensed route already exists: TMDB backdrops, classified
and matched per [[film-frames]]. A MovieMaps frame can tell a reviewer *which* still to
look for; it must not be the pixels that ship.

Images are served only at whitelisted widths; anything else 403s. Frames: 78, 160, 320,
940. Posters: 100, 200, 940.

## Matching: IMDb id and nothing else

The [[film-permits]] ingest needs title matching and pays for it with
`isSearchableTitle()`, which refuses short titles because "Heat" matches everything. Here
both sides carry tt-ids, so a fuzzy fallback would be **strictly worse than reporting the
miss**: it would attach one film's locations to another and look exactly like a success.

## `kind` comes from a link, because nothing else says it

MovieMaps files series under `/movies/` like everything else and never labels them. The
only signal on the page is whether it links to `/episodes/`.

Checked against the twelve works already held: Sherlock and The Crown land in `series`,
the other ten in `film`, agreeing with every one. 5,390 films and 651 series in the
scrape.

`year` stays **null** — MovieMaps publishes no year anywhere on a film page, and dedup
does not suffer because these rows all carry an IMDb id.

## What the ingest actually did

6,029 works created (5,380 films, 649 series) and 30,170 submissions across 6,041 works,
90,738 frame links, every row `pending`.

Reconciles exactly with the harvest: 30,386 links less 216 duplicate place keys. The 15
curated works kept their `wikidata_id` and `tmdb_id` — the works ingest **inserts and
never updates**, because those rows carry facts a scrape's blanks would overwrite.

`works.source` was added for the same reason. The catalogue held 15 rows, every one
entered deliberately with a `wikidata_id`; importing 6,029 from a scrape changes what the
table is, and without the column nobody could later tell a curated row from a scraped
one. Null on the existing rows rather than backfilled — "predates the column" is true,
"manual" would be a claim nobody checked.

## The tooling

[ScraperAI](https://github.com/scraperai/scraperai) reads one page with a model, works
out the XPaths, and hands back a recipe to replay. The model runs **once per page type**,
not once per page — see [[model-providers]] for the OpenRouter wiring, and note that
ScraperAI's own HTML minifier drops `<noscript>` and unknown attributes, which on this
site hides every single frame.

Politeness is not optional and was not assumed: `robots.txt` disallows `/search` and
nothing else (checked 2026-08-05), and the site publishes sitemaps for movies, episodes,
collections, locations, cities and images.

See also: [[film-permits]], [[film-frames]], [[location-discovery]], [[place-precision]].
