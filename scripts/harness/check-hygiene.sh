#!/usr/bin/env bash
# Repository hygiene gate: refuse tracked secrets, build artifacts and machine-local state.
#
# Rule: patterns that must never be committed. Each entry is "<gitignore-style regex> <why>".
# A tracked match fails the gate with the exact remediation command.
#
# Usage: bash scripts/harness/check-hygiene.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

FAILED=0

# forbidden <regex> <explanation>
forbidden() {
  local pattern="$1" why="$2"
  local hits
  hits=$(git ls-files | grep -E "$pattern" || true)
  if [ -n "$hits" ]; then
    printf 'HYGIENE FAIL: %s\n' "$why"
    printf '%s\n' "$hits" | sed 's/^/  tracked: /'
    printf '  fix: git rm --cached <file>  (keeps the working copy)\n\n'
    FAILED=1
  fi
}

forbidden '(^|/)\.env$' \
  ".env is tracked; it holds machine-local paths and is a foot-gun for future secrets"
# `.env.sample` is the intentionally committed template, so the pattern must name the
# environment-specific variants explicitly rather than matching `\.env\..*`.
forbidden '(^|/)\.env\.(local|development|production|test|dev|prod)$' \
  "environment-specific env files are tracked"
forbidden '\.timestamp-[0-9]+' \
  "Vite config-loading temp files are tracked"
forbidden 'tailwind-safelist\.txt$' \
  "the generated Tailwind safelist is tracked (108 KB of build output)"
forbidden '(^|/)node_modules/' \
  "node_modules is tracked"
forbidden '(^|/)dist-ui/' \
  "the built UI bundle is tracked"
forbidden '(^|/)target/' \
  "Rust build output is tracked"
forbidden '\.(data|db)$' \
  "a local database file is tracked"
forbidden '(^|/)pastebar_settings\.yaml$' \
  "the runtime-generated user config is tracked; the app writes it into the data directory"

# .env.sample must exist and stay in sync with the keys .env actually uses, so that
# untracking .env does not silently lose the field documentation.
if [ -f .env.sample ]; then
  if [ -f .env ]; then
    missing=""
    while IFS= read -r key; do
      [ -z "$key" ] && continue
      case "$key" in \#*) continue ;; esac
      key="${key%%=*}"
      if ! grep -q "^${key}=" .env.sample 2>/dev/null; then
        missing="$missing $key"
      fi
    done < .env
    if [ -n "$missing" ]; then
      printf 'HYGIENE FAIL: .env contains keys undocumented in .env.sample:%s\n' "$missing"
      printf '  fix: add the key name (no value) to .env.sample\n\n'
      FAILED=1
    fi
  fi
else
  printf 'HYGIENE FAIL: .env.sample is missing; the env contract is undocumented\n\n'
  FAILED=1
fi

if [ "$FAILED" -eq 0 ]; then
  echo "hygiene: OK — no tracked secrets, build artifacts or local state"
fi
exit "$FAILED"
