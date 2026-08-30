#!/usr/bin/env bash
# test_harness_envelope — coverage for harness-adapter/lib/envelope.sh.
#
# Unparseable adapter output is a failed run, never a schema-valid success
# envelope. These tests pin the diagnostic marker, exit status, and stdout
# withholding so malformed output cannot become a published deliverable.
#
# The marker is retained because .github/workflows/aeon.yml surfaces it in the
# step log alongside the normal failure diagnostics.
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
printf 'plain text' > "$RH_TMPDIR/a"; printf '{"error":"boom"}' > "$RH_TMPDIR/b"
printf 'two\nlines\n\n' > "$RH_TMPDIR/c"; printf '' > "$RH_TMPDIR/d"
printf 'unicode -> OK "quoted" \\back' > "$RH_TMPDIR/e"
for f in a b c d e; do
  out="$RH_TMPDIR/out-$f"; err="$RH_TMPDIR/err-$f"
  RH_HARNESS=vibe wrap_raw_output < "$RH_TMPDIR/$f" >"$out" 2>"$err"
  rc=$?
  [ $rc -eq 3 ] \
    && ok "wrap_raw_output exits 3 (case $f)" \
    || bad "wrap_raw_output exit (case $f): expected 3, got $rc"
  [ ! -s "$out" ] \
    && ok "wrap_raw_output withholds stdout (case $f)" \
    || bad "wrap_raw_output emitted stdout (case $f)"
done

grep -q 'rh-wrap-fallback:' "$RH_TMPDIR/err-a" \
  && ok "wrap_raw_output emits the rh-wrap-fallback marker on stderr" \
  || bad "wrap_raw_output emits the rh-wrap-fallback marker on stderr"
grep -q 'harness=vibe' "$RH_TMPDIR/err-a" \
  && ok "marker names the harness (RH_HARNESS)" \
  || bad "marker names the harness (RH_HARNESS)"
grep -q 'plain text' "$RH_TMPDIR/err-a" \
  && ok "raw output is retained in the diagnostic" \
  || bad "raw output is missing from the diagnostic"
RH_HARNESS= wrap_raw_output < "$RH_TMPDIR/a" >/dev/null 2>"$RH_TMPDIR/err-unknown"
rc=$?
[ $rc -eq 3 ] \
  && ok "wrap_raw_output exits 3 when RH_HARNESS is unset" \
  || bad "wrap_raw_output exit with unknown harness: expected 3, got $rc"
grep -q 'harness=unknown' "$RH_TMPDIR/err-unknown" \
  && ok "marker degrades to harness=unknown when RH_HARNESS is unset" \
  || bad "marker degrades to harness=unknown when RH_HARNESS is unset"

# ── run-harness rejects unparseable adapter output ───────────────────────────
HA="$RH_TMPDIR/ha"
cp -R "$ROOT/harness-adapter" "$HA"
printf 'echo "a plausible sounding answer"\n' > "$HA/adapters/stubtest.sh"
envout=$(echo "prompt" | bash "$HA/run-harness" stubtest --mode write --timeout 30 2>"$RH_TMPDIR/rh.err")
rc=$?
[ $rc -eq 3 ] \
  && ok "run-harness exits 3 on unparseable adapter output" \
  || bad "run-harness exit on unparseable output: expected 3, got $rc"
[ -z "$envout" ] \
  && ok "run-harness withholds unparseable adapter output" \
  || bad "run-harness emitted unparseable adapter output"
if [ -n "$envout" ] && printf '%s\n' "$envout" | validate_envelope; then
  bad "raw adapter output must not pass validate_envelope"
else
  ok "raw adapter output is not accepted as an envelope"
fi
grep -q 'rh-wrap-fallback:' "$RH_TMPDIR/rh.err" \
  && ok "marker reaches run-harness stderr" \
  || bad "marker reaches run-harness stderr"
echo "---"
[ $fail -eq 0 ] && echo "All harness envelope tests passed." || echo "FAILURES"
exit $fail
