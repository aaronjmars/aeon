#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CHECK="$ROOT/scripts/dev-loop-pr.sh"
CONFIG="$ROOT/aeon.yml"
RUNNER="$ROOT/.github/workflows/chain-runner.yml"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = api ] && [ "$2" = user ]; then
  printf 'aeonframework\n'
  exit 0
fi
[ "$1" = pr ]
[ "$2" = list ]
calls=$(cat "$TEST_GH_CALLS" 2>/dev/null || echo 0)
calls=$((calls + 1))
printf '%s\n' "$calls" > "$TEST_GH_CALLS"
case "$TEST_GH_SCENARIO:$calls" in
  empty:1) : ;;
  empty:2) printf '[{"number":42,"author":{"login":"aeonframework"},"body":"summary\\n\\n<!-- aeon-dispatch:chain-0123456789abcdef0123456789abcdef -->"}]\n' ;;
  one:1) printf '41\n' ;;
  one:2) printf '[{"number":41,"author":{"login":"aeonframework"},"body":"old"},{"number":42,"author":{"login":"aeonframework"},"body":"summary\\n\\n<!-- aeon-dispatch:chain-0123456789abcdef0123456789abcdef -->\\nmore"}]\n' ;;
  none:1) printf '41\n' ;;
  none:2) printf '[{"number":41,"author":{"login":"aeonframework"},"body":"old"}]\n' ;;
  many:1) printf '41\n' ;;
  many:2) printf '[{"number":41,"author":{"login":"aeonframework"},"body":"old"},{"number":42,"author":{"login":"aeonframework"},"body":"<!-- aeon-dispatch:chain-0123456789abcdef0123456789abcdef -->"},{"number":43,"author":{"login":"aeonframework"},"body":"<!-- aeon-dispatch:chain-0123456789abcdef0123456789abcdef -->"}]\n' ;;
  wrong-actor:1) printf '41\n' ;;
  wrong-actor:2) printf '[{"number":41,"author":{"login":"other-user"},"body":"old"},{"number":42,"author":{"login":"other-user"},"body":"<!-- aeon-dispatch:chain-0123456789abcdef0123456789abcdef -->"}]\n' ;;
  concurrent-other:1) printf '41\n' ;;
  concurrent-other:2) printf '[{"number":41,"author":{"login":"aeonframework"},"body":"old"},{"number":42,"author":{"login":"aeonframework"},"body":"summary\\n<!-- aeon-dispatch:chain-0123456789abcdef0123456789abcdef -->"},{"number":43,"author":{"login":"other-user"},"body":"unrelated"}]\n' ;;
  concurrent-same-actor:1) printf '41\n' ;;
  concurrent-same-actor:2) printf '[{"number":41,"author":{"login":"aeonframework"},"body":"old"},{"number":42,"author":{"login":"aeonframework"},"body":"unrelated same-actor pr"}]\n' ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$TMP/bin/gh"

before="$TMP/before"
calls="$TMP/calls"
dispatch_id="chain-0123456789abcdef0123456789abcdef"

grep -Fq 'target:' "$RUNNER"
grep -Fq '_INPUT_TARGET: ${{ inputs.target }}' "$RUNNER"
grep -Fq 'var: "$chain_target"' "$CONFIG"
grep -Fq 'var: "$feature_pr"' "$CONFIG"
grep -Fq '${AEON_DISPATCH_ID:+<!-- aeon-dispatch:$AEON_DISPATCH_ID -->}' "$ROOT/skills/feature/SKILL.md"
[ "$(grep -Fc '${AEON_DISPATCH_ID:+<!-- aeon-dispatch:$AEON_DISPATCH_ID -->}' "$ROOT/skills/feature/SKILL.md")" -eq 3 ]

[ "$(bash "$CHECK" validate-target external:acme/demo#7)" = 'acme/demo' ]
TEST_GH_CALLS="$calls" TEST_GH_SCENARIO=one PATH="$TMP/bin:$PATH" bash "$CHECK" snapshot external:acme/demo > "$before"
[ "$(TEST_GH_CALLS="$calls" TEST_GH_SCENARIO=one DEV_LOOP_PR_VERIFY_ATTEMPTS=1 PATH="$TMP/bin:$PATH" bash "$CHECK" verify-new-pr external:acme/demo "$before" "$dispatch_id")" = 'acme/demo#42' ]

