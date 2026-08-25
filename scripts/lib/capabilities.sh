# shellcheck shell=bash
# capabilities.sh — shared parser for install-skill-pack's capability allow-list.
# Sourced by check-capabilities-parity.sh and validate-pack.sh so the
# ALLOWED_CAPABILITIES=(...) array in bin/install-skill-pack stays the single
# source of truth — the awk that reads it lives here once, not copied per script.

# Print each capability in the given script's ALLOWED_CAPABILITIES=(...) block, one
# per line: non-empty, non-comment lines between the opening and closing paren,
# trimmed of surrounding whitespace and any trailing comment.
extract_allowed_capabilities() {
  awk '
    /^ALLOWED_CAPABILITIES=\(/ { in_array=1; next }
    in_array && /^\)/          { in_array=0; next }
    in_array {
      sub(/^[[:space:]]+/, "")
      sub(/[[:space:]]+$/, "")
      sub(/[[:space:]]*#.*$/, "")
      if (length($0)) print
    }
  ' "$1"
}
