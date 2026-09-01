#!/usr/bin/env bash
# Opt-in network smoke test for the real Foundry/fork path. Not run in CI because
# public RPC availability is external state. It proves the gate reads a live Base
# block and executes a private test against that pinned fork.
set -euo pipefail
cd "$(dirname "$0")/../.."

POC_DIR="$(mktemp -d)"
RESULT_DIR="$(mktemp -d)"
trap 'rm -rf "$POC_DIR" "$RESULT_DIR"' EXIT
TARGET="$POC_DIR/target"
mkdir -p "$TARGET/src"
# Copy only canonical inputs. A prior local/agent build may have left untracked
# cache/ or out/ artifacts beside the fixture; committing those into the isolated
# repo would make the next Forge build look like a target-source mutation.
cp scripts/tests/fixtures/vuln-poc-foundry/foundry.toml "$TARGET/foundry.toml"
cp scripts/tests/fixtures/vuln-poc-foundry/src/Fixture.sol "$TARGET/src/Fixture.sol"
git -C "$TARGET" init -q
git -C "$TARGET" config user.email test@example.com
git -C "$TARGET" config user.name test
git -C "$TARGET" add .
git -C "$TARGET" commit -qm fixture
COMMIT="$(git -C "$TARGET" rev-parse HEAD)"

cat > "$POC_DIR/finding.json" <<EOF
{"id":"live-fork-smoke","target_repo":"aeonfun/aeon","target_commit":"$COMMIT","severity":"high","attacker_controls":"synthetic input used only by the integration smoke test","attacker_achieves":"synthetic outcome used only to exercise the verification runner"}
EOF
cat > "$POC_DIR/poc.t.sol" <<'EOF'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract AeonPoC {
    // WETH9 is deployed on Base. Reading its code proves this test is executing
    // against real fork state rather than an empty local EVM.
    address constant BASE_WETH = 0x4200000000000000000000000000000000000006;

    function test_poc_reads_real_base_state() public view {
        require(BASE_WETH.code.length > 0, "Base WETH missing from fork state");
    }
}
EOF

VULN_POC_DIR="$POC_DIR" VULN_POC_RESULTS_DIR="$RESULT_DIR" \
  bash scripts/vuln-poc-gate.sh foundry \
    --finding "$POC_DIR/finding.json" \
    --repo "$TARGET" \
    --test-file "$POC_DIR/poc.t.sol" \
    --chain base \
    --match-contract AeonPoC \
    --match-test '^test_poc_'

jq -e '.verdict == "verified" and .verifier == "foundry-fork" and .chain_id == "8453" and (.fork_block | tonumber) > 0' \
  "$RESULT_DIR/live-fork-smoke.json" >/dev/null
echo "live-vuln-poc-gate: PASS"
