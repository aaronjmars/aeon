#!/usr/bin/env bash
# stage-deploy-uni-hook.sh — stage Foundry + a ready-to-deploy Uniswap v4 project
# for the deploy-uni-hook skill, in the WORKFLOW step (full capability), BEFORE
# `claude -p` starts. Mirrors scripts/stage-vuln-scanner.sh.
#
# Two reasons this must be a workflow step, not in-run:
#   1. The `claude -p` sandbox denies toolchain installs (curl|bash, cargo probes
#      — confirmed on run 30573871187). A workflow step has full capability.
#   2. PATH persistence. Claude runs each Bash call in a FRESH shell, so an in-run
#      `export PATH` is gone by the next call. Only a workflow step can append
#      $GITHUB_PATH, which reaches `claude -p` and every subprocess it spawns.
#
# After this step the agent only: edits the AEON:LOGIC region of a template, then
# runs `./hook-deploy.sh simulate|broadcast <kind>`. No install, no v4 clone in-run.
#
# No-op for every other skill. Best-effort: never fails the run (exit 0 on error);
# the skill's own `command -v forge` / staged-dir guard degrades cleanly.
set -uo pipefail

SKILL="${1:-}"
[ "$SKILL" = "deploy-uni-hook" ] || exit 0

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${HOOKBUILD_DIR:-$HOME/hookbuild}"
TPL="$ROOT/skills/deploy-uni-hook/templates"

log() { echo "stage-deploy-uni-hook: $*"; }

# 1) Foundry (forge/cast/anvil) -> ~/.foundry/bin, made resolvable in later steps.
# The workflow's "Install Foundry (deploy-uni-hook)" step (foundry-rs/foundry-
# toolchain) normally puts forge on PATH before this runs, so this fallback is a
# no-op there. Kept for non-workflow callers. Do NOT silence stderr: the old
# `curl … | bash >/dev/null 2>&1` hid the release-CDN rate-limit that left forge
# missing, so a deploy run went green with no toolchain.
if ! command -v forge >/dev/null 2>&1; then
  log "forge not on PATH; falling back to the paradigm.xyz installer"
  curl -L https://foundry.paradigm.xyz | bash || log "WARN foundry installer failed (rate-limited?)"
  "$HOME/.foundry/bin/foundryup" || log "WARN foundryup failed"
fi
if [ -x "$HOME/.foundry/bin/forge" ]; then
  export PATH="$HOME/.foundry/bin:$PATH"
  [ -n "${GITHUB_PATH:-}" ] && echo "$HOME/.foundry/bin" >> "$GITHUB_PATH"
fi
if ! command -v forge >/dev/null 2>&1; then
  log "WARN forge unavailable after install attempt — skill will degrade to NO_TOOLCHAIN"
  exit 0
fi
log "forge $(forge --version 2>/dev/null | head -1)"

# 2) Scratch project: v4 libs + templates + remappings, pre-built.
rm -rf "$DIR"; mkdir -p "$DIR"; cd "$DIR"
forge init --force . >/dev/null 2>&1 || true
rm -f src/Counter.sol script/Counter.s.sol test/Counter.t.sol
forge install uniswap/v4-core >/dev/null 2>&1 || log "WARN v4-core install failed"
forge install uniswap/v4-periphery >/dev/null 2>&1 || log "WARN v4-periphery install failed"

cat > remappings.txt <<'EOF'
@uniswap/v4-core/=lib/v4-core/
@uniswap/v4-periphery/=lib/v4-periphery/
v4-core/=lib/v4-core/
v4-periphery/=lib/v4-periphery/
forge-std/=lib/forge-std/src/
solmate/=lib/v4-core/lib/solmate/
openzeppelin-contracts/=lib/v4-core/lib/openzeppelin-contracts/
EOF
cp "$TPL/foundry.toml" foundry.toml
cp "$TPL/DynamicFeeHook.sol" "$TPL/NoOpHook.sol" "$TPL/HookFeeHook.sol" "$TPL/MockERC20.sol" src/
cp "$TPL/Hook.sol" src/                 # freeform scaffold (agent rewrites its body)
cp "$TPL/DeployHook.s.sol" script/
cp "$TPL/Hook.t.sol" test/              # freeform behavioral-test gate (agent writes AEON:ASSERT)
cp "$TPL/hook.env.example" hook.env     # freeform manifest defaults (agent overwrites)
cp "$TPL/chains.tsv" chains.tsv         # v4 chain registry (name -> PoolManager + RPC)

if forge build >/dev/null 2>&1; then
  log "project built at $DIR"
else
  log "WARN initial forge build failed (agent can retry after editing logic)"
fi

# 3) Key-safe runner at repo root (like ./notify/./secretcurl); export dir for the run.
cp "$ROOT/skills/deploy-uni-hook/hook-deploy.sh" "$ROOT/hook-deploy.sh"
chmod +x "$ROOT/hook-deploy.sh"
cp "$TPL/chains.tsv" "$ROOT/chains.tsv"   # registry next to the runner (its default lookup path)
[ -n "${GITHUB_ENV:-}" ] && echo "HOOKBUILD_DIR=$DIR" >> "$GITHUB_ENV"
log "staged ./hook-deploy.sh + chains.tsv + HOOKBUILD_DIR=$DIR"
exit 0
