#!/usr/bin/env bash
set -euo pipefail

# test_skill_scan_calibration.sh — asserts the scanner fires on real sinks, not on
# benign shell syntax or a skill's own anti-injection documentation.
#
# Fixtures live in skill-scan-fixtures/:
#   benign-*     MUST pass  (exit 0) — template vars, command substitution,
#                authenticated API calls, and defensive injection prose.
#   malicious-*  MUST fail  (exit 1) — curl|sh RCE, secret exfiltration,
#                destructive rm, and a bare prompt-injection imperative.
#
# Exit 0 if every fixture lands on its expected verdict, else 1.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCANNER="$SCRIPT_DIR/../skill-scan.sh"
FIXTURES="$SCRIPT_DIR/skill-scan-fixtures"

fails=0
for dir in "$FIXTURES"/*/; do
  name="$(basename "$dir")"
  if "$SCANNER" "$dir/SKILL.md" >/dev/null 2>&1; then verdict="pass"; else verdict="fail"; fi
  case "$name" in
    benign-*)    want="pass" ;;
    malicious-*) want="fail" ;;
    *) echo "?? $name — fixture must be named benign-* or malicious-*"; fails=$((fails+1)); continue ;;
  esac
  if [[ "$verdict" == "$want" ]]; then
    echo "ok   $name ($verdict)"
  else
    echo "FAIL $name — got $verdict, want $want"
    fails=$((fails+1))
  fi
done

echo "---"
if [[ $fails -eq 0 ]]; then
  echo "calibration: all fixtures correct"
  exit 0
fi
echo "calibration: $fails fixture(s) wrong"
exit 1
