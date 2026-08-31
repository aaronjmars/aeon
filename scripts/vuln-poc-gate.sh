#!/usr/bin/env bash
# Execute a private, deterministic reproduction before vuln-scanner may label a
# code finding HIGH or CRITICAL. Raw PoC source and command output stay in the
# runner's temp directory; stdout contains only a redacted verdict.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESULT_DIR="${VULN_POC_RESULTS_DIR:-/tmp/vuln-scan/poc-results}"
POC_DIR="${VULN_POC_DIR:-/tmp/vuln-scan/poc}"
EXEC_LOG="${VULN_POC_EXEC_LOG:-/tmp/vuln-scan/poc-executions.log}"
CHAINS_FILE="${VULN_POC_CHAINS_FILE:-$ROOT/skills/deploy-uni-hook/templates/chains.tsv}"

usage() {
  cat >&2 <<'EOF'
usage:
  vuln-poc-gate.sh foundry --finding FILE --repo DIR --test-file FILE --chain NAME [--match-contract NAME] [--match-test NAME]
  vuln-poc-gate.sh command --finding FILE --repo DIR --script FILE

The finding JSON must contain non-empty id, target_repo, target_commit,
attacker_controls, attacker_achieves, and severity (high or critical).
EOF
  exit 2
}

[ "$#" -ge 1 ] || usage
MODE="$1"; shift
FINDING=""; REPO=""; TEST_FILE=""; CHAIN=""; MATCH_CONTRACT=""; MATCH_TEST="^test_poc_"; SCRIPT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --finding)       FINDING="${2:-}"; shift 2 ;;
    --repo)          REPO="${2:-}"; shift 2 ;;
    --test-file)     TEST_FILE="${2:-}"; shift 2 ;;
    --chain)         CHAIN="${2:-}"; shift 2 ;;
    --match-contract) MATCH_CONTRACT="${2:-}"; shift 2 ;;
    --match-test)    MATCH_TEST="${2:-}"; shift 2 ;;
    --script)        SCRIPT="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo "VULN_POC_ERROR reason=jq-missing" >&2; exit 3; }
[ -f "$FINDING" ] || { echo "VULN_POC_ERROR reason=finding-missing" >&2; exit 3; }
[ -d "$REPO" ] || { echo "VULN_POC_ERROR reason=repo-missing" >&2; exit 3; }

if ! jq -e '
  (.id | type == "string" and test("^[A-Za-z0-9._-]{1,80}$")) and
  (.target_repo | type == "string" and length > 2) and
  (.target_commit | type == "string" and test("^[0-9a-fA-F]{7,40}$")) and
  (.attacker_controls | type == "string" and length >= 10) and
  (.attacker_achieves | type == "string" and length >= 10) and
  (.severity == "high" or .severity == "critical")
' "$FINDING" >/dev/null; then
  echo "VULN_POC_ERROR reason=invalid-finding-schema" >&2
  exit 4
fi

ID="$(jq -r '.id' "$FINDING")"
SEVERITY="$(jq -r '.severity' "$FINDING")"
TARGET_REPO="$(jq -r '.target_repo' "$FINDING")"
TARGET_COMMIT="$(jq -r '.target_commit' "$FINDING")"
ACTUAL_COMMIT="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || true)"
case "$ACTUAL_COMMIT" in
  "$TARGET_COMMIT"*) ;;
  *) echo "VULN_POC_ERROR id=$ID reason=target-commit-mismatch" >&2; exit 5 ;;
esac
if ! git -C "$REPO" diff --quiet -- . || ! git -C "$REPO" diff --cached --quiet -- .; then
  echo "VULN_POC_ERROR id=$ID reason=target-worktree-dirty" >&2
  exit 5
fi

mkdir -p "$RESULT_DIR"
mkdir -p "$(dirname "$EXEC_LOG")"
LOG="$RESULT_DIR/$ID.log"
RESULT="$RESULT_DIR/$ID.json"

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}
FINDING_SHA="$(hash_file "$FINDING")"

# Target code, build scripts, and PoCs are untrusted. Start them with a small,
# explicit environment rather than trying to enumerate every present and future
# Aeon/harness credential. Foundry uses only the public RPC passed on argv.
ISOLATED_ENV=(env -i "PATH=$PATH" "HOME=${HOME:-/tmp}" "TMPDIR=${TMPDIR:-/tmp}" CI=1)

write_result() {
  local verdict="$1" verifier="$2" chain_name="${3:-}" chain_id="${4:-}" block="${5:-}"
  jq -n \
    --arg id "$ID" --arg verdict "$verdict" --arg verifier "$verifier" \
    --arg severity "$SEVERITY" --arg target_repo "$TARGET_REPO" \
    --arg target_commit "$ACTUAL_COMMIT" --arg finding_sha256 "$FINDING_SHA" \
    --arg chain "$chain_name" --arg chain_id "$chain_id" --arg fork_block "$block" \
    --arg verified_at "$(date -u +%FT%TZ)" \
    '{schema_version:1,id:$id,verdict:$verdict,verifier:$verifier,
      severity_claimed:$severity,target_repo:$target_repo,target_commit:$target_commit,
      finding_sha256:$finding_sha256,verified_at:$verified_at}
      + (if ($chain|length)>0 then {chain:$chain,chain_id:$chain_id,fork_block:$fork_block} else {} end)' \
    > "$RESULT"
  printf '%s %s %s\n' "$ID" "$verifier" "$verdict" >> "$EXEC_LOG"
}

