#!/usr/bin/env bash
# Aeon notify — committed source of truth for the ./notify command.
# The workflow copies this to ./notify before each run (was a heredoc inline).
#
# Phase 2 (#912): this is now a QUEUE-WRITER ONLY. It never reads a channel token
# and never touches the wire. A skill call writes ONE structured payload to
# $AEON_PENDING_DIR/notify-queue/<TS>.json; the post-run "Send pending notifications"
# workflow step owns the tokens and does the actual send via scripts/notify-deliver.sh.
# Moving delivery post-run keeps TELEGRAM_*/DISCORD_*/SLACK_*/BUZZ_*/NOTIFY_EMAIL_*
# out of the process env the skill runs in — a skill can ask for a message but can
# never read the credential that sends it.
#
# Usage (backward compatible):
#   ./notify "message"                         — inline arg (short, multi-line OK)
#   ./notify -f path/to/file.md                — read body from file (any length)
# New structured form (all optional, compose freely):
#   ./notify --title "Token Report" --severity warn -f body.md --link https://...
#   severity ∈ {info(default), success, warn, critical}; gated by NOTIFY_MIN_SEVERITY.
#
# What still lives here (unchanged): arg parse, severity gate, mute/snooze, probe
# suppression, per-run dedup, and the Telegram reply_markup / messages.yml-state
# logic (it needs GITHUB_TOKEN, which stays in-run). Per-channel RENDERING and the
# curl sends moved to scripts/notify-deliver.sh.
set -euo pipefail

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
    -h|--help)
      # Print usage to stderr and exit WITHOUT sending. Without this, a skill agent that
      # probes `./notify --help` to inspect flags had the string fall through the catch-all
      # below and get broadcast to every channel as the message body (self-reported
      # 2026-08-10; recurred). Never page the operator with a usage probe.
      echo "notify: usage: ./notify [--title T] [--severity info|success|warn|critical] [--link URL] [--mute-key K] [-f FILE | \"message\"]" >&2
      exit 0 ;;
    --*)
      # An unrecognised long flag is almost certainly a mistyped option or a usage probe,
      # never a real message. Error instead of silently becoming the body.
      echo "notify: unknown flag '$1' (run with -h for usage); refusing to send it as a message" >&2
      exit 2 ;;
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

# --- staging area for notify's queue ----------------------------------------
# MUST live outside the workspace. A read-only skill runs under an OS sandbox that
# mounts the repo read-only, so a queue inside the workspace cannot be written. The
# workflow exports AEON_PENDING_DIR; the fallbacks keep local runs + other entry
# points working.
PENDING_DIR="${AEON_PENDING_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/aeon-pending}"
mkdir -p "$PENDING_DIR" 2>/dev/null || true

# Dedup within this run — same rendered message never queued twice
_sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; }
HASH=$(printf '%s' "$TITLE|$SEVERITY|$MSG" | _sha | awk '{print $1}')
HASH_FILE="$PENDING_DIR/notify-sent-hashes"
touch "$HASH_FILE" 2>/dev/null || true
if grep -qxF "$HASH" "$HASH_FILE" 2>/dev/null; then
  echo "notify: duplicate message (hash ${HASH:0:8}), skipping" >&2
  exit 0
fi
printf '%s\n' "$HASH" >> "$HASH_FILE" 2>/dev/null || true

# Plain-text header for the email/fallback render (live channels render their own)
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

