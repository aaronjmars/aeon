#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BIN="$TMP/bin"; POC="$TMP/poc"; RESULTS="$TMP/results"; REPO="$TMP/target"
mkdir -p "$BIN" "$POC" "$RESULTS" "$REPO/test"
git -C "$REPO" init -q
git -C "$REPO" config user.email test@example.com
git -C "$REPO" config user.name test
echo target > "$REPO/source.txt"
git -C "$REPO" add source.txt
git -C "$REPO" commit -qm initial
COMMIT="$(git -C "$REPO" rev-parse HEAD)"

cat > "$POC/finding.json" <<EOF
{"id":"case-1","target_repo":"owner/repo","target_commit":"$COMMIT","severity":"high","attacker_controls":"an untrusted callback argument","attacker_achieves":"unauthorized transfer of pool funds"}
EOF
cat > "$POC/case.t.sol" <<'EOF'
contract AeonPoC { function test_poc_reproduces() public {} }
EOF

cat > "$BIN/cast" <<'EOF'
#!/usr/bin/env bash
case "$1" in chain-id) echo 8453 ;; block-number) echo 123456 ;; *) exit 1 ;; esac
EOF
cat > "$BIN/forge" <<EOF
#!/usr/bin/env bash
[ -z "\${GH_TOKEN:-}" ] || exit 90
[ -z "\${RESEND_API_KEY:-}" ] || exit 91
[ -z "\${OPENAI_API_KEY:-}" ] || exit 92
printf '%s\n' "\$*" > "$TMP/forge.args"
exit "\$(cat "$TMP/forge.rc")"
EOF
chmod +x "$BIN/cast" "$BIN/forge"
echo 0 > "$TMP/forge.rc"

export PATH="$BIN:$PATH" VULN_POC_DIR="$POC" VULN_POC_RESULTS_DIR="$RESULTS"
export VULN_POC_EXEC_LOG="$TMP/poc-executions.log"
export VULN_POC_CHAINS_FILE="skills/deploy-uni-hook/templates/chains.tsv"
export GH_TOKEN=synthetic RESEND_API_KEY=synthetic OPENAI_API_KEY=synthetic

fail=0
pass() { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fail=1; }

if bash scripts/vuln-poc-gate.sh foundry --finding "$POC/finding.json" --repo "$REPO" \
  --test-file "$POC/case.t.sol" --chain base --match-contract AeonPoC >/tmp/vuln-poc-test.out 2>/tmp/vuln-poc-test.err; then
  pass "foundry reproduction passes"
else
  bad "foundry reproduction should pass"
fi
jq -e '.verdict=="verified" and .verifier=="foundry-fork" and .chain_id=="8453" and .fork_block=="123456"' \
  "$RESULTS/case-1.json" >/dev/null && pass "verified result is machine-readable" || bad "verified result schema"
EXPECTED_SHA="$(shasum -a 256 "$POC/finding.json" | cut -d' ' -f1)"
[ "$(jq -r '.finding_sha256' "$RESULTS/case-1.json")" = "$EXPECTED_SHA" ] \
  && pass "result is bound to the exact finding claim" || bad "finding hash mismatch"
grep -qx 'case-1 foundry-fork verified' "$VULN_POC_EXEC_LOG" \
  && pass "redacted execution evidence is recorded" || bad "missing execution evidence"
grep -q -- '--fork-block-number 123456' "$TMP/forge.args" && pass "fork is pinned to observed block" || bad "fork block was not pinned"
[ ! -e "$REPO/test/AeonPoC_case-1.t.sol" ] && pass "private test is removed from target checkout" || bad "private test leaked into checkout"

echo 1 > "$TMP/forge.rc"
bash scripts/vuln-poc-gate.sh foundry --finding "$POC/finding.json" --repo "$REPO" \
  --test-file "$POC/case.t.sol" --chain base >/tmp/vuln-poc-test.out 2>/tmp/vuln-poc-test.err
[ "$?" -eq 20 ] && jq -e '.verdict=="failed"' "$RESULTS/case-1.json" >/dev/null \
  && pass "failed reproduction blocks verification" || bad "failed reproduction should block"

jq '.attacker_achieves="short"' "$POC/finding.json" > "$POC/invalid.json"
bash scripts/vuln-poc-gate.sh foundry --finding "$POC/invalid.json" --repo "$REPO" \
  --test-file "$POC/case.t.sol" --chain base >/tmp/vuln-poc-test.out 2>/tmp/vuln-poc-test.err
[ "$?" -eq 4 ] && pass "underspecified attacker claim is rejected" || bad "invalid claim should be rejected"

cat > "$POC/repro.sh" <<'EOF'
#!/usr/bin/env bash
[ -z "${GH_TOKEN:-}" ] && [ -z "${RESEND_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]
EOF
echo 0 > "$TMP/forge.rc"
bash scripts/vuln-poc-gate.sh command --finding "$POC/finding.json" --repo "$REPO" \
  --script "$POC/repro.sh" >/tmp/vuln-poc-test.out 2>/tmp/vuln-poc-test.err
[ "$?" -eq 0 ] && jq -e '.verdict=="verified" and .verifier=="local-command"' "$RESULTS/case-1.json" >/dev/null \
  && pass "local verifier runs with secrets scrubbed" || bad "local verifier failed"

cat > "$POC/repro-fail.sh" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
bash scripts/vuln-poc-gate.sh command --finding "$POC/finding.json" --repo "$REPO" \
  --script "$POC/repro-fail.sh" >/tmp/vuln-poc-test.out 2>/tmp/vuln-poc-test.err
[ "$?" -eq 20 ] && jq -e '.verdict=="failed" and .verifier=="local-command"' "$RESULTS/case-1.json" >/dev/null \
  && pass "failed local reproduction blocks verification" || bad "failed local reproduction should block"

cat > "$POC/repro-mutates.sh" <<'EOF'
#!/usr/bin/env bash
printf 'changed\n' > source.txt
EOF
bash scripts/vuln-poc-gate.sh command --finding "$POC/finding.json" --repo "$REPO" \
  --script "$POC/repro-mutates.sh" >/tmp/vuln-poc-test.out 2>/tmp/vuln-poc-test.err
[ "$?" -eq 21 ] && jq -e '.verdict=="failed"' "$RESULTS/case-1.json" >/dev/null \
  && pass "a verifier that mutates audited source is rejected" || bad "source mutation should block verification"
git -C "$REPO" checkout -q -- source.txt

echo "---"
[ "$fail" -eq 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
