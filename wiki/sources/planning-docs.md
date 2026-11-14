---
type: source
created: 2026-11-13
updated: 2026-11-13
sources: [TASKS.md, PRIORITIES.md, ROADMAP.md, IDEAS.md, ARCHITECTURE.md, GUIDE.md]
relates_to: [autonomous-operations, agent-harness]
---
# The planning documents — which one answers what

The root of the repo holds six planning files from different moments. They overlap,
and some are partly stale, so this page says which one to trust for what.

| File | Answers | State on 2026-11-13 |
| --- | --- | --- |
| [`TASKS.md`](../../TASKS.md) | What to take next: the queue the daily feature routine works from, top first | Current: UX-10 and UX-11 left in the UX pass, then features, QA findings and "Data coverage" |
| [`PRIORITIES.md`](../../PRIORITIES.md) | Why that order: every open issue ranked P1–P3 | Status block from 25.07; the ranking logic still holds |
| [`ROADMAP.md`](../../ROADMAP.md) | Themes and milestones over time; links to GitHub issues | Status block from 25.07 |
| [`IDEAS.md`](../../IDEAS.md) | The six hackathon ideas GloryMap was picked from | History; new ideas go to "out of scope" in `AGENTS.md` or a GitHub issue |
| [`ARCHITECTURE.md`](../../ARCHITECTURE.md) | The north star: every point backed by a source, three axes, the content graph | Current as design intent |
| [`GUIDE.md`](../../GUIDE.md) | Team onboarding for the July hackathon (install, prompts, roles) | History |

Rules of thumb:

- Work comes from `TASKS.md`; when it runs dry, from `PRIORITIES.md`, then
  `ROADMAP.md`, then `IDEAS.md` (the autonomous-mode order, RULES §3.1).
- After every ship, tick the line in `TASKS.md` and add what is missing.
- `HANDOVER.md` is gitignored on purpose and stale; the living handoff is
  [handoff](../handoff.md).
- `.planning/codebase/` holds seven generated reference documents (stack, structure,
  concerns); treat them as raw material.
