---
type: concept
created: 2026-07-22
updated: 2026-07-28
sources: [code, log]
---
# Testing conventions — 559 tests, node:test, zero network

Run: `npm test` (`node --test test/*.test.mjs`). No jest/vitest and no
configuration; assert from node:assert/strict. Next.js is not involved in the tests —
the pure module layer is tested.

## Three levels of isolation

1. Most files — pure functions/Zod schemas with no mocks at all.
2. route-api / narration-api — mutate globals (globalThis.fetch,
   process.env) and MUST restore them via context.after.
3. film-image-api — the `createFilmImageHandler` factory with full injection
   (env, fetchImpl, createOpenAIClient, allowRequest, verifyToken) — globals
   are not touched. The preferred pattern for new routes, and the one every
   route added since follows (`createTrailHandler`, `createSnapHandler`).

## Conventions

- Test names are full invariant phrases ("film image API never falls back to
  a generic backdrop after a matcher error").
- No test hits the network; external responses (SPARQL, TMDB, OSRM, OpenAI)
  are modeled with payloads. Only JSZip and zod actually execute.
- The cross-cutting theme is output safety: host allowlist, canonical id,
  HMAC tokens, rate limit before paid calls, no caching an error as
  no-match ([[film-imagery]]).
- Imports: routes as `.js`, libs as `.mjs` — easy to mix up.

## What a green suite does NOT prove (incident 27.07)

The map was dead in production for every visitor — `SceneMapApp` threw on render
and the error boundary swallowed the whole app — while **453 tests passed and
`next build` compiled cleanly**. Nothing here renders a component, so nothing
noticed.

Three gaps kept it invisible: a build compiles a runtime error happily, the repo
has **no linter at all** (hence `--no-lint` on every build), and minified the
message is an opaque `Cannot access 'tf' before initialization` in a vendor
chunk. Running `next dev` and reading the browser console gave the exact file
and line in seconds — do that first for any client crash.

`test/hook-order.test.mjs` now guards the specific cause: it walks every
`use…()` call to its final argument and fails when a dependency array names a
binding declared further down the file. A dependency array is evaluated **during
render**, at the point its hook call appears, so a hook placed above its own
`useState` throws — and **optional chaining does not protect against a temporal
dead zone**, it rejects touching the binding at all. See [[frontend]].

Still uncovered: that the page renders at all. A smoke test that mounts
`SceneMapApp` is the obvious next guard.

## Gotchas

- `test/fixtures/imdb-ratings.csv` is an orphan, no test reads it
  (CSVs are built inline).
- Expected numbers encode the source rounding exactly (1234 m → 1.2 km) —
  changing the rounding = fixing the tests.
- After `git pull` always `npm install` — new dependencies (openai,
  zod) otherwise crash 3 test files with ERR_MODULE_NOT_FOUND.
