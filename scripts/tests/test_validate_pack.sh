#!/usr/bin/env bash
# Unit test for scripts/validate-pack.sh — structural invariants and warning paths.
# No network, no GitHub auth required. Creates throwaway pack dirs under /tmp.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

V="scripts/validate-pack.sh"
fail=0
pass(){ echo "ok   - $1"; }
bad(){ echo "FAIL - $1"; fail=1; }

# ── Helper: write a minimal valid manifest ──────────────────────────────────
# Usage: write_manifest <dir> [extra-json-after-skills]
# The extra-json arg lets callers inject capabilities, default_enabled, etc.
write_manifest() {
  local dir="$1"
  local extra="${2:-}"
  local manifest="$dir/skills-pack.json"
  if [[ -n "$extra" ]]; then
    cat > "$manifest" <<EOF
{
  "name": "test-pack",
  "version": "1.0",
  "description": "A test pack",
  "author": "tester",
  "license": "MIT",
  "skills": [
    { "slug": "foo", "path": "skills/foo" },
    { "slug": "bar", "path": "skills/bar" }
  ]$extra
}
EOF
  else
    cat > "$manifest" <<'EOF'
{
  "name": "test-pack",
  "version": "1.0",
  "description": "A test pack",
  "author": "tester",
  "license": "MIT",
  "skills": [
    { "slug": "foo", "path": "skills/foo" },
    { "slug": "bar", "path": "skills/bar" }
  ]
}
EOF
  fi
}

# ── Helper: create a minimal skill dir ──────────────────────────────────────
make_skill() {
  local dir="$1"
  local slug="$2"
  local name="${3:-$slug}"
  local desc="${4:-Test skill $slug}"
  mkdir -p "$dir/skills/$slug"
  cat > "$dir/skills/$slug/SKILL.md" <<EOF
---
name: $name
description: $desc
---
# $name
EOF
}

# ── Helper: create a full pack with two skills ──────────────────────────────
make_pack() {
  local dir="$1"
  make_skill "$dir" "foo"
  make_skill "$dir" "bar"
}

# ── Test 1: duplicate slugs → ERROR, exit 1 ─────────────────────────────────
TMP1=$(mktemp -d)
trap 'rm -rf "$TMP1"' EXIT
make_pack "$TMP1"
cat > "$TMP1/skills-pack.json" <<'EOF'
{
  "name": "test-pack",
  "version": "1.0",
  "skills": [
    { "slug": "foo", "path": "skills/foo" },
    { "slug": "foo", "path": "skills/bar" }
  ]
}
EOF

out=$(bash "$V" "$TMP1" 2>&1)
rc=$?
if [[ "$rc" -ne 1 ]]; then
  bad "duplicate slug should exit 1 (got $rc)"
else
  if echo "$out" | grep -q "duplicate slug 'foo'"; then
    pass "duplicate slug detected with correct message"
  else
    bad "duplicate slug not mentioned in output: $out"
  fi
fi

# ── Test 2: unique slugs → pass, exit 0 ─────────────────────────────────────
TMP2=$(mktemp -d)
make_pack "$TMP2"
write_manifest "$TMP2"

out=$(bash "$V" "$TMP2" 2>&1)
rc=$?
if [[ "$rc" -ne 0 ]]; then
  bad "clean pack should exit 0 (got $rc): $out"
else
  if echo "$out" | grep -q "pack is valid"; then
    pass "clean pack passes validation"
  else
    bad "clean pack did not report valid: $out"
  fi
fi

# ── Test 3: triple duplicate → ERROR, reports the slug ──────────────────────
TMP3=$(mktemp -d)
make_pack "$TMP3"
cat > "$TMP3/skills-pack.json" <<'EOF'
{
  "name": "test-pack",
  "version": "1.0",
  "skills": [
    { "slug": "foo", "path": "skills/foo" },
    { "slug": "bar", "path": "skills/bar" },
    { "slug": "foo", "path": "skills/foo" }
  ]
}
EOF

out=$(bash "$V" "$TMP3" 2>&1)
rc=$?
if [[ "$rc" -ne 1 ]]; then
  bad "triple duplicate should exit 1 (got $rc)"
else
  if echo "$out" | grep -q "duplicate slug 'foo'"; then
    pass "triple duplicate detected"
  else
    bad "triple duplicate not reported: $out"
  fi
fi

# ── Test 4: invalid slug (special characters) → ERROR ───────────────────────
TMP4=$(mktemp -d)
make_pack "$TMP4"
cat > "$TMP4/skills-pack.json" <<'EOF'
{
  "name": "test-pack",
  "version": "1.0",
  "skills": [
    { "slug": "bad slug!", "path": "skills/foo" }
  ]
}
EOF

