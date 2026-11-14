# How an agent works in this repo

Read on demand. The rules are in [`RULES.md`](RULES.md); the long, project-agnostic
version of this method (Codex edition, every layer explained) is
[`agent-framework.md`](agent-framework.md).

## 1. Start ritual (do not skip)

1. `CLAUDE.md` → `AGENTS.md` (product, stack, commands, code map).
2. Project memory — open the topic files that touch the task.
3. Fresh decisions: `grep "^## \[" wiki/log.md | head -20`.
4. `cat .loops/guardrails.md` — the hard bans (the SessionStart hook counts them).
5. `git log --oneline -10 && git status --short` — what the last session left behind.
   In a cloud session check you are on the `claude/...` branch you were given.
6. `wiki/index.md` when the task touches something already studied — link it, don't
   re-derive it. Skill `gm-knowledge-lookup` does steps 3–6 in one pass.
7. `TASKS.md` — the queue; take the first unchecked line without an open PR.

Found something ready-made? Point to it in the reply.

## 2. The task loop

```
assumptions → look for what exists (grep the repo and wiki/) → plan of 2–5 steps,
  each with a check → build → run → verify BY OPENING THE RESULT (curl the route,
  load the page on 1440 px and 390 px, re-read the file — not your own stdout)
  → delete probe scripts → npm test + npm run build → entry in wiki/log.md
  → /ship → report
```

The report says three things: what was done (with the facts of the check), what is
left, what to look at next time.

**Doing the same thing a second time? Write a script or a command.** The first time a
one-off is fine.

## 3. The wiki

| Layer | Path | Who changes it |
| --- | --- | --- |
| Raw | `Context/`, `.planning/codebase/`, exports in `/mnt/project-files/` | nobody |
| Wiki | `wiki/` | the agent |
| Working files | `app/`, `scripts/`, `supabase/migrations/`, `test/` | the agent, with tests |
| Plans | `TASKS.md`, `ROADMAP.md`, `PRIORITIES.md`, `IDEAS.md` | the agent, after each ship |
| Memory | claude.ai project memory | agent and coordinator |

Three operations:

1. **Ingest** — new raw material: a `wiki/sources/<slug>.md` page, edits to the
   affected `concepts/` and `entities/`, a line in `index.md`, an entry in `log.md`.
2. **Query** — a question: `index.md` first, then the pages; answer with links. A
   useful answer becomes a page.
3. **Lint** — on request or weekly: contradictions, stale pages, orphans, gaps.
   `node --test test/wiki.test.mjs` (part of `npm test` and CI) catches the mechanics.

### Page format

```yaml
---
type: concept | entity | source | handoff
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: [<slug or kind>, ...]   # where the knowledge came from
# optional:
confidence: high | medium | low
status: active | superseded
superseded_by: <slug>
relates_to: [<slug>, ...]
---
# Title
```

Retell, don't quote. Link other pages with `[[slug]]` (Obsidian; the test checks the
page exists) or a relative markdown link (the test checks the file exists). Bump
`updated:` when you change a page.

### `wiki/log.md`

Append-only, **newest on top**, right below the `---` line, never above it and never
at the end. Format: `## [YYYY-MM-DD] {update|ingest|decision|incident} | title`, then
1–5 lines. When two branches both add entries, keep both sides of the conflict.

**Auto-log:** every meaningful operation gets an entry without being asked. In doubt,
it is meaningful.

## 4. The graph

- **CodeGraph** (MCP, `codegraph init` once, `codegraph index --force` after switching
  branches) answers "what calls X", "what breaks if I change Y".
- **Graphify** (optional, owner's Mac: `~/.local/bin/graphify update .` in the repo
  root; `graphify hook install` rebuilds after each commit). Output in
  `graphify-out/`, gitignored. Read `graphify-out/GRAPH_REPORT.md`.
- **Obsidian**: open the repo as a vault; the `[[links]]` in `wiki/` are the graph.

## 5. `/ship`

One command for the end of a task: diagnose → log → index → `npm test` + build →
explicit-path commit → push → draft PR → merge on green (RULES §3.2) → `TASKS.md` →
memory → report. Claude: [`.claude/commands/ship.md`](../.claude/commands/ship.md).
Codex: `prompts/ship.md`.
