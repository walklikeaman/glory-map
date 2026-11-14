# Project Guardrails

Hard constraints for this build. The agent reads this at session start. Add a
line whenever the same mistake happens twice, or when a decision must survive
the next teammate / the next Codex session. One-liners beat paragraphs.

---

## Guardrail: Never `git add -A` or `git add .`
Stage by explicit path only. A stray `.env` in a commit can leak a key that
kills both the demo and the account.

## Guardrail: Secrets live in env, never in code or git
`.env` is gitignored. No tokens in source, no tokens in commits, no tokens in
the Supabase MCP args that get committed.

## Guardrail: `ship` authorizes the complete production release
An explicit `ship` from the owner means: stage the agreed scope, commit, push,
mark the PR ready, wait for required checks, merge into `main`, deploy production,
and verify the public site. Do not stop after a preview or ask for a second
production confirmation. Without an explicit `ship`, use preview deployments.

## Guardrail: Protect the demo path
Before starting a new feature, confirm the one locked demo flow still works.
A green demo that does one thing beats a broken one that tries five.

## Guardrail: Inspect teammate changes before editing
Before every slice, fetch origin and inspect the dirty worktree, recent commits,
relevant branch diffs, and shared contracts. Never revert unknown changes; rebase,
integrate, or isolate the work so every teammate's contribution is preserved.

## Guardrail: One Next.js writer per checkout
Never run `next build` while `next dev` or another build uses the same checkout.
They share `.next` and concurrent writers can corrupt the dev/runtime manifest.

## Guardrail: Worktree falls back to its own branch — keep that branch on main

The agent worktree (`.claude/worktrees/<name>`) is bound to a branch such as
`claude/hackathon-prep-<id>`. Something in the environment periodically restores the
worktree to that branch, which showed up in the reflog as:

```
checkout: moving from main to HEAD
checkout: moving from <sha> to claude/hackathon-prep-27a66c
```

The effect is a silent time-machine: the tree jumps back to the commit the session
started at, while `origin/main` is far ahead. Nothing is lost (all work is pushed),
but edits made after a fallback land on stale files — once caught only because the
test count dropped from 280 to 130.

**Fix, applied 25.07:** keep the fallback branch pointing at main, so restoring it is
a no-op rather than a rewind:

```bash
git fetch origin -q
git branch -f claude/hackathon-prep-<id> origin/main
```

**Habit:** after any long tool run, check `git log --oneline -1` before editing. A
sudden drop in the test count is the loudest symptom.

## Guardrail: Supabase migrations without `drop`
Added: 2026-11-13 (seen 2026-10-13 and 2026-11-03)
The Supabase MCP asks for confirmation on statements with `drop`, and that dialog
never reaches Nikita; it times out, and `apply_migration` also timed out twice.
Use `if not exists`, `alter policy`, a new policy; `execute_sql` with begin/commit
works. A drop that cannot be avoided → send him the SQL and the SQL Editor link
(`docs/RULES.md` §3.4).

## Guardrail: Ten items and a price before any paid bulk run
Added: 2026-11-13
Every paid model run starts on 10 items, with the cost reported, and stays under
~$5 per run (`docs/RULES.md` §3.5). Why: the stills, trails and web-research
pilots each found a defect (truncated answers, image URLs refused, a 400 from
web_fetch) on the first ten that would have been paid for thousands of times.

## Guardrail: Never verify resolver places by hand
Added: 2026-11-13
After every `scripts/resolve-works.mjs` run, run
`scripts/review-resolved-places.mjs --write`. Why: 86 "verified" Wikidata places
were whole countries or cities (Israel, Spain, central London).

## Guardrail: `wiki/log.md` entries go right below the `---` line
Added: 2026-11-13
Never above it (two entries once landed inside the "Format:" line) and never out
of date order (parallel threads left four blocks out of order). When two branches
both add entries, keep both sides. `test/wiki.test.mjs` fails on either mistake.
