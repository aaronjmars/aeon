#!/usr/bin/env bash
# llm-gateway.sh — resolve LLM routing for an Aeon run.
#
# SOURCED (not executed) by the "Run"-type steps in .github/workflows/aeon.yml,
# so exported env vars AND any background sidecar persist into the `claude -p`
# call in the same shell. Place at: scripts/llm-gateway.sh
#
# Inputs already present in the step environment:
#   $GATEWAY                    auto | direct | bankr | openrouter | usepod | surplus | venice | grok
#                               (auto = resolve at run time from which secrets are set)
#   $MODEL                      aeon's resolved model id (may be rewritten here)
#   <PROVIDER> secret           the secret for the selected gateway (see below)
#   vars.ANTHROPIC_BASE_URL     optional Anthropic-compatible endpoint (direct path)
#
# Two routing tiers:
#   NATIVE (no proxy): bankr, openrouter, usepod, grok  -> set base URL + auth, done.
#   SIDECAR (wrapper): surplus, venice            -> start claude-code-router on
#                                                    127.0.0.1 to translate
#                                                    Anthropic <-> OpenAI.
#
# NOTE: `grok` here is the GATEWAY path — Claude Code (`claude -p`) pointed at
# xAI's Anthropic-compatible API. It is distinct from the grok CLI *harness*
# (harness: grok in aeon.yml → harness-adapter/adapters/grok.sh), which runs the grok binary
# itself and never sources this file.
#
# NOTE: do not add `set -e/-u` here — this file is sourced and must not change
# the caller's shell options. A hard config error calls `exit 1`, which fails
# the step by design (mirrors aeon's existing behavior).

CCR_PORT="${CCR_PORT:-3456}"

require_secret() {
  if [ -z "${!1:-}" ]; then
    echo "::error::gateway.provider=${GATEWAY} requires the $1 secret but it is not set" >&2
    exit 1
  fi
}

# --- claude-code-router sidecar (SIDECAR tier) ------------------------------
# Single-provider ccr config on 127.0.0.1:$CCR_PORT. ccr's anthropic transformer
# serves /v1/messages and translates to the OpenAI-compatible upstream.
# Router.* pins EVERY slot (default/background/think/longContext) to one model,
# which also neutralizes the model-slot edge case (Claude Code's haiku/sonnet
# background calls all resolve to the configured upstream model).
start_ccr_sidecar() {
  local name="$1" base_url="$2" api_key="$3" model="$4" extra_tf="${5:-}"

  # NOTE: the host step runs under `bash -e` (Actions default), so conditionals
  # in this file must use `if` — a bare `[ … ] && …` list that evaluates false
  # would kill the step.
  #
  # sanitize-empty-text (scripts/ccr-sanitize.js) runs first: Claude Code can
  # emit whitespace-only text blocks that strict upstreams reject with a 400
  # ("text content blocks must contain non-whitespace text"). ccr skips the
  # transformer gracefully if the plugin fails to load.
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local transformers='"sanitize-empty-text", "anthropic"'
  if [ -n "$extra_tf" ]; then transformers="\"sanitize-empty-text\", \"anthropic\", \"${extra_tf}\""; fi

  if ! command -v ccr >/dev/null 2>&1; then
    if ! npm install -g @musistudio/claude-code-router@2.0.0 >/dev/null 2>&1; then
      echo "::error::failed to install @musistudio/claude-code-router@2.0.0" >&2
      exit 1
    fi
  fi

  local cfgdir="$HOME/.claude-code-router"
  mkdir -p "$cfgdir"
  cat > "$cfgdir/config.json" <<JSON
{
  "APIKEY": "",
  "HOST": "127.0.0.1",
  "PORT": ${CCR_PORT},
  "LOG": ${CCR_LOG:-false},
  "API_TIMEOUT_MS": 600000,
  "transformers": [
    { "path": "${script_dir}/ccr-sanitize.js" }
  ],
  "Providers": [
    {
      "name": "${name}",
      "api_base_url": "${base_url}",
      "api_key": "${api_key}",
      "models": ["${model}"],
      "transformer": { "use": [${transformers}] }
    }
  ],
  "Router": {
    "default": "${name},${model}",
    "background": "${name},${model}",
    "think": "${name},${model}",
    "longContext": "${name},${model}"
  }
}
JSON

  ccr start >/dev/null 2>&1 &
  CCR_PID=$!
  # Tear down on step exit. If the host step already sets an EXIT trap, chain
  # rather than overwrite (see INTEGRATION.md).
  # shellcheck disable=SC2064
  trap "kill ${CCR_PID} >/dev/null 2>&1 || true; ccr stop >/dev/null 2>&1 || true" EXIT

  local i
  for i in $(seq 1 30); do
    if curl -s -o /dev/null "http://127.0.0.1:${CCR_PORT}/v1/messages"; then break; fi
    sleep 1
    if [ "$i" -eq 30 ]; then
      echo "::error::claude-code-router did not become ready on 127.0.0.1:${CCR_PORT}" >&2
      exit 1
    fi
  done

  export ANTHROPIC_BASE_URL="http://127.0.0.1:${CCR_PORT}"
  export ANTHROPIC_API_KEY="sk-ccr-local"   # ccr APIKEY empty; value unused but must be non-empty
  unset ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN
}

