---
name: auto-merge
description: Automatically merge open PRs that have passing CI, no blocking reviews, and no conflicts
metadata:
  title: Auto Merge
  category: core
  tags:
    - dev
    - meta
  var: ""
---
<!-- autoresearch: variation C — safety-hardened (author allowlist, size cap, UNKNOWN retry, fork block, dry-run mode) so an autonomous agent with merge credentials cannot accidentally ship a hostile or oversized PR -->

> **${var}** — Repo (owner/repo) to target. If empty, uses every repo in memory/watched-repos.md.
> Env: `AUTO_MERGE_DRY_RUN=1` logs intent without merging. `MAX_AUTO_MERGE=N` caps merges per run (default 3).

Merge open PRs that are fully green **and** pass an explicit safety policy. The policy exists because this skill runs autonomously with write access — a bug in the gate is a bug that ships to main.

Read memory/MEMORY.md and memory/watched-repos.md for repos to target.
Read the last 2 days of memory/logs/ to avoid re-logging PRs already merged.

## Safety policy

A PR merges only when every one of the following holds:

- **Author allowlist**: `author.login` is one of `dependabot[bot]`, `renovate[bot]`, `github-actions[bot]`, OR appears under a `## Trusted Authors` section in memory/watched-repos.md. No allowlist → only the three bot logins are eligible.
- **Size cap**: `additions + deletions ≤ 500`. Override by applying the label `auto-merge-large` on the PR.
- **Base branch**: `baseRefName` is `main` or `master`. Refuse any other target.
- **Not a fork**: `isCrossRepository == false` (fork CI can be tampered with).
- **Not draft**: `isDraft == false`.
- **Not already queued**: `autoMergeRequest == null` (avoid fighting GitHub's native auto-merge if a human enabled it).
- **No opt-out label**: none of {`do-not-merge`, `wip`, `hold`, `needs-review`, `blocked`} present.
- **Mergeable state**: `mergeStateStatus == "CLEAN"` (this is stricter than `mergeable == "MERGEABLE"` — CLEAN additionally requires branch-protection gates to be satisfied).
- **Reviews**: `reviewDecision != "CHANGES_REQUESTED"`.
- **Checks**: every entry in `statusCheckRollup` has `conclusion` in `{SUCCESS, NEUTRAL, SKIPPED}`. Any `FAILURE`, `TIMED_OUT`, `CANCELLED`, `PENDING`, or `null` conclusion disqualifies the PR.
- **Retry cap**: this PR has been attempted fewer than 3 times. A PR that has hit `MERGE_FAIL` three times across runs is paused — repeated failure on a CLEAN-looking PR usually means something subtle (a required check that didn't surface, branch-protection drift, token scope drift). Surface it and stop looping.

## Steps

0. **Bootstrap state** — per-PR retry counter lives in `memory/topics/auto-merge-state.json`:
   ```bash
   mkdir -p memory/topics
   [ -f memory/topics/auto-merge-state.json ] || echo '{"prs":{},"last_run":null}' > memory/topics/auto-merge-state.json
   ```
   Schema:
   ```json
   {
     "last_run": "2026-05-23T08:00:00Z",
     "prs": {
       "owner/repo#123": {
         "first_seen": "2026-05-21T10:00:00Z",
         "last_attempt": "2026-05-23T08:00:00Z",
         "attempts": 2,
         "last_outcome": "merge_failed",
         "last_error": "Pull Request is in unstable state"
       }
     }
   }
   ```
   PR keys are `<owner>/<repo>#<number>` so state survives multi-repo runs. Cap to 50 most-recent entries (LRU by `last_attempt`). Validate with `jq empty` after write; restore from `.bak` on failure.

1. **List open PRs** for each watched repo with the full field set:
   ```bash
   gh pr list -R owner/repo --state open --json number,title,author,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,autoMergeRequest,isCrossRepository,labels,additions,deletions,baseRefName
   ```

2. **Handle UNKNOWN state** — GitHub computes `mergeStateStatus` lazily. If a PR returns `UNKNOWN`, sleep 3 seconds and re-query once:
   ```bash
   sleep 3 && gh pr view NUMBER -R owner/repo --json mergeStateStatus,mergeable,statusCheckRollup
   ```
   If still UNKNOWN after the retry, skip the PR with reason `UNKNOWN-persistent` and let the next run retry.

3. **Apply the safety policy** to each PR. Record a verdict for every PR: either `MERGE` or `SKIP:<specific-reason>`. Reasons must name the failing gate — e.g. `SKIP:author-not-allowlisted:contributor123`, `SKIP:size-cap:823-lines`, `SKIP:mergeStateStatus=BEHIND`, `SKIP:label:do-not-merge`, `SKIP:check-failed:lint`, `SKIP:retry-cap:3-attempts`. Vague reasons like `SKIP:not-ready` are not acceptable.

4. **Merge qualifying PRs**, up to MAX_AUTO_MERGE (default 3):
   - If `AUTO_MERGE_DRY_RUN=1`, log `DRY_RUN:would-merge #N` and continue — **do NOT** invoke merge.
   - Otherwise:
     ```bash
     gh pr merge NUMBER -R owner/repo --squash --delete-branch
     ```
     Increment `state.prs["<owner>/<repo>#<N>"].attempts` on every attempt regardless of outcome. Set `first_seen` if absent. Reset to 0 (delete the entry) for PRs that no longer appear in the open list (already merged or closed since the last run).
     If the merge fails (non-zero exit), capture stderr and log `MERGE_FAIL #N: <stderr>`. Record `last_outcome: merge_failed` and `last_error: <stderr ≤200 chars>` on the state entry. A failed merge does NOT count toward the per-run `MAX_AUTO_MERGE` cap — continue to the next qualifying PR. A PR whose `attempts` has reached 3 is filtered out in step 3 with `SKIP:retry-cap:3-attempts`; surface it in step 5b instead of retrying.

5. **Send a notification** only when at least one real (non-dry-run) merge succeeded **or** at least one PR has hit the retry cap (5b below). No merges and no cap hits → no notification, just a log entry.

   5a. **At least one merge succeeded:**
   ```
   *Auto Merge — ${today}*
   Merged N PR(s) on owner/repo:
   - #123: PR title (+45/-12, by @author) — squash merged abc1234
   Queue cleared. Self-improve cycle unblocked.
   ```

   5b. **Retry cap reached on ≥1 PR** (`AUTO_MERGE_RETRY_CAP`) — include in the same message if both fire, otherwise stand-alone:
   ```
   *Auto Merge — retry cap*
   Hit retry cap (3 attempts) on:
   - owner/repo#40 — last error: "Pull Request is in unstable state"
   Stopping auto-merge attempts on this PR. Investigate manually.
   ```
   Dedup: suppress re-notify if the *exact same* set of cap-hit PR keys already notified within the last 24h (grep `memory/logs/` for prior `AUTO_MERGE_RETRY_CAP` entries).

6. **Persist state** — write the updated `memory/topics/auto-merge-state.json`. Update `last_run` to current timestamp. Validate with `jq empty`; on failure restore from a `.bak` written before this run.

7. **Log to memory/logs/${today}.md** under an `### auto-merge` heading:
   - `Mode`: live | dry-run
   - `Repo(s)`: list
   - `Merged`: `#N title @author +A-D SHA` per line
   - `Skipped`: `#N SKIP:<reason>` per line
   - `Retry-capped`: `owner/repo#N — <last_error>` per line (empty if none)
   - `Totals`: `merged=X qualified=Y considered=Z retry_capped=R`
   - If zero qualified, include a verdict breakdown: `AUTO_MERGE_SKIP: 0/Z qualifying (behind=B blocked=L failing=F draft=D author-blocked=A size-blocked=S retry-capped=R)`

## Network note

`gh` authenticates via the workflow's GITHUB_TOKEN — no curl needed. If `gh pr merge` fails with `Resource not accessible by integration`, the workflow token lacks merge permission on that repo; log once and notify at most once per 7 days (check memory/logs/ for prior notification) to avoid alert spam.

## Constraints

- Never merge a PR whose author is not allowlisted, even if every other gate is green.
- Never bypass the size cap without the explicit `auto-merge-large` label (set by a human, not a bot).
- Never auto-retry a `MERGE_FAIL` within the same run — if the first merge attempt fails, log and move on.
- After 3 failed attempts across runs, stop retrying that PR. Surface it once via the retry-cap notification and let the operator investigate.
- Do not modify PR state other than merging (no comments, no label edits, no branch updates).

## Running this as an agent-shipping loop

To close the loop on PRs the agent itself opens (from `feature`, `external-feature`, `self-improve`, etc.), add the agent's GitHub identity under a `## Trusted Authors` section in `memory/watched-repos.md`:

```markdown
## Trusted Authors
- aeon-bot
- claude-code[bot]
```

Once allowlisted, agent PRs flow through the same safety policy as bot PRs and get auto-merged on green CI. The retry cap protects against runaway behavior on a stuck PR.
