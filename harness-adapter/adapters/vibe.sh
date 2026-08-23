#!/usr/bin/env bash
# vibe adapter — Mistral Vibe (vibe) behind the Claude Code contract.
#
# vibe quirks this adapter absorbs:
#   * `vibe -p <text> --output json` prints a JSON ARRAY of all session messages
#     at the end -> .result is the last assistant message's `content` (never its
#     `reasoning_content`).
#   * json mode exposes no token usage -> counts normalize to 0 (vibe meters cost
#     internally for --max-price but does not emit it here).
#   * native --max-turns is honored; reads repo AGENTS.md natively.
#   * NO native FS sandbox -> read-only relies on the dispatcher's wrapper OS
#     sandbox plus --disabled-tools write_file,edit. --auto-approve is passed in
#     BOTH modes: it gates PROMPTING, not writing, so withholding it headless
#     strands every tool call (reads and web included) rather than restricting
#     anything.
#   * no --json-schema flag -> prompt-with-schema + validate + one retry.
#   * MCP: config.toml [[mcp_servers]]; injected via a temp VIBE_HOME so nothing
#     touches the user's config or workspace.
#
# rh-meta-start - capability manifest source of truth (bin/generate-harnesses-json)
# {
#   "id": "vibe",
#   "label": "Mistral Vibe",
#   "cli": { "install": "", "bin": "vibe", "min_version": "2.20.0" },
#   "invoke": "vibe -p --output json",
#   "round_trip": true,
#   "token_usage": "none",
#   "cost": false,
#   "read_only": "sandbox",
#   "structured_output": "shim",
#   "mcp": "native",
#   "max_turns": "native",
#   "claude_md": "native",
#   "auth": { "native_oauth": [], "native_key": ["MISTRAL_API_KEY"], "openrouter": true },
#   "native_control_path": "run-harness"
# }
# rh-meta-end
set -uo pipefail
. "$RH_LIB/envelope.sh"
. "$RH_LIB/schema-retry.sh"
. "$RH_LIB/mcp-translate.sh"

command -v vibe >/dev/null 2>&1 || { echo "vibe CLI not found" >&2; exit 1; }

ARGS=(--output json)
[ -n "${RH_MODEL:-}" ] && [ "${RH_MODEL}" != "default" ] && ARGS+=(--model "$RH_MODEL")
# --auto-approve in BOTH modes. It means "approve all tool calls without
# prompting" — withholding it headless does not restrict writes, it strands
# EVERY tool call (read and web included) on a prompt nobody answers. Measured on
# a real aeon runner: vibe ended github-trending with "network access is blocked
# in this environment" and committed a FABRICATED slate of invented repos, which
# the run reported as success. Mutation is blocked by the wrapper OS sandbox and
# by dropping the two write tools below, not by withholding approval.
ARGS+=(--auto-approve)
# Tool names are snake_case of vibe's class names (vibe/core/tools/base.py:368):
# WriteFile -> write_file, Edit -> edit. bash stays, so curl/network keep working;
# a write attempted through it hits the sandbox.
[ "${RH_MODE:-write}" = "read-only" ] && ARGS+=(--disabled-tools write_file --disabled-tools edit)
[ -n "${RH_MAX_TURNS:-}" ] && ARGS+=(--max-turns "$RH_MAX_TURNS")

# vibe has no --append-system-prompt -> prepend compat preamble + operator append
BASE="$(cat "$RH_PROMPT_FILE")"
[ -n "${RH_APPEND_SYSTEM_PROMPT:-}" ] && BASE="${RH_APPEND_SYSTEM_PROMPT}

${BASE}"
[ -n "${RH_COMPAT_RULES:-}" ] && BASE="${RH_COMPAT_RULES}

${BASE}"

# MCP: translate to config.toml [[mcp_servers]] inside a temp VIBE_HOME (top-level
# config copied over to preserve auth), so we never edit the user's real config.
# Vibe seeds `mcp_servers = []` (inline empty array); strip that line first, since
# TOML won't let [[mcp_servers]] tables extend an inline-declared array.
if [ -n "${RH_MCP_CONFIG:-}" ] && [ -f "${RH_MCP_CONFIG:-}" ]; then
  VH="$RH_TMPDIR/vibe-home"; mkdir -p "$VH"
  SRC="${VIBE_HOME:-$HOME/.vibe}"
  [ -d "$SRC" ] && find "$SRC" -maxdepth 1 -type f -exec cp {} "$VH/" \; 2>/dev/null
  if [ -f "$VH/config.toml" ]; then
    grep -vE '^[[:space:]]*mcp_servers[[:space:]]*=' "$VH/config.toml" > "$VH/config.toml.tmp" \
      && mv "$VH/config.toml.tmp" "$VH/config.toml"
  fi
  mcp_to_vibe_toml "$RH_MCP_CONFIG" >> "$VH/config.toml"
  export VIBE_HOME="$VH"
fi

run_once() {  # run_once PROMPT -> sets RESULT/BADSHAPE; returns vibe's rc
  vibe -p "$1" "${ARGS[@]}" > "$RH_TMPDIR/vibe-out.json" 2>"$RH_TMPDIR/vibe.err"
  local rc=$?
  if jq -e 'type == "array"' "$RH_TMPDIR/vibe-out.json" >/dev/null 2>&1; then
    RESULT=$(jq -r '
      [.[] | select((.role // "") == "assistant")
           | (.content | if type == "string" then . else tostring end)]
      | map(select(. != "")) | last // ""' "$RH_TMPDIR/vibe-out.json")
    BADSHAPE=0
  else
    RESULT=""; BADSHAPE=1
  fi
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
  echo "vibe exited $rc: $(tail -c 4000 "$RH_TMPDIR/vibe.err" | tr '\n' ' ')" >&2
  exit $rc
fi
if [ "${BADSHAPE:-0}" = "1" ]; then
  echo "warning: vibe output was not a JSON array — wrapping raw" >&2
  wrap_raw_output < "$RH_TMPDIR/vibe-out.json"; exit 0
fi
if [ -z "$RESULT" ]; then
  echo "vibe produced no assistant message" >&2
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

# TOKEN USAGE: vibe's --output json carries none (it meters cost internally for
# --max-price but does not emit token counts in the message array). Prefer real
# usage if a build ever emits it; otherwise fall back to a transparent char/4
# ESTIMATE from the assembled input (BASE) and the result, rather than reporting a
# misleading 0/0/0. (kimi's identical claim was verified live; vibe's is guarded
# here so real counts always win if present.)
VIN=$(jq -r '[.[] | (.usage.input_tokens // .usage.prompt_tokens // .input_tokens // empty)] | add // 0' "$RH_TMPDIR/vibe-out.json" 2>/dev/null || echo 0)
VOUT=$(jq -r '[.[] | (.usage.output_tokens // .usage.completion_tokens // .output_tokens // empty)] | add // 0' "$RH_TMPDIR/vibe-out.json" 2>/dev/null || echo 0)
if [ "${VIN:-0}" = "0" ] && [ "${VOUT:-0}" = "0" ]; then
  VIN=$(( ${#BASE} / 4 )); VOUT=$(( ${#RESULT} / 4 ))
  echo "note: vibe exposes no token usage — reporting a char/4 estimate (in~$VIN out~$VOUT)" >&2
fi
emit_envelope "$RESULT" "$VIN" "$VOUT" 0 0 "" ""
