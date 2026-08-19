#!/usr/bin/env bash
# Tests for scripts/chain_when.sh — chain-step `when:` routing evaluation.
# Run:  bash scripts/tests/test_chain_when.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/chain_when.sh"

pass=0; fail=0
# check <desc> <verdict-json> <when> <expect-exit>
check() {
  local desc="$1" json="$2" when="$3" expect="$4" rc
  printf '%s' "$json" | bash "$SCRIPT" "$when" >/dev/null 2>&1; rc=$?
  if [ "$rc" = "$expect" ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1)); printf 'FAIL: %-40s got=%s want=%s\n' "$desc" "$rc" "$expect"
  fi
}

# --- ordering on score (the plan's core case) ---
check "score>5 fires at 7"      '{"score":7}' "score > 5"  0
check "score>5 no fire at 5"    '{"score":5}' "score > 5"  1
check "score<=5 fires at 5"     '{"score":5}' "score <= 5" 0
check "score<=5 no fire at 6"   '{"score":6}' "score <= 5" 1
check "score>=5 fires at 5"     '{"score":5}' "score >= 5" 0
check "score<5 fires at 4"      '{"score":4}' "score < 5"  0
check "10 vs 9 is numeric"      '{"score":10}' "score > 9" 0

# --- equality compares as strings ---
check "verdict == pass"         '{"verdict":"pass"}' "verdict == pass" 0
check "verdict == fail no fire" '{"verdict":"pass"}' "verdict == fail" 1
check "verdict != fail fires"   '{"verdict":"pass"}' "verdict != fail" 0

# --- missing key does not fire (exit 1, NOT an error) ---
check "missing score no fire"   '{}'          "score > 5"  1
check "other key present"       '{"grade":9}' "score > 5"  1

# --- fails loudly (exit 2) rather than string-comparing ---
check "ordering on non-int"     '{"score":"good"}' "score > 5"   2
check "ordering vs non-int val" '{"score":7}'      "score > abc" 2
check "garbage expression"      '{"score":7}'      "score is big" 2
check "empty expression body"   '{"score":7}'      "score" 2

# --- real 0 is a value, not missing ---
check "score 0 vs >0 no fire"   '{"score":0}' "score > 0"  1
check "score 0 == 0 fires"      '{"score":0}' "score == 0" 0

printf '\nchain_when: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
