---
type: concept
created: 2026-08-05
updated: 2026-08-05
sources: [code, log]
---
# Three axes, and why they are never one number

A place on this map is judged on three separate questions. Code: `place-review.mjs`
(evidence), `place-grade.mjs` (precision), `place-access.mjs` (access).

| axis | the question | what a weak answer means |
|---|---|---|
| **evidence** | is this place linked to the work at all? | unconfirmed — needs another source |
| **precision** | how exactly is it located? | an area, not a pin — needs a better address |
| **access** | can a person stand there? | not routable — needs someone to check the gate |

**They must never be multiplied into a single score.** A single number cannot say which
one is missing, and the three fixes are unrelated: another source, a better address, or
a phone call to the estate. `place-review.mjs` already carried this warning for its own
two halves — "conflating them is how a scoring model quietly starts lying" — and the
same holds across all three.

## The cases that prove they are independent

**Perfect evidence, unpinnable.** "Skyfall was shot in Istanbul" can carry a permit, a
cited article and a frame match. Istanbul is fifteen million people; there is nowhere to
stand. Owner's rule, 2026-08-04: an island named as a location goes on the map as an
**area**, never as a point.

**Precise, thinly evidenced.** A fan naming the café J.K. Rowling wrote in. This is the
common shape of the best material — the café, the stair, the underpass are exactly what
guided tours sell, and measured against operator itineraries we cover 8 of the 47
Edinburgh Harry Potter stops. So **thin evidence never hides a precise place.** It marks
it unconfirmed and keeps it. Weak evidence forfeits the right to look established, not
the right to exist.

**Precise and evidenced, and you cannot get in.** Midhope Castle is building-precision
and passes every rule the project had, while being a ticketed gate on a private estate
whose interior is derelict and closed to everyone including the guide.

**Coarse and perfectly walkable.** Culross and Falkland are villages — settlement rung,
therefore not pinned — and they are the two most walkable stops on the Outlander tour:
free, open streets you wander.

The last two are the pair that forced the third axis into existence. Precision and access
disagree **in both directions**, so neither can stand in for the other.

## Showing is not routing

The split the access axis turns on.

A **pin** says "this is connected to the work" — true whether or not the door opens, and
hiding unknowns would empty most of the map, because access coverage is thin. A
**generated route** says "go here, in this order, and it will be worth it" — a promise
about a specific day.

So `canShow` admits an unknown and `isRoutable` refuses it. This is aimed at the one
case where a self-guided map is *worse* than a coach: Midhope has 13+ named closure days
in 2026 and the operator reroutes on the morning, while a static route sends somebody to
a locked gate and lets them think it was their own mistake.

## Silence is not permission

**Corrected 2026-08-05.** This page said Greyfriars Kirkyard carries `opening_hours:
24/7`. It does not: its own OSM way carries no access tag at all, and the reading came
from a loose name match picking up The Elephant House 87 m away — the café's hours read
as the graveyard's. The comparison is now exact (`normalizePlaceName` equality, not
`namesMatch`, which accepts one extra word and duly turned "Notting Hill Bookshop" into
Notting Hill).

Measured with the strict rule, on twelve stops from tours that sell today, **OSM knows
about four**: The Elephant House, the V&A, St Paul's and Leadenhall Market carry hours.
Midhope Castle, Doune Castle, Culross, Falkland, Alnwick Castle, London Zoo, Greyfriars
and Marchmont carry nothing an app can read. Coverage is a **city** phenomenon: 3 of 4
in central London, 0 of 5 in rural Scotland.

An absent tag reads as `unknown` and never as `open` — reading "no tag" as "walk in"
would invent the exact promise the axis exists to stop making.

## How the axes reach a person (2026-08-05)

All three modules are called now; before this they were written, verified and reachable
from nothing.

| axis | where it lands | what a person sees |
|---|---|---|
| evidence | `/api/locations`, the pin and the card | a hollow dashed pin and "Unverified" for a candidate found by the inverted search |
| precision | `/api/locations` grades every place | a dashed **area** instead of a dot, plus "The source names this area, not a spot inside it" |
| access | `POST /api/access` → the timed tour | "Free to visit · hours" per stop, or "We have not confirmed whether you can get in", plus "3 of 4 stops" above the route |

**Where the access rule was softened, and why.** `isRoutable` refuses an unknown, and
applied literally to a whole tour that would leave no Scottish tour at all — 0 of 5 rural
stops resolve. So: a place OSM says is **closed** is never routed to; among tours of
equal length the one with more confirmed stops **wins**; and an unconfirmed stop is
carried with its own sentence rather than deleted. The option that stays forbidden is the
silent one — routing to an unknown and letting the wording imply it is open.

The same principle, one level down, is the database rule: see
[[place-precision]] for provenance. With no recorded source there is no way to tell a
right row from a wrong one.

See also: [[place-precision]], [[film-permits]], [[location-discovery]].
