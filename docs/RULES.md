# GloryMap — rules

The full text of the project's rules. The claude.ai project instructions hold each
rule as one bold line with a pointer here (`§N`); this file holds the reason and
the date. A new rule = one line in the project instructions + its full text here +
an entry at the top of [`wiki/log.md`](../wiki/log.md).

Owner: Nikita (GitHub `walklikeaman`). Skill prefix: `gm`.

---

## 1. Where things live

```
claude.ai project instructions   HOW to work: one bold line per rule, ≤ 10,000 chars
        │
        ▼
docs/RULES.md (this file)        the full text of every rule, no length limit
        │
        ▼
AGENTS.md + CLAUDE.md            what is true only in this repo: product, stack,
        │                        commands, code map (AGENTS.md for Codex, CLAUDE.md
        │                        imports it and adds Claude/cloud specifics)
        ├── docs/agent-method.md     start ritual, task loop, wiki operations, /ship
        ├── wiki/                    knowledge: index · log · overview · concepts ·
        │                            entities · sources (+ handoff pages)
        ├── .loops/                  guardrails (hard bans), experience (lessons),
        │                            reflexion (failed debug attempts)
        ├── TASKS.md, ROADMAP.md,    the work queue and the plan
        │   PRIORITIES.md, IDEAS.md
        └── claude.ai project memory WHAT is true now: index + topic files ≤ 4 KB
```

| Layer | Holds | Never holds |
| --- | --- | --- |
| Project instructions | behaviour rules | facts, current state |
| Project memory (`MEMORY.md` + topic files) | current facts, Nikita's decisions, standing permissions, open threads | rules already in the instructions, long recipes |
| `wiki/` | recipes, history, post-mortems, gotchas, domain knowledge | secrets, account emails, chat state |
| `Context/` | raw source material as it arrived | — (never edited) |
| `TASKS.md` / `ROADMAP.md` | what is queued, what was done, what is missing | the reasons behind decisions (those go to `wiki/`) |

**One fact, one home.** A version, a path, an id lives in one place; the rest link
to it. When a fact changes, grep for the old value and fix every copy in the same turn.

If `CLAUDE.md`/`AGENTS.md` and this file disagree, this file wins and the other
one gets fixed.

## 2. Trust order when facts disagree

```
code / service / file checked in this session
  >  what Nikita said
    >  what an agent saw earlier (memory, wiki, a thread)
      >  what an agent guessed
```

Inside one step, the newer date wins. Memory and wiki entries are point-in-time;
verify a file, flag or table before acting on it.

## 3. Hard rules of this project

1. **Autonomous mode is on** (Nikita, 2026-11-03). Work continuously without waiting
   for him: read `ROADMAP.md`, `PRIORITIES.md`, `TASKS.md`, `IDEAS.md`, take the
   highest-value unfinished item, build it in its own thread with tests, self-review
   (`/code-review`), check web and a phone viewport with Playwright, open a PR.
   *Why:* draft PRs and "shall I?" questions piled up and stalled the daily routines.
2. **Merge your own PR when tests are green** (Nikita, 2026-11-03). CI `npm test`
   green and `npm run build` passing locally → merge it yourself, merge commit, not
   squash. *Why:* eight drafts were waiting on his review.
3. **Production DB migrations need Nikita's explicit yes** (2026-11-03). Everything
   else reversible (branches, PRs, preview deploys, test data) — just do it.
4. **Supabase MCP confirmation dialogs never reach Nikita** (2026-11-03). Its
   elicitation prompt times out in the project app. Write migrations without `drop`
   (`if not exists`, `alter policy`, a new policy); when one truly needs his hands,
   send him the exact SQL and the SQL Editor link
   `https://supabase.com/dashboard/project/quvxxqxowathrcyshhwj/sql/new`.
5. **Spend guard for paid AI calls** (2026-11-03): at most ~$5 per run and ~$150 per
   month on the Claude key. Test on 10 items and report the cost before any bulk run.
   *Why:* the key is Nikita's own budget (~$200/month).
6. **The Claude key is `GLORYMAP_ANTHROPIC_KEY` in the cloud** (2026-11-03). The
   cloud reserves `ANTHROPIC_API_KEY` and hands it over empty, so scripts run as
   `env -u ANTHROPIC_BASE_URL ANTHROPIC_API_KEY="$GLORYMAP_ANTHROPIC_KEY" …`. On
   Vercel the name stays `ANTHROPIC_API_KEY`.
