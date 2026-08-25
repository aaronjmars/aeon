#!/usr/bin/env bash
# audit.sh — append-only structured audit log of privileged actions.
#
#   scripts/audit.sh <action> <target> <exit> [secrets_csv]
#
# Appends one JSON line to $AEON_AUDIT_LOG describing a single action that reached
# outside the run (a notify send, an authenticated curl, a git push, a gh write, an
# email). The run workflow points AEON_AUDIT_LOG at a file it uploads as an
# artifact, so "what did it do on the 14th" is answerable without reading Actions
# transcripts.
#
# NO-OP when AEON_AUDIT_LOG is unset: instrumenting a shared script (notify.sh,
# secretcurl) with a call to this one is therefore free for any caller that has not
# opted in -- forks, unit tests, local runs -- and changes no default behaviour.
#
# Secret VALUES never reach the file. secrets_used records env-var NAMES only, and
# as defense in depth the whole record is scrubbed against every credential-shaped
# env var in its raw, base64, and url-encoded forms before it is written. The
# scrub fails toward over-redaction, never toward disclosure.
set -euo pipefail

LOG="${AEON_AUDIT_LOG:-}"
[ -z "$LOG" ] && exit 0

ACTION="${1:-unknown}"
TARGET="${2:-}"
EXITCODE="${3:-0}"
SECRETS="${4:-}"   # comma-separated env-var NAMES, e.g. "TELEGRAM_BOT_TOKEN"

case "$EXITCODE" in ''|*[!0-9]*) EXITCODE=0 ;; esac

# Replace every credential-shaped env var's value -- raw, base64, and url-encoded --
# with the literal REDACTED. compgen -e lists exported names (secrets arrive as env
# vars), so no NAME=value line-parsing that a multi-line value could break.
redact() {
  local s="$1" name val enc
  while IFS= read -r name; do
    # *_API_KEY and *_PRIVATE_KEY are subsumed by *_KEY (identical body: keep and
    # redact), so they are kept only as explicit documentation of what this list
    # covers. That is why shellcheck flags the overlap here as intentional.
    # shellcheck disable=SC2221,SC2222
    case "$name" in
      *_API_KEY|*_KEY|*_TOKEN|*_SECRET|*_PAT|*_WEBHOOK_URL|*_PRIVATE_KEY|*_CHAT_ID|*_CHANNEL_ID) ;;
      *) continue ;;
    esac
    val="${!name-}"
    [ -z "$val" ] && continue
    [ "${#val}" -lt 6 ] && continue     # skip short values (ids like "1") to avoid noise
    s="${s//"$val"/REDACTED}"
    enc="$(printf '%s' "$val" | base64 | tr -d '\n')"
    [ -n "$enc" ] && s="${s//"$enc"/REDACTED}"
    enc="$(printf '%s' "$val" | jq -sRr @uri 2>/dev/null || true)"
    [ -n "$enc" ] && [ "$enc" != "$val" ] && s="${s//"$enc"/REDACTED}"
  done < <(compgen -e)
  printf '%s' "$s"
}

TS="$(date -u +%FT%TZ)"
RUN_ID="${GITHUB_RUN_ID:-local}"
SKILL="${AEON_SKILL:-${SKILL:-unknown}}"
SEC_JSON="$(jq -cn --arg s "$SECRETS" '$s | split(",") | map(select(length > 0))')"

LINE="$(jq -cn \
  --arg ts "$TS" --arg run "$RUN_ID" --arg skill "$SKILL" \
  --arg action "$ACTION" --arg target "$TARGET" \
  --argjson exit "$EXITCODE" --argjson secrets "$SEC_JSON" \
  '{ts:$ts, run_id:$run, skill:$skill, action:$action, target:$target, exit:$exit, secrets_used:$secrets}')"

LINE="$(redact "$LINE")"

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
printf '%s\n' "$LINE" >> "$LOG"
