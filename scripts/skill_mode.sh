#!/usr/bin/env bash
# skill_mode — capability tier resolution for a skill run (hardening §6).
#
# Two axes of capability: network (egress:, future proxy) and *write* (this).
# A skill declares its write tier in SKILL.md frontmatter:
#     mode: read-only      # may read repo + fetch web + notify; may NOT mutate the repo
#     mode: write          # full access (default, current behaviour)
#
# Default is `write` for backward compatibility: most skills legitimately write
# (create-skill, article, reflect…), so read-only is opt-in per SKILL.md.
# Enforcement is by allowedTools:
# read-only drops Write,Edit,Bash(git:*),Bash(gh:*) so the skill physically can't
# commit/push/edit. A post-run guard in the workflow reverts any stray writes that
# slipped through redirections, as defense-in-depth.
#
# Usage:
#   scripts/skill_mode.sh mode <skill-name>     -> prints read-only | write
#   scripts/skill_mode.sh allowed-tools <mode>  -> prints the --allowedTools string
#   scripts/skill_mode.sh grok-args <mode>      -> prints grok CLI permission flags,
#                                                  one argv token per line (for the
#                                                  Grok Build harness; see run-grok.sh)
set -euo pipefail

# Tools every tier gets: read, search, notify, and read-only/local shell helpers.
# curl stays (network is the *other* axis, governed by egress:, not by mode).
#
# NOTE: `gh` is intentionally NOT in the read-only base — even `gh api` GET reads are
# excluded, because `gh` is also a write vector (issue/PR/commit/dispatch) and the tool
# grammar is coarse (Bash(gh:*) is all-or-nothing). A read-only skill that needs GitHub
# data should fetch it with WebFetch/curl against api.github.com, or stay `mode: write`.
# (Known degraders today: github-trending + security-digest use `gh api` only as a
# fallback behind a WebFetch/curl primary, so they degrade gracefully, not break.)
BASE_TOOLS="Read,Glob,Grep,WebFetch,WebSearch"
BASE_TOOLS="$BASE_TOOLS,Bash(curl:*),Bash(jq:*)"
BASE_TOOLS="$BASE_TOOLS,Bash(./notify:*),Bash(./notify-jsonrender:*),Bash(./secretcurl:*)"
BASE_TOOLS="$BASE_TOOLS,Bash(mkdir:*),Bash(ls:*),Bash(cat:*),Bash(chmod:*)"
BASE_TOOLS="$BASE_TOOLS,Bash(date:*),Bash(echo:*),Bash(node:*),Bash(npm:*),Bash(npx:*)"
BASE_TOOLS="$BASE_TOOLS,Bash(head:*),Bash(tail:*),Bash(wc:*),Bash(sort:*),Bash(grep:*)"

# Write tier additionally gets repo-mutation tools + python (an interpreter is itself
# a write vector, so it stays out of the read-only base; skills' python helpers run here).
WRITE_TOOLS="Write,Edit,Bash(gh:*),Bash(git:*),Bash(python3:*),Bash(python:*)"
# Security-scanner bare-names for vuln-scanner (Arm A). The skill stages these in-run
# (`python3 -m pip install` for semgrep/slither, `curl -o … && chmod +x` for the Go
# binaries) and invokes them by bare name. Without this grant `claude -p` denies the
# invocation ("requires approval") and the scan arm silently degrades to manual review —
# a live-test showed the run logging that denial as "Blocked by sandbox". These are
# read-only static-analysis tools (no repo/network mutation of their own).
WRITE_TOOLS="$WRITE_TOOLS,Bash(semgrep:*),Bash(osv-scanner:*),Bash(trufflehog:*),Bash(slither:*)"

resolve_mode() {
  # `mode:` frontmatter scalar via the shared _fm reader (strips inline comment,
  # quotes, and surrounding ws); absent file/field -> "" -> the write default.
  local m
  m=$(_fm "$1" mode)
  case "$m" in
    read-only|readonly|read_only) echo "read-only" ;;
    write|"")                     echo "write" ;;
    *) echo "write" ;;  # unknown value -> safe default, never silently over-restrict
  esac
}

# Write tier = base tools + the repo-mutation tools.
write_tools() { echo "$BASE_TOOLS,$WRITE_TOOLS"; }

# --- Grok Build harness permission mapping ----------------------------------
# The grok CLI uses a DIFFERENT permission grammar from Claude Code's
# --allowedTools: `--allow`/`--deny` rules over categories
# Bash/Edit/Read/Grep/Write/MCPTool/WebFetch, plus a `--permission-mode`.
# Bash rules use a space-glob — `Bash(git *)` — not Claude's colon `Bash(git:*)`.
#
# Permission mode: we pass `--permission-mode bypassPermissions` — the ONE mode
# grok actually wires headlessly (per grok's permissions docs + our testing). It
# APPROVES every tool call instead of refusing ones we didn't explicitly allowlist.
# That is deliberate and load-bearing: skills are authored for Claude Code and WILL
# reach for tools we never pre-listed (a `gh api` read, a Claude built-in). Under
# the old refuse-a-non-allowlisted-tool behavior (headless `dontAsk`), grok aborted
# the ENTIRE turn — stopReason=Cancelled, empty/partial output — which is exactly
# how Claude-authored skills failed on grok. Approving-all makes grok DEGRADE like
# Claude (a missing/failed tool returns an error the model routes around) instead
# of Cancelling. Paired with the --rules compat preamble in run-grok.sh.
#
# Consequence: the `--allow` rules below are now ADVISORY (additive grants, redundant
# under bypass) — kept only to document each tier's intended capability, NOT as the
# guard. The REAL guarantee that a read-only skill can't mutate is grok's OS-level
# `--sandbox read-only` profile (added below) plus the workflow's post-run stray-write
# revert. NEVER add `--deny` rules here: a denied tool can re-trigger the very
# turn-abort we are removing.
#
# We still mirror the SAME capability intent as BASE_TOOLS / WRITE_TOOLS above, so
# the intent reads identically on either harness: read-only documents no Edit and no
# git/gh/python; write adds them.
#
# Output: one argv token per line, so a caller can read it with
#   mapfile -t GROK_ARGS < <(skill_mode.sh grok-args "$MODE")
# and pass "${GROK_ARGS[@]}" straight through (a Bash rule's embedded space is
# preserved because each whole line becomes one array element).
#
# ORPHANED as of the run-path consolidation: `run-grok.sh` was the only consumer,
# and harness-adapter/adapters/grok.sh maps capability mode differently
# (--permission-mode bypassPermissions plus the dispatcher's OS sandbox, because
# a denied tool aborts grok's whole turn). Nothing calls `grok-args` today. It is
# kept, not deleted, because removing it means settling what grok's read-only
# enforcement should actually be — see docs/CAPABILITIES.md, which still
# describes THIS allowlist as the mechanism.

