#!/usr/bin/env bash
# resolve-harness — decide WHICH harness runs, on WHICH provider, with WHICH model.
#
# Extracted from aeon.yml's "Resolve harness" step so every surface that launches
# an agent resolves identically. It is the companion of scripts/install-harness.sh
# (which stages the CLI these outputs describe) and of harness-adapter/run-harness
# (which consumes MODEL_ARG). Splitting the decision from the workflow is what lets
# messages.yml support all seven harnesses instead of only claude/grok — a gap that
# existed purely because this ~100 lines lived inside one workflow step.
#
# Usage:
#   bash scripts/resolve-harness.sh [skill-name]     -> KEY=VALUE lines on stdout
#
# The skill name is OPTIONAL: it selects the per-skill `harness:`/`model:`
# overrides from aeon.yml. Omit it for surfaces that aren't a per-skill run
# (inbound messages), and the repo-global keys decide — which is what those
# surfaces want, and the reason the same script serves both.
#
# Inputs (env, all optional):
#   INPUT_HARNESS / INPUT_MODEL   workflow_dispatch overrides ("(config default)"
#                                 is treated as unset — that's the dropdown's
#                                 placeholder value, not a harness name)
#   HARNESS_MODEL                 vars.HARNESS_MODEL, a repo-wide model override
#   CODEX_AUTH / KIMI_AUTH / GROK_CREDENTIALS
#   OPENAI_API_KEY / MOONSHOT_API_KEY / MISTRAL_API_KEY / XAI_API_KEY
#   ANTHROPIC_API_KEY / ANTHROPIC_OAUTH_TOKEN
#                                 presence ONLY — never read for their value here,
#                                 never echoed. They pick AUTH_MODE.
#
# Outputs (stdout, one KEY=VALUE per line — append to $GITHUB_OUTPUT/$GITHUB_ENV,
# or `eval` after review):
#   HARNESS        claude | grok | codex | pi | vibe | kimi
#   AUTH_MODE      native-oauth | native-key | openrouter
#   HARNESS_MODEL  the model label for logs/records ("(native:…)" on native auth)
#   MODEL_ARG      what to pass as `run-harness --model`, or empty for "the
#                  harness's own staged config decides"
#
# Reads ./aeon.yml from the current directory. Prints diagnostics to stderr.
set -euo pipefail

SKILL_NAME="${1:-}"

# `|| true` on every grep: a repo with no top-level `harness:` key, or a skill
# absent from aeon.yml's skills map, makes grep exit 1 — and under `set -e` that
# kills the caller with NO message, leaving a red step and nothing to go on. An
# empty result already means "not configured", which the defaults below handle.
CONFIG_HARNESS=$(grep -E '^harness:' aeon.yml | sed 's/^harness: *//' | tr -d ' ' || true)
SKILL_HARNESS=""
[ -n "$SKILL_NAME" ] && SKILL_HARNESS=$(grep "^  ${SKILL_NAME}:" aeon.yml | sed -n 's/.*harness: *"\([^"]*\)".*/\1/p' || true)

if [ -n "${INPUT_HARNESS:-}" ] && [ "$INPUT_HARNESS" != "(config default)" ]; then
  HARNESS="$INPUT_HARNESS"
elif [ -n "$SKILL_HARNESS" ]; then
  HARNESS="$SKILL_HARNESS"
else
  HARNESS="${CONFIG_HARNESS:-claude}"
fi

# Allowlist. Upstream had a claude/grok binary, so ANY other value was silently
# rewritten to claude. These seven are the ones wired end to end on a real runner.
# Deliberately NOT here, each for a measured reason:
#   opencode — its .result carried the agent's narration instead of the
#              deliverable (fixed in the adapter, but it still loops to the
#              wall-clock guard on research skills);
#   copilot  — no credential path without a Copilot-subscribed PAT;
#   agy      — its print mode runs tools outside $PWD, so it reports success
#              having written nothing to the workspace.
case "$HARNESS" in
  claude|grok|codex|pi|vibe|kimi|fx) ;;
  *) echo "::warning::unknown harness '$HARNESS' — falling back to claude" >&2
     HARNESS="claude" ;;
esac

# Which PROVIDER does this harness run on? Decided by which auth secret is set,
# native first, OpenRouter last — the same ordered set the dashboard's
# authSecretsForHarness / HARNESS_AUTH registry expose, and the order
# install-harness.sh configures. `native-oauth` = a captured ChatGPT/Moonshot
# login restored at install; `native-key` = a provider API key in env;
# `openrouter` = the shared key (the default). This matters for the MODEL: on
# native auth the OpenRouter openai/* ids are the WRONG provider, so we forward
# NO model and let the harness use its own default.
AUTH_MODE="openrouter"
case "$HARNESS" in
  grok)  if [ -n "${GROK_CREDENTIALS:-}" ]; then AUTH_MODE="native-oauth"; elif [ -n "${XAI_API_KEY:-}" ]; then AUTH_MODE="native-key"; fi ;;
  codex) if [ -n "${CODEX_AUTH:-}" ]; then AUTH_MODE="native-oauth"; elif [ -n "${OPENAI_API_KEY:-}" ]; then AUTH_MODE="native-key"; fi ;;
  kimi)  if [ -n "${KIMI_AUTH:-}" ]; then AUTH_MODE="native-oauth"; elif [ -n "${MOONSHOT_API_KEY:-}" ]; then AUTH_MODE="native-key"; fi ;;
  vibe)  if [ -n "${MISTRAL_API_KEY:-}" ]; then AUTH_MODE="native-key"; fi ;;
  pi)    if [ -n "${ANTHROPIC_API_KEY:-}" ] || [ -n "${ANTHROPIC_OAUTH_TOKEN:-}" ] || [ -n "${OPENAI_API_KEY:-}" ]; then AUTH_MODE="native-key"; fi ;;
  # fx has no OpenRouter path at all (confirmed: no mention anywhere in its
  # docs/CONTRIBUTING.md — its only credential surfaces are Vercel AI Gateway
  # and an interactive `fx login`, not viable headless). so unlike every other
  # harness here, if neither var is set this stays "openrouter" as a LABEL but
  # there's no real fallback behind it: fx will just fail cleanly at its own
  # credential check (adapters/fx.sh already surfaces that as a clear
  # MissingCredentials error, not a silent/confusing one) rather than actually
  # running on a shared key like the other six do.
  fx)    if [ -n "${AI_GATEWAY_API_KEY:-}" ] || [ -n "${VERCEL_OIDC_TOKEN:-}" ]; then AUTH_MODE="native-key"; fi ;;
