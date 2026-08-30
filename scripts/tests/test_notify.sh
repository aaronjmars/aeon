#!/usr/bin/env bash
# Integration test for the ./notify writer/deliver split (#912 Phase 2).
#   scripts/notify.sh          - queue-writer: writes ONE structured .json payload,
#                                never reads a channel token, never hits the wire.
#   scripts/notify-deliver.sh  - delivery half: renders + sends a queued payload,
#                                the only place a channel token is consumed.
# WRITER tests assert the .json payload (incl. the reply_markup notify.sh computes).
# DELIVER tests queue a payload then run notify-deliver.sh with NOTIFY_DRY_RUN=1, which
# records the per-channel payloads instead of sending. No network, no secrets.
#   Run: bash scripts/tests/test_notify.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
NOTIFY="scripts/notify.sh"
DELIVER="scripts/notify-deliver.sh"

# Queues live outside the repo now; isolate them per-run.
AEON_PENDING_DIR="$(mktemp -d)"; export AEON_PENDING_DIR
trap 'rm -rf "$AEON_PENDING_DIR"' EXIT

unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID DISCORD_WEBHOOK_URL SLACK_WEBHOOK_URL \
      BUZZ_PRIVATE_KEY BUZZ_CHANNEL_ID RESEND_API_KEY NOTIFY_EMAIL_TO \
      JSONRENDER_ENABLED NOTIFY_MIN_SEVERITY NOTIFY_DRY_RUN 2>/dev/null

