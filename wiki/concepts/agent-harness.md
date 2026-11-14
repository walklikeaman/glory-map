---
type: concept
created: 2026-11-13
updated: 2026-11-13
sources: [project-scheme-kit, agent-framework, project-memory]
relates_to: [autonomous-operations, cloud-environment, testing-conventions]
---
# How agent work is organised here

Two kinds of agents work on this repo: Codex (the hackathon origin) and Claude Code
(cloud project threads since October). They share one set of layers, and each layer
answers one question.

| Question | Layer |
| --- | --- |
| How should I behave? | claude.ai project instructions → full text in [`docs/RULES.md`](../../docs/RULES.md) |
| What is this repo, and how do I run it? | `AGENTS.md` (Codex reads it), `CLAUDE.md` (imports it, adds cloud specifics) |
| How do I do a task end to end? | [`docs/agent-method.md`](../../docs/agent-method.md); long form in [`docs/agent-framework.md`](../../docs/agent-framework.md) |
| What does the project know? | this wiki: [index](../index.md), [log](../log.md), concepts, entities, sources |
| What is true right now? | claude.ai project memory (index + topic files) |
| What must I never do? | [`.loops/guardrails.md`](../../.loops/guardrails.md) |
| What did we learn about the process? | [`.loops/experience.md`](../../.loops/experience.md) |
| What do I work on next? | `TASKS.md` → `PRIORITIES.md` → `ROADMAP.md` → `IDEAS.md` |

## The habits

- **Before a task:** look it up (skill `gm-knowledge-lookup`, RULES §4). The
  SessionStart hook prints the guardrail count and points at the index.
- **During:** verify by opening the result, not by reading your own stdout.
- **After:** `/ship` (`.claude/commands/ship.md`; Codex: `prompts/ship.md`), which
  logs, tests, commits by explicit path, opens the PR and merges on green.
- **After a hard task:** skill `gm-harness-reflect` → one lesson or `NO_ENTRY`. The
  Stop hook reminds you.

## What enforces it

Rules in a document drifted: by November the log had entries out of order and
inside its own header. Since 2026-11-13 [`test/wiki.test.mjs`](../../test/wiki.test.mjs)
runs in `npm test` and CI and checks frontmatter, index coverage, log order, links
and obvious secrets. See [[testing-conventions]].

## Where it came from

Nikita's "project scheme" kit (the layout he uses in his other projects), applied
on 2026-11-13 on top of the existing Codex framework. The kit's Python wiki test was
ported to `node:test`, because CI runs only `npm test`. `AGENTS.md` kept its full
content instead of becoming a pointer, because Codex reads nothing else.
