#!/usr/bin/env bash
# Integration test for scripts/notify.sh — exercises arg parsing, probe suppression,
# dedup, severity gate, and the notify-queue fallback with all channels unset.
# The queues live under $AEON_PENDING_DIR (outside the workspace), so the test
# points that at a temp dir instead of writing into the repo.
# No network, no secrets. Run: bash scripts/tests/test_notify.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
NOTIFY="scripts/notify.sh"

# Queues live outside the repo now; isolate them per-run.
AEON_PENDING_DIR="$(mktemp -d)"; export AEON_PENDING_DIR
trap 'rm -rf "$AEON_PENDING_DIR"' EXIT

# Channels unset → everything falls back to .pending-notify
unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID DISCORD_WEBHOOK_URL SLACK_WEBHOOK_URL \
      RESEND_API_KEY NOTIFY_EMAIL_TO JSONRENDER_ENABLED NOTIFY_MIN_SEVERITY 2>/dev/null

WORK="$AEON_PENDING_DIR/notify-queue"
fail=0
pass() { echo "ok   - $1"; }
bad()  { echo "FAIL - $1"; fail=1; }
reset() { rm -rf "$WORK" "$AEON_PENDING_DIR/notify-sent-hashes"; }

# 1. structured message lands in pending with title header
reset
bash "$NOTIFY" --title "Token Report" --severity warn "Prices down 3.3 percent today" >/dev/null 2>&1
f=$(ls "$WORK"/*.md 2>/dev/null | head -1)
if [ -n "$f" ] && grep -q "Token Report" "$f" && grep -q "Prices down" "$f"; then
  pass "structured message saved with title header"
else
  bad "structured message saved with title header"
fi

# 2. probe/test message is suppressed (no pending file)
reset
bash "$NOTIFY" "quick test ping" >/dev/null 2>&1
if [ -z "$(ls "$WORK"/*.md 2>/dev/null)" ]; then
  pass "probe message suppressed"
else
  bad "probe message suppressed"
fi

# 3. dedup — identical message twice produces a single pending file
reset
bash "$NOTIFY" "Deployment finished successfully on prod cluster" >/dev/null 2>&1
bash "$NOTIFY" "Deployment finished successfully on prod cluster" >/dev/null 2>&1
count=$(ls "$WORK"/*.md 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" = "1" ]; then
  pass "duplicate message deduped ($count file)"
else
  bad "duplicate message deduped (got $count files)"
fi

# 4. severity gate — warn below critical floor is skipped
reset
NOTIFY_MIN_SEVERITY=critical bash "$NOTIFY" --severity warn "Heads up, minor wobble in metrics" >/dev/null 2>&1
if [ -z "$(ls "$WORK"/*.md 2>/dev/null)" ]; then
  pass "below-floor severity skipped"
else
  bad "below-floor severity skipped"
fi

# 5. severity gate — critical passes the floor
reset
NOTIFY_MIN_SEVERITY=warn bash "$NOTIFY" --severity critical "Database is down, paging now" >/dev/null 2>&1
if [ -n "$(ls "$WORK"/*.md 2>/dev/null)" ]; then
  pass "at/above-floor severity delivered"
else
  bad "at/above-floor severity delivered"
fi

# 6. -f file body still works (backward compat)
reset
tmp=$(mktemp); printf 'Line one\n\nLine two with detail' > "$tmp"
bash "$NOTIFY" -f "$tmp" >/dev/null 2>&1
f=$(ls "$WORK"/*.md 2>/dev/null | head -1)
if [ -n "$f" ] && grep -q "Line two" "$f"; then
  pass "-f file body delivered"
else
  bad "-f file body delivered"
fi
rm -f "$tmp"

# --- interactive flags (Telegram dry-run; NOTIFY_DRY_RUN records the payload
#     instead of sending, so these assert reply_markup with no network) ---
ROOT="$(pwd)"
ABS_NOTIFY="$ROOT/scripts/notify.sh"

# 7. --buttons attaches an inline_keyboard to the Telegram payload
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=active NOTIFY_DRY_RUN=1 \
  bash "$NOTIFY" "Alert body long enough to clear the probe filter here" \
  --buttons '[[{"text":"Snooze","callback_data":"snooze:x:y:60"}]]' >/dev/null 2>&1
if [ -f "$WORK/tg-payload.jsonl" ] && \
   jq -e '.reply_markup.inline_keyboard[0][0].callback_data=="snooze:x:y:60"' "$WORK/tg-payload.jsonl" >/dev/null 2>&1; then
  pass "--buttons attaches inline_keyboard"
else
  bad "--buttons attaches inline_keyboard"
fi

# 8. --force-reply + --context set force_reply and prefix the [skill::intent] marker
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=active NOTIFY_DRY_RUN=1 \
  bash "$NOTIFY" "Which repository should I track for you" \
  --force-reply --placeholder "owner/repo" --context "github-monitor::add-repo" >/dev/null 2>&1
if [ -f "$WORK/tg-payload.jsonl" ] && \
   jq -e '.reply_markup.force_reply==true' "$WORK/tg-payload.jsonl" >/dev/null 2>&1 && \
   jq -e '.text|startswith("[github-monitor::add-repo]")' "$WORK/tg-payload.jsonl" >/dev/null 2>&1; then
  pass "--force-reply + --context set marker and force_reply"
else
  bad "--force-reply + --context set marker and force_reply"
fi

# 9-11. --mute-key gate. Isolated cwd so the repo's memory/ is never touched.
MK="$(mktemp -d)"; mkdir -p "$MK/memory"; cd "$MK" || exit 1

# 9. muted key suppresses the send
rm -rf "$WORK" "$AEON_PENDING_DIR/notify-sent-hashes"; echo "token-movers:BTC" > memory/mutes.log; : > memory/snoozes.log
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 NOTIFY_DRY_RUN=1 \
  bash "$ABS_NOTIFY" "BTC alert that should be muted away entirely" --mute-key "token-movers:BTC" >/dev/null 2>&1
[ ! -f "$WORK/tg-payload.jsonl" ] && pass "--mute-key muted suppresses" || bad "--mute-key muted suppresses"

# 10. future snooze suppresses
rm -rf "$WORK" "$AEON_PENDING_DIR/notify-sent-hashes"; : > memory/mutes.log
printf 'token-movers:ETH:%s\n' "$(( $(date -u +%s) + 3600 ))" > memory/snoozes.log
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 NOTIFY_DRY_RUN=1 \
  bash "$ABS_NOTIFY" "ETH alert snoozed for an hour from now" --mute-key "token-movers:ETH" >/dev/null 2>&1
[ ! -f "$WORK/tg-payload.jsonl" ] && pass "--mute-key future snooze suppresses" || bad "--mute-key future snooze suppresses"

# 11. expired snooze delivers
rm -rf "$WORK" "$AEON_PENDING_DIR/notify-sent-hashes"
printf 'token-movers:SOL:%s\n' "$(( $(date -u +%s) - 10 ))" > memory/snoozes.log
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 NOTIFY_DRY_RUN=1 \
  bash "$ABS_NOTIFY" "SOL alert should deliver since snooze expired" --mute-key "token-movers:SOL" >/dev/null 2>&1
[ -f "$WORK/tg-payload.jsonl" ] && pass "--mute-key expired snooze delivers" || bad "--mute-key expired snooze delivers"

cd "$ROOT" || exit 1
rm -rf "$MK"

# --- global quick-action buttons (Run again + Schedule weekly), keyed to SKILL_NAME ---

# 12. a normal skill notification gets the global Run again + Schedule weekly row
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=active NOTIFY_DRY_RUN=1 SKILL_NAME=token-movers \
  bash "$NOTIFY" "A normal skill digest long enough to clear the probe filter here" >/dev/null 2>&1
if [ -f "$WORK/tg-payload.jsonl" ] && \
   jq -e '.reply_markup.inline_keyboard[-1][0].callback_data=="run:token-movers"' "$WORK/tg-payload.jsonl" >/dev/null 2>&1 && \
   jq -e '.reply_markup.inline_keyboard[-1][1].callback_data=="schedule:token-movers:weekly"' "$WORK/tg-payload.jsonl" >/dev/null 2>&1; then
  pass "global Run again + Schedule weekly buttons attached"
else
  bad "global Run again + Schedule weekly buttons attached"
fi

# 13. skill --buttons rows are kept, with the global quick-action row appended beneath
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=active NOTIFY_DRY_RUN=1 SKILL_NAME=pr-review \
  bash "$NOTIFY" "Digest body long enough to clear the probe filter comfortably" \
  --buttons '[[{"text":"Open","url":"https://example.com"}]]' >/dev/null 2>&1
if [ -f "$WORK/tg-payload.jsonl" ] && \
   jq -e '.reply_markup.inline_keyboard[0][0].url=="https://example.com"' "$WORK/tg-payload.jsonl" >/dev/null 2>&1 && \
   jq -e '.reply_markup.inline_keyboard[-1][0].callback_data=="run:pr-review"' "$WORK/tg-payload.jsonl" >/dev/null 2>&1; then
  pass "custom --buttons kept + global row appended"
else
  bad "custom --buttons kept + global row appended"
fi

# 14. a force_reply prompt never carries inline buttons (mutual exclusivity), even with SKILL_NAME set
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=active NOTIFY_DRY_RUN=1 SKILL_NAME=github-monitor \
  bash "$NOTIFY" "Which repository should I track for you now" \
  --force-reply --placeholder "owner/repo" --context "github-monitor::add-repo" >/dev/null 2>&1
if [ -f "$WORK/tg-payload.jsonl" ] && \
   jq -e '.reply_markup.force_reply==true' "$WORK/tg-payload.jsonl" >/dev/null 2>&1 && \
   jq -e '.reply_markup|has("inline_keyboard")|not' "$WORK/tg-payload.jsonl" >/dev/null 2>&1; then
  pass "force_reply prompt carries no inline buttons"
else
  bad "force_reply prompt carries no inline buttons"
fi

# 15. no SKILL_NAME context -> no global buttons (bare notify stays button-free)
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 NOTIFY_DRY_RUN=1 \
  bash "$NOTIFY" "A contextless notification with no skill name set at all here" >/dev/null 2>&1
if [ -f "$WORK/tg-payload.jsonl" ] && \
   jq -e '.|has("reply_markup")|not' "$WORK/tg-payload.jsonl" >/dev/null 2>&1; then
  pass "no SKILL_NAME -> no global buttons"
else
  bad "no SKILL_NAME -> no global buttons"
fi

# 15b. inbound Messages workflow disabled -> interactive buttons auto-suppressed, but
#      the message still delivers. Neither the global row nor custom --buttons attach.
#      (AEON_MESSAGES_WF_STATE short-circuits the GitHub API lookup.)
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=disabled_manually NOTIFY_DRY_RUN=1 SKILL_NAME=token-movers \
  bash "$NOTIFY" "A broadcast body long enough to clear the probe filter here now" \
  --buttons '[[{"text":"Snooze","callback_data":"snooze:token-movers:BTC:60"}]]' >/dev/null 2>&1
if [ -f "$WORK/tg-payload.jsonl" ] && \
   jq -e '.|has("reply_markup")|not' "$WORK/tg-payload.jsonl" >/dev/null 2>&1; then
  pass "messages.yml disabled -> interactive buttons suppressed (message still sent)"
else
  bad "messages.yml disabled -> interactive buttons suppressed (message still sent)"
fi

# 15c. force_reply is also suppressed when inbound is disabled (its answer can't route)
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=disabled_manually NOTIFY_DRY_RUN=1 SKILL_NAME=github-monitor \
  bash "$NOTIFY" "Which repository should I track for you now" \
  --force-reply --placeholder "owner/repo" --context "github-monitor::add-repo" >/dev/null 2>&1
if [ -f "$WORK/tg-payload.jsonl" ] && \
   jq -e '.|has("reply_markup")|not' "$WORK/tg-payload.jsonl" >/dev/null 2>&1 && \
   jq -e '.text|startswith("[github-monitor::add-repo]")' "$WORK/tg-payload.jsonl" >/dev/null 2>&1; then
  pass "messages.yml disabled -> force_reply sent as plain text (no reply markup)"
else
  bad "messages.yml disabled -> force_reply sent as plain text (no reply markup)"
fi

# 15d. workflow active -> buttons attach as normal
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=active NOTIFY_DRY_RUN=1 SKILL_NAME=token-movers \
  bash "$NOTIFY" "A broadcast body long enough to clear the probe filter here now" >/dev/null 2>&1
if [ -f "$WORK/tg-payload.jsonl" ] && \
   jq -e '.reply_markup.inline_keyboard[-1][0].callback_data=="run:token-movers"' "$WORK/tg-payload.jsonl" >/dev/null 2>&1; then
  pass "messages.yml active -> buttons attached"
else
  bad "messages.yml active -> buttons attached"
fi

# 15e. disabled workflow + TELEGRAM_FORCE_BUTTONS=1 override -> buttons come back
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=disabled_manually TELEGRAM_FORCE_BUTTONS=1 NOTIFY_DRY_RUN=1 SKILL_NAME=token-movers \
  bash "$NOTIFY" "A broadcast body long enough to clear the probe filter here now" >/dev/null 2>&1
if [ -f "$WORK/tg-payload.jsonl" ] && \
   jq -e '.reply_markup.inline_keyboard[-1][0].callback_data=="run:token-movers"' "$WORK/tg-payload.jsonl" >/dev/null 2>&1; then
  pass "TELEGRAM_FORCE_BUTTONS=1 overrides disabled workflow"
else
  bad "TELEGRAM_FORCE_BUTTONS=1 overrides disabled workflow"
fi

reset

# 16. read-only cwd (a read-only skill under the OS sandbox): the queue lives
#     OUTSIDE the workspace now, so notify must still succeed AND still queue —
#     that is what lets the capture/feed steps see this run's output instead of
#     republishing the previous run's file. Regression guard for the stale-digest
#     bug and for the set -e abort that once dropped codex notifications entirely.
reset
NOTIFY_ABS="$PWD/scripts/notify.sh"
RO="$(mktemp -d)"
chmod 555 "$RO"
if ( cd "$RO" && : > .wtest ) 2>/dev/null; then
  rm -f "$RO/.wtest"; chmod 755 "$RO"; rm -rf "$RO"
  pass "read-only cwd queues outside the workspace (skipped: cwd still writable, likely root)"
else
  ( cd "$RO" && bash "$NOTIFY_ABS" --severity critical \
      "A real notification long enough to clear the probe and severity floors here" ) \
      >/dev/null 2>"${RO}.err"
  ec=$?
  chmod 755 "$RO"; rm -rf "$RO"
  if [ "$ec" -eq 0 ] && [ -n "$(ls -A "$WORK"/*.md 2>/dev/null)" ]; then
    pass "read-only cwd still queues (queue is outside the workspace)"
  else
    bad "read-only cwd queue (exit=$ec; queued=$(ls -A "$WORK" 2>/dev/null | tr '\n' ' '); err=$(tr '\n' '|' <"${RO}.err"))"
  fi
  rm -f "${RO}.err"
fi

# 17. …and if the QUEUE ITSELF is unwritable, notify must fall through to inline
#     delivery rather than abort under set -e (the original codex regression).
reset
UNWRITABLE="$(mktemp -d)"; chmod 555 "$UNWRITABLE"
if ( : > "$UNWRITABLE/.wtest" ) 2>/dev/null; then
  rm -f "$UNWRITABLE/.wtest"; chmod 755 "$UNWRITABLE"; rm -rf "$UNWRITABLE"
  pass "unwritable queue -> inline fallthrough (skipped: dir still writable, likely root)"
else
  AEON_PENDING_DIR="$UNWRITABLE/nope" bash "$NOTIFY_ABS" --severity critical \
    "Another real notification long enough to clear the probe and severity floors" \
    >/dev/null 2>"${UNWRITABLE}.err"
  ec=$?
  chmod 755 "$UNWRITABLE"; rm -rf "$UNWRITABLE"
  if [ "$ec" -eq 0 ] && grep -q "unwritable" "${UNWRITABLE}.err"; then
    pass "unwritable queue -> inline fallthrough (exit 0, no set -e abort)"
  else
    bad "unwritable queue fallthrough (exit=$ec; err=$(tr '\n' '|' <"${UNWRITABLE}.err"))"
  fi
  rm -f "${UNWRITABLE}.err"
fi

# 18. Buzz channel — dry-run records the decoded Markdown (no `buzz` binary, no network).
#     Gated on BUZZ_PRIVATE_KEY + BUZZ_CHANNEL_ID; NOTIFY_DRY_RUN bypasses `command -v buzz`.
reset
BUZZ_PRIVATE_KEY=nsec1x BUZZ_CHANNEL_ID=chan-uuid NOTIFY_DRY_RUN=1 \
  bash "$NOTIFY" --title "Scan Report" --severity warn "Found 3 movers worth a look today" >/dev/null 2>&1
BZ="$WORK/buzz-payload.txt"
if [ -f "$BZ" ] && grep -q "Scan Report" "$BZ" && grep -q "Found 3 movers" "$BZ"; then
  pass "buzz dry-run records decoded markdown payload"
else
  bad "buzz dry-run records decoded markdown payload"
fi

# 18b. Buzz gate — with the binary absent and NOT in dry-run, the channel is skipped
#      (falls back to the pending queue like any unconfigured channel).
reset
BUZZ_PRIVATE_KEY=nsec1x BUZZ_CHANNEL_ID=chan-uuid \
  bash "$NOTIFY" --severity critical "A real critical notification long enough to clear the floors" >/dev/null 2>&1
if [ ! -f "$WORK/buzz-payload.txt" ] && [ -n "$(ls "$WORK"/*.md 2>/dev/null)" ]; then
  pass "buzz skipped when binary absent -> pending-queue fallback"
else
  bad "buzz skipped when binary absent -> pending-queue fallback"
fi

reset
echo "---"
[ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
