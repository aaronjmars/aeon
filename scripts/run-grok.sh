#!/usr/bin/env bash
# run-grok.sh — run one Aeon skill through the Grok Build (`grok`) harness.
#
# This is the Grok counterpart to the inline `claude -p -` call in
# .github/workflows/aeon.yml. It is invoked ONLY when the resolved harness for a
# run is `grok` (harness: grok in aeon.yml, per-skill, or the workflow_dispatch
# input). The default harness is still `claude`, whose path is untouched.
#
# Contract (so the rest of the pipeline is harness-agnostic):
#   stdin   — the fully-built prompt (same prompt the claude path pipes in)
#   stdout  — a NORMALIZED JSON envelope, byte-identical in shape to Claude
#             Code's `--output-format json`, so aeon.yml's downstream jq
#             (.result, .usage.input_tokens, …) works unchanged:
#               { "result": "<text>",
#                 "usage": { "input_tokens": N, "output_tokens": N,
#                            "cache_read_input_tokens": N,
#                            "cache_creation_input_tokens": N } }
#   stderr  — all diagnostics / notices (never mixed into stdout)
#   exit    — 0 on success, non-zero on any grok failure (caller falls to error)
#
# Inputs from the environment:
#   MODEL                 resolved model id; empty ⇒ grok's own default (now grok-4.5)
#   SKILL_MODE            read-only | write (maps to grok --allow/--deny/--sandbox
#                         via scripts/skill_mode.sh grok-args)
#   XAI_API_KEY           xAI API key auth (CI-friendly; the simple path)
#   GROK_CREDENTIALS      base64 of the X-account OAuth session captured by the
#                         dashboard (a tar rooted at $HOME, or a single cred file)
#   GROK_CREDENTIALS_PATH single-file restore target (default ~/.grok/credentials.json)
#   GH_SECRETS_PAT       secrets-write PAT (or GH_GLOBAL as the repo-wide fallback)
#                         used to PERSIST a rotated refresh token back to the
#                         GROK_CREDENTIALS secret so OAuth auth survives past 6h (§2b);
#                         without it a rotating provider breaks one run after expiry.
#   GROK_OAUTH_SKEW       seconds-before-expiry to trigger a refresh (default 1800)
#   GROK_CLI_VERSION      npm pin override (default below)
#   Run-shaping knobs (all optional; aeon.yml maps a skill's frontmatter to them):
#   GROK_MAX_TURNS        agentic-turn cap (default 60; 0/off = uncapped)
#   GROK_EFFORT           low|medium|high|xhigh|max  → --effort  (reasoning models only)
#   GROK_REASONING_EFFORT low|medium|high|xhigh|max  → --reasoning-effort (reasoning models only)
#   GROK_BEST_OF_N        N>=2: run N ways in parallel, keep the best → --best-of-n
#   GROK_CHECK            1/true/yes/on: append a self-verification loop → --check
#   GROK_COMPAT_RULES     override the Claude→grok compatibility preamble appended
#                         to grok's system prompt via --rules (default below, §3d)
#
# Structured output is NOT available on this path. There was a GROK_JSON_SCHEMA
# knob here, but nothing in the repo ever set it (checked the full history) and
# the scorer it was reserved for went schema-less on purpose, so one parse path
# covers all six harnesses. Structured output now lives where it is uniform:
# `run-harness --json-schema` (native on claude/grok/codex, prompt-shim on
# pi/vibe/kimi). Re-adding a grok-only env var here would recreate exactly the
# per-harness divergence the harness-adapter exists to remove.
#
# MCP: grok discovers the project .mcp.json natively (no flag needed); this script
# only adds `--allow MCPTool(<server>__*)` so the model may call those tools.
#
# Sandbox note: grok's own network calls (to api.x.ai / auth.x.ai) go out from
# this step, which the Actions sandbox permits for the CLI itself. Auth material
# is either an env var (XAI_API_KEY) or restored from a repo secret — never
# fetched at run time.

