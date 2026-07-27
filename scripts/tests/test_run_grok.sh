#!/usr/bin/env bash
# Tests for scripts/run-grok.sh — which now only STAGES grok (CLI pin + auth
# restore + durable OAuth refresh). Its run path moved to harness-adapter; the
# flag/envelope/MCP coverage that used to live here is in
# scripts/tests/test_harness_adapter_grok.sh. Uses a fake `grok`/`curl`/`gh` on
# PATH so no network or real CLI is required.
# Run: bash scripts/tests/test_run_grok.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
R="scripts/run-grok.sh"
RABS="$(pwd)/scripts/run-grok.sh"   # absolute — some tests run from a temp cwd
fail=0
pass() { echo "ok   - $1"; }
bad()  { echo "FAIL - $1"; fail=1; }

command -v jq >/dev/null 2>&1 || { echo "SKIP - jq not installed"; exit 0; }

BIN="$(mktemp -d)"
ARGS_FILE="$BIN/grok-args.txt"
cleanup() { rm -rf "$BIN"; }
trap cleanup EXIT

# Fake grok: record argv, emit $GROK_FAKE_OUT to stdout, exit $GROK_FAKE_RC.
cat > "$BIN/grok" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$GROK_ARGS_FILE"
[ -n "${GROK_FAKE_STDERR:-}" ] && printf '%s\n' "$GROK_FAKE_STDERR" >&2
printf '%s' "${GROK_FAKE_OUT:-}"
exit "${GROK_FAKE_RC:-0}"
EOF
chmod +x "$BIN/grok"
export GROK_ARGS_FILE="$ARGS_FILE"
export PATH="$BIN:$PATH"

# --- 1. subcommand contract -------------------------------------------------
# `setup` is the only verb. A stale caller using the OLD run contract (prompt on
# stdin, expecting an envelope on stdout) must FAIL LOUDLY - staging grok and
# exiting 0 would hand it empty stdout, which reads as "the model returned
# nothing": exactly the silent no-op this consolidation removed.
echo "prompt" | XAI_API_KEY=xai-test bash "$R" run >/dev/null 2>"$BIN/e0"; rc=$?
{ [ "$rc" = 2 ] && grep -q "does not run skills" "$BIN/e0"; } \
  && pass "rejects a non-setup subcommand with a pointer to run-harness" \
  || bad "stale run invocation should exit 2 (rc=$rc, err=$(cat "$BIN/e0"))"

# `setup` and a bare invocation both stage and exit 0, emitting NOTHING on stdout.
OUT=$(XAI_API_KEY=xai-test bash "$R" setup 2>/dev/null); rc=$?
{ [ "$rc" = 0 ] && [ -z "$OUT" ]; } \
  && pass "setup exits 0 with empty stdout" || bad "setup (rc=$rc out=$OUT)"
XAI_API_KEY=xai-test bash "$R" >/dev/null 2>&1 \
  && pass "bare invocation defaults to setup" || bad "bare invocation should default to setup"

# The run path is GONE - staging must never invoke the grok binary.
: > "$ARGS_FILE"
XAI_API_KEY=xai-test bash "$R" setup >/dev/null 2>&1
[ ! -s "$ARGS_FILE" ] && pass "setup never invokes the grok binary" \
  || bad "setup invoked grok (args: $(tr '\n' ' ' < "$ARGS_FILE"))"

# --- 2. auth gating ---------------------------------------------------------
# No XAI_API_KEY / GROK_CREDENTIALS / ~/.grok session → hard fail, so a misconfigured
# repo surfaces at staging instead of at the model call.
EMPTY_HOME="$(mktemp -d)"
if env -u XAI_API_KEY -u GROK_CREDENTIALS HOME="$EMPTY_HOME" bash "$R" setup >/dev/null 2>&1; then
  bad "no auth should fail"
else
  pass "no auth (no key, no creds, no session) fails loudly"
fi
rm -rf "$EMPTY_HOME"

# --- 3. OAuth durable refresh + persist (§2b) --------------------------------
# The captured GROK_CREDENTIALS rotates its refresh token on refresh; run-grok.sh
# must refresh from it AND persist the rotated auth.json back to the secret, or auth
# breaks ~6h after capture. Fake curl (token endpoint) + fake gh (secret persist),
# a temp HOME seeded with an EXPIRED grok auth.json, driven through `run-grok.sh setup`.
OBIN="$(mktemp -d)"; OHOME="$(mktemp -d)"
cat > "$OBIN/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${CURL_LOG:-/dev/null}"
if [ -n "${CURL_FAKE_OUT:-}" ]; then printf '%s' "$CURL_FAKE_OUT"
else printf '%s' '{"access_token":"NEWACCESS","refresh_token":"RT1","expires_in":21600}'; fi
EOF
cat > "$OBIN/gh" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null                        # consume the piped base64 secret
printf '%s\n' "$*" >> "${GH_LOG:-/dev/null}"
exit 0
EOF
chmod +x "$OBIN/curl" "$OBIN/gh"

