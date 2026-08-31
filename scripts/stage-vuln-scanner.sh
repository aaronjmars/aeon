#!/usr/bin/env bash
# Stage the vuln-scanner skill's scanner binaries in the WORKFLOW step, before
# `claude -p` starts. This is purpose-built binary staging — NOT a network
# workaround (there is no network sandbox; `curl` reaches the network fine).
#
# Two real reasons this belongs in a workflow step rather than in-run:
#
#   1. PATH persistence. Claude runs each Bash tool call in a FRESH shell, so an
#      in-run `export PATH=/tmp/bin:$PATH` is gone by the next call — leaving
#      /tmp/bin-only binaries (trufflehog, osv-scanner) unresolvable by bare
#      name. Only a workflow step can append to $GITHUB_PATH, which makes
#      /tmp/bin part of PATH for every SUBSEQUENT step — including `claude -p`
#      and all the Bash subprocesses it spawns — so bare names resolve.
#      (semgrep/slither dodge this only because pip puts them on the global PATH.)
#   2. Install vectors. `pip` (bare) and `curl | sh` aren't on the `claude -p`
#      --allowedTools allowlist, so installing here (full capability, no
#      allowlist) is simplest. `python3 -m pip` / `curl -o` ARE allowlisted, so
#      the skill keeps an in-run install as a fallback when this step is absent.
#
# EXECUTION of the staged tools is a separate concern, gated by the write-tier
# grant in scripts/skill_mode.sh (Bash(semgrep:*) etc.). Both halves are needed:
# staged + on PATH here, allowlisted there.
#
# No-ops for every skill except vuln-scanner. Best-effort: a tool that fails to
# install is recorded `fail` and left for the skill to skip via its `command -v`
# guard; a non-zero exit is non-fatal (the workflow step does not gate the run).
set -uo pipefail

SKILL="${1:-}"
[ "$SKILL" = "vuln-scanner" ] || exit 0

BIN=/tmp/bin
mkdir -p "$BIN" /tmp/vuln-scan
MANIFEST=/tmp/vuln-scan/prefetch.txt
: > "$MANIFEST"

# Make /tmp/bin resolvable by bare name in every later step (see reason #1 above).
# Guarded so it no-ops outside GitHub Actions.
[ -n "${GITHUB_PATH:-}" ] && echo "$BIN" >> "$GITHUB_PATH"

log()    { echo "stage-vuln-scanner: $*"; }
record() { echo "$1=$2" >> "$MANIFEST"; }   # tool=installed|fail|skipped

# Keep machine-readable evidence that the agent actually invoked a scanner. The
# post-run workflow check reads this file; model prose is not execution evidence.
EXEC_LOG=/tmp/vuln-scan/executions.log
: > "$EXEC_LOG"
POC_EXEC_LOG=/tmp/vuln-scan/poc-executions.log
: > "$POC_EXEC_LOG"

instrument() { # command name, real executable
  local name="$1" real="$2" wrapper="$BIN/$1"
  [ -x "$real" ] || return 0
  mv "$real" "$BIN/.${name}.real" 2>/dev/null || return 0
  rm -f "$wrapper"   # drop any dangling symlink so the heredoc writes a plain file into $BIN
  cat > "$wrapper" <<EOF
#!/usr/bin/env bash
printf '%s %s\\n' '$name' "\$*" >> '$EXEC_LOG'
exec '$BIN/.${name}.real' "\$@"
EOF
  chmod +x "$wrapper"
}

instrument_redacted() { # command name, real executable, fixed evidence label
  local name="$1" real="$2" label="$3" wrapper="$BIN/$1"
  [ -x "$real" ] || return 0
  cat > "$wrapper" <<EOF
#!/usr/bin/env bash
printf '%s %s\n' '$name' '$label' >> '$EXEC_LOG'
exec '$real' "\$@"
EOF
  chmod +x "$wrapper"
}

pip_install() { # package
  pip install --quiet "$1" 2>/dev/null \
    || pip3 install --quiet "$1" 2>/dev/null \
    || pip install --quiet --user "$1" 2>/dev/null \
    || pip3 install --quiet --user "$1" 2>/dev/null
}