set -uo pipefail   # NOT -e: we capture grok's exit code and output explicitly.

# --- pin (single source of truth for the grok CLI version) ------------------
# Keep this current the same way aeon.yml/messages.yml pin the claude CLI.
GROK_CLI_VERSION="${GROK_CLI_VERSION:-0.2.101}"

log() { echo "$@" >&2; }

# Optional `setup` subcommand: run ONLY steps 1–2 (install the pinned CLI +
# restore auth) and exit, without reading a prompt or invoking the model. The
# workflow's "Install harness CLI" step calls `run-grok.sh setup` so grok is
# staged for the unified run-harness path, keeping THIS script the single source
# of truth for the CLI pin and the GROK_CREDENTIALS restore logic. Any other
# invocation is a normal run (prompt on stdin), unchanged.
SETUP_ONLY=0
[ "${1:-}" = "setup" ] && SETUP_ONLY=1

# --- 1. ensure the CLI ------------------------------------------------------
if ! command -v grok >/dev/null 2>&1; then
  log "::debug::grok CLI not found — installing @xai-official/grok@${GROK_CLI_VERSION}"
  if ! npm install -g "@xai-official/grok@${GROK_CLI_VERSION}" >&2; then
    log "::error::failed to install @xai-official/grok@${GROK_CLI_VERSION}"
    exit 1
  fi
fi

# --- 2. auth ----------------------------------------------------------------
# Prefer the captured X-account OAuth session; fall back to an API key. One of
# the two must be present, or grok would block on an interactive login prompt.
GROK_HOME="${HOME}/.grok"
if [ -n "${GROK_CREDENTIALS:-}" ]; then
  mkdir -p "$GROK_HOME"; chmod 700 "$GROK_HOME" 2>/dev/null || true
  tmp_creds="$(mktemp)"
  printf '%s' "$GROK_CREDENTIALS" | base64 -d > "$tmp_creds" 2>/dev/null || {
    log "::error::GROK_CREDENTIALS is not valid base64"; rm -f "$tmp_creds"; exit 1; }
  # The dashboard captures the session as a tar rooted at $HOME (robust to the
  # exact cred filename); if it isn't a tar, treat it as a single cred file.
  # The dashboard captures the session as a tar rooted at $HOME (contains
  # .grok/auth.json — the confirmed credential file); if it isn't a tar, treat
  # it as the raw auth.json.
  if tar tzf "$tmp_creds" >/dev/null 2>&1; then
    tar xzf "$tmp_creds" -C "$HOME" >&2 || { log "::error::failed to extract GROK_CREDENTIALS"; rm -f "$tmp_creds"; exit 1; }
    log "::debug::restored grok OAuth session from GROK_CREDENTIALS (archive)"
  else
    dest="${GROK_CREDENTIALS_PATH:-$GROK_HOME/auth.json}"
    mkdir -p "$(dirname "$dest")"
    cp "$tmp_creds" "$dest"; chmod 600 "$dest" 2>/dev/null || true
    log "::debug::restored grok OAuth session from GROK_CREDENTIALS to ${dest}"
  fi
  rm -f "$tmp_creds"
elif [ -n "${XAI_API_KEY:-}" ]; then
  export XAI_API_KEY
  log "::debug::authenticating grok with XAI_API_KEY"
elif [ -f "$GROK_HOME/auth.json" ]; then
  # Already signed in on this machine (local run / mcp-server path) — use it.
  log "::debug::using existing grok session at $GROK_HOME/auth.json"
else
  log "::error::grok harness needs auth: set GROK_CREDENTIALS (X-account login via the dashboard) or XAI_API_KEY, or run 'grok login'"
  exit 1
fi

