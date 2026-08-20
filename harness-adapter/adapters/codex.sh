#!/usr/bin/env bash
# codex adapter — OpenAI Codex CLI behind the Claude Code contract.
#
# Codex quirks this adapter absorbs:
#   * `codex exec --json` emits a JSONL EVENT STREAM, not a final result object
#     -> result comes from --output-last-message (belt) or the last
#        item.completed agent_message (braces); usage is SUMMED over every
#        turn.completed event (field names: input_tokens, cached_input_tokens,
#        output_tokens). No dollar-cost field exists.
#   * approval-needed actions are silently auto-denied headlessly (deny-and-
#     continue, like Claude) -> approval_policy=never, sandbox picked by mode.
#   * workspace-write blocks network by default -> we enable it (skills fetch).
#   * no project .mcp.json support -> translated to -c mcp_servers.* overrides.
#   * CLAUDE.md ignored by default -> added as an AGENTS.md fallback filename.
#   * no --max-turns -> the dispatcher's wall-clock timeout is the runaway guard.
#
# rh-meta-start - capability manifest source of truth (bin/generate-harnesses-json)
# {
#   "id": "codex",
#   "label": "OpenAI Codex CLI",
#   "cli": { "install": "npm i -g @openai/codex", "bin": "codex", "min_version": "0.144.6" },
#   "invoke": "codex exec --json -",
#   "round_trip": true,
#   "token_usage": "full",
#   "cost": false,
#   "read_only": "native",
#   "structured_output": "native",
#   "mcp": "native+inline-toml",
#   "max_turns": "timeout",
#   "claude_md": "fallback",
#   "auth": { "native_oauth": ["CODEX_AUTH"], "native_key": ["OPENAI_API_KEY"], "openrouter": true },
#   "native_control_path": "run-harness"
# }
# rh-meta-end
set -uo pipefail
. "$RH_LIB/envelope.sh"
. "$RH_LIB/mcp-translate.sh"

command -v codex >/dev/null 2>&1 || {
  echo "codex CLI not found (npm i -g @openai/codex)" >&2; exit 1; }

ARGS=(exec --json --skip-git-repo-check --ephemeral)

# model: only pass ids codex can serve; a claude-*/grok-* leftover -> codex default
case "${RH_MODEL:-}" in
  "" | default | claude-* | grok-*) ;;
  *) ARGS+=(--model "$RH_MODEL") ;;
esac

# Sandbox. codex is the only harness with a native kernel sandbox, but its
# `--sandbox read-only` ALSO blocks the network: network_access lives under
# [sandbox_workspace_write] and applies to that mode only (`codex --help`: sandbox
# modes are read-only | workspace-write | danger-full-access), so there is no
# codex-native "FS-read-only + network" mode. aeon's read-only skills are
# overwhelmingly research skills that must fetch, so a network-less read-only mode
# cannot do the job it is for. (Measured on real runners 2026-07-22:
# gpt-5.1-codex-mini under `--sandbox read-only` hit `curl: (6) Could not resolve
# host: github.com` on every attempt including proxies; an earlier gpt-5-mini run
# that appeared to fetch had FABRICATED the result — the page is server-rendered.)
#
#   * read-only: run-harness wraps us in its bwrap/sandbox-exec OS sandbox, which
#     binds the workspace read-only but leaves the NETWORK OPEN (lib/sandbox.sh).
#     We turn codex's OWN sandbox OFF (danger-full-access) so the two don't nest —
#     an earlier attempt left codex's landlock ON inside bwrap and the two fought,
#     breaking codex's file access (it couldn't read its own SKILL.md). With the
#     self-sandbox off, that wrapper is the SOLE read-only enforcer, exactly how
#     pi/vibe/kimi run. (If a codex build rejects danger-full-access +
#     approval_policy=never together, swap in the single flag
#     --dangerously-bypass-approvals-and-sandbox, which drops both at once.)
#   * write: NOT bwrap-wrapped, so codex sandboxes itself. workspace-write blocks
#     network by default -> enable it (skills fetch).
if [ "${RH_MODE:-write}" = "read-only" ]; then
  ARGS+=(--sandbox danger-full-access)
else
  ARGS+=(--sandbox workspace-write -c 'sandbox_workspace_write.network_access=true')
fi
ARGS+=(-c 'approval_policy="never"')
ARGS+=(-c 'project_doc_fallback_filenames=["CLAUDE.md"]')

