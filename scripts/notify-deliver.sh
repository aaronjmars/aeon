#!/usr/bin/env bash
# notify-deliver.sh — Phase 2 (#912) delivery half of ./notify.
#
# Reads ONE structured queue payload (written by scripts/notify.sh, the queue-writer)
# and delivers it to every configured channel. THIS is the only place channel tokens
# are consumed: it runs in the post-run "Send pending notifications" workflow step,
# whose per-step env binds TELEGRAM_*/DISCORD_*/SLACK_*/BUZZ_*/RESEND_*/NOTIFY_EMAIL_*.
# The skill's own Run-step env no longer carries them (see aeon.yml), so a skill can
# only ask for a message — never read the credential that sends it.
#
#   scripts/notify-deliver.sh <payload.json>
#
# Payload fields (see notify.sh): title, severity, body, plain, link, skill_name,
# hash, reply_markup (JSON: null or a Telegram reply_markup object).
#
# Per-channel delivery is INDEPENDENT: one channel failing never aborts the rest
# (each block is guarded + `|| true`, DELIVERED is a logical OR). This is the fix for
# the old inline all-or-nothing quirk (#912 R6): a Telegram failure no longer drops
# the email. Rendering reuses scripts/notify_format.py exactly as the old inline path.
#
# Idempotency: a payload whose hash is already in notify-delivered-hashes is skipped,
# so re-running the step (or a retried job) never double-sends.
#
# NOTIFY_DRY_RUN=1 records the Telegram payload to notify-queue/tg-payload.jsonl and
# the Buzz chunks to buzz-payload.txt instead of sending — no network. Used by tests.
# Telegram reply-to-previous (default on): a skill's send quotes that skill's last
# Telegram message via reply_to_message_id + allow_sending_without_reply. Ledger:
# memory/telegram-threads/<skill>.json ({chat_id, message_id}). Off:
# TELEGRAM_REPLY_TO_PREVIOUS=0. Dry-run tests set AEON_TG_THREADS_DIR.
set -euo pipefail

PAYLOAD="${1:-}"
if [ -z "$PAYLOAD" ] || [ ! -f "$PAYLOAD" ]; then
  echo "notify-deliver: usage: notify-deliver.sh <payload.json>" >&2
  exit 2
fi

# Resolve the formatter whether run from repo root or scripts/.
_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FMT=""
for _cand in "scripts/notify_format.py" "$_HERE/notify_format.py" "$_HERE/scripts/notify_format.py"; do
  [ -f "$_cand" ] && FMT="$_cand" && break
done
if [ -z "$FMT" ]; then echo "notify-deliver: notify_format.py not found" >&2; exit 3; fi

PENDING_DIR="${AEON_PENDING_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/aeon-pending}"
QUEUE_DIR="$PENDING_DIR/notify-queue"

# --- read the structured payload --------------------------------------------
TITLE=$(jq -r '.title // ""' "$PAYLOAD")
SEVERITY=$(jq -r '.severity // "info"' "$PAYLOAD")
MSG=$(jq -r '.body // ""' "$PAYLOAD")
PLAIN=$(jq -r '.plain // .body // ""' "$PAYLOAD")
SKILL_FROM_JSON=$(jq -r '.skill_name // ""' "$PAYLOAD")
HASH=$(jq -r '.hash // ""' "$PAYLOAD")
# reply_markup is stored as embedded JSON (null or an object). Keep it as a compact
# JSON string so the Telegram block can splice it verbatim.
REPLY_MARKUP=$(jq -c '.reply_markup // null' "$PAYLOAD")
[ -z "$REPLY_MARKUP" ] && REPLY_MARKUP="null"

SKILL_NAME="${SKILL_FROM_JSON:-${SKILL_NAME:-}}"
# audit.sh attributes the record to $AEON_SKILL/$SKILL — carry the skill through.
[ -n "$SKILL_NAME" ] && export AEON_SKILL="$SKILL_NAME"

