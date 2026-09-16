#!/usr/bin/env bash
# Frontend test runner.
#
# Until Phase 5 lands there is no test suite (ISSUE-006), so this script reports that
# clearly and exits 0 rather than failing every `npm test` invocation. The moment a
# `*.test.ts(x)` file exists it runs vitest and its failures are real.
#
# Usage: bash scripts/harness/run-tests.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [ -z "$(git ls-files 'packages/pastebar-app-ui/src/**/*.test.ts' 'packages/pastebar-app-ui/src/**/*.test.tsx' | head -1)" ]; then
  cat <<'EOF'
No frontend tests exist yet.

  Phase 5 of the harness plan builds the suite (vitest + @testing-library/react + jsdom,
  driven by the in-memory fake Tauri backend). Until then, verification relies on:

    1. bash scripts/harness/check-all.sh     # static gates
    2. docs/harness/smoke-checklist.md       # manual flows

  This is tracked as ISSUE-006 in docs/harness/ISSUES.md.
EOF
  exit 0
fi

if [ ! -d node_modules/vitest ] && [ ! -d packages/pastebar-app-ui/node_modules/vitest ]; then
  echo "ERROR: test files exist but vitest is not installed." >&2
  echo "       run: npm ci --no-audit --no-fund" >&2
  exit 1
fi

npx --no-install vitest run "$@"
