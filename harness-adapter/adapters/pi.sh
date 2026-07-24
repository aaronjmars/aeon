#!/usr/bin/env bash
# pi adapter — Pi (@earendil-works/pi-coding-agent) behind the Claude Code contract.
#
# Pi quirks this adapter absorbs:
#   * `pi -p --mode json` emits a JSONL EVENT STREAM (session header, message_end,
#     agent_end, ...) -> result is the last assistant message_end text.
#   * usage (tokens + cache + usage.cost.total) rides on assistant messages —
#     the only harness besides Claude with native dollar cost. Field names are
#     probed defensively (input/input_tokens, cacheRead/cache_read, ...).
#   * NO permission system by design ("YOLO mode") -> read-only maps to
#     --exclude-tools write,edit; the dispatcher's wrapper OS sandbox is the real
#     guard. pi has read/bash/edit/write and NO web tool, so bash is its only
#     route to the network — never allow-list it away on read-only runs.
#   * MCP is deliberately unsupported -> warn and skip (pi's answer: wrap MCP
#     servers as CLI tools with READMEs, or add an extension).
#   * reads AGENTS.md or CLAUDE.md natively (global -> parents -> cwd); Claude's
#     @imports are NOT expanded (dispatcher pre-expands when needed).
#   * no structured-output flag -> prompt-with-schema + validate + one retry.
set -uo pipefail
. "$RH_LIB/envelope.sh"
. "$RH_LIB/tools-grammar.sh"
. "$RH_LIB/schema-retry.sh"

command -v pi >/dev/null 2>&1 || {
  echo "pi CLI not found (npm i -g --ignore-scripts @earendil-works/pi-coding-agent)" >&2; exit 1; }

ARGS=(--mode json --no-session --approve)

# model: pi is multi-provider — pass anything through (its registry matches
# patterns like "claude-sonnet-5", "openai/gpt-4o", or bare "sonnet")
[ -n "${RH_MODEL:-}" ] && [ "${RH_MODEL}" != "default" ] && ARGS+=(--model "$RH_MODEL")

# read-only -> tool subsetting (pi's only native lever; advisory without the
# dispatcher's wrapper sandbox)
# read-only DENIES mutation tools rather than allow-listing a filesystem subset:
# an allowlist silently dropped `bash`, and with no web tool of its own that left
# pi with no network at all. See tools_to_pi_exclude() for the measured failure.
if [ -n "${RH_ALLOWED_TOOLS:-}" ]; then
  PI_EXCLUDE=$(tools_to_pi_exclude "$RH_ALLOWED_TOOLS")
  [ -n "$PI_EXCLUDE" ] && ARGS+=(--exclude-tools "$PI_EXCLUDE")
elif [ "${RH_MODE:-write}" = "read-only" ]; then
  ARGS+=(--exclude-tools "write,edit")
fi

# compat preamble + operator append -> one --append-system-prompt
SYS="${RH_COMPAT_RULES:-}"
if [ -n "${RH_APPEND_SYSTEM_PROMPT:-}" ]; then
  SYS="${SYS:+$SYS
}${RH_APPEND_SYSTEM_PROMPT}"
fi
[ -n "$SYS" ] && ARGS+=(--append-system-prompt "$SYS")

if [ -n "${RH_MCP_CONFIG:-}" ] && [ -f "${RH_MCP_CONFIG:-}" ]; then
  SRVS=$(jq -r '.mcpServers // {} | keys | join(", ")' "$RH_MCP_CONFIG")
  [ -n "$SRVS" ] && echo "warning: pi does not support MCP by design — skipping server(s): $SRVS" >&2
fi

[ -n "${RH_MAX_TURNS:-}" ] && \
  echo "notice: pi has no --max-turns; the dispatcher wall-clock timeout is the guard" >&2

run_once() {
  # run_once PROMPT -> sets TEXT/TIN/TOUT/TCR/TCC/COST/SID; returns pi's rc
  local prompt="$1"
  local events="$RH_TMPDIR/pi-events.jsonl"
  local clean="$RH_TMPDIR/pi-events.clean.jsonl"
  pi -p "${ARGS[@]}" "$prompt" > "$events"
  local rc=$?
  jq -cR 'fromjson? // empty' "$events" > "$clean"
  TEXT=$(jq -rs '
    [.[] | select(.type == "message_end") | (.message // {})
         | select((.role // "") == "assistant")
         | (.content
            | if type == "string" then .
              elif type == "array" then (map(.text // "") | join(""))
              else tostring end)]
    | last // ""' "$clean")
  local usage
  usage=$(jq -cs '
    [.[] | select(.type == "message_end") | (.message // {})
         | select((.role // "") == "assistant") | (.usage // {})]
    | last // {}' "$clean")
  TIN=$(jq -r '.input // .input_tokens // .inputTokens // 0' <<<"$usage")
  TOUT=$(jq -r '.output // .output_tokens // .outputTokens // 0' <<<"$usage")
  TCR=$(jq -r '.cacheRead // .cache_read // 0' <<<"$usage")
  TCC=$(jq -r '.cacheWrite // .cache_write // 0' <<<"$usage")
  COST=$(jq -r '.cost.total // empty' <<<"$usage")
  SID=$(jq -rs '[.[] | select(.type == "session") | (.id // empty)] | first // ""' "$clean")
  DONE=$(jq -s '[.[] | select(.type == "agent_end")] | length' "$clean")
  return $rc
}

PROMPT="$(cat "$RH_PROMPT_FILE")"
[ -n "${RH_JSON_SCHEMA:-}" ] && PROMPT="${PROMPT}$(schema_prompt_suffix "$RH_JSON_SCHEMA")"

run_once "$PROMPT"
rc=$?
if [ $rc -ne 0 ] && [ -z "${TEXT:-}" ]; then
  echo "pi exited $rc with no output" >&2
  exit $rc
fi
if [ "${DONE:-0}" -eq 0 ] && [ -z "$TEXT" ]; then
  echo "pi run ended without agent_end and produced no output" >&2
  exit 3
fi

# structured output: validate; one corrective retry
if [ -n "${RH_JSON_SCHEMA:-}" ]; then
  TEXT="$(schema_extract_json "$TEXT")"
  if ! schema_validate "$RH_JSON_SCHEMA" "$TEXT"; then
    echo "structured output failed validation — retrying once" >&2
    run_once "${PROMPT}$(schema_retry_suffix)" || true
    TEXT="$(schema_extract_json "$TEXT")"
    if ! schema_validate "$RH_JSON_SCHEMA" "$TEXT"; then
      echo "structured output still invalid after retry" >&2
      exit 3
    fi
  fi
fi

emit_envelope "$TEXT" "${TIN:-0}" "${TOUT:-0}" "${TCR:-0}" "${TCC:-0}" "${COST:-}" "${SID:-}"
