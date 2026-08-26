#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ ! -f memory/skill-health/github-trending.json ]; then
  echo "skill-health-routing: skipped real-data smoke test (no live health history in this checkout)"
  exit 0
fi

OUT=$(node scripts/skill-health-routing.mjs github-trending)
grep -q '^skill: github-trending$' <<<"$OUT"
grep -q '^minimum harness samples: 5 ' <<<"$OUT"
grep -q '^recommendation: ' <<<"$OUT"

if err=$(node scripts/skill-health-routing.mjs skill-does-not-exist 2>&1); then
  echo "expected missing health file to fail" >&2
  exit 1
fi
grep -q 'health file not found' <<<"$err"

echo "skill-health-routing: real-data smoke test passed"