# --- idempotency: skip a payload already delivered --------------------------
DELIVERED_HASHES="$PENDING_DIR/notify-delivered-hashes"
touch "$DELIVERED_HASHES" 2>/dev/null || true
if [ -n "$HASH" ] && grep -qxF "$HASH" "$DELIVERED_HASHES" 2>/dev/null; then
  echo "notify-deliver: already delivered (${HASH:0:8}) — skipping $(basename "$PAYLOAD")" >&2
  exit 0
fi

DELIVERED=false

# Per-skill Telegram reply target. Default ON. Dry-run writes a ledger only when
# AEON_TG_THREADS_DIR is set, so existing tests do not touch memory/.
TG_DIR=""
if [ -n "${AEON_TG_THREADS_DIR:-}" ]; then
  TG_DIR="$AEON_TG_THREADS_DIR"
elif [ "${NOTIFY_DRY_RUN:-}" != "1" ]; then
  TG_ROOT="${GITHUB_WORKSPACE:-}"
  [ -z "$TG_ROOT" ] && TG_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  TG_DIR="$TG_ROOT/memory/telegram-threads"
fi
TG_REPLY_ON=1
case "${TELEGRAM_REPLY_TO_PREVIOUS:-1}" in 0|false|off|no) TG_REPLY_ON=0 ;; esac

_tg_load_mid() {
  TG_PREV_MID=""
  [ -n "$TG_DIR" ] && [ -n "$SKILL_NAME" ] || return 0
  local f="$TG_DIR/${SKILL_NAME}.json"
  [ -f "$f" ] || return 0
  local chat mid
  chat=$(jq -r '.chat_id // empty' "$f" 2>/dev/null || true)
  mid=$(jq -r '.message_id // empty' "$f" 2>/dev/null || true)
  [ "$chat" = "$TELEGRAM_CHAT_ID" ] || return 0
  [[ "$mid" =~ ^[0-9]+$ ]] || return 0
  TG_PREV_MID="$mid"
}
_tg_save_mid() {
  local mid="$1"
  [ -n "$TG_DIR" ] && [ -n "$SKILL_NAME" ] && [ -n "$mid" ] || return 0
  [[ "$SKILL_NAME" =~ ^[a-z0-9_-]+$ ]] || return 0
  [[ "$mid" =~ ^[0-9]+$ ]] || return 0
  mkdir -p "$TG_DIR" || return 0
  local f="$TG_DIR/${SKILL_NAME}.json" tmp
  tmp=$(mktemp) || return 0
  if jq -n --arg c "$TELEGRAM_CHAT_ID" --argjson m "$mid" \
      '{chat_id:$c, message_id:$m}' > "$tmp"
  then
    mv "$tmp" "$f"
  else
    rm -f "$tmp"
  fi
}
_tg_next_dry_mid() {
  mkdir -p "$TG_DIR" || return 0
  local seqf="$TG_DIR/.seq" n=0
  [ -f "$seqf" ] && n=$(cat "$seqf" 2>/dev/null || echo 0)
  n=$((n + 1))
  printf '%s\n' "$n" > "$seqf"
  printf '%s\n' "$n"
}
_tg_payload() {
  local text="$1" mode="$2" rm="$3" reply="$4"
  if [ -n "$reply" ]; then
    if [ -n "$mode" ]; then
      jq -n --arg chat "$TELEGRAM_CHAT_ID" --arg text "$text" --argjson rm "$rm" --argjson reply "$reply" \
        '{chat_id:$chat, text:$text, parse_mode:"HTML", reply_to_message_id:$reply, allow_sending_without_reply:true} + (if $rm then {reply_markup:$rm} else {} end)'
    else
      jq -n --arg chat "$TELEGRAM_CHAT_ID" --arg text "$text" --argjson rm "$rm" --argjson reply "$reply" \
        '{chat_id:$chat, text:$text, reply_to_message_id:$reply, allow_sending_without_reply:true} + (if $rm then {reply_markup:$rm} else {} end)'
    fi
  else
    if [ -n "$mode" ]; then
      jq -n --arg chat "$TELEGRAM_CHAT_ID" --arg text "$text" --argjson rm "$rm" \
        '{chat_id:$chat, text:$text, parse_mode:"HTML"} + (if $rm then {reply_markup:$rm} else {} end)'
    else
      jq -n --arg chat "$TELEGRAM_CHAT_ID" --arg text "$text" --argjson rm "$rm" \
        '{chat_id:$chat, text:$text} + (if $rm then {reply_markup:$rm} else {} end)'
    fi
  fi
}

