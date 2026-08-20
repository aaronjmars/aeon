#!/usr/bin/env bash
# Tests for harness-adapter/bin/generate-harnesses-json and the committed
# harness-adapter/harnesses.json capability manifest.
#
# The manifest is the local analog of a UHP GET /v1/harnesses discovery response,
# generated from each adapters/<h>.sh rh-meta block. This suite runs the generator
# against a throwaway copy of the tree (never mutating the working copy), then
# asserts schema shape and that the committed manifest is not stale.
#
# Run: bash scripts/tests/test_generate_harnesses_json.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMMITTED="$ROOT/harness-adapter/harnesses.json"
fail=0
pass() { echo "ok   - $1"; }
bad()  { echo "FAIL - $1"; fail=1; }

command -v jq >/dev/null 2>&1 || { echo "jq is required for this test" >&2; exit 1; }

# Work on a throwaway copy so the generator never dirties the working tree.
WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
cp -R "$ROOT/harness-adapter" "$WORK/ha"
GEN="$WORK/ha/bin/generate-harnesses-json"
GENERATED="$WORK/ha/harnesses.json"

# 1. generator runs clean
if "$GEN" >/dev/null 2>&1; then pass "generator exits 0"; else bad "generator failed"; fi

# 2. output is valid JSON
if jq empty "$GENERATED" 2>/dev/null; then pass "manifest is valid JSON"; else bad "manifest is not valid JSON"; fi

# 3. the six adapters, id-sorted and unique
ids="$(jq -r '.harnesses[].id' "$GENERATED" | tr '\n' ' ')"
[ "$ids" = "claude codex grok kimi pi vibe " ] \
  && pass "six harnesses, id-sorted" || bad "unexpected harness ids: [$ids]"

# 4. count field matches array length and equals 6
c=$(jq -r '.count' "$GENERATED"); n=$(jq -r '.harnesses | length' "$GENERATED")
{ [ "$c" = "$n" ] && [ "$c" = "6" ]; } \
  && pass "count=6 matches array length" || bad "count($c) != length($n) or != 6"

# 5. every harness carries the required capability keys
req='["id","label","cli","invoke","round_trip","token_usage","cost","read_only","structured_output","mcp","max_turns","claude_md","auth","native_control_path"]'
missing="$(jq -r --argjson req "$req" '.harnesses[] | select((($req) - (keys)) | length > 0) | .id' "$GENERATED")"
[ -z "$missing" ] && pass "all harnesses carry required keys" || bad "missing keys on: $missing"

# 6. enum sanity on the discriminating fields
check_enum() { # $1 field  $2..$n allowed values
  local field="$1"; shift
  local allowed; allowed="$(printf '"%s",' "$@")"; allowed="[${allowed%,}]"
  local off; off="$(jq -r --argjson ok "$allowed" ".harnesses[] | select((.$field | IN(\$ok[])) | not) | .id" "$GENERATED")"
  [ -z "$off" ] && pass "$field enum valid" || bad "bad $field on: $off"
}
check_enum token_usage full none
check_enum read_only native sandbox
check_enum structured_output native shim
check_enum mcp native native+trust native+inline-toml native+overlay unsupported

# 7. auth shape: each harness has openrouter boolean + two arrays
authbad="$(jq -r '.harnesses[] | select((.auth.openrouter|type != "boolean") or (.auth.native_oauth|type != "array") or (.auth.native_key|type != "array")) | .id' "$GENERATED")"
[ -z "$authbad" ] && pass "auth block shape valid" || bad "bad auth block on: $authbad"

# 8. committed manifest is not stale (generated timestamp aside)
norm() { sed -E 's/"generated": *"[^"]*"/"generated":""/' "$1"; }
if diff <(norm "$COMMITTED") <(norm "$GENERATED") >/dev/null 2>&1; then
  pass "committed harnesses.json matches a fresh regen"
else
  bad "committed harnesses.json is stale - run harness-adapter/bin/generate-harnesses-json and commit"
fi

[ "$fail" = 0 ] && echo "PASS" || echo "SOME TESTS FAILED"
exit $fail
