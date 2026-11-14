# Project map (read at the start of every session)

Codex loads this file from the repository root on its own (nested `AGENTS.md`
files merge upward through the tree). It explains to the agent how the project is
built, so time goes into development instead of repeated explanations. Full
description of the method —
[`docs/agent-framework.md`](docs/agent-framework.md).
As soon as the idea is locked in, fill out the **Project** block right away.

Where the rules live: the full text of every project rule, with dates and reasons, is
[`docs/RULES.md`](docs/RULES.md) (it wins if this file disagrees); the short method is
[`docs/agent-method.md`](docs/agent-method.md); Claude Code reads [`CLAUDE.md`](CLAUDE.md),
which imports this file.

---

## Project (fill in at the start — 2 minutes)

- **What we're building:** GloryMap — a map of places from your favorite films: pick films → pins for filming locations → a "frame back then / place now" card → a walking "cinema-stroll" route.
- **Category:** apps-for-life
- **Stack:** Next.js + Supabase + Vercel, Leaflet/OSM, Wikidata (locations), TMDB (posters/frames), OpenAI (scene descriptions).
- **The single demo path that must work:** pick 3–5 films from the gallery → a map of London with pins → open a location card with its scene and a "now" photo → add 3 points → build a walking route.
- **Out of scope for now:** auth, audio clips, live Letterboxd/Amazon APIs, scraping, books (second wave), Tel Aviv as the demo city.

The Supabase schema was created by the owner on 07/21 (migration `scenemap_initial_schema`):
tables `locations` and `scenes`, the contract is section 5 of the brief
`Context/brief-scenemap-design.md`. RLS is permissive: the anon key from `.env.local`
reads and writes both tables — nobody needs service_role. Uniqueness in
`locations` is the pair (work_wikidata_id, loc_wikidata_id), the seed is a batch-upsert on it.

The last two lines matter most. One scenario that works from start to
finish beats five half-working ones. Keep scope tight: new ideas go into the
"out of scope" list until the demo path turns green.

## Rules of behavior (apply to any non-trivial task)

Codex has no global skill autoloader, so the rules live right here:

1. **Think first, code second** — state your assumptions; if the request reads two ways —
   ask; pick the simpler path; if it's unclear — stop and name exactly what.
2. **Simplicity above all** — the minimum code for the task. No just-in-case abstractions
   and no handling of cases that can't happen.
3. **Surgical edits** — touch only what the current step needs; stick to the
   existing style; delete only what your edit made unnecessary.
4. **Goal-driven** — set a verifiable success criterion up front and spin the loop until it
   honestly passes (usually: "the demo path works when I actually run it").

## Autopilot is the default

Drive a well-described step to verified-green yourself: plan → build → run →
**verification by actually opening the result** (curl the endpoint, load the page,
read the console, re-read the file) → cleanup → log → report. Don't wait for a go-ahead between steps.

STOP and ask ahead of time ONLY in BLOCKING cases:

- outward-facing or hard-to-reverse actions (deploy to a _production_ domain, any send,
  public posts, spending money);
- destructive operations (dropping a table with real data, force-push, deleting files);
- anything touching credentials or another account's data.

Preview deploys, throwaway branches, local runs, test data — just do them.
If a fork in the approach is serious, lay out the options and pick one with a rationale, not at random.

## Session-start ritual (read before doing anything)

1. This file — especially the **Project** block and scope.
2. `git log --oneline -10 && git status --short` — what the previous session left behind.
3. `cat .loops/guardrails.md` — the hard constraints accumulated up to this point.
4. `grep "^## \[" wiki/log.md | head -20` — fresh decisions and knowledge.
5. `wiki/index.md`, if the task touches something already studied — **reference it, don't re-derive**.
6. If code already exists, ask CodeGraph about the structure instead of grepping blindly
   (`codegraph_context` / `codegraph_explore`). The index is built once via
   `codegraph init`; after switching branches, rebuild via `codegraph index --force`.
