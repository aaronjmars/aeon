---
name: inbox-triage
description: Daily GitHub notification inbox triage - surfaces aging vuln PR replies, security advisories, review requests, and mentions that need action
metadata:
  title: Inbox Triage
  category: dev
  var: ""
  tags:
    - github
    - security
    - meta
  schedule: "30 11 * * *"
---

Today is ${today}. Read `memory/MEMORY.md` before starting.

## Why this skill exists

`followup-patrol` reads manually tracked items in MEMORY.md. `disclosure-tracker` handles `memory/pending-disclosures/`. `vuln-tracker` tracks the operator's vuln PRs by scanning branch names. None of these read from the actual GitHub notification inbox. When a maintainer replies to a vuln PR — or a security advisory opens on a watched repo — it sits unread until someone manually checks GitHub. This skill reads the inbox and routes what needs action.

`pr-tracker` covers merged/closed operator PRs. `vuln-tracker` covers lifecycle by branch. This skill covers the **notification layer** — inbound responses, review requests, security alerts, mentions.

## Steps

### 1. Fetch GitHub notifications

Run:
```bash
gh api /notifications --paginate 2>&1
```

Parse the JSON array. If the command errors or returns an empty array `[]`, log `INBOX_TRIAGE_SKIP: no notifications` and stop.

Limit to the first 100 notifications if `--paginate` returns more (GitHub caps at 50 per page; two pages is enough).

For each notification record:
- `id`
- `reason` — why you're being notified (mention, review_requested, author, state_change, security_alert, assign, etc.)
- `subject.title`
- `subject.type` — PullRequest, Issue, Release, etc.
- `subject.url` — API URL for the subject
- `repository.full_name`
- `updated_at` — ISO timestamp

### 2. Filter

Keep notifications where `unread: true` AND `updated_at` is within the last 14 days. Discard older or read ones.

If zero remain after filtering: log `INBOX_TRIAGE_SKIP: no actionable notifications within 14 days` and stop.

### 3. Categorize

Assign each notification to exactly one category (first match wins):

| Category | Match criteria |
|----------|---------------|
| `SECURITY` | `reason == "security_alert"` OR title contains any of: vulnerability, vuln, CVE, advisory, security |
| `VULN_REPLY` | `subject.type == "PullRequest"` AND `reason` is one of: author, state_change, comment AND `repository.full_name` is NOT under the operator's own account/org (derive the operator's GitHub handle from `soul/SOUL.md` or the workflow's `GITHUB_ACTOR` — these are PRs filed on third-party repos by the vuln-scanner) |
| `REVIEW_NEEDED` | `reason == "review_requested"` |
| `MENTION` | `reason == "mention"` OR `reason == "team_mention"` |
| `GENERAL` | everything else |

### 4. Age vuln PR replies

For each `VULN_REPLY` notification, compute `age_days` = today minus `updated_at` date (integer days).

