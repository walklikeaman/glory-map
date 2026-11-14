---
type: concept
created: 2026-11-13
updated: 2026-11-13
sources: [project-memory]
relates_to: [agent-harness, autonomous-operations, supabase, external-services]
confidence: medium
staleness_window: 30d
---
# The cloud environment — what reaches what

Claude project threads run in a fresh cloud container. The environment is set up in
claude.ai, not in the repo, and only new sessions pick up changes to it.

## Network

- The default network reaches only package registries. Nikita's environment adds a
  limited allowlist: the Supabase project (`quvxxqxowathrcyshhwj`), TMDB api and
  image hosts, Wikidata, he.wikipedia.org and, since 2026-11-13, Nominatim.
- Still blocked: the production domain (`glory-map.vercel.app`, 403 from the proxy),
  `tiles.openfreemap.org`, letterboxd.com, en.wikipedia.org at times (429/403).
- `curl` goes through the proxy by itself; Node's `fetch` needs
  `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`.

## Secrets

The environment holds `SUPABASE_SERVICE_ROLE_KEY`, `TMDB_API_READ_ACCESS_TOKEN` and
the Claude key as `GLORYMAP_ANTHROPIC_KEY`. The platform reserves
`ANTHROPIC_API_KEY` and hands it over empty, and it also sets `ANTHROPIC_BASE_URL`
for Claude Code itself, so paid scripts run as
`env -u ANTHROPIC_BASE_URL ANTHROPIC_API_KEY="$GLORYMAP_ANTHROPIC_KEY" …`. On Vercel
the name stays `ANTHROPIC_API_KEY`. Never print any of them.

## Database

Writes go through Supabase REST with the service key, after a snapshot to
`/mnt/project-files/`. The Supabase MCP works for reads and SQL, but its
confirmation dialog for `drop` never reaches Nikita (see `.loops/guardrails.md`).
There is no `locations` table any more; the harvest queue is `location_submissions`,
reader suggestions are `reader_place_suggestions`. More: [[supabase]].

## Browser checks

Playwright is preinstalled globally. Block service workers in the context (the app's
OfflineReady worker bypasses `page.route`), click "Skip" on onboarding, and route
`openfreemap.org` to a minimal style so pins draw. Run a local prod build
(`npm run build && npm run start`) against the live DB.
