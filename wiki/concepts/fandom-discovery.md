---
type: concept
created: 2026-09-12
updated: 2026-09-12
sources: [code, log]
---
# Fandom at scale — where to read, and what prose costs

`app/lib/fandom-discovery.mjs` + `scripts/discover-fandom.mjs`, and the `--prose` branch of
`scripts/ingest-fandom.mjs`. Related: [[personal-library]], [[wikipedia-enrichment]],
[[model-providers]], [[location-discovery]].

## The request, and the two things that answered it differently than expected

*"Read every article on Fandom, not just Bond and LOTR."* Measured before built, and the
measurement moved the plan twice.

**The wiki index is not reachable and does not need to be.** Fandom's own
`/api/v1/Wikis/List` sits behind a Cloudflare challenge and answers **403**. Getting past it
would be bot-detection evasion; nothing here touches it. Every request this code makes is
either Wikidata's SPARQL endpoint or a wiki's own `api.php`, both open, both paced.

**Wikidata answers a better question.** Property **P6262 "Fandom article ID"** holds
`wiki:Page_Title` — 206,443 statements over 132,855 items, of which **32,323 also carry an
IMDb id**, the key `works` already uses. So the join gives not a list of wikis to crawl but
*the exact page for a work we hold*: one fetch instead of a search, and no enumeration at
all.

## Ask about what we hold, not about all of Wikidata

**A skipped chunk is lost catalogue, not a lost request.** The first real run lost 2 of 16
chunks to 502 and printed "754 works" as though that were the answer — 12% short, silently.
Three attempts with a growing wait fixed it and the same run then found **957**, a quarter
more; 4xx is not retried, because that is the query's fault and will fail identically. A
chunk that still fails is counted, and the total says `INCOMPLETE: up to N works unasked`
rather than presenting a short count as a finding.

The first version paged the whole property with `LIMIT/OFFSET`. The public endpoint answered
**502 on the second page** — an OFFSET over 206,443 statements re-sorts the lot on every
request, and page two is what pays for it.

It was also the wrong question. We hold 6,044 works with an IMDb id; the other 26,000
matches are rows to fetch and discard. Chunked `VALUES` of 400 ids each asks only what can
be used: sixteen cheap queries instead of one unbounded scan, and a chunk that fails is
skipped rather than ending the run.

## Ranked by OUR overlap, not by wiki size

The largest wikis in the join are not the ones the catalogue overlaps — the top of the
size-ordered list is `routes`, `turtlepedia`, `memory-alpha`, none of them a film catalogue
in our sense. Reading down that list spends the budget in the wrong place, so `rankWikis`
counts only works we actually hold.

`memory-alpha` is third-largest **and CC-BY-NC**, so it is refused on licence before a
single page is fetched. The licence is read live per wiki, and the list of wikis is not
permission.

## What it actually found, 11.09

957 of our 6,044 works have a Fandom page, across 242 wikis. Sampling five pages on each of
the top fourteen:

| wiki | our works | readable free | prose | no section | rows |
|---|---|---|---|---|---|
| movies | 233 | 0 | 3 | 2 | 0 |
| the80smovies | 81 | 0 | 0 | 5 | 0 |
| scifi | 48 | 0 | 0 | 5 | 0 |
| tropedia | 30 | 0 | 0 | 5 | 0 |
| marvelcinematicuniverse | 22 | 0 | **5** | 0 | 0 |
| television | 21 | 0 | 0 | 5 | 0 |
| jamesbond | 20 | **2** | 3 | 0 | **41** |
| disney | 17 | 0 | 3 | 2 | 0 |
| memory-alpha | 15 | — | — | — | skipped, CC-BY-NC |
| starwars | 13 | 0 | 4 | 1 | 0 |
| dcextendeduniverse | 10 | 0 | **5** | 0 | 0 |

**Two readings, and the second one is the useful one.**

The free path is all but exhausted: 2 readable pages in 70, and every row still comes from
the Bond wiki. The generic aggregators that dominate the overlap — `movies`,
`the80smovies`, `scifi`, `tropedia`, `television` — carry no location section at all, five
pages out of five.

But **24 of the 70 sampled pages are prose**, and they are concentrated: MCU and
`dcextendeduniverse` are prose on every page sampled, Star Wars on four of five. Those are
the pages a model pass would be buying, and the report exists so that the number is known
before the money is.

Whether that prose actually names real filming locations rather than in-universe ones is the
question a capped run answers — `--prose 40` over MCU and DCEU costs tens of calls, not
thousands, and settles it.

## What the report is for

Per wiki it prints how many sampled pages are readable for free (table or list), how many
are **prose**, and how many rows the free path got. Prose is not a failure in that table —
it is the measurement that says what a model pass would be buying, counted *before* anybody
spends on it.

## Prose, and the rule a model works under

Measured 11.09 over 48 pages on six wikis: of the 26 carrying a filming section, 12 are
prose that no regular expression reaches. Those need a model — under the rule
[[location-discovery]] states and every other pipeline here already follows: **a model may
NAME a place, never locate one.** It names; the geocoding cascade locates afterwards,
separately, with its own provenance. A prose row is written with `lat: null`.

Three things keep it honest:

- **The verbatim-quote gate.** `acceptExtraction` discards any location whose quoted
  sentence does not appear in the page character for character. A fluent sentence is not
  evidence that the sentence exists, and this project has shipped that failure once.
- **The quote is stored, never generated.** `toProseSubmission` puts the model's own
  sentence in `source_sentence`, beside a permalink to the revision it came from, so a
  reviewer reads the same words on the same page.
- **The cap is a flag.** `--prose 40` means at most forty model calls in a run, so the bill
  is known before the run rather than after it. Prose is tried only where tables and lists
  found nothing, and only after the page has been matched to a work — paying to extract a
  page we cannot attach to anything is paying to throw it away. A page that has a table is
  never re-read by the model: its table carries the story-to-shoot pairing that prose does
  not, so the model would buy strictly less.

The tier is **cheap**, which [[model-providers]] defines as a task whose answer is checked
by code afterwards. The gate is that check.
