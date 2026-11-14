---
type: concept
created: 2026-07-27
updated: 2026-08-05
sources: [code, log]
---
# Place precision — when a pin may move, and when two pins are one place

Two operations touch a place's identity: **snapping** it onto a building footprint
(`app/lib/building-snap.mjs`, #45) and **merging** it with another place
(`app/lib/place-dedup.mjs`, #46). Both are destructive if wrong, and both were
designed against the real graph rather than from the brief — which changed the
answer in both cases.

The shared principle: **a moved or merged pin is a claim.** If we cannot source the
claim, we do not make it. Refusing costs a little precision; being wrong invents a
fact, which is the one thing this project exists not to do.

## Merging — proximity is necessary, never sufficient

The brief said "group by proximity + name". Checked against production first: the six
closest pairs we hold are all **different places**.

| pair | distance | what it is |
|---|---|---|
| National Gallery ↔ Trafalgar Square | 95 m | the gallery stands *on* the square |
| Trafalgar Square ↔ **London** | 100 m | "London" is a **city centroid** |
| Aldwych station ↔ Strand | 227 m | a station *on* a street |

A "within N metres" rule merges all six. The London pair is the dangerous one: it
turns a source that said only *"London"* into one claiming Trafalgar Square.

Three rules, all required:

1. **Distinct Wikidata entities stay distinct.** Wikidata already decided they are
   different things; we do not overrule it.
2. **Precision buckets never mix.** A city centroid and a building are different
   *kinds* of claim; merging silently upgrades the vaguer one.
3. **Names must agree.** Same spot + same name is a duplicate; same spot + different
   name is a neighbour.

Merging is deliberately **non-transitive** — a candidate joins a group only if it
matches *every* member, or a chain of 40 m hops would swallow a whole street.

Verified on production: **63 places → 63 groups, 0 merges.**

## Snapping — containment decides before proximity

A point inside exactly one footprint identifies that building. This is what makes the
feature work in a dense street: **Selfridges had six candidates within 60 m**, and
proximity alone could not have chosen. Only when nothing contains the point does a
lone nearby building count. Anything else is ambiguous, and an ambiguous snap is not
a snap — the point and its precision are left untouched.

`pre_snap_lat` / `pre_snap_lng` always keep the original coordinate, so every moved
pin is provable and reversible. A DB constraint (`places_snap_is_complete`) refuses a
snap that cannot prove itself.

## What production taught that the tests could not

- **A city is not a building.** Shanghai snapped `city` → `building` because its
  centroid happened to fall inside a tower. A place known only to its city or country
  now needs the building to confirm it **by name** — Gloucester Cathedral inside a
  footprint OSM also calls "Gloucester Cathedral" is evidence; Shanghai inside an
  unrelated tower is a coincidence. The bad row was reverted from `pre_snap_*`.
- **Overpass 429s the request straight after a successful one.** Base pause is 5 s
  (measured, not guessed) and a 429 doubles it for the rest of the run — being
  throttled is the only signal we get about our own rate, so it must change behaviour
  rather than be logged and forgotten.
- **An unknown precision counts as vague**, so the cautious path is the default.

## Geometry gotchas

- The area centroid must be computed against a **local origin**. Cross products of
  raw degrees resolve a 40 m building to ~1e-8 and lose it to floating-point
  cancellation.
- A centroid can fall **outside** its own footprint — a U-shaped building's centre is
  in the courtyard — so it is rejected when it does.
- A snap that would drag the pin more than 100 m (an airport, a campus) is refused;
  if we were inside the footprint the building is still confirmed, but the pin stays.
- Places need their **own** name normaliser. `normalizeWorkTitle` folds to `a-z0-9`,
  which empties "Красная площадь" and "東京タワー" entirely and would silently disable
  deduplication for most of the world.

## Licensing

OSM is **ODbL** — attribution ships with every snapped coordinate
(`OSM_ATTRIBUTION`). Unlike Street View imagery ([[film-imagery]]), footprint
geometry may be stored.

Related: [[location-discovery]] (where places come from),
[[testing-conventions]] (how these rules are enforced).

## Provenance is a database rule, not a habit (2026-08-05)

Every stored fact records where it came from, and the database enforces it.

Stated by the owner on 2026-08-05, and it was already the convention and already
broken. Measured before writing the rule: **92 links in `work_place_links`, 8 of them
with no evidence row at all.** Checked against Wikidata, five correspond to real P840
statements and **three do not exist there** — Skyfall→Hashima Island,
Skyfall→National Gallery, Harry Potter→London Zoo.

Those three are probably TRUE. Hashima is the acknowledged model for Silva's island,
the zoo is the snake scene. That is the whole argument: **with no recorded source there
is no way to tell a right row from a wrong one**, and "probably true" is the state this
project exists to refuse.

What the database now enforces:

- `place_evidence` must carry an identifiable source — a `source_url` for a page or a
  `source_ref` for a statement (Q-id, TMDB id, image id). A snippet describes a source;
  it cannot stand in for one.
- `work_place_links` must have at least one evidence row, checked by a **deferred**
  constraint trigger so link and evidence can be written together, which is how they
  are actually written.
- `links_without_evidence` lists the debt. A rule whose violations cannot be listed is
  a rule nobody can pay off.

Both constraints are `not valid` / deferred rather than retroactive. Validating would
fail on rows nobody can now source, and deleting those would destroy facts that are
probably correct. Visible debt is the honest state; an invented citation is not.

**A subtlety worth writing down:** a `deferrable initially deferred` constraint trigger
fires at COMMIT, so it cannot be caught by an exception block in the same transaction —
the first test of this rule reported it was not working when it was.
