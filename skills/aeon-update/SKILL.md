---
name: aeon-update
description: Pull framework updates from the upstream Aeon repo into this instance - 3-way merges canon's new commits into a PR, never clobbering operator config.
metadata:
  title: Aeon Update
  category: core
  var: ""
  tags:
    - dev
    - meta
  cron: "0 11 * * 1"
  mode: write
---
> **${var}** — mode selector; space-separated tokens, order-independent, all optional:
> - **mode** (`sync` | `report`, default `sync`) — `sync` opens a PR with the framework changes; `report` computes the delta and notifies, mutating nothing (dry run).
> - **`repo=owner/name`** — override the upstream source repo (else auto-resolved from this instance's `parent`, falling back to `aeonfun/aeon`).
> - **`reset=<sha|fork-point>`** — force the stored baseline to `<sha>` (or the merge-base with upstream) before running. Recovery / backfill lever.
>
> Empty ⇒ **sync** from the auto-resolved upstream. Examples: `` · `report` · `repo=aeonfun/aeon` · `reset=fork-point`.

Today is ${today}. This is the fleet's **downstream updater** - the counterpart to `fork-fleet`. `fork-fleet` looks *outward* from the parent to find work in the forks worth pulling *up*; this skill runs *inside* an instance and pulls the parent's shipped framework changes *down* - new skills, script/harness fixes, workflow and doc updates - and lands them as a reviewable PR. It is how an instance stays current with `aeonfun/aeon` without a hand-run rsync-overlay rebase.

## Operating principles

- **PR, never push to `main`.** Every framework change ships as one reviewable PR. The operator merges.
- **Never clobber operator config.** `aeon.yml`, `STRATEGY.md`, `soul/`, `memory/`, `output/`, `.mcp.json` and the git-derived catalogs are instance-owned. Upstream changes to them are **surfaced for manual review in the PR body**, never written into the tree.
- **3-way, not blind overwrite.** A framework file the operator has already customized is a **conflict** - it is listed with the upstream diff for a human to merge, not overwritten.
- **Silent when in sync.** Baseline == upstream HEAD ⇒ nothing to do, no notification.
- **The baseline is the watermark, and it advances by merge.** The new baseline SHA is written *into the PR branch*, so the watermark only moves when the operator merges the PR. Unresolved conflicts are tracked separately so advancing the baseline can never silently drop them.

---

## Steps

### S0. Bootstrap + load state

```bash
mkdir -p memory/topics
[ -f memory/topics/aeon-update-state.json ] || echo '{"baseline_sha":null,"upstream":null,"last_run":null,"last_pr":null,"pending_conflicts":[]}' > memory/topics/aeon-update-state.json
```

Read `memory/MEMORY.md` for context and scan the last ~3 days of `memory/logs/` - drop anything already reported so a repeat run isn't re-sent. Read the state file:
- `BASELINE` = `.baseline_sha` (the upstream commit this instance was last synced to).
- `PENDING` = `.pending_conflicts` (files surfaced as conflicts in a prior run, not yet resolved).

### S1. Parse `${var}`

- `MODE` = `report` if the token `report` (or `dry`) is present, else `sync`.
- `REPO_OVERRIDE` = value of a `repo=owner/name` token, if any.
- `RESET` = value of a `reset=` token, if any (`fork-point` or a 7-40 char SHA).

### S2. Resolve the upstream source

```bash
SELF=$(gh repo view --json nameWithOwner -q .nameWithOwner)
UPSTREAM="${REPO_OVERRIDE:-$(gh api "repos/${SELF}" --jq '.parent.full_name // empty')}"
[ -z "$UPSTREAM" ] && UPSTREAM="aeonfun/aeon"
```

If `UPSTREAM` == `SELF`, this instance **is** canon - there is nothing upstream to pull. Write status `AEON_UPDATE_IS_UPSTREAM` to `memory/logs/${today}.md`, send **no** notification, and stop.

```bash
UP_DEFAULT=$(gh api "repos/${UPSTREAM}" --jq '.default_branch')
HEAD_SHA=$(gh api "repos/${UPSTREAM}/commits/${UP_DEFAULT}" --jq '.sha')
```

### S3. Establish / reset the baseline

- **`reset=fork-point`** → `BASELINE=$(gh api "repos/${UPSTREAM}/compare/${HEAD_SHA}...$(git rev-parse HEAD)" --jq '.merge_base_commit.sha')`. `reset=<sha>` → `BASELINE=<sha>`. Persist immediately to state, then continue.
- **First run (`BASELINE` null and no `reset`):** a fresh instance already carries all of canon from fork time, so there is no delta to apply - just **anchor the watermark**. Set `baseline_sha = HEAD_SHA`, write state, log `AEON_UPDATE_BASELINE_SET`, send a one-line notify (`baseline initialized at <head7>; future runs sync from here`), and stop. (To backfill everything since the fork point instead, re-run with `reset=fork-point`.)
- **`BASELINE` == `HEAD_SHA`:** in sync. Re-verify `PENDING` (S8) in case a prior conflict is now resolved, update state, log `AEON_UPDATE_IN_SYNC`, notify nothing, stop.

### S4. Compare baseline → HEAD

```bash
gh api "repos/${UPSTREAM}/compare/${BASELINE}...${HEAD_SHA}" --jq '{
  ahead: .ahead_by, behind: .behind_by, status,
  commits: [.commits[]? | {sha: .sha[0:7], msg: (.commit.message | split("\n")[0]), date: .commit.author.date}],
  files:   [.files[]?   | {filename, status, previous_filename, additions, deletions}]
}' > /tmp/aeon-update-compare.json
```

Error handling:
- **404 / `status: "diverged"` with no merge base** (baseline not an ancestor of HEAD - history rewrite or unrelated repo): stop with `AEON_UPDATE_BASELINE_UNREACHABLE`; notify the operator to re-run with `reset=fork-point` or `reset=<sha>`.
- Cross-repo compare returns at most **300 files**; if `.files` looks truncated, note `files_truncated=true` in the report - the operator can run again after merging to pick up the remainder.

### S5. Partition changed files

Classify every entry in `.files` by path. A file is **OPERATOR-owned** (surfaced, never auto-written) if its path matches any of:

```
aeon.yml            STRATEGY.md         soul/**             memory/**
output/**           .mcp.json           .env*               aeon.db
skills.lock         eyebrowlock.json    catalog/*.json      .claude/**  (except .claude/skills/aeon/**)
apps/dashboard/outputs/**
```

Everything else is **OWNED** (a candidate for auto-apply): `skills/**`, `scripts/**`, `bin/**`, `harness-adapter/**`, `.github/**`, `apps/**` (except `apps/dashboard/outputs/**`), `CLAUDE.md`, `AGENTS.md`, `docs/**`, `.github/README.md`, `LICENSE`, `CHANGELOG.md`, `.gitignore`, `eyebrow.policy.json`, and tracked root helpers (`aeon`, ...).

`catalog/*.json` and `eyebrowlock.json` are OPERATOR-owned here **only** so they are never blindly copied - they are **regenerated** from the synced sources in S7, which is the correct way to reconcile them.

### S6. 3-way classify each OWNED file

Set up a workspace and, for each OWNED file `f`, fetch upstream's HEAD and BASELINE blobs:

```bash
WORK=$(mktemp -d)
fetch() { gh api "repos/${UPSTREAM}/contents/$1?ref=$2" --jq '.content' 2>/dev/null | base64 -d; }   # $1=path $2=ref
h() { sha256sum 2>/dev/null | cut -d' ' -f1; }
```

Decide `f`'s disposition from its `status` and a content 3-way (local-current vs upstream@BASELINE vs upstream@HEAD):

| `status` | Test | Disposition |
|----------|------|-------------|
| `added` | path absent locally | **CLEAN-ADD** (write HEAD blob) |
| `added` | path present locally (collision, e.g. a fork-only skill) | **CONFLICT** |
| `modified` | `sha256(local) == sha256(HEAD blob)` | already synced → **SKIP** |
| `modified` | `sha256(local) == sha256(BASELINE blob)` (operator never touched it) | **CLEAN-UPDATE** (write HEAD blob) |
| `modified` | otherwise (operator customized it) | **CONFLICT** |
| `removed` | `sha256(local) == sha256(BASELINE blob)` | **CLEAN-DELETE** (`git rm`) |
| `removed` | local differs or absent | **CONFLICT** (or already gone → SKIP if absent) |
| `renamed` | treat as `removed previous_filename` + `added filename` under the rules above | per-part |

Never CLEAN-DELETE a `skills/<name>/` directory whose `<name>` is not present in upstream's tree - fork-only skills are operator work and are structurally untouched (upstream's compare can only reference paths that exist upstream).

