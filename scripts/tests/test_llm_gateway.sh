#!/usr/bin/env bash
# Tests for the glm arm of scripts/llm-gateway.sh.
# The shim is SOURCED by the workflow, so these tests source it too. Each case
# runs in a subshell so exported CLAUDE_CODE_* / ANTHROPIC_* vars don't leak.
# Run: bash scripts/tests/test_llm_gateway.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
GW="scripts/llm-gateway.sh"
fail=0
pass() { echo "ok   - $1"; }
bad()  { echo "FAIL - $1"; fail=1; }

# The glm arm requires a key and never talks to the network (no sidecar).
glm_src() {
  export GATEWAY=glm GLM_API_KEY=test-key MODEL=claude-sonnet-5
  # shellcheck disable=SC1090
  source "$GW" >/dev/null
}

# 1. Unset GLM_REASONING_EFFORT → default high + ALWAYS_ENABLE.
( unset GLM_REASONING_EFFORT CLAUDE_CODE_EFFORT_LEVEL CLAUDE_CODE_ALWAYS_ENABLE_EFFORT
  glm_src
  [ "${CLAUDE_CODE_EFFORT_LEVEL:-}" = "high" ] \
    && [ "${CLAUDE_CODE_ALWAYS_ENABLE_EFFORT:-}" = "1" ]
) && pass "default → CLAUDE_CODE_EFFORT_LEVEL=high + ALWAYS_ENABLE=1" \
  || bad "default → CLAUDE_CODE_EFFORT_LEVEL=high + ALWAYS_ENABLE=1"

# 2. Empty var uses the :-high default (same as unset).
( export GLM_REASONING_EFFORT=
  glm_src
  [ "${CLAUDE_CODE_EFFORT_LEVEL:-}" = "high" ]
) && pass "empty GLM_REASONING_EFFORT → high" \
  || bad "empty GLM_REASONING_EFFORT → high"

# 3. Repo-var override.
( export GLM_REASONING_EFFORT=max
  glm_src
  [ "${CLAUDE_CODE_EFFORT_LEVEL:-}" = "max" ] \
    && [ "${CLAUDE_CODE_ALWAYS_ENABLE_EFFORT:-}" = "1" ]
) && pass "GLM_REASONING_EFFORT=max → effort max, still ALWAYS_ENABLE" \
  || bad "GLM_REASONING_EFFORT=max → effort max, still ALWAYS_ENABLE"

# 4. low override.
( export GLM_REASONING_EFFORT=low
  glm_src
  [ "${CLAUDE_CODE_EFFORT_LEVEL:-}" = "low" ]
) && pass "GLM_REASONING_EFFORT=low → effort low" \
  || bad "GLM_REASONING_EFFORT=low → effort low"

# 5. ZAI_API_KEY alias is enough (no GLM_API_KEY).
( unset GLM_API_KEY
  export GATEWAY=glm ZAI_API_KEY=test-zai MODEL=claude-sonnet-5
  # shellcheck disable=SC1090
  source "$GW" >/dev/null
  [ "${CLAUDE_CODE_EFFORT_LEVEL:-}" = "high" ]
) && pass "ZAI_API_KEY alias → glm arm still pins effort" \
  || bad "ZAI_API_KEY alias → glm arm still pins effort"

# 6. Sourcing under bash -e (Actions default) does not abort the caller.
( set -e
  unset GLM_REASONING_EFFORT
  glm_src
  echo "still-running" >/dev/null
) && pass "sourcing under bash -e does not abort caller" \
  || bad "sourcing under bash -e does not abort caller"

echo
if [ "$fail" -eq 0 ]; then echo "All llm-gateway glm effort tests passed."; else echo "Some tests FAILED."; fi
exit "$fail"
