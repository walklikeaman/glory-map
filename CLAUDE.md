# CLAUDE.md

@AGENTS.md

`AGENTS.md` (imported above) is the project's source of truth, written for Codex.
Everything in it applies to Claude Code too. This file only adds what Claude needs
on top: the commands, the map of the code, and how cloud sessions differ.

## Where the rules live

| What | Where |
|---|---|
| Every project rule, with its date and reason (wins over this file) | [`docs/RULES.md`](docs/RULES.md) |
| Start ritual, task loop, wiki operations, `/ship` | [`docs/agent-method.md`](docs/agent-method.md) |
| What the project knows | [`wiki/index.md`](wiki/index.md), newest-first [`wiki/log.md`](wiki/log.md) |
| Hard bans and process lessons | [`.loops/guardrails.md`](.loops/guardrails.md), [`.loops/experience.md`](.loops/experience.md) |
| `/ship` and the skills | `.claude/commands/ship.md`, `.claude/skills/gm-knowledge-lookup`, `.claude/skills/gm-harness-reflect` |

The short version of `docs/RULES.md` §3, for cloud threads:

- **Autonomous mode:** take the top item from `TASKS.md`, build, test, check web + phone
  with Playwright, open a PR, **merge it yourself on green tests**.
- **Production DB migrations need Nikita's yes.** Write them without `drop`: the
  Supabase MCP confirmation dialog never reaches him.
- **Paid AI: ~$5 per run, ~$150 per month, 10 items first.** The key is
  `GLORYMAP_ANTHROPIC_KEY`, passed to scripts as `ANTHROPIC_API_KEY`.
- **Moderation is AI-only;** publishing AI-verified places nightly is allowed.
- **Never print secrets. Talk to Nikita in Russian, short, only for decisions.**

## Commands

| What | Command |
|---|---|
| Install + seed `.env.local` | `./scaffold.sh` (cloud sessions do this in the SessionStart hook) |
| Dev server | `npm run dev` → http://localhost:3000 |
| Tests (offline, ~10 s, what CI runs) | `npm test` |
| One test file | `node --test test/<name>.test.mjs` |
| Production build | `npm run build`, then `npm run start` |

There is no lint or typecheck script; `npm test` plus `npm run build` is the bar
before a push. CI (`.github/workflows/tests.yml`) runs `npm ci && npm test` on
every push and PR. Node 22.

## Code map

- `app/` — Next.js 15 App Router, plain JS/JSX (no TypeScript).
  - `app/page.jsx` → `app/components/SceneMapApp.jsx` — the whole map app
    (one large client component, ~4.6k lines; read it by section, not whole).
  - `app/components/map/` — MapLibre canvas and layers.
  - `app/api/**/route.js` — server routes (locations, map points, work, trail,
    trip plan, narration, enrich/*, import/letterboxd, …).
  - `app/lib/*.mjs` — all domain logic as pure, testable modules
    (grounding, geocoding, sources, dedup, trails, map points, …).
  - `app/city/`, `app/work/`, `app/place/`, `app/directory/` — SEO pages.
- `test/*.test.mjs` — `node:test` suites, one per lib module; offline by design.
- `scripts/` — ingest/backfill/enrich jobs (these hit the network and the DB).
- `supabase/migrations/` — the schema history; the live DB is the shared
  `codex-hackathon` project (ref `quvxxqxowathrcyshhwj`).
- `tools/scraperai/` — Python crawlers for source harvests.
- `wiki/`, `ARCHITECTURE.md`, `ROADMAP.md`, `PRIORITIES.md` — decisions and plans.
  `wiki/log.md` is newest-first; read its headings before re-deriving anything.
  `test/wiki.test.mjs` (part of `npm test`) checks wiki frontmatter, index, log order,
  links and obvious secrets.
- `.loops/guardrails.md` — hard constraints learned the hard way. Read it.

## Environment

`.env.example` holds the public Supabase URL + anon key and documents every
other variable. Server-only secrets (`OPENAI_API_KEY`, `TMDB_API_READ_ACCESS_TOKEN`,
`SCENE_MATCH_SIGNING_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, …) are never committed;
set them in the cloud environment or Vercel, not in the repo.

## Cloud sessions (claude.ai/code, Projects)

- `.claude/hooks/session-start.sh` runs `npm ci` and creates `.env.local` from
  `.env.example`, so `npm test` and `npm run build` work straight away.
- The default cloud network only reaches package registries. Supabase, Wikidata,
  Wikipedia, TMDB and OpenAI are blocked unless the environment allows them, so
  API routes that read the DB return 502 there. Tests don't need the network.
- Branches: cloud sessions work on the `claude/...` branch they are given, not
  `feature/<name>`. Never push to `main`; open a draft PR.
- Commit trailer: use the attribution the session gives you, not the Codex
  co-author line from `AGENTS.md`.