# --- 2b. keep the OAuth session durable (refresh + persist rotated token) ----
# The captured GROK_CREDENTIALS holds ~/.grok/auth.json = a 6h access JWT + an
# offline_access refresh token. xAI ROTATES the refresh token on every refresh and
# revokes the prior one (confirmed live: auth.x.ai returns invalid_grant "Refresh
# token has been revoked"), so a STATIC secret self-destructs ~6h after capture: the
# first post-expiry run refreshes and rotates the token, but grok writes the new one
# only to the ephemeral runner $HOME - the secret still holds the now-revoked token,
# and every later run dies "Not signed in". Fix (mirrors scripts/mcp-oauth-refresh.sh):
# refresh HERE from the refresh token, rewrite auth.json, then PERSIST the rotated
# file back to the GROK_CREDENTIALS secret via a secrets-write PAT (GH_SECRETS_PAT /
# GH_GLOBAL - the default GITHUB_TOKEN cannot write secrets). Only
# refreshes when the access token is within GROK_OAUTH_SKEW seconds of expiry, so runs
# inside the window reuse the on-disk token and do not needlessly rotate (fewer
# concurrent-run races; for high parallelism refresh centrally on a schedule so exactly
# one run mints per interval - see docs/harnesses.md). Runs on the GitHub runner in
# plain bash (no Claude bash analyzer), so a normal curl with the token in
# --data-urlencode is fine; nothing is echoed. This is a no-op unless we authed via
# GROK_CREDENTIALS (the CI OAuth path) - a local `grok login` session is left untouched.
grok_oauth_refresh() {
  local auth="$GROK_HOME/auth.json"
  [ -f "$auth" ] || return 0
  command -v jq >/dev/null 2>&1 || { log "::debug::grok oauth: jq missing - skipping refresh"; return 0; }
  # The credential is a map keyed by "<issuer>::<client_id>"; operate on the first entry.
  local k iss cid rt exp
  k=$(jq -r 'keys_unsorted[0] // empty' "$auth" 2>/dev/null)
  [ -z "$k" ] && return 0
  iss=$(jq -r --arg k "$k" '.[$k].oidc_issuer   // empty' "$auth" 2>/dev/null)
  cid=$(jq -r --arg k "$k" '.[$k].oidc_client_id // empty' "$auth" 2>/dev/null)
  rt=$(jq  -r --arg k "$k" '.[$k].refresh_token  // empty' "$auth" 2>/dev/null)
  exp=$(jq -r --arg k "$k" '.[$k].expires_at     // empty' "$auth" 2>/dev/null)
  # No refresh token (API-key path or a stripped file) or no issuer → nothing to keep alive.
  [ -z "$rt" ] || [ -z "$iss" ] && return 0
  # Only refresh when the access token is expired or within the skew window.
  local skew="${GROK_OAUTH_SKEW:-1800}" now_epoch exp_epoch
  now_epoch=$(jq -rn 'now|floor' 2>/dev/null)
  exp_epoch=$(jq -rn --arg t "$exp" '($t|sub("\\.[0-9]+Z$";"Z")|fromdateiso8601?) // 0' 2>/dev/null)
  if [ "${exp_epoch:-0}" -gt 0 ] 2>/dev/null && [ $((exp_epoch - now_epoch)) -gt "$skew" ]; then
    log "::debug::grok oauth: access token still valid ($((exp_epoch - now_epoch))s left) - skipping refresh"
    return 0
  fi
  local ep="${iss%/}/oauth2/token"
  log "::debug::grok oauth: refreshing access token via $ep"
  local resp access new_rt expires_in
  resp=$(curl -s --max-time 30 -X POST "$ep" \
    -H 'Accept: application/json' -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode 'grant_type=refresh_token' \
    --data-urlencode "client_id=$cid" \
    --data-urlencode "refresh_token=$rt" 2>/dev/null)
  if [ -z "$resp" ]; then
    log "::warning::grok oauth: refresh request to $ep failed (empty/timeout) - falling through to the on-disk token"; return 0
  fi
  access=$(jq -r '.access_token // empty' <<<"$resp" 2>/dev/null)
  if [ -z "$access" ]; then
    local oerr; oerr=$(jq -r '[.error,.error_description]|map(select(.!=null and .!=""))|join(": ")' <<<"$resp" 2>/dev/null)
    log "::warning::grok oauth: refresh failed${oerr:+ ($oerr)} - the stored refresh token was likely rotated/consumed by an earlier run and not saved. Re-connect the X account in the dashboard, and set a secrets-write PAT (GH_SECRETS_PAT / GH_GLOBAL) so future rotations persist. See docs/harnesses.md."
    return 0
  fi
  new_rt=$(jq -r '.refresh_token // empty' <<<"$resp" 2>/dev/null)
  expires_in=$(jq -r '.expires_in // 21600' <<<"$resp" 2>/dev/null)   # default 6h
  # Rewrite auth.json in place: fresh access token, rotated refresh token, new expiry.
  local new_exp tmp
  new_exp=$(jq -rn --argjson n "${expires_in:-21600}" '(now + $n)|todate' 2>/dev/null)
  tmp=$(mktemp)
  if jq --arg k "$k" --arg a "$access" --arg r "${new_rt:-$rt}" --arg e "$new_exp" \
        '.[$k].key=$a | .[$k].refresh_token=$r | .[$k].expires_at=$e' "$auth" >"$tmp" 2>/dev/null && [ -s "$tmp" ]; then
    mv "$tmp" "$auth"; chmod 600 "$auth" 2>/dev/null || true
    log "::debug::grok oauth: refreshed access token (expires $new_exp)"
  else
    rm -f "$tmp"; log "::warning::grok oauth: could not rewrite auth.json after refresh - using the on-disk token"; return 0
  fi
  # Persist the rotated refresh token so the NEXT run stays valid. Needs a
  # secrets-write PAT (the default GITHUB_TOKEN cannot). LOUD on failure - an
  # unpersisted rotation is exactly what breaks auth one run later.
  if [ -n "$new_rt" ] && [ "$new_rt" != "$rt" ]; then
    local pat="${GH_SECRETS_PAT:-${GH_GLOBAL:-}}"
    if [ -z "$pat" ]; then
      log "::warning::grok oauth: refresh token ROTATED but no secrets-write PAT is set, so the rotated token cannot be saved and the NEXT run's refresh WILL fail. Add a fine-grained PAT (Secrets: read/write) as repo secret GH_SECRETS_PAT (or GH_GLOBAL), then re-connect the X account once."
    elif ! command -v gh >/dev/null 2>&1; then
      log "::warning::grok oauth: refresh token rotated but 'gh' is unavailable to persist GROK_CREDENTIALS."
    elif tar czf - -C "$HOME" .grok/auth.json 2>/dev/null | base64 | GH_TOKEN="$pat" gh secret set GROK_CREDENTIALS >/dev/null 2>&1; then
      log "grok oauth: persisted rotated GROK_CREDENTIALS (durable refresh active)"
    else
      log "::warning::grok oauth: refresh token rotated but persisting GROK_CREDENTIALS FAILED - GH_SECRETS_PAT/GH_GLOBAL needs 'Secrets: read/write' on this repo. Re-connect the X account once fixed."
    fi
  fi
}
# Only meaningful on the CI OAuth path (a GROK_CREDENTIALS secret was restored above);
# a local `grok login` session (no GROK_CREDENTIALS) is deliberately left untouched.
[ -n "${GROK_CREDENTIALS:-}" ] && grok_oauth_refresh