Flag urgency:
- `CRITICAL` — age_days > 7 (maintainer likely hasn't responded)
- `AGING` — age_days 3–7
- `FRESH` — age_days < 3

Cross-reference with `memory/topics/vuln-followup.md` if it exists: look for the PR title in that file and pull any tracked notes (e.g. "approved", "NEEDS-ANSWER", merge status).

### 5. Resolve HTML URLs for action items

For each notification in SECURITY, VULN_REPLY (CRITICAL or AGING), REVIEW_NEEDED, and MENTION categories:

Try to get the HTML URL via:
```bash
gh api {subject.url} --jq '.html_url' 2>/dev/null
```

If that fails, construct the URL manually:
`https://github.com/{repository.full_name}/pulls/{number}` for PRs
`https://github.com/{repository.full_name}/issues/{number}` for issues

(Extract the number from the tail of `subject.url`.)

### 6. Write triage summary

Overwrite `memory/topics/inbox-triage.md`:

```markdown
# GitHub Inbox Triage

Last run: {today}
Scanned: {N} unread notifications ({N} within 14 days)

## Action Required

### Security ({count})
{for each SECURITY item, sorted by age:}
- **{repo}**: {title} ({age_days}d) — {html_url}

{if none:}
None.

### Vuln PR Replies ({count_critical} critical, {count_aging} aging)
{for each VULN_REPLY sorted by age desc:}
- **[{CRITICAL|AGING|FRESH}]** `{repo}` ({age_days}d): {title} — {html_url}
  {if vuln-followup note found:} _{tracked note}_

{if none:}
None.

### Review Requested ({count})
{for each REVIEW_NEEDED item:}
- **{repo}**: {title} — {html_url}

{if none:}
None.

### Mentions ({count})
{for each MENTION item:}
- **{repo}**: {title} — {html_url}

{if none:}
None.

## No Action Needed
{count_general} general notifications (subscriptions, automated state changes).
```

### 7. Update MEMORY.md known follow-ups

Read `memory/MEMORY.md`. Find the `## Known Follow-ups` section.

**Add** any VULN_REPLY CRITICAL item not already tracked there — append:
```
- **{repo} #{number} NEEDS-ANSWER** — {age_days}d since maintainer activity ({url})
```

**Update** any existing NEEDS-ANSWER item for a PR that now appears as FRESH in VULN_REPLY (maintainer responded recently) — change its note to `RESPONDED — verify resolution`.

Do NOT add GENERAL, REVIEW_NEEDED, MENTION, or SECURITY items to MEMORY.md Known Follow-ups (too noisy; security items warrant a separate issue if severe).

### 8. Send notification

Only send if at least one of:
- Any SECURITY item
- Any VULN_REPLY where urgency == CRITICAL
- Any REVIEW_NEEDED item
- Three or more MENTION items

Write to `.pending-notify-temp/inbox-triage-${today}.md`:

```
inbox — {today}

{if SECURITY:}
security alert: {repo} — {title}

{if VULN_REPLY CRITICAL:}
vuln PRs aging: {comma-separated list of "repo (Nd)"}

{if REVIEW_NEEDED:}
review needed: {comma-separated repo list}

{if 3+ MENTION:}
{N} mentions

read it: memory/topics/inbox-triage.md
```

Then:
```bash
./notify -f .pending-notify-temp/inbox-triage-${today}.md
```

If nothing meets the threshold: skip notification. Log that no notification was sent.

### 9. Log

Append to `memory/logs/${today}.md`:

```markdown
### inbox-triage
- **Scanned:** {N} notifications
- **Security:** {N}
- **Vuln replies:** {N total} ({N_critical} critical, {N_aging} aging, {N_fresh} fresh)
- **Review needed:** {N}
- **Mentions:** {N}
- **MEMORY.md follow-ups updated:** {yes/no — what changed}
- **Notification sent:** {yes/no}
- INBOX_TRIAGE_OK
```

If skipped:
```markdown
### inbox-triage
- INBOX_TRIAGE_SKIP: {reason}
```

## Required Env Vars

None beyond `GITHUB_TOKEN`, which GitHub Actions sets automatically and `gh` uses internally.

## Network Note

Uses `gh api` for all GitHub calls — it handles auth internally, so no `$SECRET` ever appears on the command line for the Bash permission layer to refuse. `gh api` works in a GitHub Actions run. If `gh api /notifications` fails (rate limit, auth error), log the error and exit with `INBOX_TRIAGE_SKIP: api error`. Use WebFetch as a fallback only if `gh` is unavailable — the endpoint is `https://api.github.com/notifications` with `Authorization: Bearer $GITHUB_TOKEN`, but WebFetch can't carry that auth header; prefer `gh`.

## What this is NOT

- Not a duplicate of `followup-patrol` — followup-patrol reads manually curated items in MEMORY.md. This reads the raw GitHub inbox.
- Not a duplicate of `vuln-tracker` — vuln-tracker tracks lifecycle by branch name. This catches inbound maintainer replies via notifications.
- Not a duplicate of `disclosure-tracker` — disclosure-tracker manages `memory/pending-disclosures/` advisory drafts. This reads GitHub security alerts and PR responses.