out=$(bash "$V" "$TMP4" 2>&1)
rc=$?
if [[ "$rc" -ne 1 ]]; then
  bad "invalid slug should exit 1 (got $rc)"
else
  if echo "$out" | grep -q "invalid slug"; then
    pass "invalid slug detected"
  else
    bad "invalid slug not reported: $out"
  fi
fi

# ── Test 5: path traversal (..) in skill path → ERROR ───────────────────────
TMP5=$(mktemp -d)
make_pack "$TMP5"
cat > "$TMP5/skills-pack.json" <<'EOF'
{
  "name": "test-pack",
  "version": "1.0",
  "skills": [
    { "slug": "foo", "path": "skills/../../etc/passwd" }
  ]
}
EOF

out=$(bash "$V" "$TMP5" 2>&1)
rc=$?
if [[ "$rc" -ne 1 ]]; then
  bad "path traversal should exit 1 (got $rc)"
else
  if echo "$out" | grep -q "'..'\|path may not contain"; then
    pass "path traversal detected"
  else
    bad "path traversal not reported: $out"
  fi
fi

# ── Test 6: missing SKILL.md for a declared skill → ERROR ───────────────────
TMP6=$(mktemp -d)
mkdir -p "$TMP6/skills/foo"
cat > "$TMP6/skills/foo/SKILL.md" <<'EOF'
---
name: foo
description: Only skill
---
# Foo
EOF
cat > "$TMP6/skills-pack.json" <<'EOF'
{
  "name": "test-pack",
  "version": "1.0",
  "skills": [
    { "slug": "foo", "path": "skills/foo" },
    { "slug": "ghost", "path": "skills/ghost" }
  ]
}
EOF

out=$(bash "$V" "$TMP6" 2>&1)
rc=$?
if [[ "$rc" -ne 1 ]]; then
  bad "missing SKILL.md should exit 1 (got $rc)"
else
  if echo "$out" | grep -q "SKILL.md not found"; then
    pass "missing SKILL.md detected"
  else
    bad "missing SKILL.md not reported: $out"
  fi
fi

# ── Test 7: invalid JSON manifest → ERROR ───────────────────────────────────
TMP7=$(mktemp -d)
make_pack "$TMP7"
echo "{invalid json" > "$TMP7/skills-pack.json"

out=$(bash "$V" "$TMP7" 2>&1)
rc=$?
if [[ "$rc" -ne 1 ]]; then
  bad "invalid JSON should exit 1 (got $rc)"
else
  if echo "$out" | grep -q "not valid JSON"; then
    pass "invalid JSON detected"
  else
    bad "invalid JSON not reported: $out"
  fi
fi

# ── Test 8: empty skills array → ERROR ──────────────────────────────────────
TMP8=$(mktemp -d)
cat > "$TMP8/skills-pack.json" <<'EOF'
{
  "name": "test-pack",
  "version": "1.0",
  "skills": []
}
EOF

out=$(bash "$V" "$TMP8" 2>&1)
rc=$?
if [[ "$rc" -ne 1 ]]; then
  bad "empty skills array should exit 1 (got $rc)"
else
  if echo "$out" | grep -q "no skills\|skills.*empty"; then
    pass "empty skills array detected"
  else
    bad "empty skills array not reported: $out"
  fi
fi

# ── Test 9: missing manifest file → ERROR ───────────────────────────────────
TMP9=$(mktemp -d)

out=$(bash "$V" "$TMP9" 2>&1)
rc=$?
if [[ "$rc" -ne 1 ]]; then
  bad "missing manifest should exit 1 (got $rc)"
else
  if echo "$out" | grep -q "not found"; then
    pass "missing manifest detected"
  else
    bad "missing manifest not reported: $out"
  fi
fi

# ── Test 10: missing recommended fields → WARNING (still exit 0) ────────────
TMP10=$(mktemp -d)
make_pack "$TMP10"
cat > "$TMP10/skills-pack.json" <<'EOF'
{
  "skills": [
    { "slug": "foo", "path": "skills/foo" },
    { "slug": "bar", "path": "skills/bar" }
  ]
}
EOF

out=$(bash "$V" "$TMP10" 2>&1)
rc=$?
if [[ "$rc" -ne 0 ]]; then
  bad "missing recommended fields should still exit 0 (got $rc): $out"
else
  if echo "$out" | grep -q "missing recommended field"; then
    pass "missing recommended fields produce warnings"
  else
    bad "missing recommended fields not warned: $out"
  fi
fi

