#!/usr/bin/env bash
# install-buzz-cli — stage the `buzz` CLI for the Buzz notification channel.
#
# Buzz (github.com/block/buzz) is the one notify channel that isn't a bearer-URL
# webhook: ./notify signs + publishes each message through this CLI (it holds the
# agent's Schnorr keypair). So the binary must be on PATH for the channel to fire.
# Everything else degrades gracefully without it — notify.sh gates delivery on
# `command -v buzz` — which is exactly why this installer is safe to call
# unconditionally: it is a fast no-op unless the operator has configured Buzz.
#
# Self-gating, in order:
#   1. BUZZ_PRIVATE_KEY unset -> operator hasn't configured Buzz; do nothing.
#   2. `buzz` already on PATH -> nothing to do.
#   3. BUZZ_CLI_URL set       -> download a prebuilt binary (fast path). Use this
#                                once Block ships a CLI release, or point it at a
#                                binary you built / host yourself.
#   4. otherwise              -> cargo install from source at BUZZ_CLI_REF (slow:
#                                a full Rust workspace compile; needs cargo on the
#                                runner). No prebuilt CLI release exists yet — Block
#                                ships Desktop app releases only — so this is the
#                                default fallback. Set BUZZ_CLI_URL to skip it.
set -euo pipefail

# 1. Not configured -> no-op. Keeps the step free for every non-Buzz operator.
if [ -z "${BUZZ_PRIVATE_KEY:-}" ]; then
  echo "buzz-cli: BUZZ_PRIVATE_KEY unset — Buzz channel not configured, skipping install"
  exit 0
fi

# 2. Already present.
if command -v buzz >/dev/null 2>&1; then
  echo "buzz-cli: already on PATH ($(command -v buzz))"
  exit 0
fi

# 3. Prebuilt binary (preferred once available — no Rust build).
if [ -n "${BUZZ_CLI_URL:-}" ]; then
  DEST="$HOME/.local/bin"
  mkdir -p "$DEST"
  echo "buzz-cli: downloading prebuilt binary from \$BUZZ_CLI_URL"
  curl -fsSL "$BUZZ_CLI_URL" -o "$DEST/buzz"
  chmod +x "$DEST/buzz"
  [ -n "${GITHUB_PATH:-}" ] && echo "$DEST" >> "$GITHUB_PATH"
  echo "buzz-cli: installed prebuilt binary to $DEST/buzz"
  exit 0
fi

# 4. Build from source (slow). Pin the ref via BUZZ_CLI_REF for reproducibility.
if ! command -v cargo >/dev/null 2>&1; then
  echo "::error::buzz-cli: no prebuilt BUZZ_CLI_URL and no cargo on the runner — cannot stage the Buzz CLI" >&2
  exit 1
fi
BUZZ_CLI_REF="${BUZZ_CLI_REF:-main}"
echo "buzz-cli: building from source (block/buzz@$BUZZ_CLI_REF) — this is slow; set BUZZ_CLI_URL to a prebuilt binary to skip"
cargo install --git https://github.com/block/buzz --branch "$BUZZ_CLI_REF" buzz-cli
[ -n "${GITHUB_PATH:-}" ] && echo "$HOME/.cargo/bin" >> "$GITHUB_PATH"
echo "buzz-cli: installed via cargo"
