#!/usr/bin/env bash
# install-harness — stage a harness CLI and its provider auth on the runner.
#
# Extracted from aeon.yml's "Install harness CLI" step so every workflow that
# launches an agent can stage any of the six. It was inline in aeon.yml, which is
# the only reason messages.yml supported just claude/grok: a repo configured for
# codex/pi/vibe/kimi had its inbound messages answered on claude, because nothing
# on that workflow could install the CLI. Same class of bug as the two-path grok
# trap (#784) — a capability that exists on one surface and silently doesn't on
# another. The logic lives here now; each workflow supplies its own `env:` block,
# since `secrets.*` only resolves inside a workflow.
#
# Usage:
#   bash scripts/install-harness.sh [harness]      # or set $H
#
# claude is a no-op: workflows install it themselves (pinned + npm-cached) and it
# needs no per-provider auth. Calling this with `claude` is therefore fine and
# does nothing, so a caller can invoke it unconditionally.
#
# Inputs (env):
#   H            harness name (or $1)
#   HM           harness model — the OpenRouter id baked into the staged config
#   AUTH_MODE    native-oauth | native-key | openrouter   (from resolve-harness.sh)
#   plus the provider credentials for that harness (see the cases below)
#
# Everything written lands in the runner's ephemeral $HOME and is never echoed.
set -euo pipefail

H="${1:-${H:-}}"
HM="${HM:-}"
AUTH_MODE="${AUTH_MODE:-openrouter}"

# Fail CLOSED on a missing provider credential, and say which one.
#
# Inside a workflow every key below is declared in the step's `env:` block, so it
# is always *bound* (empty when the secret is unset) and `set -u` never fires.
# Standalone — messages.yml, a local run, apps/mcp-server — an undeclared key is
# unbound, and under `set -u` the heredoc dies MID-EXPANSION: bash has already
# created the file, so the harness is left holding a 0-byte config.toml and the
# error names a shell variable rather than the missing secret. Check first.
need() {  # need VAR_NAME "what to set"
  local name="$1" hint="$2"
  if [ -z "${!name:-}" ]; then
    echo "::error::$H needs $name — $hint" >&2
    exit 1
  fi
}

# Each harness is configured for the provider AUTH_MODE selected:
#   native-oauth — restore the captured login (~/.codex, ~/.kimi-code); the
#                  harness then runs on its own default model.
#   native-key   — the provider's own API key (codex→OpenAI, kimi→Moonshot,
#                  vibe→Mistral, pi→Anthropic/OpenAI from env).
#   openrouter   — the shared OPENROUTER_API_KEY (the default; one key covers all
#                  four). $HM is the OpenRouter model here.
case "$H" in
  claude|"")
    # Installed by the workflow itself (pinned, npm-cached), no provider auth.
    echo "claude: installed by the workflow (no per-provider auth needed)"
    exit 0 ;;
  grok)
    # Install the pinned grok CLI + restore its auth (GROK_CREDENTIALS X-account
    # OAuth, or XAI_API_KEY). run-grok.sh's `setup` subcommand runs ONLY those two
    # steps and exits — the actual run then goes through run-harness grok, on
    # grok's own auth. Keeping the pin + restore in one place is why this shells
    # out rather than inlining an `npm install -g @xai-official/grok`.
    bash "${GITHUB_WORKSPACE:-$(pwd)}/scripts/run-grok.sh" setup
    echo "grok: CLI + auth staged (auth: ${AUTH_MODE:-native})" ;;
  codex)
    # PINNED, like aeon pins claude-code. Unpinned, this step silently tracked
    # latest: two cells that passed on 2026-07-21 failed hours later with an
    # OpenRouter 400 and nothing in the repo had changed.
    # --ignore-scripts (same hardening as pi/kimi): codex ships its binary via
    # optional platform packages (@openai/codex-<os>-<arch>), NOT a postinstall
    # fetch, so blocking lifecycle scripts is safe and denies a compromised
    # release an auto-run install hook in the run's secret env. If a future pin
    # needs a postinstall binary fetch, drop this flag (keep the pin).
    npm install -g --ignore-scripts @openai/codex@0.144.6
    mkdir -p "$HOME/.codex"
    case "$AUTH_MODE" in
      native-oauth)
        # Restore the ChatGPT login captured by `aeon auth --harness codex`
        # (tar+base64 of ~/.codex/auth.json). codex refreshes the access token
        # from the refresh token at run start and uses its own default model —
        # no config needed, no OpenRouter.
        need CODEX_AUTH "the ChatGPT login capture from 'aeon auth --harness codex'"
        printf '%s' "$CODEX_AUTH" | base64 -d | tar xzf - -C "$HOME"
        chmod 600 "$HOME/.codex/auth.json" || true
        echo "codex: restored ChatGPT login" ;;
      native-key)
        # OPENAI_API_KEY in env → codex's built-in `openai` provider (its
        # default), on codex's default model. No OpenRouter block.
        cat > "$HOME/.codex/config.toml" <<'TOML'
