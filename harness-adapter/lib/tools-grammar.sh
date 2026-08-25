# shellcheck shell=bash
# tools-grammar.sh — parse Claude Code's --allowedTools grammar and translate it
# into each harness's native permission shape.
#
# Claude grammar (the lingua franca): comma-separated tokens, e.g.
#   Read,Glob,Grep,WebFetch,Write,Edit,Bash(git:*),Bash(curl:*)
# Bash rules use colon-globs: Bash(cmd:*). Bare names allow the whole tool.

tools_has_write() {
  # exit 0 iff the toolset includes a repo-mutation tool (Write or Edit)
  case ",$1," in
    *,Write,* | *,Edit,*) return 0 ;;
  esac
  return 1
}

tools_to_pi_exclude() {
  # Claude allowedTools / mode -> pi --exclude-tools value. pi has no permission
  # system ("YOLO mode"); the only native lever is subsetting its toolset.
  # Prints nothing for write mode (pi keeps its full toolset).
  #
  # This USED TO emit `--tools read,grep,find,ls`, an allowlist. pi's built-ins
  # are read/bash/edit/write and it has NO web tool, so that allowlist dropped
  # `bash` — pi's only route to the network. Read-only skills then could not
  # fetch anything. Measured on a real aeon runner: pi ended github-trending
  # with "there is no network access available through the provided tools" and
  # delivered a menu of options instead of a report. That statement was
  # literally TRUE, and the cause was this function.
  #
  # read-only means "cannot MUTATE the workspace", not "cannot act". The
  # mutation guard is the dispatcher's wrapper OS sandbox (lib/sandbox.sh), as
  # adapters/pi.sh's own header says; dropping write/edit here is belt-and-braces
  # so the model is not even offered a tool that would fail. bash stays, so
  # curl — which aeon's read-only toolset explicitly grants as Bash(curl:*) —
  # keeps working, and any write attempted through it hits the sandbox.
  local tools="$1"
  if ! tools_has_write "$tools"; then
    echo "write,edit"
  fi
}
