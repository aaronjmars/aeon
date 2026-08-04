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
#
# This script decides the TIER. It is not, by itself, the enforcement — see
# docs/CAPABILITIES.md for the full picture. The allowedTools string below is one
# of three layers: the tier also reaches `run-harness --mode`, which write-locks
# the workspace with an OS sandbox (harness-adapter/lib/sandbox.sh) on every
# harness, and a post-run guard in the workflow reverts anything that still
# landed. The allowlist alone was never sufficient — a shell redirection routes
# around it, and only claude and pi consume it at all.
#
# Usage:
#   scripts/skill_mode.sh mode <skill-name>     -> prints read-only | write
#   scripts/skill_mode.sh allowed-tools <mode>  -> prints the --allowedTools string
#   scripts/skill_mode.sh grok-run-env <skill>  -> prints `export GROK_*=…` lines
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
# Foundry bare-names + the key-safe runner for deploy-uni-hook. Foundry is staged by
# scripts/stage-deploy-uni-hook.sh (the sandbox denies in-run installs); the skill then
# builds/simulates/broadcasts by bare name. `./hook-deploy.sh` hides the deployer key
# from the command line (secretcurl pattern). Without this grant the invocation is denied.
WRITE_TOOLS="$WRITE_TOOLS,Bash(forge:*),Bash(cast:*),Bash(./hook-deploy.sh:*)"

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

# --- Why there is no grok permission mapping here ---------------------------
# There used to be a `grok-args` subcommand that emitted grok's own permission
# grammar (`--allow 'Bash(git *)'` rules plus `--sandbox read-only`) as this
# script's grok-side mirror of allowedTools. It is DELETED, not merely unused,
# and it should not come back in that shape — both halves of it were wrong:
#
#   * The `--allow` rules never gated anything. grok aborts its ENTIRE turn on a
#     denied tool (stopReason=Cancelled) rather than degrading, and skills are
#     authored for Claude Code, so they reach for tools no allowlist predicted.
#     harness-adapter/adapters/grok.sh therefore runs --permission-mode
#     bypassPermissions and carries NO allowlist and NO --deny rules, on purpose.
#   * grok's own `--sandbox read-only` is silently ignored on grok 0.2.101 (writes
#     still land) and nest-conflicts with the wrapper sandbox.
#
# So read-only on grok — as on all six harnesses — is enforced by the dispatcher's
# OS sandbox (harness-adapter/lib/sandbox.sh: bwrap / sandbox-exec write-locks the
# workspace) plus the workflow's post-run revert. Nothing about that is expressible
# in this file, which is why the mapping is gone instead of rewritten.

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
    n!=1{next}
    /^[^ \t]/{inmeta=0}
    /^metadata:/{inmeta=1}
    # legacy top-level scalar, or the Agent Skills spec form nested under metadata:
    $0 ~ "^"k":" || (inmeta && $0 ~ "^[ \t]+"k":") {
      v=$0; sub("^[ \t]*"k":[ \t]*","",v); sub(/[ \t]*#.*$/,"",v);
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
  grok-run-env)  grok_run_env "${2:?skill name required}" ;;
  *) echo "usage: skill_mode.sh {mode <skill>|allowed-tools <mode>|grok-run-env <skill>}" >&2; exit 2 ;;
esac
