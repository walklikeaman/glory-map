---
type: source
created: 2026-08-04
updated: 2026-09-11
sources: [web, research]
---
# Sources we looked at and did not take

## Correction 05.08.2026: not a commercial project

The owner clarified: this is a student demo and it is **not sold**. Restrictions of
licence TYPE (CC BY-NC, non-commercial model weights) therefore stop blocking — their
conditions are honoured as written, and all of it is revisited the moment selling is
discussed.

**Refusals below that rest on terms of use still stand.** Terms forbid the ACT, not the
earnings, so scraping IMDb is forbidden regardless of money. The same goes for frame
corpora whose owners hold no rights to the frames: non-commercial use of somebody else's
work without rights is still use without rights.

> **Correction 08.08.2026 — ReelStreets was named here and should not have been.**
> Re-checked live before the scrape shipped: `robots.txt` disallows only `/wp-admin/`
> and declares a sitemap; there is **no terms-of-use page at all** — `/terms`,
> `/terms-of-use`, `/legal`, `/disclaimer` all 404, and the site publishes only
> `/privacy-policy` and `/about-us`. No prohibition on crawling, robots, scraping or
> extraction appears on any page. The single "automated" match is the GDPR clause about
> automated decisions concerning people, which is not about access.
>
> What ReelStreets DOES state, at `/how-to-submit`, is that the screen captures remain
> the copyright of their title holders. That is a rights claim about the IMAGES and it is
> honoured: [[reelstreets-source]] stores image URLs as links for a reviewer, downloads
> nothing, and records `source_license = 'unstated'`.
>
> The distinction this correction turns on is the same one the paragraph above draws:
> **a licence says on what terms you may; a site's terms say whether you may at all.**
> ReelStreets asserts the first and has never published the second. IMDb publishes both,
> which is why it stays refused and ReelStreets does not.

The rule: **a licence says on what terms you may; a site's terms say whether you may at
all.**

**Owner's decision 05.08 on sources in general:** collect any source and mark it
unverified rather than discarding the lead. "Somebody said something happened here" is
worth showing when the card says exactly that and names who said it.



Recording a refusal is worth as much as recording a build: without this, the same
appealing idea comes back every few weeks and gets researched again.

## IMDb — no, and there is no paid path

Three independent bars, any one fatal:

1. **Conditions of Use** carry a standalone prohibition on "data mining, robots, or
   similar data gathering and extraction tools" without written consent. No volume or
   hobby carve-out.
2. The user licence is **personal, non-commercial, no download beyond page caching**.
   Storing images and re-presenting them on a map is exactly the withheld conduct.
3. **IMDb does not own most of the photos** — the Conditions say "IMDb *or its content
   suppliers*".

The third is why there is nothing to negotiate: **no licensing department sells IMDb
image rights**, because they are not IMDb's to sell. Asking is the wrong request to the
wrong party.

Everything IMDb was wanted for is already available: identifiers via Wikidata P345 and
TMDB, bulk metadata via IMDb's own published datasets (no images in either).

## Fandom — refused in July, taken in September, and the refusal was the mistake

**Superseded 10.09.2026.** The section below is kept because the reasoning is instructive
and half of it still holds. Implementation:
[app/lib/fandom-source.mjs](../../app/lib/fandom-source.mjs),
[scripts/ingest-fandom.mjs](../../scripts/ingest-fandom.mjs).

### What the refusal got right, and still does

Licences, verified live via `action=query&meta=siteinfo&siprop=rightsinfo` and re-verified
in September:

| wiki | licence |
|---|---|
| harrypotter, jamesbond, lotr, marvelcinematicuniverse, breakingbad, twinpeaks | CC-BY-SA |
| memory-alpha | **CC-BY-NC** |
| minecraft | **CC BY-NC-SA** |

**A correction to the obvious advice:** "read the licence from `url`, not `text`" fails on
its own example — Minecraft declares `CC BY-NC-SA` in the *text* while pointing at the
farm-default *URL*. Both must agree; disagreement means stop. `licenceAllows()` enforces
this and there is a test named after it.

**Images remain an absolute block.** The site licence covers text only. Fandom images are
overwhelmingly studio material under an unstructured fair-use claim by an anonymous
uploader — not a licence, and it does not transfer. Nothing in the ingest reads an image.

### What it got wrong

**It looked in the wrong place.** The check found the "Filming locations" CATEGORY empty on
the Bond, LOTR and Harry Potter wikis and concluded there was nothing there. The category
is empty; the content is in **tables inside film articles**. Re-measured over 14 sampled
pages per wiki:

| wiki | pages with a locations table | rows |
|---|---|---|
| jamesbond | 6 | ~70 |
| lotr | 2 | 24 |
| harrypotter, marvelcinematicuniverse, breakingbad, twinpeaks | 0 | 0 |

**And it applied a standard the rest of the corpus is not held to.** The decisive argument
was that a Fandom row is an anonymous, unsourced claim whose badge would look like a cited
one. That is true — and it is equally true of the **30,147 MovieMaps rows, 8,062
ReelStreets and 5,580 MovieLocations** already in the queue, every one a fan project. The
owner's rule of 05.08 is to take the source and mark it unverified rather than throw the
candidate away, and [[queue-review]] is the machinery for exactly that. Fandom was the only
source made to clear a bar the others were waved past.

