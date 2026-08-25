#!/usr/bin/env bash
# lint-shell.sh - shellcheck gate for the repo's shell scripts.
#
# The shell surface (root `aeon`, scripts/**, bin/**, harness-adapter/**, and a
# few skill helpers) is the load-bearing half of every run - the read-only
# sandbox, the harness adapters, the notify path - yet nothing linted it. This
# gates it.
#
# Ratchet floor: it FAILS on error-severity findings only, so it is green on a
# clean tree today. Warning-and-above are printed as an advisory backlog (real
# ones live there - unexpanded `~`, overlapping case patterns) without
# red-walling CI. Tighten `GATE_SEVERITY` to `warning` once that backlog is
# burned down.
#
# Run locally: `bash scripts/lint-shell.sh` (needs shellcheck on PATH; it ships
# preinstalled on GitHub's ubuntu-latest runners).
set -euo pipefail

GATE_SEVERITY="${GATE_SEVERITY:-error}"
ADVISORY_SEVERITY="${ADVISORY_SEVERITY:-warning}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "lint-shell: shellcheck not found on PATH" >&2
  exit 127
fi

# Every git-tracked shell file: a `.sh` name, or an extension-less file whose
# first line is a sh/bash shebang. Vendored trees (node_modules) are excluded by
# listing only tracked files and filtering. Nothing here is generated.
collect_files() {
  # `.sh` names, plus extension-less files whose line 1 is a sh/bash shebang.
  git ls-files '*.sh'
  git ls-files | while IFS= read -r f; do
    case "$f" in
      *.sh) continue ;;
    esac
    [ -f "$f" ] || continue
    first="$(head -1 "$f" 2>/dev/null || true)"
    case "$first" in
      '#!'*sh*) echo "$f" ;;
    esac
  done
}

# Portable array fill (no bash-4 `mapfile`; macOS ships bash 3.2).
FILES=()
while IFS= read -r f; do
  [ -n "$f" ] && FILES+=("$f")
done < <(collect_files | grep -vE '(^|/)node_modules/' | sort -u)

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "lint-shell: no shell files found" >&2
  exit 1
fi

echo "lint-shell: checking ${#FILES[@]} shell files"
echo "shellcheck $(shellcheck --version | awk '/version:/{print $2}')"
echo

# Advisory pass first (never fails the build) so the backlog is visible in logs.
advisory_count="$(shellcheck -x --severity="$ADVISORY_SEVERITY" --format=gcc "${FILES[@]}" 2>/dev/null | grep -cE ':[0-9]+:[0-9]+:' || true)"
if [ "$advisory_count" -gt 0 ]; then
  echo "::group::shellcheck advisory (severity >= $ADVISORY_SEVERITY, non-blocking): $advisory_count"
  shellcheck -x --severity="$ADVISORY_SEVERITY" "${FILES[@]}" || true
  echo "::endgroup::"
  echo
fi

# Gate pass: this one decides the exit code.
echo "shellcheck gate (severity >= $GATE_SEVERITY):"
shellcheck -x --severity="$GATE_SEVERITY" "${FILES[@]}"
echo "lint-shell: OK - no findings at or above '$GATE_SEVERITY'"
