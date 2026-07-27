#!/usr/bin/env bash
# Tests for scripts/install-harness.sh — the shared CLI+auth staging used by BOTH
# aeon.yml and messages.yml.
#
# Fake `npm`/`pipx` on PATH record their argv instead of installing, and $HOME is
# a temp dir, so the real work under test is what this step actually gets wrong:
# the generated provider config, and the supply-chain version pins.
#
# The codex config is the sharp case. codex parses config as TOML and fails the
# whole run on a malformed one — and it removed wire_api="chat" as a hard
# config-load error, which reads as a dead model, not a config bug. That class of
# failure was previously only discoverable by dispatching a real run.
#
# Run: bash scripts/tests/test_install_harness.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
I="$ROOT/scripts/install-harness.sh"
fail=0
pass() { echo "ok   - $1"; }
bad()  { echo "FAIL - $1"; fail=1; }

BIN="$(mktemp -d)"
cleanup() { rm -rf "$BIN"; }
trap cleanup EXIT

for tool in npm pipx; do
  cat > "$BIN/$tool" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" >> "\$PKG_LOG"
EOF
  chmod +x "$BIN/$tool"
done

# run <harness> [env...] -> stages into a fresh $HOME; sets H_DIR and PKG_LOG
run() {
  local h="$1"; shift
  H_DIR="$(mktemp -d)"
  PKG_LOG="$H_DIR/pkg.log"; : > "$PKG_LOG"
  env PATH="$BIN:$PATH" HOME="$H_DIR" PKG_LOG="$PKG_LOG" GITHUB_PATH="" "$@" \
    bash "$I" "$h" >"$H_DIR/out.txt" 2>&1
  return $?
}

# --- 1. claude is a no-op, unknown is fatal --------------------------------
# Callers may invoke this unconditionally, so claude must succeed and do nothing.
run claude && [ ! -e "$H_DIR/.codex" ] \
  && pass "claude: no-op, exit 0" || bad "claude should be a no-op"
if run banana; then bad "unknown harness must fail"; else
  grep -q "no install recipe" "$H_DIR/out.txt" \
    && pass "unknown harness exits non-zero with a named error" \
    || bad "unknown harness error message"
fi

# --- 2. codex config generation --------------------------------------------
run codex HM=openai/gpt-5-mini AUTH_MODE=openrouter OPENROUTER_API_KEY=sk-test
CFG="$H_DIR/.codex/config.toml"
if [ -f "$CFG" ]; then
  # wire_api MUST be "responses": codex 0.144.6 removed "chat" as a hard
  # config-load error, which kills the run before the model is ever reached.
  grep -q 'wire_api = "responses"' "$CFG" \
    && pass "codex/openrouter: wire_api is responses" || bad "codex wire_api"
  grep -q 'model = "openai/gpt-5-mini"' "$CFG" \
    && pass "codex/openrouter: HM lands in the config" || bad "codex model"
  # OpenRouter 400s a reasoning-disabled request to /responses.
  grep -q 'model_reasoning_effort' "$CFG" \
    && pass "codex/openrouter: reasoning effort set" || bad "codex reasoning effort"
  # TOML, not JSON: a JSON object here is what silently killed codex's MCP config.
  grep -q '^\[model_providers.openrouter\]' "$CFG" \
    && pass "codex/openrouter: provider is a TOML table" || bad "codex provider table"
else bad "codex/openrouter: no config written"; fi

run codex AUTH_MODE=native-key
CFG="$H_DIR/.codex/config.toml"
if [ -f "$CFG" ]; then
  # native-key uses codex's built-in openai provider — an OpenRouter block here
  # would override the operator's own account.
  grep -q 'openrouter' "$CFG" && bad "codex/native-key must not write an OpenRouter block" \
    || pass "codex/native-key: no OpenRouter block"
else bad "codex/native-key: no config written"; fi

