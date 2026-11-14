---
type: concept
created: 2026-11-13
updated: 2026-11-13
sources: [project-memory, project-instructions]
relates_to: [agent-harness, cloud-environment, queue-review]
---
# Autonomous operations — what runs without Nikita

Since 2026-11-03 the project runs on its own. Nikita set the rules; this page is the
map of what they allow. The rules themselves, with dates: [`docs/RULES.md`](../../docs/RULES.md) §3.

## The three daily routines

1. **New feature** — take the top unchecked line in `TASKS.md` (UX queue first),
   build it in its own thread with tests, self-review, check 1440 px and 390 px with
   Playwright, open a PR, merge it when CI is green.
2. **QA of old features** — re-test the demo path and older features on a local prod
   build against the live DB (the production domain is blocked by the cloud proxy).
3. **Data and moderation** — the nightly cycle: rule-based review of the harvest
   queue, AI pre-moderation of reader suggestions, `promote-verified.mjs`, Wikidata
   pin checks, TMDB ratings, and since 2026-11-13 web research of filming locations
   (about 80 works a night at ~$0.06 each).

## Standing yes / still needs a yes

| Allowed without asking | Needs Nikita's yes |
| --- | --- |
| Merging own PRs on green tests | Production DB migrations |
| Publishing AI-verified places nightly | A new kind of bulk write to the shared DB |
| Nightly Wikidata pin fixes, TMDB ratings backfill | A paid run beyond ~$5, or before the 10-item test |
| Preview deploys, branches, test data | Anything destructive or outward-facing |

## Moderation

No person reviews submissions and nobody gets moderation mail. An AI pass leaves
rows `pending`; `verified` is reserved for a person's check; what the AI cannot
settle stays pending with `ai_problems`, visible on `/review`, which stays built
but unused. Details: [[queue-review]].

## Money

The Claude key is Nikita's budget (~$200/month). Guard: ~$5 per run, ~$150 per
month, ten items and a reported price before any bulk run. Measured costs so far:
stills on Haiku ~$0.0016 per film (the whole catalogue for $9.26), web research
~$0.06 per work. Key handling: [[cloud-environment]].
