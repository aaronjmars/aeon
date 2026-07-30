#!/usr/bin/env bash
# Aeon notify — committed source of truth for the ./notify command.
# The workflow copies this to ./notify before each run (was a heredoc inline).
# Keeping it a real file makes it version-controlled, lintable, and testable:
#   python3 scripts/tests/test_notify_format.py
#
# Usage (backward compatible):
#   ./notify "message"                         — inline arg (short, multi-line OK)
#   ./notify -f path/to/file.md                — read body from file (any length)
# New structured form (all optional, compose freely):
#   ./notify --title "Token Report" --severity warn -f body.md --link https://...
#   severity ∈ {info(default), success, warn, critical}; gated by NOTIFY_MIN_SEVERITY.
#
# Per-channel rendering (via scripts/notify_format.py): Telegram = Markdown
# normalized to HTML (parse_mode=HTML, fence-safe chunks, 3900), Discord embeds
# (color by severity), Slack Block Kit. Falls back to $AEON_PENDING_DIR/notify-queue for
# post-run delivery when the sandbox blocks outbound curl.
set -euo pipefail

# Resolve the formatter whether run as ./notify (repo root) or scripts/notify.sh
_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FMT=""
for _cand in "scripts/notify_format.py" "$_HERE/notify_format.py" "$_HERE/scripts/notify_format.py"; do
  [ -f "$_cand" ] && FMT="$_cand" && break
done
if [ -z "$FMT" ]; then echo "notify: notify_format.py not found" >&2; exit 3; fi

TITLE=""
SEVERITY="info"
LINK=""
MSG=""
BUTTONS_JSON=""     # --buttons: JSON array-of-arrays -> Telegram inline_keyboard
FORCE_REPLY=""      # --force-reply: prompt the user's next message as a reply
PLACEHOLDER=""      # --placeholder: input_field_placeholder for force_reply
CONTEXT=""          # --context "skill::intent": marker the poller reads back on reply
MUTE_KEY=""         # --mute-key "skill:arg": suppress if muted/snoozed (memory/*.log)
have_body=false
while [ $# -gt 0 ]; do
  case "$1" in
    -f|--file|--body)
      if [ -z "${2:-}" ] || [ ! -f "$2" ]; then
        echo "notify: $1 requires an existing file path" >&2
        exit 2
      fi
      MSG=$(cat "$2"); have_body=true; shift 2 ;;
    --title)       TITLE="${2:-}"; shift 2 ;;
    --severity)    SEVERITY="${2:-info}"; shift 2 ;;
    --link)        LINK="${2:-}"; shift 2 ;;
    --buttons)     BUTTONS_JSON="${2:-}"; shift 2 ;;
    --force-reply) FORCE_REPLY=1; shift ;;
    --placeholder) PLACEHOLDER="${2:-}"; shift 2 ;;
    --context)     CONTEXT="${2:-}"; shift 2 ;;
    --mute-key)    MUTE_KEY="${2:-}"; shift 2 ;;
    *)             if [ "$have_body" = false ]; then MSG="$1"; have_body=true; fi; shift ;;
  esac
done

# Context marker — baked into the visible body so the poller can recover which
# skill/intent a force_reply answer belongs to (Telegram carries it back in
# reply_to_message.text). See scripts/telegram-route.sh `reply` mode.
if [ -n "$CONTEXT" ]; then
  MSG=$(printf '[%s] %s' "$CONTEXT" "$MSG")
fi

# Normalize severity
SEVERITY=$(printf '%s' "$SEVERITY" | tr '[:upper:]' '[:lower:]')
case "$SEVERITY" in info|success|warn|critical) ;; *) SEVERITY="info" ;; esac