# --- Semgrep (SAST). Skill calls it bare, so it must be on PATH; symlink into
#     /tmp/bin as belt-and-suspenders in case pip's bin dir isn't on PATH. ---
if command -v semgrep >/dev/null 2>&1; then
  log "semgrep already present ($(command -v semgrep))"
  record semgrep installed
elif pip_install semgrep && command -v semgrep >/dev/null 2>&1; then
  ln -sf "$(command -v semgrep)" "$BIN/semgrep" 2>/dev/null || true
  log "semgrep installed ($(semgrep --version 2>/dev/null | head -1))"
  record semgrep installed
else
  log "WARN semgrep install failed"
  record semgrep fail
fi

# --- TruffleHog (verified-secret scan) -> /tmp/bin ---
if curl -sSfL https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/scripts/install.sh \
     | sh -s -- -b "$BIN" >/dev/null 2>&1 && [ -x "$BIN/trufflehog" ]; then
  log "trufflehog installed -> $BIN/trufflehog ($("$BIN/trufflehog" --version 2>&1 | head -1))"
  record trufflehog installed
else
  log "WARN trufflehog install failed"
  record trufflehog fail
fi

# --- osv-scanner (dependency CVEs). GHA hosted runners are linux/amd64. ---
OSV_URL="https://github.com/google/osv-scanner/releases/latest/download/osv-scanner_linux_amd64"
if curl -sSfL -o "$BIN/osv-scanner" "$OSV_URL" 2>/dev/null \
     && chmod +x "$BIN/osv-scanner" \
     && "$BIN/osv-scanner" --version >/dev/null 2>&1; then
  log "osv-scanner installed -> $BIN/osv-scanner"
  record osv-scanner installed
else
  log "WARN osv-scanner install failed"
  record osv-scanner fail
fi

# --- Slither (Solidity SAST) — optional; only needed when the target has *.sol.
#     Don't fail the staging if it can't install. ---
if command -v slither >/dev/null 2>&1; then
  ln -sf "$(command -v slither)" "$BIN/slither" 2>/dev/null || true
  record slither installed
elif pip_install slither-analyzer && command -v slither >/dev/null 2>&1; then
  ln -sf "$(command -v slither)" "$BIN/slither" 2>/dev/null || true
  log "slither installed ($(slither --version 2>/dev/null | head -1))"
  record slither installed
else
  log "slither not installed (optional — only used for Solidity repos)"
  record slither skipped
fi

# --- cargo-fuzz (dynamic testing, A3.5) — only useful when the cloned repo
#     already ships its own fuzz/fuzz_targets, but we don't know the target yet
#     at staging time (Arm A picks it after this step runs). Stage it always,
#     same tolerance as slither above: unconditional install, conditional use.
#     GHA hosted runners already have stable Rust; this only adds nightly
#     (cargo-fuzz needs it for sanitizer support) + the cargo-fuzz binary.
if command -v cargo-fuzz >/dev/null 2>&1; then
  log "cargo-fuzz already present"
  record cargo-fuzz installed
elif rustup toolchain install nightly --profile minimal >/dev/null 2>&1 \
     && cargo install cargo-fuzz --locked >/dev/null 2>&1 \
     && command -v cargo-fuzz >/dev/null 2>&1; then
  log "cargo-fuzz installed ($(cargo-fuzz --version 2>/dev/null | head -1))"
  record cargo-fuzz installed
else
  log "cargo-fuzz not installed (optional — only used for repos shipping fuzz/fuzz_targets)"
  record cargo-fuzz skipped
fi

# Wrap staged binaries after installation so every actual invocation is recorded.
instrument semgrep "$(command -v semgrep 2>/dev/null || true)"
instrument trufflehog "$BIN/trufflehog"
instrument osv-scanner "$BIN/osv-scanner"
instrument slither "$(command -v slither 2>/dev/null || true)"
instrument cargo-fuzz "$(command -v cargo-fuzz 2>/dev/null || true)"
# Keep private finding paths, test names, and fork arguments out of the public
# workflow evidence log. The gate's redacted result proves whether the PoC ran.
if command -v forge >/dev/null 2>&1; then
  instrument_redacted forge "$(command -v forge)" '[redacted]'
  record forge installed
else
  record forge fail
fi

log "manifest (/tmp/vuln-scan/prefetch.txt):"
cat "$MANIFEST"