case "$MODE" in
  foundry)
    [ -f "$TEST_FILE" ] || { echo "VULN_POC_ERROR id=$ID reason=test-file-missing" >&2; exit 6; }
    [ -n "$CHAIN" ] || usage
    [ -f "$CHAINS_FILE" ] || { echo "VULN_POC_ERROR id=$ID reason=chain-registry-missing" >&2; exit 6; }
    command -v forge >/dev/null 2>&1 || { echo "VULN_POC_ERROR id=$ID reason=forge-missing" >&2; exit 6; }
    command -v cast >/dev/null 2>&1 || { echo "VULN_POC_ERROR id=$ID reason=cast-missing" >&2; exit 6; }

    case "$TEST_FILE" in "$POC_DIR"/*) ;; *) echo "VULN_POC_ERROR id=$ID reason=test-file-outside-poc-dir" >&2; exit 6 ;; esac
    ROW="$(awk -F'\t' -v c="$CHAIN" '!/^#/ && $1==c {print; exit}' "$CHAINS_FILE")"
    [ -n "$ROW" ] || { echo "VULN_POC_ERROR id=$ID reason=unknown-chain" >&2; exit 6; }
    IFS=$'\t' read -r _NAME EXPECTED_CHAIN_ID _TESTNET _PM _SV RPC _EXPLORER _ALCHEMY <<<"$ROW"

    CHAIN_ID="$(cast chain-id --rpc-url "$RPC" 2>"$LOG" || true)"
    BLOCK="$(cast block-number --rpc-url "$RPC" 2>>"$LOG" || true)"
    if [ "$CHAIN_ID" != "$EXPECTED_CHAIN_ID" ] || ! [[ "$BLOCK" =~ ^[0-9]+$ ]]; then
      write_result failed foundry-fork "$CHAIN" "${CHAIN_ID:-unknown}" "${BLOCK:-unknown}"
      echo "VULN_POC_FAILED id=$ID verifier=foundry-fork reason=rpc-state-unavailable result=$RESULT" >&2
      exit 20
    fi

    STAGED_TEST="$REPO/test/AeonPoC_${ID}.t.sol"
    [ ! -e "$STAGED_TEST" ] || { echo "VULN_POC_ERROR id=$ID reason=staged-test-collision" >&2; exit 6; }
    mkdir -p "$REPO/test"
    cp "$TEST_FILE" "$STAGED_TEST"
    cleanup() { rm -f "$STAGED_TEST"; }
    trap cleanup EXIT

    ARGS=(test --root "$REPO" --fork-url "$RPC" --fork-block-number "$BLOCK" --match-path "test/AeonPoC_${ID}.t.sol" --match-test "$MATCH_TEST" -vvv)
    [ -n "$MATCH_CONTRACT" ] && ARGS+=(--match-contract "$MATCH_CONTRACT")
    set +e
    "${ISOLATED_ENV[@]}" forge "${ARGS[@]}" >>"$LOG" 2>&1
    VERIFY_RC=$?
    set -e
    if ! git -C "$REPO" diff --quiet -- . || ! git -C "$REPO" diff --cached --quiet -- .; then
      write_result failed foundry-fork "$CHAIN" "$CHAIN_ID" "$BLOCK"
      echo "VULN_POC_FAILED id=$ID verifier=foundry-fork reason=target-mutated result=$RESULT" >&2
      exit 21
    elif [ "$VERIFY_RC" -eq 0 ]; then
      write_result verified foundry-fork "$CHAIN" "$CHAIN_ID" "$BLOCK"
      echo "VULN_POC_VERIFIED id=$ID verifier=foundry-fork chain=$CHAIN block=$BLOCK result=$RESULT"
    else
      write_result failed foundry-fork "$CHAIN" "$CHAIN_ID" "$BLOCK"
      echo "VULN_POC_FAILED id=$ID verifier=foundry-fork reason=reproduction-did-not-pass result=$RESULT" >&2
      exit 20
    fi
    ;;

  command)
    [ -f "$SCRIPT" ] || { echo "VULN_POC_ERROR id=$ID reason=script-missing" >&2; exit 6; }
    case "$SCRIPT" in "$POC_DIR"/*) ;; *) echo "VULN_POC_ERROR id=$ID reason=script-outside-poc-dir" >&2; exit 6 ;; esac
    set +e
    (cd "$REPO" && "${ISOLATED_ENV[@]}" bash "$SCRIPT") >"$LOG" 2>&1
    VERIFY_RC=$?
    set -e
    if ! git -C "$REPO" diff --quiet -- . || ! git -C "$REPO" diff --cached --quiet -- .; then
      write_result failed local-command
      echo "VULN_POC_FAILED id=$ID verifier=local-command reason=target-mutated result=$RESULT" >&2
      exit 21
    elif [ "$VERIFY_RC" -eq 0 ]; then
      write_result verified local-command
      echo "VULN_POC_VERIFIED id=$ID verifier=local-command result=$RESULT"
    else
      write_result failed local-command
      echo "VULN_POC_FAILED id=$ID verifier=local-command reason=reproduction-did-not-pass result=$RESULT" >&2
      exit 20
    fi
    ;;

  *) usage ;;
esac