model_reasoning_effort = "medium"
TOML
        echo "codex: OpenAI API key" ;;
      *)
        # wire_api MUST be "responses": codex 0.144.6 removed "chat" ("no longer
        # supported", a hard config-load error), and OpenRouter does serve
        # /api/v1/responses. Both verified 2026-07-21.
        cat > "$HOME/.codex/config.toml" <<TOML
model = "$HM"
model_provider = "openrouter"
# OpenRouter rejects a reasoning-disabled request to this endpoint:
# 400 "Reasoning is mandatory for this endpoint and cannot be disabled."
model_reasoning_effort = "medium"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
env_key = "OPENROUTER_API_KEY"
wire_api = "responses"
TOML
        echo "codex: OpenRouter" ;;
    esac
    ;;
  pi)
    # PINNED (like codex/claude): an unpinned `-g` install silently tracks latest
    # and would run whatever the registry serves in CI with the run's secrets in
    # env. 0.80.9 is the version verified live 2026-07-22.
    # --ignore-scripts: pi's postinstall is not needed headless.
    npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.80.9
    # pi picks its provider from whichever key is in env at RUN time
    # (ANTHROPIC_API_KEY / OPENAI_API_KEY native, else OPENROUTER_API_KEY with
    # --model openrouter/…). No config file either way.
    echo "pi: $AUTH_MODE (env-driven)"
    ;;
  kimi)
    # PINNED + --ignore-scripts: same supply-chain hardening as pi/codex. 0.28.0
    # is the version verified live 2026-07-22. If a future CI run shows kimi's
    # install needs a postinstall binary fetch, drop --ignore-scripts (keep the pin).
    npm install -g --ignore-scripts @moonshot-ai/kimi-code@0.28.0
    mkdir -p "$HOME/.kimi-code"
    case "$AUTH_MODE" in
      native-oauth)
        # Restore the Moonshot device login captured by `aeon auth --harness kimi`;
        # kimi then runs on Moonshot by default.
        need KIMI_AUTH "the Moonshot login capture from 'aeon auth --harness kimi'"
        printf '%s' "$KIMI_AUTH" | base64 -d | tar xzf - -C "$HOME"
        echo "kimi: restored Moonshot login" ;;
      native-key)
        # MOONSHOT_API_KEY → Moonshot provider. Model id is best-effort; adjust to
        # your Moonshot plan if it 404s.
        need MOONSHOT_API_KEY "a Moonshot API key (or use the OAuth capture)"
        cat > "$HOME/.kimi-code/config.toml" <<TOML
default_model = "kimi-native"

[providers.moonshot]
type = "openai"
base_url = "https://api.moonshot.ai/v1"
api_key = "$MOONSHOT_API_KEY"

[models.kimi-native]
provider = "moonshot"
model = "kimi-k2.5"
max_context_size = 131072
TOML
        chmod 600 "$HOME/.kimi-code/config.toml"
        echo "kimi: Moonshot API key" ;;
      *)
        # kimi resolves --model through ALIASES declared here and takes the
        # provider key inline. default_model set → run-harness passes no --model
        # at all, which is what we want.
        need OPENROUTER_API_KEY "the shared OpenRouter key (one covers all four)"
        cat > "$HOME/.kimi-code/config.toml" <<TOML
default_model = "or-cheap"

[providers.openrouter]
type = "openai"
base_url = "https://openrouter.ai/api/v1"
api_key = "$OPENROUTER_API_KEY"

