# Team — the environment is ready, let's get connected

Hi everyone. The hackathon environment is ready and configured — the database and deploy already work;
each of you just needs to install a couple of things and paste one prompt into the agent.

## What's already done (don't touch it)

- **Shared repository:** https://github.com/walklikeaman/glory-map
- **Supabase** (database + auth) — the team's shared project, up and running.
- **Vercel** — linked to the repository: any branch push auto-deploys to the web.
  The live app is already up: https://codex-hackathon-starter.vercel.app
- The Supabase keys are baked into the repository — nothing to fill in.

## From you — one time

1. **Drop your GitHub username** here in the chat — I'll add you to the repository so you can push.
2. Install **Node 22+** (nodejs.org) and **Codex**: `npm install -g @openai/codex`, then `codex` (sign in with OpenAI).

## The agent does the rest — open Codex and paste this prompt:

```
You are my environment-setup agent. Do everything autonomously and report back at the end.

1. Clone the repository https://github.com/walklikeaman/glory-map.git and cd into its folder.
2. Run ./setup.sh — it installs CodeGraph, connects it to Codex, and drops the skills (/ship, /loop-*, /autopilot, /pitch, /ui-polish, /schema) into ~/.codex/prompts.
3. Run ./scaffold.sh — it installs the app's dependencies and creates .env.local with the shared Supabase keys.
4. Run npm run dev — the app comes up at http://localhost:3000.
5. Read AGENTS.md, TASKS.md, and TEAMWORK.md — the rules, the task board, and how we work as a team.
6. Report back on what's done. DO NOT create any tables in the database until we've locked in the idea.

After CodeGraph is connected, remind me to restart Codex.
```

Full guide (install + all commands + ideas + glossary): **[GUIDE.md](GUIDE.md)**
Onboarding page with screenshots: **https://walklikeaman.github.io/glory-map/**

## How we work together

- Everyone works on **their own branch** (`feature/…`), and one person merges into `main` via a Pull Request.
- At the kickoff we lock in the idea and one demo path (we'll fill in the "Project" block in `AGENTS.md`),
  slice the demo path into pieces, and divide them up (the board is `TASKS.md`, the roles are in `TEAMWORK.md`).
- `/autopilot` — drive your task to green on your own, `/ship` — save and push.

Questions about setup — here in the chat.