# --- Telegram - fence-safe chunks (parse_mode HTML, plaintext fallback) ------
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  TG_CHUNKS_B64=$(printf '%s' "$MSG" | python3 "$FMT" telegram --title "$TITLE" --severity "$SEVERITY" || true)
  TG_CHUNKS=()
  while IFS= read -r TG_CHUNK_B64; do
    [ -z "$TG_CHUNK_B64" ] && continue
    TG_CHUNKS+=("$TG_CHUNK_B64")
  done <<< "$TG_CHUNKS_B64"
  TG_LAST=$(( ${#TG_CHUNKS[@]} - 1 ))
  TG_PREV_MID=""
  TG_RUN_ROOT=""
  TG_LAST_MID=""
  [ "$TG_REPLY_ON" = "1" ] && _tg_load_mid
  for TG_I in "${!TG_CHUNKS[@]}"; do
    TG_MSG=$(printf '%s' "${TG_CHUNKS[$TG_I]}" | base64 -d)
    # reply_markup rides only on the last chunk.
    if [ "$TG_I" -eq "$TG_LAST" ] && [ "$REPLY_MARKUP" != "null" ]; then
      TG_RM="$REPLY_MARKUP"
    else
      TG_RM="null"
    fi
    TG_REPLY_TO=""
    if [ "$TG_REPLY_ON" = "1" ]; then
      if [ -n "$TG_RUN_ROOT" ]; then
        TG_REPLY_TO="$TG_RUN_ROOT"
      elif [ -n "$TG_PREV_MID" ]; then
        TG_REPLY_TO="$TG_PREV_MID"
      fi
    fi
    TG_PAYLOAD=$(_tg_payload "$TG_MSG" HTML "$TG_RM" "$TG_REPLY_TO")

    TG_MID=""
    # Dry-run (tests): record the payload instead of sending. No network.
    if [ "${NOTIFY_DRY_RUN:-}" = "1" ]; then
      mkdir -p "$QUEUE_DIR"
      printf '%s\n' "$TG_PAYLOAD" >> "$QUEUE_DIR/tg-payload.jsonl"
      DELIVERED=true
      if [ -n "$TG_DIR" ] && [ -n "$SKILL_NAME" ]; then
        TG_MID=$(_tg_next_dry_mid)
      fi
    else
      TG_RESULT=$(curl -s -w "\n%{http_code}" -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -H "Content-Type: application/json" -d "$TG_PAYLOAD" 2>/dev/null) || true
      TG_HTTP=$(echo "$TG_RESULT" | tail -1)
      TG_BODY=$(echo "$TG_RESULT" | sed '$d')
      TG_OK=$(printf '%s' "$TG_BODY" | jq -r '.ok // false' 2>/dev/null || echo "false")
      if [ "$TG_HTTP" = "200" ] && [ "$TG_OK" = "true" ]; then
        DELIVERED=true
        TG_MID=$(printf '%s' "$TG_BODY" | jq -r '.result.message_id // empty' 2>/dev/null || true)
      else
        # Fallback without parse_mode. Strip tags + unescape so it degrades to clean
        # plaintext, not visible <b>...</b> markup. Keep the reply_markup.
        TG_PLAIN=$(printf '%s' "$TG_MSG" | sed -E 's/<[^>]+>//g' \
          | sed -E 's/&lt;/</g; s/&gt;/>/g; s/&amp;/\&/g')
        TG_FALLBACK=$(_tg_payload "$TG_PLAIN" "" "$TG_RM" "$TG_REPLY_TO")
        TG_RESULT=$(curl -s -w "\n%{http_code}" -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
          -H "Content-Type: application/json" -d "$TG_FALLBACK" 2>/dev/null) || true
        TG_HTTP=$(echo "$TG_RESULT" | tail -1)
        TG_BODY=$(echo "$TG_RESULT" | sed '$d')
        TG_OK=$(printf '%s' "$TG_BODY" | jq -r '.ok // false' 2>/dev/null || echo "false")
        if [ "$TG_HTTP" = "200" ] && [ "$TG_OK" = "true" ]; then
          DELIVERED=true
          TG_MID=$(printf '%s' "$TG_BODY" | jq -r '.result.message_id // empty' 2>/dev/null || true)
        fi
      fi
      sleep 0.3
    fi
    if [[ "$TG_MID" =~ ^[0-9]+$ ]]; then
      echo "notify-deliver: telegram skill=${SKILL_NAME:-?} mid=$TG_MID reply_to=${TG_REPLY_TO:-none}" >&2
      [ -z "$TG_RUN_ROOT" ] && TG_RUN_ROOT="$TG_MID"
      TG_LAST_MID="$TG_MID"
    fi
  done
  [ -n "$TG_LAST_MID" ] && _tg_save_mid "$TG_LAST_MID"
fi

# --- Discord — rich embeds, one POST per embed ------------------------------
if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
  DISCORD_PAYLOADS=$(printf '%s' "$MSG" | python3 "$FMT" discord --title "$TITLE" --severity "$SEVERITY" || true)
  while IFS= read -r DC_PAYLOAD; do
    [ -z "$DC_PAYLOAD" ] && continue
    curl -sf -X POST "$DISCORD_WEBHOOK_URL" -H "Content-Type: application/json" \
      -d "$DC_PAYLOAD" > /dev/null 2>&1 && DELIVERED=true || true
    sleep 0.3
  done <<< "$DISCORD_PAYLOADS"
fi

# --- Slack — Block Kit ------------------------------------------------------
if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
  SLACK_PAYLOAD=$(printf '%s' "$MSG" | python3 "$FMT" slack --title "$TITLE" --severity "$SEVERITY" || true)
  if [ -n "$SLACK_PAYLOAD" ]; then
    curl -sf -X POST "$SLACK_WEBHOOK_URL" -H "Content-Type: application/json" \
      -d "$SLACK_PAYLOAD" > /dev/null 2>&1 && DELIVERED=true || true
  fi
fi

# --- Buzz — signed Nostr publish via the buzz CLI (skips cleanly if absent) --
if { command -v buzz >/dev/null 2>&1 || [ "${NOTIFY_DRY_RUN:-}" = "1" ]; } \
   && [ -n "${BUZZ_PRIVATE_KEY:-}" ] && [ -n "${BUZZ_CHANNEL_ID:-}" ]; then
  BUZZ_CHUNKS_B64=$(printf '%s' "$MSG" | python3 "$FMT" buzz --title "$TITLE" --severity "$SEVERITY" || true)
  while IFS= read -r BZ_B64; do
    [ -z "$BZ_B64" ] && continue
    BZ_MSG=$(printf '%s' "$BZ_B64" | base64 -d)
    if [ "${NOTIFY_DRY_RUN:-}" = "1" ]; then
      mkdir -p "$QUEUE_DIR"
      printf '%s\n---\n' "$BZ_MSG" >> "$QUEUE_DIR/buzz-payload.txt"
      DELIVERED=true
      continue
    fi
    printf '%s' "$BZ_MSG" | buzz messages send --channel "$BUZZ_CHANNEL_ID" --content - >/dev/null 2>&1 \
      && DELIVERED=true || true
    sleep 0.3
  done <<< "$BUZZ_CHUNKS_B64"
fi

# --- Email via Resend (operator-notify channel) -----------------------------
if [ -n "${RESEND_API_KEY:-}" ] && [ -n "${NOTIFY_EMAIL_TO:-}" ]; then
  FROM="${NOTIFY_EMAIL_FROM:-aeon@notifications.aeon.bot}"
  PREFIX="${NOTIFY_EMAIL_SUBJECT_PREFIX:-[Aeon]}"
  SUBJECT="$PREFIX ${TITLE:-${SKILL_NAME:-notification}}"
  HTML_BODY=$(printf '%s' "$PLAIN" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')
  HTML_BODY="<html><body><pre style=\"font-family:monospace;white-space:pre-wrap;\">${HTML_BODY}</pre></body></html>"
  if [ "${NOTIFY_DRY_RUN:-}" = "1" ]; then
    mkdir -p "$QUEUE_DIR"
    printf '%s\n' "$SUBJECT" >> "$QUEUE_DIR/email-payload.txt"
    DELIVERED=true
  else
    curl -sf -X POST "https://api.resend.com/emails" \
      -H "Authorization: Bearer ${RESEND_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg from "$FROM" --arg to "$NOTIFY_EMAIL_TO" --arg subject "$SUBJECT" \
            --arg html "$HTML_BODY" --arg text "$PLAIN" \
            '{from:$from, to:[$to], subject:$subject, html:$html, text:$text}')" > /dev/null 2>&1 && DELIVERED=true || true
  fi
fi

# --- record delivery + audit ------------------------------------------------
if [ "$DELIVERED" = "true" ] && [ -n "$HASH" ]; then
  printf '%s\n' "$HASH" >> "$DELIVERED_HASHES" 2>/dev/null || true
fi

# Audit trail (no-op unless AEON_AUDIT_LOG is set; see scripts/audit.sh). One record
# per delivered payload listing which channels were configured + whether any send
# succeeded. Channel token VALUES never reach the record — audit.sh redacts, and we
# pass NAMES only.
if [ -n "${AEON_AUDIT_LOG:-}" ]; then
  _AUDIT=""
  for _c in "scripts/audit.sh" "$_HERE/audit.sh" "$_HERE/scripts/audit.sh"; do
    if [ -f "$_c" ]; then _AUDIT="$_c"; break; fi
  done
  if [ -n "$_AUDIT" ]; then
    _CHANS=""; _SECS=""
    if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then _CHANS="${_CHANS}telegram,"; _SECS="${_SECS}TELEGRAM_BOT_TOKEN,"; fi
    if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then _CHANS="${_CHANS}discord,"; _SECS="${_SECS}DISCORD_WEBHOOK_URL,"; fi
    if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then _CHANS="${_CHANS}slack,"; _SECS="${_SECS}SLACK_WEBHOOK_URL,"; fi
    if [ -n "${BUZZ_PRIVATE_KEY:-}" ] && [ -n "${BUZZ_CHANNEL_ID:-}" ]; then _CHANS="${_CHANS}buzz,"; _SECS="${_SECS}BUZZ_PRIVATE_KEY,"; fi
    if [ -n "${RESEND_API_KEY:-}" ] && [ -n "${NOTIFY_EMAIL_TO:-}" ]; then _CHANS="${_CHANS}email,"; _SECS="${_SECS}RESEND_API_KEY,"; fi
    if [ "$DELIVERED" = "true" ]; then _RC=0; else _RC=1; fi
    bash "$_AUDIT" "notify" "channels=${_CHANS%,} delivered=${DELIVERED}" "$_RC" "${_SECS%,}" || true
  fi
fi

[ "$DELIVERED" = "true" ] && exit 0 || exit 0
