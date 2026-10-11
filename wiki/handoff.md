# Handoff — 2026-09-20, after the text sources learned to read

Written because a session ended, not because the work did. `wiki/log.md` is the
chronicle and `wiki/index.md` lists the concept pages. **This page is only the things
that would cost a day to rediscover.**

## The product, in one paragraph

GloryMap replaces the film-location tours operators sell — the Game of Thrones coach in
Antrim, the Harry Potter walk in Edinburgh. That makes the deliverable **a route
somebody walks**, not a database of pins, and it widens what counts as a place: not only
where a work was filmed, but where it was **written or made** — the café Rowling wrote
in, the graveyard she took a name from. Every pin is source-backed and never invented.

The owner's acceptance test for the demo, in his words: **a juror names their favourite
film, we type it in, and it is there — with no doubt that we have it.** Measured on
production in August: empty for **0 of 24** famous titles, median 1.3 s.

**Re-run on 21.09, through the search box the juror would actually use.** 23 of 24 put the
right film first, median **402 ms**. Eight show no verified places in the dropdown — Titanic,
Pulp Fiction, Shawshank, Casablanca, Jurassic Park, Mamma Mia!, Parasite — and every one opens
onto a card with 1–13 labelled candidates, which is what #272 meant to happen. **The one
failure was Spirited Away**, one of the three titles the August fix was made on: it is not in
our catalogue, and the box answered with seven look-alikes (The Sacred Spirit, Cast Away,
Suspiria) and never said so, because its "not in our catalogue" note appeared only on zero
rows. Fixed in #282 — `/api/search` returns `held`, the box says it first and offers a button
to the live lookup, which puts the film in Japan. **The August list of 24 was never written down**;
the one used on 21.09 is in `wiki/log.md` under that date, and it should be the fixed list from
now on, because a test nobody can repeat exactly is a test that drifts.

## State, in numbers (live, 20.09)

| | |
|---|---|
| main | `db7d9d2` — "the route you are on survives the tab dying in your pocket (#274)" |
| tests | **1,577 pass, 0 fail**, `node --test test/*.test.mjs`, zero network (1,565 before the two ratings PRs) |
| works | 7,063 · **5,480 carry a `wikidata_id`** (was 28 before the backfill of 12.09) |
| enriched from Wikipedia | **441 of 5,480** (21.09, 01:33 UTC, and climbing — the run is live). `works.wikipedia_enriched_at` is the progress marker |
| queue | **45,601** rows (21.09, 01:33 UTC): verified **4,703** · rejected **926** · pending **39,972**, of which **11,997 hold no coordinate** |
| the graph | **places 2,908 · `work_place_links` 4,688** (21.09, 01:33). Both were 70 and ~70 the day before — see the promotion below |
| the two text sources | wikipedia **463 placed**, of which **36 are `author_place`** · fandom **11 placed** (20.09) |

## The queue became the graph, on 21.09, and not by this page's plan

**#272 applied the review verdicts and promoted them.** 4,703 rows are `verified`, `places`
went **70 → 2,908** and `work_place_links` stands at **4,688**. Hours earlier this page
carried exactly that as an open decision for the owner, with the numbers to argue it. A
different session took it while the decision was being written down — which is this page's
own trap about two sessions taking the same next step, met from the other side, and it cost
nothing this time only because one of the two was a paragraph.

**It is not a thing that stays done.** The promotion covers the rows that existed when it
ran; the Wikipedia enrichment has added ~350 since and will add thousands more, each landing
`pending`. `scripts/promote-verified.mjs` is the pass to run again, and running it is the
difference between a map and a map plus a growing pile of candidates nobody has looked at.

## Where the ingest pipelines stand, and how to restart them

**Running again since 20.09, 23:03 UTC.** The 16.09 run died with the machine and
`/tmp/enrich-full.log` went with `/tmp`. Nothing was lost — every work is stamped as it
finishes, and the live count of unstamped works was still exactly **5,216** when the new
run started, so the restart resumed rather than repeated.

```bash
nohup bash scripts/enrich-loop.sh --limit 5500 >> ~/enrich.log 2>&1 &
```

**Start it through the loop, not directly.** The run was always resumable and nothing ever
resumed it, which is the whole of the 16.09 loss.
[scripts/enrich-loop.sh](scripts/enrich-loop.sh) runs the script again every two minutes
until it prints its own `Nothing to enrich.`, finds the env file by asking which one holds a
`service_role` key for `quvxxqxowathrcyshhwj` rather than by path, and stops itself if ten
runs in a row die inside ninety seconds — that pattern is a broken configuration, and
looping on it only hides it. The restart it was written for arrived within the hour — see
the maxlag trap below, which is also now fixed at the source. It also takes a lock, because
the work list is chosen once per attempt and a second copy would spend the same rate limit
reading the same articles.

