#!/usr/bin/env bash
# PasteBar harness static scan (Phase 1 deliverable).
#
# Purpose: produce a deterministic, re-runnable metric report so that harness
# debt can be compared across commits (baseline -> convergence).
#
# Usage:
#   bash scripts/harness/scan.sh            # human readable report
#   bash scripts/harness/scan.sh --json     # machine readable (stable key order)
#   bash scripts/harness/scan.sh --save     # also write docs/harness/scan-baseline.txt
#
# Portability: works on macOS stock bash 3.2 (no mapfile, no associative arrays).
# Determinism: every metric is a sorted aggregate over git-tracked files only
# (`git ls-files`), never over a working-directory walk, so untracked build
# output cannot shift the numbers.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

JSON=0
SAVE=0
for arg in "$@"; do
  case "$arg" in
    --json) JSON=1 ;;
    --save) SAVE=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# --- source sets -------------------------------------------------------------
# Excluded from all metrics: vendored third-party copies and generated files.
VENDOR_RE='packages/pastebar-app-ui/src/components/libs/|src-tauri/libs/|packages/pastebar-app-ui/tailwind-safelist.txt|\.timestamp-'

LIST=$(mktemp -t pastebar-scan) || exit 1
trap 'rm -f "$LIST"' EXIT

RUST_COUNT=0
TS_COUNT=0

# $LIST holds one "<kind>\t<path>" record per source file.
list_sources() {
  git ls-files 'src-tauri/src/*.rs' 'src-tauri/src/**/*.rs' \
    | grep -Ev "$VENDOR_RE" | sort | while IFS= read -r f; do printf 'rust\t%s\n' "$f"; done
  git ls-files 'packages/pastebar-app-ui/src/*.ts' 'packages/pastebar-app-ui/src/*.tsx' \
    'packages/pastebar-app-ui/src/**/*.ts' 'packages/pastebar-app-ui/src/**/*.tsx' \
    | grep -Ev "$VENDOR_RE" | sort -u | while IFS= read -r f; do printf 'ts\t%s\n' "$f"; done
}
list_sources > "$LIST"

paths_of() { # paths_of <kind>
  grep "^$1	" "$LIST" | cut -f2
}

# --- helpers -----------------------------------------------------------------

# sum_lines <path...> (paths on stdin)
sum_lines() { awk '{print}' | { c=0; while IFS= read -r f; do [ -f "$f" ] || continue; n=$(wc -l < "$f"); c=$((c + n)); done; echo "$c"; }; }

# count_in <pattern>   (paths on stdin -> total matching lines)
count_in() {
  local pattern="$1" total=0 n
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    n=$(grep -E -c -- "$pattern" "$f" 2>/dev/null || true)
    total=$((total + ${n:-0}))
  done
  echo "$total"
}

# files_with <pattern> (paths on stdin -> number of files with >=1 match)
files_with() {
  local pattern="$1" total=0
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    if grep -E -q -- "$pattern" "$f" 2>/dev/null; then total=$((total + 1)); fi
  done
  echo "$total"
}

# over_threshold <n> (paths on stdin -> "lines path" sorted desc)
over_threshold() {
  local n="$1"
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    local l
    l=$(wc -l < "$f")
    if [ "$l" -gt "$n" ]; then printf '%s\t%s\n' "$l" "$f"; fi
  done | sort -rn
}

RUST_PATHS=$(paths_of rust)
TS_PATHS=$(paths_of ts)
ALL_PATHS=$(cut -f2 "$LIST" | sort)

RUST_LINES=$(printf '%s\n' "$RUST_PATHS" | sum_lines)
TS_LINES=$(printf '%s\n' "$TS_PATHS" | sum_lines)
RUST_COUNT=$(printf '%s\n' "$RUST_PATHS" | grep -c . || true)
TS_COUNT=$(printf '%s\n' "$TS_PATHS" | grep -c . || true)

RUST_UNWRAP=$(printf '%s\n' "$RUST_PATHS" | count_in '\.unwrap\(\)|\.expect\(')
RUST_PRINTLN=$(printf '%s\n' "$RUST_PATHS" | count_in 'println!|eprintln!')
RUST_PANIC=$(printf '%s\n' "$RUST_PATHS" | count_in 'panic!\(|unimplemented!\(|todo!\(')
RUST_TESTS=$(printf '%s\n' "$RUST_PATHS" | count_in '#\[cfg\(test\)\]|#\[test\]')
RUST_MAIN_UNWRAP=$(printf 'src-tauri/src/main.rs\n' | count_in '\.unwrap\(\)|\.expect\(')

