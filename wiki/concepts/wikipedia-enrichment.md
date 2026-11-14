---
type: concept
created: 2026-08-02
updated: 2026-08-02
sources: [code, log]
---
# Wikipedia prose as a source (#47)

Wikidata's P915 covers a few thousand films. Thousands more describe where they were shot
only in the "Production" section of their article. That is a large, legal expansion — and
it is the first path where a place enters the graph without a canonical statement behind
it, so **everything it produces arrives as `pending`** in `location_submissions`, which is
the queue [[place-precision]]'s review gate was built for. Nothing reaches the map
unreviewed.

Code: `app/lib/wikipedia-source.mjs` (fetching), `app/lib/wikipedia-extract.mjs`
(reading), `scripts/enrich-from-wikipedia.mjs` (the task).

## Deliberately a script, not a route

It is slow by design — one request a second to Wikimedia, five seconds between Wikidata
queries. The pacing is the difference between being a good citizen of two free services
and being blocked by them, and nothing about this needs to happen while somebody waits.

```
node --env-file=.env.local scripts/enrich-from-wikipedia.mjs [--limit 5] [--dry-run] [--work <uuid>]
```

Needs `SUPABASE_SERVICE_ROLE_KEY` (server-side only, bypasses RLS) and `OPENAI_API_KEY`.
`--dry-run` fetches prose without extracting.

## The two rules built into the shape

1. **The model is given no way to output a coordinate.** Not "instructed not to" — the
   schema has no such field. It returns a NAME; [[geocoding-cascade]] turns names into
   points. This is the same rule #121 retrofitted onto [[location-discovery]].
2. **The quote is checked, not trusted.** Every returned sentence must appear VERBATIM in
   the prose we supplied, or its location is dropped. This exists because the scene
   matcher demanded that a model justify itself, received a fluent and specific
   justification, and shipped a fabricated match — see [[film-frames]]. *Demanding
   evidence is not the same as checking it.*

Other gates: a place the article merely mentions (`is_filming_location: false` — "the crew
scouted Venice but shot in Malta" names two places and only one is a location), a quote
too long to be a citation rather than a passage, a duplicate name. A dropped location is
the normal case, not a failure.

## Verified against the live APIs, not recalled

Several of these are the opposite of a reasonable guess:

- A missing or library-default User-Agent gets **HTTP 403** from Wikimedia. Not a
  throttle — a refusal. The UA must carry a real contact.
- `action=parse&section=` takes the section's **`index`**, and index is NOT `number`. On
  "Lost in Translation (film)" Production is index 8 and number 4; passing the number
  silently returns different prose, which is worse than an error.
- Wikimedia returns errors with **HTTP 200** and an `error` key, so checking the status
  code alone reports success on a missing article.
- `prop=sections` is deprecated in favour of `prop=tocdata`; `revid` must be requested
  explicitly or the permalink cannot be pinned.
- The h2 "Production" is preferred over its "Filming" child — MediaWiki returns the whole
  subtree, so asking for the child throws away the siblings that carry the location prose.

## A lagged replica is not a missing page

Both arrive as HTTP 200 with an error body, and treating them alike abandoned an entire
run over eight seconds of routine replication lag — from a call that sits outside the
per-work error handling.

- `missingtitle`, `invalidtitle` — permanent. Skip the work.
- `maxlag`, `readonly`, `ratelimited` — temporary. Retry, with a growing wait, bounded so
  an indefinitely lagged service still fails loudly.

`retry-after` is a **floor, not a promise**: measured live the response carried
`retry-after: 5` alongside `x-database-lag: 8`, so repeating it unchanged asks the same
question five times against a lag that is not moving.

`MAX_DATABASE_LAG_SECONDS = 30`, not 5. Five is the value for a bot making **edits**; we
read article titles and sitelinks, which change on the scale of years, so a replica eight
seconds behind serves data byte-for-byte identical to a fresh one and being turned away
protects nothing. A real incident runs to minutes, which 30 still refuses.

## Licensing

Wikipedia text is CC BY-SA 4.0 and every stored sentence carries its article title, revid
and permalink. Quoted third-party material — a director's interview republished in the
article — is carried by Wikipedia under its OWN fair-use policy and is **not** CC BY-SA,
so it is stripped before any sentence is considered rather than filtered at display time.

## Known limits

- Books have no "Production" section. The thinnest works in the graph get nothing from
  this path.
- Only tier 1 of [[geocoding-cascade]] exists, so many accepted places queue without a
  coordinate. That is intended: the claim is still real and reviewable.

See also: [[location-discovery]], [[geocoding-cascade]], [[place-precision]].
