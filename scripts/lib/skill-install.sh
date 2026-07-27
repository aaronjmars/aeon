#!/usr/bin/env bash
# skill-install.sh — shared helpers for the three skill installers:
#   bin/add-skill            (any GitHub repo, scans for SKILL.md)
#   bin/install-skill-pack   (curated community packs with a skills-pack.json manifest)
#   bin/install-from-atrium  (Atrium onchain marketplace, single SKILL.md endpoint)
#
# SOURCED, never executed. Before this file existed each installer carried its
# own copy of: frontmatter parsing, trusted-source check, tarball fetch+extract,
# skills.lock provenance upsert, and aeon.yml insertion. Centralising them here
# keeps the three entry points thin and their shared behaviour identical.
#
# Every function is Bash 3.2-compatible (macOS ships 3.2 — no associative
# arrays, no ${var^^}) and takes explicit path arguments rather than reading
# caller globals, so each installer stays in control of where its skills/,
# aeon.yml, and skills.lock live.

# skill_fm <skill_md> <field>
#   Echo a single frontmatter scalar (first match) from a SKILL.md's --- block,
#   with surrounding double-quotes stripped. Empty output if the field is absent.
skill_fm() {
  local file="$1" field="$2"
  sed -n '/^---$/,/^---$/p' "$file" \
    | grep -E "^[[:space:]]*${field}:" \
    | head -1 \
    | sed "s/^[[:space:]]*${field}:[[:space:]]*//; s/^\"//; s/\"$//"
}

# skill_is_trusted <repo> <trusted_file>
#   Return 0 if <repo> (owner/repo) or its owner is listed in <trusted_file>,
#   else 1. Blank lines and #-comments in the file are ignored.
skill_is_trusted() {
  local repo="$1" trusted_file="$2" owner="${1%%/*}" line
  [[ -f "$trusted_file" ]] || return 1
  while IFS= read -r line; do
    line="${line%%#*}"; line="${line// /}"
    [[ -z "$line" ]] && continue
    if [[ "$line" == "$repo" ]] || [[ "$line" == "$owner" ]]; then
      return 0
    fi
  done < "$trusted_file"
  return 1
}

# skill_fetch_repo <repo> <branch> <dest_dir>
#   Download owner/repo@branch as a tarball into <dest_dir>, extract it, and echo
#   the extracted top-level directory. Tries refs/heads/<branch>, then
#   refs/tags/<branch>, then the repo's actual default branch (callers default
#   <branch> to "main", which silently fails on every repo still on "master").
#   Returns non-zero (message on stderr) on failure — callers should use:
#     root=$(skill_fetch_repo "$REPO" "$BRANCH" "$TMP") || exit 1
skill_fetch_repo() {
  local repo="$1" branch="$2" dest="$3" url root default_branch
  url="https://github.com/$repo/archive/refs/heads/$branch.tar.gz"
  if ! curl -sfL "$url" -o "$dest/repo.tar.gz" 2>/dev/null; then
    url="https://github.com/$repo/archive/refs/tags/$branch.tar.gz"
    if ! curl -sfL "$url" -o "$dest/repo.tar.gz" 2>/dev/null; then
      # Neither a branch nor a tag by that name. Ask GitHub what the repo's
      # default branch actually is and retry once — a pack on "master" is
      # otherwise uninstallable by the documented one-command form, with a
      # failure that reads like the repo doesn't exist.
      default_branch=$(curl -sfL --max-time 10 "https://api.github.com/repos/$repo" 2>/dev/null \
        | sed -n 's/.*"default_branch": *"\([^"]*\)".*/\1/p' | head -1)
      if [[ -z "$default_branch" ]] || [[ "$default_branch" == "$branch" ]]; then
        echo "Failed to fetch $repo (branch/tag: $branch)" >&2
        return 1
      fi
      url="https://github.com/$repo/archive/refs/heads/$default_branch.tar.gz"
      if ! curl -sfL "$url" -o "$dest/repo.tar.gz" 2>/dev/null; then
        echo "Failed to fetch $repo (branch/tag: $branch, default: $default_branch)" >&2
        return 1
      fi
      branch="$default_branch"
      echo "  note: '$branch' not found — using default branch '$default_branch'" >&2
    fi
  fi
  # Callers run this in a command substitution, so an exported variable would not
  # survive the subshell. Drop the ref that was actually fetched next to the
  # tarball instead; callers read it back to keep skills.lock provenance honest.
  printf '%s' "$branch" > "$dest/.skill-fetch-branch"
  tar -xzf "$dest/repo.tar.gz" -C "$dest" 2>/dev/null
  root=$(find "$dest" -mindepth 1 -maxdepth 1 -type d | head -1)
  if [[ -z "$root" ]]; then
    echo "Failed to extract repository" >&2
    return 1
  fi
  printf '%s\n' "$root"
}

# skill_lock_upsert <lock_file> <entry_json>
#   Ensure <lock_file> holds a JSON array, then replace any existing element with
#   the same .skill_name and append <entry_json>. Requires jq. This is the one
#   provenance-write path for all three installers (schemas differ only in which
#   fields the caller puts in <entry_json>).
skill_lock_upsert() {
  local lock_file="$1" entry="$2"
  if [[ ! -f "$lock_file" ]] || [[ ! -s "$lock_file" ]]; then
    echo "[]" > "$lock_file"
  fi
  jq --argjson entry "$entry" \
    '[.[] | select(.skill_name != $entry.skill_name)] + [$entry]' \
    "$lock_file" > "${lock_file}.tmp" && mv "${lock_file}.tmp" "$lock_file"
}

# skill_add_to_aeon_yml <aeon_yml> <slug> <enabled> <schedule>
#   Insert "  <slug>: { enabled: <enabled>, schedule: \"<schedule>\" }" before the
#   "# --- Fallback" marker (or before the first top-level block / at EOF when no
#   marker exists). No-op if <slug> is already present. Echoes a status line.
skill_add_to_aeon_yml() {
  local aeon_yml="$1" slug="$2" enabled="$3" schedule="$4" entry_line
  [[ -f "$aeon_yml" ]] || return 0
  if grep -q "^  $slug:" "$aeon_yml" 2>/dev/null; then
    echo "    -> already in aeon.yml"
    return 0
  fi
  entry_line="  $slug: { enabled: $enabled, schedule: \"$schedule\" }"
  if grep -q "^  # --- Fallback" "$aeon_yml"; then
    awk -v entry="$entry_line" \
      '/^  # --- Fallback/ { print entry }  { print }' \
      "$aeon_yml" > "${aeon_yml}.tmp" && mv "${aeon_yml}.tmp" "$aeon_yml"
  else
    awk -v entry="$entry_line" '
      /^[a-z]+:/ && NR > 1 && !inserted { print entry; inserted=1 }
      { print }
      END { if (!inserted) print entry }
    ' "$aeon_yml" > "${aeon_yml}.tmp" && mv "${aeon_yml}.tmp" "$aeon_yml"
  fi
  echo "    -> added to aeon.yml (enabled: $enabled, schedule: \"$schedule\")"
}

# skill_log_force_install <security_log> <slug> <source>
#   Append a timestamped FORCE_INSTALL audit line, creating the log's parent dir.
#   Called when an installer bypasses a failed security scan via --force.
skill_log_force_install() {
  local security_log="$1" slug="$2" source="$3"
  mkdir -p "$(dirname "$security_log")"
  echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ') FORCE_INSTALL: $slug from $source" >> "$security_log"
}