# ── Test 11: unknown capability → ERROR ─────────────────────────────────────
TMP11=$(mktemp -d)
make_pack "$TMP11"
cat > "$TMP11/skills-pack.json" <<'EOF'
{
  "name": "test-pack",
  "version": "1.0",
  "skills": [
    { "slug": "foo", "path": "skills/foo", "capabilities": ["read_only", "telekinesis"] }
  ]
}
EOF

out=$(bash "$V" "$TMP11" 2>&1)
rc=$?
if [[ "$rc" -ne 1 ]]; then
  bad "unknown capability should exit 1 (got $rc)"
else
  if echo "$out" | grep -q "unknown capability.*telekinesis"; then
    pass "unknown capability detected"
  else
    bad "unknown capability not reported: $out"
  fi
fi

# ── Test 12: non-array capabilities → ERROR ─────────────────────────────────
TMP12=$(mktemp -d)
make_pack "$TMP12"
cat > "$TMP12/skills-pack.json" <<'EOF'
{
  "name": "test-pack",
  "version": "1.0",
  "skills": [
    { "slug": "foo", "path": "skills/foo", "capabilities": "read_only" }
  ]
}
EOF

out=$(bash "$V" "$TMP12" 2>&1)
rc=$?
if [[ "$rc" -ne 1 ]]; then
  bad "non-array capabilities should exit 1 (got $rc)"
else
  if echo "$out" | grep -q "capabilities must be an array"; then
    pass "non-array capabilities detected"
  else
    bad "non-array capabilities not reported: $out"
  fi
fi

# ── Test 13: unknown category → WARNING (still exit 0) ──────────────────────
TMP13=$(mktemp -d)
make_pack "$TMP13"
cat > "$TMP13/skills-pack.json" <<'EOF'
{
  "name": "test-pack",
  "version": "1.0",
  "skills": [
    { "slug": "foo", "path": "skills/foo", "category": "nonexistent" }
  ]
}
EOF

out=$(bash "$V" "$TMP13" 2>&1)
rc=$?
if [[ "$rc" -ne 0 ]]; then
  bad "unknown category should exit 0 (got $rc): $out"
else
  if echo "$out" | grep -q "outside the documented set"; then
    pass "unknown category produces warning"
  else
    bad "unknown category not warned: $out"
  fi
fi

# ── Test 14: skill with no slug → ERROR ─────────────────────────────────────
TMP14=$(mktemp -d)
make_pack "$TMP14"
cat > "$TMP14/skills-pack.json" <<'EOF'
{
  "name": "test-pack",
  "version": "1.0",
  "skills": [
    { "path": "skills/foo" }
  ]
}
EOF

out=$(bash "$V" "$TMP14" 2>&1)
rc=$?
if [[ "$rc" -ne 1 ]]; then
  bad "missing slug should exit 1 (got $rc)"
else
  if echo "$out" | grep -q "no slug"; then
    pass "missing slug detected"
  else
    bad "missing slug not reported: $out"
  fi
fi

# ── Test 15: SKILL.md frontmatter missing name/description → WARNING ────────
TMP15=$(mktemp -d)
mkdir -p "$TMP15/skills/foo"
cat > "$TMP15/skills/foo/SKILL.md" <<'EOF'
---
---
# Foo
EOF
cat > "$TMP15/skills-pack.json" <<'EOF'
{
  "name": "test-pack",
  "version": "1.0",
  "skills": [
    { "slug": "foo", "path": "skills/foo" }
  ]
}
EOF

out=$(bash "$V" "$TMP15" 2>&1)
rc=$?
if [[ "$rc" -ne 0 ]]; then
  bad "missing frontmatter name/desc should still exit 0 (got $rc): $out"
else
  name_warn=false
  desc_warn=false
  echo "$out" | grep -q "missing name" && name_warn=true
  echo "$out" | grep -q "missing description" && desc_warn=true
  if $name_warn && $desc_warn; then
    pass "missing frontmatter name/description produce warnings"
  else
    bad "missing frontmatter warnings incomplete (name=$name_warn, desc=$desc_warn): $out"
  fi
fi

# ── Test 16: on-disk skill not in manifest → WARNING ────────────────────────
TMP16=$(mktemp -d)
make_pack "$TMP16"
# Add an extra on-disk skill not in the manifest
make_skill "$TMP16" "orphan"
write_manifest "$TMP16"

out=$(bash "$V" "$TMP16" 2>&1)
rc=$?
if [[ "$rc" -ne 0 ]]; then
  bad "orphan on-disk skill should still exit 0 (got $rc): $out"
