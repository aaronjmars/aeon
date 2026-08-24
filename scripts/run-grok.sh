#!/usr/bin/env bash
# run-grok.sh — STAGE the Grok Build (`grok`) harness: install the pinned CLI and
# restore/refresh its auth. It does NOT run skills.
#
#   usage: run-grok.sh setup
#
# Running a skill on grok goes through harness-adapter/run-harness, like every
# other harness:
#
#   echo "$PROMPT" | harness-adapter/run-harness grok --mode write
#
# This script used to do both — stage grok AND run the skill, emitting a
# Claude-shaped {result, usage} envelope on stdout. That second job is gone. It
# was a duplicate of adapters/grok.sh, and a duplicate that drifts is worse than
# no duplicate: grok's MCP folder-trust gate was fixed in the adapter, and the
# surfaces still calling this script (inbound messages, the local MCP server)
# silently kept the broken behaviour until they were migrated. Everything that
# ran a skill now shares one path, so an adapter fix reaches every surface.
#
# What stays here, because it has no better home: the CLI version pin and the
# GROK_CREDENTIALS restore + rotating-refresh-token persistence (§2b), which the
# workflows call as `run-grok.sh setup` before dispatching to run-harness.
#
#   stdout  — nothing (diagnostics go to stderr)
#   exit    — 0 when grok is staged, non-zero if the CLI or auth cannot be set up
#
# Inputs from the environment:
#   XAI_API_KEY           xAI API key auth (CI-friendly; the simple path)
#   GROK_CREDENTIALS      base64 of the X-account OAuth session captured by the
#                         dashboard (a tar rooted at $HOME, or a single cred file)
#   GROK_CREDENTIALS_PATH single-file restore target (default ~/.grok/credentials.json)
#   GH_SECRETS_PAT        secrets-write PAT (or GH_GLOBAL as the repo-wide fallback)
#                         used to PERSIST a rotated refresh token back to the
#                         GROK_CREDENTIALS secret so OAuth auth survives past 6h (§2b);
#                         without it a rotating provider breaks one run after expiry.
#   GROK_OAUTH_SKEW       seconds-before-expiry to trigger a refresh (default 1800)
#   GROK_CLI_VERSION      npm pin override (default below)
#
# The run-shaping knobs (GROK_MAX_TURNS / GROK_EFFORT / GROK_BEST_OF_N /
# GROK_CHECK / GROK_COMPAT_RULES) moved with the run path: aeon.yml maps a
# skill's frontmatter to them and harness-adapter/adapters/grok.sh reads them.
# Structured output is `run-harness --json-schema`, uniform across all seven
# harnesses; a grok-only env var here would recreate the divergence the adapter
# exists to remove.
#
# Sandbox note: grok's own network calls (to api.x.ai / auth.x.ai) go out from
# this step, which the Actions sandbox permits for the CLI itself. Auth material
# is either an env var (XAI_API_KEY) or restored from a repo secret — never
# fetched at run time.

set -uo pipefail   # NOT -e: every step below handles its own failure explicitly.

# --- pin (single source of truth for the grok CLI version) ------------------
# Keep this current the same way aeon.yml/messages.yml pin the claude CLI.
GROK_CLI_VERSION="${GROK_CLI_VERSION:-0.2.101}"

log() { echo "$@" >&2; }

# `setup` is the only subcommand. Reject anything else LOUDLY rather than
# staging grok and exiting 0: a stale caller piping a prompt in (the old run
# contract) would otherwise get an empty stdout and read it as "the model
# returned nothing" — the silent-no-op class this whole consolidation removed.
case "${1:-setup}" in
  setup) ;;
  *)
    log "::error::run-grok.sh only stages the grok CLI now — it does not run skills."
    log "::error::Run a skill with: harness-adapter/run-harness grok --mode <write|read-only>"
    exit 2 ;;
esac

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

log "::debug::grok setup complete (CLI + auth staged); runs go through run-harness grok"
exit 0
