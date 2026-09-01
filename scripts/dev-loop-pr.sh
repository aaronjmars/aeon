#!/usr/bin/env bash
# Deterministic handoff checks for the dev-loop chain.
# Feature output is not proof that it opened a PR. Compare GitHub's open-PR state
# before and after the run before asking pr-review to comment on anything.
set -euo pipefail

usage() {
  echo "usage: $0 validate-target <external:owner/repo[#issue]> | snapshot <target> | verify-new-pr <target> <before-file> <dispatch-id>" >&2
  exit 64
}

target_repo() {
  local target="${1:-}"
  if [[ ! "$target" =~ ^external:([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)(#[1-9][0-9]*)?$ ]]; then
    echo "dev-loop: target must be external:owner/repo or external:owner/repo#issue" >&2
    return 2
  fi
  printf '%s/%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
}

case "${1:-}" in
  validate-target)
    [ "$#" -eq 2 ] || usage
    target_repo "$2"
    ;;
  snapshot)
    [ "$#" -eq 2 ] || usage
    repo=$(target_repo "$2") || exit $?
    gh pr list -R "$repo" --state open --limit 100 --json number --jq '.[].number' | sort -n
    ;;
  verify-new-pr)
    [ "$#" -eq 4 ] || usage
    repo=$(target_repo "$2") || exit $?
    before="$3"
    dispatch_id="$4"
    [ -f "$before" ] || { echo "dev-loop: pre-feature PR snapshot is missing: $before" >&2; exit 1; }
    [[ "$dispatch_id" =~ ^chain-[0-9a-f]{32}$ ]] || { echo "dev-loop: invalid feature dispatch ID" >&2; exit 1; }
    attempts="${DEV_LOOP_PR_VERIFY_ATTEMPTS:-3}"
    backoff="${DEV_LOOP_PR_VERIFY_BACKOFF:-2}"
    actor=$(gh api user --jq .login)
    [ -n "$actor" ] || { echo "dev-loop: could not determine the feature actor" >&2; exit 1; }
    for attempt in $(seq 1 "$attempts"); do
      after=$(mktemp)
      gh pr list -R "$repo" --state open --limit 100 --json number,author,body > "$after"
      actor_prs=$(jq -r --arg actor "$actor" --arg marker "<!-- aeon-dispatch:$dispatch_id -->" --rawfile before "$before" '
        ($before | split("\n") | map(select(length > 0) | tonumber)) as $old |
        .[] |
        select(
          (.number as $n | ($old | index($n)) == null) and
          .author.login == $actor and
          ((.body // "") | contains($marker))
        ) |
        .number
      ' "$after")
      actor_pr_count=$(printf '%s\n' "$actor_prs" | sed '/^$/d' | wc -l | tr -d ' ')
      if [ "$actor_pr_count" -eq 1 ]; then
        printf '%s#%s\n' "$repo" "$actor_prs"
        exit 0
      fi
      if [ "$actor_pr_count" -gt 1 ]; then
        echo "dev-loop: $actor_pr_count new PRs were opened by feature actor $actor; refusing ambiguous review handoff" >&2
        exit 1
      fi
      [ "$attempt" -lt "$attempts" ] && sleep "$backoff"
    done
    echo "dev-loop: feature created no new open PR; review will be skipped" >&2
    exit 3
    ;;
  *) usage ;;
esac