# --- auto resolution --------------------------------------------------------
# When gateway.provider is `auto` (or unset), pick the first provider whose
# secret is present, in priority order. Override the order with the repo var
# GATEWAY_ORDER (space-separated). Default order:
#
#   claude     Claude Code subscription    (CLAUDE_CODE_OAUTH_TOKEN)
#   anthropic  pay-as-you-go Anthropic API (ANTHROPIC_API_KEY)
#   openrouter bankr usepod venice surplus  — gateway keys
#
# `claude` and `anthropic` are NATIVE direct-API tiers (handled by the case
# below). `direct` is the implicit final fallback (errors later if no usable key).
aeon_present() {  # is the secret for provider $1 set?
  case "$1" in
    claude)     [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] ;;
    anthropic)  [ -n "${ANTHROPIC_API_KEY:-}" ] ;;
    openrouter) [ -n "${OPENROUTER_API_KEY:-}" ] ;;
    bankr)      [ -n "${BANKR_LLM_KEY:-}" ] ;;
    usepod)     [ -n "${USEPOD_TOKEN:-}" ] ;;
    venice)     [ -n "${VENICE_API_KEY:-}" ] ;;
    surplus)    [ -n "${SURPLUS_API_KEY:-}" ] ;;
    grok)       [ -n "${XAI_API_KEY:-}" ] ;;
    *) false ;;
  esac
}
if [ -z "${GATEWAY:-}" ] || [ "${GATEWAY}" = "auto" ]; then
  # Ordered list of every provider whose secret is set (priority via GATEWAY_ORDER).
  AEON_CANDIDATES=""
  for provider in ${GATEWAY_ORDER:-claude anthropic openrouter bankr usepod venice surplus grok}; do
    if aeon_present "$provider"; then AEON_CANDIDATES="${AEON_CANDIDATES:+$AEON_CANDIDATES }$provider"; fi
  done
  [ -z "$AEON_CANDIDATES" ] && AEON_CANDIDATES="direct"
  # List mode (RUN, not sourced): print the cascade order and stop. aeon.yml's
  # Run step uses this to fail over from one provider to the next on any failure.
  if [ -n "${AEON_LIST_CANDIDATES:-}" ]; then printf '%s\n' "$AEON_CANDIDATES"; exit 0; fi
  # Single-shot: set up the first present provider (preserves prior behavior).
  GATEWAY="${AEON_CANDIDATES%% *}"
  echo "::notice::gateway=auto resolved to '${GATEWAY}'"
fi

