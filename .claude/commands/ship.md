---
description: Finish a task — log it, run tests and build, commit by explicit path, push, open a draft PR, merge on green, update TASKS.md and memory, report.
---

# /ship — save and send the current work

Rules behind each step: [`docs/RULES.md`](../../docs/RULES.md). Codex has its own
copy in `prompts/ship.md`.

## Steps

1. **Diagnose.** `git status --short`, `git diff --stat`, `git log --oneline -5`.
   Check you are on the `claude/...` branch the session gave you, never `main`.
   Anything you did not write (another thread's files, `.env*`, keys, scratch
   `_probe_*` files) → don't stage it; name it in the report.
2. **Log.** No entry about today's work in `wiki/log.md` → add one **right below the
   `---` line**: `## [YYYY-MM-DD] update | <topic>` + 1–5 lines (what, why, numbers).
3. **Index.** A new wiki page → a line in `wiki/index.md`. A changed page → bump its
   `updated:`.
4. **Plans.** Tick the line in `TASKS.md` (and `ROADMAP.md` if a theme moved); add
   what is still missing.
5. **Checks.** `npm test` (includes `test/wiki.test.mjs`) and `npm run build`. Red →
   fix it, don't ship.
6. **Commit.** `git add <path> <path> …` — never `-A` or `.`; `git diff --cached --stat`.
   Subject ≤ 72 chars, the body says *why*, end with the attribution lines the session
   gives you (not the Codex co-author line).
7. **Push.** `git push -u origin <branch>`, retry network errors with backoff; check the
   remote sha matches `git rev-parse HEAD`.
8. **PR.** No open PR for the branch → open a draft (start the body with the project's
   attribution lines). Subscribe to its activity.
9. **Merge on green** (RULES §3.2): CI `npm test` green + local build passed → mark
   ready and merge with a merge commit. Not if it needs a prod DB migration that Nikita
   has not approved (RULES §3.3).
10. **Memory.** A new fact or decision → a pointer in project memory (a topic file
    ≤ 4 KB, one line in the index).
11. **Report** in Russian, short: what was done (with the check), what is left, the PR link.

## Not needed

Reading, answering questions, work that changes no files in the repo.