if [ "$SETUP_ONLY" = 1 ]; then
  log "::debug::grok setup complete (CLI + auth staged); the run itself goes through run-harness grok"
  exit 0
fi

# --- 3. model + permission flags --------------------------------------------
# Only pass --model for a real grok model id; for an empty value or a leftover
# claude-* id (harness switched but model not), OMIT it so grok uses its own
# current default (now grok-4.5) rather than a hardcoded id.
MODEL="${MODEL:-}"
SKILL_MODE="${SKILL_MODE:-write}"
MODEL_FLAG=()
case "$MODEL" in
  ""|default|claude-*) ;;                 # let grok pick its default model
  *)                   MODEL_FLAG=(--model "$MODEL") ;;
esac
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# One argv token per line → array. Plain while-read (not `mapfile`) so this runs
# on bash 3.2 (macOS) as well as CI's bash 5.
GROK_ARGS=()
if [ -f "$SCRIPT_DIR/skill_mode.sh" ]; then
  while IFS= read -r _tok; do GROK_ARGS+=("$_tok"); done < <(bash "$SCRIPT_DIR/skill_mode.sh" grok-args "$SKILL_MODE")
fi

# --- 3b. MCP ----------------------------------------------------------------
# grok has first-class MCP and DISCOVERS the project .mcp.json natively: it walks
# cwd→git-root loading `.mcp.json` (MCP-standard format) and expands ${VAR} in it
# from the environment — the same secrets aeon.yml's MCP preflight exports before
# this script runs (confirmed with `grok inspect --json`). So there is nothing to
# "wire": we do NOT pass a --mcp-config flag (grok has none) and we do NOT
# translate config schemas. We only have to grant PERMISSION to call the tools:
# MCP tools are not on grok's read-class fast path, so under a deny-by-default
# headless run they're blocked unless an explicit allow rule names them. Add one
# `--allow MCPTool(<server>__*)` per server declared in .mcp.json (grok namespaces
# every MCP tool as `<server>__<tool>`).
#
# Permission is necessary but NOT sufficient: grok also gates every repo-local
# (project-scoped) MCP server behind its folder-trust store
# (~/.grok/trusted_folders.toml, shared with hooks + LSP). A CI runner checks the
# repo out into a path that has never been trusted, on every run, so without
# --trust the server is silently never STARTED and no mcp__<srv>__* tool exists —
# the allow rules above then grant permission to call tools that don't exist. The
# run doesn't fail; the agent reports the server "not connected" and falls back to
# plain HTTP, which reads as a normal green run. `grok mcp doctor` names it
# ("folder untrusted … re-run with --trust"). Same fix as
# harness-adapter/adapters/grok.sh; applied here for the surfaces that still run
# through this script (messages.yml, apps/mcp-server). Scoped to MCP runs, so a
# repo with no .mcp.json keeps the default untrusted posture. The flag is hidden
# on `grok --help` but accepted.
MCP_ALLOW=()
if [ -f .mcp.json ] && jq -e '.mcpServers' .mcp.json >/dev/null 2>&1; then
  MCP_SERVERS=$(jq -r '.mcpServers | keys[]' .mcp.json)
  MCP_ALLOW+=(--trust)
  for srv in $MCP_SERVERS; do
    MCP_ALLOW+=(--allow "MCPTool(${srv}__*)")
  done
  log "::debug::MCP: grok loads .mcp.json natively; allowing tools from: $(printf '%s ' $MCP_SERVERS)"
  # A referenced ${VAR} that isn't in the env expands empty → that one server
  # can't authenticate and grok logs a connect error, but the run and the other
  # servers are unaffected. Warn (don't fail) so it's visible without breaking.
  MCP_MISSING=""
  for v in $(grep -oE '\$\{[A-Z_][A-Z0-9_]*\}' .mcp.json | sed -E 's/[${}]//g' | sort -u); do
    [ -z "${!v:-}" ] && MCP_MISSING="$MCP_MISSING $v"
  done
  [ -n "$MCP_MISSING" ] && log "::warning::MCP: .mcp.json references unset var(s):${MCP_MISSING} — those servers are unavailable this run (set them in the dashboard)"
