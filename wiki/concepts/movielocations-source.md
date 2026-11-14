---
type: concept
created: 2026-08-07
updated: 2026-08-08
sources: [code, log]
---
# movie-locations.com — captions a regex can read

Code: `tools/scraperai/movielocations.py`, `app/lib/movielocations-source.mjs`,
`scripts/ingest-movielocations{,-works}.mjs`.

The fifth kind of submission and the cheapest to import, because the site writes
its captions in a shape that parses:

    "Vertigo filming location: Scottie's home: 900 Lombard Street, and Coit Tower"
     ^ film                    ^ scene         ^ place

Film, scene, address, separated by colons. So unlike [[reelstreets-source]]
**no model runs anywhere in this pipeline** — no 14-hour rate limit, no chance
of an invented place. Worth stating plainly rather than celebrating: a regex is
more predictable than a model, not more self-evidently right, which is why the
caption still travels with every row as the evidence a reviewer checks.

## What landed

1,870 films, 6,200 locations, **every one photographed**, every film with a
year. 657 works created and 5,783 submissions across 1,474 works, all `pending`.

**1,590 of 1,870 films matched** — 85%, against ReelStreets' 7.5% on its first
run. The difference is not the matcher, which is [[reelstreets-source]]'s
unchanged; it is that the catalogue had already grown past 7,000 works, so a new
source finally has something to attach to.

## What it does not have

No coordinates — the numbers that look like them are telephone numbers. No IMDb
ids. And **no film stills**: every image is a photograph OF THE PLACE, verified
across Hot Fuzz, Vertigo, The Greatest Showman and Notting Hill. That is a third
kind of imagery next to [[moviemaps-source]]'s frames and ReelStreets'
then-and-now pairs — the location as the site itself shot it, which is what a
reviewer wants when asking "does this address match the scene".

## Three defects caught before anything reached the catalogue

**Mojibake in 28% of records.** The site declares `<meta charset="UTF-8">` in the
body but sends `Content-Type: text/html` with no charset, so `requests` follows
RFC 2616 and assumes ISO-8859-1 — "Léon" arriving as "LÃ©on" in 519 of 1,870
records, on their way to becoming permanent catalogue rows. The cache held the
mis-decoded text too, so it had to be dropped and the site re-harvested. The
crawler now trusts the header when it says something and the document when it
does not, which is the correct order for every site, not just this one.

**Bracketed alternative titles.** "Harry Potter And The Philosopher's Stone
(…Sorcerer's Stone)" did not match the work we hold and was proposed for
creation — exactly the duplicate the works ingest is written timidly to avoid.
Both variants are now tried, bracketed form first.

**A collision the per-film dedup could not see.** The ingest died on `ON CONFLICT
DO UPDATE command cannot affect row a second time`. The cause was visible in its
own output: this site lists "Transformers: The Last Knight" twice, both entries
matched the same work, and each contributed rows. `(work_id, place_key)` is a
global key, so the dedup has to be global too. [[reelstreets-source]]'s ingest
carried the same latent bug and was fixed with it — it had simply not met a
collision yet.

## A fourth defect, found by another source rather than by a test

The caption regex demanded "filming location" or "film location". The site also
writes plain "<Film> location:", and every caption of that shape failed to split
— so the whole caption landed in `place_name`. **3,125 of 5,783 rows, 54% of the
source.** It shipped, passed tests, and lived a day in the database.

Nothing local caught it: the rows looked plausible, and the tests exercised the
caption format that had been anticipated. It surfaced only when
`cross-source` matching put these place names beside another site's, where
`Skyfall location: Silva escapes into the underground system: …` could not be
mistaken for an address. Repaired from cache with no network, the broken rows
deleted and the source re-ingested: median place name 84 → 37 characters.

## Licence

No terms page, no copyright statement, nothing on the homepage. The same silence
as [[moviemaps-source]], recorded rather than interpreted: `source_license` is
`unstated`, images are links, nothing is downloaded.

See also: [[moviemaps-source]], [[reelstreets-source]], [[film-permits]].
