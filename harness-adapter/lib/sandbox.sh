# sandbox.sh — wrapper-level OS sandbox for uniform read-only enforcement.
#
# No harness enforces read-only usefully on its own. codex's native sandbox works
# but also kills the network; grok's --sandbox read-only is silently ignored on
# 0.2.101 (writes still land); pi, vibe and kimi ship no filesystem sandbox at
# all; and claude's --allowedTools is sidestepped by a shell redirection.
# So for read-only runs the DISPATCHER applies its own sandbox around whatever
# harness runs: the workspace (cwd) becomes unwritable, everything else stays
# usable (harnesses need to write their own state under $HOME and $TMPDIR, and
# the network stays open — read-only is about the repo, not egress).
# This mirrors aeon's semantic: "a read-only skill physically cannot mutate the
# repo" — and makes it mean the same thing on all seven harnesses.

sandbox_prefix() {
  # sandbox_prefix TMPDIR [EXPANDED_MCP] -> prints prefix argv tokens (one per
  # line), or returns 1 if no OS sandbox is available on this machine.
  #
  # EXPANDED_MCP (optional) is the ${VAR}-expanded .mcp.json run-harness built.
  # When the workspace also carries a literal `.mcp.json`, that file is overlaid
  # with the expanded copy for the duration of the run. Reason: several harnesses
  # AUTO-DISCOVER `<cwd>/.mcp.json` and that discovery WINS over the config the
  # adapter stages. kimi is the measured case — with a project .mcp.json present
  # it sent `Authorization: Bearer ${MCP_GLIM_TOKEN}` verbatim (the literal, not
  # the value) and silently ignored the expanded copy in $KIMI_CODE_HOME; against
  # a real server that is a 401, so the agent falls back to raw curl and reports
  # the MCP server as "not connected". Overlaying at the sandbox layer fixes it
  # for every harness at once without writing a secret into the working tree
  # (the bind is process-private and vanishes with the sandbox).
  local tmp="$1" mcp="${2:-}" ws
  ws="$(pwd -P)"
  case "$(uname -s)" in
    Darwin)
      # No bind-mounts here, so the EXPANDED_MCP overlay is a Linux-only fix.
      # aeon runs on ubuntu runners; on macOS a harness that auto-discovers
      # `<cwd>/.mcp.json` still sees the literal ${VAR}s.
      command -v sandbox-exec >/dev/null 2>&1 || return 1
      local profile="$tmp/readonly-workspace.sb"
      cat > "$profile" <<EOF
(version 1)
(allow default)
(deny file-write* (subpath "$ws"))
EOF
      printf '%s\n' sandbox-exec -f "$profile"
      ;;
    Linux)
      command -v bwrap >/dev/null 2>&1 || return 1
      # bind everything rw, then overlay the workspace read-only
      printf '%s\n' bwrap --dev-bind / / --ro-bind "$ws" "$ws"
      # ...then layer the expanded config over the literal one. Order matters:
      # bwrap applies binds left to right, so this must follow the workspace bind.
      [ -n "$mcp" ] && [ -f "$mcp" ] && [ -f "$ws/.mcp.json" ] && \
        printf '%s\n' --ro-bind "$mcp" "$ws/.mcp.json"
      printf '%s\n' --die-with-parent
      ;;
    *) return 1 ;;
  esac
}
