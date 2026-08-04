#!/usr/bin/env bash
# install-otel-cli.sh — stage the `otel-cli` OTLP span emitter used by Tier-2
# harness tracing (harness-adapter/lib/otel-span.sh emits one gen_ai span per
# non-claude harness run). Claude Code exports its own OTEL spans natively, so
# this is only ever needed on the run-harness (grok/codex/pi/vibe/kimi) path.
#
# Opt-in + idempotent + never fatal (always exits 0):
#   • no-op unless telemetry is configured (a raw OTLP endpoint OR both Langfuse
#     keys) — nothing to emit to otherwise
#   • no-op if otel-cli is already on PATH
#   • a failed download degrades to "span emit no-ops", never a failed run
#
# Persists the install dir onto $GITHUB_PATH so later steps in the same job see
# it (Go binaries don't survive Claude Code's per-call shells otherwise).
set -uo pipefail

OTEL_CLI_VERSION="${OTEL_CLI_VERSION:-0.4.5}"
DEST="${OTEL_CLI_DEST:-/tmp/bin}"

telemetry_on() {
  [ -n "${OTEL_EXPORTER_OTLP_ENDPOINT:-}" ] && return 0
  [ -n "${LANGFUSE_PUBLIC_KEY:-}" ] && [ -n "${LANGFUSE_SECRET_KEY:-}" ] && return 0
  return 1
}

if ! telemetry_on; then
  echo "otel-cli: telemetry not configured — skipping install" >&2
  exit 0
fi
if command -v otel-cli >/dev/null 2>&1; then
  echo "otel-cli: already on PATH ($(command -v otel-cli))" >&2
  exit 0
fi

os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$arch" in
  x86_64 | amd64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
esac

url="https://github.com/equinix-labs/otel-cli/releases/download/v${OTEL_CLI_VERSION}/otel-cli_${OTEL_CLI_VERSION}_${os}_${arch}.tar.gz"
tmp=$(mktemp -d)
mkdir -p "$DEST"
if curl -fsSL "$url" -o "$tmp/otel-cli.tgz" && tar -xzf "$tmp/otel-cli.tgz" -C "$tmp" otel-cli 2>/dev/null; then
  mv "$tmp/otel-cli" "$DEST/otel-cli" && chmod +x "$DEST/otel-cli"
  if [ -n "${GITHUB_PATH:-}" ]; then echo "$DEST" >> "$GITHUB_PATH"; fi
  export PATH="$DEST:$PATH"
  echo "otel-cli: installed v${OTEL_CLI_VERSION} → $DEST" >&2
else
  echo "otel-cli: download failed ($url) — Tier-2 harness spans will no-op" >&2
fi
rm -rf "$tmp"
exit 0