# Bash command globs allowed on every tier (mirror BASE_TOOLS' Bash(...:*) set).
GROK_BASE_BASH="curl jq ./notify ./notify-jsonrender mkdir ls cat chmod date echo node npm npx head tail wc sort grep"
# Additional Bash command globs for the write tier (mirror WRITE_TOOLS).
GROK_WRITE_BASH="gh git python3 python semgrep osv-scanner trufflehog slither"

grok_args() {
  local mode="$1"
  # bypassPermissions = approve every tool call (the one mode grok wires headlessly),
  # so a Claude-authored skill reaching for a non-allowlisted tool degrades instead of
  # Cancelling the turn. The allow rules below are advisory; --sandbox + the post-run
  # revert are the read-only guard. See the block comment above.
  printf '%s\n' --permission-mode bypassPermissions
  if [ "$mode" = "read-only" ]; then
    printf '%s\n' --sandbox read-only
  fi
  # Advisory grants (redundant under bypass) that document each tier's capability:
  # read/search/web everywhere; Edit + git/gh/python added on the write tier below.
  printf '%s\n' --allow Read --allow Grep --allow WebFetch
  local cmd
  for cmd in $GROK_BASE_BASH; do printf '%s\n' --allow "Bash($cmd *)"; done
  if [ "$mode" != "read-only" ]; then
    printf '%s\n' --allow Edit
    for cmd in $GROK_WRITE_BASH; do printf '%s\n' --allow "Bash($cmd *)"; done
  fi
}

# --- Grok Build run-shaping: frontmatter -> GROK_* env -----------------------
# Map optional per-skill frontmatter to the env vars harness-adapter's grok
# adapter reads, so a
# skill can opt into grok's newer headless features without any workflow change:
#
#   effort: high            # low|medium|high|xhigh|max  -> --effort
#   reasoning_effort: high  # same set                   -> --reasoning-effort
#   max_turns: 60           # agentic-turn cap           -> --max-turns
#   best_of_n: 3            # run N ways, keep the best   -> --best-of-n
#   verify: true            # append a self-check loop    -> --check
#
# Output is `export GROK_X=...` lines for exactly the fields present, so unset
# fields fall through to the adapter's defaults. aeon.yml's grok branch evals this.
# (This note used to reserve GROK_JSON_SCHEMA for the scorer. The scorer never
# set it and now goes schema-less deliberately, so the knob is gone.)
# read one frontmatter scalar (first '---' block), stripping inline # comment,
# quotes and surrounding whitespace. Prints nothing if absent.
_fm() {
  local skill="$1" key="$2" f="skills/$1/SKILL.md"
  [ -f "$f" ] || return 0
  awk -v k="$key" '
    /^---$/{n++; next}
    n==1 && $0 ~ "^"k":" {
      v=$0; sub("^"k":[ \t]*","",v); sub(/[ \t]*#.*$/,"",v);
      gsub(/^[ \t"'"'"']+|[ \t"'"'"']+$/,"",v); print v; exit
    }' "$f"
}
grok_run_env() {
  local skill="$1" v
  v=$(_fm "$skill" effort);           [ -n "$v" ] && printf 'export GROK_EFFORT=%q\n' "$v"
  v=$(_fm "$skill" reasoning_effort); [ -n "$v" ] && printf 'export GROK_REASONING_EFFORT=%q\n' "$v"
  v=$(_fm "$skill" max_turns);        [ -n "$v" ] && printf 'export GROK_MAX_TURNS=%q\n' "$v"
  v=$(_fm "$skill" best_of_n);        [ -n "$v" ] && printf 'export GROK_BEST_OF_N=%q\n' "$v"
  v=$(_fm "$skill" verify);           [ -n "$v" ] && printf 'export GROK_CHECK=%q\n' "$v"
}

case "${1:-}" in
  mode)          resolve_mode "${2:?skill name required}" ;;
  allowed-tools)
    case "${2:-write}" in
      read-only|readonly|read_only) echo "$BASE_TOOLS" ;;
      *)                            write_tools ;;
    esac ;;
  grok-args)
    case "${2:-write}" in
      read-only|readonly|read_only) grok_args read-only ;;
      *)                            grok_args write ;;
    esac ;;
  grok-run-env)  grok_run_env "${2:?skill name required}" ;;
  *) echo "usage: skill_mode.sh {mode <skill>|allowed-tools <mode>|grok-args <mode>|grok-run-env <skill>}" >&2; exit 2 ;;
esac
