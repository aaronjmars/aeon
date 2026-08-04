---
name: vuln-tracker
description: One lifecycle poll over everything vuln-scanner produces - PR and advisory status, PVR triage transitions, and pending-disclosure aging, with a stars-secured impact headline and one action queue.
metadata:
  title: Vuln Tracker
  category: dev
  var: ""
  mode: write
  tags:
    - meta
    - security
    - github
  depends_on:
    - vuln-scanner
  requires:
    - GH_TOKEN?
    - GH_GLOBAL?
---

> **${var}** — Scope selector for the lifecycle poll:
> - empty → **full lifecycle poll**: PR/advisory status + PVR triage + disclosure-queue aging (default).
> - `prs` (also `pr` / `tracker`) → **Arm A only** — PR/advisory status audit + stars-secured dashboard.
> - `pvr` → **Arm B only** — PVR triage-state poll on submitted advisories.
> - `queue` (also `disclosures` / `backlog`) → **Arm C only** — pending-disclosure queue aging + escalation.
> - a bare `GHSA-xxxx-xxxx-xxxx` → **Arm B, single-advisory mode** — check just that one advisory's triage state on demand.

Today is ${today}. This skill is the daily read/poll arm of the vuln pipeline: `vuln-scanner` opens PRs, submits PVRs, and queues disclosure drafts, then moves on. This skill polls everything it produced and surfaces what the operator must look at — it does not open PRs or submit advisories itself (those are `vuln-scanner`'s write actions).

## Voice

If `soul/SOUL.md` and `soul/STYLE.md` are populated, read them and match the operator's voice in every notification. If empty or absent, use a clear, direct, neutral tone.

## Capability mode

This skill runs `mode: write` deliberately. It is a read/poll arm, but three of its capabilities cannot run under `read-only`:
- **Arm B polls private, unpublished advisory triage state** via `gh api repos/$REPO/security-advisories/$GHSA`. Draft/triage advisories are visible only to the repo maintainers and the reporter, so the read is intrinsically authenticated; `read-only` strips `gh`, and a bare `$SECRET` on the command line is refused by the Bash permission layer (so a hand-rolled authenticated `curl` isn't an option either) — the read needs `gh api`, which handles auth internally.
- **Arm B persists state transitions** — it rewrites `state:`/`last_checked:`/`resolved_at:` frontmatter in `memory/pending-disclosures/*.md` in place and **moves** resolved files to `memory/pending-disclosures/resolved/` (`Edit`/`git mv` — both stripped in `read-only`).
- **Arm A leans on authenticated `gh api`** for the PVR-state endpoint (`repos/$REPO/private-vulnerability-reporting`) and repo/advisory reads.

No sibling writes a repo file **outside** `memory/`, so there was nothing to relocate — the only outside-`memory/` writes are the ephemeral `.pending-notify-temp/` notify-staging files. Keeping `write` preserves every absorbed capability.

## Shared preamble (run for every invocation)

1. Read `memory/MEMORY.md` for context.
2. Read the last ~3 days of `memory/logs/` and drop anything already reported — don't re-surface the same signal twice.
3. Read `soul/SOUL.md` + `soul/STYLE.md` if populated (voice).
4. **Parse `${var}` → scope** (deterministic; trim + lowercase, except a `GHSA-` value which is compared case-insensitively but preserved verbatim):
   - empty → `scope = full` (run Arm A, then B, then C).
   - matches `^GHSA-` (case-insensitive) → `scope = pvr`, `single_advisory = <the GHSA value>` (Arm B filtered to one advisory).
   - `prs` / `pr` / `tracker` → `scope = prs` (Arm A only).
   - `pvr` → `scope = pvr` (Arm B only, all advisories).
   - `queue` / `disclosures` / `backlog` → `scope = queue` (Arm C only).
   - anything else → log `VULN_TRACKER_BAD_VAR: unrecognized scope '<var>'`, send no notification, exit.
5. `mkdir -p .pending-notify-temp` and start an empty combined-notification buffer at `.pending-notify-temp/vuln-tracker-${today}.md`. Each arm that has signal **appends its section** to this buffer; at the very end (step "Notify") the skill sends the buffer **once** if it is non-empty. This keeps notifications tight — a full poll with signal in two arms is one message, not two.

Then run the arm(s) selected by `scope`, and finish with the shared **Notify** and **Log** steps.

## Network Note

- **Arm A & Arm B (GitHub reads):** all data via `gh api` / `gh search` / `gh pr view`. `gh` handles auth internally via `GH_TOKEN` (and Arm B's private-advisory reads need the elevated `GH_GLOBAL` PAT). No env-var-authenticated `curl` from bash — a bare `$SECRET` on the command line is refused by the Bash permission layer, so `gh api` (auth handled internally) is the reliable path; no postprocess scripts needed. Arm B keeps a documented `curl` fallback for the advisory endpoint — see Arm B step B2 — but `gh api` is preferred.
- **Arm C (local only):** reads only local files (`memory/pending-disclosures/`, `memory/issues/`, `memory/topics/pr-status.md`). No outbound network or auth required.

---

## Arm A — PR & advisory lifecycle status  (scope `full` or `prs`)

Audit the lifecycle status of every disclosure `vuln-scanner` has produced. Without a follow-up loop, three things rot silently:

- **Merged-but-uncelebrated wins** — landed fixes never reach self-improve / reflect (retro) without manual aggregation.
- **Maintainer questions on open PRs** — a maintainer comments asking for clarification; if the bot doesn't see it, the PR ages out.
- **Queued drafts past their disclosure window** — entries with `channel: "skipped"` (no-safe-channel) vanish into `vuln-scanned.json` with no recurring re-probe.

This arm cross-references `memory/vuln-scanned.json` against live GitHub state and surfaces anything the operator should look at.

### A1. Load the canonical scan history

```bash
jq -c '.scans[]' memory/vuln-scanned.json 2>/dev/null
```

If `memory/vuln-scanned.json` doesn't exist or has no `scans` array, log `VULN_TRACKER_SKIP: no scan history` for this arm and skip Arm A (no notification section — first runs of `vuln-scanner` haven't happened yet). In a `full` poll, continue to Arm B/C.

Each scan entry has at minimum: `repo`, `scanned_at`, `findings`, `channel`, `severity`. Public-PR entries also have `pr` (URL). Pending-disclosure entries have `draft_at` and `patch_branch`. Skipped entries have `reason`.

**Retro-active coverage:** if the JSON was written after vuln-scanner started running, some PRs won't be in the JSON. Pull all bot-authored security PRs from GitHub directly (next step) to fill the gap.

### A2. Pull all bot-authored security PRs from GitHub

`vuln-scanner` opens PRs with **title prefix `fix(security):`** and **branch prefix `security/`**. Title prefix is the more reliable signal across full history.

`gh search prs --json` does **not** expose `headRefName` — that field is only available via GraphQL. Use title-prefix as primary, GraphQL as optional belt-and-suspenders.

The bot author is whoever the workflow uses (typically `github-actions[bot]` or a dedicated account configured in the workflow). Determine the author from `aeon.yml` or the workflow file; default to whatever account opened the most recent `fix(security):` PR you can find.

**Primary (title prefix, works everywhere):**

```bash
BOT_AUTHOR="<resolved bot author>"
gh search prs --author "$BOT_AUTHOR" --json number,title,url,state,createdAt,closedAt,repository --limit 200 \
  | jq '[.[] | select(.title | startswith("fix(security):"))]'
```

**Optional (GraphQL, picks up branch-prefix-only PRs without `fix(security):` title):**

```bash
gh api graphql -f query='
{
  search(query: "author:'"$BOT_AUTHOR"' is:pr sort:created-desc", type: ISSUE, first: 100) {
    nodes { ... on PullRequest {
      number title url state createdAt closedAt mergedAt
      repository { nameWithOwner }
      headRefName
    }}
  }
}' | jq '[.data.search.nodes[]
    | select((.headRefName // "") | startswith("security/"))]'
```

Union the two result sets, dedup by URL.

Cross-reference with `vuln-scanned.json`:
- PR present in JSON → use JSON's `severity` / `cwe` / `note` for the row.
- PR not in JSON → mark as `pre-history`; fill severity from the PR title if obvious.
- JSON entry with `channel != "public-pr"` → no PR to fetch; goes in the "queued" / "skipped" sections.

### A3. Fetch live state for each open PR

For each open PR (state from step A2):

```bash
gh pr view "$REPO/$NUM" --json state,merged,closedAt,createdAt,reviews,comments,reviewDecision,author
```

Per-PR signals:
- **Maintainer-needs-answer**: any comment whose `author.login != $BOT_AUTHOR` posted **after** the most recent comment by `$BOT_AUTHOR` (or after PR creation if the bot hasn't commented). Also `reviewDecision == "CHANGES_REQUESTED"` always counts.
- **Stale-no-review**: `state == "OPEN"` AND no review AND no maintainer comment AND `createdAt` > 7d ago.
- **Aging-with-engagement**: `state == "OPEN"` AND any maintainer activity AND open > 14d.

If a scan entry has `advisory_ids` (one or more GHSA IDs), check each one's published state:

```bash
gh api "repos/$ORIGIN_REPO/security-advisories/$GHSA_ID" --jq '.state // "not found"'
```

`state == "published"` → public advisory visible. 404 → osv-scanner referenced it but the upstream repo never published its own advisory.

### A4. Fetch star counts for every secured repo

For every unique `repo` across the union from step A2 (JSON history + bot-authored security PRs):

```bash
gh api "repos/$REPO" --jq '{stars: .stargazers_count, archived: .archived}' 2>/dev/null
```

**Refetch every run.** Do NOT carry star counts forward from the previous `memory/topics/vuln-followup.md` — per-repo counts drift between runs and the secured-stars headline is the operator's load-bearing metric. Cache only within a single run, keyed by `nameWithOwner`, so a repo with multiple PRs is fetched once.

Repo-state handling:
- **200 with stars**: use `.stargazers_count` (raw integer).
- **200 with `archived: true`**: still use the star count, but suffix the repo cell with ` (archived)` so the operator knows the maintainer isn't responsive.
- **404 / 403**: repo was deleted, renamed, or made private. Record `null` and render as `repo-deleted`. Exclude from `total_stars_*` aggregates entirely so dead repos don't quietly zero out the totals.
- **Other non-2xx**: record `null` and render `★?`. Flag in the run log for operator follow-up.

These per-repo counts power both the **Stars Secured** aggregate (step A6) and the `Stars` column on every per-repo table in step A6.

### A5. Re-probe `channel: "skipped"` and `channel: "pending-disclosure"` repos

For each historical entry where the disclosure couldn't ship, re-check whether the situation changed:

- **`channel: "skipped"`** with `reason` containing "no PVR":
  ```bash
  PVR_NOW=$(gh api "repos/$REPO/private-vulnerability-reporting" --jq .enabled 2>/dev/null || echo "false")
  ```
  If `PVR_NOW=true` and the original was `false`, surface as **newly-actionable**.
- **`channel: "skipped"`** with `reason` containing "no SECURITY.md" — re-check `gh api repos/$REPO/contents/SECURITY.md` and `.github/SECURITY.md`. If now present, surface as **newly-actionable**.
- **`channel: "pending-disclosure"`** — cross-reference with `memory/pending-disclosures/` to see if the draft is still on disk. If the file is gone but the JSON entry says `pending-disclosure`, mark as `lost-draft` so it stops being escalated forever.

### A6. Categorize every entry, then rewrite the dashboard

| Status | Meaning |
|---|---|
| `merged` | PR merged. One-time celebration — drop from notifications after 30d. |
| `open-clean` | PR open, no maintainer activity yet, < 7d old. Wait. |
| `needs-answer` | Maintainer commented or requested changes. **Operator action.** |
| `stale-no-review` | Open > 7d, zero maintainer activity. Consider polite ping or close. |
| `aging-engaged` | Open > 14d with engagement. Operator should triage. |
| `closed-no-merge` | PR closed without merging. Capture the reason for review. |
| `queued` | `pending-disclosure` draft on disk, not yet shipped. |
| `skipped-rechecked` | Channel was "skipped" originally; re-probe still shows no channel. |
| `newly-actionable` | Skipped originally; PVR or SECURITY.md now present. **Operator action.** |
| `lost-draft` | JSON says pending-disclosure but draft file is gone. Display once, then suppress. |
| `pre-history` | PR found via search but predates `vuln-scanned.json`. Fill what we can. |

Then rewrite `memory/topics/vuln-followup.md` (rewrite — don't append; this file is a living dashboard, not a log).

The **Stars Secured** block goes at the top so the operator sees aggregate impact before drilling into rows. `total_stars_secured` = sum of stargazers across every unique repo where vuln-scanner has landed at least one merged PR. `total_stars_in_flight` = sum across repos with an open PR. `total_stars_tracked` = sum across the full union. Track all three because celebration uses `secured`, prioritization uses `in_flight`, and historical review uses `tracked`.

Round star counts to abbreviated form for the headline (12.4k, 1.8k, 940). Keep raw integers in the per-repo tables so sort/diff stays exact.

```markdown
# Vuln Tracker Status

*Last updated: ${today}*

## Stars Secured

- **Merged-PR repos (secured):** ★ <total_stars_secured> across <secured_repo_count> repos
- **Open-PR repos (in flight):** ★ <total_stars_in_flight> across <in_flight_repo_count> repos
- **All tracked repos:** ★ <total_stars_tracked> across <total_repo_count> repos

### Secured leaderboard — every merged PR ranked by repo stars
| Rank | Repo | Stars | PR | Merged | Severity | Title |
|------|------|-------|----|--------|----------|-------|

### Per-repo breakdown — secured (sorted by stars desc)
| Repo | Stars | Merged PRs | First merge | Latest merge | Severities landed |
|------|-------|------------|-------------|--------------|-------------------|

### Per-repo breakdown — in flight (sorted by stars desc)
| Repo | Stars | Open PRs | Oldest open | Severities open |
|------|-------|----------|-------------|-----------------|

### Per-repo breakdown — queued / skipped / closed (sorted by stars desc)
| Repo | Stars | Status | Severity | Note |
|------|-------|--------|----------|------|

## Operator-action queue

### Needs answer (<count>)
| Repo | Stars | PR | Title | Last activity | Latest commenter |
|------|-------|----|----|--------------|------------------|

### Newly actionable — channel opened up since the original scan (<count>)
| Repo | Stars | Original date | Original blocker | Now |
|------|-------|---------------|------------------|-----|

### Stale or aging
| Repo | Stars | PR | Age | Status | Suggested action |
|------|-------|----|----|-----|------------------|

## Recently merged (last 30d, <count>)
| Date merged | Repo | Stars | PR | Severity | Title |
|-------------|------|-------|----|----------|-------|

## Open / clean (no operator action — wait, < 7d) (<count>)
| Repo | Stars | PR | Severity | Opened | Age |
|------|-------|----|----------|--------|-----|

## Closed without merge (last 30d, <count>)
| Date | Repo | Stars | PR | Severity | Title | Likely reason |
|------|------|-------|----|----------|-------|---------------|

## Queued (no PR yet) (<count>)
| Severity | Repo | Stars | Original channel | Original blocker | Days queued |
|----------|------|-------|------------------|------------------|-------------|

## Lost-draft ghosts (suppressed from notifications)
| Date | Repo | Stars | Severity |
```

### A7. Decide whether Arm A has signal

**No signal (contribute nothing to the notification)** if all are true:
- Zero `needs-answer`
- Zero `newly-actionable`
- Zero items moved to `merged` since the last run
- Zero items moved to `closed-no-merge` since the last run
- Zero items aged into `stale-no-review` or `aging-engaged` since the last run

To detect "since last run," diff today's categorization against the previous `memory/topics/vuln-followup.md`. If the file doesn't exist (first run), treat all entries as new and surface the full backlog.

### A8. Emit Arm A's notification section (when it has signal)

Append this section to the combined buffer (`.pending-notify-temp/vuln-tracker-${today}.md`). Keep the whole message under 4000 chars; if tight, drop the merged/opened/stale section bodies and keep counts only.

```
*PR & advisory status*

★ secured: <total_stars_secured> across <secured_repo_count> repos  (in flight: <total_stars_in_flight> / <in_flight_repo_count>)

needs answer: <N>
<repo> (★<stars>) #<num> — <latest_commenter>: "<comment_excerpt_first_120_chars>"

newly actionable: <N>
<repo> (★<stars>, queued <days>d) — <what_changed>

merged this week: <N>  <list_with_stars>
opened, waiting: <N>
stale: <N>
queued: <N> (<critical>C / <high>H / <other>M+L)

leaderboard top-3 (PRs by ★): #1 <repo1> ★<s1> (PR #<pr1>) — #2 <repo2> ★<s2> (PR #<pr2>) — #3 <repo3> ★<s3> (PR #<pr3>)

dashboard: memory/topics/vuln-followup.md (full leaderboard inside)
```

Record Arm A status `VULN_TRACKER_OK` for the log.

---

## Arm B — PVR triage state  (scope `full`, `pvr`, or a bare `GHSA-…`)

`pvr-watchlist` monitors repos *waiting to open* PVR. This arm monitors PVRs that have **already been submitted** and tracks their lifecycle: `triage` → `draft` (accepted) → `published` (public) or `withdrawn` (rejected). Without this, submitted advisories sit unmonitored until manually recalled from memory.

Source of truth: `memory/pending-disclosures/*.md` files with `channel: pvr` frontmatter. Each such file must have `ghsa`, `repo`, `state`, `submitted_at` fields (full schema below).

**Configuration — optional tracking issue.** The arm can reference an optional **tracking issue** in the operator's own repo — useful for cross-linking advisory state with an internal issue board. Resolve from (priority order):
1. `aeon.yml` top-level key `pvr_triage.tracking_issue:` (e.g. `pvr_triage: { tracking_issue: "owner/repo#123" }`)
2. environment variable `AEON_PVR_TRACKING_ISSUE`
3. unset → skip cross-linking entirely.

If a tracking issue is configured, mention its URL in the notification and the per-advisory write-up so the operator can navigate to the canonical tracker.

### B1. Discover in-flight PVRs

Scan `memory/pending-disclosures/` for all `.md` files. Parse the YAML frontmatter. Keep only those with `channel: pvr`.

If `single_advisory` is set (a bare `GHSA-…` was passed), filter to just the matching `ghsa` value (one-off mode).

If no PVR files found:
```
PVRT_SKIP: no submitted PVRs on disk
```
Record that Arm B status and skip Arm B (no notification section). In a `full` poll, continue to Arm C.

### B2. Probe each advisory's triage state

For each entry, determine `repo` and `ghsa` from frontmatter.

```bash
REPO="owner/repo"
GHSA="GHSA-xxxx-xxxx-xxxx"

gh api "repos/${REPO}/security-advisories/${GHSA}" \
  --jq '{state: .state, cve_id: .cve_id, published_at: .published_at}' 2>&1
```

Expected outcomes:

| Response | Meaning |
|----------|---------|
| `{state: "triage", ...}` | Maintainer hasn't reviewed yet |
| `{state: "draft", ...}` | Accepted — maintainer is working on it |
| `{state: "published", ...}` | Published — fully resolved |
| `{state: "withdrawn", ...}` | Rejected or withdrawn by reporter |
| HTTP 403 | Private advisory, we don't have read access — state unknown, treat as still `triage` |
| HTTP 404 | Advisory deleted / repo private / GHSA invalid — flag as `not-found` |

**Fallback:** `gh api` uses `GH_TOKEN` internally (workflow wires `GH_GLOBAL` for the elevated advisory read). If `gh` is somehow unavailable, fall back to:
```bash
curl -s -H "Authorization: Bearer $GH_GLOBAL" \
  "https://api.github.com/repos/${REPO}/security-advisories/${GHSA}" \
  | grep -o '"state":"[a-z]*"'
```
(Note: a bare `$SECRET` on the command line is refused by the Bash permission layer, so `gh api` is the reliable path here — or route the `curl` through `./secretcurl` with a `{GH_GLOBAL}` placeholder.)

### B3. Detect state changes

Compare the probed `state` to the `state` in the frontmatter.

- **No change:** note it, continue.
- **Changed:** this is the primary event. Log old → new state.

Also flag:
- **Aged triage:** `state=triage` AND (`today` − `submitted_at`) > 30 days → escalate. Most maintainers respond within 30 days; silence past that is actionable.
- **Accepted (draft):** surface the patch branch from the `patch_branch` frontmatter field — maintainer may want a PR instead of a private advisory.
- **Published:** advisory is live. The finding is closed. Update state and mark for removal.
- **Withdrawn:** rejected. Note the reason if visible. Mark for cleanup.

### B4. Update frontmatter in-place

For each file with a state change, rewrite just the `state` field in the YAML frontmatter. Also update a `last_checked` field (add it if absent).

Do NOT modify the body of the advisory file — only update frontmatter.

Example frontmatter update:
```yaml
state: draft          # was: triage
last_checked: 2026-05-21
```

For `published` or `withdrawn` entries, add:
```yaml
resolved_at: 2026-05-21
```

### B5. Decide whether Arm B has signal

- **All entries still `triage`, no changes, none aged:** no notification section. Record status and continue.
- **Any state change, aged entry, or action item:** emit the section below.

### B6. Emit Arm B's notification section (when it has signal)

Append to the combined buffer:

```
*PVR triage*

pvr triage: {total} advisories in flight. {changed_count} changed.

CHANGED:
- {repo} {ghsa} — {old_state} → {new_state}
  {action_item}

AGED (>30d no response):
- {repo} {ghsa} — {days}d in triage. {severity}. escalate or close.
  patch: {patch_branch}

STILL TRIAGE:
{n} advisories waiting. oldest: {repo} ({days}d).

{if tracking_issue configured}
tracker: {tracking_issue_url}
{end}
```

Action items by transition:
- `triage → draft` → "maintainer accepted — offer to PR the patch branch: {patch_branch}"
- `triage → published` → "published as {cve_id}. remove from tracking."
- `triage → withdrawn` → "rejected. remove from tracking and note in vuln-scanned.json."
- aged triage (>30d) → "30d+ no response. consider pinging maintainer or withdrawing."

### B7. Clean up resolved entries

For entries where `state=published` or `state=withdrawn` AND `resolved_at` is set: move the file from `memory/pending-disclosures/` to `memory/pending-disclosures/resolved/` (create the directory if needed; use `git mv`).

Do NOT delete — keep as a historical record.

Record Arm B status `PVRT_OK` for the log.

---

## Arm C — Disclosure-queue aging  (scope `full` or `queue`)

Monitor the pending vulnerability disclosure backlog. `vuln-scanner` queues draft advisories to `memory/pending-disclosures/` when PVR auto-submission fails or the disclosure path is email-only. Without daily visibility, CRITICAL/HIGH advisories silently age past responsible-disclosure windows. This arm surfaces the queue state and escalates when findings sit too long. (Arm B tracks the lifecycle of the `channel: pvr` subset; Arm C ages the **whole** queue by severity and disclosure status.)

### C1. Scan the backlog

```bash
ls memory/pending-disclosures/ 2>/dev/null
```

If the directory doesn't exist or is empty: log `DISCLOSURE_TRACKER_SKIP: no pending advisories` for this arm and skip Arm C (no notification section).

### C2. Parse each advisory file

For each `.md` file in `memory/pending-disclosures/` (ignore the `resolved/` subdir):

**From the filename** (pattern: `{repo-slug}-{YYYY-MM-DD}.md` or `{repo-slug}-{YYYY-MM-DD}-{ampm}.md`):
- Extract target repo slug (everything before the last date segment)
- Extract filed date

**From the YAML frontmatter** (if present) parse:
- `repo:` — overrides the filename slug when present (canonical target)
- `severity:` — CRITICAL / HIGH / MEDIUM / LOW
- `status:` — see step C2.5 for the controlled vocabulary

**From the file content** (fallback for files without frontmatter), look for these near the top of the file:
- `Severity:` or `**Severity:**` — one of CRITICAL / HIGH / MEDIUM / LOW
- `CVE/CWE:` or similar identifier
- Short title (first non-blank heading line)

If severity is not parseable, treat as MEDIUM. Compute age: `today - filed date` in days.

### C2.5. Classify each advisory's disclosure state

Before counting any draft as a past-threshold escalation, decide whether the draft is genuinely pending or already covered. A draft can be in one of these states:

- `escalate` — pending, no canonical PR found, past the severity-tier threshold
- `pending` — pending, no canonical PR found, within the threshold window
- `operator-todo` — needs operator-only action (email send, PVR enable nudge); not an agent failure
- `covered-by-pr` — a canonical disclosure PR has already been filed against the target repo and is `OPEN` or recently merged
- `superseded-upstream` — the bypass / vuln is fixed in upstream already, draft is dead-weight
- `submitted` — already submitted via PVR / GHSA; awaiting maintainer response

Resolution rules:

1. **Check frontmatter `status:` first** — map the literal value to a state:
   - `superseded-upstream` → `superseded-upstream`
   - `submitted`, `submitted-via-pvr`, `disclosed-via-pr-{N}`, `email-sent` → `submitted` or `covered-by-pr`
   - `pending-operator-send` **with `auto_send: true`** → `pending` (the `disclosure-emailer` will send it autonomously — not a human task)
   - `pending-operator-send` (without `auto_send: true`), `queued for operator manual send`, `email-failed`, any string mentioning "operator" → `operator-todo`
   - `pending`, blank, or missing → fall through to rule 2

2. **Cross-reference `memory/topics/pr-status.md`** (if present) — grep for the `{repo}` slug (frontmatter `repo:` or filename) in the Open section and Recent Merges section. If a row exists with a `fix(security)` or `chore(security)` title against that repo, opened on or after the draft's `detected_at` / `reconstructed_at` / filed-date, classify as `covered-by-pr` and capture the PR number / title for the summary. If `memory/topics/pr-status.md` doesn't exist, skip this lookup and fall to rule 3.

3. **Fall through** — if no status hint and no canonical PR found, classify as `pending`. Then check age vs the severity-tier threshold (CRITICAL 3d / HIGH 7d / MED-LOW 14d) — if past, promote to `escalate`.

This is the load-bearing step. Without cross-referencing already-merged fix PRs the tracker generates false-positive escalations for drafts that have already been resolved.

### C3. Build the summary

Group advisories by **state first**, then by severity within each state. The three buckets are:

- **Escalate** — `escalate` state only (truly stuck, past threshold, no canonical PR)
- **Operator-todo** — `operator-todo` state (email-only sends, PVR-enable nudges, anything awaiting human action)
- **Cleanup candidates** — `covered-by-pr`, `submitted`, `superseded-upstream` (draft files that can be removed from `memory/pending-disclosures/`)

Severity tiers and thresholds (only apply to `escalate` and `pending` states):
- **CRITICAL** (age threshold: 3 days — escalate immediately)
- **HIGH** (age threshold: 7 days — escalate at 7d)
- **MEDIUM / LOW** (threshold: 14 days)

For each advisory, produce one line:
```
- {repo-slug} | {severity} | {age}d | {short title}{state-suffix}
```
where `{state-suffix}` is empty for `escalate` / `pending`, `[operator-todo: {reason}]` for operator-todo, and `[covered: PR #{N}]` / `[superseded-upstream]` / `[submitted]` for cleanup candidates.

Count totals. Identify advisories in the `escalate` state — those are the only ones that drive the urgent notification path.

### C4. Check for upstream PVR / token issues

Look in `memory/issues/INDEX.md` for any open issues tagged with `pvr`, `repository_advisories`, or `missing-secret` that explain why advisories are stuck. If such an issue exists, note:
- Number of consecutive PVR failures (if logged)
- Fix estimate from the issue notes
- How many of the backlogged advisories are blocked by it

If no such issue exists, treat the queue as routine and skip the "blocked by" line in the notification.

### C5. Decide whether Arm C has signal

Compute counts from step C3:
- `escalate_count` — drafts in the `escalate` state
- `pending_count` — drafts in `pending` (in-window) state
- `operator_todo_count` — drafts awaiting operator action
- `cleanup_count` — drafts in `covered-by-pr` / `submitted` / `superseded-upstream`

Decision:
- **Queue empty**: log `DISCLOSURE_TRACKER_SKIP: queue empty`, no section.
- **`escalate_count` > 0**: emit the **urgent** section.
- **`escalate_count` == 0 but `cleanup_count` > 0**: emit the **daily digest** section (includes the cleanup-candidate list so the operator can prune `memory/pending-disclosures/`).
- **All `pending` / `operator-todo`, nothing past threshold, no cleanup candidates**: emit the **daily digest** section.

Coverage from `covered-by-pr` / `submitted` / `superseded-upstream` is **never** counted as an escalation — informational only. Operator-todo is **never** an escalation either; it's surfaced separately so the operator knows their inbox.

### C6. Emit Arm C's notification section

Append to the combined buffer.

**Urgent format** (`escalate_count` > 0):

```
*Disclosure queue*

disclosure queue: {escalate_count} past threshold (of {total} drafts).

ESCALATE:
- {repo} — {severity}, {age}d old (threshold: {N}d)
[... others in `escalate` state ...]

operator-todo ({operator_todo_count}):
- {repo} — {severity}, {age}d — {operator-reason}

cleanup candidates ({cleanup_count}):
- {repo} — [covered: PR #{N} / superseded-upstream / submitted] — safe to delete from memory/pending-disclosures/

{IF blocking issue tracked in memory/issues/INDEX.md}
blocked by {ISS-ID} — {short reason}
fix: {fix estimate} unblocks {N} of {escalate_count + pending_count}
{end}
```

**Daily digest format** (no escalation):

```
*Disclosure queue*

disclosure queue: {total} drafts. {critical_count} CRITICAL, {high_count} HIGH, {other_count} MED/LOW.
{pending_count} in-window, {operator_todo_count} operator-todo, {cleanup_count} cleanup candidates.
oldest in-window: {repo} ({age}d).
{cleanup section if cleanup_count > 0}
{IF blocking issue tracked in memory/issues/INDEX.md}
blocked by {ISS-ID} — {short reason}.
{end}
```

Record Arm C status `DISCLOSURE_TRACKER_OK` for the log.

---

## Notify (shared, runs once at the end)

If the combined buffer `.pending-notify-temp/vuln-tracker-${today}.md` has at least one arm section, prepend the header line `*Vuln Tracker — ${today}*` and send once:

```bash
./notify -f .pending-notify-temp/vuln-tracker-${today}.md
```

If the buffer is empty (every arm that ran was silent), **send nothing** — a clean poll is silent. Keep the whole message under 4000 chars; if over, trim Arm A's body first (keep counts), then Arm C's cleanup list, keeping every `needs-answer` / `newly-actionable` / `ESCALATE` line.

## Log (shared, runs once at the end)

Append to `memory/logs/${today}.md` under ONE heading (the health loop parses `### <skill-name>`), with a discriminator line naming the scope/arms that ran:

```
### vuln-tracker
- scope: <full | prs | pvr | queue | single-advisory:GHSA-…>
- Arm A (PR/advisory): <status> — <total_in_json> JSON + <pre_history_prs> pre-history = <total> tracked; states: <merged> merged / <open_clean> open-clean / <needs_answer> needs-answer / <stale> stale / <aging> aging / <closed> closed / <queued> queued / <skipped> skipped-rechecked / <newly_actionable> newly-actionable
- Stars: ★<total_stars_secured> secured (<secured_repo_count> repos) / ★<total_stars_in_flight> in flight (<in_flight_repo_count> repos) / ★<total_stars_tracked> tracked (<total_repo_count> repos)
- Arm B (PVR triage): <status> — checked <total>; changed <changed_count> (<list>); aged>30d <aged_count>; still-triage <waiting_count>; tracking issue <url|none>
- Arm C (disclosure queue): <status> — <total> drafts (<critical_count> CRITICAL / <high_count> HIGH / <other_count> MED/LOW); <escalate_count> escalate / <pending_count> in-window / <operator_todo_count> operator-todo / <cleanup_count> cleanup; oldest in-window <repo> (<age>d); blocking issue <ISS-ID|none>
- Operator queue this run: <needs_answer + newly_actionable + aged PVRs + escalate_count>
- Notification: <sent | skipped (no movement)>
- VULN_TRACKER_OK
```

Only include the Arm B / Arm C lines for arms that actually ran under the current scope. Use each arm's own status token (`VULN_TRACKER_OK` / `VULN_TRACKER_SKIP`, `PVRT_OK` / `PVRT_SKIP`, `DISCLOSURE_TRACKER_OK` / `DISCLOSURE_TRACKER_SKIP`) inline, and close with `VULN_TRACKER_OK` for the hub run (or `VULN_TRACKER_BAD_VAR` if the var was unrecognized).

## Required Env Vars

- `GH_TOKEN` / `GITHUB_TOKEN` — GitHub read token for Arm A's PR/comment/repo/advisory reads and the PVR-state endpoint. `repo` scope is enough. Present by default in GitHub Actions.
- `GH_GLOBAL` — GitHub PAT with `public_repo` + `repository_advisories:write` scope, used by Arm B to read the triage state of **private/unpublished** advisories you submitted. Same token used by `vuln-scanner` and `pvr-watchlist`. Without it, Arm B advisory reads may 403 (treated as still `triage`).
- `AEON_PVR_TRACKING_ISSUE` (optional) — internal tracking-issue reference for Arm B cross-linking (else resolved from `aeon.yml` `pvr_triage.tracking_issue:`, else skipped).
- Arm C requires no env vars — all its data comes from local files written by `vuln-scanner`.

## Pending-disclosure file schema (Arm B & Arm C)

`memory/pending-disclosures/*.md` files. Newer drafts use YAML frontmatter:

```yaml
---
repo: owner/repo
ghsa: GHSA-xxxx-xxxx-xxxx
ghsa_url: https://github.com/owner/repo/security/advisories/GHSA-xxxx-xxxx-xxxx
channel: pvr                       # Arm B tracks only channel: pvr entries
state: triage                      # triage | draft | published | withdrawn
status: pending-operator-send      # optional; Arm C vocabulary below
submitted_at: 2026-05-12T19:54:42Z
last_checked: 2026-05-15           # added/updated by Arm B
severity: HIGH
cwe: [CWE-xxx]                      # may be a string or an array — handle both
patch_branch: https://github.com/<fork-owner>/repo/tree/security/branch-name
patch_commit: abc1234
submit_url: https://github.com/owner/repo/security/advisories/new
---

# {Repo}: {Title}
...
```

- **Arm B required fields:** `repo`, `ghsa`, `channel: pvr`, `state`, `submitted_at`. Optional: `patch_branch`, `patch_commit`, `cwe`, `ghsa_url`.
- **Older drafts** use inline `**Severity:**` lines and no frontmatter — parse defensively: grep for `severity:` and `Severity:` case-insensitively; if unparseable, default to MEDIUM.

### `status:` controlled vocabulary (Arm C, step C2.5)

Set by `vuln-scanner` / operator / cleanup chores:

- (blank or missing) — pending; falls through to the PR-status cross-ref
- `pending` — same as blank
- `pending-operator-send` **with `auto_send: true`** — queued for autonomous send by `disclosure-emailer`; classify as `pending` (NOT operator-todo). It should flip to `email-sent` within a day; if it lingers armed-but-unsent, that means `RESEND_API_KEY` isn't configured — surface it once so the operator wires up Resend.
- `pending-operator-send` **with `auto_send: false`/absent** / `queued for operator manual send` — operator-todo (human must send; e.g. non-email contact or AI-report ban)
- `email-sent` — sent by `disclosure-emailer` via Resend; awaiting maintainer reply. Treat like `submitted` (informational cleanup candidate, **never** an escalation).
- `email-failed` — `disclosure-emailer` gave up after repeated send failures (bad address / Resend error). **operator-todo** — the contact needs fixing or a manual send.
- `submitted` / `submitted-via-pvr` — submitted, awaiting maintainer
- `disclosed-via-pr-<N>` — covered-by-pr, draft can be archived
- `superseded-upstream` — bypass is already fixed in upstream; draft is dead
- Any string containing `operator` — operator-todo

When a canonical PR lands but the draft's `status:` was never set, Arm C falls through to step C2.5 rule 2 (cross-ref `pr-status.md`) and classifies as `covered-by-pr` automatically. The `status:` shortcut just bypasses the grep.

**When to delete a draft:** cleanup candidates in the notification can be removed by the operator with `rm memory/pending-disclosures/<file>.md`. Safe once the canonical PR is open — the patch branch on the fork remains the authoritative artifact.

## Notes & related

- **`vuln-scanned.json` schema is loose** — `cwe` may be a string or an array; `advisory_ids` may be present or absent. Handle both.
- **Sibling skill:** `vuln-scanner` produces the records this skill audits (its write actions — open PR, submit PVR, queue draft — are deliberately NOT here). `pvr-watchlist` probes repos *waiting to open* PVR; Arm B picks up once a PVR is submitted. `inbox-triage` catches inbound maintainer replies via the GitHub notification layer (complementary, not a duplicate of Arm A's branch-name lifecycle audit).
- Arm A, Arm B, and Arm C all read `memory/pending-disclosures/` from different angles; coordinate via the shared `memory/topics/vuln-followup.md` dashboard to avoid duplicate escalation.
