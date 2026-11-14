---
type: concept
created: 2026-08-08
updated: 2026-08-14
sources: [code, log]
---
# Reviewing the queue — what a rule may decide, and what nobody can

44,098 submissions arrived across five ingests and not one had ever been looked at. The
number is usually read as a clicking problem. Measured, it is three different problems
wearing one number, and only one of them is answered by a person looking at rows.

Rules: [app/lib/submission-review.mjs](../../app/lib/submission-review.mjs). Runner:
[scripts/review-submissions.mjs](../../scripts/review-submissions.mjs). Vocabulary of
evidence: [app/lib/place-review.mjs](../../app/lib/place-review.mjs).
Related: [[three-axes]], [[place-precision]], [[fact-architecture]],
[[commemorative-plaques]].

## The corpus, measured 08.08 (43,888 rows — it moves; see below)

| source | rows | geolocated | avg name | names > 12 words |
|---|---|---|---|---|
| moviemaps | 30,153 | 30,153 | 22 chars | 2 |
| reelstreets | 8,062 | 27 | 37 chars | 508 |
| movielocations | 5,580 | **0** | 38 chars | 71 |
| open_plaques | 53 | 53 | — | — |
| wikipedia | 36 | 14 | — | — |
| permit_record | 10 | 10 | — | — |

The movie-locations row read `5,783 / 79 chars / 2,722` a few hours earlier. Another branch
re-ingested the source in between. This is the second table on this page that needs a
timestamp — see the last section.

Three findings, and each one changed what was built.

**The 30,257 geolocated rows are MovieMaps and 104 others.** Their names are clean and
their coordinates are one per place: **3,187 of 3,313 name-clusters hold exactly one
distinct point**. The obvious offline check — "do the rows agree with each other" — proves
nothing, because they are the same number copied, not independent observations. It was
tried, measured, and discarded.

**13,637 rows have no coordinate — and the first diagnosis of why was wrong.** It blamed
captions: 47% of movie-locations names past twelve words, 54% carrying the `<Film>
location:` prefix the extractor was meant to cut. Re-measured on 08.08 after
movie-locations was re-ingested from another branch, that is **71 of 5,580** and **zero**.
The extractor was fixed and the rows stayed pointless anyway, because of something the
first measurement never checked:

```
source_kind      geocode_source
moviemaps        moviemaps        30,147
open_plaques     open_plaques         53
permit_record    opendata_paris       10
reelstreets      reelstreets          27   ← the 27 that came WITH points
reelstreets      (null)            8,035
movielocations   (null)            5,580
```

**No geocoder has ever been run on this queue.** Every located row got its point from the
source it was scraped from. The 13,637 are not blocked by their names; they are blocked
because nobody ever asked a gazetteer. See [[geocoding-cascade]] and
[app/lib/place-name-head.mjs](../../app/lib/place-name-head.mjs).

The 508 ReelStreets names that DO run long are not captions either — they are written
descriptions of where a camera stood, and they are good:

> Bristol Temple Meads station on Station Approach off Bath Road in Bristol, Avon

Precise, deliberate, and unanswerable by a gazetteer. That is a different problem from a
broken extractor and it has a different fix.

**Everything that would settle a MovieMaps row needs the network** — is there an entity
here, does another site say the same thing — which is the lane a resolver in another
branch is already in. So the reviewer's job is not to guess; it is to say which of the
three situations each row is in, and to decide the rows that can be decided.

## What a rule may decide

**Refuse** — mechanical, re-derivable by anyone from the row:
`not_a_place` (155 rows named "Google Maps": the caption of a map link),
`photo_credit_not_a_place` (753 named "Wikimedia / Alexanderm14"),
`null_island`, `impossible_coordinate`, `name_has_no_letters`.

**Block, without refusing** — the row may be perfectly true and cannot be a pin yet:
`unusable_name:caption_prefix_not_cut`, `unusable_name:photo_credit_appended`,
`unusable_name:sentence_not_a_name`, `no_coordinate`. This is a work list, and the reason
has to name OUR fault where it is ours, or the next session rejects real places.

**Verify** — two ways, and they are not the same kind of argument:

- **The source class**, stated as a fact about the source rather than a score. A plaque's
  sentence is engraved on a wall at the coordinate and anyone can stand there and read it;
  a filming permit was issued by the city, which is the authority on whether it issued it.
  Writing these as weights and then tuning the weights until plaques passed would be the
  scoring model quietly starting to lie — the exact failure `place-review.mjs` was written
  against.