**And the machine restarting is covered too, by a LaunchAgent.**
[scripts/install-enrich-agent.sh](scripts/install-enrich-agent.sh) writes
`~/Library/LaunchAgents/com.glorymap.enrich.plist` and loads it; `--status` says whether it
is loaded and running, `--remove` takes it away. Two things about it are worth knowing
before trusting it. **It starts at LOGIN, not at boot** — a machine left at the login window
is a machine not enriching, and running through a boot would mean a LaunchDaemon as root,
which is not worth root for a job that reads Wikipedia. And its `KeepAlive` is conditional:
the loop exits 0 only when the catalogue is finished, and an agent that restarted *that*
would read all 5,480 works again, so only a non-zero exit brings it back, after five
minutes. **To stop the job**, `bash scripts/install-enrich-agent.sh --remove`; a bare `kill`
on the supervisor also works now and takes the node child with it, which it did not before —
bash defers a trap until the foreground command ends, so a TERM mid-work left both processes
running and looked ignored (measured: still alive 35 seconds later).

**That env file is deliberately not the one in the repository root, and using the root one
costs a run.** The main clone's `.env.local` is the July team file: the two public Supabase
values, `OPENAI_API_KEY`, `TMDB_API_KEY` — no service key and no
`MODEL_REQUESTS_PER_MINUTE`. A run started with it dies in two seconds on *"Missing:
SUPABASE_SERVICE_ROLE_KEY"*, which is the good outcome; the bad one is the near miss behind
it, because `OPENAI_API_KEY` alone makes `model-client` choose **OpenAI `gpt-5-nano`**
instead of the OpenRouter model every row so far was extracted with, and nothing would have
said the source had changed mid-catalogue. The file that carries the service key,
`OPENROUTER_API_KEY` and `MODEL_REQUESTS_PER_MINUTE=18` lives in the
`glorymap-modules-integration-2296ab` worktree at chmod 600 — so the rate ceiling comes from
the file and does not need exporting. Before trusting any service key, decode its own `ref`
claim and check it reads `quvxxqxowathrcyshhwj`: a key from the other project on this
account connects and writes just as happily.

**Write the log somewhere that survives a reboot**, not `/tmp`. And never pipe a long run
through `tail` — it buffers everything until the process ends, which is exactly when you
stop needing it. `~/enrich.log` is appended to, with a dated header per run.

Pace: **the model's daily allowance is the ceiling, not the clock.** The 1.4 works/min and
"~60 hours" measured on 20.09 held only until the free model's daily quota ran out, which it
first did the next morning — OpenRouter answers `429 Rate limit exceeded:
free-models-per-day-high-balance` until it resets. By 22.09 the log held **15,386** such
refusals against **983** extractions that got through. The run still converged — 5,216
unstamped works became 3,661, and Wikipedia rows in the queue went 1,172 → 3,716, because
most works need no model at all — but for most of every day it read Wikipedia only to throw
the reading away. Since 22.09 a spent daily quota ends the attempt (exit 75) and
`enrich-loop.sh` waits for 00:05 UTC, then hourly if the reset is late. **To go faster is
the owner's call:** a paid model removes the ceiling, and changes the model mid-catalogue.

Resuming is safe and needs no flags — the query selects `wikipedia_enriched_at is null`.
`--again` re-reads works already attempted, for when the extractor itself has changed.

**Fandom is finished as a source.** All 242 wikis in the Wikidata overlap were probed; four
yield rows — `lotr`, `jamesbond`, `gameofthrones`, `ghostbusters` — and they are the default
list. 150 of the 234 reachable wikis hold exactly one of our works. Do not go looking for
more; [[fandom-discovery]] has the numbers.

## What is built and NOT wired up

Three things, named precisely:

- ~~**`statement` has a reader and no writer**~~ — **it has one since 22.09.** All 4,688
  links were empty, so every card built its sentence from the relation kind — and every
  promoted row is a `filming_location`, so production read "Crime and Punishment was filmed
  at 14 ulitsa Kaznacheiskaia" where the plaque says the novel was written. `promote_place`
  now writes the source's own sentence onto a link that has none, decided by `quoteFrom`:
  **only a plaque's inscription or a Wikipedia sentence** (MovieMaps, movie-locations,
  ReelStreets and Fandom are fan prose we take facts from, not words), never shortened, never
  a wikitext list item, with the plaque ingest's doubled apostrophes restored to one. 57
  existing links were backfilled (`scripts/backfill-link-statements.mjs`); every Wikipedia row
  promoted from now on arrives quoted. `about` and `stated_year` still have no writer.
  **The plaques' kinds were fixed the same day** (migration
  `20260922030000_a_plaque_says_what_kind_of_place_it_is.sql`): each of the 52 read by hand,
  26 moved — 14 to `author_place`, 3 `artist_place`, 2 `narrative_location`, 4
  `inspiration_for`, 1 `replica`, 2 `studio_of`. Not `wrote_here` / `lived_here`: those are
  PERSON kinds ("${subject} wrote at…") for `creator_place_links`, and on a work they would
  read "Crime and Punishment wrote at". Tolkien's three plaques now sit under "Through the
  people who made it", distance 1, instead of posing as filming locations.
