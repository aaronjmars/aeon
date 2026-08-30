#!/usr/bin/env bash
# Cursor CLI adapter: documented `agent -p` headless mode.
# rh-meta-start
# {"id":"cursor","label":"Cursor CLI","cli":{"install":"curl -fsSL https://cursor.com/install | bash","bin":"agent","min_version":"latest"},"invoke":"agent -p --trust --output-format json","round_trip":true,"token_usage":"none","cost":false,"read_only":"sandbox","structured_output":"shim","mcp":"native","max_turns":"none","claude_md":"native","auth":{"native_oauth":[],"native_key":["CURSOR_API_KEY"],"openrouter":false},"native_control_path":"run-harness"}
# rh-meta-end
set -uo pipefail
. "$RH_LIB/envelope.sh"
. "$RH_LIB/schema-retry.sh"
command -v agent >/dev/null 2>&1 || { echo "Cursor CLI not found (curl -fsSL https://cursor.com/install | bash)" >&2; exit 1; }
CURSOR_HOME="$RH_TMPDIR/cursor-home"; mkdir -p "$CURSOR_HOME/.cursor"; export HOME="$CURSOR_HOME"
if [ -n "${RH_MCP_CONFIG:-}" ] && [ -f "${RH_MCP_CONFIG:-}" ]; then cp "$RH_MCP_CONFIG" "$HOME/.cursor/mcp.json"; fi
PROMPT="$(cat "$RH_PROMPT_FILE")"; PREFIX="${RH_COMPAT_RULES:-}"
[ -n "${RH_APPEND_SYSTEM_PROMPT:-}" ] && PREFIX="${PREFIX:+$PREFIX$'\n'}${RH_APPEND_SYSTEM_PROMPT}"
[ -n "$PREFIX" ] && PROMPT="${PREFIX}\n\n${PROMPT}"
[ -n "${RH_JSON_SCHEMA:-}" ] && PROMPT="${PROMPT}$(schema_prompt_suffix "$RH_JSON_SCHEMA")"
ARGS=(-p --output-format json)
[ -n "${RH_MODEL:-}" ] && [ "$RH_MODEL" != "default" ] && ARGS+=(--model "$RH_MODEL")
# Headless CI always starts from a fresh HOME, so the workspace has no persisted
# trust decision. --trust skips only that prompt; unlike --force, it does not
# grant command execution or file writes.
ARGS+=(--trust)
[ "${RH_MODE:-write}" != "read-only" ] && ARGS+=(--force)
OUT="$RH_TMPDIR/cursor-out.json"; printf '%s' "$PROMPT" | agent "${ARGS[@]}" > "$OUT"; rc=$?
[ $rc -ne 0 ] && { echo "cursor exited $rc: $(tail -c 4000 "$OUT" | tr '\n' ' ')" >&2; exit $rc; }
if jq -e . "$OUT" >/dev/null 2>&1; then
  RESULT=$(jq -r 'if (.result // null) != null then (.result | if type == "string" then . else tojson end) elif (.output // null) != null then (.output | if type == "string" then . else tojson end) elif (.text // null) != null then . else tostring end' "$OUT")
  TIN=$(jq -r '.usage.input_tokens // .usage.inputTokens // 0' "$OUT"); TOUT=$(jq -r '.usage.output_tokens // .usage.outputTokens // 0' "$OUT"); TCR=$(jq -r '.usage.cache_read_input_tokens // .usage.cacheReadInputTokens // 0' "$OUT"); SID=$(jq -r '.session_id // .sessionId // ""' "$OUT")
else
  echo "error: cursor returned non-JSON output; rejecting raw output" >&2
  wrap_raw_output < "$OUT"
  exit 3
fi
if [ -n "${RH_JSON_SCHEMA:-}" ]; then RESULT="$(schema_extract_json "$RESULT")"; schema_validate "$RH_JSON_SCHEMA" "$RESULT" || { echo "structured output failed validation" >&2; exit 3; }; fi
emit_envelope "$RESULT" "${TIN:-0}" "${TOUT:-0}" "${TCR:-0}" 0 "" "${SID:-}"