[models.or-cheap]
provider = "openrouter"
model = "$HM"
max_context_size = 400000
TOML
        chmod 600 "$HOME/.kimi-code/config.toml"
        echo "kimi: OpenRouter" ;;
    esac
    ;;
  vibe)
    # PINNED: 2.20.0 verified live 2026-07-22. (pipx/pip has no clean per-package
    # --ignore-scripts equivalent, so the pin is the guard here.)
    pipx install mistral-vibe==2.20.0
    [ -n "${GITHUB_PATH:-}" ] && echo "$HOME/.local/bin" >> "$GITHUB_PATH"
    if [ "$AUTH_MODE" = "native-key" ]; then
      # MISTRAL_API_KEY set → vibe's DEFAULT provider IS Mistral; it runs straight
      # off the env key, no config. (The config below only exists because vibe
      # hard-fails WITHOUT a Mistral key.)
      echo "vibe: Mistral API key (default provider)"
    else
      # vibe's ProviderConfig is generic (api_base + api_key_env_var + api_style),
      # so point it at OpenRouter.
      mkdir -p "$HOME/.vibe"
      cat > "$HOME/.vibe/config.toml" <<TOML
active_model = "or-cheap"

[[providers]]
name = "openrouter"
api_base = "https://openrouter.ai/api/v1"
api_key_env_var = "OPENROUTER_API_KEY"
api_style = "openai"

[[models]]
name = "$HM"
provider = "openrouter"
alias = "or-cheap"
TOML
      echo "vibe: OpenRouter"
    fi
    ;;
  fx)
    # curl-installed native binary (Zig, ~10MB), no package manager. fx ships no
    # pinned-version install path as of 0.0.5 — it's brand-new/experimental per
    # its own README, so this tracks whatever fx.sh/setup.sh currently serves.
    # Revisit if/when fx publishes pinned release artifacts.
    curl -fsSL https://fx.sh/setup.sh | bash
    [ -n "${GITHUB_PATH:-}" ] && echo "$HOME/.local/bin" >> "$GITHUB_PATH"
    # fx has NO OpenRouter path (confirmed: no mention anywhere in its docs —
    # see resolve-harness.sh's fx case for the same note). Every other harness
    # here falls back to the shared OPENROUTER_API_KEY when its own native
    # credential is missing; fx has nothing to fall back to. So this fails
    # closed here rather than staging a CLI that's guaranteed to fail later
    # inside the actual agent run with a less obvious error.
    if [ -n "${AI_GATEWAY_API_KEY:-}" ] || [ -n "${VERCEL_OIDC_TOKEN:-}" ]; then
      echo "fx: Vercel AI Gateway / OIDC key staged via env (fx reads it directly, no config file needed)"
    else
      echo "::error::fx needs AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN — it has no OpenRouter fallback, unlike every other harness here" >&2
      exit 1
    fi
    ;;
  cursor)
    curl -fsSL https://cursor.com/install | bash
    [ -n "${GITHUB_PATH:-}" ] && echo "$HOME/.local/bin" >> "$GITHUB_PATH"
    need CURSOR_API_KEY "a Cursor API key for headless CLI runs"
    echo "cursor: API key staged via CURSOR_API_KEY" ;;
  hermes)
    curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
    [ -n "${GITHUB_PATH:-}" ] && echo "$HOME/.local/bin" >> "$GITHUB_PATH"
    mkdir -p "$HOME/.hermes"
    if [ "$AUTH_MODE" = "native-oauth" ]; then
      need HERMES_AUTH "the Nous Portal capture from 'hermes auth --harness hermes'"
      printf '%s' "$HERMES_AUTH" | base64 -d | tar xzf - -C "$HOME"
      chmod 600 "$HOME/.hermes/auth.json" 2>/dev/null || true
      echo "hermes: restored Nous Portal login"
    else
      need OPENROUTER_API_KEY "the shared OpenRouter key (or capture HERMES_AUTH for Nous Portal)"
      echo "hermes: OpenRouter fallback via OPENROUTER_API_KEY"
    fi
    ;;
  *)
    echo "::error::no install recipe for harness '$H'"; exit 1 ;;
esac
echo "installed harness CLI: $H  (auth: $AUTH_MODE)"
