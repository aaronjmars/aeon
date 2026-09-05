#!/usr/bin/env bash
# Offline boundary tests: real dry-run + mode/requires helpers, stub dispatcher.
# No model calls, live credentials, notifications, or remote writes.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="$(mktemp -d)"
trap 'rm -rf "$FIXTURE"' EXIT
mkdir -p "$FIXTURE"/{scripts/lib,skills/probe,skills/no-auth,harness-adapter/lib,bin}
cp "$ROOT/scripts/dry-run.sh" "$ROOT/scripts/skill_mode.sh" "$ROOT/scripts/skill_requires.sh" "$FIXTURE/scripts/"
cp "$ROOT"/scripts/lib/*.sh "$FIXTURE/scripts/lib/"
cat > "$FIXTURE/skills/probe/SKILL.md" <<'SKILL'
---
name: probe
metadata:
  mode: read-only
  requires: [XAI_API_KEY]
---
Return the requested marker. Do not call external tools.
SKILL
cat > "$FIXTURE/skills/no-auth/SKILL.md" <<'SKILL'
---
name: no-auth
mode: read-only
requires: []
---
Return the requested marker. Do not call external tools.
SKILL
cat > "$FIXTURE/harness-adapter/lib/sandbox.sh" <<'STUB'
sandbox_prefix() { [ "${PROBE_SANDBOX:-available}" = available ]; }
STUB
cat > "$FIXTURE/harness-adapter/run-harness" <<'STUB'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$@" > output/args
cat > output/prompt
[[ "${XAI_API_KEY:-DRYRUN}" == *DRYRUN* && "$GH_TOKEN" == *DRYRUN* && "$NOTIFY_DRY_RUN" == 1 ]]
case "${PROBE_REPLY:-ok}" in
  timeout) sleep 5 ;;
  error) echo 'synthetic adapter failure' >&2; exit 7 ;;
  stderr) echo 'diagnostics only' >&2 ;;
  raw) echo 'not an envelope' ;;
  empty) echo '{"result":"  ","usage":{}}' ;;
  is-error) echo '{"result":"error message","usage":{},"is_error":true}' ;;
  wrapped) echo 'rh-wrap-fallback: synthetic' >&2; echo '{"result":"raw fallback","usage":{}}' ;;
  *) echo '{"result":"verified fixture marker","usage":{"input_tokens":1,"output_tokens":2}}' ;;
esac
STUB
for cli in claude codex; do
  printf '#!/bin/sh\nexit 99\n' > "$FIXTURE/bin/$cli"
  chmod +x "$FIXTURE/bin/$cli"
done
# No credential access even if the parent has keys. The stub tests synthetic env.
export PATH="$FIXTURE/bin:$PATH" DRYRUN_TIMEOUT=2
unset DRYRUN_HARNESS DRYRUN_MODEL DRYRUN_VERDICT SKILL_DRYRUN XAI_API_KEY
cd "$FIXTURE"
git init -q
git add .
git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm fixture
count=0
run() { bash scripts/dry-run.sh run probe "$@" > output/result.json 2> output/diagnostics; }
check() { "$@" || { echo "FAIL: $*" >&2; exit 1; }; count=$((count+1)); }
expect_failure() { if run "$@"; then echo "FAIL: expected rejection (reply=${PROBE_REPLY:-ok}, args=$*)" >&2; exit 1; fi; }
mkdir -p output
run
check jq -e '.passed and .harness == "claude" and .requested_model == ""' output/result.json
check grep -qx read-only output/args
check grep -q 'Bash(./notify:' output/args
if grep -q 'Bash(git:' output/args; then echo 'FAIL: read-only got write tools'; exit 1; fi
count=$((count+1))
run 'literal demo input' --harness codex --model gpt-6-astra
check jq -e '.passed and .harness == "codex" and .requested_model == "gpt-6-astra"' output/result.json
check grep -qx codex output/args
check grep -qx -- --model output/args
check grep -qx gpt-6-astra output/args
check grep -q 'Input: literal demo input' output/prompt
DRYRUN_HARNESS=codex DRYRUN_MODEL=gpt-6-astra run
check jq -e '.passed and .harness == "codex" and .requested_model == "gpt-6-astra"' output/result.json
DRYRUN_HARNESS=codex DRYRUN_MODEL=gpt-6-astra run --harness claude --model sonnet
check jq -e '.passed and .harness == "claude" and .requested_model == "sonnet"' output/result.json
for pair in 'codex claude-sonnet-4' 'claude gpt-6-astra' 'codex openai/gpt-6-astra'; do
  read -r h m <<< "$pair"
  expect_failure --harness "$h" --model "$m"
  check jq -e '.passed == false' output/.dry-run/probe.json
done
expect_failure --harness unsupported
check jq -e '.passed == false' output/.dry-run/probe.json
run
expect_failure --unknown
check jq -e '.passed == false' output/.dry-run/probe.json
PROBE_SANDBOX=missing expect_failure
check jq -e '.passed == false and .reasons[0] == "read-only OS sandbox unavailable"' output/.dry-run/probe.json
for reply in stderr raw empty is-error wrapped error timeout; do
  PROBE_REPLY="$reply" expect_failure --harness codex
  check jq -e '.passed == false' output/.dry-run/probe.json
  case "$reply" in
    timeout) check jq -e '.reason == "timeout" and .exit_code == 124' output/.dry-run/probe.json ;;
    error) check jq -e '.reason == "harness-error" and .exit_code == 7' output/.dry-run/probe.json ;;
    empty) check jq -e '.reason == "empty-result"' output/.dry-run/probe.json ;;
    *) check jq -e '.reason == "invalid-envelope"' output/.dry-run/probe.json ;;
  esac
done
# Relative verdict paths are rooted in the checkout, even from another cwd.
(cd /; DRYRUN_VERDICT=output/from-outside.json bash "$FIXTURE/scripts/dry-run.sh" run probe >/dev/null 2>&1)
check jq -e '.passed' output/from-outside.json
bash scripts/dry-run.sh run no-auth --harness codex > output/no-auth.json 2> output/no-auth.log
check jq -e '.passed and .reason == "ok"' output/no-auth.json
if grep -q 'invalid JSON' output/no-auth.log; then echo 'FAIL: empty requires emitted invalid JSON'; exit 1; fi
count=$((count+1))
# Missing CLI must fail, even if a previous invocation passed. Restrict PATH to
# only the preflight utilities so a globally installed Codex cannot mask this.
mkdir -p no-cli
for utility in dirname mkdir jq tee timeout; do
  ln -s "$(command -v "$utility")" "no-cli/$utility"
done
if PATH="$FIXTURE/no-cli" "$BASH" scripts/dry-run.sh run probe --harness codex > output/missing-cli.json 2> output/missing-cli.log; then
  echo 'FAIL: missing CLI passed'; exit 1
fi
check jq -e '.passed == false and .reasons[0] == "selected harness CLI missing"' output/missing-cli.json
printf 'dry-run dispatch: %d passed\n' "$count"
