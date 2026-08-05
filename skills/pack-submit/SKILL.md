---
name: pack-submit
description: Package one of this agent's own skills as a standalone community pack and submit it to the aeon registry as a PR
metadata:
  title: Pack Submit
  category: evolution
  var: ""
  tags:
    - dev
    - meta
    - packs
  mode: write
  requires:
    - GH_GLOBAL?
  capabilities:
    - external_api
    - writes_external_host
    - sends_notifications
---

> **${var}** — The local skill to publish as a community pack: a skill **slug** (a directory name under `skills/`), optionally followed by flags. **Required.**
> Examples:
> - `token-movers` — package `skills/token-movers/` into a fresh public repo and submit it to the aeon registry
> - `token-movers --repo myorg/aeon-token-movers` — override the pack repo name (default `aeon-skill-pack-<slug>`)
> - `token-movers --no-register` — create and push the pack repo, but skip the registry PR against `aeonfun/aeon`
> - `token-movers --dry-run` — build and validate the pack locally, write nothing to GitHub

If `${var}` is empty, exit `PACK_SUBMIT_NO_VAR`:
```bash
./notify "pack-submit aborted: var empty — pass a skill slug e.g. \"token-movers\""
```
Then stop.

Today is ${today}. Your task is to take the **existing** skill named in `${var}`, wrap it in a standalone community-pack repo (its own GitHub repo with a `skills-pack.json` manifest), and **submit it to the aeon community registry** — a PR against `aeonfun/aeon` that adds both surfaces the registry demands in one diff: a row in the README's **Community Packs** table AND a matching entry in `catalog/skill-packs.json`. This is the inverse of `install-skill`: instead of pulling a community pack in, it pushes one of your own skills out for every other Aeon agent to install with `bin/install-skill-pack`.

## What a community pack is (so you build the right thing)

