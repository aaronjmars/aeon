---
name: GitHub Issues
description: Check all your repos for new open issues in the last 24 hours
var: ""
---
> **${var}** — Specific repo (owner/repo) to check. If empty, checks all repos.

Read memory/MEMORY.md for context.
Read the last 2 days of memory/logs/ to avoid repeating items.

## Steps

1. Get repos to check:
   - If `${var}` is set, use that repo directly (e.g. `owner/repo`).
   - Otherwise, get all repos for the authenticated user:
   ```bash
   gh repo list --limit 100 --json nameWithOwner,hasIssuesEnabled --jq '.[] | select(.hasIssuesEnabled) | .nameWithOwner'
   ```

2. For each repo with issues enabled, check for issues opened in the last 24 hours:
   ```bash
   YESTERDAY=$(date -u -d "yesterday" +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -v-1d +%Y-%m-%dT00:00:00Z)
   gh issue list -R OWNER/REPO --state open --json number,title,createdAt,author,labels \
     --jq '.[] | select(.createdAt > "'"$YESTERDAY"'")'
   ```

3. Deduplicate against recent logs — never alert on the same issue twice.

4. Send via `./notify`:
   ```
   *GitHub Issues — ${today}*

   repo-name: #N Issue title (@author)
   repo-name: #M Another issue (@author)
   ```
   If no new issues across any repo, send:
   ```
   *GitHub Issues — ${today}*
   No new issues across all repos.
   ```

5. Log to memory/logs/${today}.md.
   If no new issues, log "GITHUB_ISSUES_OK" and end.
