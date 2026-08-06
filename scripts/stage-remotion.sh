#!/usr/bin/env bash
# stage-remotion.sh — stage the Remotion toolchain for the `remotion` skill in the
# WORKFLOW step (full capability), BEFORE `claude -p` starts. Mirrors
# scripts/stage-deploy-uni-hook.sh and scripts/stage-vuln-scanner.sh.
#
# Why this must be a workflow step, not in-run:
#   1. Headless Chrome needs system shared libraries (libnss3, libgbm, …) that
#      only `apt-get` (root) can install — the `claude -p` sandbox can't.
#   2. `npm install` + a ~90 MB chrome-headless-shell download every run is slow;
#      the workflow wraps this in actions/cache (see aeon.yml) so it's near-instant
#      on a hit. The agent only writes a storyboard JSON and runs `npx remotion
#      render` against the already-installed project.
#
# The rendered project lives at skills/remotion/project (checked in, node_modules
# gitignored). node_modules/.remotion holds the browser, so caching node_modules
# caches the browser too.
#
# No-op for every other skill. Best-effort: never fails the run (exit 0 on error);
# the skill's own `command -v` / staged-dir guard degrades cleanly and notifies.
set -uo pipefail

SKILL="${1:-}"
[ "$SKILL" = "remotion" ] || exit 0

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="$ROOT/skills/remotion/project"

log() { echo "stage-remotion: $*"; }

[ -d "$PROJ" ] || { log "WARN project dir missing at $PROJ — nothing to stage"; exit 0; }

# 1) Headless-Chrome system libraries (Ubuntu 22.04/24.04). Only on Linux with apt;
#    a no-op elsewhere. Best-effort — the render fails loudly later if a lib is missing.
if command -v apt-get >/dev/null 2>&1; then
  log "installing headless-chrome system libraries"
  SUDO=""; [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"
  $SUDO apt-get update -y >/tmp/remotion-apt.log 2>&1 || log "WARN apt-get update failed (see /tmp/remotion-apt.log)"
  # libasound2t64 on 24.04, libasound2 on older — try the new name, fall back.
  $SUDO apt-get install -y --no-install-recommends \
    libnss3 libdbus-1-3 libatk1.0-0 libxrandr2 libxkbcommon0 libxfixes3 \
    libxcomposite1 libxdamage1 libgbm1 libcups2 libcairo2 libpango-1.0-0 \
    libatk-bridge2.0-0 libasound2t64 >>/tmp/remotion-apt.log 2>&1 \
    || $SUDO apt-get install -y --no-install-recommends libasound2 >>/tmp/remotion-apt.log 2>&1 \
    || log "WARN apt-get install of chrome libs failed (see /tmp/remotion-apt.log)"
fi

# 2) Node deps. --prefer-offline reuses the ~/.npm cache; on an actions/cache hit
#    of node_modules this is a fast no-op reconcile.
cd "$PROJ" || { log "WARN cannot cd $PROJ"; exit 0; }
if [ -f package-lock.json ]; then
  npm ci --prefer-offline --no-audit --no-fund >/tmp/remotion-npm.log 2>&1 \
    || npm install --prefer-offline --no-audit --no-fund >>/tmp/remotion-npm.log 2>&1 \
    || log "WARN npm install failed (see /tmp/remotion-npm.log)"
else
  npm install --prefer-offline --no-audit --no-fund >/tmp/remotion-npm.log 2>&1 \
    || log "WARN npm install failed (see /tmp/remotion-npm.log)"
fi

# esbuild ships a platform binary via a postinstall; make sure it's built (some
# npm configs skip install scripts). The Remotion bundler needs it.
node -e "require('esbuild')" >/dev/null 2>&1 || npm rebuild esbuild >>/tmp/remotion-npm.log 2>&1 || true

# 3) Chrome Headless Shell -> node_modules/.remotion/. Instant if the cache
#    restored it; a ~90 MB download on a cold cache.
npx --no-install remotion browser ensure >/tmp/remotion-browser.log 2>&1 \
  || log "WARN 'remotion browser ensure' failed (see /tmp/remotion-browser.log)"

if [ -d node_modules/remotion ] && node -e "require('esbuild')" >/dev/null 2>&1; then
  log "OK — remotion project staged at $PROJ"
else
  log "WARN staging incomplete; the skill will degrade and notify"
fi
exit 0
