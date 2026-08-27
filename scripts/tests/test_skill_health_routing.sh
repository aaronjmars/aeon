#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if err=$(node scripts/skill-health-routing.mjs skill-does-not-exist 2>&1); then
  echo "expected missing health file to fail" >&2
  exit 1
fi
grep -q 'health file not found' <<<"$err"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/memory/skill-health"
printf '%s\n' '{"history":[{"date":"2026-08-27","score":4,"harness":"cursor"},{"date":"2026-08-27","score":4,"harness":"hermes"},{"date":"2026-08-27","score":4,"harness":"fx"},{"date":"2026-08-27","score":4,"harness":"kimi"},{"date":"2026-08-27","score":4,"harness":"vibe"},{"date":"2026-08-27","score":4,"harness":"pi"}]}' > "$TMP/memory/skill-health/alias-check.json"
printf '%s\n' \
  'date,skill,model,input_tokens,output_tokens,cache_read,cache_creation' \
  '2026-08-27,alias-check,cursor-default,10,1,20,0' \
  '2026-08-27,alias-check,hermes-default,10,1,20,0' \
  '2026-08-27,alias-check,fx-default,10,1,20,0' \
  '2026-08-27,alias-check,kimi-default,10,1,20,0' \
  '2026-08-27,alias-check,vibe-default,10,1,20,0' \
  '2026-08-27,alias-check,pi-default,10,1,20,0' \
  '2026-08-27,alias-check,bogus-default,10,1,20,0' \
  > "$TMP/memory/token-usage.csv"
ALIAS_OUT=$(cd "$TMP" && node "$ROOT/scripts/skill-health-routing.mjs" alias-check)
for harness in cursor hermes fx kimi vibe pi; do
  grep -q "^  ${harness}: 1 rows," <<<"$ALIAS_OUT"
done
# a non-harness "-default" row must NOT be attributed
grep -q '^  bogus:' <<<"$ALIAS_OUT" && { echo "bogus-default wrongly attributed" >&2; exit 1; } || true

if [ ! -f memory/skill-health/github-trending.json ]; then
  echo "skill-health-routing: data-independent assertions passed; skipped real-data smoke test (no live health history in this checkout)"
  exit 0
fi

OUT=$(node scripts/skill-health-routing.mjs github-trending)
grep -q '^skill: github-trending$' <<<"$OUT"
grep -q '^minimum harness samples: 5 ' <<<"$OUT"
grep -q '^recommendation: ' <<<"$OUT"

echo "skill-health-routing: real-data smoke test passed"
