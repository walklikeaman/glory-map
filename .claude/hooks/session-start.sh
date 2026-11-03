#!/usr/bin/env bash
# SessionStart hook for Claude Code cloud sessions (claude.ai/code, Projects).
# A fresh container has the checkout but no node_modules and no .env.local,
# so `npm test` / `npm run build` would fail before doing anything useful.
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# Same seeding scaffold.sh does: the public Supabase URL + anon key, never overwrite.
[ -f .env.local ] || cp .env.example .env.local

# npm ci only when the lockfile changed since the last install in this container.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund --loglevel=error
fi
