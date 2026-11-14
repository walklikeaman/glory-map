# Experience — how we work

Lessons about the **process**, written by the `gm-harness-reflect` skill after a
task. Domain knowledge goes to `wiki/`; the same mistake twice → `guardrails.md`.
Newest on top. A lesson is never deleted: when it goes stale, mark it
`status: superseded by <date/title>` and add the new one.

Format:

```
## Lesson: <short title>
- **domain**: <area | harness>
- **cue**: <the situation in which this applies>
- **lesson**: <what changes in the work, and in which file>
- **evidence**: <thread, commit, PR or file where the difference shows>
- **confidence**: high | medium | low, and why
- **component**: <the file that now carries it>
- status: active
```

---

## Lesson: A check that runs in CI beats a rule in a document
- **domain**: harness
- **cue**: a convention (log order, index coverage, link targets) keeps being broken by parallel threads
- **lesson**: encode it in `test/wiki.test.mjs`, which `npm test` and CI run; the rule text alone did not hold
- **evidence**: on 2026-11-13 the first run of the wiki test found 4 out-of-order log blocks, 2 entries inside the log's "Format:" line, an unindexed page, 5 broken relative links and 4 dangling `[[links]]`, all written under a rule that already said "newest on top"
- **confidence**: high — every defect had a commit from a different thread
- **component**: `test/wiki.test.mjs`
- status: active

## Lesson: A standing permission must name the operation
- **domain**: harness
- **cue**: a nightly routine hits a shared-DB write that the auto-mode classifier blocks
- **lesson**: ask Nikita once for a standing yes that names the exact script, write it in `docs/RULES.md` §3 and in memory, and quote it next time instead of asking again
- **evidence**: 2026-11-03 `promote-verified.mjs` blocked → 2026-11-04 standing yes; 2026-11-05 the TMDB ratings backfill blocked → standing yes ("Да, каждую ночь")
- **confidence**: medium — two cases, same shape
- **component**: `docs/RULES.md` §3.8
- status: active
