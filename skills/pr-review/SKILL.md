---
name: pr-review
description: Review open PRs two ways - default is a per-PR deep review with severity-tagged findings, inline comments, and a verdict; --survey runs a risk-tiered triage digest of what's safe to merge first
metadata:
  title: PR Review
  category: basics
  var: ""
  tags:
    - dev
    - community
---
<!-- autoresearch: variation B — sharper output: severity-tagged & capped findings, inline comments on exact lines, one-line verdict; folds in skip rules (A) and SHA dedup + large-diff fallback (C). Absorbs pr-merge as the `--survey` risk-tiered triage-digest branch (no capability lost). -->

> **${var}** — Selects the branch and scopes it.
> - **Default (no `--survey`)** → per-PR deep review. `${var}` empty reviews every repo in `memory/watched-repos.md`; `${var}=owner/repo` scopes the review to a single repo.
> - **`--survey`** (alias `survey`) → risk-tiered triage digest (the former `pr-merge`). In this branch the remaining tokens follow pr-merge's grammar: pass `dry-run` to skip notify (article + state still write), pass `owner/repo` to override the target repo, combine with a space (`--survey dry-run owner/repo`). Empty target = `aeonfun/aeon`.
>
> Examples: `` (review every watched repo) · `owner/repo` (review one repo) · `--survey` (triage digest of aeonfun/aeon) · `--survey dry-run` (refresh digest, no notify) · `--survey owner/repo` (triage a specific repo).

## Shared preamble (every run)

Read `memory/MEMORY.md` for high-level context. Scan the last ~3 days of `memory/logs/` for recent activity and to avoid re-reporting the same signal.

**Parse `${var}` → branch:** split `${var}` on whitespace.
- If a `--survey` or `survey` token is present → **SURVEY branch** (jump to "Survey branch"). Remove that token; the remaining tokens are parsed by the survey branch (`dry-run`, `owner/repo` override, unknown → BAD_VAR).
- Otherwise → **REVIEW branch** (default; continue below). The remaining `${var}` is an optional `owner/repo` scope (empty = every watched repo).

The two branches never share mutation logic: the REVIEW branch posts PR comments/reviews via `gh`; the SURVEY branch writes the digest article + state file and (gated) notifies — neither performs an actual `gh pr merge`. Dispatch to exactly one branch per run.

---

# REVIEW branch (default) — per-PR deep review

Read `memory/MEMORY.md` and `memory/watched-repos.md`.
Read the last 2 days of `memory/logs/` to pull the `headRefOid` of any PR reviewed recently — used for dedup.

If `${var}` names an `owner/repo`, review only that repo. Otherwise review every repo listed in `memory/watched-repos.md`.

If `memory/watched-repos.md` is empty or missing (and no `owner/repo` was passed), log `PR_REVIEW_NO_REPOS` and end.

## What this branch optimizes for

Noise is the documented failure mode of automated PR review. Every finding emitted must be severity-tagged, line-specific, and justified with a one-sentence "why it matters". If there is nothing worth saying, say so in one line and move on.

## For each repo

```bash
gh pr list -R owner/repo --state open --limit 20 \
  --json number,title,author,isDraft,labels,headRefOid,updatedAt
```

### Skip rules

Skip a PR if any of the following hold (record the skip reason for the run summary):

- `isDraft: true`
- title matches `^(WIP|\[WIP\]|Draft:)` (case-insensitive)
- has label `no-review`, `do-not-merge`, `wip`, or `blocked`
- author login contains `[bot]` (dependabot, renovate, etc.) or equals `aeonframework`
- this PR's current `headRefOid` already appears in the last 2 days of `memory/logs/` against the same PR (already reviewed at this commit)
- a bot reviewer (`coderabbitai`, `copilot-pull-request-reviewer`, `claude`) posted a review in the last 30 min — skip to avoid piling on. Check via:
  ```bash
  gh api repos/owner/repo/pulls/NUMBER/reviews --jq '.[] | {user: .user.login, submitted_at}'
  ```

