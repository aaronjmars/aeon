#!/usr/bin/env bash
# Unit test for scripts/validate-readme-catalog.mjs — first-party catalog ↔ README
# table parity. No network, no GitHub auth. Each case runs against throwaway
# fixtures under /tmp; the last case runs the real committed catalog + README so a
# drifted main is caught here too.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

V="scripts/validate-readme-catalog.mjs"
fail=0
pass(){ echo "ok   - $1"; }
bad(){ echo "FAIL - $1"; fail=1; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/validate-readme-catalog.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# ── Fixture builders ────────────────────────────────────────────────────────
# A fixture is a packs.json + a README. The baseline pair is valid and passes;
# each case overwrites whichever one it is about.

# A 2-pack catalog: `alpha` (2 skills), `beta` (1 skill). total = 2 packs / 3 skills.
write_packs() {
  cat > "$1/packs.json" <<'EOF'
{
  "version": "1.0",
  "total_packs": 2,
  "total_skills": 3,
  "packs": [
    { "key": "alpha", "name": "Alpha", "skills": [ { "slug": "a-one" }, { "slug": "a-two" } ] },
    { "key": "beta",  "name": "Beta",  "skills": [ { "slug": "b-one" } ] }
  ]
}
EOF
}

# write_readme <dir> <hero-word> <all-N> <alpha-count> <full-alpha-slugs>
# Everything else is held at the valid baseline; callers vary one argument.
write_readme() {
  cat > "$1/README.md" <<EOF
# Test README

**$2 packs ship in the box** - blah blah.

| Pack | Key | Skills | Examples |
| --- | --- | --- | --- |
| **Alpha** - desc | \`alpha\` | $4 | \`a-one\`, \`a-two\` |
| **Beta** - desc | \`beta\` | 1 | \`b-one\` |

<details>
<summary><strong>Full catalog (all $3 skills by pack)</strong></summary>

| Pack | Skills |
|------|--------|
| **Alpha** (\`alpha\`, 2) | $5 |
| **Beta** (\`beta\`, 1) | \`b-one\` |

</details>
EOF
}

# new_fixture <name> → prints the dir; baseline is valid and passes.
new_fixture() {
  local d="$TMP/$1"
  mkdir -p "$d"
  write_packs "$d"
  write_readme "$d" Two 3 2 '`a-one`,`a-two`'
  echo "$d"
}

run() { node "$V" --packs "$1/packs.json" --readme "$1/README.md" 2>&1; }

expect_ok() {
  local out; out="$(run "$1")"
  if [[ $? -eq 0 ]]; then pass "$2"; else bad "$2 — expected exit 0, got:"; echo "$out" | sed 's/^/       /'; fi
}
expect_fail() {
  local out rc
  out="$(run "$1")"; rc=$?
  if [[ $rc -eq 0 ]]; then
    bad "$3 — expected a failure, got exit 0"
  elif [[ "$out" != *"$2"* ]]; then
    bad "$3 — failed as expected but message missing \"$2\":"; echo "$out" | sed 's/^/       /'
  else
    pass "$3"
  fi
}

# ── Baseline ────────────────────────────────────────────────────────────────
d=$(new_fixture baseline)
out="$(run "$d")"; rc=$?
if [[ $rc -eq 0 ]]; then pass "a matching catalog + README passes"
else bad "a matching catalog + README passes"; echo "$out" | sed 's/^/       /'; fi

# ── Full-catalog table (the finance-district bug class) ─────────────────────
d=$(new_fixture missing_skill)
write_readme "$d" Two 3 2 '`a-one`'          # a-two dropped from the full-catalog list
expect_fail "$d" "missing: a-two" "a skill missing from the full-catalog list is rejected"

d=$(new_fixture extra_skill)
write_readme "$d" Two 3 2 '`a-one`,`a-two`,`a-ghost`'
expect_fail "$d" "not in the pack: a-ghost" "a full-catalog skill that isn't in the pack is rejected"

# ── Summary table counts + examples ─────────────────────────────────────────
d=$(new_fixture bad_summary_count)
write_readme "$d" Two 3 9 '`a-one`,`a-two`'   # summary claims alpha has 9 skills
expect_fail "$d" "\`alpha\` has 9 skills but the catalog has 2" "a wrong summary Skills count is rejected"

d=$(new_fixture bad_example)
sed -i.bak 's/`a-one`, `a-two` |/`a-one`, `nope` |/' "$d/README.md"
expect_fail "$d" "lists \`nope\` as a \`alpha\` example" "a curated example not in the pack is rejected"

# ── Headline counts (only enforced when present + parseable) ────────────────
d=$(new_fixture bad_all_n)
write_readme "$d" Two 7 2 '`a-one`,`a-two`'    # "all 7 skills" but catalog has 3
expect_fail "$d" "all 7 skills by pack" "a stale 'all N skills' caption is rejected"

d=$(new_fixture bad_hero)
write_readme "$d" Five 3 2 '`a-one`,`a-two`'   # "Five packs" but catalog has 2
expect_fail "$d" "Five packs ship in the box" "a stale pack-count hero line is rejected"

# ── The committed catalog + README itself ───────────────────────────────────
out="$(node "$V" 2>&1)"; rc=$?
if [[ $rc -eq 0 ]]; then pass "the committed catalog/packs.json matches the committed README"
else bad "the committed catalog/packs.json matches the committed README"; echo "$out" | sed 's/^/       /'; fi

echo ""
if [[ $fail -eq 0 ]]; then echo "test_validate_readme_catalog: ALL PASS"; else echo "test_validate_readme_catalog: FAILURES"; fi
exit "$fail"
