---
type: concept
created: 2026-08-07
updated: 2026-08-07
sources: [code, log]
---
# ReelStreets — prose, photographs of today, and no coordinates at all

Code: `tools/scraperai/reelstreets.py`, `tools/scraperai/extract_places.py`,
`app/lib/reelstreets-source.mjs`, `scripts/ingest-reelstreets{,-works}.mjs`.

The fourth kind of submission, and the weakest at what the other three are
strong at. No IMDb id, no coordinate. What it has instead is a contributor who
went back and stood in the same spot decades later with a camera: **53,126 of
the 95,258 captures carry a photograph of the place today**, which no other
source in this project has.

## The shape of the data

3,536 films, 95,258 captures, every film with a year. Harvested through the
WordPress REST API rather than the sitemap, because the sitemap is broken —
`wp-sitemap-posts-films-1.xml` holds one entry and `films-2` 404s.

The captions are **prose**, not addresses, which is the fact that decides
everything downstream:

> "Jennifer follows two Men who have found her sister's dog. Walker's Court in Soho W1."
> "The French village square from which Fogg takes off in a balloon is a Universal Studios set."

Only 1.5% end in anything postcode-shaped and 903 say "unidentified location".
There is no separator to split on, and the second example is not a location at
all. So this is the [[wikipedia-enrichment]] category — prose that has to be
read — not the [[film-permits]] one.

## One model call per film, and precision as a filter

`extract_places.py` reads the place out of each caption. The model runs once per
film, batching ~25 captions, so 3,536 calls rather than 95,258 — the same
discipline as [[moviemaps-source]]'s recipe. It only ever **names** a place; the
geocoding cascade locates it, separately, which is the rule
[[location-discovery]] already states.

It also reports how precise the place is, and that is a filter rather than a
field: `region`, `studio` and `unknown` never become submissions.
`source-evaluation.md` had already written why — matching to "Japan" is not an
answer, it is a mood — and the model flags "Egypt" and "Japan" as region
correctly.

## Three things the free model taught, all of them at scale

**A field it drops when the list gets long.** An early prompt asked for `kind`
alongside `place`; on films with 40+ captions the model quietly stopped emitting
it and every real place was recorded as `unknown` — 0% real. The fix was to
remove the redundancy, not to work around it: a null place already means
"nothing found", so kind is derived. 0% → 89%.

**Retrying at temperature 0 is pointless.** Malformed JSON reproduced byte for
byte on every retry. Batches are now **split** on a parse failure, which changes
the input, guarantees progress, and narrows the blame to the one caption that
breaks serialisation.

**A transient error is not a bad batch.** `Connection error` fell into the
"model could not serialise this" branch and the captions were discarded —
110 of them across 8 films, silently. Network failures now back off and retry;
only genuine JSON failures split.

## Rate limit: the reason it takes 14 hours

OpenRouter caps `:free` models at **20 requests per minute, per account and
across all free models** — `free-models-per-min`, a hard 429 rather than a
queue. Switching to a different free model does not help. Eight workers simply
hammered it; a global limiter at 18/min gives zero 429s and 4 films a minute.

Paid alternatives were measured rather than picked off the price list:
`ling-2.6-flash` is twenty times cheaper than `qwen3.7-flash` and matches it on
recall, but **drops the postcode** — "34 Rue Saint-Vincent, Montmartre" instead
of "…, 75018 Paris" — which is the difference between an address a geocoder can
resolve and a street name that repeats across a city. The free model keeps it,
so free won on quality, not only on cost.

## Matching, and where it refuses

Title and year, because there is no IMDb id on either side. One candidate is not
a free pass: if both sides state a year and they disagree by more than one, it is
a different film with the same name. Several candidates are decided by year, and
if year cannot decide, **nothing is returned** — 6,029 works came from
[[moviemaps-source]] with no year at all, so this is common, and it is exactly
where a guess would attach one film's locations to another and look correct.

## What landed

354 works created and 8,063 submissions across 380 works, every one `pending`,
**every one with imagery** and 3,998 with a photograph of the place today. Only
4 carry a coordinate — the ingest does not geocode, and a row that says "here is
a place, nobody has located it yet" is honest where an invented point would not
be.

The works ingest is deliberately timid: with no external id there is no unique
index to lean on, so it creates a work only when nothing with that title exists.
Verified afterwards — of 159 duplicate `(title_norm, year)` groups in the
catalogue, **none involves a row this created**; all 330 rows in them predate it
and come from the yearless MovieMaps import.

## Licence

reelstreets.com states its own position at `/how-to-submit`: the screen captures
remain the copyright of the current title holders. That is more explicit than
[[moviemaps-source]]'s silence and lands in the same place — `source_license` is
`unstated`, images are stored as links for a reviewer, nothing is downloaded.

See also: [[moviemaps-source]], [[film-permits]], [[film-frames]], [[location-discovery]].
