#!/usr/bin/env bash
# Tests for scripts/health_issue.sh.
# Run: bash scripts/tests/test_health_issue.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

fail=0; pass(){ echo "ok   - $1"; }; bad(){ echo "FAIL - $1"; fail=1; }
H="scripts/health_issue.sh"

# --- offline: the `ensure` search-then-create race, and that it converges ---
# Same fake-gh approach as scripts/tests/test_state_store.sh: a real file backs
# the issue store so mutations are visible across the separate `bash "$H"`
# child processes each `ensure` call spawns (see that file's header comment
# for why an env-var-only fake wouldn't work here). Store lines are
# tab-delimited ("num\ttitle\tstate") -- this script's own title format is
# literally "health: <skill>", so a colon delimiter would misparse it.
GH_FAKE_LIB="$(mktemp)"
cat > "$GH_FAKE_LIB" <<'FAKEGH'
gh() {
  local args=("$@") i jqexpr="" state="" title=""
  for ((i = 0; i < ${#args[@]}; i++)); do
    case "${args[$i]}" in
      --jq)    jqexpr="${args[$((i + 1))]}" ;;
      --state) state="${args[$((i + 1))]}" ;;
      --title) title="${args[$((i + 1))]}" ;;
    esac
  done
  case "${args[0]:-} ${args[1]:-}" in
    "issue list")
      local calls=0
      [ -f "$STORE.calls" ] && calls=$(cat "$STORE.calls")
      calls=$((calls + 1)); echo "$calls" > "$STORE.calls"
      if [ "$calls" -le "${STALE_UNTIL:-0}" ]; then
        printf '[]' | jq -r "$jqexpr"; return 0
      fi
      { echo '['
        local first=1 num t st
        while IFS=$'\t' read -r num t st; do
          [ -z "${num:-}" ] && continue
          [ "$state" = "open" ] && [ "$st" != "open" ] && continue
          [ "$first" = 1 ] || echo ','; first=0
          printf '{"number":%s,"title":%s}' "$num" "$(printf '%s' "$t" | jq -R .)"
        done < "$STORE"
        echo ']'
      } | jq -r "$jqexpr"
      ;;
    "issue create")
      local n=1
      [ -s "$STORE" ] && n=$(( $(cut -f1 "$STORE" | sort -n | tail -1) + 1 ))
      printf '%s\t%s\topen\n' "$n" "$title" >> "$STORE"
      echo "https://github.com/fake/fake/issues/$n"
      ;;
    "issue close")
      local n="${args[2]}" tmp="$STORE.tmp"
      awk -F'\t' -v n="$n" 'BEGIN{OFS="\t"} $1==n{$3="closed"} {print}' "$STORE" > "$tmp" && mv "$tmp" "$STORE"
      return 0
      ;;
    *) return 0 ;;
  esac
}
export -f gh
FAKEGH

ORIG_H="$(mktemp)"
git show upstream/main:scripts/health_issue.sh > "$ORIG_H" 2>/dev/null

run_two_ensures() {
  local script="$1" stale_until="$2"
  local store; store="$(mktemp -u)"; : > "$store"
  ( export GH_REPO="fake/fake" STORE="$store" STALE_UNTIL="$stale_until"
    source "$GH_FAKE_LIB"
    A=$(bash "$script" ensure "zz-health-race-test")
    B=$(bash "$script" ensure "zz-health-race-test")
    echo "$A $B"
  )
  rm -f "$store" "$store.calls"
}

RESULT=$(run_two_ensures "$ORIG_H" 2)
A_N=$(echo "$RESULT" | cut -d' ' -f1); B_N=$(echo "$RESULT" | cut -d' ' -f2)
if [ -n "$A_N" ] && [ -n "$B_N" ] && [ "$A_N" != "$B_N" ]; then
  pass "reproduced on the actual pre-fix code: two racing ensures fork the health thread (#$A_N vs #$B_N) -- votes would silently split"
else
  bad "race setup didn't reproduce the fork precondition on pre-fix code (got #$A_N / #$B_N) -- can't validate the fix meaningfully"
fi

RESULT2=$(run_two_ensures "$H" 2)
A2=$(echo "$RESULT2" | cut -d' ' -f1); B2=$(echo "$RESULT2" | cut -d' ' -f2)
if [ -n "$A2" ] && [ "$A2" = "$B2" ]; then
  pass "fixed ensure converges the identical race on one health thread (#$A2), not a fork"
else
  bad "fixed ensure did not converge (got #$A2 / #$B2)"
fi
rm -f "$ORIG_H" "$GH_FAKE_LIB"

# --- live integration (requires gh auth + explicit opt-in) ------------------
# ensure/comment + vote round-trip. Gated (creates + closes a throwaway issue,
# adds a reaction):
#   HEALTH_ISSUE_LIVE=1 GH_REPO=<owner>/<repo> bash scripts/tests/test_health_issue.sh
if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
  echo "SKIP (live) - gh not installed/authenticated"
  echo "---"; [ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"; exit "$fail"
fi
if [ -z "${HEALTH_ISSUE_LIVE:-}" ]; then
  echo "SKIP (live) - set HEALTH_ISSUE_LIVE=1 (and GH_REPO) to run; creates + closes a test issue"
  echo "---"; [ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"; exit "$fail"
fi
: "${GH_REPO:?set GH_REPO}"; export GH_REPO

SKILL="zz-health-test-$$-$(date +%s)"
N=$(bash "$H" ensure "$SKILL")
[ -n "$N" ] && pass "created health issue #$N" || { bad "ensure"; echo SOME FAILED; exit 1; }

bash "$H" comment "$N" "Regression: score 1, flags [api_error] on $(date -u +%FT%TZ)" \
  && pass "posted regression comment" || bad "comment"

V0=$(bash "$H" votes "$N")
[ "$V0" = "0" ] && pass "initial votes = 0" || bad "initial votes (got $V0)"

# react 👍 as the authenticated user, then re-read
gh api "repos/{owner}/{repo}/issues/$N/reactions" -f content=+1 >/dev/null 2>&1
sleep 1
V1=$(bash "$H" votes "$N")
[ "$V1" = "1" ] && pass "vote registered (net = 1)" || bad "vote after 👍 (got $V1)"

gh issue close "$N" -c "test complete" >/dev/null 2>&1 && pass "closed issue #$N" || bad "close"
echo "---"; [ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"; exit "$fail"