The owner's argument, 10.09: film-location knowledge is fan-produced by nature. Measured
against our own corpus that is simply true.

### What was actually taken

**155 rows across 13 works**, from the two wikis that have the tables. Not a second
MovieMaps and it must not be planned for as one. Its value is in **what** it is: a pairing
of the place in the STORY with the place the camera stood, which almost nothing else we
hold carries.

> Hotel Mary Tierra, Republic of Isthmus, in *Licence to Kill*, was filmed at the Gran
> Hotel Ciudad de México.
> El Gran Palacio Hotel, Havana, in *Die Another Day*, was filmed at Playa de La Caleta,
> Cádiz.
> Hamburg Airport, in *Tomorrow Never Dies*, was filmed at Stansted.

147 of the 155 carry that pairing. Every row is a `pending` candidate with no coordinate,
under the same rule movie-locations is ingested by.

### The four refusals built into the reader

- **A non-commercial wiki is skipped entirely**, licence read live per wiki, text and URL
  required to agree.
- **A table whose shooting-location column cannot be identified yields nothing.** Three
  wikis produce three different tables and none agree on column order, so the reader
  classifies HEADERS. Reading by position would put a fictional place in the real column on
  two of the three.
- **Two bullet lists side by side are not pairs.** Skyfall's table lists seven in-film
  locations beside one shooting location; zipping them produced *"Istanbul was filmed at
  Pinewood Studios"*, which nobody claimed. The real place is kept and the pairing dropped.
  One story with several real places IS a pair — Oxford University was shot at Brasenose
  College and on Holywell Street, and both are that scene.
- **A region belongs to one side and only the header says which.** The Bond column "Country
  and region" is where the SCENE is set: the row reading "Russia" has its shooting location
  at an altiport in **France**. Feeding that to a geocoder as the area would search the
  wrong country, so a region only becomes an `area_hint` when its header ties it to a real
  place ("General Area in New Zealand").

Cells naming nothing are refused too — `Same`, `TBA`, `N/A`, `—`, and remarks like *"some
interior shots are studio"*. `Same` is the dangerous one: it means the row above, and
taking it literally attaches the previous location to a different scene.

### The revision is the citation

Every row stores `source_revid` and links to `?oldid=<revid>`, and the table's evidence
constraint **requires** it — Fandom is held to Wikipedia's rule because it is the same kind
of source. A fan wiki changes under you; "somebody wrote this on this page at some point"
is not checkable and a pinned revision is.

Where the fan left a citation of their own it is carried on the row (`cites: …`). Measured:
**3 refs across 70 Bond rows**, so it is the exception rather than the rule — but when it is
there it is the difference between a name and a checkable claim, and it is the thing the
July objection said would be missing.

## Frame corpora — real frames, no licence

Film-Grab (~4,099 posts) and Movie-Screencaps (~1,361) both expose open WordPress REST
APIs with full-resolution URLs. **Neither owns the frames.** A permissive footer grants
nothing when the copyright is the studio's. Technically open, legally unusable — and
that will not change with time.

Getty and Alamy editorial frame grabs *are* genuinely licensed per asset, and per-asset
pricing kills an archive. Shutterstock's editorial terms explicitly forbid "displaying
content as a 'gallery' … through which third parties may search", which is a description
of this product.

**MovieMaps (2026-08-05) is the same category with less cover** — no footer at all, and
each image page carries its own "Copyright Touchstone Pictures". Its 90,764 frames were
therefore taken as **links for the reviewer** and never as content, while its geodata was
taken as leads. That is not an exception to this section; it is this section applied.
See [[moviemaps-source]].

## The trap worth remembering: a fictional place that geocodes cleanly

Our homonym rule refuses **Cambridge vs Cambridge** — two real places, genuine ambiguity.
It does nothing against **Derry, Gotham, Springfield, Amity**, which resolve to exactly
one real settlement, confidently. A fictional place that geocodes cleanly is the
*best-looking* row in the review queue and the one most likely to be waved through.

Current exposure is low: narrative places only ever map into our own closed list
(`known_place` in [[demo-path]]'s story trail) and never reach the geocoder from free
text. This is the trap waiting for the books branch, and the check has to run **before**
the geocoder — not as "ask the model whether it's fictional".

## Ranked, for next time

1. **City filming-permit open data** — see [[film-permits]]. Primary records, geocoded by
   the issuer, open licence.
2. **Wikivoyage** — CC BY-SA 4.0, same MediaWiki machinery already built, and listing
   templates carry coordinates so the gazetteer is bypassed entirely.
3. **More Wikipedia languages and sections** — already built, marginal cost near zero.
4. **OpenStreetMap** — under ~100 filming-tagged objects worldwide. Keep it as the
   geocoding target it already is, never as a source of the work→place claim.
5. **Fandom** — below the threshold *(overturned 10.09.2026; see above)*.

See also: [[film-permits]], [[film-frames]], [[wikipedia-enrichment]].