printf '0\n' > "$calls"
TEST_GH_CALLS="$calls" TEST_GH_SCENARIO=empty PATH="$TMP/bin:$PATH" bash "$CHECK" snapshot external:acme/demo > "$before"
[ ! -s "$before" ]
[ "$(TEST_GH_CALLS="$calls" TEST_GH_SCENARIO=empty DEV_LOOP_PR_VERIFY_ATTEMPTS=1 PATH="$TMP/bin:$PATH" bash "$CHECK" verify-new-pr external:acme/demo "$before" "$dispatch_id")" = 'acme/demo#42' ]

printf '0\n' > "$calls"
TEST_GH_CALLS="$calls" TEST_GH_SCENARIO=none PATH="$TMP/bin:$PATH" bash "$CHECK" snapshot external:acme/demo > "$before"
if TEST_GH_CALLS="$calls" TEST_GH_SCENARIO=none DEV_LOOP_PR_VERIFY_ATTEMPTS=1 PATH="$TMP/bin:$PATH" bash "$CHECK" verify-new-pr external:acme/demo "$before" "$dispatch_id"; then
  echo 'no-op unexpectedly produced a PR handoff' >&2
  exit 1
else
  [ "$?" -eq 3 ]
fi

printf '0\n' > "$calls"
TEST_GH_CALLS="$calls" TEST_GH_SCENARIO=many PATH="$TMP/bin:$PATH" bash "$CHECK" snapshot external:acme/demo > "$before"
if TEST_GH_CALLS="$calls" TEST_GH_SCENARIO=many DEV_LOOP_PR_VERIFY_ATTEMPTS=1 PATH="$TMP/bin:$PATH" bash "$CHECK" verify-new-pr external:acme/demo "$before" "$dispatch_id"; then
  echo 'ambiguous handoff unexpectedly verified' >&2
  exit 1
fi

printf '0\n' > "$calls"
TEST_GH_CALLS="$calls" TEST_GH_SCENARIO=wrong-actor PATH="$TMP/bin:$PATH" bash "$CHECK" snapshot external:acme/demo > "$before"
if TEST_GH_CALLS="$calls" TEST_GH_SCENARIO=wrong-actor DEV_LOOP_PR_VERIFY_ATTEMPTS=1 PATH="$TMP/bin:$PATH" bash "$CHECK" verify-new-pr external:acme/demo "$before" "$dispatch_id"; then
  echo 'wrong-actor handoff unexpectedly verified' >&2
  exit 1
fi

printf '0\n' > "$calls"
TEST_GH_CALLS="$calls" TEST_GH_SCENARIO=concurrent-other PATH="$TMP/bin:$PATH" bash "$CHECK" snapshot external:acme/demo > "$before"
[ "$(TEST_GH_CALLS="$calls" TEST_GH_SCENARIO=concurrent-other DEV_LOOP_PR_VERIFY_ATTEMPTS=1 PATH="$TMP/bin:$PATH" bash "$CHECK" verify-new-pr external:acme/demo "$before" "$dispatch_id")" = 'acme/demo#42' ]

printf '0\n' > "$calls"
TEST_GH_CALLS="$calls" TEST_GH_SCENARIO=concurrent-same-actor PATH="$TMP/bin:$PATH" bash "$CHECK" snapshot external:acme/demo > "$before"
if TEST_GH_CALLS="$calls" TEST_GH_SCENARIO=concurrent-same-actor DEV_LOOP_PR_VERIFY_ATTEMPTS=1 PATH="$TMP/bin:$PATH" bash "$CHECK" verify-new-pr external:acme/demo "$before" "$dispatch_id"; then
  echo 'unmarked same-actor impostor unexpectedly verified' >&2
  exit 1
else
  [ "$?" -eq 3 ]
fi

if bash "$CHECK" validate-target watched; then
  echo 'implicit watched target unexpectedly validated' >&2
  exit 1
fi

echo 'dev-loop handoff tests passed'