- **`creator_place_links` exists and `creators` holds zero rows.** So **no fact of distance
  1 or 2 exists anywhere**, and the film card's two lower blocks have never been seen with
  live data.
- ~~**`geocode_cache` is built, wired and empty**~~ — **it writes now.**
  `geocode-submissions.mjs --write` applies the coordinates and the cache directly instead
  of emitting SQL for the MCP, which was the only shape available while this machine was
  believed to hold the anon key alone. It refuses to run without a real service key rather
  than sending PATCHes that anon cannot apply: PostgREST answers a refused PATCH with 200
  and an empty body, so a `--write` over anon would have reported success over nothing.
  `--sql` is unchanged and still the right choice when somebody wants to read twelve
  thousand coordinates before they land. An anon INSERT policy is still deliberately NOT
  added: an open write there lets a stranger poison a coordinate.

That is worth keeping true. The project's most repeated failure is finished work that never
reaches the live path: posters, ratings, three audio features, the personal library, the map
filter, all three place modules, then the entire 30k-row ingest. **Before writing a module,
grep for its callers** (`grep -rn "from .*<module>" app/`); if the answer is zero, wire that
before writing more.

## Traps from this stretch, all found by measurement and none by reading

**Every gate I wrote was wrong the first time, and only live data said so.** This is the
single most useful thing on this page.

| rule as first written | what 200 real rows said |
|---|---|
| a place must follow a locative preposition | would have thrown away **111 of 246** correct rows |
| a city hint must match the immediate `P131` | **127** false refusals — the parent of Wildwood Regional Park is Ventura County, so "California" matches nothing |
| the authorship vocabulary | one word short **three times** — `production was based`, a curly apostrophe, `sketches` vs `sketched` |
| require the hint's most specific token | refuses Wildwood Regional Park and 126 like it |

Write the rule, run it against the queue, count what it would drop, *then* ship it.

**A pipeline can be dead and silent for weeks.** `enrich-from-wikipedia` wrote nothing
between 03.08 and 12.09: a migration dropped the default on `source_license`, the script
never set it, and every work failed with the error logged per work and the run continuing
past it, exit code zero. If a source has not grown, check its last `created_at` before
believing it is merely quiet.

**A `maxlag` refusal can be about a service this project never reads.** The restart on
20.09 was turned away on its FIRST request — the entity batch that runs before any work is
read — by *"Waiting for wdqs1013: 527.5 seconds lagged"*. The error body says which service:
`"type":"wikibase-queryservice"`, `queryserviceLag` **31,650 seconds**, nearly nine hours.
That is the SPARQL endpoint, and Wikidata folds its lag into `maxlag` so that EDITS back off
and let it catch up. This job makes no edits, and `wbgetentities` reads the entity out of the
MediaWiki database — the identical request with `maxlag` removed answered immediately and in
full, which is the measurement that settled it. Five retries are 30+60+90+120+150s, so
honouring it would have ended the run having done nothing, every two minutes, until the next
day. `isQueryServiceLag` now asks the body which lag it is: the query service's is asked
again once without `maxlag`, replication lag still waits. **Check `error.type` before
obeying a lag.**

**The same incident has a second face, and there it is real.** `/api/cities/suggest` is
SPARQL against that very query service, so while the ingest was being refused over a lag it
does not care about, the city half of the search box was genuinely degraded: the deploy's
own smoke step printed `{"query":"lond","suggestions":[],"unavailable":true}` after **6.3
seconds** (20.09, 23:14 UTC). Re-measured a minute later it answered London `Q84` with its
coordinates, `x-vercel-cache: MISS`. So `unavailable: true` in a smoke log is the graceful
fallback doing its job under a slow WDQS, not a broken endpoint — probe
`query.wikidata.org` before chasing it through the route. It is also the one place where a
Wikidata query-service incident costs the demo something, because films are answered from
our own tables and cities are not.

**"Could not be read" is not "read and found empty."** Of 802 works attempted on 16.09,
**575 had every edition fail with `fetch failed`** in unbroken stretches of 185, 123 and 95
— the laptop asleep. Only 3 were wrongly stamped, and only because the outage took the
database down too so the stamp also failed. Fixed in #261: an unreadable edition leaves the
work unstamped, and six network failures in a row make the run wait for the network.

**The model beat the regex.** Of the four new rows one Fandom run produced, both good ones
came from the model and both bad ones from my own parser. I had described the model as the
risky half and the parser as the safe one; the data said the opposite.

## Traps from earlier stretches, all found by measurement

**Four services report failure inside a success.** Check the body before parsing:
OpenRouter `/v1/responses` returns 200 and silently ignores the JSON schema (use
`chat/completions` with `response_format`); Wikimedia answers a missing page and a lagged
replica with 200 and an error body; Overpass answers "the server is probably too busy"
with 200 and an HTML page; CirrusSearch `insource:/A/ OR insource:/B/` returns **zero
results rather than an error** — the alternation must live inside one regex.