- **The signals**, by noisy-OR against a 0.6 threshold, requiring a CLAIM signal.

## The two rules that were wrong first

Both were caught by checking against live rows rather than by reasoning about them, and
both would have looked right in review.

**`wikidata_entity` is not a claim signal here.** In `place-review.mjs` it is, and
correctly: a candidate discovered FROM a work's Wikidata statement has Wikidata asserting
the connection. A queue row's Q-id is found the other way round — by asking what sits at
the coordinate the scraper gave, under the name the scraper gave. **That proves the
building exists and says nothing about whether a film was shot in it.** It also scores
exactly 0.6, the threshold, so 29 rows would have published "filmed here" on the strength
of "this address is real".

**`cited_source` must not demand that the sentence name the place.** The first version
did, and on real rows it was wrong in both directions: *"Bridge used in the first episode
of series 1"* PASSED for Vauxhall Bridge on the word "bridge", while *"Jim wakes up from a
coma in an abandoned hospital"* FAILED for Central Middlesex Hospital, which is a real
statement about a real row. Prose does not repeat its own heading; requiring it to was
rigour in appearance only. What is worth excluding is the row that states nothing —
`Source: Wikipedia`, `Source: IMDb` — and that is the test now.

## Applied to production, 08.08

| verdict | rows |
|---|---|
| verified · the inscription is on a wall at this coordinate | 53 |
| verified · a resolved Q-id and a statement | 27 |
| verified · a filming permit issued by the city | 10 |
| rejected · photo_credit_not_a_place | 753 |
| rejected · not_a_place | 161 |

Reversible in one statement:

```sql
update location_submissions set status='pending', status_reason=null, reviewed_at=null;
```

## Only the decisive verdicts are stored

A pending row's reason is DERIVED and goes stale the moment a Q-id lands or the extractor
is fixed. Writing 42,884 of them would stamp `reviewed_at` on rows nobody decided anything
about, and the queue would then report itself as reviewed when the only thing that
happened was a label. It costs one script run to re-derive, and the runner prints the
whole breakdown every time.

**`verified` and `rejected` are written, because the map reads them.** Nothing else is.

## A verified row used to vanish off the map

`/api/locations` filtered `status = 'pending'`, so believing a submission would have
deleted it — the review would have quietly destroyed its own best results. It now filters
**not rejected**, and a checked row reads "Source checked" with the reason instead of "not
yet verified by us". It is still a candidate and still outside the graph, and the card
says both.

## Numbers here have a timestamp for a reason

The worktree `skype-ai-openrouter-movie-maps-bffab0` is running a resolver against this
same production table. Across forty minutes of this session the resolved-row count went
0 → 20 → 34 and the table lost 210 rows to its deduplication. Anything quoted from the
queue is a snapshot; re-measure before acting on it.

## Turning a name into a point

[app/lib/place-name-head.mjs](../../app/lib/place-name-head.mjs), run by
[scripts/geocode-submissions.mjs](../../scripts/geocode-submissions.mjs).

What is stored is an address; what Wikidata holds is the venue.

| asked | resolves |
|---|---|
| the name as stored | **0.8%** |
| the first comma clause alone | **31.7%** |
| head + area, kept only if the head landed inside the area | **8.3%** |

The middle number is the tempting one and it is the wrong one. Dropping the comma clause
throws away the disambiguator, which is exactly what `gazetteerName` refuses to do and is
right to refuse. Measured, that 31.7% includes:

```
Zorba, Leinster Gardens, Bayswater, London W2   ->  "Zorba"               ->  Colorado
St John's Square, Clerkenwell, London EC1       ->  "St John's Square"    ->  Malta
Federal Reserve Bank, Liberty Street, New York  ->  "Federal Reserve Bank"->  Dallas
Union League Club, West Jackson Boulevard, Chicago  ->  ...               ->  New York
```

So the clause is not discarded — it becomes the **area**, resolved separately, and the
head is kept only if it landed within 100 km of it. `chooseCandidate` cannot make this
check for us: it reports `unique` for a lone result wherever on earth it is, because its
job is choosing between candidates, not checking one against the world.

**Areas are tried most-specific-first**, and that alone doubled the yield (3.3% → 8.3%).
A country centroid confirms nothing at a hundred kilometres — anchoring "Kladruby
Monastery, Kladruby, Czech Republic" to the Czech Republic rejects a perfectly correct
row, while "Kladruby" the village next door confirms it.

