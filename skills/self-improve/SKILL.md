---
name: self-improve
description: Improve the agent itself, or audit its recent performance - better skills, prompts, workflows, and config, plus a quality/reliability/memory-hygiene review of what it did and what failed
metadata:
  category: evolution
  var: ""
  tags:
    - meta
---
> **${var}** — Mode selector, optionally with a focus area, as `mode` or `mode:focus`.
> - **empty** or **`improve`** → improve mode: find and fix the highest-impact issue from recent logs, then propose + apply the fix via PR (default).
> - **`improve:<area>`** (or a bare area like `notifications`) → improve mode focused on that specific area (e.g. `heartbeat`, `notifications`, `memory`).
> - **`audit`** → audit mode: review what the agent did, what failed, and what to improve; save a full review and apply safe, obvious fixes directly.
> - **`audit:<area>`** → audit mode focused on that specific area (e.g. `reliability`, `memory`).

## Setup (both modes)

Parse `${var}` into a **mode** and an optional **focus area**:
- Split on the first `:` — the part before is the mode, the part after is the focus.
- If the mode is `audit` → run the **Mode: audit** branch below (focus = optional area to concentrate the review on).
- If the mode is `improve` or empty → run the **Mode: improve** branch below (focus = optional area to fix).
- If the token is neither keyword but non-empty (e.g. `notifications`) → treat it as **improve** mode with the whole `${var}` as the focus area (backward compatibility).

Then:
- Read `memory/MEMORY.md` for high-level context and goals.
- Read recent `memory/logs/` (improve mode: last 2 days; audit mode: last 7 days) for errors, failures, and quality issues.

If a focus area is set, concentrate the run on that area.

---

## Mode: improve (default)

Improve the agent itself based on recent performance. **ONE change per run.**

### Steps

1. **Check for open improvement PRs** — don't pile up unreviewed work:
   ```bash
   OPEN_PRS=$(gh pr list --state open --json title,number --jq '[.[] | select(.title | test("^(fix|feat|chore)\\("; "i"))] | length')
   ```
   If there are already 3+ open improvement PRs, log "self-improve: 3+ open PRs, waiting for review" and exit. Don't create more debt.

2. **Identify what to improve.** If the focus area is empty, scan for issues:
   - Read `memory/logs/` from last 2 days — look for:
     - Skills that failed or produced low-quality output
     - Errors, timeouts, "zero output", rate limiting
     - Notifications that didn't send or were truncated
     - Memory consolidation problems
   - Read `memory/cron-state.json` for skills with low success rates
   - Read `output/articles/repo-actions-*.md` from last 7 days for self-improvement ideas
   - Pick the **highest-impact, smallest-effort** fix. One change per run.

3. **Understand the area you're fixing.** Read the relevant files:
   - Skills: `skills/{name}/SKILL.md`
   - Config: `aeon.yml`
   - Workflows: `.github/workflows/*.yml`
   - Agent instructions: `CLAUDE.md`
   - Dashboard: `apps/dashboard/` (if UI-related)

   Understand the current behavior before changing anything.

4. **Implement the fix.** Make minimal, targeted changes:
   - If a skill prompt is unclear → rewrite the ambiguous section
   - If a skill is hitting rate limits → add backoff logic or reduce frequency
   - If output quality is low → tighten the prompt, add examples, clarify format
   - If a notification is broken → fix the formatting or truncation
   - If a config is wrong → fix aeon.yml

   Do NOT:
   - Rewrite entire skills from scratch
   - Add new features (that's create-skill's job)
   - Change the core architecture
   - Modify secrets or environment variables

4b. **Dry-run gate.** Before opening the PR, execute the improved skill once with **synthetic** secrets, so a regression never reaches production having run only with real credentials. Let `$skill` be the skill you edited:
   ```bash
   DRYRUN_VERDICT="output/.dry-run/$skill.json" bash scripts/dry-run.sh run "$skill" || true
   ```
   Read `output/.dry-run/$skill.json`: `passed: true` (or `skipped: true`, when the `SKILL_DRYRUN` repo variable is `0`) continues. `passed: false` means **revert the edit and stop** (log `self-improve: dry-run gate failed for $skill` with the verdict `reasons[]`; do not open the PR). Put the verdict under a `## Dry-run` section in the PR body. The gate is structural (exit, output, declared `mode`, declared `requires:`); no real credential enters the run.