# Severity gate — skip anything below NOTIFY_MIN_SEVERITY (info<warn<critical; success~info)
rank() { case "$1" in critical) echo 2 ;; warn) echo 1 ;; *) echo 0 ;; esac; }
if [ -n "${NOTIFY_MIN_SEVERITY:-}" ]; then
  if [ "$(rank "$SEVERITY")" -lt "$(rank "$(printf '%s' "$NOTIFY_MIN_SEVERITY" | tr '[:upper:]' '[:lower:]')")" ]; then
    echo "notify: severity '$SEVERITY' below NOTIFY_MIN_SEVERITY, skipping" >&2
    exit 0
  fi
fi

# Snooze / mute gate — a skill that fires alerts passes --mute-key "skill:arg";
# button taps write memory/mutes.log ("skill:arg") and memory/snoozes.log
# ("skill:arg:until_epoch") via scripts/telegram-route.sh. Skip the send when the
# key is muted, or snoozed with an "until" still in the future.
if [ -n "$MUTE_KEY" ]; then
  if [ -f memory/mutes.log ] && grep -qxF "$MUTE_KEY" memory/mutes.log; then
    echo "notify: '$MUTE_KEY' muted, skipping" >&2
    exit 0
  fi
  if [ -f memory/snoozes.log ]; then
    NOW_EPOCH=$(date -u +%s)
    while IFS= read -r _sz_line; do
      case "$_sz_line" in "$MUTE_KEY":*) ;; *) continue ;; esac
      _sz_until="${_sz_line##*:}"
      [[ "$_sz_until" =~ ^[0-9]+$ ]] || continue
      if [ "$_sz_until" -gt "$NOW_EPOCH" ]; then
        echo "notify: '$MUTE_KEY' snoozed until $_sz_until, skipping" >&2
        exit 0
      fi
    done < memory/snoozes.log
  fi
fi

# Suppress obvious diagnostic probes (short test/trace/ping/debug pings)
MSG_LEN=${#MSG}
if [ "$MSG_LEN" -lt 120 ]; then
  MSG_LOWER=$(printf '%s' "$MSG" | tr '[:upper:]' '[:lower:]')
  case "$MSG_LOWER" in
    *test*|*trace*|*ping*|*debug*|hello|hi)
      echo "notify: suppressing trace/test message ($MSG_LEN chars): $MSG" >&2
      exit 0 ;;
  esac
fi

# Append link as a trailing line if provided
if [ -n "$LINK" ]; then
  MSG=$(printf '%s\n\n🔗 %s' "$MSG" "$LINK")
fi

# --- staging area for notify's queues ---------------------------------------
# These MUST live outside the workspace. Two reasons, both measured:
#   1. A read-only skill runs under an OS sandbox that mounts the repo read-only,
#      so a queue inside the workspace simply cannot be written — the run then
#      loses its dedup state, its re-delivery queue and its feed entry.
#   2. `.gitignore` ignores `.pending-*/` (directories), not `.pending-*.md`, so
#      the json-render staging FILE was getting COMMITTED. A later sandboxed run
#      that couldn't overwrite it left the previous run's copy in place, and the
#      "Capture skill output" step happily published that stale digest as the new
#      run's output — a green run reporting someone else's work.
# The workflow exports AEON_PENDING_DIR; the fallbacks keep local runs and other
# entry points working.
PENDING_DIR="${AEON_PENDING_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/aeon-pending}"
mkdir -p "$PENDING_DIR" 2>/dev/null || true

# Dedup within this run — same rendered message never sent twice
_sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; }
HASH=$(printf '%s' "$TITLE|$SEVERITY|$MSG" | _sha | awk '{print $1}')
HASH_FILE="$PENDING_DIR/notify-sent-hashes"
touch "$HASH_FILE" 2>/dev/null || true
if grep -qxF "$HASH" "$HASH_FILE" 2>/dev/null; then
  echo "notify: duplicate message (hash ${HASH:0:8}), skipping" >&2
  exit 0
fi
printf '%s\n' "$HASH" >> "$HASH_FILE" 2>/dev/null || true

# Plain-text header for the pending/fallback path (live channels render their own)
case "$SEVERITY" in
  critical) EMOJI='🚨' ;;
  warn)     EMOJI='⚠️' ;;
  success)  EMOJI='✅' ;;
  *)        EMOJI='ℹ️' ;;
