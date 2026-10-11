# INSTALL — setting up on a clean machine

Everything you need to bring the starter up on a laptop that has nothing on it yet. Budget
~25-40 minutes the day BEFORE the hackathon (Wi-Fi and npm are slower at the venue, and the app scaffold
and the first OAuth for MCP are better done at home).

## 0. What you need ahead of time

| What you need | Check            | Where to get it                                          |
| ------------- | ---------------- | -------------------------------------------------------- |
| **Node 22+**  | `node --version` | https://nodejs.org or `nvm install 22`                   |
| **git**       | `git --version`  | Xcode CLT (`xcode-select --install`) / package manager   |
| **Terminal**  | —                | Terminal.app / iTerm                                     |

`setup.sh` won't run on Node below 22 (both Codex and CodeGraph need it).

## 1. Accounts you need ahead of time (BEFORE hackathon day)

One shared infrastructure: **one** Supabase database and **one** Vercel project for the whole
team, not one per person. Each participant only needs OpenAI + GitHub.

| Account                    | Who      | Why                                                              |
| -------------------------- | -------- | ----------------------------------------------------------------- |
| **OpenAI** (ChatGPT / API) | everyone | sign-in for Codex; $150 in credits at the venue                  |
| **GitHub**                 | everyone | push to the shared repository (the owner adds you as a collaborator) |
| **Supabase**               | owner    | one shared database; the owner hands out the URL + anon key      |
| **Vercel**                 | owner    | one shared project linked to the repository (auto-deploy of branches) |

We store **no credentials at all**. The owner sets up the shared
Supabase + Vercel once and hands out the Supabase keys; everyone else only needs
OpenAI + GitHub.

### Owner — once for the whole team (do it the night before, ~15 minutes)

We bring up all the "plumbing" ahead of time but leave the DB schema alone — it's decided at the kickoff,
once the idea is known. Empty projects don't presume the idea and cost nothing.

1. Create **one empty Supabase project** (enable auth, do NOT create tables) and **one
   empty Vercel project**.
2. In Vercel: Import Project → pick the shared GitHub repository (after that every push
   gets a preview URL, and `main` gets production).
3. In Vercel → Settings → Environment Variables, fill in `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` from Supabase. Send the same values to the team for `app/.env.local`.
4. Invite all four into **both dashboards** (Supabase + Vercel) and into the repository
   (Settings → Collaborators). Invites often land in spam — do it early.
5. Run `./setup.sh --infra` on your machine so your Codex can manage the schema through MCP.
6. **Smoke test (mandatory):** push a trivial commit → wait for a green auto-deploy
   on Vercel → verify the app makes one write through the real env. A green
   check = the setup is accepted. "Exists" ≠ "verified": Supabase's default RLS policies
   silently block writes, and env vars often lag on the first deploy — better to catch it now,
   not on the 7-hour clock.

Do NOT create the schema (tables, columns) ahead of time — not even a "generic users/items". That's a hidden
bet on the idea; it's decided in 5 minutes at the kickoff.

## 2. Grab the code

```bash
git clone https://github.com/walklikeaman/glory-map.git
cd glory-map
```

This is the shared team repository — the owner adds participants as
**collaborators** (repository → Settings → Collaborators) so everyone can
`/ship` (push). Anyone who isn't a collaborator forks and opens a PR.

## 3. Run setup

```bash
./setup.sh                 # participant: Codex + CodeGraph + skills (no DB/deploy accounts)
./setup.sh --infra         # owner/backend: also Vercel CLI + Supabase and Vercel MCP connection
./setup.sh --playwright    # also connect the browser Playwright MCP (~100MB chromium on first run)
./setup.sh --check         # check only, installs nothing
```

`setup.sh` (idempotent — safe to re-run):

1. checks Node 22+/npm;
2. installs the **Codex CLI** (`@openai/codex`) and **CodeGraph** (`@colbymchenry/codegraph`);
3. adds the freshly installed global bin to PATH, then runs `codegraph install` to connect CodeGraph to Codex;
4. copies `/ship` and the loop prompts into `~/.codex/prompts/`.

With **`--infra`** it also installs the Vercel CLI and connects the **Supabase** and
**Vercel** MCP servers — needed only by the one person who runs the shared backend/deploy. Everyone
else works with the shared database through `.env.local` (created by `scaffold.sh`).

If the CLIs installed but haven't made it into your shell's PATH yet, the script will say so
and ask you to open a new terminal and re-run — there'll be no false "success".

## 4. Run the app

A working Next.js app already lives in the repository (at the root). `scaffold.sh`
installs the dependencies and creates `.env.local` from `.env.example` — the shared Supabase keys
are already inside, nothing to fill in.

```bash
./scaffold.sh             # npm install + .env.local
codegraph init            # build the local code index for Codex
npm run dev               # http://localhost:3000
```

Do this the night before and the packages get cached ahead of time. No deploy to configure:
push to the shared repository and the linked Vercel builds the preview itself.

## 5. Sign in to your accounts

```bash
codex           # first run: sign in with your OpenAI/ChatGPT account
vercel login    # only for the person who runs deploy
```

If you ran `--infra`, then the **Supabase and Vercel MCPs** will each open their own OAuth in
the browser the first time the agent calls them — do this at home so it doesn't catch you mid-build,
and pick the SAME shared project. Everyone else doesn't need this — they reach the shared
database through `app/.env.local`.

## 6. Verify everything works

```bash
node --version                 # >= 22
codex --version
codegraph --version
vercel --version
codex mcp list                 # → codegraph  (supabase, vercel too, if you ran --infra)
ls ~/.codex/prompts/           # → ship.md, loop-demo.md, loop-lint.md, …
```

Then open the repository in Codex and make sure the SessionStart line prints
`[loops] .loops/guardrails.md: N guardrail(s) active` (Codex supports
SessionStart hooks from `.codex/hooks.json`). If the Project block is still empty,
you'll also see a `[scope] ⚠ …` hint — fill it in before you start building.

## 7. Your first real step

Fill in the **"Project"** block at the top of `AGENTS.md` (idea, category, stack,
the single demo scenario, what's out of scope). That one block keeps a team of
3-6 people aimed at the same demo. After that — build.

## Manual MCP setup (if the script couldn't)

```bash
codegraph install                                    # pick Codex CLI when prompted
codex mcp add supabase --url https://mcp.supabase.com/mcp
codex mcp add vercel   --url https://mcp.vercel.com
codex mcp add playwright -- npx -y @playwright/mcp@latest   # optional
codex mcp list                                       # check
```

## If something went wrong

- **`codex: command not found` after install** — the global npm bin isn't in this shell's PATH.
  Open a new terminal; if that doesn't help, add
  `$(npm prefix -g)/bin` to PATH. (**Don't** run `npm i -g codex` — that's an unrelated
  package from 2012. You need `@openai/codex`.)
- **CodeGraph says "not initialized"** in the repository — run `codegraph init`,
  then `codegraph index --force` at the repository root (do this in the `app/` folder).
- **The agent can't create a table in Supabase** — the MCP must have finished its
  browser OAuth, and a project must be selected. Restart the OAuth from a fresh
  agent session.
- **`scaffold.sh` says the folder already exists** — pass a different name: `./scaffold.sh web`.
