#!/usr/bin/env bash
set -eo pipefail

# check-skill-categories.sh — Lint that every skills/*/SKILL.md declares a valid
# `category:` in its frontmatter. Category is the single source of truth for which
# pack a skill joins (see docs/skill-packs.md); a missing or typo'd one would
# silently dump the skill into the Lab catch-all instead of its intended pack.
#
# Run locally:  bash scripts/check-skill-categories.sh
# Exits 0 if every skill has a known category, 1 otherwise (with a report).

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_DIR="$ROOT/skills"

# Valid frontmatter categories. A skill's category IS its pack — one grouping
# (see docs/skill-packs.md). To move a skill between packs, change this one line.
# `lab` is the catch-all for a missing/unknown category and isn't set by hand.
VALID="core evolution basics dev crypto productivity"

missing=()
invalid=()

for skill_file in "$SKILLS_DIR"/*/SKILL.md; do
  [[ -f "$skill_file" ]] || continue
  slug="$(basename "$(dirname "$skill_file")")"

  # Accept either the legacy top-level `category:` or the Agent Skills spec form
  # nested under `metadata:` (indented). First match wins.
  cat=$(awk '
    /^---$/{n++; next}
    n!=1{next}
    /^metadata:/{inmeta=1}
    /^category:/{sub(/^category:[[:space:]]*/,""); gsub(/"/,""); gsub(/[[:space:]]*$/,""); print; exit}
    inmeta && /^[[:space:]]+category:/{sub(/^[[:space:]]+category:[[:space:]]*/,""); gsub(/"/,""); gsub(/[[:space:]]*$/,""); print; exit}
  ' "$skill_file")

  if [[ -z "$cat" ]]; then
    missing+=("$slug")
    continue
  fi
  if [[ " $VALID " != *" $cat "* ]]; then
    invalid+=("$slug ($cat)")
  fi
done

status=0

if [[ ${#missing[@]} -gt 0 ]]; then
  status=1
  echo "::error::${#missing[@]} skill(s) missing a 'category:' in SKILL.md frontmatter:"
  printf '  - %s\n' "${missing[@]}"
fi

if [[ ${#invalid[@]} -gt 0 ]]; then
  status=1
  echo "::error::${#invalid[@]} skill(s) with an unknown category (valid: $VALID):"
  printf '  - %s\n' "${invalid[@]}"
fi

if [[ "$status" -eq 0 ]]; then
  echo "skill-categories: OK — every skill declares a valid category."
else
  echo ""
  echo "Fix: set 'category: <pack>' in each SKILL.md frontmatter (one of: $VALID)."
  echo "See docs/skill-packs.md. New skills: bin/new-from-template ... --category <pack>."
fi

exit "$status"