fi

# --- 3c. run-shaping flags (structured output / effort / turns / verify) -----
# Newer grok headless features, all opt-in via env (aeon.yml maps a skill's
# frontmatter to these). Two hard-won constraints are enforced here, verified
# against grok 0.2.101:
#   * --effort / --reasoning-effort map to the API's `reasoningEffort`, which
#     composer REJECTS with a 400 ("does not support parameter reasoningEffort").
#     They only work on a reasoning model (grok-4.5 / grok-build), so we gate them
#     on MODEL and skip-with-warning on composer rather than hard-fail the run.
#   * grok's own arg parser rejects some combinations; those are reconciled below
#     and again where --no-subagents is chosen (see the run step).
# Invalid values are warned-and-skipped, never passed through to fail the run.
RUN_FLAGS=()

# Is the resolved model reasoning-capable? Composer is not; grok-4.5 / grok-build are.
# Empty MODEL means grok picks its own default (now grok-4.5, a reasoning model), but
# we can't know that here, so treat empty as non-reasoning to stay 400-safe.
MODEL_IS_REASONING=0
case "$MODEL" in
  ""|default|claude-*|*composer*) ;;      # composer / unknown → NOT reasoning
  grok-*)                MODEL_IS_REASONING=1 ;;
esac

# --max-turns: a runaway/cost guard on agentic loops (generous, not a tight
# bound — hitting it degrades to partial output, it doesn't hard-fail). Defaults
# to 60; set GROK_MAX_TURNS to a positive integer to override, or 0/off to remove.
_max_turns="${GROK_MAX_TURNS:-60}"
case "$_max_turns" in
  0|off|none|"") ;;                                     # explicitly uncapped
  *[!0-9]*) log "::warning::ignoring non-integer GROK_MAX_TURNS='$_max_turns'";;
  *) RUN_FLAGS+=(--max-turns "$_max_turns") ;;
