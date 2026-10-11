# Complete team guide

Everything you need to know to get connected and started: install, prompts, commands,
how we work together, and project ideas. Read top to bottom; if you're short on time, jump to the "In short" block.

Hackathon: **OpenAI Build Week**, Tel Aviv, July 21, 7 hours of building. We build on Codex.
Judged on a **live working demo**.

---

## In short (TL;DR)

1. Drop your **GitHub username** in the chat — we'll add you to the repo.
2. Install **Node 22+** and Codex: `npm install -g @openai/codex`, then `codex` (sign in with OpenAI).
3. Open Codex and paste the **setup prompt** (below, section 3) — the agent brings everything up on its own.
4. At the kickoff we pick **one idea** (section 6), lock in a single demo path, and split up the tasks.
5. We work: everyone on their own branch → `/ship` → PR → the integrator merges into `main`.

The database and deploy are already set up — no keys to fill in, no Vercel to configure.

---

## 1. What's already done (nothing to configure)

| Item                          | Link / status                                               |
| ----------------------------- | ------------------------------------------------------------ |
| Shared repository (code)      | https://github.com/walklikeaman/glory-map      |
| Live app (deploy)             | https://codex-hackathon-starter.vercel.app — already live   |
| Supabase (database + auth)    | shared team project, connected in prod ✅                    |
| Vercel (publishing)           | linked to the repo: **any push = auto-deploy to the web**   |
| Supabase keys                 | baked into the repo, nothing to fill in                     |

Full onboarding page with screenshots: **https://walklikeaman.github.io/glory-map/**

---

## 2. Stack

- **Next.js** — the app itself (React).
- **Vercel** — hosting: builds Next.js, serves it at a URL, auto-deploys on every git push.
- **Supabase** — managed Postgres + auth + storage, the team's shared database.
- **Demo path** — the one scenario we show live; everything else is "out of scope" until it's green.

Everything is already wired up; there's nothing to configure by hand.

---

## 3. Install

### Accounts (just two each)

- **OpenAI** — sign-in for Codex (the event hands out $150 in credits).
- **GitHub** — the shared repository. Send your username to the owner for write access.

No need to set up Supabase or Vercel — they're shared and already configured.

### Step 1 — by hand (~5 minutes)

```bash
# Node 22+ — if you don't have it: nodejs.org (LTS) or nvm install 22
node --version
# install Codex
npm install -g @openai/codex
# sign in with your OpenAI account
codex
```

### Step 2 — the agent installs everything else. Open Codex and paste:

```
You are my environment-setup agent. Do everything autonomously and report back at the end.

1. Clone the repository https://github.com/walklikeaman/glory-map.git and cd into its folder.
2. Run ./setup.sh — it installs CodeGraph, connects it to Codex, and drops the skills
   (/ship, /autopilot, /loop-*, /pitch, /ui-polish, /schema) into ~/.codex/prompts.
3. Run ./scaffold.sh — it installs the app's dependencies and creates .env.local with the shared Supabase keys.
4. Run npm run dev — the app comes up at http://localhost:3000.
5. Read AGENTS.md, TASKS.md, and TEAMWORK.md — the rules, the task board, and how we work as a team.
6. Report back on what's done. DO NOT create any tables in the database until we've locked in the idea.

After CodeGraph is connected, remind me to restart Codex.
```

Done: the app runs locally, the database is connected, and deploy happens automatically on push.

---

## 4. What the environment can do — commands (type `/name` in Codex)

- **`/autopilot`** — drive your task to green on your own (spec → build → run → verify → `/ship`), stopping at the human gate.
- **`/ship`** — save and push: a clean commit, push, verification. No secrets leak.
- **`/loop-demo`** — take one demo path to green, start to finish.
- **`/loop-lint`** — get lint/types/build clean before committing.
- **`/loop-debug`** — fix a bug; it records attempts so you don't go in circles.
- **`/loop-spec-ship`** — take a small spec to green and ship it.
- **`/loop-guardrails`** — record a recurring mistake into the rules so you don't hit it again.
- **`/schema`** — minimal Supabase schema (ONLY after the idea is locked, owned by one person).
- **`/ui-polish`** — a quick visual polish of the demo (~30 min) so it looks intentional.
- **`/pitch`** — a 90-second pitch for the judges: problem → live demo → wow → ask.

Plus: **CodeGraph** (the agent understands the code without blind grep) and **project memory** (`wiki/`, `Context/`) —
decisions accumulate between sessions.

---

## 5. How we work as a team

The main rule: **separate branches → one person merges into `main`**. That way four people don't collide.

- Everyone works on their own branch (`feature/<short>`). Push → open a PR → the integrator merges into `main`.
- Only the integrator pushes to `main`. The shared Vercel builds a preview for every branch.

**Roles (assigned at the kickoff, ~1 person each):**

- **Integrator / main** — keeps `main` green, merges PRs, owns the scope.
- **Backend** — Supabase: schema (`/schema`), API. Owns the schema alone.
- **Frontend** — screens and flows.
- **Demo and deploy** — runs the whole demo path, `/ui-polish`, records the demo, `/pitch`.

**Kickoff (first 30–45 minutes, everyone together):**

1. Pick an idea (section 6), fill in the "Project" block in `AGENTS.md` (idea, stack, one demo path, what's out of scope).
2. Agree on the **data contract** (which tables/fields) — then backend and frontend can go in parallel.
3. Slice the demo path into 4–6 pieces, add them to `TASKS.md`, and divide them up.

**Rhythm:** `git pull` before you start · `/ship` often · integration every 60–90 minutes (everyone pushes,
the integrator merges, deploys a preview, and we check the demo path is still alive).

The task board is `TASKS.md` (Codex reads it at startup). Full rules are in `TEAMWORK.md`.

---

## 6. Project ideas

6 ideas mapped to the categories, all buildable by four people in 7 hours, with a strong live demo.
Full descriptions and **ready-made prompts** are in [IDEAS.md](IDEAS.md). In short:

- **★ SnapSell** (Apps for your life) — a photo of any item → a finished listing with a price and rationale. The show: photograph any object from the room — a card in 5 seconds.
- **Codex Colosseum** (Developer tools) — three Codex agents fix one bug in parallel, and you merge the winner. On-theme for OpenAI.
- **Napkin** (Developer tools) — a photo of a UI sketch off a whiteboard → a live, clickable React component.
- **Viva** (Education) — a voice-based oral examiner working from your notes: it interrupts you on a mistake (Realtime API).
- **Hack the Oracle** (Games) — the AI hides a password and you extract it with prompts; levels + leaderboard.
- **Reply Debt** (Productivity/Work) — shows only the emails where you're the blocker and drafts replies for them.

We pick **one** at the kickoff → paste its prompt from `IDEAS.md` into the "Project" block of `AGENTS.md` → then `/autopilot` → `/loop-demo` → `/ship`.

---

## 7. Repository map (what's where)

```
AGENTS.md      the rules for the agent + the "Project" block (filled in at the kickoff)
GUIDE.md       this guide
TEAM.md        a short message for the chat
IDEAS.md       6 ideas with ready-made prompts
TASKS.md       the task board (Codex reads it at startup)
TEAMWORK.md    how we work as a team (branches, roles, kickoff)
prompts/       the /ship /autopilot /loop-* /pitch /ui-polish /schema commands
app/ · package.json   the ready-made Next.js app (at the root)
setup.sh · scaffold.sh   environment + dependency setup
.env.example   shared Supabase keys (public; scaffold copies them into .env.local)
wiki/ · Context/   project memory (decisions accumulate between sessions)
```

Questions about setup — post them in the team chat.
