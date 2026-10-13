# Preflight — getting ready for the hackathon

OpenAI Build Week · Tel Aviv · July 21, 17:00 → midnight · we build on Codex.

We show up at the venue with a ready environment and start building the product on Codex right away. Everything
that can be installed at home, we install the night before: accounts, tools, the agent itself. On
site we don't burn the evening on setup. About 25 minutes.

## What to install ahead of time

Each person has just two accounts of their own. The database and deploy are shared across the whole team; the owner
sets them up once (see below).

1. **Node 22 or newer** — check with `node --version`. Don't have it — install the LTS from nodejs.org
   or `nvm install 22`.
2. **OpenAI account** — you sign in to Codex with it. The event hands out $150 in credits.
3. **GitHub account** — the team's shared repository. Give the owner your username so
   they can add you to Collaborators (otherwise you won't be able to push).

**Team owner — once for everyone:** create one Supabase project and one Vercel project;
in Vercel do an Import and pick the shared GitHub repository (every branch push becomes a
preview deploy); send the team the Supabase keys (URL and anon key); on your own machine run
`./setup.sh --infra` so your Codex can manage the schema.

## Install

```bash
# the team's shared repository
git clone https://github.com/walklikeaman/glory-map.git
cd glory-map

./setup.sh      # installs CodeGraph, connects it to Codex, drops in the skills (enough for a participant)
./scaffold.sh   # working Next.js app in ./app (packages download now, not on stage)
codex           # sign in to Codex
```

Copy `.env.example` to `app/.env.local` and fill in the shared Supabase keys (the owner will
send them). Check: `codex mcp list` shows codegraph; `~/.codex/prompts` contains
`ship.md` and `loop-*.md`. You don't configure deploy — you push a branch and the shared Vercel
builds the preview itself.

## How we work in Codex

1. **Lock in the scope** — fill in the "Project" block in `AGENTS.md`: what we're building, the stack,
   the single demo path, what's out of scope.
2. **Describe the task in words** — Codex plans on its own and reads the structure through CodeGraph.
3. **Codex works on autopilot** — it writes, runs, and verifies live. It only stops
   at anything irreversible (deploy to prod, sending, deleting data).
4. **We run the demo path to green** — `/loop-demo` walks the whole path like a judge, fixes
   the first breakage, and repeats.
5. **We save** — `/ship` makes a commit, a push, and a journal entry.

## Commands

- `/autopilot` — drive the task to the green gate on your own and stop (autonomy up to the gate, not through it).
- `/ship` — save and push: surgical staging, a clean commit, a sync check.
- `/loop-demo` — take one demo path to green.
- `/loop-lint` — get lint, types, and build clean before committing.
- `/loop-debug` — fix a bug; it records attempts so you don't go in circles.
- `/loop-spec-ship` — take a small spec to green and ship it.
- `/loop-guardrails` — record a recurring mistake into the guardrails.
- `/loop-docs-sync`, `/loop-migrate`, `/loop-pr-review`, `/loop-de-sloppify` — as needed.
- `/schema` — minimal Supabase schema (after the idea is locked), `/ui-polish` — demo polish, `/pitch` — a 90-second pitch for the judges.

## What the environment can already do

- **Codex is pre-instructed** — it reads `AGENTS.md` and works by our
  rules; no need to re-explain every session.
- **CodeGraph** — a local code graph; it answers "where is X, what breaks if Y" without
  blind grep.
- **Supabase and Vercel** — database and deploy straight from the agent.
- **Project memory** (`wiki/`, `Context/`) — decisions and gotchas accumulate between sessions.
- **Guardrails** — hard rules, shown at the start of the session.

## At the demo

- Deploy a preview link early — there's always something to show.
- As soon as the demo works, record the screen for 60–90 seconds (`⌘⇧5`) — insurance in case
  the Wi-Fi drops on stage.
- One working flow beats five half-done ones. The judges watch a live demo.

Questions about setup — post them in the chat.