esac
# --effort / --reasoning-effort: low|medium|high|xhigh|max — reasoning models only.
# add_effort <envname> <flag> <value>: validate, gate on model, append or warn.
add_effort() {
  local env="$1" flag="$2" val="$3"
  case "$val" in
    "") return 0 ;;
    low|medium|high|xhigh|max) ;;
    *) log "::warning::ignoring invalid $env (want low|medium|high|xhigh|max): '$val'"; return 0 ;;
  esac
  if [ "$MODEL_IS_REASONING" = 1 ]; then
    RUN_FLAGS+=("$flag" "$val")
  else
    log "::debug::ignoring $flag $val — model '${MODEL:-<grok default>}' doesn't support reasoning effort (use a reasoning model like grok-4.5)"
  fi
}
add_effort GROK_EFFORT --effort "${GROK_EFFORT:-}"
add_effort GROK_REASONING_EFFORT --reasoning-effort "${GROK_REASONING_EFFORT:-}"
# --best-of-n: run the task N ways in parallel and keep the best (N>=2).
GROK_WANTS_SUBAGENTS=0
case "${GROK_BEST_OF_N:-}" in
  ""|0|1) ;;
  *[!0-9]*) log "::warning::ignoring non-integer GROK_BEST_OF_N='${GROK_BEST_OF_N}'";;
  *) RUN_FLAGS+=(--best-of-n "$GROK_BEST_OF_N"); GROK_WANTS_SUBAGENTS=1 ;;
esac
# --check: append a self-verification loop before finishing.
# (This used to be gated against GROK_JSON_SCHEMA, since grok refuses to combine
# --check with --json-schema. That knob is gone — see the header note — so there
# is nothing left to conflict with. Structured output on this path would need
# reintroducing both the flag and that precedence rule.)
case "${GROK_CHECK:-}" in
  1|true|yes|on) RUN_FLAGS+=(--check); GROK_WANTS_SUBAGENTS=1 ;;
esac

