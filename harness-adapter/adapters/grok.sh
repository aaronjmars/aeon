#!/usr/bin/env bash
# grok adapter — Grok Build (@xai-official/grok) behind the Claude Code contract.
# Distilled from aeonfun/aeon scripts/run-grok.sh, which established this pattern.
#
# Key behaviors carried over (verified there against grok 0.2.101):
#   * headless grok ABORTS the whole turn on a denied tool (stopReason=Cancelled)
#     instead of degrading -> we run --permission-mode bypassPermissions and use
#     the OS-level --sandbox read-only profile as the real read-only guard.
#     NEVER add --deny rules here.
#   * multi-agent models delegate to subagent tools that would get denied ->
#     --no-subagents by default.
#   * OUTPUT FORMAT: we ask for `streaming-json`, NOT `json`. Both are headless,
#     but only streaming-json's terminal `{"type":"end"}` event carries usage
#     (input/output/cache_read/reasoning tokens), total_cost_usd, sessionId AND
#     structuredOutput. The plain `json` envelope has no usage field at all —
#     which is why grok counts used to normalize to 0. Verified on 0.2.101.
#   * .thought (chain-of-thought) must NEVER leak into .result. streaming-json
#     interleaves {"type":"thought"} chunks with {"type":"text"} chunks, so the
#     firewall here is structural: .result is built ONLY from type=="text".
set -uo pipefail
. "$RH_LIB/envelope.sh"

command -v grok >/dev/null 2>&1 || {
  echo "grok CLI not found (npm i -g @xai-official/grok)" >&2; exit 1; }

# auth: an existing `grok login` session or an xAI API key
if [ ! -f "$HOME/.grok/auth.json" ] && [ -z "${XAI_API_KEY:-}" ]; then
  echo "grok needs auth: run 'grok login' or set XAI_API_KEY" >&2; exit 1
fi

ARGS=(--output-format streaming-json --no-auto-update --permission-mode bypassPermissions)

# model: only pass real grok ids; anything else -> grok's own default
case "${RH_MODEL:-}" in
  "" | default | claude-* | gpt-* | o[0-9]*) ;;
  *) ARGS+=(--model "$RH_MODEL") ;;
esac

# read-only is enforced by the dispatcher's wrapper OS sandbox (lib/sandbox.sh),
# NOT grok's own --sandbox: on grok 0.2.101 `--sandbox read-only` is silently
# ignored (writes still land) AND it nest-conflicts with sandbox-exec/bwrap.
# --- run-shaping knobs (max-turns / effort / best-of-n / self-check) ---------
# Ported from scripts/run-grok.sh §3c so the unified `run-harness grok` path
# keeps aeon's per-skill grok features. aeon.yml maps a skill's frontmatter
# (effort/reasoning_effort/max_turns/best_of_n/verify) to these GROK_* env vars
# and exports them before calling run-harness. Two hard constraints from that
# script are preserved (verified against grok 0.2.101):
#   * --effort/--reasoning-effort hit the API's reasoningEffort, which composer
#     400s on — gate them on a reasoning model, skip-with-warning otherwise.
#   * grok's parser refuses --no-subagents alongside --best-of-n/--check (both
#     are built ON subagents) — so those opt OUT of --no-subagents.
MODEL_IS_REASONING=0
case "${RH_MODEL:-}" in
  "" | default | claude-* | *composer*) ;;   # composer / unknown / empty → NOT reasoning (400-safe)
  grok-*) MODEL_IS_REASONING=1 ;;
esac

# --max-turns: GROK_MAX_TURNS (frontmatter) wins, else run-harness --max-turns,
# else grok's runaway-guard default of 60. 0/off = uncapped.
_max_turns="${GROK_MAX_TURNS:-${RH_MAX_TURNS:-60}}"
case "$_max_turns" in
  0 | off | none | "") ;;
  *[!0-9]*) echo "warning: ignoring non-integer max-turns '$_max_turns'" >&2 ;;
  *) ARGS+=(--max-turns "$_max_turns") ;;
esac

# --effort / --reasoning-effort: low|medium|high|xhigh|max — reasoning models only.
add_effort() {
  local name="$1" flag="$2" val="$3"
  case "$val" in
    "") return 0 ;;
    low | medium | high | xhigh | max) ;;
    *) echo "warning: ignoring invalid $name (want low|medium|high|xhigh|max): '$val'" >&2; return 0 ;;
  esac
  if [ "$MODEL_IS_REASONING" = 1 ]; then
    ARGS+=("$flag" "$val")
  else
    echo "notice: ignoring $flag $val — model '${RH_MODEL:-<grok default>}' has no reasoning effort" >&2
  fi
}
add_effort GROK_EFFORT --effort "${GROK_EFFORT:-}"
add_effort GROK_REASONING_EFFORT --reasoning-effort "${GROK_REASONING_EFFORT:-}"

# --best-of-n (N>=2) and --check are built ON subagents, so they flip the
# subagent switch on (grok won't combine either with --no-subagents).
GROK_WANTS_SUBAGENTS=0
case "${GROK_BEST_OF_N:-}" in
  "" | 0 | 1) ;;
  *[!0-9]*) echo "warning: ignoring non-integer GROK_BEST_OF_N='${GROK_BEST_OF_N}'" >&2 ;;
  *) ARGS+=(--best-of-n "$GROK_BEST_OF_N"); GROK_WANTS_SUBAGENTS=1 ;;
esac
case "${GROK_CHECK:-}" in
  1 | true | yes | on)
    if [ -n "${RH_JSON_SCHEMA:-}" ]; then
      echo "warning: ignoring --check: grok can't combine it with --json-schema (structured output wins)" >&2
    else
      ARGS+=(--check); GROK_WANTS_SUBAGENTS=1
    fi ;;
