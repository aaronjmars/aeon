#!/usr/bin/env bash
# mcp-oauth-refresh.sh — SOURCE me (do not execute). The durable half of the
# dashboard's MCP OAuth flow (apps/dashboard/lib/mcp-oauth.ts): the dashboard
# captured a refresh token into an MCP_<SLUG>_OAUTH secret; before each headless
# run we mint a *fresh* access token from it and export MCP_<SLUG>_TOKEN, so
# .mcp.json's `Authorization: Bearer ${MCP_<SLUG>_TOKEN}` resolves to a live token.
#
# Source this immediately BEFORE the .mcp.json ${VAR} resolution loop: that loop
# keeps any var already in the environment (`[ -n "${!v:-}" ] && continue`), so a
# token we export here wins over the (possibly stale) stored access-token secret.
#
# Contract:
#   - Sourced, so it NEVER exits and must never abort the caller's run step. It
#     toggles errexit off for its body and restores it, and guards every command.
#   - Reads secrets from ALL_SECRETS (toJSON(secrets)); needs jq + curl.
#   - A server whose refresh fails is simply left without a fresh token — the MCP
#     preflight then skips it (or falls back to the stored access token), never
#     breaking the run.
#   - Never prints a token: the fresh access token is masked with ::add-mask::.

# Preserve the caller's errexit, then disable it for our body (we handle every
# error explicitly). Restored at the end.
case $- in *e*) _mcp_oe_was_set=1 ;; *) _mcp_oe_was_set=0 ;; esac
set +e

_mcp_oauth_refresh_one() {
  local oauth_var="$1" json="$2" pat="${3:-}"
  local token_var="${oauth_var%_OAUTH}_TOKEN"
  local ep cid csec rt
  ep=$(jq -r '.token_endpoint // empty' <<<"$json" 2>/dev/null)
  cid=$(jq -r '.client_id // empty' <<<"$json" 2>/dev/null)
  csec=$(jq -r '.client_secret // empty' <<<"$json" 2>/dev/null)
  rt=$(jq -r '.refresh_token // empty' <<<"$json" 2>/dev/null)
  if [ -z "$ep" ] || [ -z "$rt" ]; then
    echo "::warning::MCP OAuth: $oauth_var is missing token_endpoint/refresh_token — skipping (re-connect it in the dashboard)"
    return 0
  fi

  # Refresh request. A confidential client (has client_secret) authenticates with
  # HTTP Basic; a public/PKCE client passes client_id in the body. This runs on
  # the GitHub runner (plain bash — no Claude bash analyzer), so a normal request
  # with the secret in --data-urlencode is fine; nothing is echoed (set +e, no -x).
  local args=(-s --max-time 30 -X POST "$ep"
    -H "Accept: application/json"
    -H "Content-Type: application/x-www-form-urlencoded"
    --data-urlencode "grant_type=refresh_token"
    --data-urlencode "refresh_token=$rt")
  if [ -n "$csec" ]; then
    args+=(-u "$cid:$csec")
  else
    args+=(--data-urlencode "client_id=$cid")
  fi

  local resp access new_rt
  resp=$(curl "${args[@]}" 2>/dev/null)
  if [ $? -ne 0 ] || [ -z "$resp" ]; then
    echo "::warning::MCP OAuth: refresh request to the token endpoint failed for $oauth_var"
    return 0
  fi
  access=$(jq -r '.access_token // empty' <<<"$resp" 2>/dev/null)
  if [ -z "$access" ]; then
    # Surface the OAuth error (e.g. invalid_grant) so the failure is actionable —
    # invalid_grant here almost always means an earlier run rotated/consumed the
    # stored refresh token and could not save the replacement (see persistence
    # note below). Never echoes the token itself.
    local oerr
    oerr=$(jq -r '[.error, .error_description] | map(select(. != null and . != "")) | join(": ")' <<<"$resp" 2>/dev/null)
    echo "::warning::MCP OAuth: refresh failed for $oauth_var${oerr:+ ($oerr)} — the stored refresh token was likely rotated/consumed by an earlier run and not saved. Re-connect it in the dashboard, and set a secrets-write PAT (GH_SECRETS_PAT) so future rotations persist. See docs/mcp-oauth.md."
    return 0
  fi

  echo "::add-mask::$access"
  export "$token_var=$access"
  echo "::debug::MCP OAuth: refreshed $token_var"

  # Rotated refresh token? Persist it so the NEXT run stays valid. Providers that
  # rotate the refresh token on every refresh invalidate the old one immediately,
  # so unless the replacement is saved, the next headless run's refresh fails ("no
  # access_token"). Writing a secret needs a secrets-write credential — the default
  # GITHUB_TOKEN CANNOT do this — so persistence uses the PAT the caller resolved
  # (GH_SECRETS_PAT / GH_GLOBAL). Failures here are LOUD (::warning::), not silent:
  # an unpersisted rotation is exactly what silently breaks auth one run later.
  new_rt=$(jq -r '.refresh_token // empty' <<<"$resp" 2>/dev/null)
  if [ -n "$new_rt" ] && [ "$new_rt" != "$rt" ]; then
    local updated
    updated=$(jq -c --arg rt "$new_rt" '.refresh_token=$rt' <<<"$json" 2>/dev/null)
    if [ -z "$updated" ]; then
      echo "::warning::MCP OAuth: $oauth_var rotated its refresh token but the updated secret JSON could not be built — re-connect it in the dashboard."
    elif [ -z "$pat" ]; then
      echo "::warning::MCP OAuth: $oauth_var uses a ROTATING refresh token but no secrets-write credential is set, so the rotated token cannot be saved and the NEXT run's refresh WILL fail. Add a fine-grained PAT (Secrets: read/write) as repo secret GH_SECRETS_PAT (or GH_GLOBAL), then re-connect $oauth_var in the dashboard."
    elif ! command -v gh >/dev/null 2>&1; then
      echo "::warning::MCP OAuth: $oauth_var rotated its refresh token but 'gh' is unavailable to persist it."
    elif printf '%s' "$updated" | GH_TOKEN="$pat" gh secret set "$oauth_var" >/dev/null 2>&1; then
      echo "MCP OAuth: persisted rotated refresh token for $oauth_var (durable refresh active)"
    else
      echo "::warning::MCP OAuth: $oauth_var rotated its refresh token but persisting it FAILED — GH_SECRETS_PAT/GH_GLOBAL needs 'Secrets: read/write' on this repo. Re-connect in the dashboard once fixed."
    fi
  fi
  return 0
}

