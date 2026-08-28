#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORKFLOW="$ROOT/.github/workflows/aeon.yml"

choices=$(awk '
  /^      harness:$/ { in_harness=1; next }
  in_harness && /^      var:$/ { exit }
  in_harness && /^          - / { sub(/^          - /, ""); print }
' "$WORKFLOW")

if ! grep -qx 'fx' <<<"$choices"; then
  echo 'workflow_dispatch harness choices omit fx' >&2
  exit 1
fi

echo 'workflow harness choice tests passed'
