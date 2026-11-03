# Runbook: the writes waiting for a session with the Supabase key

Prepared 2026-11-03 on the owner's Mac, which has no `SUPABASE_SERVICE_ROLE_KEY`. The owner
keeps the keys in Claude's cloud secrets, so these writes run in a cloud session on branch
`claude/live-content-check`. The owner approved both writes ("пиши", 2026-11-01).

Before anything:

```
node --env-file=.env.local scripts/check-service-key.mjs   # must print "role claim: service_role" and "ok — the key can write"
```

Also check the JWT `ref` is `quvxxqxowathrcyshhwj` (codex-hackathon). The account also holds
`kit-pos-brain` (`hoowbtzdzndvyihxhlpb`). A key from there connects and writes into the
wrong production without an error. Never print the key.

## 1. TMDB ids for 875 works

Source: `data/tmdb-match/matches.json` (the `imdb_exact` / `title_year_unique` rows of the
`candidates.json` that `scripts/match-tmdb-by-title.mjs` writes)
(read-only; rules in `app/lib/tmdb-title-match.mjs`). Write only the rows where
`duplicate_of_existing` and `claimed_twice` are both false: 875 of 943.

For each row:
1. Re-read `works` by `id`. Skip it if `tmdb_id` is no longer null.
2. Fetch `https://api.themoviedb.org/3/{movie|tv}/{tmdb_id}`. Skip it if TMDB has no record.
3. Save the live `tmdb_id, poster_path, backdrop_path` to
   `data/tmdb-match/rollback-<timestamp>.json` before writing.
4. Update `tmdb_id` (as a string), `poster_path`, `backdrop_path` (only values matching
   `^/[A-Za-z0-9._-]+$`) and `artwork_updated_at = now()`, with `.eq("id", id).is("tmdb_id", null)`
   so a row filled in the meantime is left alone.

Do a dry run first and print the counts. The 66 `duplicate_of_existing` rows are the same
film twice in `works`. They need a merge, not a write.

## 2. Four pins checked by hand (2026-10-19)

| place id | name | old lat, lng | new lat, lng | precision |
|---|---|---|---|---|
| 4d5f3da7-3074-4601-99f3-f70de6ccba03 | New York Public Library, Fifth Avenue | 40.7344, -73.9944 | 40.75318, -73.98225 | building |
| 6b3dee00-63f9-4628-9129-3cb926039a21 | New York Public Library, Fifth Avenue | 40.7794, -73.9633 | 40.75318, -73.98225 | building |
| 4bbb62e5-8633-4ad4-a3d0-95faeb5bcb5f | Ham House, Richmond, London | 51.5038, -0.1391 | 51.44466, -0.31257 | building |
| de1d8af9-4385-480b-af8a-626aaf4c28aa | Friedhof der Namenlosen, Vienna | 48.2165, 16.3959 | 48.1579, 16.4972 | point |

For each row:
1. Re-read the place. Skip it if its coordinate is more than ~100 m from "old".
2. Update `lat`, `lng`, `geocode_precision`, `snapped_at = now()`. Set `pre_snap_lat/lng` to
   the old coordinate unless `pre_snap_*` is already set; an earlier original stays.
3. Match on `id` AND the live `lat`/`lng`.
4. Append each written row to `data/pin-fixes/2026-11-03.csv`:
   `id,name,old_lat,old_lng,old_precision,new_lat,new_lng,new_precision,source,written_at`.

## After

- Commit `data/pin-fixes/*.csv` and a `wiki/log.md` entry with the counts. The rollback
  JSON stays local (gitignored); if it is lost, rolling back the TMDB write is selecting the
  `artwork_updated_at` window of the run.
- Not in this runbook: still classification and story trails. They are paid and wait for
  the owner's go after a measured cost.