# --- 3d. Claude→grok compatibility preamble (--rules) -----------------------
# Every Aeon skill is authored for the Claude Code harness: its data-fetch steps name
# Claude's tools (WebFetch), assume Claude's sandbox-bypass patterns, and lean on
# `gh api`. Rather than reimplement ~100 skills for grok, we append ONE standing
# ruleset to grok's system prompt (`--rules`) that (a) translates those idioms to
# grok's tools and (b) — the load-bearing part — tells grok to ROUTE AROUND a
# missing/failed tool instead of giving up. That give-up-and-Cancel behavior is what
# turned Claude-authored runs into empty/partial non-answers (see run history). This
# is skill-agnostic (fix once, applies to every skill) and cheap (~a few hundred
# tokens/run). It pairs with --permission-mode bypassPermissions from skill_mode.sh:
# bypass stops the hard turn-abort, these rules stop the soft "I'll try other ways" give-up.
# Override/extend via GROK_COMPAT_RULES in the environment.
# EDITING NOTE: this heredoc sits inside "$(cat <<'RULES' … )" — bash's scanner for
# that construct still counts apostrophes/backticks in the body, so keep them
# BALANCED (even count) or the whole assignment breaks at EOF. Prefer "do not" over
# "don't" and pair every backtick. (bash -n scripts/run-grok.sh catches a slip.)
GROK_COMPAT_RULES="${GROK_COMPAT_RULES:-$(cat <<'RULES'
This skill was authored for the Claude Code harness. Adapt its instructions to your
own tools; do not abort when something does not match one-to-one:
- Tool names are Claude's. Map them: when a skill says "WebFetch", use your web
  fetch/search tools; when it says to curl a URL the sandbox blocks, fetch the same
  URL with your web tools instead.
- When a skill relies on the gh CLI (e.g. `gh api`) and gh is unavailable, call the
  GitHub REST API directly over the web (https://api.github.com/...) — public for reads.
- X/Twitter data: fetch it with your built-in WebSearch and WebFetch tools. A skill
  step that curls the xAI `x_search` API or needs XAI_API_KEY to pull posts is
  Claude-harness scaffolding — when that key is absent, get the same posts by searching
  the web for x.com results yourself and carry on. Never skip a section, or emit a
  NO_KEY / NO_API_KEY status just because XAI_API_KEY is absent; WebSearch covers it.
- If any tool is missing, denied, or returns unusable content, do NOT stop or end the
  turn. Try another route and finish the task; only surface a failure after you have
  exhausted the alternatives the skill names.
- Never end a run having produced only planning or commentary. Deliver the skill's
  actual output — the notify/file/log it specifies, or its defined error signal — and
  never emit interim narration as the result.
RULES
)}"

# --- 4. run -----------------------------------------------------------------
PROMPT="$(cat)"
out_file="$(mktemp)"; err_file="$(mktemp)"
# --no-subagents: by default a headless skill run is a single focused agent. The
# multi-agent models (grok-build) otherwise try to DELEGATE to parallel subagents,
# whose Task/spawn tool is not in our allowlist — the denial aborts the whole turn
# (observed: grok-build → stopReason=Cancelled, empty text, ~18s). Disabling
# subagents keeps the model doing the work itself. Composer is single-agent, so
# it's a no-op there. EXCEPTION: --best-of-n and --check are built ON subagents,
# and grok's arg parser refuses --no-subagents alongside either — so when a skill
# opted into those (GROK_WANTS_SUBAGENTS=1) we must NOT pass --no-subagents.
SUBAGENT_FLAG=(--no-subagents)
[ "${GROK_WANTS_SUBAGENTS:-0}" = 1 ] && SUBAGENT_FLAG=()
# Guard the array expansions for the empty case under bash 3.2 set -u.
grok -p "$PROMPT" \
  ${MODEL_FLAG[@]+"${MODEL_FLAG[@]}"} \
  --output-format json \
  --no-auto-update \
  --rules "$GROK_COMPAT_RULES" \
  ${SUBAGENT_FLAG[@]+"${SUBAGENT_FLAG[@]}"} \
  ${RUN_FLAGS[@]+"${RUN_FLAGS[@]}"} \
  ${MCP_ALLOW[@]+"${MCP_ALLOW[@]}"} \
  ${GROK_ARGS[@]+"${GROK_ARGS[@]}"} >"$out_file" 2>"$err_file"
rc=$?
# Surface grok's own diagnostics into the step log regardless of outcome.
cat "$err_file" >&2
if [ $rc -ne 0 ]; then
  log "::error::grok exited $rc"
  rm -f "$out_file" "$err_file"
  exit $rc
fi

