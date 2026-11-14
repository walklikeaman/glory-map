---
type: concept
created: 2026-08-04
updated: 2026-08-04
sources: [code, log]
---
# Filming permits — the only primary source in the project

Code: `app/lib/film-permits.mjs`, `scripts/ingest-film-permits.mjs`.

Every other source here is somebody's **account** of where a film was shot — an
encyclopedia sentence, a web page, a model's reading of either. A permit record is not
an account: the city granted permission to shoot at an address on a date, and the record
is the primary document.

There is no prose to extract, no gazetteer round trip, **no model call**, and no
coordinate for anything to invent — the address arrives already geocoded by the issuer.

## What it is not

**Proof the footage reached the film.** A permit is authorisation, and productions
abandon locations. So these still land as `pending`, with `source_kind = 'permit_record'`
— a different KIND of evidence from a sentence, not a stronger grade of the same kind.

## Paris, the reference implementation

Verified live: **14,760 records, ODbL**, published by the city's own Direction des
Affaires Culturelles. Opendatasoft v2.1.

Found The Crown in the existing works with no new data: ten Paris addresses from the
2022 shoot — souterrain Alexandre III, place Vendôme, cours Albert Ier, place de la
Concorde. A walkable route where every stop is a municipal record.

**The coverage window is the thing to know, not the record count.** The set begins in
**2016**, so it holds Emily in Paris (255 locations), The Eddy, Arsène Lupin and Irma Vep
— and nothing at all for Amélie or Inception. An empty answer for a classic is the
correct answer.

The portal's own `modified` metadata says 2023-05-15 while records run to 2024. Harmless
direction, but the metadata cannot be used to decide whether a refresh is due.

## A city is configuration

`CITIES` in `film-permits.mjs` holds endpoint, API flavour, licence, attribution,
coverage window, field mapping and the title-query dialect. Adding a city should mean
adding an entry, not a module.

### Which cities actually fit (verified against live endpoints)

| city | API | licence | title? | coordinates? |
|---|---|---|---|---|
| **Paris** | Opendatasoft v2.1 | ODbL 1.0 | yes | yes, from the issuer |
| **San Francisco** | Socrata `yitu-d5am` | PDDL-1.0 | yes | yes, ~4% missing |
| **New York** | Socrata `tg4x-b46p` | unspecified | **no** | **no** |

**New York fits the pipe and not the product.** MOME deliberately withholds production
names, so `title` is not a gap to close by joining or enriching — the dataset cannot
answer "which film shot here". It also carries no coordinates, and its address field is a
multi-segment blob that fans one permit out into several locations. Adding it would mean
building row-explode and intersection-geocoding machinery no other city uses, to produce
rows with no work attached.

San Francisco is a straight second instance, with two differences worth writing down: it
has **no shoot date** (only `release_year`, which is a different thing), and ~4% of rows
have no coordinate.

Paris paging note: `/records` caps at `offset + limit <= 10000`. Fine for one production —
the largest is Emily in Paris at 255 — but a whole-city pull needs
`/exports/json?limit=-1`.

## Correctness lives in the match, not in the query

The API search is deliberately loose, so that "Emily in Paris" also catches "Emily in
Paris saison 2" — the same set is filed under several spellings. `titleMatches` then
re-checks every returned record against the full title: exact, or the wanted title
followed by a space. Accents are folded; "Paris Police 1900" is not "Emily in Paris".

The title guard first demanded two words, on the theory that a single short word was
dangerous. It is not, because the match already covers it — and the rule silently
skipped **"Skyfall", "Amélie" and "Parasite"** for a risk that did not exist.
`isSearchableTitle` is now a cost guard only: is this query so short it drags back
thousands of records for nothing.

## Licence

ODbL is **share-alike on the DATABASE**, not merely attribution, and it is not something
that can be inferred. Every row carries its own `source_license`, `source_license_url`
and `source_attribution`.

This is why [[place-precision]]'s table had to change: `source_license` carried
`default 'CC BY-SA 4.0'`, which was true while Wikipedia was the only writer and became
a false statement in the database the moment a second source appeared.

## Several permits, one place

A production shooting a street over four days files four records; the map wants one pin.
`dedupeByAddress` collapses them by normalised address.

A permit the city never geocoded is **dropped, not queued** — unlike a prose claim there
is nothing for a reviewer to resolve.

See also: [[geocoding-cascade]], [[wikipedia-enrichment]], [[location-discovery]].