mcp_oauth_refresh() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "::warning::MCP OAuth: jq not found — skipping token refresh"; return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "::warning::MCP OAuth: curl not found — skipping token refresh"; return 0
  fi
  local secrets="${ALL_SECRETS:-}"; [ -z "$secrets" ] && secrets='{}'
  local names
  names=$(jq -r 'keys[] | select(startswith("MCP_") and endswith("_OAUTH"))' <<<"$secrets" 2>/dev/null)
  [ -z "$names" ] && return 0
  # Secrets-write credential used to persist ROTATED refresh tokens (see the
  # persistence note in _mcp_oauth_refresh_one). A dedicated GH_SECRETS_PAT wins;
  # GH_GLOBAL is the repo-wide fallback. Masked so it never lands in a log.
  local pat
  pat=$(jq -r '.GH_SECRETS_PAT // .GH_GLOBAL // empty' <<<"$secrets" 2>/dev/null)
  [ -n "$pat" ] && echo "::add-mask::$pat"
  local n json
  while IFS= read -r n; do
    [ -z "$n" ] && continue
    # The secret VALUE is the OAuthSecret JSON *as a string*; -r unwraps it.
    json=$(jq -r --arg k "$n" '.[$k] // empty' <<<"$secrets" 2>/dev/null)
    [ -z "$json" ] && continue
    _mcp_oauth_refresh_one "$n" "$json" "$pat"
  done <<< "$names"
  return 0
}

mcp_oauth_refresh

# Restore the caller's errexit setting; leave the shell as we found it.
if [ "$_mcp_oe_was_set" = 1 ]; then set -e; fi
unset _mcp_oe_was_set