# --- 5. normalize output ----------------------------------------------------
# Map grok's --output-format json onto the envelope the pipeline expects.
# Confirmed shape (grok 0.2.82): {"text": "...", "stopReason", "sessionId",
# "requestId", "thought"} — the result is in .text and there is NO usage/token
# field, so token counts normalize to 0 (grok-harness runs report 0 tokens).
# With --json-schema a reasoning model (grok-build) ALSO fills .structuredOutput
# with the parsed object; we prefer it (re-serialized) so a schema consumer gets
# clean JSON. Composer leaves it null and puts JSON in .text, which still flows
# through the .text branch — so both models normalize correctly.
#
# CRITICAL: `.thought` is grok's internal chain-of-thought. It must NEVER become
# the skill result — downstream this gets committed to the repo, sent via
# ./notify, and fed into chains. So .result is built ONLY from recognized text
# fields (or the schema-validated .structuredOutput), and a valid grok JSON object
# is NEVER dumped raw (which is how .thought previously leaked when .text was
# empty). Common aliases are kept for forward-compat; the raw-stdout fallback
# fires only for genuinely non-JSON output.
NORMALIZE='
  (if (.structuredOutput // null) != null then (.structuredOutput|tojson)
   else (.result // .text // .output // .response // .content // .message // "") end) as $r
  | (.usage // .usageMetadata // {}) as $u
  | {
      result: (if ($r|type)=="string" then $r
               elif ($r|type)=="array" then ([$r[]? | (.text // (.|tostring))] | join(""))
               else ($r|tostring) end),
      usage: {
        input_tokens: (($u.input_tokens // $u.prompt_tokens // $u.inputTokens // $u.promptTokenCount // 0) | floor),
        output_tokens: (($u.output_tokens // $u.completion_tokens // $u.outputTokens // $u.candidatesTokenCount // 0) | floor),
        cache_read_input_tokens: (($u.cache_read_input_tokens // $u.cache_read // $u.cachedContentTokenCount // 0) | floor),
        cache_creation_input_tokens: (($u.cache_creation_input_tokens // $u.cache_creation // 0) | floor)
      }
    }'

if jq -e 'type == "object"' "$out_file" >/dev/null 2>&1; then
  # A recognized grok JSON envelope. Build the normalized result (text fields
  # only — never .thought) and inspect how the turn ended.
  ENVELOPE=$(jq -ce "$NORMALIZE" "$out_file")
  RESULT_TEXT=$(printf '%s' "$ENVELOPE" | jq -r '.result // ""')
  STOP=$(jq -r '.stopReason // .stop_reason // ""' "$out_file")
  # grok exits 0 even when a run is Cancelled / aborted with no output. That is a
  # FAILED run, not an empty-but-successful one — surface it so the workflow's
  # grok-error path fires instead of committing/reporting an empty (or partial)
  # result. A clean EndTurn with empty text is legitimate (the skill did its work
  # via tool calls and wrote no final message) and passes through as result "".
  case "$STOP" in
    Cancelled|cancelled|Aborted|aborted|Interrupted|interrupted|Error|error|Failed|failed|Refusal|refusal)
      if [ -z "$RESULT_TEXT" ]; then
        log "::error::grok terminated abnormally (stopReason=$STOP) with no output — failing the run rather than emitting an empty/partial result"
        rm -f "$out_file" "$err_file"
        exit 3
      fi
      log "::warning::grok stopReason=$STOP — retaining partial output"
      ;;
  esac
  printf '%s\n' "$ENVELOPE"
else
  # Not a single JSON object: shape changed, plain-text output, or leading noise.
  # Wrap raw stdout so a mismatch never silently looks like "no output". (This
  # path only fires for non-JSON, so it can't leak a JSON object's .thought.)
  log "::warning::grok output was not a JSON object (expected --output-format json) — wrapping raw stdout; verify the grok CLI version/output format"
  jq -Rsc '{result: ., usage: {input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0}}' "$out_file"
fi
rm -f "$out_file" "$err_file"
