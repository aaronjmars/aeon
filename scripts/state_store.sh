#!/usr/bin/env bash
# state_store — append-only run state on a GitHub Issue (hardening §3).
#
# Replaces the shared memory/cron-state.json file (rewritten + force-pushed with a
# 5x rebase-retry + auto-conflict-resolver on every run) with conflict-free appends:
# each run posts an immutable comment; canonical state is derived by folding them
# (scripts/state_reduce.py). Concurrent runs never race — comments are independent.
#
# Repo: honors the GH_REPO env var (else gh's current-dir repo).
# Usage:
#   scripts/state_store.sh ensure <title>             -> prints issue number (creates if absent)
#   scripts/state_store.sh append <issue> <json>      -> post one event comment
#   scripts/state_store.sh read   <issue>             -> fold comments -> cron-state JSON (stdout)
#   scripts/state_store.sh materialize <title> <file> -> ensure+read, atomically write the
#                                                        folded projection to <file> (for readers)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ARGS=(); [ -n "${GH_REPO:-}" ] && REPO_ARGS=(--repo "$GH_REPO")

_find_all() {
  local title="${1:?title required}"
  gh issue list "${REPO_ARGS[@]}" --state all --search "\"$title\" in:title" \
    --json number,title --jq "map(select(.title==\"$title\")) | .[].number" 2>/dev/null || true
}

_ensure() {
  local title="${1:?title required}" n
  # Search open OR closed. The ledger deliberately lives *closed* so it never
  # clutters the repo's open-issues list. Commenting on and reading a closed
  # issue still work (only *locking* an issue blocks comments) — so a closed
  # issue is a perfectly good append-only store, just an invisible one.
  n=$(_find_all "$title" | sort -n | head -1)
  if [ -z "$n" ]; then
    local url created_n
    url=$(gh issue create "${REPO_ARGS[@]}" --title "$title" \
          --body "Append-only Aeon state store (hardening §3). Machine-managed; do not edit by hand.")
    created_n=$(printf '%s' "$url" | grep -oE '[0-9]+$')
    # Close it on creation so it stays out of the open-issues view. Appends still
    # land on the closed issue; it never needs to be reopened.
    if [ -n "$created_n" ]; then
      gh issue close "$created_n" "${REPO_ARGS[@]}" >/dev/null 2>&1 || true
    fi
    # Reconcile: the search above and this create are not atomic, so a concurrent
    # _ensure for the same title can create its own issue in the gap. Re-list and
    # converge every caller on the lowest matching issue number — GitHub Issues has
    # no create-if-absent primitive, so a transient duplicate can't be prevented,
    # but every caller from this point on lands on the same canonical issue instead
    # of the ledger permanently forking across two.
    n=$(_find_all "$title" | sort -n | head -1)
    [ -n "$n" ] || n="$created_n"
  fi
  printf '%s' "$n"
}

_append() {
  local n="${1:?issue number required}"; shift
  gh issue comment "$n" "${REPO_ARGS[@]}" --body "$*" >/dev/null
}

_read() {
  local n="${1:?issue number required}"
  gh api "repos/{owner}/{repo}/issues/$n/comments" --paginate --jq '.[].body' 2>/dev/null \
    | python3 "$HERE/state_reduce.py"
}

# Fold the issue's events and write them to a file the readers expect, atomically.
# Returns non-zero (leaving <file> untouched) if the issue can't be resolved or the
# fold yields no valid JSON — callers then fall back to whatever file is committed.
_materialize() {
  local title="${1:?title required}" out="${2:?output path required}" n tmp
  n=$(_ensure "$title") || return 1
  [ -n "$n" ] || return 1
  mkdir -p "$(dirname "$out")"
  tmp="$out.materializing.$$"
  if _read "$n" > "$tmp" 2>/dev/null && jq empty "$tmp" 2>/dev/null; then
    mv "$tmp" "$out"
    echo "state_store: materialized '$title' (issue #$n) -> $out ($(jq 'length' "$out") entries)" >&2
    return 0
  fi
  rm -f "$tmp"
  return 1
}

cmd="${1:-}"; shift || true
case "$cmd" in
  ensure)      _ensure "$@"; echo ;;
  append)      _append "$@" ;;
  read)        _read "$@" ;;
  materialize) _materialize "$@" ;;
  *)
    echo "usage: state_store.sh {ensure <title>|append <issue> <json>|read <issue>|materialize <title> <file>}" >&2
    exit 2 ;;
esac