**A merge into `main` does NOT reliably deploy production.** Of four merges in forty
minutes, two produced a Production deployment and two did not. Worse, the obvious check
lies: `gh api repos/…/commits/<sha>/status` goes green on the **Preview** deployment. Ask
for the environment by name, and force it when it has not fired:

```bash
gh api "repos/walklikeaman/glory-map/deployments?environment=Production&per_page=5" --jq "[.[] | select(.sha==\"$(git rev-parse origin/main)\")] | length"
```

```bash
gh workflow run "Deploy production" -f ref=main -f confirm_production=true
```

**Some sessions have no `gh` at all** — a cloud container may ship the GitHub MCP instead.
The same two actions there: `actions_run_trigger` with method `run_workflow`, workflow
`deploy-production.yml`, ref `main`, inputs `{ref: main, confirm_production: "true"}`, then
`actions_list` → `list_workflow_jobs` and `get_job_logs` to read the result. Merging through
the MCP does not deploy either; **always fire the workflow yourself and read its log.**

**The deploy now says what production answers, not just that it deployed.** The last step
of `deploy-production.yml` curls the production domain by name and prints the body of
`/api/search`, `/api/cities/suggest` and `/api/directory/films`, and the status of
`/directory` and `/directory/films/s`. It has already paid for itself twice: it is how the
Olympics-above-Derry bug was found (#165), and on a session whose container cannot reach
Wikidata or Supabase **it is the only measuring instrument there is** — see the next trap.

**A measurement of the queue is a snapshot, not a fact.** Another branch works the same
production table: between two measurements forty minutes apart the resolved-row count went
0 → 34, the table lost 210 rows, and the movie-locations name statistics changed so much
that a whole planned task evaporated. **Quote the time next to any queue number, and
re-measure before acting on one.**

**The database has rules the repo does not describe.** Twice a constraint existed only in
production because another session applied it through the MCP without committing — and a
new `CHECK` was then rejected by 8,063 live rows. Read the live definition first: a
constraint is written against the database that exists, not the one in git. Measured on
08.08: **13 migrations existed in production and in no file**; all 13 are now committed.
Check it stays true — `select name from supabase_migrations.schema_migrations` against
`ls supabase/migrations/`.

**A schema change that is correct in SQL can still break the client.** `on_conflict` in
PostgREST is a promise about an index SHAPE, and nothing in the database says who relies on
it. Splitting a unique constraint into two PARTIAL indexes on 31.07 killed the only write
path into the graph for eight days — `ERROR 42P10`, raised *after* the Wikidata work had
succeeded, so the route looked busy. See [[fact-architecture]]. When you change a unique
index, grep for `onConflict`.

**`[hidden]` loses to any class that sets `display`.** The browser's own
`[hidden] { display: none }` is a bare attribute selector, so one `display: grid` on a class
renders a hidden tab panel anyway. Found as "both tabs are showing at once", which reads as
a React state bug and is not one.

**Never run `next build` while the dev server is up** — it clobbers `.next`. Check
`lsof -ti:3000`.

**`pkill -f "next start"` kills the shell that runs it** — the pattern matches that shell's
own command line — and then reports success. The next `next start` fails to bind, the old
process keeps serving, and you spend ten minutes reading screenshots of the PREVIOUS build
and blaming your CSS. Find the process and kill that:
`ps -eo pid,cmd | grep next-server`. A served page that contradicts the file on disk is
almost always a stale server rather than a stale stylesheet.

**A character range in SQL is resolved against the collation, and this database is not in
the C locale.** `~ '^[a-z]'` and `between 'a' and 'b'` both put `Á` inside the `a` bucket
under `en_US.UTF-8`. Use `strpos` over an explicit alphabet when the answer has to match
what JavaScript would say.

**Both halves of a sentence must be measured over the same rows.** The directory index first
read "6,392 films with 20,296 places" — a global work count beside a count of only what sat
near a listed city. Each number was right; the sentence was not.

**What the machine can reach is a property of the SESSION, not of the project, and both
previous notes here were right about their own container.** Measured from the cloud
container on 18.08, every one of these returned `000` — the egress proxy answered 403 to
CONNECT:

| host | from the cloud container |
|---|---|
| `<ref>.supabase.co` | blocked |
| `www.wikidata.org`, `query.wikidata.org` | blocked |
| `nominatim.openstreetmap.org` | blocked |
| `codex-hackathon-starter.vercel.app` | blocked |

The MCP servers (Supabase, GitHub, Vercel) still work there, because they are not egress
from this container. From the main clone on 19.08 the Supabase REST host answers and the
directory was verified live. **So test the specific host from your own container before
believing either note** — `curl -sS -m 8 -o /dev/null -w "%{http_code}" <url>` — and if it
is blocked, verify through the production smoke step and through MCP rather than concluding
the code is broken. Never disable TLS verification or unset `HTTPS_PROXY` to get around it.

**`Number("")` is 0 and 0 is finite.** Four Null Island incidents. `finiteOrNull` exists
for it — and it is not enough on its own: the Open Plaques dump ships a Leeds cinema with
`latitude 0.0` and a correct longitude, which only an explicit zero check catches.

**A name is never an identifier.** `Bowie` returns a hundred Texas markers about Jim
Bowie; `namesMatch` accepted one extra word and turned "Notting Hill Bookshop" into the
district; a union of Overpass `around` statements returns ONE result set, so an element
fetched for another point is still in the list — the name has to be inside the query and
checked again on the way out. **And a third time, on 19.08**: grouping the located rows by
the city written in their address gives "London" a spread of 10,959 km and "Richmond" 8,097
km, so a city page is a coordinate and a radius and the name is decoration ([[directory]]).

**Do not guess Q-ids.** Query by title and year.

**`wbsearchentities` returns the wrong entity far more often than it looks.** "Skyfall"
gave Adele's lyric video and "Parasite" an academic journal. The fix that works, and is
now used in three places: take 15 candidates, rank by `wikibase:sitelinks`, and only then
check the type.

**And sometimes the right entity is not in the fifteen at all** (21.09). "Psycho" is a prefix
of Psychology, Psychotria, psychosis and a family of flies; Hitchcock's film was twentieth,
so ranking had nothing to rank and the live search answered `matched_work: null`. Wikidata's
own search takes a type filter — `"Psycho" haswbstatement:P31=Q11424|…` returns the film
first, from wikidata.org rather than the query service. It is the LAST resort in
`/api/locations`, after our own records, and takes only a work whose label is the title:
its first answer for "Heat" was *In the Heat of the Night*, and our records already answer
Heat with six places. It cannot replace the label search, because it sees the root types
exactly and Spirited Away is an "animated feature film".

**Another session takes the same next step, not only the same database.** On 18–19.08 two
sessions built #158 simultaneously from this page's own numbered list; one directory was
finished and discarded. Nothing here marks an item as taken, so **before starting one, run
`git fetch origin && git log --oneline HEAD..origin/main` and look at the open PRs.** One
second against a day.

## Rules of the house

- **English everywhere — the repository AND GitHub** (owner's rule). Cyrillic survives
  only as DATA: the Russian Wikipedia section names `wikipedia-source.mjs` queries, and
  "Красная площадь" as the example proving the name normaliser keeps non-Latin alphabets.
  Merge-commit subjects on `main` from before the rule are still Russian; rewriting them
  means rewriting history, which is the owner's call.
- **No Claude attribution anywhere**; `includeCoAuthoredBy: false` overrides the `/ship`
  template's trailer.
- **The owner grants the full cycle**: open the PR, wait for checks, merge, verify
  production. Do not ask permission per step. Deleting data, rotating keys and anything
  irreversible still gets asked.
- **Collect any source and mark it unverified** rather than discarding the lead. Every
  card names who said it. `REFUSED_SOURCES` in `submission-places.mjs` is deliberately
  **empty** — that is a decision, not an oversight.
- Tests are `node --test test/*.test.mjs`, zero-network, dependency-injected.
- Answers to the operator are written as ready-to-paste prompts for their team.

## Refused sources — settled, do not re-research

- **IMDb** — scraping prohibited AND it does not own most photos.
- **Fandom** — per-wiki licence roulette; the "Filming locations" categories are EMPTY on
  the Bond, LOTR and Potter wikis; claims are anonymous.
- **Film-Grab / Movie-Screencaps / ShotDeck** — real frames, no rights to grant.
- **Doctor Who Locations Guide, Reelstreets** — their terms forbid the ACT, which does not
  depend on whether anything is sold. The 8,063 reelstreets rows already in the queue are
  shown as unverified candidates under the owner's ruling.
- **MovieMaps** — the site has **no terms page at all** (`/terms`, `/legal`, `/copyright`
  are 404). Owner's ruling: its rows may be shown as unverified candidates with a link
  back to the source.

**Licence type vs terms of use.** The project is a student demo and is not sold, so
non-commercial LICENCES (CC BY-NC, restricted model weights) are not blockers. Terms of
use are different: they forbid the act, not the profit.

## Keys and secrets

**There are two `.env.local` files and only one of them can run a script.** The main
clone's holds the two public Supabase values, `OPENAI_*` and `TMDB_API_KEY`, and **does NOT
hold `SUPABASE_SERVICE_ROLE_KEY`** — writes from that clone went through the Supabase MCP
(`execute_sql`, which runs as `postgres`). The one the ingest scripts actually use is
`.claude/worktrees/glorymap-modules-integration-2296ab/.env.local`: service key,
`OPENROUTER_API_KEY`, `MODEL_REQUESTS_PER_MINUTE=18`. See the restart section above for why
pointing `--env-file` at the wrong one is worse than an error.

**And that file sits in a scratch directory.** `.claude/worktrees/…` belongs to an agent
session; some later session may delete it, and with it the only service key on this machine.
Survivable for a run somebody starts by hand and reads the error from — not for one that is
supposed to come back by itself after a reboot. So `install-enrich-agent.sh` copies it once
to **`~/.glorymap.env`** (chmod 600) and names that copy in the plist. The two will drift if
the keys are ever changed in one and not the other; the agent reads only `~/.glorymap.env`.

- **`SUPABASE_SERVICE_ROLE_KEY` was printed to a terminal and appeared in a screenshot
  shared into a chat. Rotation was recommended and never confirmed.**
- `SCENE_MATCH_SIGNING_SECRET` is set in `.env.local` and in Vercel production+preview.
- The Vercel CLI on this machine is logged into `nikita-8024` / team `kitpos`, NOT the
  account that owns this project (`walklikeaman1904`) — `vercel ls --scope
  walklikeaman1904` answers "scope does not exist", which reads as a missing project and
  is really a missing login. Use `gh` and the GitHub integration instead.

## One thing we cannot fix, and it is not for lack of trying

`rls_disabled_in_public` on `public.spatial_ref_sys` stays an ERROR in the Supabase
advisor. The table belongs to PostGIS and is owned by `supabase_admin`. Enabling RLS,
revoking its grants and `set role supabase_admin` were all attempted against the live
database and all changed nothing — `postgres` is not a superuser here and `dashboard_user`
cannot become one either, so the owner's own hands in the SQL editor hit the same wall.
**Practical consequence: `anon` can DELETE from the SRID registry through PostgREST.**
Only Supabase support can close it. Everything else the advisor reported — function
`search_path`, `security_invoker` on views, the policies — is fixed and committed as
`20260805013939_security_advisor_findings.sql`.

## Plaques: what was done and where the ceiling is

Two shipped pieces, both live: [app/lib/plaque-source.mjs](app/lib/plaque-source.mjs)
matches a plaque to a work we already hold, and
[app/lib/plaque-title-resolve.mjs](app/lib/plaque-title-resolve.mjs) turns a title written
on a wall into a NEW work carrying a real Wikidata id. Result: 53 plaques across 40 works,
and works with a `wikidata_id` went 15 → 28.

Three numbers to correct, because an earlier note in this project overstated them:

- **"811 unknown titles" was an artefact of a crude Title Case sweep** over inscriptions.
  Read properly, the extractor yields **49 candidate titles**, of which **13 resolve**
  safely. Do not plan volume against 811.
- Every rejection rule in `plaque-title-resolve.mjs` exists because the version without it
  was wrong in a way that looked right: "The Lady Vanishes" resolved to the 1976 remake
  though the plaque is about Gainsborough Studios 1924–1949; "Taj Mahal" to a 1963 film
  though the plaque names a hangar in San Antonio.
- **Stolpersteine and victim memorials are excluded first**, by series, organisation and
  the markers `deportiert` / `ermordet` / `Jg.`, with a test. 6,269 of the world dump are
  such plaques and 1,413 of them contain "lived here". Pulling those into a celebrity
  walking tour would be grotesque.

The remaining volume in plaques is the **person path** — 2,952 plaques about 1,479
creative people with Wikipedia links. As of 08.08 the schema is no longer in the way:
`creator_place_links` exists, a person's fact reaches a work through `work_creators`, and
`lived_here` / `wrote_here` / `died_here` / `buried_here` / `commemorated_here` are real
relation kinds instead of one vague `author_place`. What remains is **data**: `creators`
and `work_creators` hold zero rows, and filling them is a source problem, not a rules one.

## Next, 20.09, in the order I would take it

1. ~~**Restart the enrichment**~~ — **done, 20.09 23:03 UTC, and it is running now.** 5,216
   works, ~60 hours, nothing to decide. It is the largest untapped thing in the project by a
   wide margin: 264 works have produced 463 placed rows, so the rest is worth roughly nine
   thousand more. What is left is to check on it — `tail -5 ~/enrich.log`, and
   `ps -eo pid,etime,command | grep -E 'enrich-loop|enrich-from-wikipedia'` — and to start it
   the same way after the next reboot.
2. **Or narrow it first.** 1,642 works have a Los Angeles row and LA is the demo city;
   running those alone is ~20 hours and every row lands where the jury looks. There is no
   `--city` flag yet — it would be a join on the queue.
3. **Review the queue.** 1,163 Wikipedia rows and 236 Fandom rows sit `pending` and nothing
   on the map treats them as more than candidates. This is human work, not a script.
4. **`head_unknown` is Fandom's ceiling** — 193 of 237 rows. Fandom names places like
   "Gary Rowe's house" and "CMGN Hamburg Printing Factory", which no gazetteer holds. Do not
   spend on it; the value of that source is the story-to-shoot pairing in its tables.
   **It is Wikipedia's ceiling too, and that was not expected.** A 40-row batch put through
   the geocoder on 21.09 came out **36 `head_unknown`, 2 accepted — 5.0%**, against the 8.3%
   the script's own header measured on movie-locations. Forty rows is a sample and not a
   verdict, but it says plainly that prose from an encyclopedia names buildings no gazetteer
   holds just as readily as a fan wiki does. Where the pointless rows actually are, by
   source (21.09, 01:40): `reelstreets` **7,650** · `movielocations` **3,163** ·
   `wikipedia` **934** · `fandom` **226** · `moviemaps` **30**.
5. ~~`Clifton Village, Bristol` resolves to Clifton in Nottingham~~ — **fixed 21.09, by
   distance rather than by name.** Requiring the hint's town in the chain refused 127
   correct rows, because a chain can be SILENT about a town (Wildwood → Ventura County) as
   well as name a different one, and names cannot tell those apart. Distance can: a model
   writes the nearest big name it knows, so a right pin sits near it (Pinewood 29 km from
   "London"). Now, only where the chain is silent, the geocoder looks up the hint's town —
   point-like, agreeing with the rest of the hint — and refuses a winner more than 150 km
   from all of them. Replayed on all 925 placed Wikipedia rows: **5 refusals** — Clifton,
   Milton Academy placed in Wisconsin, Saint Francisville placed in Illinois (3 real errors),
   Gare de Saulieu whose own source disagrees with itself by 257 km, and Alamo Village, a
   right pin under a wrong hint (the price). It applies to NEW geocoding; the three wrong
   rows already in the queue are still there, with Q-ids that only echo the geocoder. And `manoir Playboy` finds
   nothing because Wikidata has no French label for it.

## Next, as of 19.08 — superseded by the list above, kept for the reasoning


**The critical path is closed.** The product had two surfaces and everything else was
reachable only by dragging a map; it now has three, they link to each other, and the search
box leads to all of them. #145, #158 and #160 all shipped on 18–19.08 and are verified on
production. What that changed, in one line each:

- **#145 — one search box** ([[search-box]]). Films and cities in one field, grouped, never
  awaited together. The city half is Wikidata rather than Nominatim — a type-ahead IS an
  auto-complete and that policy refuses it; `/api/cities` survives behind one clicked row.
- **#158 — the directory** ([[directory]]). An index, 27 letter pages covering every work,
  56 city pages, a sitemap. **A city is a point and a radius, never a name.** It also forced
  the fix that made it worth having: the card shows the review queue as labelled candidates,
  because only 14 of 6,392 rows led to a card with anything on it.
- **#160 — the place card as tabs** ([[place-card]]). Details / Route, a copyable
  coordinate, a panel that counts places and films apart.

**One half-issue is left behind by that work and is the cheapest thing on this list:**
**step 4 of #129 — the place card read from `place_facts`** — is not done. Everything else
in #129 is.

Then, in rough order of value:

1. **#157 — comments and visitor photos.** The moderation spine already exists; what needs
   deciding is who may write, EXIF stripping, licence, and that `rejected` hides a row but
   does not delete a file.
2. **#161 — the walk survives bad signal.** Becomes critical the day somebody first walks a
   route; nobody does yet.
3. **#159 — the dated satellite lens.** The most distinctive idea from either reference and
   the most on-brand: the place as it was when the camera was there. Esri Wayback is free,
   196 releases, **oldest 2014-02-20** — so it cannot answer for Vertigo, and the card must
   say so rather than showing 2014 under a 1958 film.

**Before starting any of them**, see the trap above about two sessions taking the same next
step: `git fetch origin && git log --oneline HEAD..origin/main`, and look at the open PRs.
Nothing on this page marks an item as taken.

**The data, not the pages, is now the ceiling.** Three of the four things worth doing next
are blocked on rows rather than on rendering, and they are the same three named under "built
and NOT wired up": `creators` is empty so no fact of distance 1 or 2 exists anywhere;
`statement` has no writer; `geocode_cache` is empty for want of a service-role key. A fourth
belongs beside them now — **`places.city` is null in all 2,908 rows** (21.09, 01:33 UTC; it was all 70 of them on 18.08), so
anything that wants to group by administrative area reverse-geocodes the queue's 32,148
located rows first (18.08, 20:23 UTC). The directory works
around that with a gazetteer of discs; a city FILTER on the map would not.

**Not to be built**, decided after studying both references: points/leaderboards (they
reward volume, and 914 rejections this week were good work), selling user maps, ads styled
as results, live-GPS buddy tracking, AI-generated "lore", and a 1–5 safety score.

## Open decisions for the owner

- **What the trip agent IS** — an agent session speaking MCP, a third-party product with an
  API, a custom GPT, or something still being built. `POST /api/trip/plan` is the answer all
  four need and is shipped ([[trip-agent-bridge]]); the transport that wraps it is not, and
  cannot be chosen without this. It is one question and it unblocks the whole feature.
- **`isRoutable`**: an unconfirmed stop is currently routed with a warning rather than
  refused. Whether it should harden into a refusal is a product call, not a technical one.
- ~~**472 Wikipedia rows carry a Q-id that only echoes our own geocoder**~~ — **decided and
  done 21.09: the review no longer counts it** (`echoesItsOwnGeocode` in
  `submission-review.mjs`; both scripts now read `geocode_source` and `geocode_source_id`,
  without which the rule cannot see an echo and silently counts it). Across the queue there
  were 530 such rows, not 472 — 57 are MovieMaps rows our geocoder placed earlier and the
  resolver later visited. Measured: **473 pending rows that the next `--write` would have
  verified now stay pending**, Clifton Village among them; 12 already verified keep it on a
  real second signal.
- **41 places on the map stand only on that echo.** They were verified and promoted before
  the rule existed, and `review-submissions --write` writes only `verified` and `rejected`,
  so it will not take them back. Read by eye they are almost all right — Battersea Power
  Station for Children of Men, Eastern State Penitentiary for Twelve Monkeys, the Millennium
  Biltmore for Ghostbusters — and under-evidenced by this project's own two-signal standard.
  Demoting them removes true pins from the map for a procedural reason; leaving them keeps
  41 facts the rules would not grant today. The owner's call; nothing has been changed.
- **5 plaque links point at the wrong WORK** (22.09) — only deleting them fixes them. A
  plaque about *The Italian Job* on "The Italian" (2010); Basil Rathbone on a 1964 "Sherlock
  Holmes"; Diana Rigg's 1965 series on the 1998 film *The Avengers*; Porter's 1903 *The Great
  Train Robbery* on the 1978 one; a 1921 Fairbanks screening on the 1993 *Three Musketeers*.
  Each shows on the wrong card as a filming location. The cause is upstream: the plaque
  matcher takes a title without its year. Link ids are in the migration's header.
- **Rotating `SUPABASE_SERVICE_ROLE_KEY`** (see above) — recommended, never confirmed.
- **Russian merge-commit subjects on `main`** — fixing them rewrites history.

## Known-wrong, unfixed

- **Coverage is thin by nature.** 78.7% of works in the queue have fewer than five places;
  39.8% have exactly one. Live sources add places to about two thirds of them.
- ~~The inverted search returns some **non-places with coordinates**~~ — **fixed 21.09.**
  "Eurovision Young Musicians 2018" was still a pin for Harry Potter in Edinburgh, 1.4 km
  from the centre, carrying the coordinate of the hall the contest was held in. The page's
  short description decides now, by its HEAD noun — "EDITION of the … contest", "animation
  COMPANY" — rather than any word in it, because "theatre, home of the Royal Shakespeare
  Company" is a building. **Measured first on 317 live candidates across 40 work-and-city
  pairs: it refuses exactly two**, Eurovision and Framestore (a VFX company pinned on its
  office), and nothing else. The problem was rarer than this line made it sound: almost
  every "unknown precision" candidate is a real place whose description is an address.
- ~~**A city row lists the same venue twice**~~ — **fixed 21.09, in the sentence rather than
  the query.** Measured on every live city page first: **113 of 2,701 lines showed one venue
  twice**; replayed through the fix, **1** does. And the note that stood here was wrong about
  the cure: it said `place-dedup.mjs` "already knows how to collapse these". It does not, for
  its own example — `namesMatch` allows one extra word and an address is three or four.
  `samePlaceWritten` (place-name-head) is the rule that fits, and all 223 pairs it would
  merge on production were read by eye: every one is the same building. `cityWorkLine` now
  shows each venue once, by its shortest spelling, and subtracts every spelling from "and N
  more" so the hidden duplicate cannot come back as a count. The one line left is Dublin's
  Winetavern Street in five spellings, kept in three because "Dublin" and "Dublin 8" read as
  different areas — the safe direction to be wrong in. The route still returns every
  spelling; only the sentence decides.
- ~~A **one-word title** contributes nothing to the inverted search~~ — **fixed 21.09, by
  searching it as a title rather than as a word.** Letting the bare word in was measured
  first and is wrong: "Up" matched ten unrelated articles in San Francisco, "Psycho" matched
  "Psychology", "Casablanca" every article about the city, "Amélie" the finance ministry.
  Wikipedia sets titles of films and books in italics and nothing else, so a one-word title
  is now asked for only as `''Title''`, bare or round a link. On 20 one-word titles in their
  own cities: Up 10 → 0, Jaws 0 → Martha's Vineyard, Edgartown and Menemsha, Dracula gains
  Whitby Abbey, St Mary's and the 199 steps, Frankenstein gains Villa Diodati, Chinatown
  trades the neighbourhood for Echo Park and Mulholland Dam, Amélie finds the Café des 2
  Moulins. It costs 0.15–0.7 s more per search, and Trainspotting loses Arthur's Seat, whose
  article names the film without italics.
- **Sherlock returns 5 places against Harry Potter's 26** — not a matching bug, a coverage
  one: the queue holds four rows for it.
- `api_help.html` and `lt.html` are research scratch in the main clone's root, untracked.
- Two other worktrees exist under `.claude/worktrees/`:
  `skype-ai-openrouter-movie-maps-bffab0` has **unmerged commits and uncommitted work**
  (leave it alone), and `youthful-lalande-fa0756` holds `claude/hackathon-prep-27a66c`.
