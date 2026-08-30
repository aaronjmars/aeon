#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
state="$tmp/state"
response="$tmp/response.json"

PATH="$PWD/scripts/tests/fixtures:$PATH" \
FAKE_CURL_STATE="$state" \
  ./scripts/secretcurl.sh -s -o "$response" -w '%{http_code}' \
    --max-time 1 -X POST "https://api.x.ai/v1/responses" \
    -H 'Authorization: Bearer {XAI_API_KEY}' -d @/dev/null \
    >"$tmp/http" 2>"$tmp/diag"

[ "$(cat "$state")" = 2 ] || { echo "FAIL - expected two attempts"; exit 1; }
[ "$(cat "$tmp/http")" = 200 ] || { echo "FAIL - expected final HTTP 200"; exit 1; }
grep -q '"text":"ok"' "$response" || { echo "FAIL - final response was not retained"; exit 1; }
grep -q 'attempt=1/3 http=503 .*reason=http-503' "$tmp/diag" || { echo "FAIL - missing first-attempt diagnostic"; exit 1; }
grep -q 'attempt=2/3 http=200 .*reason=ok' "$tmp/diag" || { echo "FAIL - missing success diagnostic"; exit 1; }
echo 'PASS - xai retries transient HTTP 503'

state401="$tmp/state401"
response401="$tmp/response401.json"
PATH="$PWD/scripts/tests/fixtures:$PATH" \
FAKE_CURL_STATE="$state401" \
FAKE_CURL_HTTP=401 \
  ./scripts/secretcurl.sh -s -o "$response401" -w '%{http_code}' \
    --max-time 1 -X POST "https://api.x.ai/v1/responses" \
    -H 'Authorization: Bearer {XAI_API_KEY}' -d @/dev/null \
    >"$tmp/http401" 2>"$tmp/diag401"

[ "$(cat "$state401")" = 1 ] || { echo "FAIL - 401 should not retry"; exit 1; }
[ "$(cat "$tmp/http401")" = 401 ] || { echo "FAIL - expected HTTP 401"; exit 1; }
grep -q 'attempt=1/3 http=401 .*reason=http-401' "$tmp/diag401" || { echo "FAIL - missing 401 diagnostic"; exit 1; }
if grep -q 'attempt=2/' "$tmp/diag401"; then echo "FAIL - 401 retried"; exit 1; fi
echo 'ALL PASS - xai retries 5xx, not 4xx'