7. **Moderation of place submissions is AI-only** (2026-10-13, refined 2026-11-03).
   No manual review, no moderator emails or notifications. The AI pass leaves rows
   `pending`; `verified` is reserved for a check made by a person; what the AI
   cannot settle stays pending with `ai_problems`, and `/review` stays built but unused.
8. **Publishing AI-verified places every night is allowed** (Nikita, 2026-11-04).
   `scripts/promote-verified.mjs` (after a `--dry-run`) may run nightly without
   asking. Also standing: nightly Wikidata pin fixes and the TMDB ratings backfill
   (2026-11-05). Any *other* new kind of bulk write to the shared DB still needs a yes.
9. **"Add a place" is for signed-in users only, hidden until verified** (2026-10-12).
   Never draw pending user submissions on the public map; never open anonymous writes.
   Account connections (Letterboxd, Simkl) are also signed-in only (2026-11-07).
10. **Never paste or print secrets** (standing). Keys live in the cloud environment
    or Vercel, never in the repo, logs, wiki, memory or replies.
11. **Never push to `main`; work on the `claude/...` branch the session gives you**
    and open a draft PR (cloud sessions; Codex uses `feature/<name>`).
12. **Talk to Nikita in Russian, short, only when something needs his decision**
    (2026-11-03). Everything else goes into the checklist, the PR and the wiki.
13. **Never verify places from the resolver by hand** (2026-11-13). After every
    `resolve-works.mjs` run, run `scripts/review-resolved-places.mjs --write`; it
    holds back countries, cities and areas. *Why:* 86 "verified" places were whole
    countries or cities.

## 4. Look it up before you ask

Before a task and before any question, search what the project already knows.
Asking for something that is written down is not allowed.

1. Project memory (loaded on its own) — open the topic file, not just the index line.
2. [`wiki/index.md`](../wiki/index.md) → the relevant pages; grep [`wiki/log.md`](../wiki/log.md).
3. `docs/`, `ARCHITECTURE.md`, `.planning/codebase/`, `Context/`.
4. CodeGraph (`codegraph_context`) or Graphify (`graphify-out/GRAPH_REPORT.md`) when present.
5. Neighbouring project threads and `/mnt/project-files/`.

The `gm-knowledge-lookup` skill runs the local pass in one command. Say in one line
what you found and where. Found nothing — say so, then ask.

After the work, **write the knowledge back**: wiki page → entry at the top of
`wiki/log.md` → pointer in project memory.

## 5. Replacing a decision is a ritual, not a silent edit

1. The old page gets `status: superseded`, `superseded_by: <new>`, and a date.
2. Its body shrinks to three lines: what changed and why.
3. The new page carries the same claim in its new form.
4. In `wiki/index.md` the old line moves to "Superseded".

## 6. Autopilot, and when to stop and ask

Drive a clear task to a verified result yourself: built → verified by actually
opening the result (curl the route, load the page, re-read the file) → logged →
shipped. Then report.

**Stop and ask** when the action:
- leaves the project or is hard to undo: a production deploy outside the normal
  merge, a send, a public post, money beyond rule 5;
- destroys: deleting real data, force-push, rewriting history;
- is a production DB migration (rule 3) or a new kind of bulk write (rule 8);
- touches credentials or another account's data.

At a fork that changes the goal, ask one question with options and a recommendation.
Decide small things yourself and say what you chose.

## 7. Saving and secrets

- Never `git add -A` / `git add .`; stage explicit paths.
- Before the turn ends, your work is committed and pushed.
- Never revert a teammate's or another thread's unsaved work; integrate or isolate it.
- Secrets and account emails never reach files, logs or replies
  (`test/wiki.test.mjs` checks the wiki for the obvious ones).
- `graphify-out/` and the CodeGraph index are derived and stay out of git.

## 8. Learning from the work

After a task that took more than one try, or where Nikita corrected the course:
skill `gm-harness-reflect` → one lesson with evidence in
[`.loops/experience.md`](../.loops/experience.md), or `NO_ENTRY`. The same mistake
twice → a guardrail in [`.loops/guardrails.md`](../.loops/guardrails.md). The `Stop`
hook reminds you.
