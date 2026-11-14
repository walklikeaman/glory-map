---
type: entity
created: 2026-07-22
updated: 2026-08-07
sources: [code, log]
---
# Deployment — Vercel + GitHub Actions with gates

Vercel project `codex-hackathon-starter` (id `prj_FM31BOAjGEmwLlOFFK0zcpzcqStE`,
account `walklikeaman1904`), linked to the GitHub repo. The framework is forced by
`vercel.json` (otherwise it built as static).

## Corrected twice on 05.08 — a merge into `main` ships to production SOMETIMES

**Second correction, same day.** Of four merges into `main` within forty minutes, only
two produced a Production deployment: `7c330c4` and `1d7c5c8` did, `8907282` and
`733cb49` got a Preview and nothing else. Production ran an hour-old commit while `main`
was two merges ahead, and the map answered without a fix that had already been merged.

**The verification that looked fine and was not.** `gh api repos/…/commits/<sha>/status`
returns `success` as soon as ANY check passes — and the Preview deployment is a check.
So the poll went green while no production deployment existed at all. The honest check
asks for the environment by name:

```bash
gh api "repos/OWNER/REPO/deployments?environment=Production&per_page=5" \
  --jq "[.[] | select(.sha==\"$(git rev-parse origin/main)\")] | length"
```

Zero means production is still on an older commit, whatever the commit status says.

**The manual path is not a relic — it is the fallback.** It works and it is the way to
force production current:

```bash
gh workflow run "Deploy production" -f ref=main -f confirm_production=true
```

Measured: 40 seconds end to end, and the production URL served the merged code straight
after.

## First correction 05.08 — a merge into `main` ships to PRODUCTION

Measured on PR #122, not assumed. Merging created **two** things within seconds: the
`Deploy staging` workflow run, and a Vercel deployment in the GitHub environment
**`Production`** (`gh api repos/…/deployments?sha=<merge>` → `{"env":"Production"}`).
The production URL served the merged code immediately — `/api/access`, a route that did
not exist before the merge, answered 200.

So the Vercel Git integration is connected now and `main` is a production branch. The
manual workflow below still exists and still works; it is no longer the only path, and
**anyone merging a PR is shipping to users.** Nothing gates it.

## Original scheme (decision 21.07, PR ef1fecd) — the manual path

- Push a branch → Vercel Preview for that branch (link in the PR).
- Merge into `main` → staging: GitHub environment `staging`, Vercel Preview.
- Production via GitHub Actions workflow with explicit confirmation through the
  `production` environment. Credentials (`VERCEL_TOKEN`, `VERCEL_ORG_ID`,
  `VERCEL_PROJECT_ID`) — in GitHub environment secrets.
- Prod URL: https://codex-hackathon-starter.vercel.app
- The GitHub Actions path needs three secrets. `VERCEL_ORG_ID`
  (`team_oulXyCQDRVVkXELdoJuaaVEE`) and `VERCEL_PROJECT_ID`
  (`prj_FM31BOAjGEmwLlOFFK0zcpzcqStE`) are identifiers, not credentials, and are set.
  `VERCEL_TOKEN` (an owner-minted account access token, scope walklikeaman1904) is set
  too, so the workflow now runs green end to end. Trigger:
  `gh workflow run "Deploy production" -f ref=main -f confirm_production=true`.
  The CLI path (`vercel pull` / `build --prod` / `deploy --prebuilt --prod`) still
  works as a fallback.

## Incident lesson (guardrail)

The first `vercel deploy` without `--prod` on a freshly created project still went
to production. For a newly linked project you must use
`vercel deploy --target=preview` (recorded in `.loops/guardrails.md`).

## Gotchas

- **The Vercel CLI on this machine cannot see this project.** It is logged in as
  `nikita-8024` with the team `kitpos`; GloryMap lives under the personal account
  `walklikeaman1904`. `vercel ls … --scope walklikeaman1904` answers "the specified
  scope does not exist", which reads like a missing project and is a missing login.
  Deploys go through the GitHub integration; the CLI path needs a different account.
- **`vercel env add` defaults to SENSITIVE on Production and Preview.** A sensitive
  variable is withheld from the *build*, so a `NEXT_PUBLIC_*` value never gets inlined
  into the client bundle — the browser Supabase client silently became `null` (no
  login, no cloud library) while server routes, which read `process.env` at runtime,
  still got a value. That mismatch produced a 502 rather than an honest "not
  configured" 503. Always pass **`--no-sensitive`** for `NEXT_PUBLIC_*`. Verify with
  `vercel env pull`: a sensitive value comes back EMPTY.
- **`vercel env rm NAME preview` removes the whole variable**, not just that target,
  when one entry covers several environments. Re-add every environment afterwards.
- Vercel CLI 52 loops on `env add ... preview` with an `action_required` hint even when
  the suggested flags are passed; `npx vercel@latest` works.
- The preview/staging environment has **no `OPENAI_API_KEY`** — AI features ([[openai]])
  are verified only in prod after a manual deploy.
- Prod env variables: NEXT_PUBLIC_SUPABASE_* (not used at runtime —
  [[supabase]]), OPENAI_*, TMDB_API_READ_ACCESS_TOKEN.
- Don't run `next build` while `next dev` is live in the same checkout — they share
  `.next` (guardrail).
