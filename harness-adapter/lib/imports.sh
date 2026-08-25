# shellcheck shell=bash
# imports.sh — expand Claude Code's `@file` imports in CLAUDE.md.
#
# Only Claude Code expands @imports; every other harness loads instruction files
# verbatim. So for non-claude harnesses we pre-expand imports into a merged file
# (the generalization of aeon's gen-agents-md.js "carry the delta" trick).
#
# Supported: whole-line imports (`@STRATEGY.md` on its own line), relative /
# absolute / ~ paths, extension-less (`@README` -> README.md), up to 4 hops.
# Not supported (documented limitation): inline mid-sentence imports.
# Imports inside fenced code blocks are skipped, matching Claude's parser.

expand_imports() {
  # expand_imports FILE [depth] -> expanded text on stdout
  local file="$1" depth="${2:-0}" line target dir in_fence=0
  [ -f "$file" ] || return 0
  if [ "$depth" -ge 4 ]; then cat "$file"; return 0; fi
  dir="$(cd "$(dirname "$file")" && pwd)"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '```'*) in_fence=$((1 - in_fence)) ;; esac
    if [ "$in_fence" -eq 0 ] && [[ "$line" =~ ^@([^[:space:]]+)[[:space:]]*$ ]]; then
      target="${BASH_REMATCH[1]}"
      case "$target" in
        "~/"*) target="$HOME/${target#\~/}" ;;
        /*) ;;
        *) target="$dir/$target" ;;
      esac
      if [ -f "$target" ]; then
        expand_imports "$target" $((depth + 1))
      elif [ -f "$target.md" ]; then
        expand_imports "$target.md" $((depth + 1))
      else
        printf '%s\n' "$line"   # unresolvable import stays literal
      fi
    else
      printf '%s\n' "$line"
    fi
  done < "$file"
}

expand_claude_md() {
  # expand_claude_md OUTFILE — if ./CLAUDE.md has imports, write the expanded
  # merge to OUTFILE and print its path; print nothing if there is no work.
  local out="$1"
  [ -f CLAUDE.md ] || return 0
  if grep -qE '^@[^[:space:]]+[[:space:]]*$' CLAUDE.md; then
    expand_imports CLAUDE.md > "$out"
    printf '%s\n' "$out"
  fi
}
