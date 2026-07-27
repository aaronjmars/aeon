#!/usr/bin/env bash
# Tests for scripts/run-grok.sh — auth gating, invocation flags, and output
# normalization. Uses a fake `grok` on PATH so no network/CLI is required.
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

run() { echo "test prompt" | GROK_FAKE_OUT="$1" GROK_FAKE_RC="${2:-0}" MODEL="${3:-grok-4.5}" SKILL_MODE="${4:-write}" XAI_API_KEY=xai-test bash "$R" 2>/dev/null; }

# 1. Claude-shaped JSON normalizes to result + usage
OUT=$(run '{"result":"hi there","usage":{"input_tokens":11,"output_tokens":4}}')
[ "$(echo "$OUT" | jq -r '.result')" = "hi there" ] && pass "normalizes .result" || bad "normalizes .result (got: $OUT)"
[ "$(echo "$OUT" | jq -r '.usage.input_tokens')" = "11" ] && pass "normalizes usage.input_tokens" || bad "normalizes usage.input_tokens"

# 2. OpenAI-ish aliases (text / prompt_tokens) normalize too
OUT=$(run '{"text":"grok hi","usage":{"prompt_tokens":50,"completion_tokens":7}}')
[ "$(echo "$OUT" | jq -r '.result')" = "grok hi" ] && pass "maps .text alias" || bad "maps .text alias (got: $OUT)"
[ "$(echo "$OUT" | jq -r '.usage.output_tokens')" = "7" ] && pass "maps completion_tokens alias" || bad "maps completion_tokens alias"

# 2b. Exact real grok 0.2.82 shape: .text present, NO usage field → tokens = 0
OUT=$(run '{"text":"ok","stopReason":"EndTurn","sessionId":"s","requestId":"r","thought":"t"}')
[ "$(echo "$OUT" | jq -r '.result')" = "ok" ] && pass "real grok shape → .result from .text" || bad "real grok shape → .result (got: $OUT)"
[ "$(echo "$OUT" | jq -r '.usage.input_tokens')" = "0" ] && pass "real grok shape → 0 tokens (no usage field)" || bad "real grok shape → 0 tokens"

# 2c. grok's internal .thought is NEVER surfaced as the result (leak guard)
OUT=$(run '{"text":"visible answer","stopReason":"EndTurn","thought":"SECRET_CHAIN_OF_THOUGHT"}')
{ [ "$(echo "$OUT" | jq -r '.result')" = "visible answer" ] && ! echo "$OUT" | grep -q "SECRET_CHAIN_OF_THOUGHT"; } \
  && pass "does not leak .thought into result" || bad "leaked .thought (got: $OUT)"

# 2d. Cancelled/aborted with EMPTY text → hard fail; must NOT emit an empty result
# or raw-wrap the JSON (which would leak .thought). Regression for the grok-build
# 'Cancelled' run that committed chain-of-thought to the repo.
if OUT=$(run '{"text":"","stopReason":"Cancelled","thought":"SECRET"}' 0 2>/dev/null); then
  bad "Cancelled+empty should fail (got rc 0, out: $OUT)"
else
  echo "$OUT" | grep -q "SECRET" && bad "Cancelled+empty leaked .thought" || pass "Cancelled+empty fails without leaking .thought"
fi

# 2e. Clean EndTurn with empty text is a legitimate success (skill acted via tools,
# no final message) → result "" and exit 0, NOT a failure.
if OUT=$(run '{"text":"","stopReason":"EndTurn"}' 0 2>/dev/null); then
  [ "$(echo "$OUT" | jq -r '.result')" = "" ] && pass "empty EndTurn → clean empty result" || bad "empty EndTurn result (got: $OUT)"
else
  bad "empty EndTurn should succeed"
fi

# 3. Non-JSON stdout falls back to raw-text envelope (never "no output")
OUT=$(run 'plain text, not json')
[ "$(echo "$OUT" | jq -r '.result')" = "plain text, not json" ] && pass "wraps non-JSON stdout" || bad "wraps non-JSON stdout (got: $OUT)"

# 4. Invocation passes --output-format json, --no-auto-update, and the model
run '{"result":"x"}' >/dev/null
grep -qx -- "--output-format" "$ARGS_FILE" && grep -qx "json" "$ARGS_FILE" \
  && pass "passes --output-format json" || bad "passes --output-format json"