5. **Create a branch and PR:**
   ```bash
   git checkout -b fix/self-improve-${today}
   git add -A
   git commit -m "fix: [description of what was improved]

   Problem: [what was failing/degraded]
   Fix: [what was changed]
   Evidence: [log entries, error messages, success rates]"
   ```
   Open a PR:
   ```bash
   gh pr create --title "fix: [short description]" \
     --body "## Problem
   [What was failing or degraded — cite specific log entries or error messages]

   ## Fix
   [What was changed and why]

   ## Evidence
   - [Relevant log entries]
   - [Success rate before: X%]
   - [Error pattern: ...]"
   ```

6. **Notify.** Send via `./notify`:
   ```
   self-improve: [what was fixed] — PR: [url]
   ```

7. **Log** (see the shared `## Log` section below).

### Guidelines

- ONE fix per run. Don't bundle unrelated changes.
- Smallest viable fix. A one-line prompt tweak > a full rewrite.
- If you can't find anything to improve, that's fine. Log "self-improve: everything looks healthy" and exit.
- Never modify workflow files (.github/workflows/) — only skill files, CLAUDE.md, and aeon.yml.
- Don't create circular improvements (e.g. don't improve self-improve).

---

## Mode: audit

Audit what the agent did, what failed, and what to improve. Produce a full review, apply safe fixes, and surface recommendations.

### Steps

Read `memory/MEMORY.md` for context and goals. Read ALL `memory/logs/` entries from the last 7 days.

1. **Audit quality of outputs:**
   - Read recent articles in `output/articles/` — are they substantive or formulaic?
   - Check recent notifications in logs — were they useful or noisy?
   - Review any PR comments posted — were they actionable?
2. **Audit reliability:**
   - How many skills ran vs expected?
   - Any repeated errors or patterns of failure?
   - Are monitors catching real issues or always returning OK?
3. **Audit memory hygiene:**
   - Is `MEMORY.md` current and under 50 lines?
   - Are logs structured consistently?
   - Any stale data that should be cleaned?
4. **Generate improvement recommendations:**
   - Skills to add, modify, or disable
   - Schedule adjustments
   - Config changes (feeds, repos, addresses to add/remove)
   - Quality improvements (better prompts, new data sources)
5. **Save the full review** to `output/articles/self-review-${today}.md`.
6. **Apply any safe, obvious improvements directly:**
   - Prune stale `MEMORY.md` entries
   - Update `feeds.yml` if feeds are dead
7. **Send a summary** via `./notify`:
   ```
   *Self Review — ${today}*
   Quality: assessment
   Reliability: X/Y skills ran
   Actions taken: what was fixed
   Recommendations: top 2-3 suggestions
   ```
8. **Log** (see the shared `## Log` section below).

---

## Log

After completing the run, append a log entry to `memory/logs/${today}.md` under a single `### self-improve` heading, with a discriminator line naming the mode that ran:

```
### self-improve
- **Mode:** improve  (or: audit)
```

Then, for **improve** mode:
```
- **Target:** [what was improved]
- **Problem:** [what was failing]
- **Fix:** [what was changed]
- **PR:** [url]
```

For **audit** mode:
```
- **Review:** output/articles/self-review-${today}.md
- **Quality:** [assessment]
- **Reliability:** [X/Y skills ran]
- **Actions taken:** [what was fixed directly]
- **Recommendations:** [top 2-3]
```

## Network note

Write mode. Both branches touch the repo (improve opens a PR via `git`/`gh`; audit writes `output/articles/self-review-${today}.md` and may prune `MEMORY.md`/`feeds.yml`). For the GitHub API, use the `gh` CLI (`gh pr list`, `gh pr create`) — it handles auth internally, so no `$SECRET` ever touches the command line (a bare secret on the line is what the Bash permission layer refuses; there is no network sandbox). No pre-fetch or post-process side-channel is needed.