esac
if [ -n "$TITLE" ]; then
  PLAIN=$(printf '%s %s\n\n%s' "$EMOJI" "$TITLE" "$MSG")
else
  PLAIN="$MSG"
fi

# Try to save to $PENDING_DIR/notify-queue for post-run re-delivery. This queue is the
# fallback for the INVERSE sandbox — network blocked, FS writable (the old claude
# wrapper case): notify can't reach the wire inline, so the workflow's "Send
# pending notifications" step re-delivers post-run from here.
#
# Non-fatal by design: codex's native read-only sandbox is the MIRROR case — the
# FS is blocked but the network is open — so this write fails while inline delivery
# below works fine. A failed fallback write must NOT abort the primary path (this
# script runs `set -e`, so an unguarded failure here would kill the whole notify
# before a single channel is tried).
TS=$(date -u +%s)
if ! { mkdir -p "$PENDING_DIR/notify-queue" && printf '%s' "$PLAIN" > "$PENDING_DIR/notify-queue/${TS}.md"; } 2>/dev/null; then
  echo "notify: notify-queue unwritable — delivering inline only" >&2
fi

DELIVERED=false

# Build reply_markup once (Telegram-only). Attached to the LAST chunk so it renders
# under the full (possibly chunked) text.
#
# GLOBAL quick-action buttons: every skill notification gets a "Run again" +
# "Schedule weekly" row, keyed to $SKILL_NAME (the running skill) so a tap re-runs
# it (callback run:<skill>) or schedules it weekly (callback schedule:<skill>:weekly,
# handled in scripts/telegram-route.sh). This is a global notify feature — skills do
# NOT wire it per-skill. The row is appended beneath any skill-supplied --buttons.
# Skipped when there's no skill context ($SKILL_NAME unset), when the skill name is
# too long to fit callback_data's 64-byte budget, or on a force_reply prompt (Telegram
# forbids inline buttons + force_reply on one message — the deliberate ask wins).
# Inline (callback) buttons are OPERATOR controls: only the owner may act on a
# "Run again" / "Schedule weekly" / snooze tap, and the router now enforces that
# (owner-user gate). But a group/channel message — and its buttons — is visible and
# tappable by every member, and a single shared message can't scope a button to one
# viewer. So outside the owner's private DM we don't attach inline buttons at all:
# the notification still posts, just without controls that a non-owner would only see
# ignored (or, without the user gate, could abuse). This auto-couples buttons to the
# same "only the owner can drive the bot" property that a 1:1 DM gives for free.
#
# Signal: a private (1:1) chat has a POSITIVE chat id; groups/supergroups/channels are
# NEGATIVE. Opt back in for a group with TELEGRAM_GROUP_BUTTONS=1 (accepts the tradeoff
# that the buttons are then visible to everyone and only the owner's taps do anything).
# force_reply is a deliberate prompt, not an inline button, so it is unaffected.
INLINE_BUTTONS_OK=true
case "${TELEGRAM_CHAT_ID:-}" in
  -*) [ "${TELEGRAM_GROUP_BUTTONS:-}" = "1" ] || INLINE_BUTTONS_OK=false ;;
esac

GLOBAL_ROW=""
if [ "$INLINE_BUTTONS_OK" = true ] && [ -n "${SKILL_NAME:-}" ] && [ -z "$FORCE_REPLY" ] && [ "${#SKILL_NAME}" -le 48 ]; then
  GLOBAL_ROW=$(jq -n --arg s "$SKILL_NAME" \
    '[{text:"🔁 Run again",       callback_data:("run:"+$s)},
      {text:"📅 Schedule weekly", callback_data:("schedule:"+$s+":weekly")}]')
fi

REPLY_MARKUP="null"
if [ -n "$FORCE_REPLY" ]; then
  REPLY_MARKUP=$(jq -n --arg p "$PLACEHOLDER" \
    '{force_reply:true} + (if $p != "" then {input_field_placeholder:$p} else {} end)')