### For each remaining PR

1. **Fetch context**:
   ```bash
   gh pr view NUMBER -R owner/repo \
     --json title,body,headRefOid,baseRefName,files,additions,deletions
   ```
   If the `body` contains `Fixes #N` or `Closes #N`, fetch the linked issue for context:
   ```bash
   gh issue view N -R owner/repo --json title,body,labels
   ```

2. **Fetch the diff**:
   ```bash
   gh pr diff NUMBER -R owner/repo
   ```
   - If `additions + deletions > 3000`, review only the top-5 largest-delta files from the `files` array (not the full diff).
   - If `gh pr diff` fails, fall back to per-file patches:
     ```bash
     gh api repos/owner/repo/pulls/NUMBER/files --jq '.[] | {path, patch}'
     ```
   - If the diff comes back empty (e.g. mid-rebase), skip the PR with reason `empty-diff`.

3. **Early-exit for trivial PRs**: if the diff is docs-only (`.md`/`.rst`/`docs/**`), lockfile-only, or test-only, skip deep review and post the 1-line ack form in step 6.

4. **Review with severity tagging**. Every finding must carry exactly one tag:
   - `[CRITICAL]` — correctness break, security hole, data loss, API break, regression
   - `[ISSUE]` — likely bug, missing edge case, wrong behavior under a realistic input
   - `[NIT]` — naming, style, minor cleanup (dropped by default)

   Rules:
   - Cap at **5 findings total** per PR. Drop NITs first, then the lowest-impact ISSUEs.
   - Drop all NITs unless there are zero CRITICAL/ISSUE findings *and* a NIT is genuinely useful.
   - Every finding must name `path/to/file:LINE` and include a one-sentence "why it matters" — the consequence, not just "this is wrong".
   - No praise, no diff restating, no "this PR adds X" summaries.

5. **Determine a verdict**:
   - `approve-ready` — no CRITICAL, no ISSUE
   - `blocked: <one-phrase reason>` — at least one CRITICAL
   - `discussion-needed` — ISSUE findings but no CRITICAL

6. **Post the review**. Send **both** a consolidated summary comment *and* inline line-specific comments — inline for precision, summary for consumers that parse review bodies.

   For each line-specific finding:
   ```bash
   gh api repos/owner/repo/pulls/NUMBER/comments \
     -f body="[SEVERITY] finding text — why it matters" \
     -f path="path/to/file" \
     -f commit_id="$HEAD_SHA" \
     -F line=LINE_NUMBER \
     -f side="RIGHT"
   ```

   Then the consolidated summary as a review — include the verdict **and** a bulleted recap of every inline finding (severity + `file:line` + one-sentence rationale), so downstream body-parsers don't miss them:
   ```bash
   gh pr review NUMBER -R owner/repo --comment --body "**Verdict**: <verdict>
<one-line rationale if blocked or discussion-needed; omit if approve-ready>

**Findings** (mirrored as inline comments):
- [CRITICAL] path/to/file:LINE — why it matters
- [ISSUE] path/to/file:LINE — why it matters"
   ```

   If there are no CRITICAL/ISSUE findings, skip inline comments and post a single-line review: `**Verdict**: approve-ready — no blockers.`

   For trivial-PR early-exits (step 3), post a single-line review matching the category: `Docs-only change — no blockers.` / `Dependency-bump — no review needed.` / `Test-only change — no production code touched.`

   **Fallback**: if inline-comment creation fails (missing permissions, commit_id mismatch), consolidate all findings into the review body, preserving the severity tags and `file:line` refs. Do not silently drop findings.

## Notify and log (REVIEW branch)

Send **one** combined message per run via `./notify`:
```
*PR Review — ${today}*
Reviewed N, skipped K (drafts: x, bots: y, dup-SHA: z, bot-reviewed-recently: w).
- owner/repo#123: [verdict] — N critical, M issues
```

