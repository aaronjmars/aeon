#!/usr/bin/env bash
# test_otel_span.sh — harness-adapter/lib/otel-span.sh (Tier-2 harness tracing).
#
# Guards the three properties that make the emit safe:
#   1. it no-ops (and never fails) when telemetry is off or otel-cli is absent
#   2. it emits the expected gen_ai.* span for a non-claude harness
#   3. it NEVER puts result content on the span, and skips claude (self-traces)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$ROOT/harness-adapter/lib/otel-span.sh"
FAIL=0
ok()   { echo "ok   - $1"; }
bad()  { echo "FAIL - $1"; FAIL=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# A stub otel-cli that records its argv, placed first on PATH.
cat > "$TMP/otel-cli" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$OTEL_STUB_OUT"
STUB
chmod +x "$TMP/otel-cli"
export OTEL_STUB_OUT="$TMP/args.txt"

# Envelope carrying result content that must never reach the span.
cat > "$TMP/env.json" <<'JSON'
{"result":"SENSITIVE-RESULT-TEXT","usage":{"input_tokens":1200,"output_tokens":340,"cache_read_input_tokens":900,"cache_creation_input_tokens":10},"total_cost_usd":0.0123}
JSON

emit() { # runs the helper in a clean subshell with the given env
  env -i PATH="$TMP:$PATH" HOME="$HOME" OTEL_STUB_OUT="$OTEL_STUB_OUT" \
    RH_HARNESS="$1" RH_MODEL="$2" \
    OTEL_EXPORTER_OTLP_ENDPOINT="$3" AEON_OTEL_COMPONENT=harness \
    bash -c ". '$LIB'; rh_emit_harness_span '$TMP/env.json' 1000 2000"
}

# 1. no endpoint → no-op, rc 0, nothing recorded
rm -f "$TMP/args.txt"
emit grok grok-4.5 ""; rc=$?
{ [ "$rc" = 0 ] && [ ! -f "$TMP/args.txt" ]; } && ok "telemetry off → no-op" || bad "telemetry off → no-op (rc=$rc)"

# 2. non-claude + endpoint → emits gen_ai span with usage/model/cost
rm -f "$TMP/args.txt"
emit grok grok-4.5 "http://collector.invalid"
if [ -f "$TMP/args.txt" ]; then
  args="$(cat "$TMP/args.txt")"
  case "$args" in *"gen_ai.system=grok"*) ok "records gen_ai.system" ;; *) bad "missing gen_ai.system" ;; esac
  case "$args" in *"gen_ai.request.model=grok-4.5"*) ok "records model" ;; *) bad "missing model" ;; esac
  case "$args" in *"gen_ai.usage.input_tokens=1200"*) ok "records input tokens" ;; *) bad "missing input tokens" ;; esac
  case "$args" in *"gen_ai.usage.output_tokens=340"*) ok "records output tokens" ;; *) bad "missing output tokens" ;; esac
  case "$args" in *"aeon.cost_usd=0.0123"*) ok "records cost" ;; *) bad "missing cost" ;; esac
  case "$args" in *SENSITIVE-RESULT-TEXT*) bad "result content leaked onto span" ;; *) ok "no result content on span" ;; esac
else
  bad "non-claude + endpoint → expected an emit"
fi

# 3. claude is skipped (it self-traces via Claude Code's own OTEL)
rm -f "$TMP/args.txt"
emit claude claude-sonnet-5 "http://collector.invalid"
[ ! -f "$TMP/args.txt" ] && ok "claude harness skipped" || bad "claude harness should not emit"

# 4. missing otel-cli → no-op even with endpoint set. Keep jq reachable (so the
#    guard being exercised is specifically the absent otel-cli), drop the stub.
rm -f "$TMP/args.txt"
JQ_DIR="$(dirname "$(command -v jq)")"
env -i PATH="$JQ_DIR:/usr/bin:/bin" HOME="$HOME" \
  RH_HARNESS=grok RH_MODEL=grok-4.5 OTEL_EXPORTER_OTLP_ENDPOINT="http://collector.invalid" \
  bash -c ". '$LIB'; rh_emit_harness_span '$TMP/env.json' 1 2"; rc=$?
[ "$rc" = 0 ] && ok "no otel-cli → no-op, rc 0" || bad "no otel-cli should no-op (rc=$rc)"

if [ "$FAIL" = 0 ]; then echo "All otel-span tests passed."; else echo "otel-span tests FAILED."; exit 1; fi
