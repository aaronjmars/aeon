#!/usr/bin/env bash
# Unit test for the catalog side of a community skill install:
#   bin/generate-packs-json   — a skills.lock skill must reach the "installed"
#                               pack even when its SKILL.md carries no category
#   bin/generate-skills-json  — a YAML block-scalar description must be folded,
#                               not recorded as the literal ">-" marker
# No network, no GitHub auth required. Builds throwaway repo roots under /tmp.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
ROOT="$PWD"

fail=0
pass(){ echo "ok   - $1"; }
bad(){ echo "FAIL - $1"; fail=1; }

# ── Helper: a minimal Aeon repo root that the two generators can run against ──
# Copies in the real scripts so the test exercises shipped code, not a copy.
make_root() {
  local d
  d=$(mktemp -d)
  mkdir -p "$d/bin" "$d/catalog" "$d/skills"
  cp "$ROOT/bin/generate-skills-json" "$ROOT/bin/generate-packs-json" "$d/bin/"
  cat > "$d/catalog/packs.config.json" <<'EOF'
{"version":"1.0","packs":[
  {"key":"crypto","name":"Crypto","description":"c","color":"#000","category":"crypto"}
]}
EOF
  printf '%s\n' "$d"
}

# Usage: write_skill <root> <slug> <frontmatter-body>
write_skill() {
  local root="$1" slug="$2" body="$3"
  mkdir -p "$root/skills/$slug"
  { echo "---"; printf '%s\n' "$body"; echo "---"; echo; echo "# $slug"; } \
    > "$root/skills/$slug/SKILL.md"
}

# ── 1. Block-scalar description is folded, not left as the marker ────────────
d=$(make_root)
write_skill "$d" "folded" 'type: Skill
name: Folded
category: crypto
description: >-
  First line of the description
  and its continuation.'
write_skill "$d" "plain" 'type: Skill
name: Plain
category: crypto
description: A single-line description.'
(cd "$d" && bin/generate-skills-json >/dev/null 2>&1)
desc=$(jq -r '.skills[] | select(.slug=="folded") | .description' "$d/catalog/skills.json")
if [[ "$desc" == "First line of the description and its continuation." ]]; then
  pass "block-scalar description folded into one line"
else
  bad "block-scalar description folded into one line (got: '$desc')"
fi
desc=$(jq -r '.skills[] | select(.slug=="plain") | .description' "$d/catalog/skills.json")
if [[ "$desc" == "A single-line description." ]]; then
  pass "single-line description unchanged"
else
  bad "single-line description unchanged (got: '$desc')"
fi
rm -rf "$d"

# ── 2. A lock-installed skill with no category lands in "installed" ──────────
# Community SKILL.md files are written to their author's conventions and often
# carry no `category:`. Before the fix the catch-all check ran first and aborted
# the whole catalog for a skill that was never going to join a first-party pack.
d=$(make_root)
write_skill "$d" "native" 'type: Skill
name: Native
category: crypto
description: A first-party skill.'
write_skill "$d" "from-pack" 'name: From Pack
description: A community skill with no category.'
cat > "$d/skills.lock" <<'EOF'
[{"skill_name":"from-pack","source_repo":"someone/their-pack","source_path":"skills/from-pack/SKILL.md","branch":"main","commit_sha":"unknown","imported_at":"2026-01-01T00:00:00Z","pack":"their-pack"}]
EOF
(cd "$d" && bin/generate-skills-json >/dev/null 2>&1)
out=$(cd "$d" && bin/generate-packs-json 2>&1)
rc=$?
if [[ $rc -eq 0 ]]; then
  pass "generate-packs-json succeeds with an uncategorised installed skill"
else
  bad "generate-packs-json succeeds with an uncategorised installed skill (exit $rc: $out)"
fi
if [[ -f "$d/catalog/packs.json" ]]; then
  key=$(jq -r '.packs[] | select(.skills[]?.slug=="from-pack") | .key' "$d/catalog/packs.json")
  [[ "$key" == "installed" ]] && pass "uncategorised installed skill lands in the 'installed' pack" \
    || bad "uncategorised installed skill lands in the 'installed' pack (got: '$key')"
  key=$(jq -r '.packs[] | select(.skills[]?.slug=="native") | .key' "$d/catalog/packs.json")
  [[ "$key" == "crypto" ]] && pass "first-party skill still claimed by its category pack" \
    || bad "first-party skill still claimed by its category pack (got: '$key')"
fi
rm -rf "$d"

# ── 3. An uncategorised skill that is NOT installed is still a hard error ─────
# The category gate must keep biting for skills authored in this repo.
d=$(make_root)
write_skill "$d" "sloppy" 'name: Sloppy
description: A local skill missing its category.'
(cd "$d" && bin/generate-skills-json >/dev/null 2>&1)
out=$(cd "$d" && bin/generate-packs-json 2>&1)
if [[ $? -ne 0 ]] && [[ "$out" == *"not assigned to any pack"* ]]; then
  pass "uncategorised local skill still fails the catalog build"
else
  bad "uncategorised local skill still fails the catalog build (got: $out)"
fi
rm -rf "$d"

echo ""
[[ $fail -eq 0 ]] && echo "All community-install catalog tests passed." || echo "Some tests FAILED."
exit $fail