grep -qx -- "--no-auto-update" "$ARGS_FILE" && pass "passes --no-auto-update" || bad "passes --no-auto-update"
grep -qx -- "--no-subagents" "$ARGS_FILE" && pass "passes --no-subagents" || bad "passes --no-subagents"
grep -qx -- "--model" "$ARGS_FILE" && grep -qx "grok-4.5" "$ARGS_FILE" \
  && pass "passes --model for a real grok model" || bad "passes --model"
grep -qx -- "--permission-mode" "$ARGS_FILE" && grep -qx "bypassPermissions" "$ARGS_FILE" \
  && pass "passes permission flags from skill_mode" || bad "passes permission flags"
# compat preamble is appended to grok's system prompt via --rules
grep -qx -- "--rules" "$ARGS_FILE" && pass "passes --rules compat preamble" || bad "passes --rules compat preamble"

# 4b. --model is OMITTED for a leftover claude-* id or empty (grok uses its default)
echo "p" | GROK_FAKE_OUT='{"text":"x"}' MODEL=claude-sonnet-5 SKILL_MODE=write XAI_API_KEY=xai-test bash "$R" >/dev/null 2>&1
if grep -qx -- "--model" "$ARGS_FILE"; then bad "omits --model for claude-* id"; else pass "omits --model for claude-* id"; fi
echo "p" | GROK_FAKE_OUT='{"text":"x"}' MODEL="" SKILL_MODE=write XAI_API_KEY=xai-test bash "$R" >/dev/null 2>&1
if grep -qx -- "--model" "$ARGS_FILE"; then bad "omits --model for empty model"; else pass "omits --model for empty model"; fi

# 4c. grok-4.5 (grok's current default) is a real grok id → --model is passed through,
# and it's a reasoning model so GROK_EFFORT maps to --effort (unlike fast composer).
echo "p" | GROK_FAKE_OUT='{"text":"x"}' MODEL=grok-4.5 SKILL_MODE=write XAI_API_KEY=xai-test GROK_EFFORT=high bash "$R" >/dev/null 2>&1
grep -qx -- "--model" "$ARGS_FILE" && grep -qx "grok-4.5" "$ARGS_FILE" \
  && pass "passes --model grok-4.5" || bad "passes --model grok-4.5"
grep -qx -- "--effort" "$ARGS_FILE" && grep -qx "high" "$ARGS_FILE" \
  && pass "grok-4.5 is reasoning → GROK_EFFORT maps to --effort" || bad "grok-4.5 reasoning effort"

# 5. read-only mode adds --sandbox read-only
echo "p" | GROK_FAKE_OUT='{"result":"x"}' MODEL=grok-build-0.1 SKILL_MODE=read-only XAI_API_KEY=xai-test bash "$R" >/dev/null 2>&1
grep -qx -- "--sandbox" "$ARGS_FILE" && grep -qx "read-only" "$ARGS_FILE" \
  && pass "read-only run sandboxes grok" || bad "read-only run sandboxes grok"

# 6. grok non-zero exit → run-grok.sh fails
if run '{"result":"x"}' 1 >/dev/null 2>&1; then bad "propagates grok failure"; else pass "propagates grok failure"; fi

# 7. No auth at all (no XAI_API_KEY / GROK_CREDENTIALS / ~/.grok session) → hard fail.
# Use a clean HOME so an ambient ~/.grok/auth.json on the test machine can't satisfy it.
EMPTY_HOME="$(mktemp -d)"
if echo "p" | env -u XAI_API_KEY -u GROK_CREDENTIALS HOME="$EMPTY_HOME" GROK_FAKE_OUT='{"text":"x"}' MODEL="" SKILL_MODE=write bash "$R" >/dev/null 2>&1; then
  bad "fails without auth"
else
  pass "fails without auth"
fi
rm -rf "$EMPTY_HOME"

# 8. Run-shaping flags -------------------------------------------------------
# 8a. --max-turns defaults to 60 (runaway/cost guard)
run '{"result":"x"}' >/dev/null
grep -qx -- "--max-turns" "$ARGS_FILE" && grep -qx "60" "$ARGS_FILE" \
  && pass "default --max-turns 60" || bad "default --max-turns 60 (args: $(tr '\n' ' ' < "$ARGS_FILE"))"

