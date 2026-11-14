---
type: concept
created: 2026-09-11
updated: 2026-09-12
sources: [code, log]
---
# The demo library — a real export, locally, never committed

`scripts/seed-demo-library.mjs` + a dev-only effect in `SceneMapApp`. Related:
[[personal-library]].

## Why it exists

The map's most interesting behaviour — *only my films*, *my rating 8/10 and up*, the film
list for a viewport — is invisible without a library, and importing a 2,798-film export by
hand before every test is the kind of friction that stops a feature being tested at all.

## The two guards, and why each is there

**It never runs in production.** `process.env.NODE_ENV === "production"` returns
immediately, so no deploy can ship somebody's watch history to a stranger's browser.

**It never overwrites a real import.** It seeds only when storage is empty, so a reader who
imported their own list keeps it.

## And it is gitignored, which is the point

A watch history is personal — 2,798 films, dated, rated — and **this repository is public**.
`public/demo-library.json` is generated on the machine that needs it and committed nowhere.
Anybody else who wants the demo runs the script against their own export:

```bash
node scripts/seed-demo-library.mjs ~/Downloads/imdb-ratings.csv       # IMDb
node scripts/seed-demo-library.mjs ~/Downloads/letterboxd-you.zip     # Letterboxd
```

**Three shapes, because the two services hand you different things.** Letterboxd gives a ZIP
of several CSVs, of which watched.csv and ratings.csv matter; IMDb gives one CSV per list,
and the ratings list is the one worth seeding because every row in it carries an opinion.

The service is read off the **header**, not the filename — an IMDb export downloads as a
bare UUID (`6b860a10-….csv`), so there is nothing in the name to read. An IMDb export leads
with a `Const` column and a Letterboxd one carries `Letterboxd URI`; anything else is
refused rather than guessed at, because guessing wrong does not throw — it puts every rating
on the wrong scale ([[personal-library]]).

The script uses **the same parser and the same merge the browser importer uses**
(`parseMediaCsv`, `mergeLibraries`). A demo built by a different code path would test
something no reader ever runs.

## The bug it produced on the way in

The seeding effect was first placed above the `useState` that declares `library`, and the
whole component died with *"Cannot access 'library' before initialization"* — caught by the
error boundary, so the page rendered with no panel at all and the symptom looked like the
seed silently failing. The file has a comment about this exact hazard from a previous
occurrence (`activeLocation?.now` above its own `useState`). Twice now.
