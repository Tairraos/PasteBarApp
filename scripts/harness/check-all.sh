#!/usr/bin/env bash
# PasteBar harness gate runner — the single local entry point that mirrors CI.
#
# Usage:
#   bash scripts/harness/check-all.sh            # run every gate
#   bash scripts/harness/check-all.sh --fast     # skip the slow Rust gates (cargo fmt/clippy)
#   bash scripts/harness/check-all.sh --list     # show gate names only
#
# Exit code is 0 only when every gate passes. Each gate prints:
#   [PASS] name   (or [FAIL] / [SKIP]) plus the elapsed seconds.
#
# Portability: macOS stock bash 3.2 (no mapfile/associative arrays).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

FAST=0
LIST_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    --list) LIST_ONLY=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# npm on this machine picks up a global ~/.npmrc that breaks the nested install of the
# two GitHub dependencies; --userconfig /dev/null neutralises it. CI is unaffected.
NPM_CI_ARGS="--no-audit --no-fund --ignore-scripts --userconfig /dev/null"

FAILED=""
PASSED=0
SKIPPED=0
FAILED_NAMES=""

run_gate() { # run_gate <name> <command...>
  local name="$1"; shift
  if [ "$LIST_ONLY" -eq 1 ]; then echo "$name"; return 0; fi
  printf '\n=== %s ===\n' "$name"
  local start end
  start=$(date +%s)
  if "$@"; then
    end=$(date +%s)
    printf '[PASS] %s (%ss)\n' "$name" "$((end - start))"
    PASSED=$((PASSED + 1))
  else
    end=$(date +%s)
    printf '[FAIL] %s (%ss)\n' "$name" "$((end - start))"
    FAILED="yes"
    FAILED_NAMES="$FAILED_NAMES $name"
  fi
}

skip_gate() { # skip_gate <name> <reason>
  if [ "$LIST_ONLY" -eq 1 ]; then echo "$1"; return 0; fi
  printf '[SKIP] %s — %s\n' "$1" "$2"
  SKIPPED=$((SKIPPED + 1))
}

need_tool() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# Gate 1 — repository hygiene (no tracked secrets or build artifacts)
# ---------------------------------------------------------------------------
gate_hygiene() {
  bash scripts/harness/check-hygiene.sh
}

# ---------------------------------------------------------------------------
# Gate 2 — static metrics (informational, but must run without error)
# ---------------------------------------------------------------------------
gate_scan() {
  bash scripts/harness/scan.sh > /dev/null
}

# ---------------------------------------------------------------------------
# Gate 2b — dead-code reachability
# ---------------------------------------------------------------------------
gate_reachable() {
  # W4a deleted 186 files that no entry could reach, and the dependency prune that followed
  # depended on knowing which files were reachable. Without a gate, dead code accretes again
  # — and the second time it will be harder to spot, because the obvious symptom (unused
  # dependencies) was just cleaned up.
  #
  # The scan treats test files as entry points (vitest discovers them by glob, so nothing
  # imports them). That was a real footgun: reported as "dead", a future wave would delete
  # the test suite. See TEST_ROOTS in scripts/harness/reachability.mjs.
  node scripts/harness/reachability.mjs --check
}

# ---------------------------------------------------------------------------
# Gate 2c — backend layering (commands -> services -> models/db)
# ---------------------------------------------------------------------------
gate_layering() {
  # ISSUE-017: the rule existed in AGENTS.md and nothing enforced it. Writing it down is not
  # enforcement, and this repository is worked on by agents by design — so a rule with no
  # check is a rule that survives until the first change made in a hurry.
  #
  # The first run found a real cycle: `db.rs` imported `services` in two places
  # (`load_user_config`, `debug_output`), while `services` imported `db::get_config_file_path`
  # in the other direction. Rust allows module cycles, so it compiled — the compiler was
  # never going to report this. Both were resolved by moving the code down.
  node scripts/harness/check-layering.mjs
}

# ---------------------------------------------------------------------------
# Gate 3 — IPC drift
# ---------------------------------------------------------------------------
gate_ipc() {
  if ! need_tool node; then return 1; fi
  node scripts/harness/gen-ipc-contract.mjs --check
}

# ---------------------------------------------------------------------------
# Gate 4 — docs link/staleness lint
# ---------------------------------------------------------------------------
gate_docs() {
  bash scripts/harness/docs-lint.sh
}

# ---------------------------------------------------------------------------
# Gate 4b — ISSUE ids and their file:line references
# ---------------------------------------------------------------------------
gate_issue_refs() {
  # A `file:line` reference in ISSUES.md that can no longer be followed is worse than no
  # reference: the reader lands in unrelated code and believes it. Re-verifying 30 of them
  # by hand on every commit does not happen, so it is checked mechanically. The same script
  # also rejects duplicate ISSUE-IDs, which would make a commit message citing one ambiguous.
  node scripts/harness/check-issue-refs.mjs
}

