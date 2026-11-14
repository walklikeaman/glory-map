---
type: concept
created: 2026-08-08
updated: 2026-08-08
sources: [code, log]
---
# Fact architecture — a work has many facts, a place has many works

Issue #129. Step 1 of that issue asks for the current schema worked through **on paper**
against real examples before any migration is written. This is that page, and it stayed
after the migration because the examples are the argument.

Related: [[three-axes]], [[place-precision]], [[location-discovery]],
[[commemorative-plaques]].

## The shape, before and after

A link row **is** a fact. That idea was right from the start, and `place_evidence` already
hangs off a link rather than only a place. What was missing is that a fact had no identity
of its own beyond the triple it was made of.

```
before   work_place_links (work_id, place_id, scene_id, relation_kind, confidence,
                           narrative_order)
         unique (work_id, place_id, relation_kind) where scene_id is null   -- partial!
         unique (scene_id) where scene_id is not null

after    work_place_links + about, stated_year, statement
         unique (work_id, place_id, relation_kind, scene_id, about) nulls not distinct
         creator_place_links (creator_id, place_id, relation_kind, about,
                              stated_year, statement, confidence)
         place_facts          -- view: both tables, one shape
         work_facts(work_id)  -- rpc: the work's facts + its people's facts + distance
         fact_distance(subject_type, relation_kind)
```

## Ten examples, and what each one could say

| # | the fact | before | after |
|---|---|---|---|
| 1 | Skyfall was filmed at Glencoe | ✅ | ✅ |
| 2 | Harry Potter is set at King's Cross | ✅ `narrative_location` | ✅ |
| 3 | Thomas Riddell's grave gave a character its name | ✅ `inspiration_for`, since 05.08 | ✅ **and marked distance 2** |
| 4 | The Green Dragon was built for visitors, never shot in | ✅ `replica`, since 05.08 | ✅ |
| 5 | **Twelve Beatles recordings at Abbey Road**, each with its year and its source | ❌ one row | ✅ `about` = the album |
| 6 | **Two scenes in one building**, from two different sources | ❌ one row, or one scene each and then only one place per scene | ✅ `about` = the scene |
| 7 | **Rowling wrote in this café** | ❌ seven rows, one per book, evidence copied seven times | ✅ one row in `creator_place_links` |
| 8 | **The plaque's own sentence**, printed as written on the wall | ❌ nowhere to put it; the card said "Where the author worked" | ✅ `statement` |
| 9 | **The year the source states** — a plaque saying 1924–1949 | ❌ nowhere; `works.year` is the work's year, not the claim's | ✅ `stated_year` |
| 10 | **A doorway where Hitchcock and Harry Potter both have a fact** | ❌ no query read a place from its own end | ✅ `place_facts` |

Rows 5–10 are the ones that mattered, and they cluster: every one of them appears the
moment a source states a **specific claim with a date and a sentence** — which is exactly
what plaques (#125) and music (#128) are.

## The outage nobody was watching

Found while measuring the above, not while looking for it.

`20260731234121_scene_links_allow_revisits` replaced the unique **constraint** with two
**partial** unique indexes so a story could revisit a place across scenes. The reasoning in
that migration is careful and correct about NULLs. It missed one consequence: PostgREST
sends

```
ON CONFLICT (work_id, place_id, relation_kind)
```

with no `WHERE`, and Postgres cannot infer a partial index from a bare inference clause.
Probed against production on 08.08:

```
ERROR 42P10: there is no unique or exclusion constraint matching the ON CONFLICT
specification
```

`/api/resolve` is the **only** write path into the canonical graph, and it fails there —
*after* the Wikidata round-trips have succeeded, so the route looks busy and returns an
error nobody reads. The graph has stood at 92 links and 70 places since 31 July while the
review queue grew to 44,098 rows.

The fix is a **full** index with `nulls not distinct`, which Postgres 15 gained and this
database (17.6) has. It restores inference and keeps the guarantee the split existed to
protect: two scene-less rows for the same triple still collide, because their NULLs no
longer compare as distinct.

**The general lesson, and it is the second time this project has paid for it:** a schema
change that is correct in SQL can still break the client that talks to it. `on_conflict` in
PostgREST is a promise about an index shape, and nothing in the database tells you who is
relying on it.

## Degree of separation

The owner wants facts about the crew and about what influenced a work. That is right, and
it is also the main risk: **"Harry Potter places" quietly becomes "places connected to
anything Rowling ever touched"**. So a fact always carries its distance, computed once, in
`fact_distance()`:

- **0** — about the work itself: filmed here, set here, recorded here
- **1** — about its person: the director lived here, the author wrote here
- **2** — about what influenced it: the grave that gave a character its name

**0 and 1 may enter a route. 2 is a separate block with different wording**
(`MAX_ROUTABLE_DISTANCE` in [app/lib/facts.mjs](../../app/lib/facts.mjs)). Mixing them into
one list is exactly the case where the map starts promising more than it knows.

`author_place` and `artist_place` hang off a `work_id` and are still facts about a person,
so they are distance 1 too. That legacy shape is why the rule lives in one function rather
than in a `subject_type` check.

## A sentence instead of a template

`placeRole()` builds the card's phrase from the relation kind. That was the only option
while a fact was a bare Wikidata triple, and it stays the fallback. When a source states
the sentence, the sentence is stored and printed **verbatim, trimmed and nothing else** —
a quote that has been tidied cannot be checked against the wall it was copied from, which
is the only thing that makes it evidence.

## What was deliberately NOT done

- **`work_place_links` was not renamed.** Eight stored functions and one view reference it
  by name; plpgsql and SQL function bodies are stored as text and do **not** follow
  `ALTER TABLE ... RENAME`, so a rename would silently break every map RPC on the demo
  path. The name is cosmetic, the shape is not.
- **One physical table for both subjects was not built.** #129 proposes `(subject_type,
  subject_id)`. Two typed tables keep the foreign keys — a fact cannot point at a creator
  that does not exist — and `place_facts` gives the single read surface the proposal was
  really after.
- **`work_place_links_scene_idx` was kept.** Two places for one scene (an exterior and an
  interior) is a real thing, but `work_scenes` left-joins scene to link and would silently
  return the scene twice. That is a trail change, not a fact-architecture change.
- **`links_without_evidence` was left exactly as it is** — the handoff measures against it
  (8 rows, must not grow), and moving its goalposts in the same commit that adds a second
  fact table would make that number unreadable. `facts_without_evidence` is the union.

## What has a reader and no writer yet

`statement`, `about` and `stated_year` are read by the work card today and written by
nothing. `/api/resolve` deliberately leaves `statement` null: a P915 statement says a work
and a place are related and no more.

**The first real producer is the 53 Open Plaques rows already in `location_submissions`**,
each carrying the inscription sentence and a work id. Promoting them into facts would give
`statement` its first content, and it is an owner decision, not a technical one — nothing
from the queue has ever entered the graph. See #125 and the queue section of
[[handoff]].