A community pack is a **public GitHub repo** that holds one or more skills plus a `skills-pack.json` manifest that names and versions them. `bin/install-skill-pack owner/repo` reads that manifest and installs the skills. To be **discoverable** (listed by `bin/install-skill-pack --list` and the dashboard's Community Packs panel), the pack must also be registered in `aeonfun/aeon`'s `catalog/skill-packs.json` + README table. So publishing is two moves: **(a)** stand up the pack repo, **(b)** open the registry PR. This skill does both. Full protocol: `docs/community-skill-packs.md`.

## Steps

1. **Parse and validate `${var}`.** The first whitespace-separated token is the skill slug; the rest are flags (`--repo owner/name`, `--no-register`, `--dry-run`). The slug must match `^[a-z0-9][a-z0-9-]*$` and resolve to a real directory:
   ```bash
   SLUG=$(echo "${var}" | awk '{print $1}')
   FLAGS=$(echo "${var}" | cut -s -d' ' -f2-)
   if ! echo "$SLUG" | grep -qE '^[a-z0-9][a-z0-9-]*$'; then
     ./notify "pack-submit aborted: \"$SLUG\" is not a valid skill slug (lowercase kebab-case)"; exit 0
   fi
   if [ ! -f "skills/$SLUG/SKILL.md" ]; then
     ./notify "pack-submit aborted: skills/$SLUG/SKILL.md not found — run with a slug from \`ls skills/\`"; exit 0
   fi
   ```
   If validation fails, exit `PACK_SUBMIT_BAD_VAR` with the notify above and stop. Extract the boolean flags from `$FLAGS` and the optional `--repo` value.

2. **Read the source skill's metadata.** Everything the manifest and registry entry need is already declared in `skills/$SLUG/SKILL.md`'s frontmatter — read it, don't invent it:
   - **Display name** — `metadata.title`; fall back to the top-level `name:`.
   - **Description** — the top-level `description:` (one line).
   - **Category** — `metadata.category`. Registry categories are an open vocabulary, but first-party-only values (`core`, `evolution`, `basics`) don't describe a third-party pack — if you see one of those, pick the closest community category (`dev`, `crypto`, `productivity`, `research`, `social`) from what the skill actually does. Otherwise pass the category through.
   - **Secrets** — `metadata.requires`. An entry ending in `?` is **optional** → `secrets_optional`; an entry without `?` is **required** → `secrets_required`. Strip the `?`. Registry `secrets_required` must be UPPER_SNAKE env names.
   - **Capabilities** — `metadata.capabilities`, copied verbatim (already the locked taxonomy; see `docs/CAPABILITIES.md`). Omit if absent.

   ```bash
   fm(){ sed -n '/^---$/,/^---$/p' "skills/$SLUG/SKILL.md"; }
   TITLE=$(fm | sed -n 's/^[[:space:]]*title:[[:space:]]*//p' | head -1)
   [ -z "$TITLE" ] && TITLE=$(fm | sed -n 's/^name:[[:space:]]*//p' | head -1)
   DESC=$(fm | sed -n 's/^description:[[:space:]]*//p' | head -1)
   CATEGORY=$(fm | sed -n 's/^[[:space:]]*category:[[:space:]]*//p' | head -1)
   ```
   Collect `requires:`/`capabilities:` list items (lines under those keys beginning with `    - `) into shell arrays; split `requires` into required (no `?`) and optional (trailing `?`, stripped).

3. **Build the pack repo locally.** Stage a clean working tree — the manifest at root, the full skill directory copied verbatim (including any helper scripts/config, not just `SKILL.md`), a README, and an MIT `LICENSE`:
   ```bash
   PACK_DIR=$(mktemp -d)/pack
   mkdir -p "$PACK_DIR/skills/$SLUG"
   cp -R "skills/$SLUG/." "$PACK_DIR/skills/$SLUG/"
   ```
   Write `$PACK_DIR/skills-pack.json` (build it with `python3`/`jq`, never string concatenation, so quoting is safe). Include only fields you actually have:
   ```json
   {
     "name": "<TITLE>",
     "version": "0.1.0",
     "description": "<DESC>",
     "author": "<operator github handle>",
     "license": "MIT",
     "homepage": "https://github.com/<owner>/<pack-repo>",
     "skills": [
       {
         "slug": "<SLUG>",
         "path": "skills/<SLUG>",
         "description": "<DESC>",
         "category": "<CATEGORY>",
         "schedule": "0 12 * * *",
         "default_enabled": false,
         "secrets_required": [ ... ],
         "secrets_optional": [ ... ],
         "capabilities": [ ... ]
       }
     ]
   }
   ```
   Write a `README.md` that names the skill, states its schedule assumption, lists required/optional secrets, and shows the one-line install (`bin/install-skill-pack <owner>/<pack-repo>`). Write a standard MIT `LICENSE` (year `${today}`'s year, copyright the operator handle). Resolve the operator handle once: `OWNER=$(gh api user --jq .login)`.

4. **Pre-flight the pack.** Run the repo's own validator against the staged directory — it enforces exactly what `bin/install-skill-pack` requires (valid JSON manifest, clean slug, no `..` in paths, the `SKILL.md` present, locked-taxonomy capabilities):
   ```bash
   ./scripts/validate-pack.sh "$PACK_DIR" 2>&1 | tee /tmp/pack-validate.txt
   ```
   Exit non-zero (an `ERROR:` line) → exit `PACK_SUBMIT_INVALID_PACK`, notify with the failing line, and stop. **Do not** push an invalid pack. Warnings are fine to proceed on; surface them in the notify.

   If `--dry-run` was passed, stop here: notify the operator that the pack built and validated cleanly at `$PACK_DIR`, list the manifest fields, and exit `PACK_SUBMIT_DRY_RUN` without touching GitHub.

5. **Create and push the pack repo.** Default repo name `aeon-skill-pack-$SLUG` (or the `--repo` override). The pack must be **public** — the installer fetches its tarball, and a private pack can't be installed by anyone else:
   ```bash
   PACK_REPO="${REPO_OVERRIDE:-aeon-skill-pack-$SLUG}"     # owner defaults to $OWNER
   gh repo view "$PACK_REPO" >/dev/null 2>&1 \
     && { ./notify "pack-submit aborted: repo $PACK_REPO already exists — pass --repo to pick another name"; exit 0; }
   ( cd "$PACK_DIR" && git init -q && git add -A \
       && git commit -q -m "Aeon community pack: $SLUG" \
       && gh repo create "$PACK_REPO" --public --source=. --push )
   ```
   Capture the resulting `owner/repo` (`FULL_REPO=$(gh repo view "$PACK_REPO" --json nameWithOwner --jq .nameWithOwner)`). If repo creation fails (permission/name), exit `PACK_SUBMIT_REPO_FAILED`, notify with the `gh` error's shortest decisive line, and stop.

6. **Submit the registry PR against `aeonfun/aeon`** (skip this whole step if `--no-register` was passed — then jump to step 7 reporting only the pack repo). The registry lives in the canonical repo, so work against a fork, not this instance's checkout — this instance's `catalog/skill-packs.json` can be stale, and the README counter must be accurate:
   ```bash
   WORK=$(mktemp -d)
   gh repo fork aeonfun/aeon --clone=true --default-branch-only 2>/dev/null || true
   git clone -q "https://github.com/$OWNER/aeon.git" "$WORK/aeon" || git clone -q https://github.com/aeonfun/aeon.git "$WORK/aeon"
   cd "$WORK/aeon" && git checkout -b "pack-submit/$SLUG"
   ```
   Make the two edits the validator (`scripts/validate-skill-packs.mjs`) checks for parity:

   **(a) `catalog/skill-packs.json`** — append one object to `.packs`. Build it with `jq` from the values you resolved (mirror the pack's own manifest: `skills` is `["$SLUG"]`, `trust_level` is `"community"`, aggregate `secrets_required`/`capabilities` from the skill):
   ```bash
   jq --arg repo "$FULL_REPO" --arg name "$TITLE" --arg desc "$DESC" \
      --arg author "$OWNER" --arg homepage "https://github.com/$FULL_REPO" \
      --arg cat "$CATEGORY" --arg slug "$SLUG" \
      '.packs += [ { repo:$repo, name:$name, description:$desc, author:$author,
        license:"MIT", homepage:$homepage, category:$cat, trust_level:"community",
        skills:[$slug] } ]' catalog/skill-packs.json > /tmp/reg.json \
     && mv /tmp/reg.json catalog/skill-packs.json
   ```
   Add `secrets_required` / `capabilities` keys to that object only when the skill declares them (keep it in sync with the pack manifest). Do **not** use `trust_level: trusted` — that requires the repo to be in `skills/security/trusted-sources.txt`, and the validator rejects an unearned `trusted`.

   **(b) `.github/README.md`** — add a table row under the `| Pack | Skills | Description |` header in the **Community Packs** section, and bump the `**N community skill packs**` counter (the Proof-of-work line). The row format, matching the existing rows exactly:
   ```
   | [<pack-repo-name>](https://github.com/<FULL_REPO>) | 1 | <one-line description, ≤110 chars>. |
   ```
   Use `python3` for a surgical insert. **The row must land inside the table's contiguous block** — insert it immediately *after the last existing `| [` row*, not after the blank line that ends the table and not before the `**To list a pack here**` paragraph. The parity validator parses rows only until the first non-`|` line, so a row placed past the blank line is invisible to it and the PR fails CI with "in the registry but has no row in the README table". Then increment the integer in the `**N community skill packs**` counter by 1. Verify with a re-read that the row sits among the other rows and the counter moved:
   ```python
   import re
   lines = open(".github/README.md").read().split("\n")
   sec = next(i for i,l in enumerate(lines) if re.match(r'^#+\s+Community Packs\s*$', l))
   hdr = next(i for i in range(sec,len(lines)) if re.match(r'^\|\s*Pack\s*\|\s*Skills\s*\|\s*Description\s*\|', lines[i]))
   i = hdr + 2; last = i
   while i < len(lines) and lines[i].startswith("|"): last = i; i += 1   # last data row
   lines.insert(last + 1, f"| [{PACK_NAME}](https://github.com/{FULL_REPO}) | 1 | {DESC} |")
   txt = re.sub(r'\*\*(\d+)\s+community skill packs\*\*',
                lambda m: f"**{int(m.group(1))+1} community skill packs**", "\n".join(lines), count=1)
   open(".github/README.md","w").write(txt)
   ```

   **Validate parity before committing** — this is the exact CI gate the PR will hit:
   ```bash
   node scripts/validate-skill-packs.mjs
   ```
   A non-zero exit → fix the reported mismatch (skill count, a missing row, or the counter) and re-run until it prints `validate-skill-packs: OK`. Never open the PR on a red validator.

   Then commit both files together, push the branch to your fork, and open the PR against the canonical repo:
   ```bash
   git add catalog/skill-packs.json .github/README.md
   git commit -m "feat: list $TITLE community pack ($FULL_REPO)"
   git push -u origin "pack-submit/$SLUG"
   PR_URL=$(gh pr create --repo aeonfun/aeon --title "feat: list $TITLE community pack" --body "$(cat <<BODY
   ## New community pack

   **Pack:** [$FULL_REPO](https://github.com/$FULL_REPO)
   **Skill:** \`$SLUG\` — $DESC
   **Author:** @$OWNER · **License:** MIT · **Category:** $CATEGORY

   Adds a row to the README Community Packs table and a matching \`catalog/skill-packs.json\` entry (both in this diff, per the publishing checklist). \`node scripts/validate-skill-packs.mjs\` passes locally.

   Install once merged:
   \`\`\`
   bin/install-skill-pack $FULL_REPO
   \`\`\`
   BODY
   )")
   ```
   Capture `PR_URL`. If `gh pr create` fails because a PR already exists for the branch, capture the existing URL instead of erroring. This PR is **not** self-merging — it lands in someone else's repo and is reviewed by the aeon maintainers.

7. **Log.** Append to `memory/logs/${today}.md`:
   ```
   ### pack-submit
   - Skill: {SLUG} ({TITLE})
   - Pack repo: https://github.com/{FULL_REPO}
   - Registry PR: {PR_URL or "skipped (--no-register)"}
   - Secrets: {required list or "none"} · Capabilities: {list or "none"}
   - Exit: PACK_SUBMIT_OK (or the code that applied)
   ```

8. **Notify.** Send one concise line via `./notify` (≤4000 chars, clickable URLs):
   ```
   *pack-submit — {TITLE}*
   Pack repo: https://github.com/{FULL_REPO}
   Registry PR: {PR_URL}
   Install: `bin/install-skill-pack {FULL_REPO}`
   {"Requires: X, Y" if any required secrets, else omit}
   ```
   On `--no-register`, say the pack repo is live and give the exact PR checklist link (`docs/community-skill-packs.md#pack-maintainers-publishing-checklist`) so the operator can list it manually.

## Exit taxonomy

| Code | When | Action |
|------|------|--------|
| `PACK_SUBMIT_OK` | Pack repo pushed and registry PR opened (or `--no-register` completed) | Notify with pack repo + PR link |
| `PACK_SUBMIT_NO_VAR` | `${var}` empty | Notify abort reason; stop |
| `PACK_SUBMIT_BAD_VAR` | Slug malformed or `skills/<slug>/SKILL.md` missing | Notify with the slug; stop |
| `PACK_SUBMIT_INVALID_PACK` | `validate-pack.sh` reported an ERROR | Notify with the failing line; stop (nothing pushed) |
| `PACK_SUBMIT_DRY_RUN` | `--dry-run` — built + validated, wrote nothing to GitHub | Notify with the staged path + manifest summary |
| `PACK_SUBMIT_REPO_FAILED` | `gh repo create` failed (name taken, permission) | Notify with the gh error; stop |
| `PACK_SUBMIT_REGISTRY_FAILED` | Fork/clone/validate/PR step failed after the pack repo was pushed | Notify: pack repo is live, registry PR did not open, with the failing step |

## Network note

There is no network sandbox — `git` and `gh` reach GitHub directly. `gh` is authenticated in Actions (via `GH_GLOBAL` when set; the ambient `GITHUB_TOKEN` otherwise, which **cannot** create repos or cross-repo PRs — surface that as `PACK_SUBMIT_REPO_FAILED` rather than looping). Every irreversible outward write — creating the public pack repo (step 5) and opening the registry PR (step 6) — happens **in-run** and is fail-closed: a failed pre-flight (`validate-pack.sh`) or a failed parity check (`validate-skill-packs.mjs`) stops before any push. Confirm reachability with `gh api repos/aeonfun/aeon --jq .full_name` before deciding a fork/clone failure is real vs transient.

## Constraints

- **Publish only skills that already exist in `skills/`.** This skill packages and distributes; it does not author. To create a new skill, use `create-skill`.
- **The pack repo must be public** — the installer fetches its tarball; a private pack is uninstallable by others.
- **Never** register with `trust_level: trusted` — that is earned via `skills/security/trusted-sources.txt`, and the validator rejects a self-declared `trusted`. Community packs use `trust_level: community`.
- **Never** open the registry PR on a red `validate-skill-packs.mjs` — a broken registry entry takes down `bin/install-skill-pack --list` and the dashboard panel for everyone.
- **Keep the two registry surfaces in lockstep** — the README row and the `skill-packs.json` entry ship in one diff, with matching skill counts and the counter bumped. That is what the CI gate enforces.
- **Don't leak secret values.** The manifest lists secret **names** only (from the skill's `requires:`), never values.
