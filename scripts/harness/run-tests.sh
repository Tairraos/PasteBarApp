#!/usr/bin/env bash
# Frontend test runner and coverage ratchet.
#
# Usage:
#   bash scripts/harness/run-tests.sh                    # run tests
#   bash scripts/harness/run-tests.sh --coverage         # tests + coverage ratchet
#   bash scripts/harness/run-tests.sh --update-coverage  # rewrite the coverage baseline
#
# The ratchet exists so that coverage can start low without staying low: it is enforced as
# "may only go up", the same shape as the lint and clippy baselines (GOLDEN-RULES R9).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/packages/pastebar-app-ui" || exit 1

ARGS=()
WANT_COVERAGE=0
UPDATE_COVERAGE=0
for a in "$@"; do
  case "$a" in
    --coverage) WANT_COVERAGE=1 ;;
    --update-coverage) WANT_COVERAGE=1; UPDATE_COVERAGE=1 ;;
    *) ARGS+=("$a") ;;
  esac
done

if [ ! -d "$ROOT/packages/pastebar-app-ui/node_modules/vitest" ] && [ ! -d "$ROOT/node_modules/vitest" ]; then
  echo "ERROR: vitest is not installed." >&2
  echo "       run: npm ci --no-audit --no-fund" >&2
  exit 1
fi

SUMMARY="$ROOT/packages/pastebar-app-ui/coverage/coverage-summary.json"
BASELINE="$ROOT/docs/harness/coverage-baseline.json"

if [ "$WANT_COVERAGE" -eq 0 ]; then
  npx --no-install vitest run --reporter=dot ${ARGS+"${ARGS[@]}"}
  exit $?
fi

npx --no-install vitest run --coverage --reporter=dot ${ARGS+"${ARGS[@]}"} || exit 1

if [ ! -f "$SUMMARY" ]; then
  echo "run-tests: coverage summary not produced at $SUMMARY" >&2
  exit 1
fi

if [ "$UPDATE_COVERAGE" -eq 1 ]; then
  node -e '
    const s = require(process.argv[1]).total
    const out = {
      $comment:
        "Coverage ratchet. Percentages may only go UP (docs/harness/GOLDEN-RULES.md R9). " +
        "Scope: src/lib, src/store, src/hooks — the logic layers, not components. " +
        "Regenerate: bash scripts/harness/run-tests.sh --update-coverage",
      lines: s.lines.pct,
      statements: s.statements.pct,
      functions: s.functions.pct,
      branches: s.branches.pct,
    }
    require("fs").writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + "\n")
    console.log("coverage baseline written:", JSON.stringify(out))
  ' "$SUMMARY" "$BASELINE"
  exit $?
fi

if [ ! -f "$BASELINE" ]; then
  echo "run-tests: no coverage baseline at docs/harness/coverage-baseline.json" >&2
  echo "           create one with: bash scripts/harness/run-tests.sh --update-coverage" >&2
  exit 1
fi

node -e '
  const now = require(process.argv[1]).total
  const base = require(process.argv[2])
  const metrics = ["lines", "statements", "functions", "branches"]
  const dropped = metrics.filter(m => now[m].pct < base[m])
  for (const m of metrics) {
    const mark = now[m].pct < base[m] ? "DOWN" : now[m].pct > base[m] ? "up  " : "same"
    console.log(`  ${mark}  ${m.padEnd(11)} ${String(now[m].pct).padStart(6)}%  (baseline ${base[m]}%)`)
  }
  if (dropped.length) {
    console.error("\nCOVERAGE RATCHET FAILED: " + dropped.join(", ") + " fell below the baseline.")
    console.error("Add tests for the code you changed. If you deliberately removed tests, say so")
    console.error("in the PR description and update the baseline in its own commit.")
    process.exit(1)
  }
  console.log("\ncoverage-ratchet: OK")
' "$SUMMARY" "$BASELINE"