seed_auth() {  # $1 = expires_at → prints a GROK_CREDENTIALS (base64 tar of .grok/auth.json)
  mkdir -p "$OHOME/.grok"
  cat > "$OHOME/.grok/auth.json" <<EOF
{"https://auth.x.ai::CID":{"key":"OLDACCESS","auth_mode":"oidc","refresh_token":"RT0","expires_at":"$1","oidc_issuer":"https://auth.x.ai","oidc_client_id":"CID"}}
EOF
  tar czf - -C "$OHOME" .grok/auth.json | base64
}
authf() { jq -r ".[\"https://auth.x.ai::CID\"].$1" "$OHOME/.grok/auth.json"; }

# 3a. expired token + PAT → refresh happens AND the rotated secret is persisted
CREDS="$(seed_auth "2000-01-01T00:00:00.000000Z")"; GH_LOG="$OHOME/gh.log"; : >"$GH_LOG"
HOME="$OHOME" PATH="$OBIN:$PATH" GROK_CREDENTIALS="$CREDS" GH_SECRETS_PAT="pat-test" GH_LOG="$GH_LOG" \
  bash "$RABS" setup >/dev/null 2>"$OHOME/e1"
{ [ "$(authf key)" = "NEWACCESS" ] && [ "$(authf refresh_token)" = "RT1" ]; } \
  && pass "oauth: expired token refreshed in auth.json" || bad "oauth refresh (key=$(authf key) rt=$(authf refresh_token); err=$(cat "$OHOME/e1"))"
grep -q "secret set GROK_CREDENTIALS" "$GH_LOG" \
  && pass "oauth: rotated refresh token persisted via gh secret set" || bad "oauth persist not called (gh.log: $(cat "$GH_LOG"))"

# 3b. expired token, NO PAT → still refreshes on disk, must NOT persist, warns loudly
CREDS="$(seed_auth "2000-01-01T00:00:00.000000Z")"; GH_LOG="$OHOME/gh2.log"; : >"$GH_LOG"
HOME="$OHOME" PATH="$OBIN:$PATH" GROK_CREDENTIALS="$CREDS" GH_LOG="$GH_LOG" \
  bash "$RABS" setup >/dev/null 2>"$OHOME/e2"
{ [ "$(authf key)" = "NEWACCESS" ] && ! grep -q "secret set" "$GH_LOG" && grep -q "no secrets-write PAT" "$OHOME/e2"; } \
  && pass "oauth: no PAT → refreshes but does not persist (warns)" || bad "oauth no-PAT (key=$(authf key); gh=$(cat "$GH_LOG"); err=$(cat "$OHOME/e2"))"

# 3c. token still valid (far-future expiry) → skip refresh, no token-endpoint call
CREDS="$(seed_auth "2099-01-01T00:00:00.000000Z")"; CURL_LOG="$OHOME/curl.log"; : >"$CURL_LOG"
HOME="$OHOME" PATH="$OBIN:$PATH" GROK_CREDENTIALS="$CREDS" GH_SECRETS_PAT="pat-test" CURL_LOG="$CURL_LOG" \
  bash "$RABS" setup >/dev/null 2>"$OHOME/e3"
{ [ "$(authf key)" = "OLDACCESS" ] && [ ! -s "$CURL_LOG" ]; } \
  && pass "oauth: valid token → skips refresh" || bad "oauth skip-when-valid (key=$(authf key); curl=$(cat "$CURL_LOG"))"

# 3d. token endpoint returns invalid_grant → warn, keep on-disk token, exit 0
CREDS="$(seed_auth "2000-01-01T00:00:00.000000Z")"
HOME="$OHOME" PATH="$OBIN:$PATH" GROK_CREDENTIALS="$CREDS" GH_SECRETS_PAT="pat-test" \
  CURL_FAKE_OUT='{"error":"invalid_grant","error_description":"Refresh token has been revoked"}' \
  bash "$RABS" setup >/dev/null 2>"$OHOME/e4"; rc=$?
{ [ "$rc" = 0 ] && [ "$(authf key)" = "OLDACCESS" ] && grep -q "invalid_grant" "$OHOME/e4"; } \
  && pass "oauth: invalid_grant → warns, keeps token, rc 0" || bad "oauth invalid_grant (rc=$rc key=$(authf key) err=$(cat "$OHOME/e4"))"

# 3e. XAI_API_KEY path (no GROK_CREDENTIALS) → the OAuth refresh never runs
CURL_LOG="$OHOME/curl2.log"; : >"$CURL_LOG"
HOME="$OHOME" PATH="$OBIN:$PATH" XAI_API_KEY=xai-test CURL_LOG="$CURL_LOG" bash "$RABS" setup >/dev/null 2>&1
[ ! -s "$CURL_LOG" ] && pass "oauth: API-key path does not run the OAuth refresh" || bad "oauth refresh wrongly ran on API-key path"
rm -rf "$OBIN" "$OHOME"

echo "---"
[ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
