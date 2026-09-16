#!/usr/bin/env bash
# Documentation gate:
#   1. every docs/**.md file is reachable from docs/README.md or AGENTS.md
#   2. every relative markdown link resolves to a file that exists
#   3. every `file.ext:NN` code reference points at a real line in a real file
#   4. "Last verified" dates are not older than the staleness limit
#
# Usage: bash scripts/harness/docs-lint.sh
#        STALE_DAYS=180 bash scripts/harness/docs-lint.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

STALE_DAYS="${STALE_DAYS:-90}"
FAILED=0

fail() { printf 'DOCS FAIL: %s\n' "$1"; FAILED=1; }

# --- collect documentation files --------------------------------------------
DOC_FILES=$(git ls-files '*.md' | grep -vE '^node_modules/|^\.changeset/|^CHANGELOG\.md$' || true)

lintable() { # docs/ and AGENTS.md/CLAUDE.md are the maintained set
  case "$1" in docs/*|AGENTS.md|CLAUDE.md|README.md) return 0 ;; *) return 1 ;; esac
}

# --- 1. reachability ---------------------------------------------------------
# A doc is reachable if its path (or its basename) appears in docs/README.md or AGENTS.md.
for f in $DOC_FILES; do
  lintable "$f" || continue
  [ "$f" = "docs/README.md" ] && continue
  [ "$f" = "AGENTS.md" ] && continue
  base=$(basename "$f")
  if grep -qF "$base" docs/README.md 2>/dev/null || grep -qF "$base" AGENTS.md 2>/dev/null; then
    continue
  fi
  fail "$f is not linked from docs/README.md or AGENTS.md (dead document)"
done

# --- 2. relative link resolution --------------------------------------------
for f in $DOC_FILES; do
  lintable "$f" || continue
  dir=$(dirname "$f")
  # extract markdown link targets
  targets=$(grep -oE '\]\([^)#][^)]*\)' "$f" 2>/dev/null | sed 's/^](//; s/)$//' || true)
  [ -z "$targets" ] && continue
  for t in $targets; do
    case "$t" in
      http://*|https://*|mailto:*|\#*) continue ;;
    esac
    t="${t%%#*}"
    [ -z "$t" ] && continue
    if [ ! -e "$dir/$t" ] && [ ! -e "$t" ]; then
      fail "$f links to '$t' which does not exist"
    fi
  done
done

# --- 3. code reference validity ---------------------------------------------
# Matches `path/to/file.ext:123` inside backticks. Resolution order:
#   1. the literal path, relative to the repository root;
#   2. the path as a suffix of a tracked path (so `services/utils.rs` resolves to
#      `src-tauri/src/services/utils.rs`, which is how these docs are written — the
#      fully-qualified path is noise when the doc is discussing one subtree);
#   3. a bare basename, when exactly one tracked file has it.
# A suffix or basename matching more than one tracked file is reported, because that is a
# genuinely ambiguous reference the reader cannot resolve either.
# Only docs/ is checked: the root README/CHANGELOG reference release assets, not sources.
for f in $DOC_FILES; do
  case "$f" in docs/*) ;; *) continue ;; esac
  refs=$(grep -oE '`[A-Za-z0-9_./-]+\.(rs|ts|tsx|js|mjs|json|toml|yml|yaml|sh|html|mts):[0-9]+' "$f" 2>/dev/null | tr -d '`' || true)
  [ -z "$refs" ] && continue
  for ref in $refs; do
    p="${ref%%:*}"
    line="${ref##*:}"

    if [ -f "$p" ]; then
      resolved="$p"
    else
      esc=$(printf '%s' "$p" | sed 's/[.[*^$\\]/\\&/g')
      hits=$(git ls-files | grep -E "(^|/)${esc}$" || true)
      n=$(printf '%s\n' "$hits" | grep -c . || true)
      if [ "$n" -eq 0 ]; then
        fail "$f references '$p' which matches no tracked file"
        continue
      fi
      if [ "$n" -gt 1 ]; then
        fail "$f references ambiguous path '$p' ($n matches) — qualify it with more of the path"
        continue
      fi
      resolved="$hits"
    fi

    total=$(wc -l < "$resolved")
    if [ "$line" -gt "$total" ]; then
      fail "$f references $p:$line but the file has only $total lines"
    fi
  done
done

# --- 4. staleness ------------------------------------------------------------
# "Last verified: YYYY-MM-DD" is the convention for anything describing external state.
today=$(date +%s)
for f in $DOC_FILES; do
  lintable "$f" || continue
  v=$(grep -oE 'Last verified:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}' "$f" 2>/dev/null | head -1 | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' || true)
  [ -z "$v" ] && continue
  ts=$(date -j -f "%Y-%m-%d" "$v" +%s 2>/dev/null || date -d "$v" +%s 2>/dev/null || echo 0)
  [ "$ts" -eq 0 ] && continue
  age=$(( (today - ts) / 86400 ))
  if [ "$age" -gt "$STALE_DAYS" ]; then
    fail "$f was last verified $age days ago (limit ${STALE_DAYS}d) — re-verify or refresh the date"
  fi
done

if [ "$FAILED" -eq 0 ]; then
  echo "docs-lint: OK"
fi
exit "$FAILED"
