#!/usr/bin/env bash
# skill_requires — the API-key names a skill declares in its `requires:` frontmatter,
# one per line, with the `?` "works-better" marker stripped. Both tiers are returned
# (bare = required, `?` = optional/works-better); the caller injects whichever secret
# actually exists. This is the allowlist for per-skill, least-privilege secret env:
# a skill sees ONLY the keys it declares here — nothing else from the secret store.
#
# Formats parsed (matches bin/generate-skills-json) — inline OR block, top-level
# (legacy) or nested under `metadata:` (Agent Skills spec form):
#   requires: [COINGECKO_API_KEY?, ALCHEMY_API_KEY?, BASE_RPC_URL?]
#   requires:
#     - COINGECKO_API_KEY?
#     - ALCHEMY_API_KEY?
#
# Usage: skill_requires.sh <skill-name>
set -euo pipefail
f="skills/${1:?skill name required}/SKILL.md"
[ -f "$f" ] || exit 0
awk '
  /^---$/{n++; next}
  n!=1{next}
  # collecting block-list items under a bare `requires:` key
  collecting {
    if ($0 ~ /^[[:space:]]*-[[:space:]]*/) {
      item=$0; sub(/^[[:space:]]*-[[:space:]]*/,"",item); sub(/[[:space:]]*#.*/,"",item); gsub(/[[:space:]]/,"",item)
      if (item != "") print item
      next
    }
    exit   # first non-item line ends the block
  }
  /^[^ \t]/{inmeta=0}
  /^metadata:/{inmeta=1}
  # requires key, top-level (legacy) or under metadata: (spec form)
  (/^requires:/ || (inmeta && /^[[:space:]]+requires:/)) {
    if ($0 ~ /\[/) {                       # inline flow list
      line=$0; sub(/^[[:space:]]*requires:[[:space:]]*\[/,"",line); sub(/\].*/,"",line); gsub(/[[:space:]]/,"",line)
      print line; exit
    }
    collecting=1; next                     # bare key -> block list follows
  }
' "$f" \
  | tr ',' '\n' | sed 's/?[[:space:]]*$//' \
  | grep -E '^[A-Z][A-Z0-9_]{2,}$' || true
