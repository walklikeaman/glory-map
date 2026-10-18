# Applying the content fixes (TMDB IDs and wrong pins)

Written 2026-10-18 after the live content check (PR #337). Auto mode on the owner's Mac
refuses to let Claude create a script that writes to the production database, so this is
the spec for the one command the owner runs themselves. Nothing here has been written to
the database yet.

## What it does

```
node --env-file=.env.local scripts/apply-content-fixes.mjs            # dry run (default)
node --env-file=.env.local scripts/apply-content-fixes.mjs --write    # apply
```

1. **Pilot TMDB backfill** on the 12 works from the live check. Same chain as
   `/api/enrich/artwork`: `works.wikidata_id` → Wikidata P4947 (film) / P4983 (series) →
   TMDB `/movie|tv/{id}` → `tmdb_id`, `poster_path`, `backdrop_path`. Print the 12 results
   and stop if fewer than 6 got an id.
2. **Full TMDB backfill**: call `createArtworkEnrichHandler` in-process (as
   `fill-story-trails.mjs` already does for `/api/trail`) until a batch returns
   `checked: 0`. Each batch is 60 works; definite misses are stamped (`artwork_updated_at`),
   so the run moves through the catalogue and can be stopped and restarted.
   Free: Wikidata and TMDB only.
3. **Pin fixes**: run `node --env-file=.env.local scripts/audit-place-pins.mjs` (read-only)
   and read `data/pin-audit/verdicts.json` from
   `scripts/audit-place-pins.mjs` and apply ONLY `verdict: "fix"` rows, each as its
   `update` object (`lat`, `lng`, `geocode_precision`, `pre_snap_lat`, `pre_snap_lng`).
   - Match on `id` AND the old `lat`/`lng`, so a row that moved since the audit is skipped.
   - Append every written row to `data/pin-fixes/<date>.csv`:
     `id, name, old_lat, old_lng, old_precision, new_lat, new_lng, new_precision, metres, source, written_at`.
   - `ambiguous` rows are never written; they go to the owner as `data/pin-audit/ambiguous.csv`.

## Safety

- Dry run is the default and prints exactly the rows `--write` would change.
- The key is checked first with `scripts/check-service-key.mjs` (right project, can write).
- Rollback for pins: for each row in `data/pin-fixes/<date>.csv`, set `lat`/`lng` back to
  `old_lat`/`old_lng` and `geocode_precision` to `old_precision`.
- Rollback for TMDB: the rows written are the ones with `artwork_updated_at` after the run
  started.

## Not in this command (need the owner's "go" after a measured cost)

- Still classification (`/api/enrich/stills`, gpt-5-nano vision).
- Story trails (`scripts/fill-story-trails.mjs`, about 1.5 cents per film).

## The audit as of 2026-10-18

2,908 places. Wikidata (1,856 with a Q-id): 1,846 within 150 m, 3 fixes, 7 with no P625.
Nominatim (1,052 without): 377 within 300 m, 21 fixes, 157 for review, 497 not found.
`data/pin-audit/fixes.csv` holds the 24 fixes, and `data/pin-audit/ambiguous.csv` the 157 rows
for review.

A geocoder answer becomes a fix only if it passes all of these rules:
- its name is the place's name exactly (a leading "the" aside);
- it is not a stand-in (bus stop, station, car park, bike dock, river, path);
- the query carried an area;
- the move is under 5 km;
- the row is not snapped to a footprint or a street;
- the answer is a point or a building. A street or an area has no single right point, so
  those go to review.
