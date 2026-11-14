---
type: concept
created: 2026-08-04
updated: 2026-09-12
sources: [code, log]
---
# Which model answers, and how the question is asked

One place decides the provider, the model and the request shape:
`app/lib/model-client.mjs`. Everything that asks a model goes through
`parseStructured`.

## The tier is a property of the TASK

Named at the call site, never inferred from whichever key happens to be in the
environment.

- **cheap** — the answer is checked by code afterwards, or a bad one is visibly bad and
  costs only a retry. Narration, stop ordering, extraction behind a verbatim-quote gate.
- **careful** — a wrong answer is stored as fact and is expensive or impossible to undo.
  Frame matching writes a location claim; a negative still verdict is cached permanently
  with no invalidation path, so a weak model's mistake hides a real frame for good.

Getting this backwards is not a cost problem, it is a data problem — which is why the
choice does not live in an env var. A careful task with no paid key still runs, but
reports `downgraded: true` rather than pretending it got what it asked for.

## chat/completions, not /responses

Measured against OpenRouter, and the result was the opposite of the obvious reading.

`POST /api/v1/responses` **exists** — so "OpenRouter only speaks Chat Completions" is
wrong. But it returns **HTTP 200 with `status: "completed"` while ignoring
`text.format` entirely**, answering with the model's reasoning prose. A
structured-output request that succeeds and returns unstructured text is the worst
failure available: nothing throws, and the caller sees a parse error far from the cause.

`chat/completions` with `response_format: { type: "json_schema" }` honours the schema,
and **both providers accept that shape** — so there is one code path rather than a
provider abstraction.

## Support is per ENDPOINT, not per model

One provider serving a model advertises structured outputs and another does not, which
is how a schema failure reproduces 40% of the time and never in dev. Every request pins
`provider: { require_parameters: true }`, which refuses an endpoint that cannot do what
was asked instead of quietly downgrading.

The models API is the source of truth: `supported_parameters` must contain
`structured_outputs`, not merely `response_format`. `google/gemma-4-31b-it:free`
advertises the latter and not the former, so a naive capability probe passes while the
schema is silently unenforced.

## Which free model

**A model id in a config file is a claim about somebody else's inventory, and it expires.**
Measured 12.09, the previous default `google/gemma-4-26b-a4b-it:free` answered
`404 No endpoints found that can handle the requested parameters` — it still advertises
`response_format` but no longer `structured_outputs`, and a schema request needs the
latter. Nothing in the repository changed; OpenRouter's catalogue did, and every model
call had been failing as `request_failed` with no clue in the log as to why.

Of the five free models now advertising structured outputs, tested against the REAL
extraction schema on a passage holding two filming locations, two author places and one
fictional one:

| model | result |
|---|---|
| **`liquid/lfm-2.5-2.6b:free`** | **4 of 4**, filming and author told apart, Hogwarts refused |
| `nvidia/nemotron-3-super-120b-a12b:free` | 2 of 4 — missed both author places |
| `dots-studio/dots-3-note-preview:free` | 2 of 4 — missed both author places |
| `nex-agi/nex-n2.5-pro:free` | truncated |

A 2.6B model beating a 120B one is not what anybody would guess, which is the argument for
testing against the real schema rather than a toy one — the lesson the earlier reading of
this same table already recorded and which still holds.

An earlier measurement had `nvidia/nemotron-3-super-120b:free` "returning a shape the SDK
could not read". That is a different model id from the `-a12b` one tested now, and it reads
the schema fine; the catalogue had moved there too.

## Bad answers are outcomes, not crashes

A refusal, a truncation, prose instead of JSON — each is an ordinary result of asking a
weak model, and a batch that dies on the first one abandons every work queued behind it.
`parseStructured` returns `{ ok: false, reason }` rather than throwing.

Two of those needed care:

- **A fenced answer is unwrapped**, because the fence is decoration and the content still
  has to pass the Zod schema unchanged. Measured: gemma answered a short passage
  unwrapped and a 17k-character article inside a fence.
- **JSON cut off mid-string is reported as truncation, not as prose.** Both fail
  `JSON.parse` and they need opposite fixes — a bigger budget versus a better model — and
  a log showing the first 160 characters cannot tell them apart, because valid JSON also
  starts with `{`.

## Limits and cost

Per the docs: **20 requests/minute, 50/day**, rising to 1000/day after $10 of lifetime
credit purchase. The limit is per account; a second key does not help. `createThrottle`
paces at 12/min by default, because the interactive routes share the same bucket.

A demo of 30 people opening five locations each spends roughly a third of a day's quota.
Run batches the night before, not during.

## What cannot move

- **TTS** — OpenRouter has no speech endpoint. `/api/narration` keeps an OpenAI key.
- **Web search** — billed even on a `:free` model, and its result shape differs
  (`url_citation` annotations rather than `web_search_call.action.sources`).
- **Frame matching** — see [[film-frames]]. Asked "does one of these match?", a weak
  model picks one, and returning `null` is what weak models are worst at.

See also: [[wikipedia-enrichment]], [[film-frames]], [[testing-conventions]].