elif [ "$INLINE_BUTTONS_OK" = true ]; then
  # inline_keyboard = optional skill --buttons rows, then the global quick-action row.
  KB="[]"
  if [ -n "$BUTTONS_JSON" ]; then
    KB=$(jq -n --argjson kb "$BUTTONS_JSON" '$kb' 2>/dev/null || echo "null")
    if [ -z "$KB" ] || [ "$KB" = "null" ]; then
      echo "notify: --buttons is not valid JSON, ignoring" >&2
      KB="[]"
    fi
  fi
  if [ -n "$GLOBAL_ROW" ]; then
    KB=$(jq -n --argjson kb "$KB" --argjson row "$GLOBAL_ROW" '$kb + [$row]')
  fi
  if [ "$KB" != "[]" ]; then
    REPLY_MARKUP=$(jq -n --argjson kb "$KB" '{inline_keyboard:$kb}')
  fi
elif [ -n "$BUTTONS_JSON" ]; then
  echo "notify: suppressing inline buttons in a group chat (set TELEGRAM_GROUP_BUTTONS=1 to keep them)" >&2
fi

# Telegram — fence-safe chunks (parse_mode Markdown, fallback to none)
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  TG_CHUNKS_B64=$(printf '%s' "$MSG" | python3 "$FMT" telegram --title "$TITLE" --severity "$SEVERITY" || true)
  # Materialize chunks so we know which one is last (gets the reply_markup).
  TG_CHUNKS=()
  while IFS= read -r TG_CHUNK_B64; do
    [ -z "$TG_CHUNK_B64" ] && continue
    TG_CHUNKS+=("$TG_CHUNK_B64")
  done <<< "$TG_CHUNKS_B64"
  TG_LAST=$(( ${#TG_CHUNKS[@]} - 1 ))
  for TG_I in "${!TG_CHUNKS[@]}"; do
    TG_MSG=$(printf '%s' "${TG_CHUNKS[$TG_I]}" | base64 -d)
    # reply_markup rides only on the last chunk.
    if [ "$TG_I" -eq "$TG_LAST" ] && [ "$REPLY_MARKUP" != "null" ]; then
      TG_RM="$REPLY_MARKUP"
    else
      TG_RM="null"
    fi
    # notify_format.py already normalized Markdown -> Telegram HTML for this path.
    TG_PAYLOAD=$(jq -n --arg chat "$TELEGRAM_CHAT_ID" --arg text "$TG_MSG" --argjson rm "$TG_RM" \
      '{chat_id:$chat, text:$text, parse_mode:"HTML"} + (if $rm then {reply_markup:$rm} else {} end)')

    # Dry-run (tests): record the payload instead of sending. No network.
    if [ "${NOTIFY_DRY_RUN:-}" = "1" ]; then
      mkdir -p "$PENDING_DIR/notify-queue"
      printf '%s\n' "$TG_PAYLOAD" >> "$PENDING_DIR/notify-queue/tg-payload.jsonl"
      DELIVERED=true
      continue
    fi

    TG_RESULT=$(curl -s -w "\n%{http_code}" -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -H "Content-Type: application/json" -d "$TG_PAYLOAD" 2>/dev/null) || true
    TG_HTTP=$(echo "$TG_RESULT" | tail -1)
    TG_OK=$(echo "$TG_RESULT" | sed '$d' | jq -r '.ok // false' 2>/dev/null || echo "false")
    if [ "$TG_HTTP" = "200" ] && [ "$TG_OK" = "true" ]; then
      DELIVERED=true
    else
      # Fallback without parse_mode (should be near-zero — our HTML is deterministic).
      # Strip tags and unescape entities so it degrades to clean plaintext, not
      # visible <b>…</b> markup. Keep the reply_markup.
      TG_PLAIN=$(printf '%s' "$TG_MSG" | sed -E 's/<[^>]+>//g' \
        | sed -E 's/&lt;/</g; s/&gt;/>/g; s/&amp;/\&/g')
      TG_FALLBACK=$(jq -n --arg chat "$TELEGRAM_CHAT_ID" --arg text "$TG_PLAIN" --argjson rm "$TG_RM" \
        '{chat_id:$chat, text:$text} + (if $rm then {reply_markup:$rm} else {} end)')
      curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -H "Content-Type: application/json" -d "$TG_FALLBACK" > /dev/null 2>&1 && DELIVERED=true || true
    fi
    sleep 0.3
  done
fi

# Discord — rich embeds, one POST per embed
if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
  DISCORD_PAYLOADS=$(printf '%s' "$MSG" | python3 "$FMT" discord --title "$TITLE" --severity "$SEVERITY" || true)
  while IFS= read -r DC_PAYLOAD; do
    [ -z "$DC_PAYLOAD" ] && continue
    curl -sf -X POST "$DISCORD_WEBHOOK_URL" -H "Content-Type: application/json" \
      -d "$DC_PAYLOAD" > /dev/null 2>&1 && DELIVERED=true || true
    sleep 0.3
  done <<< "$DISCORD_PAYLOADS"
fi

# Slack — Block Kit
if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
  SLACK_PAYLOAD=$(printf '%s' "$MSG" | python3 "$FMT" slack --title "$TITLE" --severity "$SEVERITY" || true)
  if [ -n "$SLACK_PAYLOAD" ]; then
    curl -sf -X POST "$SLACK_WEBHOOK_URL" -H "Content-Type: application/json" \
      -d "$SLACK_PAYLOAD" > /dev/null 2>&1 && DELIVERED=true || true
  fi
fi

# Email via Resend (operator-notify channel — same provider/key as the in-run
# disclosure/outreach senders in send-email + vuln-scanner Arm C, one Resend
# account for all outbound mail). Best-effort inline; the workflow's "Send pending
# notifications" step re-delivers via Resend if this is blocked in the sandbox.
if [ -n "${RESEND_API_KEY:-}" ] && [ -n "${NOTIFY_EMAIL_TO:-}" ]; then
  FROM="${NOTIFY_EMAIL_FROM:-aeon@notifications.aeon.bot}"
  PREFIX="${NOTIFY_EMAIL_SUBJECT_PREFIX:-[Aeon]}"
  SUBJECT="$PREFIX ${TITLE:-${SKILL_NAME:-notification}}"
  HTML_BODY=$(printf '%s' "$PLAIN" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')
  HTML_BODY="<html><body><pre style=\"font-family:monospace;white-space:pre-wrap;\">${HTML_BODY}</pre></body></html>"
  curl -sf -X POST "https://api.resend.com/emails" \
    -H "Authorization: Bearer ${RESEND_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg from "$FROM" --arg to "$NOTIFY_EMAIL_TO" --arg subject "$SUBJECT" \
          --arg html "$HTML_BODY" --arg text "$PLAIN" \
          '{from:$from, to:[$to], subject:$subject, html:$html, text:$text}')" > /dev/null 2>&1 && DELIVERED=true || true
fi

# json-render channel — save raw message for post-run conversion. Non-fatal for
# the same reason as the notify-queue above: on a read-only-FS harness
# (codex) this write can't land, and it must not abort a run whose channel
# delivery already succeeded inline. The feed entry is simply skipped.
if [ "${JSONRENDER_ENABLED:-false}" = "true" ] && [ -n "${SKILL_NAME:-}" ]; then
  if ! printf '%s' "$PLAIN" > "$PENDING_DIR/.pending-${SKILL_NAME}.md" 2>/dev/null; then
    echo "notify: json-render queue unwritable (read-only FS) — feed entry skipped" >&2
  fi
fi

# Remove pending file if immediate delivery succeeded (prevents double-send)
if [ "$DELIVERED" = "true" ]; then
  rm -f "$PENDING_DIR/notify-queue/${TS}.md"
fi
