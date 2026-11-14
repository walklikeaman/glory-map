---
type: handoff
created: 2026-09-02
updated: 2026-09-11
sources: [sessions, log]
---
# Working locally, and what step 4 of #129 cost there

Written mid-task as a handoff, kept after it was finished because the reason it existed is
durable: **this repository has work that cannot be verified from a cloud container**, and
this is the page that says which work and why.

Step 4 of #129 is done — see [[place-card]] for what the page is, and [[log]] for what it
found. Related: [[fact-architecture]], [[handoff]].

## What was finished here

| | |
|---|---|
| `place_facts_at(uuid)` | applied 02.09, `20260902075615_place_card_facts` |
| the reader | `/api/place`, `/place/[slug]`, `app/lib/place-url.mjs` — `grep -rn "place_facts" app/` now answers |
| both ends wired | a work card's fact rows link to the place page; a place page's subjects link back |
| a defect the page found | `place_facts_at` and `work_facts` both had a tie in their `ORDER BY`; fixed and applied as `20260902081645_facts_in_a_stable_order` |

**1,133 tests, all passing.** The two `cancelled` results in `artwork-api.test.mjs` that this
page reported on 02.09 did not reproduce; they are timing-sensitive, not broken.

## Why it had to be local, and this part has not changed

The cloud container can reach **none** of the project's own services. Every one of these
answered `000` there — the egress proxy refuses CONNECT — and every one is fine from a
laptop:

| host | cloud container | a laptop |
|---|---|---|
| `<ref>.supabase.co` | blocked | fine |
| `www.wikidata.org`, `query.wikidata.org` | blocked | fine |
| `nominatim.openstreetmap.org` | blocked | fine |
| `codex-hackathon-starter.vercel.app` | blocked | fine |

The Supabase, GitHub and Vercel MCP servers still work there, which is how the first
migration was applied and verified. But **a page cannot be opened against real data**, so the
only way to see a live answer is to deploy and read the production smoke step: one round trip
per look. Locally the same page renders in a second — which is how the `ORDER BY` tie was
found at all. It is invisible in a query result read once and obvious in a page reloaded
twice.

Two more costs that do not exist locally: the container restarted mid-session (background
jobs die with it), and the MCP servers disconnected and reconnected several times.

**The rule this gives**: a step whose acceptance is *"the reader sees X"* is a local step.
A step whose acceptance is *"the database returns X"* can be done from anywhere.

## The browser pane can report a map of size zero

Twice now the map has looked empty in the browser pane while being perfectly correct: the
candidate layer draws nothing, the films panel is null, and only the searched-work pins
survive. The cause is not the app. `window.innerWidth` and `innerHeight` both read **0** in
a pane that is not painting, so `.leaflet-container` is 0x0 and the viewport query is
degenerate — which the layer refuses, as it should.

The fix is one call before reading anything:

```
resize_window { width: 1280, height: 900, tabId: ... }
```

With a real viewport the same page drew **1,008** pins. Reset with `preset: "desktop"` when
finished. So: an empty map in the pane is a claim about the pane until `innerWidth` has been
read and found non-zero.

## Running it locally

```bash
git pull
./scaffold.sh                  # npm install + .env.local from .env.example
npm run dev                    # http://localhost:3000
node --test test/*.test.mjs    # 1,133 tests, zero network
```

`.env.local` ships with the public Supabase URL and anon key, which is all a place or film
card needs — both read through PostgREST as `anon`, and `place_facts_at` is
`security_invoker` over views that are already public-read. Generate
`SCENE_MATCH_SIGNING_SECRET` if you touch the scene-match path
(`openssl rand -base64 48`).

Four pages worth opening, and what each proves:

| place | what it proves |
|---|---|
| `/place/trafalgar-square--1dace4f1-8d85-44af-a390-5fd851cc6564` | three films at one point, three facts, not merged — #129's acceptance case |
| `/place/london--40d442dd-257e-424b-8043-50677eb30ca6` | 11 facts from 8 subjects, and Skyfall's four in a stable order |
| `/place/old-royal-naval-college--e927ac0c-33a2-443d-921a-8d763ece4a63` | a film and a series at one building |
| `/place/pinewood-studios--7fe13f73-86a1-4527-b9b5-5c75f37c3d25` | a studio: a real pin for something set elsewhere, and the page says so |

## Traps, all of them already paid for

- **`pkill -f "next start"` kills the shell that runs it** and reports success. The old
  server keeps serving, the new one fails to bind, and you read screenshots of the previous
  build. `ps -eo pid,cmd | grep next-server`, kill that pid.
- **A served page that contradicts the file on disk is a stale server**, not a stale
  stylesheet. Ten minutes went into that once already.
- **Never `next build` while `next dev` is up** — they share `.next`.
- **Another session works the same production database.** Quote the time beside any queue
  number, and re-measure before acting on one.
- **Check the files still match production**: `select name from
  supabase_migrations.schema_migrations` against `ls supabase/migrations/`. As of this page
  they match, including `20260902081645`.
- **Before starting, `git fetch origin && git log --oneline HEAD..origin/main`** and look at
  the open PRs. Two sessions built #158 simultaneously on 18–19.08 and one finished
  directory was thrown away.