7. `TASKS.md` — who owns what and what's next; work off this board and update it
   after `/ship`. The teamwork rules are in `TEAMWORK.md`.

## Tools already wired up for you (see README)

- **CodeGraph** — a local knowledge graph of the code via MCP. "What calls X", "where's Y",
  "what breaks if I change Z" — answers from a ready-made index, saving tokens.
- **Supabase** (MCP) — create tables, run SQL, deploy edge functions, read logs.
- **Vercel** — `vercel` for preview deploys; Vercel MCP for logs and errors.
- **Playwright** (MCP, optional) — drives a real browser to check the demo path.

One shared infrastructure for the whole team: one Supabase database and one Vercel project.
Most people work with the shared DB via `app/.env.local`; the Supabase/Vercel MCP for
management is connected only for whoever runs `./setup.sh --infra`. Don't commit
tokens — `.env` is in gitignore, the expected keys are listed in `.env.example`.

## Knowledge that accumulates — the `wiki/` layer

This is exactly what makes the project _mature_ instead of goldfish-forgetful: every session reads
what the previous one wrote, and knowledge builds up instead of evaporating.

- `Context/` — the raw, **immutable** inbox. Drop briefs, exports, screenshots, notes here.
- `wiki/` — where the agent itself writes and cross-links (`[[links]]`): `index.md` (read first),
  `log.md` (append-only, newest on top), `overview.md` and `sources/ entities/ concepts/`.
- **Ingest**: on the command "ingest `Context/`" read each source → create a page
  in `wiki/sources/` → update entities/concepts → cross-link → add an entry to the top of `wiki/log.md`.
- **Auto-log**: after any significant operation, add an entry to the top of `wiki/log.md`. If
  in doubt — default to YES. Never hide a decision in a code comment — its place is the wiki.

For a quick build you can leave the wiki alone, but the moment a decision or a gotcha
is worth surviving to the next session or a colleague — write it down here.

## Loops (run at the right moment — `~/.codex/prompts/loop-*.md`)

- `/loop-demo` — drive the single demo path to green, from start to finish.
- `/loop-lint` — before committing, chase lint/typecheck/build to clean.
- `/loop-debug` — a failing bug; writes attempts to `.loops/reflexion.md` so they aren't repeated.
- `/loop-spec-ship` — drive a small spec to verified-green and ship it.
- `/loop-guardrails` — lock a recurring mistake into `.loops/guardrails.md`.
- `/loop-docs-sync`, `/loop-de-sloppify`, `/loop-migrate`, `/loop-pr-review` — as needed.

Hackathon commands (also in `~/.codex/prompts/`): `/autopilot` — drive a task to the gate ·
`/schema` — a minimal Supabase database (after the idea is locked) · `/ui-polish` — polish the demo ·
`/pitch` — a 90-second pitch for the judges.

## /ship — save without breaking flow

When a piece works, type `/ship`: it stages surgically (never `git add -A`), writes
a clean commit, pushes, checks the remote and logs to the wiki. The repository stays
demo-ready, and the next colleague pulls working code.

## House rules (what NOT to do)

- Never `git add -A` / `git add .` — only explicit paths (a stray `.env` leaks a key,
  and that kills both the demo _and_ the account).
- Never hardcode secrets — only env variables.
- Don't deploy to a real/production domain without asking — only preview URLs.
- Don't build beyond the locked scope. A new idea → into the "out of scope" list, drive the demo path first.
- Don't hide decisions in code comments — a line in `.loops/guardrails.md` or `wiki/`.
- Work in your own branch (`feature/<name>`), never push to `main` — open a PR and let the
  integrator merge it. Pull changes before starting; agree on the data contract
  before splitting up work; don't edit a file another agent is editing. Full rules: `TEAMWORK.md`.
- Don't create tables or invent a DB schema until the project idea is locked — the schema
  is decided in the first 15 minutes of the kickoff, and one person (backend) owns it, everyone else goes through them.

## Commit co-author

End commit messages with the line:
`Co-Authored-By: Codex <noreply@openai.com>`