# --- Telegram reply_markup (computed in-run; needs the messages.yml state probe) ---
# GLOBAL quick-action buttons: every skill notification gets a "Run again" +
# "Schedule weekly" row, keyed to $SKILL_NAME so a tap re-runs it (callback
# run:<skill>) or schedules it weekly (schedule:<skill>:weekly, handled in
# scripts/telegram-route.sh). Skipped when there's no skill context, when the name is
# too long for callback_data's 64-byte budget, or on a force_reply prompt (Telegram
# forbids inline buttons + force_reply on one message — the deliberate ask wins).
#
# Interactive controls only do anything if the inbound Messages workflow
# (.github/workflows/messages.yml) is running to receive the tap/reply. If the
# operator DISABLED it, every tap is dead, so we must not attach controls — a button
# that silently does nothing (or, in a shared chat, invites a stranger to tap it) is
# worse than none. We resolve the workflow state (best-effort, cached once per run)
# and drop interactive markup only when it is DEFINITIVELY disabled:
#   • active                                  -> attach (inbound is live)
#   • disabled_manually / disabled_inactivity -> suppress (operator turned it off)
#   • unknown / unreachable                   -> attach (fail open)
# Overrides: TELEGRAM_FORCE_BUTTONS=1 forces attach; AEON_MESSAGES_WF_STATE=<state>
# skips the API call (operator override + test hook). The reply_markup is written into
# the queue payload; notify-deliver.sh attaches it to the last Telegram chunk.
INBOUND_OK=true
if [ "${TELEGRAM_FORCE_BUTTONS:-}" != "1" ]; then
  MSG_WF_STATE="${AEON_MESSAGES_WF_STATE:-}"
  if [ -z "$MSG_WF_STATE" ]; then
    WF_STATE_CACHE="${TMPDIR:-/tmp}/.aeon-messages-wf-state-${GITHUB_RUN_ID:-$$}"
    if [ -f "$WF_STATE_CACHE" ]; then
      MSG_WF_STATE=$(cat "$WF_STATE_CACHE" 2>/dev/null || echo "")
    elif [ -n "${GITHUB_REPOSITORY:-}" ]; then
      _WF_API="https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/messages.yml"
      _WF_TOK="${GH_TOKEN:-${GITHUB_TOKEN:-${GH_GLOBAL:-}}}"
      if [ -n "$_WF_TOK" ]; then
        MSG_WF_STATE=$(curl -s --max-time 6 -H "Authorization: Bearer $_WF_TOK" \
          -H "Accept: application/vnd.github+json" "$_WF_API" 2>/dev/null \
          | jq -r '.state // "unknown"' 2>/dev/null || echo "unknown")
      else
        MSG_WF_STATE=$(curl -s --max-time 6 -H "Accept: application/vnd.github+json" "$_WF_API" 2>/dev/null \
          | jq -r '.state // "unknown"' 2>/dev/null || echo "unknown")
      fi
      printf '%s' "$MSG_WF_STATE" > "$WF_STATE_CACHE" 2>/dev/null || true
    fi
  fi
  case "$MSG_WF_STATE" in
    disabled_manually|disabled_inactivity) INBOUND_OK=false ;;
  esac
fi

GLOBAL_ROW=""
if [ "$INBOUND_OK" = true ] && [ -n "${SKILL_NAME:-}" ] && [ -z "$FORCE_REPLY" ] && [ "${#SKILL_NAME}" -le 48 ]; then
  GLOBAL_ROW=$(jq -n --arg s "$SKILL_NAME" \
    '[{text:"🔁 Run again",       callback_data:("run:"+$s)},
      {text:"📅 Schedule weekly", callback_data:("schedule:"+$s+":weekly")}]')
fi

REPLY_MARKUP="null"
if [ -n "$FORCE_REPLY" ] && [ "$INBOUND_OK" = true ]; then
  REPLY_MARKUP=$(jq -n --arg p "$PLACEHOLDER" \
    '{force_reply:true} + (if $p != "" then {input_field_placeholder:$p} else {} end)')
elif [ -n "$FORCE_REPLY" ]; then
  echo "notify: inbound Messages workflow disabled — force-reply prompt sent as plain text (no reply routing)" >&2
elif [ "$INBOUND_OK" = true ]; then
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
  echo "notify: inbound Messages workflow disabled — suppressing inline buttons (set TELEGRAM_FORCE_BUTTONS=1 to keep them)" >&2
fi

# --- write ONE structured payload to the queue ------------------------------
# This is the whole job of notify.sh now: no channel curl, no token read. The
# post-run step's notify-deliver.sh renders + delivers this per channel. Non-fatal
# if the queue is unwritable (read-only-FS harness with no post-run delivery path):
# match the prior degrade rather than aborting the skill on `set -e`.
QUEUE_DIR="$PENDING_DIR/notify-queue"
if ! mkdir -p "$QUEUE_DIR" 2>/dev/null; then
  echo "notify: notify-queue unwritable (read-only FS) — message not queued" >&2
else
  TS=$(date -u +%s)
  QUEUE_FILE="$QUEUE_DIR/${TS}-$$-${RANDOM}.json"
  if jq -n \
      --arg title "$TITLE" --arg severity "$SEVERITY" --arg body "$MSG" \
      --arg plain "$PLAIN" --arg link "$LINK" --arg skill "${SKILL_NAME:-}" \
      --arg hash "$HASH" --argjson reply_markup "$REPLY_MARKUP" \
      '{title:$title, severity:$severity, body:$body, plain:$plain, link:$link,
        skill_name:$skill, hash:$hash, reply_markup:$reply_markup}' \
      > "$QUEUE_FILE" 2>/dev/null; then
    echo "notify: queued ${HASH:0:8} -> $(basename "$QUEUE_FILE")" >&2
  else
    echo "notify: failed to write queue payload" >&2
    rm -f "$QUEUE_FILE" 2>/dev/null || true
  fi
fi

# json-render channel — save raw message for post-run feed conversion. Non-fatal:
# on a read-only-FS harness this write can't land and must not abort the run. This
# is the public status-feed digest, separate from the delivery queue above.
if [ "${JSONRENDER_ENABLED:-false}" = "true" ] && [ -n "${SKILL_NAME:-}" ]; then
  if ! printf '%s' "$PLAIN" > "$PENDING_DIR/.pending-${SKILL_NAME}.md" 2>/dev/null; then
    echo "notify: json-render queue unwritable (read-only FS) — feed entry skipped" >&2
  fi
fi
