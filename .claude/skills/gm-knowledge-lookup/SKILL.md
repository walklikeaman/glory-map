---
name: gm-knowledge-lookup
description: Search everything GloryMap already knows (project memory, wiki, log, docs, guardrails, shared project files, the code graph) before starting a task or asking Nikita anything, then write new decisions back. Use at the start of every GloryMap task and whenever a fact is unknown. Triggers (RU+EN) — «что мы знаем про», «где это записано», «найди в знаниях», «посмотри в вики», «что решили», "what do we know", "search the wiki", "what did we decide", "check the knowledge base".
---

# GloryMap — look it up first

Rule: **search first, ask second.** Asking for what is already written down is not
allowed ([`docs/RULES.md`](../../../docs/RULES.md) §4).

## 1. Search (in this order)

1. Project memory is already loaded — open the topic files, not just the index lines.
2. The local pass, one command from the repo root:
   ```bash
   bash .claude/skills/gm-knowledge-lookup/search.sh 'term1|term2'
   ```
   Then read `wiki/index.md`, the pages it found, and the matching `wiki/log.md` entries.
3. Code structure: CodeGraph (`codegraph_context` / `codegraph_explore`) if it is wired
   up, or `graphify-out/GRAPH_REPORT.md` if it exists; otherwise grep `app/lib/`.
4. Neighbouring project threads and `/mnt/project-files/`.

In the first reply, one line: what you found and where. Found nothing anywhere — say
so, then ask.

## 2. Write it back

A new decision or fact → its page in `wiki/` (replacing a decision follows RULES §5)
→ an entry at the top of `wiki/log.md` (below the `---`) → a pointer in project
memory → `/ship`.

## Never

- Put passwords, tokens, keys or account emails into the wiki or memory.
- Edit raw material (`Context/`, `.planning/codebase/`).
