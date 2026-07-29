# envelope.sh — emit/validate the Claude Code-compatible JSON envelope.
#
# The contract every adapter must satisfy on stdout:
#   { "result": "<text>",
#     "usage": { "input_tokens": N, "output_tokens": N,
#                "cache_read_input_tokens": N, "cache_creation_input_tokens": N },
#     "session_id": "<optional>", "total_cost_usd": <optional> }
# Diagnostics go to stderr. Exit 0 on success; non-zero on failure; an abnormal
# model stop with no output must FAIL, never emit partial-as-success.

emit_envelope() {
  # emit_envelope RESULT INPUT OUTPUT CACHE_READ CACHE_CREATION [COST] [SESSION_ID]
  local result="$1" tin="${2:-0}" tout="${3:-0}" tcr="${4:-0}" tcc="${5:-0}" cost="${6:-}" sid="${7:-}"
  local n
  for n in tin tout tcr tcc; do   # guard non-numeric extractions back to 0
    case "${!n}" in ''|*[!0-9]*) printf -v "$n" 0 ;; esac
  done
  jq -cn --arg result "$result" \
    --argjson tin "$tin" --argjson tout "$tout" --argjson tcr "$tcr" --argjson tcc "$tcc" \
    --arg cost "$cost" --arg sid "$sid" '
    {result: $result,
     usage: {input_tokens: $tin, output_tokens: $tout,
             cache_read_input_tokens: $tcr, cache_creation_input_tokens: $tcc}}
    + (if $sid != "" then {session_id: $sid} else {} end)
    + (if ($cost != "") and ($cost | test("^[0-9]+(\\.[0-9]+)?$")) then {total_cost_usd: ($cost | tonumber)} else {} end)'
}

validate_envelope() {
  # reads an envelope on stdin; exit 0 iff it satisfies the contract
  jq -e '
    type == "object"
    and (.result | type == "string")
    and (.usage | type == "object")
    and ([.usage.input_tokens, .usage.output_tokens,
          .usage.cache_read_input_tokens, .usage.cache_creation_input_tokens]
         | all(type == "number"))' >/dev/null
}

wrap_raw_output() {
  # last-resort fallback: wrap arbitrary stdout as a best-effort envelope, so a
  # shape change never silently looks like "no output" (pattern from aeon's run-grok.sh)
  #
  # UNDER MEASUREMENT (2026-07-29) - this contradicts the contract at the top of
  # this file. It turns output the adapter could not parse into a schema-valid
  # SUCCESS envelope, and all four callers then exit 0. The run goes green and the
  # wrapped blob is published as the skill's deliverable (aeon.yml "Capture skill
  # output" -> output/.chains/<skill>.md), which chained skills consume and the
  # health scorer grades. Its 0/0/0/0 usage is also indistinguishable from a real
  # cheap run in memory/token-usage.csv.
  #
  # validate_envelope structurally cannot catch this: the object emitted below is
  # exactly the shape that function checks (.result string + four numeric counts).
  #
  # The correct behaviour is `exit 3` (abnormal stop), and the workflow's failure
  # path for it already exists and works - aeon.yml emits ::error::, writes
  # /tmp/skill-error.txt and exits 1, and the `outcome == 'success'` gate then
  # withholds the output. Flipping it is deferred only because nothing measured
  # how often this fires, so the blast radius across a live fleet was unknown.
  #
  # So: identical behaviour, now COUNTABLE. The marker below reaches the workflow
  # through the harness stderr tail, which promotes it to a ::warning::. Once
  # there is a real number, replace this body with a diagnostic + `exit 3` and
  # drop the `exit 0` at each call site.
  local buf="${RH_TMPDIR:-${TMPDIR:-/tmp}}/wrap-raw-$$.txt"
  cat > "$buf"
  echo "rh-wrap-fallback: harness=${RH_HARNESS:-unknown} bytes=$(wc -c < "$buf" | tr -d ' '); unparseable harness output wrapped as SUCCESS, so this run reports green but its output may be junk" >&2
  jq -Rsc '{result: ., usage: {input_tokens: 0, output_tokens: 0,
            cache_read_input_tokens: 0, cache_creation_input_tokens: 0}}' < "$buf"
}