**Applied to production, first batch of 1,000 movie-locations rows:**

| outcome | rows |
|---|---|
| accepted, with a point and the area that confirmed it | **64** |
| head not in Wikidata | 589 |
| area not in Wikidata | 161 |
| nothing enclosing the name to check against | 134 |
| **head landed OUTSIDE its area** — these would have been wrong pins | **51** |
| head is a common noun | 1 |

Lacock Abbey, Knebworth House, Willis Tower, San Francisco City Hall, Grace Cathedral,
the Stasi Museum, Navy Pier, the Unisphere, the Painted Hall at the Old Royal Naval
College. Reversible in one statement — every row carries `geocode_source = 'wikidata'`.

**And the run before it was thrown away.** It accepted 78 and wrote `inside undefined`
into all of them: `areaName` sits on the accepted record, not on the split, and reading it
off the wrong object emptied the note that says WHY a coordinate was kept. The points were
right. Storing them with no reason would have been 64 rows of exactly the debt
`provenance_is_required` was written against, so the batch was re-run rather than applied.

## The row's own hint, and the source whose hint is a lie

Every pending row carries an `area_hint`, and whether it may be used as the containment
anchor depends entirely on which site wrote it.

| source | rows with no area in the name | hint is an index bucket | hint is a place |
|---|---|---|---|
| movie-locations | 703 | **0** | 703 (117 distinct: Hampshire, Prague, Los Angeles) |
| reelstreets | 4,232 | **2,676** | 1,556, and they are "North", "Midlands", "Rest Of The World" |
| wikipedia | 18 | 0 | 18 |

**ReelStreets files every row under a section of its own alphabetical browse index** —
`London A-B`, `London H-L`, `London M-N` — and the TITLES are what is bucketed, not the
places. So:

```
"Pavilion Theatre on Westover Road, Bournemouth"   area_hint "London M-N"   160 km wrong
"Hotel Metropole, The Leas, Folkestone, Kent"      area_hint "London H-L"   110 km wrong
```

Each would be confirmed as London **by the very check whose job is to catch that**, because
the bucket resolves — to London — and nothing downstream would notice. The bucket is
refused by shape; everything else is simply asked, and the gazetteer declines "Rest Of The
World" by itself, which is where that judgement belongs.

Net effect: askable rows went 7,619 → **9,896**.

## The cache, and why refusals go in it

`cacheRow()` sat in `geocode-wikidata.mjs` from the day it was written with no table and no
caller. The full pass is what makes it necessary: 12,659 rows reduce to **12,352 distinct
names**, ~1,540 queries, over two hours at the module's own five-second gap before a single
429 — a job that long will be interrupted.

**Refusals are cached deliberately.** Two thirds of the heads resolve to nothing; an
ordinary house is not in Wikidata and will not be next week either. Caching only the hits
would leave most of the corpus re-asked on every run.

## The gazetteer refuses the anchors it is needed for most

Visible the moment the cache was populated:

```
london · paris · los angeles · cornwall · hampshire · bayswater   ambiguous_homonyms
leinster gardens                                                  -> Q3229195
```

`chooseCandidate` behaving exactly as documented — `dominantByPopulation` refuses when any
rival has a recorded population, and London Ontario has one. **Correct for a place we are
about to store, wrong for an anchor**, where any London in England would answer the only
question being asked. Measured cost: `area_unknown` is 161 of 1,000, so roughly +2–3
points on an 8.3% rate — real, modest, and worth measuring before building. See #149, which
also records what NOT to do: loosening the population rule to make London resolve would
break the refusal that is the feature.

**Refused before asking**, each one a measured wrong answer:

- `head_is_a_common_noun` — "the alley at the corner of Seaford Road…" reduces to "alley",
  which Wikidata places in Israel.
- `road_is_a_line_not_a_point` — "A82 at Rannoch Moor…" reduces to "A82", whose Wikidata
  point is the road's southern end in Glasgow: 80 km away, on the right road and in the
  wrong place ([[place-precision]]).
- `no_area_to_check_against` — nothing encloses the name, so nothing can confirm it. This
  is the rule that keeps Zorba out of Colorado.

## The full pass, applied 11.08

12,659 pending rows without a coordinate, one run:

