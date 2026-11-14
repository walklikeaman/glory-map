---
type: concept
created: 2026-07-28
updated: 2026-07-28
sources: [code, log]
---
# Film frames — three tiers, and what each may claim

A picture from a film can be shown in three different ways, and they are not
interchangeable. The tier decides where it may appear and what sentence may sit
under it. Mixing them is how a map stops being trustworthy.

| tier | what it is | where it appears | what it claims |
|---|---|---|---|
| **A. Matched** | a frame verified to show this place | the place, in the profile | "this scene was shot HERE" |
| **B. From the film** | a real frame, location unknown | the film's gallery | "this is from the film" |
| **C. Studio** | shot on a soundstage | the studio's own pin, badged | "filmed at Pinewood, depicting London" |

The rule underneath: **a frame may sit next to a place only if the claim "this
frame shows this place" is sourced.** Everything else is film-level.

## Tier B — metadata cannot tell a frame from a poster

TMDB files production stills and promotional key art under one `backdrops` list.
The obvious filter — TMDB marks the language of text baked into an image — was
tried and **does not work**: Skyfall's gun-barrel art is textless too, because a
silhouette honestly contains no text. It is simply not a frame from the film, and
that is a judgement about the picture.

So `still-classify.mjs` looks at the picture. The question is deliberately narrow
— "is this a photographic frame?", no place involved — which makes it cheap and
**permanently cacheable**: the answer for a file never changes, so every image is
paid for once. Rejections are stored too; without a negative row the same poster
is re-judged on every visit.

Measured across 12 films: 144 images, **69 real frames (48%)**. A posed cast
portrait is rejected even though it is photographic — a picture of the actors is
not a moment from the film.

## Tier A — demanding evidence is not the same as checking it

The hard-won lesson. The matcher is built to assume NO: only places precise
enough for the question to mean anything (matching a frame to "Japan" is a mood),
only places with a reference photograph, never a studio, only `high` confidence,
and evidence is a NOT NULL column.

**It fabricated a match anyway.** A misty Scottish road was matched to Hankley
Common, a sandy Surrey heath, justified by *"sandy dirt road leading uphill,
sparse trees and white surveying posts"* — none of which is in that frame. The
model had described the REFERENCE photo and asserted its features were in the
frame. The sentence was fluent and specific, so every gate passed it.

The cause is both images being in view at once. The fix is a second pass with
**only the frame present**: nothing to conflate it with, so "is this visible
here?" becomes answerable. It is phrased to refute rather than confirm, lists
what it cannot see *before* the verdict, and is told that merely plausible is not
visible. Any outcome but a positive clearance kills the match — including a check
that failed to run.

## The source, not the matcher, is the current limit

Tier A yields **zero matches** on our data, and in 8 of 12 cases the *first* pass
declined — so this is not the refuter being harsh.

Depth was also a self-inflicted limit: Skyfall has 98 images on TMDB and only 12
were judged, and the top twelve by vote count are the worst twelve, because
posters and cast hero shots are what people vote on. Raised to 48 in batches of
12 (indices are how a verdict finds its image, so batches are numbered locally).
Skyfall went 4 → 18 frames. Still zero matches.

**A film's TMDB gallery is a marketing asset chosen to sell the film through its
actors, not a location survey.** Tier A is sound and refuses correctly; it needs a
different source of frames. Loosening the thresholds to manufacture a positive
would reinstate exactly the failure that was just removed.

Related: [[place-precision]] (studio vs on-location), [[film-imagery]] (the older
per-place matcher and its HMAC token), [[testing-conventions]].