# 8b. GROK_MAX_TURNS overrides; =0 removes the cap
echo "p" | GROK_FAKE_OUT='{"text":"x"}' MODEL="" SKILL_MODE=write XAI_API_KEY=xai-test GROK_MAX_TURNS=7 bash "$R" >/dev/null 2>&1
grep -qx "7" "$ARGS_FILE" && pass "GROK_MAX_TURNS overrides the cap" || bad "GROK_MAX_TURNS override"
echo "p" | GROK_FAKE_OUT='{"text":"x"}' MODEL="" SKILL_MODE=write XAI_API_KEY=xai-test GROK_MAX_TURNS=0 bash "$R" >/dev/null 2>&1
if grep -qx -- "--max-turns" "$ARGS_FILE"; then bad "GROK_MAX_TURNS=0 removes the cap"; else pass "GROK_MAX_TURNS=0 removes the cap"; fi

# 8c. GROK_EFFORT is gated on model capability: composer (default/empty) REJECTS
# reasoningEffort with a 400, so it must be skipped there; a grok-build model gets it.
echo "p" | GROK_FAKE_OUT='{"text":"x"}' MODEL=grok-build SKILL_MODE=write XAI_API_KEY=xai-test GROK_EFFORT=high bash "$R" >/dev/null 2>&1
grep -qx -- "--effort" "$ARGS_FILE" && grep -qx "high" "$ARGS_FILE" && pass "GROK_EFFORT=high → --effort on a reasoning model" || bad "GROK_EFFORT on grok-build"
echo "p" | GROK_FAKE_OUT='{"text":"x"}' MODEL="" SKILL_MODE=write XAI_API_KEY=xai-test GROK_EFFORT=high bash "$R" >/dev/null 2>&1
if grep -qx -- "--effort" "$ARGS_FILE"; then bad "GROK_EFFORT skipped on composer (would 400)"; else pass "GROK_EFFORT skipped on composer (would 400)"; fi
echo "p" | GROK_FAKE_OUT='{"text":"x"}' MODEL=grok-build SKILL_MODE=write XAI_API_KEY=xai-test GROK_EFFORT=turbo bash "$R" >/dev/null 2>&1
if grep -qx -- "--effort" "$ARGS_FILE"; then bad "invalid GROK_EFFORT is dropped"; else pass "invalid GROK_EFFORT is dropped"; fi

# 8d. GROK_BEST_OF_N (>=2) and GROK_CHECK map to flags AND drop --no-subagents
# (grok's parser rejects --no-subagents with either). N<2 is a no-op.
echo "p" | GROK_FAKE_OUT='{"text":"x"}' MODEL="" SKILL_MODE=write XAI_API_KEY=xai-test GROK_BEST_OF_N=3 GROK_CHECK=true bash "$R" >/dev/null 2>&1
grep -qx -- "--best-of-n" "$ARGS_FILE" && grep -qx "3" "$ARGS_FILE" && grep -qx -- "--check" "$ARGS_FILE" \
  && pass "GROK_BEST_OF_N=3 + GROK_CHECK → --best-of-n 3 --check" || bad "best-of-n/check mapping"
if grep -qx -- "--no-subagents" "$ARGS_FILE"; then bad "best-of-n/check drops --no-subagents"; else pass "best-of-n/check drops --no-subagents"; fi
echo "p" | GROK_FAKE_OUT='{"text":"x"}' MODEL="" SKILL_MODE=write XAI_API_KEY=xai-test GROK_BEST_OF_N=1 bash "$R" >/dev/null 2>&1
if grep -qx -- "--best-of-n" "$ARGS_FILE"; then bad "GROK_BEST_OF_N=1 is a no-op"; else pass "GROK_BEST_OF_N=1 is a no-op"; fi
grep -qx -- "--no-subagents" "$ARGS_FILE" && pass "default run keeps --no-subagents" || bad "default run keeps --no-subagents"

# 8d2. --check is dropped when --json-schema is set (grok refuses to combine them)
echo "p" | GROK_FAKE_OUT='{"text":"x"}' MODEL="" SKILL_MODE=write XAI_API_KEY=xai-test GROK_CHECK=true GROK_JSON_SCHEMA='{"type":"object"}' bash "$R" >/dev/null 2>&1
if grep -qx -- "--check" "$ARGS_FILE"; then bad "--check dropped when --json-schema present"; else pass "--check dropped when --json-schema present"; fi
grep -qx -- "--json-schema" "$ARGS_FILE" && pass "--json-schema kept over --check" || bad "--json-schema kept over --check"