| outcome | rows |
|---|---|
| **accepted**, with a point and the area that confirmed it | **405** |
| head not in Wikidata | 7,403 |
| nothing enclosing the name to check against | 2,676 |
| area not in Wikidata | 1,395 |
| **head landed outside its area** — these would have been wrong pins | **693** |
| head is a common noun / a road / too short | 87 |

3.2% — lower than the 6–8% the movie-locations batches gave, because this run included
ReelStreets, whose venues resolve far worse and whose hints are browse buckets. With the
64 from the first batch that is **469 coordinates**, and `catalogue_index` went 6,075 →
**6,250 works with at least one point**.

Lacock Abbey, Knebworth House, Cliveden House, Waddesdon Manor, Alnwick Castle, the Royal
Albert Hall, Schönbrunn Palace, Nonnberg Abbey, Luxor Temple, the Sacred Cenote at Chichén
Itzá, Katz's Delicatessen, the Unisphere, Heatherden Hall at Pinewood.

**Coarse areas rubber-stamp in a small country.** Spot-checked among the accepted:
"Kidderpore Avenue" (Hampstead) confirmed by Cambridgeshire, "Mornington Crescent" (Camden)
by East Sussex, "Alnwick Castle" (Northumberland) by Tyne and Wear. Every coordinate is
right — the head resolved to the real place — but at 100 km a neighbouring county confirms
nothing in south-east England. The check still does the job it was built for, which is
ruling out Colorado; it is not evidence that the county is correct, and the stored reason
should not be read as if it were.

## The cache is built, wired, and empty

The run learned **11,800 names** — 2,875 hits and 8,925 refusals — and `geocode_cache`
holds 12. The script emits them as SQL, and this machine has the anon key rather than
`SUPABASE_SERVICE_ROLE_KEY`, so loading them means moving a megabyte of statements by
hand. It was not worth doing that way.

**Anyone holding the service-role key can populate it in one run**: the script already
writes both halves, and `--sql` output carries the inserts. Until then a re-run re-asks
everything, which costs two hours of wall clock and nothing else. An anon INSERT policy
would fix the mechanics and is deliberately NOT added: an open write on this table lets a
stranger poison a coordinate, and a poisoned cache produces confident wrong pins.

## The anchor, and what it is honestly worth (#149)

`chooseCandidate` refuses `london`, `paris`, `los angeles`, `cornwall` and `hampshire` as
ambiguous homonyms, and that refusal is correct for a place we intend to STORE: London
Ontario has a recorded population, so choosing the English one would be inventing an
answer.

An area in this pass is never stored. It answers one question — "is this head roughly
there" — and that question does not need the homonym resolved. **If the head sits near ANY
place bearing the area's name, the pair is coherent.** Zorba in Colorado is near no London
on earth; the Millennium Biltmore is near a Los Angeles.

So the candidate list travels with the decision, refusal included. Nothing about the
chooser's rules changed: **loosening `dominantByPopulation` to make London resolve would
break the refusal that is the feature**, and a second, looser policy for anchors is how
two surfaces start disagreeing.

**The check is weaker, and the stored reason says so.**

```
head "Radio City Music Hall" inside "Sixth Avenue" (1 of 3 of that name)
head "Massachusetts State House" inside "Beacon Hill" (1 of 84 of that name)
head "Warner Grand Theater" inside "San Pedro" (1 of 224 of that name)
```

224 places called San Pedro is an anchor that constrains very little, and the row says so
rather than reading like a confirmation. **No cutoff was added**: a threshold at twenty
would have refused Monkton Combe (26), Warner Grand (224) and Glasnevin Cemetery in
Ireland (12), all of which are correct, and would have prevented nothing measurable. The
strength is recorded instead of guessed at.

Measured on 800 rows: `area_unknown` fell from **11.0%** of the earlier full pass to
**2.9%**, and every accepted row was anchored among homonyms — including **Kladruby
Monastery inside Kladruby**, the false negative this page recorded two days earlier.

**And the cache had to learn it too.** A cached refusal stored no candidates, so a hit on
`london` would have handed back a refusal with nothing to anchor against and silently
defeated the test — the second run of a two-run job accepting fewer rows than the first,
for no reason anybody could see. `geocode_cache.candidates` now carries them.

## The anchored pass, applied 12.08

Same corpus as the earlier pass, minus the rows it had already placed:

