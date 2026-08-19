#!/usr/bin/env bash
# Tests for scripts/audit.sh — the structured audit log and its secret redaction.
# Run:  bash scripts/tests/test_audit.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/audit.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok()  { pass=$((pass+1)); }
no()  { fail=$((fail+1)); printf 'FAIL: %s\n' "$1"; }

# A secret with special characters so its raw, base64, and url-encoded forms all
# differ -- the adversarial case the redaction must catch in every encoding.
export FAKE_API_KEY='p@ss/w0rd+val=SECRET9xyz'
SECRET="$FAKE_API_KEY"
B64="$(printf '%s' "$SECRET" | base64 | tr -d '\n')"
URI="$(printf '%s' "$SECRET" | jq -sRr @uri)"

# --- no-op when disabled ---
unset AEON_AUDIT_LOG
printf '' | : # noop
if bash "$SCRIPT" notify.telegram "chat:x" 0 "FAKE_API_KEY" && [ ! -f "$TMP/should-not-exist" ]; then
  ok
else
  no "audit.sh should exit 0 and write nothing when AEON_AUDIT_LOG is unset"
fi

# --- enabled: one line per call ---
export AEON_AUDIT_LOG="$TMP/audit.jsonl"
export GITHUB_RUN_ID=1234567890
export AEON_SKILL=digest

bash "$SCRIPT" notify.telegram "chat:REDACTED" 0 "TELEGRAM_BOT_TOKEN"
bash "$SCRIPT" git.push "aeonfun/aeon@main" 0 ""
LINES=$(wc -l < "$AEON_AUDIT_LOG")
[ "$LINES" -eq 2 ] && ok || no "expected 2 lines, got $LINES"

# --- valid JSON with the required fields ---
if jq -e '.ts and .run_id and .skill and .action and (.exit|type=="number") and (.secrets_used|type=="array")' \
     "$AEON_AUDIT_LOG" >/dev/null; then ok; else no "records missing required fields / wrong types"; fi

# --- secrets_used carries NAMES ---
NAME=$(head -1 "$AEON_AUDIT_LOG" | jq -r '.secrets_used[0]')
[ "$NAME" = "TELEGRAM_BOT_TOKEN" ] && ok || no "secrets_used should record the name, got '$NAME'"

# --- ADVERSARIAL redaction: the secret must not survive in ANY encoding ---
# Target embeds the secret four ways: URL, JSON body, error message, base64.
TARGET="url=https://api.example.com/${SECRET}/x body={\"key\":\"${SECRET}\"} err=auth failed with ${SECRET} b64=${B64} enc=${URI}"
: > "$AEON_AUDIT_LOG"
bash "$SCRIPT" secretcurl "$TARGET" 22 "FAKE_API_KEY"
REC="$(cat "$AEON_AUDIT_LOG")"

grep -qF "$SECRET" <<<"$REC" && no "RAW secret value leaked into audit record" || ok
grep -qF "$B64"    <<<"$REC" && no "BASE64 secret value leaked into audit record" || ok
grep -qF "$URI"    <<<"$REC" && no "URL-ENCODED secret value leaked into audit record" || ok
grep -qF "REDACTED" <<<"$REC" && ok || no "expected REDACTED marker in the record"
# still valid JSON after scrubbing
jq -e . <<<"$REC" >/dev/null && ok || no "record is not valid JSON after redaction"
# non-secret fields preserved
[ "$(jq -r .exit <<<"$REC")" = "22" ] && ok || no "exit code not preserved"

# --- short id values are not over-redacted (avoid nuking things like chat ids) ---
export FAKE_CHAT_ID='42'
: > "$AEON_AUDIT_LOG"
bash "$SCRIPT" notify.telegram "delivered to 42 recipients" 0 ""
grep -qF "42 recipients" "$AEON_AUDIT_LOG" && ok || no "short value 42 should not be redacted"
unset FAKE_CHAT_ID

printf '\naudit: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