# 8e. GROK_JSON_SCHEMA maps to --json-schema (structured output)
SCHEMA='{"type":"object"}'
echo "p" | GROK_FAKE_OUT='{"text":"x"}' MODEL="" SKILL_MODE=write XAI_API_KEY=xai-test GROK_JSON_SCHEMA="$SCHEMA" bash "$R" >/dev/null 2>&1
grep -qx -- "--json-schema" "$ARGS_FILE" && grep -Fqx "$SCHEMA" "$ARGS_FILE" \
  && pass "GROK_JSON_SCHEMA → --json-schema" || bad "GROK_JSON_SCHEMA mapping"

# 8f. .structuredOutput (grok-build under --json-schema) is normalized into .result
OUT=$(run '{"text":"interim chatter","structuredOutput":{"score":4,"flags":[]},"stopReason":"EndTurn","thought":"secret"}')
RES=$(echo "$OUT" | jq -r '.result')
{ echo "$RES" | jq -e '.score==4' >/dev/null 2>&1 && ! echo "$OUT" | grep -q "secret" && ! echo "$RES" | grep -q "interim"; } \
  && pass ".structuredOutput → .result (over .text, no thought leak)" || bad ".structuredOutput normalization (got: $OUT)"

# 9. MCP: a project .mcp.json → one --allow MCPTool(<srv>__*) per server -------
# grok discovers .mcp.json natively; run-grok.sh only grants permission to call.
MCPDIR="$(mktemp -d)"
cat > "$MCPDIR/.mcp.json" <<'JSON'
{ "mcpServers": {
  "github":   { "type": "http",  "url": "https://api.example/mcp/" },
  "seqthink": { "type": "stdio", "command": "npx", "args": ["-y", "pkg"] }
} }
JSON
( cd "$MCPDIR" && echo "p" | GROK_FAKE_OUT='{"text":"x"}' MODEL="" SKILL_MODE=write XAI_API_KEY=xai-test bash "$RABS" >/dev/null 2>&1 )
{ grep -Fqx "MCPTool(github__*)" "$ARGS_FILE" && grep -Fqx "MCPTool(seqthink__*)" "$ARGS_FILE"; } \
  && pass "MCP: one MCPTool allow per .mcp.json server" || bad "MCP allow rules (args: $(tr '\n' ' ' < "$ARGS_FILE"))"
# 9b. …and --trust, without which grok never STARTS a repo-local server on an
# untrusted checkout (every CI run) — the allows would then permit tools that
# don't exist, and the run goes green having silently skipped MCP.
grep -Fqx -- "--trust" "$ARGS_FILE" \
  && pass "MCP: --trust passed for a repo-local .mcp.json" || bad "MCP --trust missing (args: $(tr '\n' ' ' < "$ARGS_FILE"))"
rm -rf "$MCPDIR"

# 9c. No .mcp.json → no --trust (default untrusted posture preserved).
NOMCPDIR="$(mktemp -d)"
( cd "$NOMCPDIR" && echo "p" | GROK_FAKE_OUT='{"text":"x"}' MODEL="" SKILL_MODE=write XAI_API_KEY=xai-test bash "$RABS" >/dev/null 2>&1 )
grep -Fqx -- "--trust" "$ARGS_FILE" \
  && bad "MCP: --trust leaked into a run with no .mcp.json" || pass "MCP: no --trust without a .mcp.json"
rm -rf "$NOMCPDIR"

# 9b. No .mcp.json in cwd → no MCPTool rules leak in
TMPD="$(mktemp -d)"
( cd "$TMPD" && echo "p" | GROK_FAKE_OUT='{"text":"x"}' MODEL="" SKILL_MODE=write XAI_API_KEY=xai-test bash "$RABS" >/dev/null 2>&1 )
if grep -q "MCPTool(" "$ARGS_FILE"; then bad "no MCPTool rules without .mcp.json"; else pass "no MCPTool rules without .mcp.json"; fi
rm -rf "$TMPD"

# --- 10. OAuth durable refresh + persist (§2b) --------------------------------
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

