#!/usr/bin/env bash
# reactive_when.sh — evaluate ONE reactive-trigger `when:` condition against a
# single skill's cron-state object, read as JSON on stdin.
#
#   echo "$STATE" | jq -c '.["digest"]' | scripts/reactive_when.sh "consecutive_failures >= 3"
#
# Exit codes:
#   0  condition holds        (fire the reactive skill)
#   1  condition does not hold (do not fire)
#   2  condition is unparseable
#
# Supported conditions (kept in lockstep with the `reactive:` docs in aeon.yml):
#   consecutive_failures >= N     — source skill failed N+ times in a row
#   last_status = <value>         — source skill's last run ended <value>
#   success_rate <op> X           — op is one of  <  <=  >  >=  (0.0-1.0 float)
#                                   only meaningful once the skill has run at least
#                                   once; a never-run skill sits at 0.0 and is
#                                   reported as "no signal" (exit 1) rather than a
#                                   breach, so `success_rate < X` does not false-fire
#                                   on a fresh skill.
#
# The comparison operators live in quoted regex variables, not inline in [[ =~ ]]:
# a bare > or < inside an inline conditional pattern is parsed as a redirection, and
# a backslash-escaped \< / \> is a word-boundary anchor under GNU regex on the CI
# runner. A regex held in a variable sidesteps both — the operators are passed to
# regcomp as plain literals.
set -euo pipefail

WHEN="${1:?when condition required}"
STATE_JSON="$(cat)"
[ -z "$STATE_JSON" ] && STATE_JSON='{}'

field() { printf '%s' "$STATE_JSON" | jq -r "$1"; }

re_consec='consecutive_failures[[:space:]]*>=[[:space:]]*([0-9]+)'
re_status='last_status[[:space:]]*=[[:space:]]*([a-z]+)'
re_rate='success_rate[[:space:]]*(<=|>=|<|>)[[:space:]]*([0-9.]+)'

if [[ "$WHEN" =~ $re_consec ]]; then
  THRESHOLD="${BASH_REMATCH[1]}"
  CONSEC="$(field '.consecutive_failures // 0')"
  [ "$CONSEC" -ge "$THRESHOLD" ]

elif [[ "$WHEN" =~ $re_status ]]; then
  EXPECTED="${BASH_REMATCH[1]}"
  ACTUAL="$(field '.last_status // "none"')"
  [ "$ACTUAL" = "$EXPECTED" ]

elif [[ "$WHEN" =~ $re_rate ]]; then
  OP="${BASH_REMATCH[1]}"
  THRESHOLD="${BASH_REMATCH[2]}"
  RUNS="$(field '.total_runs // 0')"
  RATE="$(field '.success_rate // 0')"
  [ "$RUNS" -gt 0 ] || exit 1
  jq -e -n --argjson a "$RATE" --argjson b "$THRESHOLD" --arg op "$OP" \
    'if   $op=="<"  then $a <  $b
     elif $op=="<=" then $a <= $b
     elif $op==">"  then $a >  $b
     else                $a >= $b end' >/dev/null

else
  printf 'reactive_when: unparseable condition: %s\n' "$WHEN" >&2
  exit 2
fi