# --- route ------------------------------------------------------------------
case "${GATEWAY:-direct}" in

  claude)  # NATIVE — Claude Code subscription (OAuth token)
    require_secret CLAUDE_CODE_OAUTH_TOKEN
    unset ANTHROPIC_API_KEY   # prefer the subscription token over a pay-go key
    echo "::notice::Using Claude Code subscription (CLAUDE_CODE_OAUTH_TOKEN)"
    ;;

  anthropic)  # NATIVE — pay-as-you-go Anthropic API key (or compatible endpoint)
    require_secret ANTHROPIC_API_KEY
    unset CLAUDE_CODE_OAUTH_TOKEN
    if [ -n "${ANTHROPIC_BASE_URL:-}" ]; then
      echo "::notice::Using Anthropic-compatible API at ${ANTHROPIC_BASE_URL}"
    else
      echo "::notice::Using direct Anthropic API (ANTHROPIC_API_KEY)"
    fi
    ;;

  bankr)  # NATIVE — Bankr Gateway (Anthropic-compatible base URL)
    require_secret BANKR_LLM_KEY
    export ANTHROPIC_BASE_URL="https://llm.bankr.bot"
    export ANTHROPIC_AUTH_TOKEN="$BANKR_LLM_KEY"
    unset ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN
    echo "::notice::Routing through Bankr Gateway (https://llm.bankr.bot)"
    ;;

  openrouter)  # NATIVE — Anthropic "skin", carries Opus 5
    require_secret OPENROUTER_API_KEY
    export ANTHROPIC_BASE_URL="https://openrouter.ai/api"   # NOT /api/v1
    export ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY"       # Bearer; API_KEY must be blank
    unset ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN
    # Map EVERY model slot Claude Code uses to OpenRouter slugs (opus/sonnet/haiku).
    export ANTHROPIC_DEFAULT_OPUS_MODEL="${OPENROUTER_MODEL:-anthropic/claude-opus-5}"
    export ANTHROPIC_DEFAULT_SONNET_MODEL="${OPENROUTER_MODEL_SONNET:-anthropic/claude-sonnet-5}"
    export ANTHROPIC_DEFAULT_HAIKU_MODEL="${OPENROUTER_MODEL_HAIKU:-anthropic/claude-haiku-4.5}"
    MODEL="$ANTHROPIC_DEFAULT_OPUS_MODEL"
    # App attribution: HTTP-Referer + X-Title make aeon's OpenRouter traffic show
    # up on openrouter.ai's public app leaderboard. Claude Code forwards
    # ANTHROPIC_CUSTOM_HEADERS (one "Name: Value" per line) to the upstream even on
    # a third-party gateway base URL. Override per fork with the repo vars
    # OPENROUTER_SITE_URL / OPENROUTER_APP_TITLE.
    export ANTHROPIC_CUSTOM_HEADERS="HTTP-Referer: ${OPENROUTER_SITE_URL:-https://aeon.fun}
