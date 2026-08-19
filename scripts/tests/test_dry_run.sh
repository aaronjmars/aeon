#!/usr/bin/env bash
# Tests for scripts/dry-run.sh - the self-authored-skill dry-run gate.
# Covers the pure, security-critical primitives: synth-env (never a real secret),
# assert-no-real-secrets, and the evaluate pass/fail criteria.
# Run:  bash scripts/tests/test_dry_run.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dry-run.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok() { pass=$((pass+1)); }
no() { fail=$((fail+1)); printf 'FAIL: %s\n' "$1"; }

# ---- synth-env: synthetic, well-formed, never real ----
ENVOUT="$(bash "$SCRIPT" synth-env 'SLACK_WEBHOOK_URL, XAI_API_KEY, TELEGRAM_CHAT_ID, HOOK_DEPLOYER_PRIVATE_KEY, ANTHROPIC_API_KEY')"
echo "$ENVOUT" > "$TMP/env"

grep -q '^SLACK_WEBHOOK_URL=https://dryrun.invalid/' "$TMP/env" && ok || no "webhook url shape"
grep -q '^XAI_API_KEY=sk-DRYRUN' "$TMP/env" && ok || no "api key shape"
grep -q '^TELEGRAM_CHAT_ID=' "$TMP/env" && ok || no "chat id emitted"
grep -q '^HOOK_DEPLOYER_PRIVATE_KEY=0xDRYRUN' "$TMP/env" && ok || no "private key shape"
grep -q 'ANTHROPIC_API_KEY' "$TMP/env" && no "ANTHROPIC must NOT be synthesized" || ok
# every emitted value carries the DRYRUN marker
if awk -F= 'NF>1 && $2 !~ /DRYRUN/ {print; found=1} END{exit found?1:0}' "$TMP/env"; then ok; else no "a synthetic value lacks the DRYRUN marker"; fi

# the `?` works-better marker is stripped from the key name
WB="$(bash "$SCRIPT" synth-env 'COINGECKO_API_KEY?')"
grep -q '^COINGECKO_API_KEY=' <<<"$WB" && ok || no "? marker not stripped from key"

# ---- assert-no-real-secrets ----
REAL='real-token-abc123-do-not-leak'
printf 'X=sk-DRYRUN000\nY=%s\n' "harmless" > "$TMP/clean.env"
bash "$SCRIPT" assert-no-real-secrets "$TMP/clean.env" "$REAL" && ok || no "clean env wrongly flagged"
printf 'X=%s\n' "$REAL" > "$TMP/leaky.env"
bash "$SCRIPT" assert-no-real-secrets "$TMP/leaky.env" "$REAL" && no "leaked env not caught" || ok

# ---- evaluate ----
ev() { bash "$SCRIPT" evaluate <(printf '%s' "$1") >/dev/null 2>&1; echo $?; }

# clean pass: exit 0, output, write only under output/, declared secret used
[ "$(ev '{"exit":0,"output_len":500,"mode":"write","writes":["output/x.md","memory/logs/2026.md"],"requires":["XAI_API_KEY"],"secrets_seen":["XAI_API_KEY"]}')" = 0 ] && ok || no "clean run should pass"
# non-zero exit fails
[ "$(ev '{"exit":3,"output_len":500,"mode":"write","writes":[],"requires":[],"secrets_seen":[]}')" = 1 ] && ok || no "non-zero exit should fail"
# empty output fails
[ "$(ev '{"exit":0,"output_len":0,"mode":"write","writes":[],"requires":[],"secrets_seen":[]}')" = 1 ] && ok || no "empty output should fail"
# read-only skill that writes a file fails
[ "$(ev '{"exit":0,"output_len":10,"mode":"read-only","writes":["skills/foo/SKILL.md"],"requires":[],"secrets_seen":[]}')" = 1 ] && ok || no "read-only write should fail"
# a read-only skill writing under output/ is fine
[ "$(ev '{"exit":0,"output_len":10,"mode":"read-only","writes":["output/x.md"],"requires":[],"secrets_seen":[]}')" = 0 ] && ok || no "read-only output write should pass"
# any skill touching the control plane fails
[ "$(ev '{"exit":0,"output_len":10,"mode":"write","writes":[".github/workflows/aeon.yml"],"requires":[],"secrets_seen":[]}')" = 1 ] && ok || no "control-plane write should fail"
# using an undeclared secret fails
[ "$(ev '{"exit":0,"output_len":10,"mode":"write","writes":[],"requires":["XAI_API_KEY"],"secrets_seen":["SLACK_BOT_TOKEN"]}')" = 1 ] && ok || no "undeclared secret should fail"
# the model key is never counted as undeclared
[ "$(ev '{"exit":0,"output_len":10,"mode":"write","writes":[],"requires":[],"secrets_seen":["ANTHROPIC_API_KEY"]}')" = 0 ] && ok || no "model key should be exempt"

printf '\ndry-run: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