### S7. Apply CLEAN changes on a branch (sync mode only)

If `MODE == report`, skip to S9. Otherwise:

```bash
BR="aeon-update/sync-$(echo "$HEAD_SHA" | cut -c1-7)"
git checkout -b "$BR"
```

Write every **CLEAN-ADD** / **CLEAN-UPDATE** (`mkdir -p "$(dirname f)"` then write the HEAD blob to `f`) and `git rm` every **CLEAN-DELETE**. **CONFLICT** and **OPERATOR** files are *not* touched - they go in the PR body only.

If any `skills/**` path was applied, regenerate the derived catalogs from the synced sources (never copy them from upstream):

```bash
bin/generate-skills-json && bin/generate-packs-json && bin/generate-skill-icons
node scripts/gen-agents-md.js || true
```

Refresh the integrity lock so `ci-skill-integrity` stays green for any added/edited skill, then validate config:

```bash
node scripts/validate-config.js aeon.yml || echo "validate-config flagged (may be pre-existing drift; note, do not abort on it)"
```

If **nothing CLEAN applied** (every upstream change was CONFLICT or OPERATOR): open no PR. Fold all changes into the report, log `AEON_UPDATE_MANUAL_ONLY`, and go to S10 (notify the operator that the sync needs a manual merge). If a file we wrote breaks YAML/JSON parsing, abort: `git checkout . && git checkout ${UP_DEFAULT} && git branch -D "$BR"`, exit `AEON_UPDATE_VALIDATION_FAILED`, notify with the failing file.