**Telegram summary.** When the run was scoped to a **single repo** (`${var}=owner/repo`), send a Telegram summary of the review with `./notify -f review.md` so the operator sees the verdict at a glance. Skip it on an all-repos run.

If every PR was skipped, do not notify — just log.

Log to `memory/logs/${today}.md` under the shared `### pr-review` heading with a mode discriminator:
```
### pr-review
- **Mode**: review (per-PR deep review)
- owner/repo#123 (SHA abc1234): [verdict] — N critical, M issues
- Skipped: owner/repo#124 (draft), owner/repo#125 (bot-reviewed-recently)
```

If no open PRs across all repos, log `PR_REVIEW_OK` and end.

---

# SURVEY branch (`--survey`) — risk-tiered triage digest

*(This is the former `pr-merge` skill, folded in verbatim. It surveys the queue and buckets by blast radius; it does **not** merge anything — `auto-merge` owns the actual-merge action behind its own author-allowlist + size-cap + branch-protection policy. This branch is the decision-support layer that lives *before* auto-merge, sized for the much larger pool of PRs auto-merge's safety policy intentionally skips.)*

Today is ${today}. The open-PR queue on `aeonfun/aeon` has crossed the threshold where a human reviewer working alone falls behind: yesterday (June 1) eighteen PRs were merged in a single 37-minute Monday catch-up window, but on every prior weekend day they stacked up untouched. As community skill packs become the primary contribution model and external contributors keep landing skill PRs every other day, the queue's *steady-state* size will keep climbing — `skill-scan` evaluates one inbound skill PR at a time, but no skill answers the operator's actual morning question: *"of the N open PRs right now, which N1 can I merge in one click and which N2 need real review?"*

This branch is that answer. It surveys every open PR on a target repo, categorises each by the files it touches, runs `scripts/skill-scan.sh` against every changed `SKILL.md` (same scanner `skill-scan` reuses verbatim), and emits one structured Telegram digest with four risk buckets sorted by PR age. The operator can fire-and-forget the FAST_TRACK bucket, glance at SKILL_PASS, and budget real attention for INFRA_REVIEW + SKILL_WARN_OR_BLOCK + CORE_REVIEW.

Read `memory/MEMORY.md` for context.
Read the last 8 days of `memory/logs/` for prior-run context (skip if dispatched).
Read `soul/SOUL.md` + `soul/STYLE.md` if populated to match voice in the notification.

## Why a separate branch from pr-triage / skill-scan / auto-merge

| Skill | Scope | Action |
|-------|-------|--------|
| `pr-triage` | Per external PR, first-touch | Welcomes + labels + leaves a verdict comment |
| `skill-scan` | One skill-PR (workflow_dispatch var=PR_NUMBER) | Posts a structured per-skill security/secrets/conflict comment |
| `auto-merge` | All bot-authored PRs that pass a strict safety policy | Merges if CLEAN |
| **`pr-review --survey`** | **All open PRs across the watched-repos queue** | **One operator-facing digest sorted by risk + age — no per-PR comment, no merge action** |

The four compose. `pr-triage` runs once per PR open; `skill-scan` runs on demand per skill PR; `auto-merge` runs against the bot subset; this survey branch is the **morning brief** over everything else — the open backlog the operator still has to think about. Building a fifth verdict layer into any of the existing three would either bloat their per-PR cost or skip the operator-overview question entirely.

## Inputs

| Source | Purpose | Auth |
|--------|---------|------|
| `gh api repos/{repo}/pulls?state=open&per_page=100 --paginate` | Open PR list with author, draft state, base ref, age, mergeable state, head SHA, statusCheckRollup summary, labels | `GH_TOKEN` |
| `gh api repos/{repo}/pulls/{N}/files?per_page=100 --paginate` | Per-PR list of changed file paths + status (added/modified/removed) — the only signal we trust for bucketing | `GH_TOKEN` |
| `gh api repos/{repo}/contents/{path}?ref={head_sha}` | Each changed `SKILL.md` body — fed to `scan.sh` for PASS/WARN/BLOCK verdict | `GH_TOKEN` |
| `scripts/skill-scan.sh` (local) | Scanner reused verbatim (no fork, no shadow copy) — same source `skill-scan` reuses | Local script |
| `memory/watched-repos.md` (local) | Read only the `## Trusted Authors` section — those authors' PRs surface in a separate `TRUSTED_AUTHOR` row that bypasses the FAST_TRACK / CORE_REVIEW buckets | Local file |

No new secrets. GitHub access via `gh` CLI (`GH_TOKEN`) per CLAUDE.md.

Writes:
- `output/articles/pr-merge-${today}.md` — full digest with one row per open PR, sortable by bucket + age (every non-error run, including `QUIET`)
- `memory/topics/pr-merge-state.json` — prior-run snapshot (per-PR bucket + first_seen date + last_head_sha, used to suppress re-notification on the same head SHA)
- `memory/logs/${today}.md` — one log block per run
- Notification via `./notify` — only when ≥1 new PR appeared in a non-FAST_TRACK bucket since the last run, or a SKILL_BLOCK / CORE_REVIEW PR is present and operator has not been notified about it on this head SHA yet, or it's the first (baseline) run (see step 8)

## Steps

### 0. Bootstrap

```bash
mkdir -p memory/topics output/articles
[ -f memory/topics/pr-merge-state.json ] || cat > memory/topics/pr-merge-state.json <<'EOF'
{"last_run":null,"last_status":null,"last_repo":null,"prs":{}}
EOF
```

If `jq empty` fails on the state file (corrupt JSON from an aborted write), back it up to `.bak`, reset to the empty template, and tag the run `STATE_CORRUPT`. Continue — a fresh state file means re-notifying every currently-open PR as "new" on this one run, which is the safer post-corruption outcome than silently skipping a SKILL_BLOCK PR the operator hadn't seen yet.

`prs` is a map keyed by `<owner>/<repo>#<number>`: `{bucket, scan_verdict, head_sha, first_seen, last_notified_head_sha, age_days, author, draft}`. Cap to 200 most-recent entries (LRU by `first_seen`) so a long-lived state file can't grow unbounded.

### 1. Parse var (survey grammar)

The `--survey`/`survey` token has already been consumed by the shared preamble. Parse the remaining tokens:

- Tokens: `dry-run`, anything matching `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$` (treated as `REPO_OVERRIDE`), anything else.
- If any unknown token is present → log `PR_MERGE_QUEUE_BAD_VAR: ${var}` and exit (no writes, no notify).
- `DRY_RUN=yes` if the `dry-run` token is present, else `no` (execute).
- `TARGET_REPO=${REPO_OVERRIDE:-aeonfun/aeon}`.

### 2. Pull the open-PR list

```bash
gh api "repos/${TARGET_REPO}/pulls?state=open&per_page=100" --paginate \
  --jq '[.[] | {number, title, user_login: .user.login, draft, base_ref: .base.ref, head_sha: .head.sha, created_at, updated_at, mergeable_state, labels: [.labels[].name]}]' \
  > /tmp/pr-merge-prs.json
```

If `gh api` fails (non-zero exit) → log `PR_MERGE_QUEUE_API_FAIL: pulls list`, write a one-line notification (`pr-review --survey: GitHub API failed listing open PRs for ${TARGET_REPO}`), exit `API_FAIL`. The pulls endpoint is the floor — if it can't be read, every downstream step is meaningless.

Empty list → write the article + state with all buckets at zero, log `PR_MERGE_QUEUE_EMPTY`, **skip notify** (an empty queue is not news), exit `EMPTY`.

Bot/trusted-author short-circuit: build `TRUSTED_LOGINS` from the `## Trusted Authors` section of `memory/watched-repos.md` (one login per `- ` bullet). Always include the bot logins `dependabot[bot]`, `renovate[bot]`, `github-actions[bot]`, plus `aeonframework` and `aeonfun`. PRs whose `user_login` is in this set get categorised `TRUSTED_AUTHOR` and bypass the file-bucket logic in step 4 (auto-merge handles them; surfacing them in the operator's risk view would only add noise).

### 3. Per-PR files fetch

For each PR (skip drafts and skip TRUSTED_AUTHOR PRs in this step — drafts are signals the contributor isn't done; trusted-author PRs route through auto-merge):

```bash
gh api "repos/${TARGET_REPO}/pulls/${PR_NUMBER}/files?per_page=100" --paginate \
  --jq '[.[] | {filename, status}]' \
  > "/tmp/pr-merge-files-${PR_NUMBER}.json"
```

If the files endpoint fails for a single PR → tag the PR `bucket=UNKNOWN`, `scan_verdict=files_api_fail`, skip its scan but **keep it in the digest** as an UNKNOWN row at the bottom (silently dropping a PR from a triage digest is the failure mode this skill exists to prevent). Continue to the next PR.

### 4. Bucket by touched files

Apply this rubric in order (first match wins). The rubric is conservative — when in doubt, escalate, never the other way.

| Bucket | Match condition | Rationale |
|--------|-----------------|-----------|
| **CORE_REVIEW** | Any changed path matches `bin/install-skill-pack`, `scripts/lib/skill-install.sh`, `bin/add-skill`, `bin/add-mcp`, `aeon`, `scripts/notify.sh`, `scripts/notify-jsonrender.sh`, `aeon.yml`, `bin/generate-skills-json`, `scripts/check-capabilities-parity.sh`, `.github/workflows/aeon.yml`, `.github/workflows/chain-runner.yml`, `chain-runner.yml`, `CLAUDE.md` | The runtime executor + the things every skill depends on. A bug here ships to every fork. |
| **INFRA_REVIEW** | Any changed path matches `.github/workflows/*.yml` (excluding `aeon.yml` already in CORE_REVIEW), `.github/actions/*`, `Dockerfile*`, `package.json` at repo root, `package-lock.json` at repo root, `apps/dashboard/package.json`, `mcp-server/package.json` | Build + CI + dependency surface. Not the executor itself but adjacent enough that the operator should look. |
| **SKILL_WARN_OR_BLOCK** | Touches any `skills/*/SKILL.md` AND `scripts/skill-scan.sh` returned WARN or BLOCK on at least one of them (step 5) | A skill PR with a HIGH (BLOCK) or MEDIUM (WARN) security finding — surface explicitly. |
| **SKILL_PASS** | Touches any `skills/*/SKILL.md` AND every scanned `SKILL.md` returned PASS | A clean skill PR. The category most likely to be safely merged once a human has read the description. |
| **FAST_TRACK** | All changed paths match `*.md`, `*.txt`, `LICENSE*`, `docs/**`, `README*`, `_data/**`, `_layouts/**`, `_posts/**`, `_config.yml`, `output/.chains/**` | Docs/asset/data-only PR. No code path. Operator can merge on the title + a glance. |
| **UNKNOWN** | Files endpoint failed, OR no rule matched (shouldn't happen — `UNKNOWN` is the catch-all so a future contributor's PR with a brand-new path doesn't silently vanish from the digest) | Surface and ask the operator to look. Never silently bucket as FAST_TRACK. |

Note: **CORE_REVIEW takes precedence over INFRA_REVIEW takes precedence over SKILL_*.** A PR that touches both `aeon.yml` AND a `skills/*/SKILL.md` is CORE_REVIEW, not SKILL_PASS — the executor-config change is the higher-blast-radius signal and the digest should reflect that. The "first match wins" ordering in the rubric encodes this.

### 5. Per-skill security scan (only for PRs that touched at least one `skills/*/SKILL.md`)

For each `SKILL.md` path changed in such a PR:

```bash
gh api "repos/${TARGET_REPO}/contents/${PATH}?ref=${HEAD_SHA}" \
  --jq '.content' | base64 -d > "/tmp/pr-merge-scan-${PR_NUMBER}-$(echo ${PATH} | tr '/' '_').md"
bash scripts/skill-scan.sh "/tmp/pr-merge-scan-${PR_NUMBER}-$(echo ${PATH} | tr '/' '_').md" > "/tmp/pr-merge-scan-${PR_NUMBER}.out" 2>&1
```

The scan output's first HIGH/MEDIUM/PASS verdict line is taken as the per-file verdict. PR-level verdict is the **worst** across all scanned files: any HIGH → `BLOCK`; otherwise any MEDIUM → `WARN`; otherwise `PASS`.

If `scan.sh` itself errors (missing, non-executable, non-zero exit without a verdict line) → tag the PR `scan_verdict=scan_error`, bucket `UNKNOWN`, do **not** infer PASS from silence. The scanner is the same path `skill-scan` relies on; a broken scanner is a fleet-wide problem the operator must know about.

A PR can touch `skills/*/SKILL.md` AND `skills/*/scan.sh` AND `aeon.yml` at the same time. The bucket precedence in step 4 routes it to CORE_REVIEW regardless of the scan verdict — but **still run the scan** and record the verdict in the state file. A CORE_REVIEW PR with a BLOCK scan verdict deserves a second escalation line in the notification.

### 6. Age, label, and metadata

For each PR:

- `age_days = floor((now - created_at) / 86400)`
- `updated_age_days = floor((now - updated_at) / 86400)` (used as a tie-breaker when sorting — a PR last updated 8 days ago beats one updated yesterday for review urgency)
- `has_changes_requested` = `mergeable_state == "blocked"` AND any label in {`changes-requested`, `needs-revision`}
- `labels` = the labels array from the PR list response

Within each bucket, sort by `age_days DESC, then updated_age_days DESC, then number ASC`. The oldest unreviewed PR in each bucket is the operator's highest-leverage merge click.

### 7. Write the article

Overwrite `output/articles/pr-merge-${today}.md`:

```markdown
# PR Merge Queue — ${TARGET_REPO} — ${today}

*Open PRs surveyed: N · Drafts skipped: D · Trusted-author PRs (auto-merge handles): T*

## FAST_TRACK ({fast_track_count})

Docs / asset / data-only. Safe to merge on title + a glance.

| # | Title | Author | Age | Labels |
|---|-------|--------|-----|--------|
| ... |

## SKILL_PASS ({skill_pass_count})

Skill PR; security scan PASS on every changed `SKILL.md`.

| # | Title | Author | Age | Scan |
|---|-------|--------|-----|------|

## INFRA_REVIEW ({infra_review_count})

Build / CI / dependency-surface change. Requires operator eyes.

| # | Title | Author | Age | Files touched |
|---|-------|--------|-----|---------------|

## SKILL_WARN_OR_BLOCK ({skill_warn_count})

Skill PR with security scan WARN or BLOCK. **Do not merge without resolving the finding.**

| # | Title | Author | Age | Scan | Verdict |
|---|-------|--------|-----|------|---------|

## CORE_REVIEW ({core_review_count})

Touches the runtime executor or `aeon.yml`. **Highest blast radius — review carefully.**

| # | Title | Author | Age | Files touched | Scan (if any) |
|---|-------|--------|-----|---------------|---------------|

## UNKNOWN ({unknown_count})

Files endpoint failed OR matched no rule. Operator: glance and re-run.

| # | Title | Author | Age | Reason |
|---|-------|--------|-----|--------|

## TRUSTED_AUTHOR ({trusted_count})

Routed to `auto-merge`. Listed here for visibility only.

| # | Title | Author | Age |
|---|-------|--------|-----|

---
*Generated by `pr-review --survey`. Bucket precedence: CORE_REVIEW > INFRA_REVIEW > SKILL_WARN_OR_BLOCK > SKILL_PASS > FAST_TRACK > UNKNOWN. Run again with `--survey dry-run` to refresh without sending a notification.*
```

PR rows: `| #N | [title] | @author | Nd | [labels-or-files-or-scan-cell] |` — every column ≤80 chars, truncate with `…` if needed so the markdown table stays narrow enough to render in the dashboard.

### 8. Decide whether to notify (gated)

Skip notify entirely on `BAD_VAR`, `API_FAIL`, `EMPTY`, `DRY_RUN`, `STATE_CORRUPT`.

Otherwise notify only if any of:

1. **First (baseline) run** — `state.prs` was empty before this run.
2. **New non-FAST_TRACK PR** — a PR present this run but not in the prior state, with `bucket != FAST_TRACK` and `bucket != TRUSTED_AUTHOR` (a new FAST_TRACK or trusted-author PR is not news; surfacing one would re-create the dependabot-noise pattern other skills work hard to suppress).
3. **SKILL_BLOCK or CORE_REVIEW PR with a fresh head SHA** — present in this run and either `state.prs[k].last_notified_head_sha != head_sha` OR `state.prs[k]` did not exist. (A force-push or rebase reopens the review surface; we re-notify once per head SHA, not per run.)
4. **A bucket transitioned worse** — e.g. yesterday's SKILL_PASS now scores SKILL_WARN_OR_BLOCK because a new commit added a HIGH finding.

When notifying, set `state.prs[k].last_notified_head_sha = head_sha` for every PR cited in the notification body, so a noisy queue doesn't re-fire the same line every morning. PRs that drop out (closed/merged) are removed from `prs` (no retention beyond active queue).

### 9. Notification format

```
*PR Merge Queue — ${TARGET_REPO} — ${today}*

{open_count} open · {new_count} new since last run · {trusted_count} trusted (auto-merge)

FAST_TRACK ({n}): #A · #B · #C   ← safe to merge
INFRA_REVIEW ({n}): #D · #E   ← needs eyes
SKILL_PASS ({n}): #F · #G   ← clean scan
SKILL_WARN_OR_BLOCK ({n}): #H ⚠️ HIGH security finding · #I ⚠️ MEDIUM
CORE_REVIEW ({n}): #J ⚠️ touches aeon.yml · #K
{If unknown_count > 0:} UNKNOWN ({n}): #L — files API failed

Oldest in queue: #M (Nd, {bucket})
Full digest: output/articles/pr-merge-${today}.md
```

Keep under 900 chars. Drop any bucket row whose count is zero. Drop the "oldest in queue" line if `open_count == 0`. The `⚠️ HIGH security finding` / `⚠️ touches aeon.yml` annotations are appended only to PRs the operator has not been notified about on this head SHA — repeat-rendering them would dilute the alert signal.

Send via `./notify "$MSG"` (single positional argument — the heredoc-built message; aeon's `./notify` accepts a positional argument or `-f file`, this branch uses positional to keep the message inline with the other locals computed in this step, and keeps it under 900 chars).

### 10. Log (SURVEY branch)

Append to `memory/logs/${today}.md` under the shared `### pr-review` heading with a mode discriminator:

```markdown
### pr-review
- **Mode**: survey (risk-tiered triage digest)
- **Target repo**: ${TARGET_REPO}
- **Open PRs**: N (drafts skipped: D · trusted-author: T)
- **Buckets**: FAST_TRACK=A · SKILL_PASS=B · INFRA_REVIEW=C · SKILL_WARN_OR_BLOCK=D · CORE_REVIEW=E · UNKNOWN=F
- **New since last run**: G (excluding FAST_TRACK and TRUSTED_AUTHOR)
- **Oldest open PR**: #N (Mt days, bucket={bucket})
- **Scan results**: PASS=P · WARN=W · BLOCK=B · scan_error=E
- **Article**: output/articles/pr-merge-${today}.md
- **Notification**: sent / skipped (gated)
- **Status**: PR_MERGE_QUEUE_OK
```

## Exit taxonomy (SURVEY branch)

| Status | Meaning | Notify? |
|--------|---------|---------|
| `PR_MERGE_QUEUE_OK` | Digest written; baseline or a delta fired | Yes |
| `PR_MERGE_QUEUE_QUIET` | Digest written; no new non-FAST_TRACK PR, no fresh-head-SHA escalation since last run | No (article + state still write) |
| `PR_MERGE_QUEUE_EMPTY` | Queue is empty; article still writes with zero counts | No |
| `PR_MERGE_QUEUE_API_FAIL` | `pulls` endpoint failed | Yes (one-line failure notify) |
| `PR_MERGE_QUEUE_DRY_RUN` | `DRY_RUN=yes`; article + state wrote, notify skipped | No |
| `PR_MERGE_QUEUE_STATE_CORRUPT` | State JSON unreadable, recreated; silent recovery this run | No |
| `PR_MERGE_QUEUE_BAD_VAR` | `${var}` parse failed | No |

`PR_MERGE_QUEUE_OK` and `PR_MERGE_QUEUE_QUIET` are the two success states. The split exists so the dashboard can show "ran clean, nothing changed" without overloading the OK row.

## Design notes (SURVEY branch — do not edit without reading)

- **File-bucket precedence is conservative on purpose.** A PR touching both `aeon.yml` and `skills/x/SKILL.md` is CORE_REVIEW. Routing it to SKILL_PASS because the scan passed would understate the blast radius — the executor-config change is the dominant signal. First-match-wins in step 4 encodes this; do not "improve" by softening to per-file majority voting.
- **Scan errors do NOT default to PASS.** `scan_error` → bucket `UNKNOWN`. The whole point of the scanner is to catch HIGH findings before merge; a silent PASS on a broken scanner is the failure mode the skill exists to prevent. Same rule `skill-scan` follows.
- **FAST_TRACK is not "ignore."** It's the bucket the operator should merge **first**, not the bucket the operator should *skip*. A FAST_TRACK PR sitting open for 14 days is still a contributor experience problem; the digest still surfaces it (just without a notification).
- **TRUSTED_AUTHOR bypasses every other bucket.** A bot PR touching `aeon.yml` is still a `auto-merge`-handled PR — listing it under CORE_REVIEW would suggest the operator should look, but `auto-merge`'s policy already gates this. The split keeps the operator's mental model: this digest is *the queue you have to think about*, not *everything that's open*.
- **Re-notification is gated on head SHA, not on date.** A queue that grows by one PR per day shouldn't re-notify yesterday's whole queue every morning. State carries `last_notified_head_sha` per PR; a force-push or rebase reopens the review surface and is the only thing that re-notifies. Same dedup pattern `skill-scan` uses.
- **No auto-merge action, no PR comments, no labels.** This branch is operator-facing only. If a comment-on-PR layer is wanted, that is the default REVIEW branch / `pr-triage` / `skill-scan` territory and should grow there.
- **`memory/watched-repos.md` is read for `## Trusted Authors` only** (in this branch). The branch does not iterate every watched repo by default because the digest format only renders cleanly for one repo at a time and the operator's morning question ("what's safe to merge on aeon today") is per-repo. Multi-repo support is the `${var}` override path.

---

## Network note

`gh` CLI handles GitHub auth internally — use it over raw `curl`, which would put a bare `$SECRET` on the command line for the Bash permission layer to refuse. Both branches route all outbound GitHub calls through `gh` / `gh api` (`GH_TOKEN`, or `GITHUB_TOKEN` in CI — provided by the runner, no new secret to provision). No postprocess wrapper required. The only other outbound call is `./notify`, which stages for re-delivery after the run.

- **REVIEW branch**: if `gh` fails at the repo level, log the error and continue to the next repo. As a last-resort fallback, use **WebFetch** on the raw PR URL to read the diff.
- **SURVEY branch**: the `pulls` list endpoint is the floor (see step 2) — on failure, one-line failure notify + exit `API_FAIL`. A single PR's files-endpoint failure degrades that PR to `UNKNOWN` but keeps it in the digest.

No third-party API keys. No on-chain reads. No file writes outside `memory/`, `output/articles/`, and `/tmp/`.