else
  if echo "$out" | grep -q "not in the manifest"; then
    pass "orphan on-disk skill produces warning"
  else
    bad "orphan on-disk skill not warned: $out"
  fi
fi

# ── Test 17: missing LICENSE file → WARNING ─────────────────────────────────
TMP17=$(mktemp -d)
make_pack "$TMP17"
# Manifest has no license field AND no LICENSE file on disk — both are warnings.
cat > "$TMP17/skills-pack.json" <<'EOF'
{
  "name": "test-pack",
  "version": "1.0",
  "skills": [
    { "slug": "foo", "path": "skills/foo" },
    { "slug": "bar", "path": "skills/bar" }
  ]
}
EOF

out=$(bash "$V" "$TMP17" 2>&1)
rc=$?
# Both "no LICENSE file" and "no license field" should be warnings
if [[ "$rc" -ne 0 ]]; then
  bad "missing license should still exit 0 (got $rc): $out"
else
  license_file_warn=false
  license_field_warn=false
  echo "$out" | grep -q "no LICENSE file" && license_file_warn=true
  echo "$out" | grep -q "no .license. field" && license_field_warn=true
  if $license_file_warn && $license_field_warn; then
    pass "missing license produces both warnings"
  else
    bad "missing license not warned (file=$license_file_warn field=$license_field_warn): $out"
  fi
fi

# ── Test 18: slug with dots (.) → ERROR ─────────────────────────────────────
TMP18=$(mktemp -d)
make_pack "$TMP18"
cat > "$TMP18/skills-pack.json" <<'EOF'
{
  "name": "test-pack",
  "version": "1.0",
  "skills": [
    { "slug": ".", "path": "skills/foo" }
  ]
}
EOF

out=$(bash "$V" "$TMP18" 2>&1)
rc=$?
if [[ "$rc" -ne 1 ]]; then
  bad "dot slug should exit 1 (got $rc)"
else
  if echo "$out" | grep -q "invalid slug"; then
    pass "dot slug rejected"
  else
    bad "dot slug not rejected: $out"
  fi
fi

# ── Test 19: valid capabilities pass → exit 0 ───────────────────────────────
TMP19=$(mktemp -d)
make_pack "$TMP19"
cat > "$TMP19/skills-pack.json" <<'EOF'
{
  "name": "test-pack",
  "version": "1.0",
  "description": "A test pack",
  "author": "tester",
  "license": "MIT",
  "skills": [
    { "slug": "foo", "path": "skills/foo", "capabilities": ["read_only", "external_api"] },
    { "slug": "bar", "path": "skills/bar" }
  ]
}
EOF

out=$(bash "$V" "$TMP19" 2>&1)
rc=$?
if [[ "$rc" -ne 0 ]]; then
  bad "valid capabilities should pass (got $rc): $out"
else
  if echo "$out" | grep -q "pack is valid"; then
    pass "valid capabilities pass"
  else
    bad "valid capabilities not reported valid: $out"
  fi
fi

# ── Test 20: --path flag routes to subdirectory manifest ────────────────────
TMP20=$(mktemp -d)
mkdir -p "$TMP20/sub/skills/foo"
cat > "$TMP20/sub/skills/foo/SKILL.md" <<'EOF'
---
name: foo
description: Subdirectory skill
---
# Foo
EOF
cat > "$TMP20/sub/skills-pack.json" <<'EOF'
{
  "name": "sub-pack",
  "version": "1.0",
  "description": "Pack in a subdirectory",
  "author": "tester",
  "license": "MIT",
  "skills": [
    { "slug": "foo", "path": "skills/foo" }
  ]
}
EOF

out=$(bash "$V" "$TMP20" --path sub 2>&1)
rc=$?
if [[ "$rc" -ne 0 ]]; then
  bad "--path should locate subdirectory manifest (got $rc): $out"
else
  if echo "$out" | grep -q "pack is valid"; then
    pass "--path flag works for subdirectory manifest"
  else
    bad "--path flag didn't validate: $out"
  fi
fi

# ── Clean up ────────────────────────────────────────────────────────────────
for d in "$TMP1" "$TMP2" "$TMP3" "$TMP4" "$TMP5" "$TMP6" "$TMP7" "$TMP8" "$TMP9" "$TMP10" "$TMP11" "$TMP12" "$TMP13" "$TMP14" "$TMP15" "$TMP16" "$TMP17" "$TMP18" "$TMP19" "$TMP20"; do
  rm -rf "$d"
done

if [[ "$fail" -eq 0 ]]; then
  echo ""
  echo "All 20 validate-pack tests passed."
else
  echo ""
  echo "SOME TESTS FAILED."
fi
exit "$fail"