### S8. Advance the baseline + reconcile conflicts (in the branch)

Recompute `PENDING`: for every CONFLICT file this run **plus** every prior `PENDING` entry, keep it only if `sha256(local) != sha256(HEAD blob)` (still genuinely divergent). Drop the rest (resolved).

Write `memory/topics/aeon-update-state.json` and commit it **with** the sync so merging advances the watermark:

```json
{
  "baseline_sha": "${HEAD_SHA}",
  "upstream": "${UPSTREAM}",
  "last_run": "${today}",
  "last_pr": null,
  "applied": { "added": N, "updated": N, "deleted": N },
  "pending_conflicts": [
    { "path": "scripts/foo.sh", "reason": "operator-customized", "upstream_commits": ["abc1234"] }
  ]
}
```

Advancing `baseline_sha` to HEAD means clean files never re-notify, while `pending_conflicts` carries unresolved merges forward independently - so they resurface each run until the operator actually reconciles them, and are also written to the PR body. (In `report` mode, do **not** write state - a dry run mutates nothing.)

### S9. Commit + open the PR (sync mode; skip in report mode)

```bash
git add -A
git commit -F /tmp/aeon-update-commit.txt      # never inline the message with -m (backticks/`$()` in commit text get shell-substituted)
git push -u origin "$BR"
gh pr create --repo "$SELF" --base "$UP_DEFAULT" \
  --title "aeon-update: sync ${N_COMMITS} upstream commits (${BASE7}..${HEAD7})" \
  --body-file /tmp/aeon-update-pr-body.md
```

`/tmp/aeon-update-commit.txt`:
```
aeon-update: sync upstream ${BASE7}..${HEAD7}

${N_COMMITS} upstream commits from ${UPSTREAM}. ${N_APPLIED} files applied cleanly, ${N_CONFLICT} need manual review. Baseline advanced to ${HEAD7}.
```

PR body (`/tmp/aeon-update-pr-body.md`) - only include sections that have content:
```markdown
## Upstream sync: `${UPSTREAM}` `${BASE7}..${HEAD7}`

**${N_COMMITS} commits** ({earliest date} → {latest date}) · **${N_APPLIED} applied** · **${N_CONFLICT} manual** · baseline → `${HEAD7}`.

### Applied cleanly
- **New skills:** `foo`, `bar`   _(regenerated catalogs + agents.md + skill-icons)_
- **Modified skills:** `baz`
- **Scripts / harness:** `scripts/notify.sh`, ...
- **Workflows:** `.github/workflows/...`
- **Docs / other:** `docs/...`, `CLAUDE.md`, ...

### Needs manual review (conflicts - your local copy diverges from upstream)
For each: what upstream changed and why it wasn't auto-applied.
- `scripts/foo.sh` — you customized this locally; upstream changed it in {commits}. Upstream diff:
  ```diff
  {short upstream base..head diff for the file}
  ```

### Operator config changed upstream (not auto-applied - reconcile by hand)
- `aeon.yml` — upstream added skills / changed defaults: {summary}. Merge the new entries you want (keep your enable/schedule/model choices).
- `soul/…`, `STRATEGY.md` — {summary, if changed}

### Upstream commits
| SHA | Summary |
|-----|---------|
| abc1234 | ... |
```