# 10a. expired token + PAT → refresh happens AND the rotated secret is persisted
CREDS="$(seed_auth "2000-01-01T00:00:00.000000Z")"; GH_LOG="$OHOME/gh.log"; : >"$GH_LOG"
HOME="$OHOME" PATH="$OBIN:$PATH" GROK_CREDENTIALS="$CREDS" GH_SECRETS_PAT="pat-test" GH_LOG="$GH_LOG" \
  bash "$RABS" setup >/dev/null 2>"$OHOME/e1"
{ [ "$(authf key)" = "NEWACCESS" ] && [ "$(authf refresh_token)" = "RT1" ]; } \
  && pass "oauth: expired token refreshed in auth.json" || bad "oauth refresh (key=$(authf key) rt=$(authf refresh_token); err=$(cat "$OHOME/e1"))"
grep -q "secret set GROK_CREDENTIALS" "$GH_LOG" \
  && pass "oauth: rotated refresh token persisted via gh secret set" || bad "oauth persist not called (gh.log: $(cat "$GH_LOG"))"

# 10b. expired token, NO PAT → still refreshes on disk, must NOT persist, warns loudly
CREDS="$(seed_auth "2000-01-01T00:00:00.000000Z")"; GH_LOG="$OHOME/gh2.log"; : >"$GH_LOG"
HOME="$OHOME" PATH="$OBIN:$PATH" GROK_CREDENTIALS="$CREDS" GH_LOG="$GH_LOG" \
  bash "$RABS" setup >/dev/null 2>"$OHOME/e2"
{ [ "$(authf key)" = "NEWACCESS" ] && ! grep -q "secret set" "$GH_LOG" && grep -q "no secrets-write PAT" "$OHOME/e2"; } \
  && pass "oauth: no PAT → refreshes but does not persist (warns)" || bad "oauth no-PAT (key=$(authf key); gh=$(cat "$GH_LOG"); err=$(cat "$OHOME/e2"))"

# 10c. token still valid (far-future expiry) → skip refresh, no token-endpoint call
CREDS="$(seed_auth "2099-01-01T00:00:00.000000Z")"; CURL_LOG="$OHOME/curl.log"; : >"$CURL_LOG"
HOME="$OHOME" PATH="$OBIN:$PATH" GROK_CREDENTIALS="$CREDS" GH_SECRETS_PAT="pat-test" CURL_LOG="$CURL_LOG" \
  bash "$RABS" setup >/dev/null 2>"$OHOME/e3"
{ [ "$(authf key)" = "OLDACCESS" ] && [ ! -s "$CURL_LOG" ]; } \
  && pass "oauth: valid token → skips refresh" || bad "oauth skip-when-valid (key=$(authf key); curl=$(cat "$CURL_LOG"))"

# 10d. token endpoint returns invalid_grant → warn, keep on-disk token, exit 0
CREDS="$(seed_auth "2000-01-01T00:00:00.000000Z")"
HOME="$OHOME" PATH="$OBIN:$PATH" GROK_CREDENTIALS="$CREDS" GH_SECRETS_PAT="pat-test" \
  CURL_FAKE_OUT='{"error":"invalid_grant","error_description":"Refresh token has been revoked"}' \
  bash "$RABS" setup >/dev/null 2>"$OHOME/e4"; rc=$?
{ [ "$rc" = 0 ] && [ "$(authf key)" = "OLDACCESS" ] && grep -q "invalid_grant" "$OHOME/e4"; } \
  && pass "oauth: invalid_grant → warns, keeps token, rc 0" || bad "oauth invalid_grant (rc=$rc key=$(authf key) err=$(cat "$OHOME/e4"))"

# 10e. XAI_API_KEY path (no GROK_CREDENTIALS) → the OAuth refresh never runs
CURL_LOG="$OHOME/curl2.log"; : >"$CURL_LOG"
echo p | HOME="$OHOME" PATH="$OBIN:$PATH" XAI_API_KEY=xai-test GROK_FAKE_OUT='{"text":"x"}' MODEL="" SKILL_MODE=write CURL_LOG="$CURL_LOG" bash "$RABS" >/dev/null 2>&1
[ ! -s "$CURL_LOG" ] && pass "oauth: API-key path does not run the OAuth refresh" || bad "oauth refresh wrongly ran on API-key path"
rm -rf "$OBIN" "$OHOME"

echo "---"
[ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