X-Title: ${OPENROUTER_APP_TITLE:-Aeon}"
    echo "::notice::Routing through OpenRouter (Anthropic-native) as ${MODEL}"
    ;;

  usepod)  # NATIVE — token lives in the URL path; base URL IS a secret
    require_secret USEPOD_TOKEN
    export ANTHROPIC_BASE_URL="https://api.usepod.ai/proxy/${USEPOD_TOKEN}"
    export ANTHROPIC_AUTH_TOKEN="unused"    # UsePod auths via the path token
    unset ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN
    # UsePod mirrors the upstream Anthropic surface, so aeon's claude-opus-5 id
    # is passed through by default. If UsePod needs marketplace-specific ids, set
    # USEPOD_MODEL (+ _SONNET / _HAIKU) to override.
    if [ -n "${USEPOD_MODEL:-}" ]; then MODEL="$USEPOD_MODEL"; fi
    if [ -n "${USEPOD_MODEL_SONNET:-}" ]; then export ANTHROPIC_DEFAULT_SONNET_MODEL="$USEPOD_MODEL_SONNET"; fi
    if [ -n "${USEPOD_MODEL_HAIKU:-}" ]; then export ANTHROPIC_DEFAULT_HAIKU_MODEL="$USEPOD_MODEL_HAIKU"; fi
    echo "::notice::Routing through UsePod (Anthropic-native marketplace)"
    ;;

  grok)  # NATIVE — xAI's Anthropic-compatible API (Claude Code → api.x.ai)
    require_secret XAI_API_KEY
    # xAI's REST API is Anthropic-SDK-compatible; Claude Code appends
    # /v1/messages to ANTHROPIC_BASE_URL. Override the base with the repo var
    # XAI_ANTHROPIC_BASE_URL if xAI's Anthropic surface moves.
    export ANTHROPIC_BASE_URL="${XAI_ANTHROPIC_BASE_URL:-https://api.x.ai}"
    export ANTHROPIC_AUTH_TOKEN="$XAI_API_KEY"   # Bearer; API_KEY must be blank
    unset ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN
    # Pin every model slot to a grok coding model. Defaults to grok-4.5, xAI's current
    # flagship and the same id the grok harness offers (GROK_MODELS in the dashboard's
    # constants.ts), so the gateway and CLI paths name the same model. GROK_MODEL
    # overrides: the older coding ids (grok-build-0.1, grok-composer-2.5-fast,
    # grok-4.3) are api.x.ai model strings that still work here, even though the grok
    # CLI rejects them on an X-account OAuth login.
    grok_model="${GROK_MODEL:-grok-4.5}"
    export ANTHROPIC_DEFAULT_OPUS_MODEL="$grok_model"
    export ANTHROPIC_DEFAULT_SONNET_MODEL="$grok_model"
    export ANTHROPIC_DEFAULT_HAIKU_MODEL="$grok_model"
    MODEL="$grok_model"
    echo "::notice::Routing through xAI (Anthropic-compatible) as ${grok_model} @ ${ANTHROPIC_BASE_URL}"
    ;;

  surplus)  # SIDECAR — OpenAI-compatible (dot-form ids); carries the full catalog
    require_secret SURPLUS_API_KEY
    # The sidecar pins ONE model across every ccr slot, so derive it from aeon's
    # resolved $MODEL (the UI / aeon.yml choice) instead of hardcoding one. Surplus
    # uses dot-form ids: drop any trailing -YYYYMMDD date, then convert each
    # <digit>-<digit> to <digit>.<digit>. SURPLUS_MODEL overrides; opus-4.8 is the
    # fallback when $MODEL is unset.
    surplus_model="${SURPLUS_MODEL:-$(printf '%s' "${MODEL:-claude-opus-5}" | sed -E 's/-[0-9]{8}$//; s/([0-9])-([0-9])/\1.\2/g')}"
    start_ccr_sidecar surplus \
      "https://www.surplusintelligence.ai/api/inference/v1/chat/completions" \
      "$SURPLUS_API_KEY" "$surplus_model"
    echo "::notice::Routing through Surplus via claude-code-router (${surplus_model})"
    ;;

  venice)  # SIDECAR — OpenAI-compatible (dash-form ids); carries Opus 5, no haiku
    require_secret VENICE_API_KEY
    # Set VENICE_CLEANCACHE=1 to add the cleancache transformer (1h TTL, avoids
    # the shared 4-block prompt-cache limit) if you hit cache errors.
    # The sidecar pins ONE model, so track aeon's $MODEL. Venice names models with
    # aeon's own dash-form ids, so the picker's ids pass straight through (date
    # suffix stripped) when Venice carries them. It carries NO haiku at all, so
    # haiku, and anything else off-catalog, falls back to sonnet-5 rather than
    # 404ing on a model Venice never had. VENICE_MODEL overrides.
    # Allowlist verified against api.venice.ai/api/v1/models on 2026-07-24.
    # VENICE_BASE_URL (repo variable) points the sidecar at any Venice-compatible
    # endpoint — a self-hosted relay, a billing proxy, a regional mirror — same
    # override pattern as VENICE_MODEL. Defaults to Venice's public API.
    venice_model="${VENICE_MODEL:-}"
    if [ -z "$venice_model" ]; then
      m="$(printf '%s' "${MODEL:-}" | sed -E 's/-[0-9]{8}$//')"
      case "$m" in
        claude-opus-5|claude-sonnet-5|claude-fable-5) venice_model="$m" ;;
        *) venice_model="claude-sonnet-5" ;;
      esac
    fi
    start_ccr_sidecar venice \
      "${VENICE_BASE_URL:-https://api.venice.ai/api/v1/chat/completions}" \
      "$VENICE_API_KEY" "$venice_model" "${VENICE_CLEANCACHE:+cleancache}"
    echo "::notice::Routing through Venice via claude-code-router (${venice_model} @ ${VENICE_BASE_URL:-https://api.venice.ai/api/v1/chat/completions})"
    ;;

  direct|"")  # NATIVE — Anthropic API or an Anthropic-compatible endpoint
    if [ -n "${ANTHROPIC_BASE_URL:-}" ]; then
      echo "::notice::Using Anthropic-compatible API at ${ANTHROPIC_BASE_URL}"
    else
      echo "::notice::Using direct Anthropic API"
    fi
    ;;

  *)
    echo "::error::unknown gateway.provider '${GATEWAY}'" >&2
    exit 1
    ;;
esac
