#!/usr/bin/env bash
# GLM Coding Plan through Claude Code and Z.AI's documented Anthropic endpoint.
# rh-meta-start
# {"id":"glm","label":"GLM Coding Plan (Z.AI)","cli":{"install":"npm i -g @anthropic-ai/claude-code","bin":"claude","min_version":"2.1"},"invoke":"claude -p - --output-format json (Z.AI Anthropic endpoint)","round_trip":true,"token_usage":"full","cost":false,"read_only":"sandbox","structured_output":"native","mcp":"native","max_turns":"native","claude_md":"native+imports","auth":{"native_oauth":[],"native_key":["GLM_API_KEY","ZAI_API_KEY"],"openrouter":false},"native_control_path":"run-harness"}
# rh-meta-end
set -uo pipefail
. "$RH_LIB/envelope.sh"
command -v claude >/dev/null 2>&1 || { echo "Claude CLI not found (npm i -g @anthropic-ai/claude-code)" >&2; exit 1; }
[ -n "${GLM_API_KEY:-${ZAI_API_KEY:-}}" ] || { echo "glm needs GLM_API_KEY (or ZAI_API_KEY)" >&2; exit 1; }
export ANTHROPIC_API_KEY="${GLM_API_KEY:-$ZAI_API_KEY}"; export ANTHROPIC_BASE_URL="https://api.z.ai/api/anthropic"; export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
ARGS=(-p - --output-format json); [ -n "${RH_MODEL:-}" ] && [ "$RH_MODEL" != "default" ] && ARGS+=(--model "$RH_MODEL"); [ -n "${RH_ALLOWED_TOOLS:-}" ] && ARGS+=(--allowedTools "$RH_ALLOWED_TOOLS"); [ -n "${RH_MCP_CONFIG:-}" ] && [ -f "${RH_MCP_CONFIG:-}" ] && ARGS+=(--mcp-config "$RH_MCP_CONFIG" --strict-mcp-config); [ -n "${RH_MAX_TURNS:-}" ] && ARGS+=(--max-turns "$RH_MAX_TURNS"); [ -n "${RH_JSON_SCHEMA:-}" ] && ARGS+=(--json-schema "$RH_JSON_SCHEMA"); [ -n "${RH_APPEND_SYSTEM_PROMPT:-}" ] && ARGS+=(--append-system-prompt "$RH_APPEND_SYSTEM_PROMPT")
OUT="$RH_TMPDIR/glm-out.json"; claude "${ARGS[@]}" < "$RH_PROMPT_FILE" > "$OUT"; rc=$?; [ $rc -ne 0 ] && { echo "glm exited $rc: $(tail -c 4000 "$OUT" | tr '\n' ' ')" >&2; exit $rc; }; jq -e 'type == "object"' "$OUT" >/dev/null 2>&1 || { echo "error: glm output was not a JSON object; rejecting raw output" >&2; wrap_raw_output < "$OUT"; exit 3; }; jq -c 'if (.structured_output // null) != null and ((.result // "") == "") then .result = (.structured_output | tojson) else . end' "$OUT"