esac

# The harness model (HM), in priority order:
#   1. vars.HARNESS_MODEL         — a repo-wide override, handy for CI.
#   2. the model chosen in the dashboard (which writes `model:` into aeon.yml) or
#      a per-skill/dispatch model — WHEN it's an OpenRouter id. This is what makes
#      the dashboard's model picker actually control what runs: modelsForHarness()
#      offers OpenRouter ids for these harnesses.
#   3. a per-harness cheap default.
# aeon-native ids (claude-*/grok-*) mean nothing to an OpenRouter CLI, so they're
# treated as "unset" and fall through to the default — a repo that never touched
# the model picker (still `model: claude-sonnet-5`) still gets a working default
# instead of a dead id.
# Each harness defaults to its own native family (the dashboard's per-harness
# list, modelsForHarness[0]). The generic `*)` fallback is gpt-5-mini — a
# universally safe id — NOT gpt-5-nano: codex fails DETERMINISTICALLY on nano
# (measured on a real runner the model emits a shell tool call with a duplicated
# `cmd` field, codex's strict parser rejects it, and codex, which has no
# --max-turns, spins to the 900s guard); the same skill passes on gpt-5-mini.
CONFIG_MODEL=$(grep -E '^model:' aeon.yml | sed 's/^model: *//' | tr -d ' ' || true)
SKILL_MODEL=""
[ -n "$SKILL_NAME" ] && SKILL_MODEL=$(grep "^  ${SKILL_NAME}:" aeon.yml | sed -n 's/.*model: *"\([^"]*\)".*/\1/p' || true)

if [ -n "${INPUT_MODEL:-}" ] && [ "$INPUT_MODEL" != "(config default)" ]; then
  REQ_MODEL="$INPUT_MODEL"
elif [ -n "$SKILL_MODEL" ]; then
  REQ_MODEL="$SKILL_MODEL"
else
  REQ_MODEL="${CONFIG_MODEL:-}"
fi
case "$REQ_MODEL" in claude-*|grok-*|"") REQ_MODEL="" ;; esac   # aeon-native / unset → not an OpenRouter id

# NOTE: changing any per-harness DEFAULT_HM below also requires updating the
# expected values in scripts/tests/test_resolve_harness.sh (a stale codex pin
# there broke CI once; fixed in #896). If the same model-pin pass edits skill
# bodies, run `eyebrow scan` and commit the refreshed eyebrowlock.json too.
case "$HARNESS" in
  codex) DEFAULT_HM="openai/gpt-5.1-codex-mini" ;;
  vibe)  DEFAULT_HM="mistralai/mistral-medium-3-5" ;;   # vibe's default (VIBE_MODELS[0])
  pi)    DEFAULT_HM="deepseek/deepseek-v4-flash" ;;     # pi's default (PI_MODELS[0])
  kimi)  DEFAULT_HM="moonshotai/kimi-k2.5" ;;           # kimi's default (KIMI_MODELS[0])
  *)     DEFAULT_HM="openai/gpt-5-mini" ;;              # generic fallback: only claude/grok hit it (and don't consume it)
esac
HM="${HARNESS_MODEL:-${REQ_MODEL:-$DEFAULT_HM}}"

# The --model run-harness should pass, or empty for "the harness's own staged
# config decides". aeon's model ids are always claude-*/grok-*, which mean nothing
# to an OpenRouter-backed CLI, so they are NOT forwarded: passing one leaves the
# harness on its default while every downstream record (token-usage.csv, the
# signed run manifest) names a model that never ran.
MODEL_ARG=""
if [ "$AUTH_MODE" = "openrouter" ]; then
  case "$HARNESS" in
    codex) MODEL_ARG="$HM" ;;                 # config.toml pins the provider; --model takes a bare id
    pi)    MODEL_ARG="openrouter/$HM" ;;      # pi wants provider/model
    # vibe and kimi resolve a config ALIAS rather than a raw id, so passing
    # --model breaks them — their staged config decides.
  esac
else
  # Native auth (the operator's own ChatGPT/Moonshot/provider account): let the
  # harness pick its own default model. HM is only a label here.
  HM="(native:$AUTH_MODE)"
fi

echo "Harness: $HARNESS  |  auth: $AUTH_MODE  |  model: $HM  |  run-harness --model: ${MODEL_ARG:-<harness default>}" >&2
printf 'HARNESS=%s\n'       "$HARNESS"
printf 'AUTH_MODE=%s\n'     "$AUTH_MODE"
printf 'HARNESS_MODEL=%s\n' "$HM"
printf 'MODEL_ARG=%s\n'     "$MODEL_ARG"
