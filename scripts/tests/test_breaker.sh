#!/usr/bin/env bash
# Tests for scripts/breaker.sh — the auto-recovering circuit-breaker decision.
# Run:  bash scripts/tests/test_breaker.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/breaker.sh"

pass=0; fail=0
# check <desc> <consecutive_failures> <minutes_since> <threshold> <cooldown_min> <expect: closed|probe|open>
check() {
  local desc="$1" consec="$2" mins="$3" thr="$4" cool="$5" expect="$6" out
  out=$(bash "$SCRIPT" "$consec" "$mins" "$thr" "$cool" 2>/dev/null || echo "ERR")
  if [ "$out" = "$expect" ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1)); printf 'FAIL: %-38s got=%-6s want=%-6s\n' "$desc" "$out" "$expect"
  fi
}

# --- closed: below threshold, normal path ---
check "zero failures"                  0  10   3 360 closed
check "one below threshold"            2  10   3 360 closed
check "one below threshold, old"       2  9999 3 360 closed

# --- tripped: at/above threshold ---
check "at threshold, fresh dispatch"   3  10   3 360 open
check "above threshold, fresh"         7  30   3 360 open
check "at threshold, cooldown not up"  3  359  3 360 open
check "at threshold, cooldown exactly" 3  360  3 360 probe
check "at threshold, cooldown passed"  3  700  3 360 probe
check "way above, cooldown passed"     9  1000 3 360 probe

# --- threshold tuning ---
check "custom threshold 5, below"      4  10   5 360 closed
check "custom threshold 5, at"         5  10   5 360 open
check "custom threshold 5, probe"      5  400  5 360 probe

# --- cooldown tuning ---
check "short cooldown, still open"     3  59   3 60  open
check "short cooldown, probe"          3  60   3 60  probe

# --- disabled (threshold 0) always closed ---
check "disabled, high failures"        50 0    0 360 closed
check "disabled, negative guard"       50 0   -1 360 closed

echo "---"
echo "PASS: $pass   FAIL: $fail"
[ "$fail" -eq 0 ]