esac

# --no-subagents by default: a headless skill run is one focused agent; the
# multi-agent models otherwise delegate to a Task/spawn tool that isn't
# allowlisted, and the denial aborts the whole turn (stopReason=Cancelled).
# Skip it only when best-of-n/check explicitly asked for subagents above.
[ "$GROK_WANTS_SUBAGENTS" = 0 ] && ARGS+=(--no-subagents)

# structured output: reliably honoured by reasoning models (grok-4.5/grok-build);
# composer leaves .structuredOutput null and just emits JSON text — both handled below.
[ -n "${RH_JSON_SCHEMA:-}" ] && ARGS+=(--json-schema "$RH_JSON_SCHEMA")

# compat preamble + operator append ride grok's --rules (appended to system prompt)
RULES="${RH_COMPAT_RULES:-}"
if [ -n "${RH_APPEND_SYSTEM_PROMPT:-}" ]; then
  RULES="${RULES:+$RULES
}${RH_APPEND_SYSTEM_PROMPT}"
fi
[ -n "$RULES" ] && ARGS+=(--rules "$RULES")

# MCP: grok discovers the project .mcp.json natively (cwd->git-root walk) and
# expands ${VAR} from the env itself (verified: a `Bearer ${TOK}` header arrives at
# the server fully expanded) — we grant permission to call the tools, and --trust
# the folder.
#
# --trust is REQUIRED, not optional hardening. grok gates every repo-local
# (project-scoped) MCP server behind its folder-trust store
# (~/.grok/trusted_folders.toml, shared with hooks + LSP): in an untrusted folder
# the server is silently never started and no mcp__<srv>__* tool exists. A CI
# runner checks the repo out fresh into a never-trusted path every single run, so
# without this flag MCP is dead on grok 100% of the time — `grok mcp doctor` names
# it exactly ("folder untrusted … re-run with --trust"), but the run itself only
# shows an agent that can't find its tools. Measured on a real runner 2026-07-27:
# the glim-mcp skill reported GLIM_NOT_CONNECTED while MCP_GLIM_TOKEN was live and
# the workflow had logged "MCP enabled: glim".
#
# Trusting is sound here: the folder is the operator's own checked-out repo, which
# the harness is already executing as the agent's workspace. The flag is hidden on
# --help but accepted (grok 0.2.101+); it is passed ONLY when an MCP config is in
# play, so a non-MCP run keeps the default untrusted posture.
if [ -n "${RH_MCP_CONFIG:-}" ] && [ -f "${RH_MCP_CONFIG:-}" ]; then
  ARGS+=(--trust)
  for srv in $(jq -r '.mcpServers // {} | keys[]' "$RH_MCP_CONFIG"); do
    ARGS+=(--allow "MCPTool(${srv}__*)")
  done
fi

OUT="$RH_TMPDIR/grok-out.jsonl"
grok -p "$(cat "$RH_PROMPT_FILE")" "${ARGS[@]}" > "$OUT"
rc=$?
if [ $rc -ne 0 ]; then
  echo "grok exited $rc: $(tail -c 300 "$OUT" | tr '\n' ' ')" >&2
  exit $rc
fi

# keep only well-formed JSON lines (a stray banner/warning must not sink parsing)
CLEAN="$RH_TMPDIR/grok-events.clean.jsonl"
jq -cR 'fromjson? // empty' "$OUT" > "$CLEAN"

if [ -s "$CLEAN" ]; then
  # THE FIREWALL: .result is assembled ONLY from type=="text" chunks. The
  # type=="thought" chunks are chain-of-thought and are never read here — that is
  # how .thought leaked historically in aeon's run history.
  TEXT=$(jq -rs '[.[] | select(.type == "text") | (.data // "")] | join("")' "$CLEAN")
  # the terminal event carries stop/usage/cost/session/structuredOutput
  END=$(jq -cs '[.[] | select(.type == "end")] | last // {}' "$CLEAN")

  STRUCT=$(jq -c '.structuredOutput // null' <<<"$END")
  if [ "$STRUCT" != "null" ]; then RESULT_TEXT="$STRUCT"; else RESULT_TEXT="$TEXT"; fi

  STOP=$(jq -r '.stopReason // .stop_reason // ""'          <<<"$END")
  SID=$(jq  -r '.sessionId // .session_id // ""'            <<<"$END")
  COST=$(jq -r '.total_cost_usd // empty'                   <<<"$END")
  TIN=$(jq  -r '.usage.input_tokens // 0'                   <<<"$END")
  TOUT=$(jq -r '.usage.output_tokens // 0'                  <<<"$END")
  TCR=$(jq  -r '.usage.cache_read_input_tokens // 0'        <<<"$END")
  TCC=$(jq  -r '.usage.cache_creation_input_tokens // 0'    <<<"$END")

  # grok exits 0 even on a Cancelled/aborted run — that is a FAILED run, not an
  # empty-but-successful one. A clean EndTurn with empty text passes through.
  case "$STOP" in
    Cancelled|cancelled|Aborted|aborted|Interrupted|interrupted|Error|error|Failed|failed|Refusal|refusal)
      if [ -z "$RESULT_TEXT" ]; then
        echo "grok terminated abnormally (stopReason=$STOP) with no output" >&2
        exit 3
      fi
      echo "warning: grok stopReason=$STOP — retaining partial output" >&2
      ;;
  esac
  emit_envelope "$RESULT_TEXT" "$TIN" "$TOUT" "$TCR" "$TCC" "$COST" "$SID"
else
  echo "warning: grok emitted no parseable JSON events — wrapping raw stdout" >&2
  wrap_raw_output < "$OUT"
fi