# MCP translation (codex reads only its own config; see openai/codex#13056).
# CAVEAT (codex 0.144.5): this wires the server correctly — codex spawns it,
# completes the `initialize` handshake, and exposes mcp__<srv>__<tool> — but each
# MCP tool call raises an approval elicitation that, in `codex exec` (stdin
# closed), reads EOF and resolves as *cancel*, so the tool never runs headlessly.
# This is upstream openai/codex#24135 (OPEN): no config key suppresses it
# (approval_policy / default_tools_approval_mode / tools_require_approval /
# mcp_approval_policy / trusted_mcp_servers / trust_level all confirmed
# ineffective there). The only override, --dangerously-bypass-approvals-and-
# sandbox, also drops the sandbox. Revisit when #24135 lands.
MCP_ARGS=()
if [ -n "${RH_MCP_CONFIG:-}" ] && [ -f "${RH_MCP_CONFIG:-}" ]; then
  while IFS= read -r tok; do MCP_ARGS+=("$tok"); done < <(mcp_to_codex_flags "$RH_MCP_CONFIG")
fi

# structured output (native) — OpenAI's response_format runs in STRICT mode and
# 400s unless every object schema carries additionalProperties:false (verified
# live against codex 0.144.5). Claude-style schemas don't carry it; patch it in
# recursively. (Strict mode also wants all properties required — not auto-patched
# since that changes semantics; the API error is explicit if a schema hits it.)
if [ -n "${RH_JSON_SCHEMA:-}" ]; then
  jq -c 'walk(if type == "object" and (.type? == "object")
                 and (has("additionalProperties") | not)
              then . + {additionalProperties: false} else . end)' \
    <<<"$RH_JSON_SCHEMA" > "$RH_TMPDIR/schema.json" || {
      echo "invalid --json-schema (not valid JSON)" >&2; exit 2; }
  ARGS+=(--output-schema "$RH_TMPDIR/schema.json")
fi

[ -n "${RH_MAX_TURNS:-}" ] && \
  echo "notice: codex has no --max-turns; the dispatcher wall-clock timeout is the guard" >&2

LAST_MSG="$RH_TMPDIR/codex-last-message.txt"
ARGS+=(--output-last-message "$LAST_MSG")

# Compat preamble + operator append go into the PROMPT: codex's instruction-file
# knob (model_instructions_file) REPLACES its built-in instructions — too blunt.
PROMPT="$(cat "$RH_PROMPT_FILE")"
[ -n "${RH_APPEND_SYSTEM_PROMPT:-}" ] && PROMPT="${RH_APPEND_SYSTEM_PROMPT}

${PROMPT}"
[ -n "${RH_COMPAT_RULES:-}" ] && PROMPT="${RH_COMPAT_RULES}

${PROMPT}"

EVENTS="$RH_TMPDIR/codex-events.jsonl"
printf '%s' "$PROMPT" | codex "${ARGS[@]}" ${MCP_ARGS[@]+"${MCP_ARGS[@]}"} - > "$EVENTS"
rc=$?
if [ $rc -ne 0 ]; then
  echo "codex exited $rc: $(tail -c 300 "$EVENTS" | tr '\n' ' ')" >&2
  exit $rc
fi

# sanitize the stream (drop any non-JSON lines defensively), then normalize
CLEAN="$RH_TMPDIR/codex-events.clean.jsonl"
jq -cR 'fromjson? // empty' "$EVENTS" > "$CLEAN"

RESULT=""
[ -s "$LAST_MSG" ] && RESULT="$(cat "$LAST_MSG")"
if [ -z "$RESULT" ]; then
  RESULT=$(jq -rs '
    [.[] | select(.type == "item.completed") | (.item // {})
         | select(.type == "agent_message") | (.text // "")]
    | last // ""' "$CLEAN")
fi

FAILED=$(jq -s '[.[] | select(.type == "turn.failed" or .type == "error")] | length' "$CLEAN")
if [ "${FAILED:-0}" -gt 0 ] && [ -z "$RESULT" ]; then
  echo "codex run failed ($FAILED turn.failed/error event(s)) with no output" >&2
  exit 3
fi
[ "${FAILED:-0}" -gt 0 ] && echo "warning: codex reported $FAILED failed-turn/error event(s) — retaining output" >&2

# usage: sum across turns; map cached_input_tokens -> cache_read (codex has no
# cache_creation concept and no cost field)
read -r TIN TOUT TCR <<<"$(jq -rs '
  [.[] | select(.type == "turn.completed") | (.usage // {})] |
  [ ([.[].input_tokens // 0] | add // 0),
    ([.[].output_tokens // 0] | add // 0),
    ([.[].cached_input_tokens // 0] | add // 0) ] | @tsv' "$CLEAN")"
SID=$(jq -rs '[.[] | select(.type == "thread.started") | (.thread_id // empty)] | first // ""' "$CLEAN")

emit_envelope "$RESULT" "${TIN:-0}" "${TOUT:-0}" "${TCR:-0}" 0 "" "$SID"
