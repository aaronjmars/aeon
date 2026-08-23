#!/usr/bin/env bash
# Tests for scripts/state_store.sh.
# Run: bash scripts/tests/test_state_store.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

fail=0; pass(){ echo "ok   - $1"; }; bad(){ echo "FAIL - $1"; fail=1; }
S="scripts/state_store.sh"

# --- offline: the _ensure search-then-create race, and that it converges ----
# No gh auth or network needed -- `gh` is a fake issue tracker backed by a real
# file (so mutations are actually visible across the separate `bash "$S"` child
# processes each `ensure` call spawns -- an env-var-only fake would NOT be
# shared between them). Store lines are tab-delimited ("num\ttitle\tstate"):
# a real issue title can contain a colon (health_issue.sh's is literally
# "health: <skill>"), so a colon delimiter would misparse it.
# `gh issue list`/`create`/`close` are the only 3 shapes _ensure/_find_all use.
# STALE_UNTIL models GitHub's own documented search-index lag (or two truly
# concurrent callers): the first N `gh issue list` calls return empty
# regardless of what the file actually holds -- the real-world condition that
# opens the search-then-create gap.
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

# Reproduce the bug against the ACTUAL pre-fix code (fetched from git, not
# hand-copied) so the "before" side of this proof is the real historical bug,
# not a guess at what it looked like.
ORIG_S="$(mktemp)"
# Resolve the pre-fix source from whatever base ref this checkout actually has:
# a local clone has upstream/origin/main, but a shallow CI checkout (fetch-depth
# 1) may have none. When it's reachable the before-side runs as a real proof;
# when it isn't the before-side skips (the fixed-side assertion below is
# self-contained and always gates the regression).
: > "$ORIG_S"
for _ref in upstream/main origin/main main; do
  if git show "$_ref:scripts/state_store.sh" > "$ORIG_S" 2>/dev/null && [ -s "$ORIG_S" ]; then
    break
  fi
  : > "$ORIG_S"
done

run_two_ensures() {
  local script="$1" stale_until="$2"
  local store; store="$(mktemp -u)"; : > "$store"
  ( export GH_REPO="fake/fake" STORE="$store" STALE_UNTIL="$stale_until"
    # dummy GH_REPO only so state_store.sh's own REPO_ARGS=() stays non-empty --
    # bash 3.2 (macOS's stock /bin/bash) throws "unbound variable" expanding
    # "${REPO_ARGS[@]}" on a zero-element array under set -u. Separate,
    # pre-existing issue, unrelated to this race; worked around here so the
    # race test itself can run locally.
    source "$GH_FAKE_LIB"
    A=$(bash "$script" ensure "race-test-title")
    B=$(bash "$script" ensure "race-test-title")
    echo "$A $B"
  )
  rm -f "$store" "$store.calls"
}

# Both callers' first list lands in the stale window (both see "not found"),
# exactly modeling two racing processes that both check before either creates.
if [ -s "$ORIG_S" ]; then
  RESULT=$(run_two_ensures "$ORIG_S" 2)
  A_N=$(echo "$RESULT" | cut -d' ' -f1); B_N=$(echo "$RESULT" | cut -d' ' -f2)
  if [ -n "$A_N" ] && [ -n "$B_N" ] && [ "$A_N" != "$B_N" ]; then
    pass "reproduced on the actual pre-fix code: two racing ensures fork the ledger (#$A_N vs #$B_N)"
  else
    bad "race setup didn't reproduce the fork precondition on pre-fix code (got #$A_N / #$B_N) -- can't validate the fix meaningfully"
  fi
else
  echo "SKIP - pre-fix source not reachable from this checkout (shallow CI); fixed-side assertion below still gates"
fi

# Identical race, through the FIXED _ensure (which re-lists after its own
# create): both callers must converge on the same issue, not fork.
RESULT2=$(run_two_ensures "$S" 2)
A2=$(echo "$RESULT2" | cut -d' ' -f1); B2=$(echo "$RESULT2" | cut -d' ' -f2)
if [ -n "$A2" ] && [ "$A2" = "$B2" ]; then
  pass "fixed _ensure converges the identical race on one issue (#$A2), not a fork"
else
  bad "fixed _ensure did not converge (got #$A2 / #$B2)"
fi
rm -f "$ORIG_S" "$GH_FAKE_LIB"

# --- live integration (requires gh auth + explicit opt-in) ------------------
# Proves concurrent appends to the Issues-backed state store do NOT conflict
# (the whole point vs. the file + rebase loop). Creates and closes a
# throwaway issue, so it's gated:
#   STATE_STORE_LIVE=1 GH_REPO=<owner>/<repo> bash scripts/tests/test_state_store.sh
# SKIPS otherwise (no gh auth, or flag unset).
if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
  echo "SKIP (live) - gh not installed/authenticated"
  echo "---"; [ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"; exit "$fail"
fi
if [ -z "${STATE_STORE_LIVE:-}" ]; then
  echo "SKIP (live) - set STATE_STORE_LIVE=1 (and GH_REPO) to run; creates + closes a test issue"
  echo "---"; [ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"; exit "$fail"
fi
: "${GH_REPO:?set GH_REPO to a test repo (e.g. you/aeon-dev)}"
export GH_REPO

TITLE="aeon-state-test-$$-$(date +%s)"
N=$(bash "$S" ensure "$TITLE")
if [ -n "$N" ]; then pass "created state issue #$N"; else bad "create state issue"; echo "SOME FAILED"; exit 1; fi

# two CONCURRENT appends — independent comments, no read-modify-write race
bash "$S" append "$N" '{"skill":"alpha","status":"success","ts":"2026-06-17T10:00:00Z","quality_score":4}' &
bash "$S" append "$N" '{"skill":"alpha","status":"failed","ts":"2026-06-17T11:00:00Z","error":"boom"}' &
bash "$S" append "$N" '{"skill":"beta","status":"success","ts":"2026-06-17T10:30:00Z"}' &
wait

STATE=$(bash "$S" read "$N")
if echo "$STATE" | python3 -c "
import sys,json; d=json.load(sys.stdin)
assert d['alpha']['total_runs']==2, d
assert d['alpha']['last_status']=='failed', d
assert d['alpha']['success_rate']==0.5, d
assert d['beta']['total_runs']==1, d
" 2>/dev/null; then
  pass "3 concurrent appends landed + folded correctly (no conflict, no rebase)"
else
  bad "concurrent appends fold: $STATE"
fi

gh issue close "$N" -c "test complete" >/dev/null 2>&1 && pass "closed test issue #$N" || bad "close issue #$N"

echo "---"; [ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"; exit "$fail"