# ---------------------------------------------------------------------------
# Gate 5 — TypeScript type check (ratchet)
# ---------------------------------------------------------------------------
gate_typecheck() {
  if [ ! -d node_modules/typescript ]; then
    echo "typescript not installed; run: npm ci $NPM_CI_ARGS" >&2
    return 1
  fi
  # Ratchet (was ADVISORY — DECISIONS D-005's exit condition is met). The dependency prune
  # removed the hoisted transitive packages the vendored cypress tests silently resolved,
  # which forced them out of the tsconfig; project code now compiles clean and the 9
  # remaining errors are all vendored (R7). New errors in project code fail the PR.
  if [ "${HARNESS_TYPECHECK_STRICT:-0}" = "1" ]; then
    node scripts/harness/typecheck-ratchet.mjs --strict
  else
    node scripts/harness/typecheck-ratchet.mjs
  fi
}

# ---------------------------------------------------------------------------
# Gate 6 — ESLint, enforced through the per-file ratchet baseline
# ---------------------------------------------------------------------------
gate_lint() {
  if [ ! -d node_modules/eslint ]; then
    echo "eslint not installed; run: npm ci $NPM_CI_ARGS" >&2
    return 1
  fi
  mkdir -p node_modules/.cache
  # Fails on regressions against docs/harness/eslint-baseline.json rather than on every
  # pre-existing error, so the gate is enforceable today and tightens as the debt is paid.
  node scripts/harness/lint-ratchet.mjs
}

# ---------------------------------------------------------------------------
# Gate 7 — formatting
# ---------------------------------------------------------------------------
gate_format() {
  local rc=0
  # .prettierignore (not .gitignore) is the formatting scope: it excludes vendored code,
  # lockfiles and generated assets that Prettier must not touch.
  npx --no-install prettier --check . --ignore-path .prettierignore || rc=1
  if [ "$FAST" -eq 0 ] && need_tool cargo; then
    # Delegated to its own script so CI runs the identical command. See that file for why
    # `cargo fmt --check` cannot be used directly (vendored libs + generated schema.rs).
    bash scripts/harness/check-rustfmt.sh || rc=1
  fi
  return $rc
}

# ---------------------------------------------------------------------------
# Gate 7b — dependency advisory ratchet
# ---------------------------------------------------------------------------
gate_audit() {
  # Fails when the production advisory count GROWS past docs/harness/audit-baseline.json.
  # Pre-existing advisories (ISSUE-032: 51, of which 30 high) do not block a PR, but a new
  # one does. Requires network; skipped under --fast, and CI runs it on a schedule with
  # --strict so the debt stays visible.
  node scripts/harness/audit-ratchet.mjs
}

# ---------------------------------------------------------------------------
# Gate 8 — Rust clippy
# ---------------------------------------------------------------------------
gate_clippy() {
  # `cargo clippy -- -D warnings` is not enforceable yet: this crate emits ~650 warnings,
  # most of them rustc lints or dependency noise. The ratchet counts only `clippy::*`
  # lints in our own targets and fails when that count grows past
  # docs/harness/clippy-baseline.json. See docs/harness/gates.md section 8.
  node scripts/harness/clippy-ratchet.mjs
}

# ---------------------------------------------------------------------------
# Gate 9 — tests
# ---------------------------------------------------------------------------
gate_test_js() {
  # Runs vitest and enforces the coverage ratchet in docs/harness/coverage-baseline.json.
  # A missing vitest install is a hard failure rather than a skip: the gate silently
  # passing on an uninstalled tool is how a "green" build ends up testing nothing.
  bash scripts/harness/run-tests.sh --coverage
}


gate_test_rust() {
  (cd src-tauri && cargo test)
}

# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------
run_gate "hygiene"        gate_hygiene
run_gate "scan"           gate_scan
run_gate "reachable"      gate_reachable
run_gate "layering"       gate_layering
run_gate "ipc-drift"      gate_ipc
run_gate "docs-lint"      gate_docs
run_gate "issue-refs"     gate_issue_refs
run_gate "typecheck"      gate_typecheck
run_gate "lint"           gate_lint
run_gate "format"         gate_format
if [ "$FAST" -eq 1 ]; then
  skip_gate "audit" "--fast (network)"
  skip_gate "clippy" "--fast"
  skip_gate "test-rust" "--fast"
else
  run_gate "audit"        gate_audit
  run_gate "clippy"       gate_clippy
  run_gate "test-rust"    gate_test_rust
fi
run_gate "test-js"        gate_test_js

if [ "$LIST_ONLY" -eq 1 ]; then exit 0; fi

printf '\n========================================\n'
if [ -n "$FAILED" ]; then
  printf 'FAILED:%s\n' "$FAILED_NAMES"
  printf '%s passed, %s skipped\n' "$PASSED" "$SKIPPED"
  exit 1
fi
printf 'ALL GATES PASSED (%s passed, %s skipped)\n' "$PASSED" "$SKIPPED"