| | without anchors | with anchors |
|---|---|---|
| rows | 12,659 | 12,254 |
| **accepted** | 405 | **600** |
| `area_unknown` | 1,395 | **396** |
| `outside_area` | 693 | 1,094 |
| `head_unknown` | 7,403 | 7,401 |

The anchor gave about a thousand rows something to check against; **600 passed containment
and 400 failed it**. Nothing else moved — the dominant loss is still a venue Wikidata does
not hold.

**596 of the 600 were anchored among homonyms.** The median name had 12 candidates and the
90th percentile 53, so the "(1 of N)" note is not an edge case, it is the normal state of
this check.

Two of them show how loose it can be while the coordinate stays right:

```
head "Piccadilly Circus" inside "Ireland" (1 of 12 of that name)
head "Vaux-le-Vicomte" inside "California" (1 of 69 of that name)
```

Piccadilly Circus is in London and Vaux-le-Vicomte is in Seine-et-Marne; both coordinates
are correct, and both anchors were satisfied by a hamlet somewhere that happens to share
the name. **The check rules out the wrong continent and very little else** — which is what
it was built to do, and the row says how firmly.

**Running total: 1,063 coordinates from the gazetteer**, `catalogue_index` at **6,392
works** with at least one point, 11,581 pending rows still without one.

## An entity with no place of its own (#152)

The New York Public Library resolves to `Q219555`, whose P625 is `-74.0059728,
40.7127753`. New York City's own coordinate is `-74.006111111, 40.712777777` — **the same
point to about twenty metres**. The organisation has no location; it has the city's,
copied. The film used the Fifth Avenue main branch, five kilometres away, and nothing on
the card would have looked wrong.

**The issue's proposed fix is backwards, and the measurement says so.** Across all 1,063
rows the gazetteer has placed:

| | |
|---|---|
| organisation-like (P31 descends from `Q43229`) | **380** (35.7%) |
| of those, Wikidata gives a P276/P159 point | 137 |
| and that point is more than 1 km away | **61** |

Preferring it would have moved those sixty-one:

```
Columbia University          own = the Morningside campus (right)   P159 = New York City, 11.2 km
LACMA                        own = Wilshire Boulevard (right)       P159 = Los Angeles,   10.7 km
American Museum of Nat. Hist own = Central Park West (right)        P159 = New York City,  8.0 km
Sardi's                      own = the Theater District (right)     P276 = 5.3 km
```

**So the test is the opposite comparison, and only against P159.** A building's P276 is
the street it stands on and legitimately shares its point — the British Museum is one
metre from Great Russell Street, the Radcliffe Camera six from Radcliffe Square; **50 of
the placed rows look like that and all are correct**. A *headquarters* that close means
something different: the entity was never given a place, only an address in a city.

**The threshold is measured, not chosen.** NYPL's gap is ~20 m. The closest genuine
headquarters gap among placed rows is Brasenose College at **252 m** from Oxford's own
point. 100 m sits five times above the first and two and a half times below the second.

**Cost on the existing corpus: zero.** Not one of the 1,063 placed rows carries the
signature, so nothing had to be re-pointed. The rule exists because NYPL passed every
automated check and was caught only by a human reading 34 rows — which does not scale to
batches of 600.

**Asked separately, of the winners only.** Never folded into `buildGeocodeQuery`: that
query answered 500, 502 and 504 three times in one afternoon, and a second hop to the
headquarters' coordinate is the weight that made the class closure time out at 65 seconds.
One lookup per hundred winners. **It fails open** — a check that could not run must not
silently delete six hundred coordinates.

## Next, in order

1. **Finish the gazetteer pass.** 13,637 rows have never been asked; the first batch of
   1,000 ran on 08.08. It is bounded and resumable — `--kind` and `--limit` — and WDQS
   answers 429 under sustained load, so it is a job to run in batches rather than in one
   go. At the measured 8.3% the whole queue is worth roughly 1,100 points, on works that
   have none today.
2. **A human surface** for what a rule leaves pending, ranked so an hour of attention
   changes the map the most. The runner prints the backlog; nothing renders it.
3. **Promote a verified submission into a fact** — the 90 verified rows carry the sentence
   `statement` was built for ([[fact-architecture]]). Crosses "nothing from the queue
   enters the graph", so it is the owner's call.
4. **The 508 ReelStreets descriptions** deserve better than a head. They name a corner, a
   junction, a stretch of road — the kind of thing a routing service places precisely and
   a gazetteer cannot. That is a source choice, not a rules choice.
