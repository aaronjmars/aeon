#!/usr/bin/env bash
# test_harness_envelope — coverage for harness-adapter/lib/envelope.sh.
#
# The wrap_raw_output path had NO test, which is a large part of why it survived:
# it converts output an adapter could not parse into a schema-valid SUCCESS
# envelope, so the run goes green and the blob is published as the skill's
# deliverable. It is currently instrumented rather than fatal (see the comment on
# that function). These tests pin BOTH halves of that decision:
#
#   - the payload is wrapped exactly as before, so the instrumentation is
#     provably behaviour-preserving;
#   - the rh-wrap-fallback marker is emitted, because .github/workflows/aeon.yml
#     greps for it to raise the ::warning:: this whole measurement depends on.
#
# When the wrap is turned into a hard failure, the marker tests become exit-code
# tests and this file is where that change is asserted.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=harness-adapter/lib/envelope.sh
. "$ROOT/harness-adapter/lib/envelope.sh"

fail=0
ok(){ echo "ok   - $1"; }
bad(){ echo "FAIL - $1"; fail=1; }

RH_TMPDIR=$(mktemp -d "${TMPDIR:-/tmp}/envelope-test.XXXXXX")
export RH_TMPDIR
trap 'rm -rf "$RH_TMPDIR"' EXIT

# ── emit_envelope ────────────────────────────────────────────────────────────
OUT=$(emit_envelope "hello" 1 2 3 4)
[ "$(jq -r '.result' <<<"$OUT")" = "hello" ] \
  && ok "emit_envelope carries the result text" \
  || bad "emit_envelope carries the result text"
[ "$(jq -r '.usage.input_tokens' <<<"$OUT")" = "1" ] \
  && ok "emit_envelope carries the token counts" \
  || bad "emit_envelope carries the token counts"

# Non-numeric extractions must land as 0, not as a string that breaks the contract.
emit_envelope "x" "n/a" "" 3 4 | validate_envelope \
  && ok "emit_envelope coerces non-numeric usage back to 0" \
  || bad "emit_envelope coerces non-numeric usage back to 0"

# ── validate_envelope ────────────────────────────────────────────────────────
echo '{"result":"x","usage":{"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}' \
  | validate_envelope && ok "validate_envelope accepts a well-formed envelope" \
  || bad "validate_envelope accepts a well-formed envelope"

for bogus in '{"usage":{"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}' \
             '{"result":42,"usage":{"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}' \
             '{"result":"x","usage":{"input_tokens":"lots","output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}' \
             '{"result":"x"}' \
             'not json at all'; do
  if echo "$bogus" | validate_envelope 2>/dev/null; then
    bad "validate_envelope rejects: $(cut -c1-48 <<<"$bogus")"
  else
    ok "validate_envelope rejects: $(cut -c1-48 <<<"$bogus")"
  fi
done

# ── wrap_raw_output ──────────────────────────────────────────────────────────
# The payload must survive byte for byte. Compared against an inline copy of the
# pre-instrumentation implementation so a future edit to the wrap cannot silently
# change what gets published.
old_wrap(){ jq -Rsc '{result: ., usage: {input_tokens: 0, output_tokens: 0,
            cache_read_input_tokens: 0, cache_creation_input_tokens: 0}}'; }

printf 'plain text' > "$RH_TMPDIR/a"; printf '{"error":"boom"}' > "$RH_TMPDIR/b"
printf 'two\nlines\n\n' > "$RH_TMPDIR/c"; printf '' > "$RH_TMPDIR/d"
printf 'unicode -> OK "quoted" \\back' > "$RH_TMPDIR/e"
for f in a b c d e; do
  new=$(RH_HARNESS=vibe wrap_raw_output < "$RH_TMPDIR/$f" 2>"$RH_TMPDIR/err")
  [ "$new" = "$(old_wrap < "$RH_TMPDIR/$f")" ] \
    && ok "wrap_raw_output payload unchanged (case $f)" \
    || bad "wrap_raw_output payload unchanged (case $f)"
  echo "$new" | validate_envelope \
    || bad "wrap_raw_output output passes validate_envelope (case $f)"
done
ok "wrap_raw_output output passes validate_envelope (all cases)"

# The marker aeon.yml greps for, and the harness name it must carry.
grep -q 'rh-wrap-fallback:' "$RH_TMPDIR/err" \
  && ok "wrap_raw_output emits the rh-wrap-fallback marker on stderr" \
  || bad "wrap_raw_output emits the rh-wrap-fallback marker on stderr"
grep -q 'harness=vibe' "$RH_TMPDIR/err" \
  && ok "marker names the harness (RH_HARNESS)" \
  || bad "marker names the harness (RH_HARNESS)"
RH_HARNESS= wrap_raw_output < "$RH_TMPDIR/a" >/dev/null 2>"$RH_TMPDIR/err2"
grep -q 'harness=unknown' "$RH_TMPDIR/err2" \
  && ok "marker degrades to harness=unknown when RH_HARNESS is unset" \
  || bad "marker degrades to harness=unknown when RH_HARNESS is unset"
# The marker goes to stderr ONLY — stdout is the envelope and nothing else.
grep -q 'rh-wrap-fallback' <<<"$(wrap_raw_output < "$RH_TMPDIR/a" 2>/dev/null)" \
  && bad "marker must not leak into stdout" \
  || ok "marker stays on stderr, never in the envelope"

# ── the whole point: run-harness still exits 0 on unparseable output ──────────
# Pinned deliberately. When this becomes a hard failure, flip this assertion to
# expect exit 3 and drop the `exit 0` at the four wrap_raw_output call sites.
HA="$RH_TMPDIR/ha"
cp -R "$ROOT/harness-adapter" "$HA"
printf 'echo "a plausible sounding answer"\n' > "$HA/adapters/stubtest.sh"
envout=$(echo "prompt" | bash "$HA/run-harness" stubtest --mode write --timeout 30 2>"$RH_TMPDIR/rh.err")
rc=$?
[ $rc -eq 0 ] \
  && ok "run-harness still exits 0 on unparseable adapter output (measurement phase)" \
  || bad "run-harness exit on unparseable output: expected 0 during measurement, got $rc"
echo "$envout" | validate_envelope \
  && ok "the wrapped junk passes the envelope contract (this is the bug being measured)" \
  || bad "wrapped output failed validate_envelope"
grep -q 'rh-wrap-fallback:' "$RH_TMPDIR/rh.err" \
  && ok "marker reaches run-harness stderr, where aeon.yml greps for it" \
  || bad "marker reaches run-harness stderr"

echo "---"
[ $fail -eq 0 ] && echo "All harness envelope tests passed." || echo "FAILURES"
exit $fail
