---
type: concept
created: 2026-08-19
updated: 2026-09-10
sources: [code, log]
---
# The directory — a city is a point, not a name

**What it answers.** Until 18.08 the product had two surfaces: the map (`/`) and the film
card (`/work/<slug>--<uuid>`). 6,392 works and 32,148 located rows had no URL between them,
so nothing could be linked to, shared or indexed, and the demo depended on a juror typing a
title they happened to like. The directory is the third surface: `/directory`,
`/directory/films/<letter>` and `/city/<slug>`.

Related: [[fact-architecture]], [[queue-review]], [[search-box]], [[geocoding-cascade]].

## The decision that shaped everything: a city is a coordinate and a radius

The obvious build is to group the located rows by the city written in their address.
Measured on production, 18.08.2026, that gives:

| grouped by the name in the address | |
|---|---|
| `London` | spread **10,959 km** — London, Ontario |
| `Richmond` | spread **8,097 km** — British Columbia, Virginia, upon Thames |
| `Ontario` | 48 works — a province, and also a city in California |
| `Unnamed Road` | 80 works |
| `France` | 190 works, median point in Paris |

**A name in an address is a label; only a point is an identity.** This is the same lesson
`Bowie` taught the Overpass path and `wbsearchentities` taught the resolver — see
[[geocoding-cascade]] — arriving from a third direction. So a city page is a **disc**: an
anchor and a 20 km radius, and its films are the films with a located row inside it. The
name is decoration exactly as the readable half of a work slug is. London, Ontario cannot
appear on the London page however its address is spelled, and Paris appears whether the
address says "Paris", "75001" or nothing at all.

## How the gazetteer was derived, and what each rule cost to learn

`scripts/build-city-gazetteer.sql` produces the list; `app/lib/city-gazetteer.mjs` holds it.
Every rule exists because the version without it was wrong in a way that looked right.

1. **Candidates** are every comma-separated component of every located row's `area_hint`.
2. **A country is the component that comes last.** Measured as a share of occurrences, it
   separates cleanly: Canada 1.000, France 0.912, Ireland 0.813 against Vancouver 0.000,
   Madrid 0.000, Almería 0.000. Without it, `Canada` wins 902 names, lands on **Vancouver's
   own coordinate** and shadows Vancouver off the list entirely.
3. **The anchor is the MEDIAN of its own points.** A third of everything called "Paris" is
   in Texas or Ontario and the median is still in the 4th arrondissement. The **mean** puts
   it in the Atlantic. The **densest point** was tried and is worse: it moved London to
   Greenwich, where 51 rows share one coordinate at the Old Royal Naval College.
4. **A venue is one address written one way**: fewer than three distinct full hints behind a
   name and it is dropped. This is what removes `Mini Hollywood` (53 works), `Bryant Park`
   (39), `Tate Modern` (23) and `Bonneville Salt Flats` (41), each of which otherwise
   arrives looking exactly like a small town.
5. **A name that means several places gets no page**: interquartile spread over 50 km is
   dropped. Interquartile rather than full, so a handful of homonyms cannot veto a real city.
6. **Of two candidates within 40 km, only the more-named survives.** This is the rule that
   makes it a directory rather than a padded one: at a 20 km radius `Westminster`,
   `Lambeth`, `St. James's` and `City of Westminster` each return **the same 656 works** as
   London, and each would have been its own page. 40 is twice the radius, so the surviving
   discs cannot overlap and no film is counted into two cities — there is a test for it.

Result: **55 cities derived, none of them a country, a street or a single building.**

**One entry is added by hand and marked as such.** Paris fails rule 5, because two thirds of
the rows naming it are Paris, Texas and Paris, Ontario — the rule is right about the name
and wrong about the place, and we hold 123 works within 20 km of the anchor its own median
gives. It is added rather than the threshold loosened, because loosening it enough to admit
Paris also admits **`s/n`** — Spanish for "no street number" — which was measured to take 87
works and shadow Madrid off the list.

**Known and stated, not hidden:** the list is Anglo-American because the sources are. Prague,
Rome and Vienna hold too few rows to clear rule 1 and are absent rather than padded.

## The thing that nearly shipped as a lie

The directory is built on `catalogue_index`, which is the review queue. The film card is
built on `work_facts`, which is the graph. Measured while wiring the two together:

> **the graph holds 92 facts across 15 works; the catalogue holds 6,392.**
> **14 of 6,392** directory rows led to a card with anything on it.

So the directory as first built was a signpost to 6,378 empty rooms, each saying "No places
recorded for this work yet" — a worse answer to the issue than no directory. The card now
shows the queue too, under the rule the map has followed since 05.08 ([[queue-review]]):
shown, labelled as a candidate, linked to whoever said it, and **never entering the graph**.
It is kept out of `placeBlocks` entirely rather than given a distance, because a fact has an
identity, a subject and a degree of separation ([[fact-architecture]]) and a queue row has
none of those; a distance of 0 would make it indistinguishable from something we checked.

The header counts them apart: *23 places · 15 filmed on location · 62 unverified candidates.*
The sentence over the block says **"60 of 62"** when the card cannot print them all —
Person of Interest holds 961 rows, and a page that lists 60 without a word reads as though
60 were all there was.