# --- 3. kimi + vibe config generation --------------------------------------
run kimi HM=moonshotai/kimi-k2.5 AUTH_MODE=openrouter OPENROUTER_API_KEY=sk-test
CFG="$H_DIR/.kimi-code/config.toml"
if [ -f "$CFG" ]; then
  # kimi resolves --model through an ALIAS, so default_model must be the alias and
  # the real id lives under [models.<alias>]. run-harness then passes no --model.
  grep -q 'default_model = "or-cheap"' "$CFG" \
    && pass "kimi: default_model is the alias" || bad "kimi alias"
  grep -q 'model = "moonshotai/kimi-k2.5"' "$CFG" \
    && pass "kimi: HM lands under the alias" || bad "kimi model"
  # The config holds a live provider key.
  PERM=$(ls -l "$CFG" | cut -c1-10)
  [ "$PERM" = "-rw-------" ] \
    && pass "kimi: config is chmod 600 (holds a provider key)" || bad "kimi config perms ($PERM)"
else bad "kimi: no config written"; fi

run vibe HM=mistralai/mistral-medium-3-5 AUTH_MODE=openrouter OPENROUTER_API_KEY=sk-test
CFG="$H_DIR/.vibe/config.toml"
grep -q 'alias = "or-cheap"' "$CFG" 2>/dev/null \
  && pass "vibe/openrouter: alias config written" || bad "vibe openrouter config"
# With a Mistral key, vibe's DEFAULT provider is already Mistral — writing an
# OpenRouter config would silently redirect the operator's own account.
run vibe AUTH_MODE=native-key
[ ! -f "$H_DIR/.vibe/config.toml" ] \
  && pass "vibe/native-key: no config (Mistral is vibe's default)" || bad "vibe native-key wrote a config"

# --- 4. supply-chain pins ---------------------------------------------------
# An unpinned `-g` install runs whatever the registry serves, in CI, with the
# run's secrets in env. Two codex cells already failed this way when unpinned.
run codex AUTH_MODE=openrouter OPENROUTER_API_KEY=sk-test
grep -q '@openai/codex@[0-9]' "$PKG_LOG" \
  && pass "codex: install is version-pinned" || bad "codex pin missing"
run pi AUTH_MODE=openrouter OPENROUTER_API_KEY=sk-test
grep -q '@earendil-works/pi-coding-agent@[0-9]' "$PKG_LOG" \
  && pass "pi: install is version-pinned" || bad "pi pin missing"
grep -qx -- '--ignore-scripts' "$PKG_LOG" \
  && pass "pi: --ignore-scripts (no postinstall)" || bad "pi --ignore-scripts missing"
run kimi AUTH_MODE=openrouter OPENROUTER_API_KEY=sk-test
grep -q '@moonshot-ai/kimi-code@[0-9]' "$PKG_LOG" \
  && pass "kimi: install is version-pinned" || bad "kimi pin missing"
grep -qx -- '--ignore-scripts' "$PKG_LOG" \
  && pass "kimi: --ignore-scripts (no postinstall)" || bad "kimi --ignore-scripts missing"
run vibe AUTH_MODE=native-key
grep -q 'mistral-vibe==[0-9]' "$PKG_LOG" \
  && pass "vibe: install is version-pinned" || bad "vibe pin missing"

# --- 5. missing credential fails closed, and names the secret ---------------
# Found writing these tests. `set -u` + an unbound key killed the script
# MID-HEREDOC: bash had already created config.toml, so the harness was left with
# a 0-byte config and an error naming a shell variable rather than the secret.
# Inside a workflow the `env:` block always binds these (empty when unset), so it
# never fired there — it only appears the moment this is callable standalone,
# which is exactly what this extraction makes it.
if run kimi AUTH_MODE=openrouter; then
  bad "kimi with no OPENROUTER_API_KEY should fail"
else
  grep -q "needs OPENROUTER_API_KEY" "$H_DIR/out.txt" \
    && pass "missing key: error names the secret" || bad "missing-key error should name the secret"
  [ ! -s "$H_DIR/.kimi-code/config.toml" ] 2>/dev/null && [ ! -f "$H_DIR/.kimi-code/config.toml" ] \
    && pass "missing key: no truncated config left behind" \
    || bad "missing key left a partial config.toml"
fi
if run codex AUTH_MODE=native-oauth; then
  bad "codex native-oauth with no CODEX_AUTH should fail"
else
  grep -q "needs CODEX_AUTH" "$H_DIR/out.txt" \
    && pass "missing OAuth capture: error names the secret" || bad "CODEX_AUTH error message"
fi

echo "---"
[ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
