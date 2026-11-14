#!/usr/bin/env bash
# Local pass over GloryMap knowledge: wiki, log, docs, loops, plans, shared project files, graph report.
# Usage: search.sh 'term1|term2'
set -uo pipefail
TERMS="${1:?usage: search.sh 'term1|term2'}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
GREP="grep -E -i -n"
command -v rg >/dev/null 2>&1 && GREP="rg -i -n"
echo "== wiki/index.md"; $GREP "$TERMS" wiki/index.md 2>/dev/null | head -20
echo "== pages"; grep -E -i -l -r "$TERMS" wiki docs .planning/codebase AGENTS.md CLAUDE.md ARCHITECTURE.md 2>/dev/null | grep -v '^wiki/log.md$' | head -30
echo "== wiki/log.md (headings)"; grep -E -n "^## \[" wiki/log.md 2>/dev/null | grep -E -i "$TERMS" | head -15
echo "== .loops"; grep -E -i -n -r "$TERMS" .loops 2>/dev/null | head -10
echo "== plans"; grep -E -i -n "$TERMS" TASKS.md ROADMAP.md PRIORITIES.md IDEAS.md 2>/dev/null | head -15
if [ -d /mnt/project-files ]; then
  echo "== /mnt/project-files (md, csv, json)"
  find /mnt/project-files/ -maxdepth 4 \( -name '*.md' -o -name '*.csv' -o -name '*.json' \) -size -2M -print0 2>/dev/null \
    | xargs -0 grep -E -i -l "$TERMS" 2>/dev/null | head -20
fi
if [ -f graphify-out/GRAPH_REPORT.md ]; then
  echo "== graphify-out/GRAPH_REPORT.md"; $GREP "$TERMS" graphify-out/GRAPH_REPORT.md | head -10
fi