TS_CONSOLE=$(printf '%s\n' "$TS_PATHS" | count_in 'console\.(log|debug|info|warn|error)\(')
TS_ANY=$(printf '%s\n' "$TS_PATHS" | count_in '(: any\b|<any>|as any\b)')
TS_EMPTY_CATCH=$(printf '%s\n' "$TS_PATHS" | count_in 'catch\s*(\([^)]*\))?\s*\{\s*\}|\.catch\(\(\) => \{\}\)')
TS_SUPPRESS=$(printf '%s\n' "$TS_PATHS" | count_in '@ts-ignore|@ts-expect-error|@ts-nocheck')
TS_TEST_FILES=$(printf '%s\n' "$TS_PATHS" | files_with '\b(describe|it|test)\(')

TODO_ALL=$(printf '%s\n' "$ALL_PATHS" | count_in 'TODO|FIXME|XXX:')

INVOKE_FILES=$(printf '%s\n' "$TS_PATHS" | files_with 'invoke\(')
INVOKE_NAMES=$(printf '%s\n' "$TS_PATHS" | while IFS= read -r f; do
  [ -f "$f" ] || continue
  grep -ohE "invoke(\(\))?(<\s*[^>]*>)?\(\s*'[a-z_0-9]+'" "$f" 2>/dev/null
done | grep -oE "'[a-z_0-9]+'" | tr -d "'" | sort -u | grep -c . || true)
REGISTERED_CMDS=$(awk '/invoke_handler\(tauri::generate_handler!\[/,/\]\)/' src-tauri/src/main.rs \
  | sed 's/^ *//' | grep -vE '^//|generate_handler|^\s*$|\]\)' | sed 's/,$//' \
  | sed 's/.*:://' | sort -u | grep -c . || true)

GIANT_SRC=$(printf '%s\n' "$ALL_PATHS" | over_threshold 1000)
GIANT_SRC_N=$(printf '%s\n' "$GIANT_SRC" | grep -c . || true)
OVER500_N=$(printf '%s\n' "$ALL_PATHS" | over_threshold 500 | grep -c . || true)

HYGIENE_ENV=$(git ls-files | grep -cE '(^|/)\.env$' || true)
HYGIENE_ARTIFACTS=$(git ls-files | grep -cE '\.timestamp-|dist-ui/|node_modules/' || true)
HYGIENE_SAFELIST=$(git ls-files | grep -cE 'tailwind-safelist\.txt' || true)

# --- report ------------------------------------------------------------------
emit() { printf '%s\t%s\n' "$1" "$2"; }

REPORT=$(
  {
    emit rust.files "$RUST_COUNT"
    emit rust.lines "$RUST_LINES"
    emit rust.unwrap_expect "$RUST_UNWRAP"
    emit rust.main_unwrap_expect "$RUST_MAIN_UNWRAP"
    emit rust.println "$RUST_PRINTLN"
    emit rust.panic_macros "$RUST_PANIC"
    emit rust.test_markers "$RUST_TESTS"
    emit ts.files "$TS_COUNT"
    emit ts.lines "$TS_LINES"
    emit ts.console "$TS_CONSOLE"
    emit ts.any "$TS_ANY"
    emit ts.empty_catch "$TS_EMPTY_CATCH"
    emit ts.ts_suppressions "$TS_SUPPRESS"
    emit ts.test_files "$TS_TEST_FILES"
    emit ts.invoke_files "$INVOKE_FILES"
    emit ipc.frontend_invoked_commands "$INVOKE_NAMES"
    emit ipc.backend_registered_commands "$REGISTERED_CMDS"
    emit todo.all "$TODO_ALL"
    emit size.files_over_1000_lines "$GIANT_SRC_N"
    emit size.files_over_500_lines "$OVER500_N"
    emit hygiene.tracked_dotenv "$HYGIENE_ENV"
    emit hygiene.tracked_build_artifacts "$HYGIENE_ARTIFACTS"
    emit hygiene.tracked_safelist "$HYGIENE_SAFELIST"
  } | LC_ALL=C sort
)

if [ "$JSON" -eq 1 ]; then
  echo "{"
  printf '%s\n' "$REPORT" | awk -F'\t' 'BEGIN{n=0} {n++; print (n>1 ? ",\n" : "") "  \"" $1 "\": " $2}'
  echo "}"
else
  printf '%-38s %s\n' "METRIC" "VALUE"
  printf '%s\n' "$REPORT" | awk -F'\t' '{printf "%-38s %s\n", $1, $2}'
  echo
  echo "--- source files over 1000 lines (excl. vendored/generated) ---"
  if [ -n "$GIANT_SRC" ]; then printf '%s\n' "$GIANT_SRC" | awk -F'\t' '{printf "%6s  %s\n", $1, $2}'; else echo "(none)"; fi
fi

if [ "$SAVE" -eq 1 ]; then
  mkdir -p docs/harness
  {
    echo "# Scan baseline"
    echo
    echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Commit: $(git rev-parse --short HEAD)"
    echo
    echo '```'
    bash "$0"
    echo '```'
  } > docs/harness/scan-baseline.txt
  echo >&2 "wrote docs/harness/scan-baseline.txt"
fi
