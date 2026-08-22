#!/usr/bin/env bash
# health_issue — per-skill votable health thread on GitHub Issues (hardening §7).
#
# One Issue per skill. The agent comments ONLY on a regression (see health_triage.py);
# humans 👍/👎 the Issue to set repair priority, which self-improve/skill-repair read.
# Moves the existing memory/issues/ tracker onto visible, votable, conflict-free Issues.
#
# Honors GH_REPO. Usage:
#   health_issue.sh ensure  <skill>            -> issue number (creates if absent)
#   health_issue.sh comment <issue> <body>     -> post a regression comment
#   health_issue.sh votes   <issue>            -> net 👍-👎 on the issue (for priority)
set -euo pipefail
REPO_ARGS=(); [ -n "${GH_REPO:-}" ] && REPO_ARGS=(--repo "$GH_REPO")

cmd="${1:-}"; shift || true
case "$cmd" in
  ensure)
    skill="${1:?skill required}"; title="health: $skill"
    find_all() {
      gh issue list "${REPO_ARGS[@]}" --state open --search "\"$title\" in:title" \
        --json number,title --jq "map(select(.title==\"$title\")) | .[].number" 2>/dev/null || true
    }
    n=$(find_all | sort -n | head -1)
    if [ -z "$n" ]; then
      url=$(gh issue create "${REPO_ARGS[@]}" --title "$title" \
            --body "Health thread for \`$skill\` (hardening §7). The agent comments here on a regression; 👍/👎 this issue to set repair priority. Machine-managed.")
      created_n=$(printf '%s' "$url" | grep -oE '[0-9]+$')
      # Reconcile: the search above and this create are not atomic, so a concurrent
      # `ensure` for the same skill can create its own issue in the gap — splitting
      # the 👍/👎 repair-priority signal across two threads. Re-list and converge
      # every caller on the lowest matching issue; if ours lost, close it as a
      # duplicate so votes/comments only ever land on the canonical one.
      n=$(find_all | sort -n | head -1)
      if [ -z "$n" ]; then
        n="$created_n"
      elif [ -n "$created_n" ] && [ "$n" != "$created_n" ]; then
        gh issue close "$created_n" "${REPO_ARGS[@]}" --reason duplicate --duplicate-of "$n" >/dev/null 2>&1 || true
      fi
    fi
    echo "$n" ;;
  comment)
    n="${1:?issue number required}"; shift
    gh issue comment "$n" "${REPO_ARGS[@]}" --body "$*" >/dev/null ;;
  votes)
    n="${1:?issue number required}"
    gh api "repos/{owner}/{repo}/issues/$n/reactions" \
      --jq '[.[].content] | (map(select(.=="+1")) | length) - (map(select(.=="-1")) | length)' \
      2>/dev/null || echo 0 ;;
  *)
    echo "usage: health_issue.sh {ensure <skill>|comment <issue> <body>|votes <issue>}" >&2
    exit 2 ;;
esac
