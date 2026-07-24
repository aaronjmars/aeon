#!/usr/bin/env bash
# Tests for scripts/mcp-oauth-refresh.sh — the durable MCP OAuth token refresh.
# The script is SOURCED (exports MCP_<SLUG>_TOKEN into the shell), so each case runs
# in an isolated `bash -c` that defines a stub `curl`, sets ALL_SECRETS, sources the
# script, and reports the resulting env. No network.
set -uo pipefail
R="$(cd "$(dirname "$0")/../.." && pwd)/scripts/mcp-oauth-refresh.sh"
FAILED=0
pass() { echo "ok   - $1"; }
bad()  { echo "FAIL - $1"; FAILED=1; }

# Helper: run the script with a given ALL_SECRETS and stub curl response, echo the
# resulting MCP_FOO_TOKEN (empty if unset). $1=ALL_SECRETS json, $2=curl stdout.
run_case() {
  ALL_SECRETS="$1" CURL_OUT="$2" bash -c '
    curl() { printf "%s" "$CURL_OUT"; }   # stub: ignore args, emit canned token JSON
    source "'"$R"'" 2>/dev/null
    printf "TOKEN=[%s]\n" "${MCP_FOO_TOKEN:-}"
  '
}

OAUTH_OK='{"MCP_FOO_OAUTH":"{\"token_endpoint\":\"https://as.example/token\",\"client_id\":\"cid\",\"refresh_token\":\"rt-1\",\"slug\":\"foo\"}"}'

# 1. Valid oauth secret + a good refresh response → fresh token exported.
out=$(run_case "$OAUTH_OK" '{"access_token":"fresh-123","token_type":"Bearer","expires_in":3600}')
echo "$out" | grep -qx 'TOKEN=\[fresh-123\]' && pass "refresh exports MCP_FOO_TOKEN with the fresh access token" || bad "refresh exports token (got: $out)"

# 2. Refresh response with no access_token → token NOT exported (stays empty).
out=$(run_case "$OAUTH_OK" '{"error":"invalid_grant"}')
echo "$out" | grep -qx 'TOKEN=\[\]' && pass "no access_token in response → token left unset" || bad "unset on bad response (got: $out)"

# 3. Missing token_endpoint → skipped, token unset.
BAD_SECRET='{"MCP_FOO_OAUTH":"{\"client_id\":\"cid\",\"refresh_token\":\"rt-1\"}"}'
out=$(run_case "$BAD_SECRET" '{"access_token":"nope"}')
echo "$out" | grep -qx 'TOKEN=\[\]' && pass "missing token_endpoint → skipped" || bad "skip on missing endpoint (got: $out)"

# 4. No MCP_*_OAUTH secrets → clean no-op (token unset, no failure).
out=$(run_case '{"SOME_OTHER":"x"}' '{"access_token":"nope"}')
echo "$out" | grep -qx 'TOKEN=\[\]' && pass "no oauth secrets → no-op" || bad "no-op when no oauth secrets (got: $out)"

# 5. Sourced under `set -e`, a failing refresh must NOT abort the caller.
out=$(ALL_SECRETS="$OAUTH_OK" CURL_OUT='{"error":"x"}' bash -c '
  set -eo pipefail
  curl() { printf "%s" "$CURL_OUT"; }
  source "'"$R"'" 2>/dev/null
  echo "SURVIVED"
')
echo "$out" | grep -qx 'SURVIVED' && pass "failing refresh does not abort a set -e caller" || bad "set -e safety (got: $out)"

# 6. Sourced under `set -e`, errexit is restored afterward (still on).
out=$(ALL_SECRETS="$OAUTH_OK" CURL_OUT='{"access_token":"z"}' bash -c '
  set -e
  curl() { printf "%s" "$CURL_OUT"; }
  source "'"$R"'" 2>/dev/null
  case $- in *e*) echo "ERREXIT_ON" ;; *) echo "ERREXIT_OFF" ;; esac
')
echo "$out" | grep -qx 'ERREXIT_ON' && pass "errexit restored after sourcing" || bad "errexit restored (got: $out)"

# 7. Rotated refresh token + a secrets-write PAT + stubbed gh → token still
#    exported AND `gh secret set` invoked to persist the new refresh token.
ROT_SECRET='{"GH_SECRETS_PAT":"pat-xyz","MCP_FOO_OAUTH":"{\"token_endpoint\":\"https://as.example/token\",\"client_id\":\"cid\",\"refresh_token\":\"rt-1\"}"}'
out=$(ALL_SECRETS="$ROT_SECRET" CURL_OUT='{"access_token":"fresh-9","refresh_token":"rt-2"}' GHMARK="$(mktemp)" bash -c '
  curl() { printf "%s" "$CURL_OUT"; }
  gh() { [ "$1" = "secret" ] && [ "$2" = "set" ] && { echo "GH_TOKEN=$GH_TOKEN NAME=$3" > "$GHMARK"; cat >/dev/null; }; return 0; }
  export -f gh
  source "'"$R"'" 2>/dev/null
  printf "TOKEN=[%s]\n" "${MCP_FOO_TOKEN:-}"
  printf "PERSIST=[%s]\n" "$(cat "$GHMARK")"
  rm -f "$GHMARK"
')
echo "$out" | grep -qx 'TOKEN=\[fresh-9\]' && pass "rotated token: fresh access token still exported" || bad "rotated token export (got: $out)"
echo "$out" | grep -q 'PERSIST=\[GH_TOKEN=pat-xyz NAME=MCP_FOO_OAUTH\]' && pass "rotated token: persisted via gh secret set using the PAT" || bad "rotated token persistence (got: $out)"

# 8. Rotated refresh token but NO secrets-write PAT → access token still exported
#    (run does not break), persistence simply skipped (warned on stderr).
out=$(run_case "$OAUTH_OK" '{"access_token":"fresh-8","refresh_token":"rt-2"}')
echo "$out" | grep -qx 'TOKEN=\[fresh-8\]' && pass "rotated token, no PAT: access token still exported" || bad "no-PAT rotation still exports token (got: $out)"

echo "---"
[ "$FAILED" = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
