#!/usr/bin/env bash
# Tests for scripts/reactive_when.sh — single reactive-trigger `when:` evaluation.
# Run:  bash scripts/tests/test_reactive_when.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/reactive_when.sh"

pass=0; fail=0
# check <desc> <state-json> <when> <expect-exit>
check() {
  local desc="$1" state="$2" when="$3" expect="$4" rc
  printf '%s' "$state" | bash "$SCRIPT" "$when" >/dev/null 2>&1; rc=$?
  if [ "$rc" = "$expect" ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1)); printf 'FAIL: %-42s got=%s want=%s\n' "$desc" "$rc" "$expect"
  fi
}

# --- consecutive_failures >= N ---
check "consec at threshold"      '{"consecutive_failures":3}' "consecutive_failures >= 3" 0
check "consec above threshold"   '{"consecutive_failures":7}' "consecutive_failures >= 3" 0
check "consec below threshold"   '{"consecutive_failures":2}' "consecutive_failures >= 3" 1
check "consec single-failure edge" '{"consecutive_failures":1}' "consecutive_failures >= 1" 0
check "consec missing field"     '{}'                          "consecutive_failures >= 1" 1
check "consec tight spacing"     '{"consecutive_failures":3}' "consecutive_failures>=3"   0

# --- last_status = <value> ---
check "status matches success"   '{"last_status":"success"}'  "last_status = success"     0
check "status matches failed"    '{"last_status":"failed"}'   "last_status = failed"      0
check "status mismatch"          '{"last_status":"failed"}'   "last_status = success"     1
check "status missing field"     '{}'                         "last_status = success"     1

# --- success_rate <op> X  (the condition that was documented but never evaluated) ---
check "rate below (fires)"       '{"total_runs":10,"success_rate":0.4}' "success_rate < 0.5"  0
check "rate above (no fire)"     '{"total_runs":10,"success_rate":0.6}' "success_rate < 0.5"  1
check "rate equal, strict lt"    '{"total_runs":10,"success_rate":0.5}' "success_rate < 0.5"  1
check "rate equal, lte"          '{"total_runs":10,"success_rate":0.5}' "success_rate <= 0.5" 0
check "rate gt fires"            '{"total_runs":10,"success_rate":0.9}' "success_rate > 0.8"  0
check "rate gte fires"           '{"total_runs":10,"success_rate":0.8}' "success_rate >= 0.8" 0
check "never-run: no false fire" '{"total_runs":0,"success_rate":0.0}'  "success_rate < 0.5"  1
check "missing total_runs quiet" '{"success_rate":0.0}'                 "success_rate < 0.5"  1

# --- unparseable ---
check "garbage condition"        '{"consecutive_failures":9}' "explode_now > yes"         2
check "empty state ok"           ''                           "consecutive_failures >= 1" 1

printf '\nreactive_when: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