Capture the PR URL; write it back into `last_pr` in the branch's state file (amend the state commit) so the merged watermark records its own PR.

### S10. Log + notify

Append to `memory/logs/${today}.md` under `### aeon-update`: status, `UPSTREAM`, `${BASE7}..${HEAD7}`, applied/conflict counts, PR URL (or `report`/`manual-only`), and `pending_conflicts` count.

**Notify only on signal** - match `soul/` voice if present. Send when there is a PR, a report with changes, or a manual-only situation; stay silent for `IN_SYNC` / `BASELINE_SET`-with-nothing. Keep it ≤4000 chars:

```
*aeon-update — ${today}*
{verdict: "synced N commits → PR" | "N changes need manual merge" | "report: N commits behind"}

Upstream `${UPSTREAM}` is ${AHEAD} commits ahead. Applied ${N_APPLIED} cleanly, ${N_CONFLICT} need review.
{Top applied highlight: e.g. "new skill: `token-radar`; harness fix in run-harness"}
{If conflicts: "Manual: `aeon.yml` (new skills), `scripts/foo.sh` (local edit)"}

PR: {url}   (or "dry run — nothing changed")
```

Pass `--mute-key "aeon-update:${HEAD7}"` so a muted sync doesn't re-ping for the same upstream HEAD.

## Exit taxonomy

| Code | When | Notify |
|------|------|--------|
| `AEON_UPDATE_OK` | PR opened with ≥1 clean file (conflicts, if any, listed in it) | Yes - PR link |
| `AEON_UPDATE_MANUAL_ONLY` | Upstream changed only operator-owned / conflicting files - no clean apply, no PR | Yes - manual call-out |
| `AEON_UPDATE_REPORT` | `report` mode - delta computed, nothing mutated | Yes - dry-run summary |
| `AEON_UPDATE_IN_SYNC` | Baseline already == upstream HEAD | No (log only) |
| `AEON_UPDATE_BASELINE_SET` | First run - watermark anchored, nothing applied | One-line notify |
| `AEON_UPDATE_IS_UPSTREAM` | This instance is the upstream repo itself | No (log only) |
| `AEON_UPDATE_BASELINE_UNREACHABLE` | Baseline is not an ancestor of HEAD (history rewrite) | Yes - asks for `reset=` |
| `AEON_UPDATE_VALIDATION_FAILED` | An applied file broke YAML/JSON parsing → branch reverted | Yes - failing file |

## Constraints

- **Never** push to `main` or auto-write an OPERATOR-owned path (`aeon.yml`, `soul/`, `memory/`, `STRATEGY.md`, `.mcp.json`, `output/`).
- **Never** delete a fork-only skill, and **never** copy `catalog/*.json` / `eyebrowlock.json` from upstream - regenerate them.
- **Never** advance `baseline_sha` without carrying unresolved conflicts forward in `pending_conflicts`.
- Cross-repo compare caps at 300 files - note `files_truncated=true` and let a follow-up run pick up the rest.
- A clean, in-sync run is **correct**, not a failure - it notifies nothing.

## Network note

Every network call is `gh api`, which authenticates via `GITHUB_TOKEN` automatically - no `curl`, no `./secretcurl`, no `$SECRET` on the command line for the Bash permission layer to refuse, and no secret beyond the default `GITHUB_TOKEN`. There are no irreversible side-effects: the skill's only mutation is a PR against this instance's own repo, which the operator reviews and merges. Retry policy: on `403` with `X-RateLimit-Remaining: 0`, sleep 60s and retry once; on a persistent contents-API failure for one file, mark it `UNREADABLE` in the report and continue with a partial sync rather than aborting the whole run.
