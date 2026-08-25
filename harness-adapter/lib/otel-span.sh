# shellcheck shell=bash
# otel-span.sh — emit one OpenTelemetry span per non-claude harness run.
#
# SOURCED by run-harness (never executed). Opt-in + no-op, mirroring aeon's
# scripts/langfuse-otel.sh: it emits nothing unless ALL of these hold, and it
# NEVER fails the caller (every path returns 0 / is `|| true`-guarded):
#   • OTEL_EXPORTER_OTLP_ENDPOINT is set (the same env the shim exports)
#   • the harness is NOT claude — Claude Code emits its own OTEL spans natively,
#     so tracing it here would double-count; this fills the gap for the other
#     six harnesses (grok/codex/pi/vibe/kimi/fx), which emit nothing on their own
#   • `otel-cli` is on PATH (the shell OTLP emitter; staged by
#     scripts/install-otel-cli.sh in CI) and `jq` is available to read usage
#
# WHY otel-cli: bash can't speak OTLP/protobuf, and Langfuse's endpoint rejects
# OTLP/JSON — so a hand-rolled curl won't ingest. otel-cli emits protobuf over
# HTTP and reads OTEL_EXPORTER_OTLP_ENDPOINT / _HEADERS / _PROTOCOL from the
# environment, exactly as langfuse-otel.sh sets them.
#
# CONTENT: only numeric usage + model + harness are recorded as gen_ai.*
# attributes. The prompt and the result text are NEVER put on the span.

# A timestamp otel-cli accepts for --start/--end: Unix epoch "seconds.fraction"
# (its docs' canonical form is `date +%s.%N`). NOT bare nanoseconds — otel-cli
# misparses a plain 19-digit integer into a far-future time. GNU date supports
# %N; BSD/macOS date leaves a literal "N", so fall back to whole seconds there
# (otel-cli accepts a plain epoch-seconds integer too).
_rh_now() {
  local t
  t=$(date +%s.%N 2>/dev/null)
  case "$t" in
    *[!0-9.]* | "") date +%s ;;
    *) echo "$t" ;;
  esac
}

# rh_emit_harness_span <envelope_file> <start_ns> <end_ns>
# Reads .usage / .total_cost_usd from the run-harness envelope and emits a span.
rh_emit_harness_span() {
  [ "${RH_HARNESS:-}" = claude ] && return 0
  [ -n "${OTEL_EXPORTER_OTLP_ENDPOINT:-}" ] || return 0
  command -v otel-cli >/dev/null 2>&1 || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local ef="${1:-}" start="${2:-}" end="${3:-}"
  [ -f "$ef" ] || return 0

  local model="${RH_MODEL:-}"; [ -n "$model" ] || model=default
  local it ot cr cc cost
  it=$(jq -r '.usage.input_tokens // 0' "$ef" 2>/dev/null) || return 0
  ot=$(jq -r '.usage.output_tokens // 0' "$ef" 2>/dev/null) || return 0
  cr=$(jq -r '.usage.cache_read_input_tokens // 0' "$ef" 2>/dev/null) || return 0
  cc=$(jq -r '.usage.cache_creation_input_tokens // 0' "$ef" 2>/dev/null) || return 0
  cost=$(jq -r '.total_cost_usd // 0' "$ef" 2>/dev/null) || return 0

  otel-cli span \
    --service "${OTEL_SERVICE_NAME:-aeon-harness}" \
    --name "gen_ai.chat ${RH_HARNESS}" \
    --kind client \
    --start "$start" --end "$end" \
    --attrs "gen_ai.system=${RH_HARNESS},gen_ai.operation.name=chat,gen_ai.request.model=${model},gen_ai.usage.input_tokens=${it},gen_ai.usage.output_tokens=${ot},gen_ai.usage.cache_read_input_tokens=${cr},gen_ai.usage.cache_creation_input_tokens=${cc},aeon.harness=${RH_HARNESS},aeon.cost_usd=${cost},aeon.component=${AEON_OTEL_COMPONENT:-harness}" \
    >/dev/null 2>&1 || true
}