## Smaller things worth not rediscovering

- **The letter a work is filed under strips a leading article, and only a leading one.**
  Our sources disagree: movie-locations ships `Caper of the Golden Bulls, The` and TMDB
  ships `The Dark Knight`. Filing on the raw `title_norm` put **1,427 of 6,392 works — 22%
  of the catalogue — under T**. Stripping a leading `the/a/an` fixes the titles that carry
  one and leaves the comma-inverted ones alone, because theirs already sits at the end: T
  fell to 330 and S became the largest at 640. The rule lives twice, in
  `directory_sort_key()` and in `letterBucket()`, and the two must not drift.
- **`'#'` cannot travel in a URL** — it is the fragment delimiter, so everything after it
  stays in the browser. The bucket is addressed as `other`.
- **A letter range is collation-dependent.** `~ '^[a-z]'` and `between 'a' and 'b'` are
  resolved against the database collation, and this database is not in the C locale: under
  `en_US.UTF-8` `Á` sorts between `a` and `b`. The tests use `strpos` over an explicit
  alphabet instead, so an accented title files under `#`, which is where the client expects
  it.
- **Both halves of a sentence must be measured over the same rows.** The index first read
  *"6,392 films with 20,296 places"* — a global work count beside a count of only what
  happens to sit near a listed city. Both now come from `catalogue_letter_totals()`.
- **`count(*) over ()` is evaluated before `LIMIT`**, which is what lets a 48-row city page
  know it is 48 of 656 without a second query.
- **A page past the end is re-asked at the first page**, not shown empty: an empty page
  under a link we generated ourselves reads as lost data.
- **A city we hold nothing for is listed at zero, not dropped.** The gazetteer is the source
  of the list and the database only says how much is in each; vanishing on an empty answer
  is how a directory quietly hides a broken query.

## The way in: robots.txt, and an index over the 27 files

The directory gives every work a URL and the sitemap says those URLs exist — but something
has to say the **sitemap** exists. Measured on production 10.09, four weeks after the
sitemap shipped:

| | |
|---|---|
| `/sitemap/a.xml` | 200, 498 URLs |
| `/sitemap.xml` | **404** |
| `/robots.txt` | **404** |

`generateSitemaps` splits the catalogue one file per letter and Next then serves them at
`/sitemap/<id>.xml` **and serves nothing at `/sitemap.xml`**. So the split that keeps each
file small is also what made the whole set unreachable from the root: 27 files and no
document naming them. A crawler that is never told a file exists never asks for it, which
is the same failure the sitemap was written to fix, one level up.

Two files fix it, and the chain between them is one link long: `app/robots.js` names
`/sitemap.xml`, and `app/sitemap.xml/route.js` names the 27. The list in the index comes
from `generateSitemaps()` itself — a list written twice is two lists that disagree the day a
letter is added, and both ways of disagreeing are bad: a file the index skips is crawled by
nobody, a file it invents is a 404 handed to a crawler. There is a test that the two lists
are the same list.

**robots.txt disallows nothing, and that is a decision.** The obvious line is
`Disallow: /api/` — 31 route handlers that answer JSON and are not pages. But Google's
renderer obeys robots.txt for the requests a *page* makes, and the map at `/` is a client
component that fetches `/api/catalogue` after it mounts: the rule would leave the crawler
looking at an empty map on the one page that is the product. None of those endpoints is
linked from any page, so it would have bought nothing.

**An id nobody generated is a 404, and it took measuring to get right.** Next hands the
sitemap function whatever `<id>.xml` was asked for and validates nothing — the image route
beside it checks its own `generateImageMetadata`, this one does not — so `/sitemap/zzz.xml`
answered **200 with an empty `<urlset>`**, and so did `qqq` and `1`. That is not "no such
file": a `<urlset>` with no `<url>` in it is the claim that nothing is filed under that
letter. The guard is the same `notFound()` a dead address gets on `/place/[slug]`.

`export const dynamicParams = false` fixes it too, and is the more idiomatic line — but only
half the time. Measured both ways against a real server:

| | `next dev` | `next start` |
|---|---|---|
| `dynamicParams = false` | `zzz` → **200** | `zzz` → 404 |
| `notFound()` | `zzz` → 404 | `zzz` → 404 |

The loader emits `generateStaticParams` for this route **only when `NODE_ENV` is
production**, so in dev there is no list for `dynamicParams` to check against and the config
does nothing. A bug that is invisible in the mode people develop in is a bug that comes back,
so the explicit guard won. `.claude/launch.json` gained a `scenemap-start` entry in the same
change, because this is a difference `next dev` cannot show you.

## Known-wrong

- **The same venue appears twice in a city row** when two sources spell it differently —
  Skyfall in London shows both `Broadgate Tower` and `Broadgate Tower, Bishopsgate, London`.
  `place-dedup.mjs` already knows how to collapse these and is not wired into the city
  query; the `distinct` there is on the exact string only.
- The city anchor is where the **filming** is, not where the town hall is. Usually the same
  point; for Madrid it is 21 km out, because our Madrid rows are dominated by a few outlying
  sites. The page states the coordinate rather than implying an administrative boundary.
