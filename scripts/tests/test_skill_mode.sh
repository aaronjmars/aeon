#!/usr/bin/env bash
# Tests for scripts/skill_mode.sh. Run: bash scripts/tests/test_skill_mode.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
M="scripts/skill_mode.sh"
fail=0
pass() { echo "ok   - $1"; }
bad()  { echo "FAIL - $1"; fail=1; }

# Fixtures live under real skills/ so resolve_mode finds them; use temp names + cleanup.
mk() { mkdir -p "skills/$1"; printf '%s\n' "---" "name: $1" "${2:-}" "---" "body" > "skills/$1/SKILL.md"; }
RO="zzz-test-readonly-$$"; WR="zzz-test-write-$$"; NM="zzz-test-nomode-$$"; BAD="zzz-test-bad-$$"; CMT="zzz-test-comment-$$"
cleanup() { rm -rf "skills/$RO" "skills/$WR" "skills/$NM" "skills/$BAD" "skills/$CMT"; }
trap cleanup EXIT
mk "$RO" "mode: read-only"
mk "$WR" "mode: write"
mk "$NM" ""
mk "$BAD" "mode: banana"
mk "$CMT" "mode: read-only   # with an inline comment and trailing space   "

# mode resolution
[ "$(bash "$M" mode "$RO")"  = "read-only" ] && pass "declared read-only resolves" || bad "declared read-only resolves"
[ "$(bash "$M" mode "$CMT")" = "read-only" ] && pass "read-only with inline comment resolves" || bad "read-only with inline comment resolves"
[ "$(bash "$M" mode "$WR")"  = "write" ]     && pass "declared write resolves"     || bad "declared write resolves"
[ "$(bash "$M" mode "$NM")"  = "write" ]     && pass "no mode defaults to write"   || bad "no mode defaults to write"
[ "$(bash "$M" mode "$BAD")" = "write" ]     && pass "unknown mode falls back to write" || bad "unknown mode falls back to write"
[ "$(bash "$M" mode "nonexistent-skill-xyz")" = "write" ] && pass "missing skill defaults to write" || bad "missing skill defaults to write"

# allowed-tools: write tier has the mutation tools
WT=$(bash "$M" allowed-tools write)
echo "$WT" | grep -q "Write" && echo "$WT" | grep -q "Edit" \
  && echo "$WT" | grep -q "Bash(git:\*)" && echo "$WT" | grep -q "Bash(gh:\*)" \
  && pass "write tier includes Write/Edit/git/gh" || bad "write tier includes Write/Edit/git/gh"

# allowed-tools: read-only tier drops mutation tools but keeps read+notify+curl
RT=$(bash "$M" allowed-tools read-only)
if echo "$RT" | grep -q "Write" || echo "$RT" | grep -q "Edit" \
   || echo "$RT" | grep -q "Bash(git:\*)" || echo "$RT" | grep -q "Bash(gh:\*)"; then
  bad "read-only tier drops Write/Edit/git/gh"
else
  pass "read-only tier drops Write/Edit/git/gh"
fi
echo "$RT" | grep -q "Read" && echo "$RT" | grep -q "WebFetch" \
  && echo "$RT" | grep -q "Bash(curl:\*)" && echo "$RT" | grep -q "Bash(./notify:\*)" \
  && pass "read-only tier keeps read/web/curl/notify" || bad "read-only tier keeps read/web/curl/notify"

# allowed-tools: cd is granted in both tiers (a cd-prefixed multi-step Bash
# call was silently denied in full otherwise, even when every real command
# after the cd was itself allowlisted — see the comment in skill_mode.sh).
echo "$WT" | grep -q "Bash(cd:\*)" && pass "write tier includes cd" || bad "write tier includes cd"
echo "$RT" | grep -q "Bash(cd:\*)" && pass "read-only tier includes cd" || bad "read-only tier includes cd"

# grok-args is DELETED and must stay deleted. It emitted grok `--allow` rules that
# never gated anything (adapters/grok.sh runs --permission-mode bypassPermissions,
# because a denied tool aborts grok's whole turn) plus grok's own
# `--sandbox read-only`, which grok 0.2.101 silently ignores. Read-only on grok is
# the dispatcher's OS sandbox. A resurrected subcommand would re-document a guard
# that does not exist, so an unknown subcommand must fail loudly, not print flags.
if bash "$M" grok-args read-only >/dev/null 2>&1; then
  bad "grok-args should be gone — read-only on grok is the wrapper OS sandbox, not an allowlist"
else
  pass "grok-args rejected (removed with the run-grok.sh run path)"
fi
# (capture first, then grep: `set -o pipefail` above would otherwise surface the
# script's own exit 2 as the pipeline's status and mask a passing grep)
USAGE=$(bash "$M" grok-args read-only 2>&1 >/dev/null)
case "$USAGE" in
  *usage:*grok-args*) bad "usage line still advertises grok-args" ;;
  *usage:*)           pass "unknown subcommand prints usage on stderr, without grok-args" ;;
  *)                  bad "unknown subcommand should print usage (got: $USAGE)" ;;
esac

# grok-run-env: frontmatter run-knobs → export GROK_* lines
FX="zzz-test-fx-$$"
mkdir -p "skills/$FX"
printf '%s\n' "---" "name: $FX" "mode: write" "effort: high" "max_turns: 60" "best_of_n: 3" "verify: true" "---" "body" > "skills/$FX/SKILL.md"
cleanup_fx() { rm -rf "skills/$FX"; }
trap 'cleanup; cleanup_fx' EXIT
GE=$(bash "$M" grok-run-env "$FX")
echo "$GE" | grep -qx "export GROK_EFFORT=high"  && pass "grok-run-env maps effort"    || bad "grok-run-env effort ($GE)"
echo "$GE" | grep -qx "export GROK_MAX_TURNS=60" && pass "grok-run-env maps max_turns" || bad "grok-run-env max_turns ($GE)"
echo "$GE" | grep -qx "export GROK_BEST_OF_N=3"  && pass "grok-run-env maps best_of_n" || bad "grok-run-env best_of_n ($GE)"
echo "$GE" | grep -qx "export GROK_CHECK=true"   && pass "grok-run-env maps verify→CHECK" || bad "grok-run-env verify ($GE)"
# A skill with none of these fields emits nothing (falls through to defaults)
GE2=$(bash "$M" grok-run-env "$WR")
[ -z "$GE2" ] && pass "grok-run-env empty when no run-knobs" || bad "grok-run-env should be empty for plain skill ($GE2)"
# eval-safety: output is valid shell that sets exactly those vars
( eval "$GE"; [ "$GROK_EFFORT" = high ] && [ "$GROK_MAX_TURNS" = 60 ]; ) \
  && pass "grok-run-env output is eval-safe" || bad "grok-run-env output not eval-safe"

echo "---"
[ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
