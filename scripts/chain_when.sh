#!/usr/bin/env bash
# chain_when.sh — evaluate ONE chain-step `when:` clause against a verdict JSON
# read on stdin. The verdict object carries the keys a step can route on; today
# that is {"score": N} sourced from the consumed skill's memory/skill-health entry.
#
#   echo '{"score":7}' | scripts/chain_when.sh "score > 5"
#
# Exit codes:
#   0  condition holds            (run the step)
#   1  condition does not hold     -> skip the step; INCLUDES a missing key, so a
#                                    `when:` on a key nothing published never fires
#   2  the expression is invalid   (unparseable, or an ordering op on a non-integer)
#
# Grammar: <key> <op> <value>  — exactly one key, one operator, one value.
#   ==  !=   compare as strings.
#   <  <=  >  >=   require BOTH sides to be integers; anything else exits 2 (fails
#                  loudly) rather than string-comparing "10" < "9" to true.
# Compound expressions and boolean operators are intentionally unsupported.
set -euo pipefail

WHEN="${1:?when expression required}"
JSON="$(cat)"
[ -z "$JSON" ] && JSON='{}'

# <  and  >  live in a quoted regex variable, not inline in [[ =~ ]], because a bare
# < or > there is parsed as a redirection and a backslash-escaped one is a GNU
# word-boundary anchor.
re='^[[:space:]]*([a-zA-Z_][a-zA-Z0-9_]*)[[:space:]]*(==|!=|<=|>=|<|>)[[:space:]]*(.+)$'
if ! [[ "$WHEN" =~ $re ]]; then
  printf 'chain_when: unparseable expression: %s\n' "$WHEN" >&2
  exit 2
fi
KEY="${BASH_REMATCH[1]}"
OP="${BASH_REMATCH[2]}"
VAL="${BASH_REMATCH[3]}"
VAL="${VAL%"${VAL##*[![:space:]]}"}"   # rstrip trailing whitespace

# Missing key -> does not fire (exit 1). has() tests presence regardless of the
# value, so a real 0 / false is distinguished from an absent key.
ACTUAL="$(printf '%s' "$JSON" | jq -r --arg k "$KEY" 'if has($k) then (.[$k]|tostring) else "__MISSING__" end')"
[ "$ACTUAL" = "__MISSING__" ] && exit 1

case "$OP" in
  '==') [ "$ACTUAL" = "$VAL" ] ;;
  '!=') [ "$ACTUAL" != "$VAL" ] ;;
  '<'|'<='|'>'|'>=')
    if ! [[ "$ACTUAL" =~ ^-?[0-9]+$ ]]; then
      printf 'chain_when: %s=%s is not an integer; ordering needs integers\n' "$KEY" "$ACTUAL" >&2
      exit 2
    fi
    if ! [[ "$VAL" =~ ^-?[0-9]+$ ]]; then
      printf 'chain_when: value %s is not an integer; ordering needs integers\n' "$VAL" >&2
      exit 2
    fi
    case "$OP" in
      '<')  [ "$ACTUAL" -lt "$VAL" ] ;;
      '<=') [ "$ACTUAL" -le "$VAL" ] ;;
      '>')  [ "$ACTUAL" -gt "$VAL" ] ;;
      '>=') [ "$ACTUAL" -ge "$VAL" ] ;;
    esac
    ;;
esac
