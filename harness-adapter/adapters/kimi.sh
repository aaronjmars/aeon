#!/usr/bin/env bash
# kimi adapter — Kimi Code (kimi) behind the Claude Code contract.
#
# kimi quirks this adapter absorbs:
#   * `kimi -p <text> --output-format stream-json` emits a JSONL stream of
#     {role,content} messages + a trailing {role:"meta"} resume hint -> .result
#     is the last assistant message's content.
#   * stream-json exposes no token usage -> counts normalize to 0.
#   * model is an alias resolved from config.toml providers; default here is a
#     small OpenRouter model (or-nano). --model / -m passes through.
#   * NO native FS sandbox and read-only is SANDBOX-ONLY (its -p mode executes
#     tools with no permission-layer gate) -> read-only relies entirely on the
#     dispatcher's wrapper OS sandbox.
#   * -p (one-shot) mode refuses -y/--yolo and --auto ("Cannot combine --prompt
#     with …") — it drives permissions itself, so no approval flag is passed.
#   * no --json-schema flag -> prompt-with-schema + validate + one retry.
#   * MCP: kimi's mcp.json is the SAME {mcpServers:...} shape as ours; injected
#     via a temp KIMI_CODE_HOME so nothing touches the user's config or workspace.
#
# rh-meta-start - capability manifest source of truth (bin/generate-harnesses-json)
# {
#   "id": "kimi",
#   "label": "Kimi Code",
#   "cli": { "install": "", "bin": "kimi", "min_version": "0.28.0" },
#   "invoke": "kimi -p --output-format stream-json",
#   "round_trip": true,
#   "token_usage": "none",
#   "cost": false,
#   "read_only": "sandbox",
#   "structured_output": "shim",
#   "mcp": "native+overlay",
#   "max_turns": "timeout",
#   "claude_md": "native",
#   "auth": { "native_oauth": ["KIMI_AUTH"], "native_key": ["MOONSHOT_API_KEY"], "openrouter": true },
#   "native_control_path": "run-harness"
# }
# rh-meta-end
set -uo pipefail
. "$RH_LIB/envelope.sh"
. "$RH_LIB/schema-retry.sh"

command -v kimi >/dev/null 2>&1 || { echo "kimi CLI not found" >&2; exit 1; }

ARGS=(--output-format stream-json)
[ -n "${RH_MODEL:-}" ] && [ "${RH_MODEL}" != "default" ] && ARGS+=(--model "$RH_MODEL")

# kimi has no --append-system-prompt -> prepend compat preamble + operator append
BASE="$(cat "$RH_PROMPT_FILE")"
[ -n "${RH_APPEND_SYSTEM_PROMPT:-}" ] && BASE="${RH_APPEND_SYSTEM_PROMPT}

${BASE}"
[ -n "${RH_COMPAT_RULES:-}" ] && BASE="${RH_COMPAT_RULES}

${BASE}"

# MCP: same {mcpServers:...} format as ours -> drop it in a temp KIMI_CODE_HOME
# (top-level config copied over to preserve the provider/auth config).
if [ -n "${RH_MCP_CONFIG:-}" ] && [ -f "${RH_MCP_CONFIG:-}" ]; then
  KH="$RH_TMPDIR/kimi-home"; mkdir -p "$KH"
  SRC="${KIMI_CODE_HOME:-$HOME/.kimi-code}"
  [ -d "$SRC" ] && find "$SRC" -maxdepth 1 -type f -exec cp {} "$KH/" \; 2>/dev/null
  cp "$RH_MCP_CONFIG" "$KH/mcp.json"
  export KIMI_CODE_HOME="$KH"
fi
[ -n "${RH_MAX_TURNS:-}" ] && \
  echo "notice: kimi has no --max-turns; the dispatcher wall-clock timeout is the guard" >&2

run_once() {  # run_once PROMPT -> sets RESULT/SID; returns kimi's rc
  local events="$RH_TMPDIR/kimi-events.jsonl" clean="$RH_TMPDIR/kimi-events.clean.jsonl"
  kimi -p "$1" "${ARGS[@]}" > "$events" 2>"$RH_TMPDIR/kimi.err"
  local rc=$?
  jq -cR 'fromjson? // empty' "$events" > "$clean"
  RESULT=$(jq -rs '
    [.[] | select((.role // "") == "assistant")
         | (.content
            | if type == "string" then .
              elif type == "array" then (map(.text // "") | join(""))
              else "" end)]
    | map(select(. != "")) | last // ""' "$clean")
  SID=$(jq -rs '[.[] | (.session_id // empty)] | first // ""' "$clean")
  return $rc
}

# structured output: no native flag -> prompt-with-schema + validate + one retry
PROMPT="$BASE"
[ -n "${RH_JSON_SCHEMA:-}" ] && PROMPT="${PROMPT}$(schema_prompt_suffix "$RH_JSON_SCHEMA")"

run_once "$PROMPT"
rc=$?
if [ $rc -ne 0 ] && [ -z "$RESULT" ]; then
  # 300 chars silently discarded the actual error whenever it was longer
  # than that; widened to match claude.sh's own harness-adapter precedent.
  echo "kimi exited $rc: $(tail -c 4000 "$RH_TMPDIR/kimi.err" | tr '\n' ' ')" >&2
  exit $rc
fi
if [ -z "$RESULT" ]; then
  echo "kimi produced no assistant message" >&2
  exit 3
fi

if [ -n "${RH_JSON_SCHEMA:-}" ]; then
  RESULT="$(schema_extract_json "$RESULT")"
  if ! schema_validate "$RH_JSON_SCHEMA" "$RESULT"; then
    echo "structured output failed validation — retrying once" >&2
    run_once "${PROMPT}$(schema_retry_suffix)" || true
    RESULT="$(schema_extract_json "$RESULT")"
    if ! schema_validate "$RH_JSON_SCHEMA" "$RESULT"; then
      echo "structured output still invalid after retry" >&2
      exit 3
    fi
  fi
fi

# TOKEN USAGE: kimi's stream-json carries NONE — verified against kimi-code on a
# live run, the stream emits only assistant message(s) and a final
# {role:"meta",type:"session.resume_hint"} event; no usage/token field appears
# anywhere, and the CLI exposes no usage flag (--output-format is text|stream-json
# only). There is also no OpenRouter generation-id to look up (only session_id is
# surfaced). Rather than report a misleading 0/0/0, fall back to a transparent
# char/4 ESTIMATE from the assembled input (BASE) and the result; a future kimi
# build that DOES emit usage would be picked up by the scan below first.
KIN=$(jq -rs '[.[] | (.usage.input_tokens // .usage.prompt_tokens // .input_tokens // empty)] | add // 0' "$RH_TMPDIR/kimi-events.clean.jsonl" 2>/dev/null || echo 0)
KOUT=$(jq -rs '[.[] | (.usage.output_tokens // .usage.completion_tokens // .output_tokens // empty)] | add // 0' "$RH_TMPDIR/kimi-events.clean.jsonl" 2>/dev/null || echo 0)
if [ "${KIN:-0}" = "0" ] && [ "${KOUT:-0}" = "0" ]; then
  KIN=$(( ${#BASE} / 4 )); KOUT=$(( ${#RESULT} / 4 ))
  echo "note: kimi exposes no token usage — reporting a char/4 estimate (in~$KIN out~$KOUT)" >&2
fi
emit_envelope "$RESULT" "$KIN" "$KOUT" 0 0 "" "$SID"