WORK="$AEON_PENDING_DIR/notify-queue"
fail=0
pass() { echo "ok   - $1"; }
bad()  { echo "FAIL - $1"; fail=1; }
reset() { rm -rf "$WORK" "$AEON_PENDING_DIR/notify-sent-hashes" "$AEON_PENDING_DIR/notify-delivered-hashes"; }
payload() { ls -t "$WORK"/*.json 2>/dev/null | head -1; }
# Queue via notify.sh then render the newest payload with notify-deliver.sh (dry-run).
deliver() { local p; p="$(payload)"; [ -n "$p" ] && NOTIFY_DRY_RUN=1 bash "$DELIVER" "$p" >/dev/null 2>&1; }

# ============================ WRITER TESTS (.json) ==========================

# 1. structured message lands in the queue as .json with title + body
reset
bash "$NOTIFY" --title "Token Report" --severity warn "Prices down 3.3 percent today" >/dev/null 2>&1
p="$(payload)"
if [ -n "$p" ] && jq -e '.title=="Token Report" and (.body|contains("Prices down")) and .severity=="warn"' "$p" >/dev/null 2>&1; then
  pass "structured message queued as .json with title + severity"
else
  bad "structured message queued as .json with title + severity"
fi

# 2. probe/test message is suppressed (no payload)
reset
bash "$NOTIFY" "quick test ping" >/dev/null 2>&1
[ -z "$(payload)" ] && pass "probe message suppressed" || bad "probe message suppressed"

# 3. dedup - identical message twice produces a single payload
reset
bash "$NOTIFY" "Deployment finished successfully on prod cluster" >/dev/null 2>&1
bash "$NOTIFY" "Deployment finished successfully on prod cluster" >/dev/null 2>&1
count=$(ls "$WORK"/*.json 2>/dev/null | wc -l | tr -d ' ')
[ "$count" = "1" ] && pass "duplicate message deduped ($count file)" || bad "duplicate message deduped (got $count files)"

# 4. severity gate - warn below critical floor is skipped
reset
NOTIFY_MIN_SEVERITY=critical bash "$NOTIFY" --severity warn "Heads up, minor wobble in metrics" >/dev/null 2>&1
[ -z "$(payload)" ] && pass "below-floor severity skipped" || bad "below-floor severity skipped"

# 5. severity gate - critical passes the floor
reset
NOTIFY_MIN_SEVERITY=warn bash "$NOTIFY" --severity critical "Database is down, paging now" >/dev/null 2>&1
[ -n "$(payload)" ] && pass "at/above-floor severity delivered" || bad "at/above-floor severity delivered"

# 6. -f file body still works (backward compat)
reset
tmp=$(mktemp); printf 'Line one\n\nLine two with detail' > "$tmp"
bash "$NOTIFY" -f "$tmp" >/dev/null 2>&1
p="$(payload)"
{ [ -n "$p" ] && jq -e '.body|contains("Line two")' "$p" >/dev/null 2>&1; } \
  && pass "-f file body queued" || bad "-f file body queued"
rm -f "$tmp"

# --- reply_markup is computed by notify.sh and stored in the payload ---
ROOT="$(pwd)"; ABS_NOTIFY="$ROOT/scripts/notify.sh"

# 7. --buttons attaches an inline_keyboard to the payload's reply_markup
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=active \
  bash "$NOTIFY" "Alert body long enough to clear the probe filter here" \
  --buttons '[[{"text":"Snooze","callback_data":"snooze:x:y:60"}]]' >/dev/null 2>&1
p="$(payload)"
{ [ -n "$p" ] && jq -e '.reply_markup.inline_keyboard[0][0].callback_data=="snooze:x:y:60"' "$p" >/dev/null 2>&1; } \
  && pass "--buttons attaches inline_keyboard" || bad "--buttons attaches inline_keyboard"

# 8. --force-reply + --context set force_reply and prefix the [skill::intent] marker in body
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=active \
  bash "$NOTIFY" "Which repository should I track for you" \
  --force-reply --placeholder "owner/repo" --context "github-monitor::add-repo" >/dev/null 2>&1
p="$(payload)"
{ [ -n "$p" ] && jq -e '.reply_markup.force_reply==true' "$p" >/dev/null 2>&1 \
  && jq -e '.body|startswith("[github-monitor::add-repo]")' "$p" >/dev/null 2>&1; } \
  && pass "--force-reply + --context set marker and force_reply" || bad "--force-reply + --context set marker and force_reply"

# 9-11. --mute-key gate. Isolated cwd so the repo's memory/ is never touched.
MK="$(mktemp -d)"; mkdir -p "$MK/memory"; cd "$MK" || exit 1

# 9. muted key suppresses the send
reset; echo "token-movers:BTC" > memory/mutes.log; : > memory/snoozes.log
bash "$ABS_NOTIFY" "BTC alert that should be muted away entirely" --mute-key "token-movers:BTC" >/dev/null 2>&1
[ -z "$(payload)" ] && pass "--mute-key muted suppresses" || bad "--mute-key muted suppresses"

# 10. future snooze suppresses
reset; : > memory/mutes.log
printf 'token-movers:ETH:%s\n' "$(( $(date -u +%s) + 3600 ))" > memory/snoozes.log
bash "$ABS_NOTIFY" "ETH alert snoozed for an hour from now" --mute-key "token-movers:ETH" >/dev/null 2>&1
[ -z "$(payload)" ] && pass "--mute-key future snooze suppresses" || bad "--mute-key future snooze suppresses"

# 11. expired snooze delivers
reset
printf 'token-movers:SOL:%s\n' "$(( $(date -u +%s) - 10 ))" > memory/snoozes.log
bash "$ABS_NOTIFY" "SOL alert should deliver since snooze expired" --mute-key "token-movers:SOL" >/dev/null 2>&1
[ -n "$(payload)" ] && pass "--mute-key expired snooze delivers" || bad "--mute-key expired snooze delivers"

cd "$ROOT" || exit 1; rm -rf "$MK"

# 12. a normal skill notification gets the global Run again + Schedule weekly row
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=active SKILL_NAME=token-movers \
  bash "$NOTIFY" "A normal skill digest long enough to clear the probe filter here" >/dev/null 2>&1
p="$(payload)"
{ [ -n "$p" ] && jq -e '.reply_markup.inline_keyboard[-1][0].callback_data=="run:token-movers"' "$p" >/dev/null 2>&1 \
  && jq -e '.reply_markup.inline_keyboard[-1][1].callback_data=="schedule:token-movers:weekly"' "$p" >/dev/null 2>&1; } \
  && pass "global Run again + Schedule weekly buttons attached" || bad "global Run again + Schedule weekly buttons attached"

# 13. skill --buttons rows are kept, with the global row appended beneath
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=active SKILL_NAME=pr-review \
  bash "$NOTIFY" "Digest body long enough to clear the probe filter comfortably" \
  --buttons '[[{"text":"Open","url":"https://example.com"}]]' >/dev/null 2>&1
p="$(payload)"
{ [ -n "$p" ] && jq -e '.reply_markup.inline_keyboard[0][0].url=="https://example.com"' "$p" >/dev/null 2>&1 \
  && jq -e '.reply_markup.inline_keyboard[-1][0].callback_data=="run:pr-review"' "$p" >/dev/null 2>&1; } \
  && pass "custom --buttons kept + global row appended" || bad "custom --buttons kept + global row appended"

# 14. a force_reply prompt never carries inline buttons (mutual exclusivity)
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=active SKILL_NAME=github-monitor \
  bash "$NOTIFY" "Which repository should I track for you now" \
  --force-reply --placeholder "owner/repo" --context "github-monitor::add-repo" >/dev/null 2>&1
p="$(payload)"
{ [ -n "$p" ] && jq -e '.reply_markup.force_reply==true' "$p" >/dev/null 2>&1 \
  && jq -e '.reply_markup|has("inline_keyboard")|not' "$p" >/dev/null 2>&1; } \
  && pass "force_reply prompt carries no inline buttons" || bad "force_reply prompt carries no inline buttons"

# 15. no SKILL_NAME context -> reply_markup null (bare notify stays button-free)
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 \
  bash "$NOTIFY" "A contextless notification with no skill name set at all here" >/dev/null 2>&1
p="$(payload)"
{ [ -n "$p" ] && jq -e '.reply_markup==null' "$p" >/dev/null 2>&1; } \
  && pass "no SKILL_NAME -> reply_markup null" || bad "no SKILL_NAME -> reply_markup null"

# 15b. inbound Messages workflow disabled -> interactive markup suppressed (still queued)
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=disabled_manually SKILL_NAME=token-movers \
  bash "$NOTIFY" "A broadcast body long enough to clear the probe filter here now" \
  --buttons '[[{"text":"Snooze","callback_data":"snooze:token-movers:BTC:60"}]]' >/dev/null 2>&1
p="$(payload)"
{ [ -n "$p" ] && jq -e '.reply_markup==null' "$p" >/dev/null 2>&1; } \
  && pass "messages.yml disabled -> markup suppressed (still queued)" || bad "messages.yml disabled -> markup suppressed (still queued)"

# 15c. force_reply also suppressed when inbound disabled; body still carries the marker
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=disabled_manually SKILL_NAME=github-monitor \
  bash "$NOTIFY" "Which repository should I track for you now" \
  --force-reply --placeholder "owner/repo" --context "github-monitor::add-repo" >/dev/null 2>&1
p="$(payload)"
{ [ -n "$p" ] && jq -e '.reply_markup==null' "$p" >/dev/null 2>&1 \
  && jq -e '.body|startswith("[github-monitor::add-repo]")' "$p" >/dev/null 2>&1; } \
  && pass "messages.yml disabled -> force_reply plain (no markup)" || bad "messages.yml disabled -> force_reply plain (no markup)"

# 15d. workflow active -> buttons attach as normal
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=active SKILL_NAME=token-movers \
  bash "$NOTIFY" "A broadcast body long enough to clear the probe filter here now" >/dev/null 2>&1
p="$(payload)"
{ [ -n "$p" ] && jq -e '.reply_markup.inline_keyboard[-1][0].callback_data=="run:token-movers"' "$p" >/dev/null 2>&1; } \
  && pass "messages.yml active -> buttons attached" || bad "messages.yml active -> buttons attached"

# 15e. disabled workflow + TELEGRAM_FORCE_BUTTONS=1 override -> buttons come back
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=disabled_manually TELEGRAM_FORCE_BUTTONS=1 SKILL_NAME=token-movers \
  bash "$NOTIFY" "A broadcast body long enough to clear the probe filter here now" >/dev/null 2>&1
p="$(payload)"
{ [ -n "$p" ] && jq -e '.reply_markup.inline_keyboard[-1][0].callback_data=="run:token-movers"' "$p" >/dev/null 2>&1; } \
  && pass "TELEGRAM_FORCE_BUTTONS=1 overrides disabled workflow" || bad "TELEGRAM_FORCE_BUTTONS=1 overrides disabled workflow"

# 16. read-only cwd (a read-only skill under the OS sandbox): the queue lives OUTSIDE
#     the workspace, so notify must still succeed AND still queue.
reset
NOTIFY_ABS="$PWD/scripts/notify.sh"
RO="$(mktemp -d)"; chmod 555 "$RO"
if ( cd "$RO" && : > .wtest ) 2>/dev/null; then
  rm -f "$RO/.wtest"; chmod 755 "$RO"; rm -rf "$RO"
  pass "read-only cwd queues outside the workspace (skipped: cwd writable, likely root)"
else
  ( cd "$RO" && bash "$NOTIFY_ABS" --severity critical \
      "A real notification long enough to clear the probe and severity floors here" ) \
      >/dev/null 2>"${RO}.err"
  ec=$?; chmod 755 "$RO"; rm -rf "$RO"
  { [ "$ec" -eq 0 ] && [ -n "$(payload)" ]; } \
    && pass "read-only cwd still queues (queue is outside the workspace)" \
    || bad "read-only cwd queue (exit=$ec; err=$(tr '\n' '|' <"${RO}.err"))"
  rm -f "${RO}.err"
fi

# 17. queue itself unwritable: notify must exit 0 (no set -e abort), warning to stderr.
reset
UNWRITABLE="$(mktemp -d)"; chmod 555 "$UNWRITABLE"
if ( : > "$UNWRITABLE/.wtest" ) 2>/dev/null; then
  rm -f "$UNWRITABLE/.wtest"; chmod 755 "$UNWRITABLE"; rm -rf "$UNWRITABLE"
  pass "unwritable queue -> exit 0 (skipped: dir writable, likely root)"
else
  AEON_PENDING_DIR="$UNWRITABLE/nope" bash "$NOTIFY_ABS" --severity critical \
    "Another real notification long enough to clear the probe and severity floors" \
    >/dev/null 2>"${UNWRITABLE}.err"
  ec=$?; chmod 755 "$UNWRITABLE"; rm -rf "$UNWRITABLE"
  { [ "$ec" -eq 0 ] && grep -q "unwritable" "${UNWRITABLE}.err"; } \
    && pass "unwritable queue -> exit 0, no set -e abort" \
    || bad "unwritable queue (exit=$ec; err=$(tr '\n' '|' <"${UNWRITABLE}.err"))"
  rm -f "${UNWRITABLE}.err"
fi

# ========================== DELIVER TESTS (dry-run) =========================

# 18. Telegram render: notify-deliver.sh emits an HTML payload with parse_mode + text.
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 AEON_MESSAGES_WF_STATE=active SKILL_NAME=token-movers \
  bash "$NOTIFY" --title "Scan Report" --severity warn "Found 3 movers worth a look today" >/dev/null 2>&1
p="$(payload)"
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 NOTIFY_DRY_RUN=1 bash "$DELIVER" "$p" >/dev/null 2>&1
TG="$WORK/tg-payload.jsonl"
{ [ -f "$TG" ] && jq -e '.parse_mode=="HTML"' "$TG" >/dev/null 2>&1 \
  && jq -e '.text|contains("Scan Report")' "$TG" >/dev/null 2>&1 \
  && jq -e '.reply_markup.inline_keyboard[-1][0].callback_data=="run:token-movers"' "$TG" >/dev/null 2>&1; } \
  && pass "deliver: Telegram HTML payload + reply_markup" || bad "deliver: Telegram HTML payload + reply_markup"

# 19. Buzz render: dry-run records the decoded Markdown (no `buzz` binary, no network).
reset
BUZZ_PRIVATE_KEY=nsec1x BUZZ_CHANNEL_ID=chan-uuid \
  bash "$NOTIFY" --title "Scan Report" --severity warn "Found 3 movers worth a look today" >/dev/null 2>&1
p="$(payload)"
BUZZ_PRIVATE_KEY=nsec1x BUZZ_CHANNEL_ID=chan-uuid NOTIFY_DRY_RUN=1 bash "$DELIVER" "$p" >/dev/null 2>&1
BZ="$WORK/buzz-payload.txt"
{ [ -f "$BZ" ] && grep -q "Scan Report" "$BZ" && grep -q "Found 3 movers" "$BZ"; } \
  && pass "deliver: buzz dry-run records decoded markdown" || bad "deliver: buzz dry-run records decoded markdown"

# 20. R6 multi-channel: Telegram + email BOTH fire from one deliver call, independently.
reset
SKILL_NAME=vuln-scanner AEON_MESSAGES_WF_STATE=disabled_manually \
  bash "$NOTIFY" --title "Multi" --severity critical "R6 body long enough to clear floors" >/dev/null 2>&1
p="$(payload)"
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=1 RESEND_API_KEY=re_x NOTIFY_EMAIL_TO=a@b.com NOTIFY_DRY_RUN=1 \
  bash "$DELIVER" "$p" >/dev/null 2>&1
{ [ -f "$WORK/tg-payload.jsonl" ] && [ -f "$WORK/email-payload.txt" ]; } \
  && pass "deliver: R6 telegram + email both fire from one call" || bad "deliver: R6 telegram + email both fire from one call"

# 21. idempotency: delivering the same payload twice sends once (delivered-hash guard).
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 \
  bash "$NOTIFY" "An idempotency probe body long enough to clear the probe filter" >/dev/null 2>&1
p="$(payload)"
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 NOTIFY_DRY_RUN=1 bash "$DELIVER" "$p" >/dev/null 2>&1
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 NOTIFY_DRY_RUN=1 bash "$DELIVER" "$p" >/dev/null 2>&1
n=$(jq -s 'length' "$WORK/tg-payload.jsonl" 2>/dev/null)
[ "$n" = "1" ] && pass "deliver: idempotent re-delivery sends once ($n)" || bad "deliver: idempotent re-delivery sends once (got $n)"

# 22-27. reply-to-previous (default on). Isolated ledger dir so memory/ is never touched.
TDIR=$(mktemp -d)

# 22. first send for a skill has no reply_to; ledger stores a dry-run mid
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 SKILL_NAME=digest \
  bash "$NOTIFY" "First digest body long enough to clear the probe filter aaa" >/dev/null 2>&1
p="$(payload)"
AEON_TG_THREADS_DIR="$TDIR" TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 NOTIFY_DRY_RUN=1 \
  bash "$DELIVER" "$p" >/dev/null 2>&1
{ [ -f "$WORK/tg-payload.jsonl" ] \
  && jq -e 'has("reply_to_message_id")|not' "$WORK/tg-payload.jsonl" >/dev/null 2>&1 \
  && jq -e '.chat_id=="123" and .message_id==1' "$TDIR/digest.json" >/dev/null 2>&1; } \
  && pass "deliver: first send has no reply_to and writes ledger" \
  || bad "deliver: first send has no reply_to and writes ledger"

# 23. second send for the same skill quotes the stored mid
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 SKILL_NAME=digest \
  bash "$NOTIFY" "Second digest body long enough to clear the probe filter bbb" >/dev/null 2>&1
p="$(payload)"
AEON_TG_THREADS_DIR="$TDIR" TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 NOTIFY_DRY_RUN=1 \
  bash "$DELIVER" "$p" >/dev/null 2>&1
{ jq -e '.reply_to_message_id==1 and .allow_sending_without_reply==true' "$WORK/tg-payload.jsonl" >/dev/null 2>&1 \
  && jq -e '.message_id==2' "$TDIR/digest.json" >/dev/null 2>&1; } \
  && pass "deliver: second send replies to previous mid" \
  || bad "deliver: second send replies to previous mid"

# 24. a different skill does not inherit the other skill's mid
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 SKILL_NAME=heartbeat \
  bash "$NOTIFY" "Heartbeat body long enough to clear the probe filter ccc" >/dev/null 2>&1
p="$(payload)"
AEON_TG_THREADS_DIR="$TDIR" TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 NOTIFY_DRY_RUN=1 \
  bash "$DELIVER" "$p" >/dev/null 2>&1
{ jq -e 'has("reply_to_message_id")|not' "$WORK/tg-payload.jsonl" >/dev/null 2>&1 \
  && jq -e '.message_id==3' "$TDIR/heartbeat.json" >/dev/null 2>&1; } \
  && pass "deliver: other skill does not inherit reply_to" \
  || bad "deliver: other skill does not inherit reply_to"

# 25. TELEGRAM_REPLY_TO_PREVIOUS=0 skips reply_to even with a ledger
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 SKILL_NAME=digest \
  bash "$NOTIFY" "Killswitch digest body long enough to clear the probe filter ddd" >/dev/null 2>&1
p="$(payload)"
AEON_TG_THREADS_DIR="$TDIR" TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 TELEGRAM_REPLY_TO_PREVIOUS=0 NOTIFY_DRY_RUN=1 \
  bash "$DELIVER" "$p" >/dev/null 2>&1
jq -e 'has("reply_to_message_id")|not' "$WORK/tg-payload.jsonl" >/dev/null 2>&1 \
  && pass "deliver: TELEGRAM_REPLY_TO_PREVIOUS=0 skips reply_to" \
  || bad "deliver: TELEGRAM_REPLY_TO_PREVIOUS=0 skips reply_to"

# 26. chat_id mismatch skips reply_to
TDIR2=$(mktemp -d)
printf '%s\n' '{"chat_id":"999","message_id":42}' > "$TDIR2/digest.json"
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 SKILL_NAME=digest \
  bash "$NOTIFY" "Chat mismatch body long enough to clear the probe filter eee" >/dev/null 2>&1
p="$(payload)"
AEON_TG_THREADS_DIR="$TDIR2" TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 NOTIFY_DRY_RUN=1 \
  bash "$DELIVER" "$p" >/dev/null 2>&1
jq -e 'has("reply_to_message_id")|not' "$WORK/tg-payload.jsonl" >/dev/null 2>&1 \
  && pass "deliver: chat_id mismatch skips reply_to" \
  || bad "deliver: chat_id mismatch skips reply_to"

# 27. multi-chunk: first chunk replies to previous run; later chunks reply to chunk 1
TDIR3=$(mktemp -d)
printf '%s\n' '{"chat_id":"123","message_id":7}' > "$TDIR3/digest.json"
LONG=$(python3 -c 'print("word " * 2500)')
reset
TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 SKILL_NAME=digest \
  bash "$NOTIFY" --title "Long" "$LONG" >/dev/null 2>&1
p="$(payload)"
AEON_TG_THREADS_DIR="$TDIR3" TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=123 NOTIFY_DRY_RUN=1 \
  bash "$DELIVER" "$p" >/dev/null 2>&1
n=$(jq -s 'length' "$WORK/tg-payload.jsonl" 2>/dev/null)
r1=$(jq -s '.[0].reply_to_message_id' "$WORK/tg-payload.jsonl" 2>/dev/null)
r2=$(jq -s '.[1].reply_to_message_id' "$WORK/tg-payload.jsonl" 2>/dev/null)
{ [ "$n" -gt 1 ] && [ "$r1" = "7" ] && [ "$r2" = "1" ]; } \
  && pass "deliver: multi-chunk replies to prev then to chunk 1 ($n chunks)" \
  || bad "deliver: multi-chunk replies to prev then to chunk 1 (n=$n r1=$r1 r2=$r2)"

rm -rf "$TDIR" "$TDIR2" "$TDIR3"

echo "---"
[ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
