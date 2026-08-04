---
name: operator-scorecard
description: Three recap modes - default synthesizes agent health, community growth, and economic activity into a was-it-worth-it verdict; ops recaps what shipped and failed; push ranks push impact.
metadata:
  category: productivity
  var: ""
  tags:
    - meta
    - productivity
    - dev
---

> **${var}** — Mode selector. The first token picks the branch; the remainder is branch-specific.
> - **empty** → **operator scorecard** (default): synthesize the week into agent health + community growth + economic activity with a worst-of-three OK/WATCH/DEGRADED verdict. Also accepts `dry-run` (skip the notification — article + JSON spec still write) and/or an integer `N` to override the window in hours (default 168 = 7d, cap 720). Examples: `` , `dry-run`, `336`, `dry-run 336`.
> - **`ops`** → **ops recap**: operational summary of one day — what shipped, what failed, what needs follow-up. Optional date override after the keyword (`ops 2026-06-30` or `ops:2026-06-30`); empty date = today (UTC).
> - **`push`** → **push recap**: deep-dive recap of all pushes — reads diffs, ranks impact, separates user-visible shipments from internal work, delivers a verdict. Optional repo scope after the keyword (`push aeonfun/aeon` or `push:owner/repo`); empty = all watched repos.

<!-- merged: operator-scorecard (default branch, three-pillar synthesis) + ops-recap (`ops` branch, operational day-recap) + push-recap (`push` branch, diff-reading push deep-dive). Every distinct behaviour of all three is preserved below. -->

## Overview

One skill, three recap views over Aeon's own activity. They share a preamble (read memory, compute the date, parse the selector) then branch into fully distinct logic — do not blend them:

- **scorecard** (default): a **synthesis-only** weekly rollup. Every number it prints is sourced from a file another skill already wrote (`skill-health`'s analytics view, `heartbeat`, `tweet-allocator`, `repo-pulse`). Three paragraphs — agent health / community growth / economic activity — each with its own verdict, rolled up to a worst-of-three overall verdict. Answers the operator-level question: *given everything that happened, was this week worth it?*
- **ops** (`ops`): an **operational day-recap**. Reads today's activity log + `memory/cron-state.json` + the issues index, deduplicates repeat runs, demands a URL on every shipped item, surfaces the calls that need a human, and leads with a one-sentence TL;DR verdict. Never a log dump.
- **push** (`push`): a **diff-reading push deep-dive**. Fetches push events, commits, and merged PRs per watched repo, reads the diffs, classifies each commit user-visible vs internal vs infra, ranks by impact, and leads with a one-line verdict — with significance gating so quiet days send nothing.

## Shared preamble (run for every branch)

1. Read `memory/MEMORY.md` for high-level context and scan the last ~3 days of `memory/logs/` for recent activity — drop anything already reported so you don't re-report the same signal.
2. Compute `${today}` (UTC date, `YYYY-MM-DD`).
3. **Parse `${var}` → branch + branch argument** (trim whitespace first). Let `FIRST` be the lowercase first token (split on the first whitespace or `:`), `REST` the remainder:
   - `FIRST == "ops"` → `BRANCH=ops`, `ARG=REST` (a date override, or empty).
   - `FIRST == "push"` → `BRANCH=push`, `ARG=REST` (an `owner/repo` scope, or empty).
   - anything else (empty, `dry-run`, a bare integer, or an unrecognized token) → `BRANCH=scorecard`; pass the **whole** `${var}` through to the scorecard branch's own grammar (dry-run prefix + optional integer window).
4. Dispatch: run the matching branch below. Only that branch executes.

---

# Scorecard branch (default — empty / `dry-run` / integer window)

Today is ${today}. Synthesize the last 7 days of agent activity into a single plain-language scorecard the operator can read in 30 seconds. Three paragraphs (agent health / community growth / economic activity) plus a one-line verdict (OK / WATCH / DEGRADED). The point of this branch is to answer the question every operator quietly asks after a week of autonomous runs: **was this week worth it?**

## Why this exists

Every signal needed to answer that question already lives in the repo — `skill-health`'s analytics view ranks pass rates, `heartbeat` issues per-run verdicts, `tweet-allocator` totals weekly $AEON spend, `repo-pulse` records star/fork deltas. But each lives in its own article, on its own cadence, in its own format. A new operator (or a returning one) opens four files to assemble the weekly picture. This branch assembles it once on Monday morning and pushes it to the notification channel so the picture is delivered, not fetched.

It is deliberately a synthesis view, not a measurement view — every number it prints is sourced from a file another skill already wrote. It introduces zero new APIs, zero new secrets, zero new cron-state. If an upstream skill didn't run, the matching paragraph degrades gracefully ("no data this week") rather than fabricating numbers.

## Config

No new config. No new secrets. Reads:

- `output/articles/skill-analytics-*.md` — most recent file in window for fleet pass rate + anomaly count (written by `skill-health`'s analytics view — the former `skill-analytics` skill, now the analytics view of `skill-health`)
- `output/articles/heartbeat-*.md` (or `memory/logs/*.md` heartbeat sections) — P0–P3 verdict tally
- `output/articles/tweet-allocator-*.md` — weekly distributed totals + recipient counts
- `output/articles/repo-pulse-*.md` — daily star/fork delta entries summed across the window
- `memory/MEMORY.md` — last consolidation date + "Skills Built" recent rows for the activity-pulse line
- `memory/issues/INDEX.md` (optional) — open issue count if present

No outbound HTTP. No `gh api` calls. Pure file scanning + arithmetic.

## Steps

### 1. Parse var and resolve window

- If `${var}` matches `^dry-run` → `MODE=dry-run`. Strip the prefix; remainder treated as window override.
- Otherwise `MODE=execute`.
- If the remaining var parses as a positive integer N → `WINDOW_HOURS=N` and `WINDOW_DAYS=$((N / 24))` (round down). Cap at 720h (30 days).
- Otherwise `WINDOW_HOURS=168`, `WINDOW_DAYS=7`.
- Compute `WINDOW_START_DATE` = today minus `WINDOW_DAYS` days (UTC, ISO date).

### 2. Collect agent-health signals

a. **Latest analytics article.** `LATEST_ANALYTICS=$(ls -1t output/articles/skill-analytics-*.md 2>/dev/null | head -1)`. If found AND its date suffix is within the window → parse the metadata line `*Window: ... · N runs across M skills · X% success · Y anomalies*` for `total_runs`, `distinct_skills`, `success_pct`, `anomaly_count`. If not found (`skill-health`'s analytics view didn't run this window): set all four to `null` and mark `agent_health_source=missing`.

b. **Heartbeat verdicts.** For every heartbeat run logged in the window, scan `memory/logs/YYYY-MM-DD.md` between `WINDOW_START_DATE` and today for `## Heartbeat` sections. Count occurrences of: `P0` / `P1` / `P2` / `P3` / `OK` markers. The simplest first-match wins per heartbeat block: an `OK` block (no P-flags) increments `heartbeat_ok`; any P-flag increments the matching `heartbeat_pX` counter and skips the OK count. If no heartbeat sections found, set counts to zero and mark `agent_health_source=partial`.

c. **Open issues.** If `memory/issues/INDEX.md` exists and contains an `## Open` section with table rows, count rows. Otherwise `open_issues=0` and `issues_source=absent`.

d. **Compute health verdict (paragraph 1):**
- `OK` if `success_pct >= 90` AND `anomaly_count <= 1` AND `heartbeat_p0 == 0` AND `heartbeat_p1 == 0`
- `WATCH` if `success_pct >= 75` AND `heartbeat_p0 == 0` AND (`anomaly_count <= 3` OR `heartbeat_p1 <= 2`)
- `DEGRADED` otherwise
- If `agent_health_source=missing`: emit `INSUFFICIENT_DATA` for this paragraph's verdict (don't pretend OK)

### 3. Collect community-growth signals

a. **Stars + forks delta.** Sum every `output/articles/repo-pulse-*.md` file with date suffix in window. From each, extract the `New stars (24h)` count and `New forks (24h)` count for each watched repo. Aggregate per-repo totals across the window. The `aeonfun/aeon` row is the headline; other repos go on a continuation line.

If the file format doesn't contain the canonical fields, fall back to scanning `memory/logs/*.md` for `## Repo Pulse` blocks (older format). If both fail for a given repo: `stars_added=null`, mark `growth_source=partial`.

b. **New contributors.** Count first-time merged-PR authors in the window from the GitHub search API — `search/issues?q=repo:<repo>+is:pr+is:merged+merged:<start>..<end>` (via `gh api` in write mode, or WebFetch `https://api.github.com/search/issues?...` in read-only). For each unique non-bot author, a prior-PR check (`…+author:<login>+merged:<<start>` → `total_count == 0`) marks them new; `new_contributors` = that count. If the GitHub API is unavailable: `new_contributors=null`.

c. **Notable mentions.** Scan `output/articles/repo-article-*.md` and `output/articles/project-lens-*.md` filenames in window for any title containing milestones-language (regex `(milestone|launch|hit \d+|featured|HN|Show HN|Hacker News)`). If found, capture up to 2 titles for the `Notable` line. Otherwise omit.

d. **Compute growth verdict (paragraph 2):**
- `OK` if `total_stars_added >= 20` OR `new_contributors >= 1` (a real signal of community pull)
- `WATCH` if `total_stars_added >= 5`
- `DEGRADED` if `total_stars_added < 5` AND `new_contributors == 0` AND no notable mentions

### 4. Collect economic-activity signals

a. **$AEON distributed.** Sum every `output/articles/tweet-allocator-*.md` in the window: extract the `Total distributed: $X.XX in $AEON` line. Track the count of `Paid tweets:` recipients across the window (deduped by handle).

If `output/articles/distribute-tokens-*.md` exists in the window, also tally any explicit on-chain payouts there. Report both as `$AEON distributed: $X.XX (Y recipients via tweet-allocator + Z via distribute-tokens)`.

b. **Compute economic verdict (paragraph 3):**
- `OK` if `total_distributed > 0`
- `DEGRADED` if `total_distributed == 0` (week with $0 spend on community = silent loop)

### 5. Roll up to the overall verdict

- Take the worst of the three paragraph verdicts. `DEGRADED` > `WATCH` > `OK`.
- `INSUFFICIENT_DATA` paragraphs do **not** force the overall verdict to DEGRADED — they degrade to `WATCH` (so a partial-data week still flags as worth checking, not ignored).
- The verdict line uses the same vocabulary as `heartbeat`'s P-flags for visual continuity: `🟢 OK` / `🟡 WATCH` / `🔴 DEGRADED`.

### 6. Build the article

Path: `output/articles/operator-scorecard-${today}.md`. Overwrite if exists (idempotent same-day reruns).

```markdown
# Operator Scorecard — ${today}

**Verdict:** ${verdict_emoji} ${verdict_label} — ${one_line_summary}

*Window: last ${WINDOW_DAYS}d (${WINDOW_START_DATE} → ${today})*

## Agent health

The fleet ran ${total_runs} times across ${distinct_skills} skills with a ${success_pct}% success rate. ${anomaly_count} anomaly flag(s) raised this week. Heartbeat issued ${heartbeat_ok} clean reports and ${heartbeat_p0+p1+p2+p3} flagged reports (P0=${heartbeat_p0} P1=${heartbeat_p1} P2=${heartbeat_p2} P3=${heartbeat_p3}). ${open_issues} open issue(s) in the tracker.

**Verdict:** ${health_verdict}

## Community growth

${watched_repo_1} added ${stars_1} stars and ${forks_1} forks. ${watched_repo_2} added ${stars_2} stars and ${forks_2} forks. ${total_stars_added} stars across the fleet — averaging ${stars_per_day} per day. ${new_contributors} new contributor(s) appeared on the leaderboard. ${notable_line_or_omit}

**Verdict:** ${growth_verdict}

## Economic activity

$AEON distributed: $${total_distributed} across ${recipient_count} recipient(s) via tweet-allocator${distribute_tokens_addendum_or_omit}.

**Verdict:** ${economic_verdict}

## What was notable

${bullet list of up to 3 entries from MEMORY.md "Skills Built" rows where date is in window — keeps the week's autonomous accomplishments visible}

## Source status

- skill-health (analytics): ${article_path or "missing this window"}
- heartbeat: ${N runs found in memory/logs}
- repo-pulse: ${N daily articles in window}
- tweet-allocator: ${N daily articles in window} · total: $${total_distributed}
- new-contributors: ${new_contributors or "GitHub API unavailable"}

---
*Companion to `skill-health`'s analytics view (per-skill ranking) and heartbeat (per-run pulse). This branch answers the operator-level question those two don't: "given everything that happened, was this week worth it?" Methodology: every number is sourced from another skill's article — this branch measures nothing itself.*
```

The "What was notable" section reads `memory/MEMORY.md` for rows in the `## Skills Built` table where the `Date` column falls in the window. List up to 3, formatted as `- {Skill} — {one-line summary truncated to ~120 chars}`. If zero new skills built this week, write `- No new skills built this week — agent ran on the existing fleet.`

### 7. Write the dashboard JSON spec

Path: `apps/dashboard/outputs/operator-scorecard.json`. Use the catalog components.

```json
{
  "version": "1",
  "generated_at": "${ISO timestamp}",
  "skill": "operator-scorecard",
  "title": "Operator Scorecard — ${today}",
  "spec": {
    "type": "Stack",
    "props": {"direction": "vertical", "gap": "md"},
    "children": [
      {"type": "Heading", "props": {"level": 2, "children": "Operator Scorecard — ${today}"}},
      {"type": "Alert", "props": {"variant": "${alert_variant}", "children": "${verdict_label} — ${one_line_summary}"}},
      {"type": "Grid", "props": {"columns": 3, "gap": "sm"}, "children": [
        {"type": "Card", "props": {"children": [
          {"type": "Text", "props": {"variant": "muted", "children": "Agent health"}},
          {"type": "Heading", "props": {"level": 3, "children": "${success_pct}%"}},
          {"type": "Text", "props": {"children": "${total_runs} runs · ${anomaly_count} anomalies"}}
        ]}},
        {"type": "Card", "props": {"children": [
          {"type": "Text", "props": {"variant": "muted", "children": "Stars added"}},
          {"type": "Heading", "props": {"level": 3, "children": "+${total_stars_added}"}},
          {"type": "Text", "props": {"children": "${total_forks_added} forks · ${new_contributors} new contributors"}}
        ]}},
        {"type": "Card", "props": {"children": [
          {"type": "Text", "props": {"variant": "muted", "children": "$AEON distributed"}},
          {"type": "Heading", "props": {"level": 3, "children": "$${total_distributed}"}},
          {"type": "Text", "props": {"children": "${recipient_count} recipients · token ${token_7d_pct}% 7d"}}
        ]}}
      ]},
      {"type": "Heading", "props": {"level": 3, "children": "Verdicts by lane"}},
      {"type": "Table", "props": {
        "columns": [
          {"key": "lane", "header": "Lane"},
          {"key": "verdict", "header": "Verdict"},
          {"key": "headline", "header": "Headline"}
        ],
        "rows": [
          {"lane": "Agent health", "verdict": "${health_verdict}", "headline": "${health_headline}"},
          {"lane": "Community growth", "verdict": "${growth_verdict}", "headline": "${growth_headline}"},
          {"lane": "Economic activity", "verdict": "${economic_verdict}", "headline": "${economic_headline}"}
        ]
      }}
    ]
  }
}
```

`alert_variant`: `default` for OK, `secondary` for WATCH, `destructive` for DEGRADED.

If the file write fails (filesystem read-only, missing directory), log a warning but do not abort — the article is the canonical artifact, the JSON spec is a dashboard convenience.

### 8. Send notification

If `MODE == dry-run`: skip notify, log `OPERATOR_SCORECARD_DRY_RUN`, exit.

Otherwise call `./notify`:

```
*Operator Scorecard — ${today}*
${verdict_emoji} ${verdict_label} — ${one_line_summary}

Agent health: ${success_pct}% across ${total_runs} runs (${anomaly_count} anomalies, ${heartbeat_ok} clean heartbeats)

Community growth: +${total_stars_added}⭐ +${total_forks_added} forks across ${repo_count} repos${new_contributor_addendum}

Economic activity: $${total_distributed} in $AEON to ${recipient_count} recipients · token ${token_7d_pct}% 7d (${token_verdict})

${notable_addendum_or_omit}

Window: last ${WINDOW_DAYS}d
Full: output/articles/operator-scorecard-${today}.md
```

`notable_addendum`: if any "What was notable" bullet exists, prefix with `Notable:` and inline the first one only (cap at ~120 chars). If none, omit the line.

Keep it tight for signal — the verdict + three lane lines are the priority; drop "Notable" first if it runs long. (`./notify` auto-chunks, so length is about signal, not transport.)

### 9. Log to `memory/logs/${today}.md`

Append under the shared `### operator-scorecard` heading (see the **Log** section) with a `branch: scorecard` discriminator, then:

```
### operator-scorecard
- branch: scorecard
- **Window**: last ${WINDOW_DAYS}d (${WINDOW_HOURS}h)
- **Verdict**: ${verdict_emoji} ${verdict_label}
- **Agent health**: ${success_pct}% success across ${total_runs} runs · ${anomaly_count} anomalies · ${heartbeat_p0+p1} flagged heartbeats · ${open_issues} open issues
- **Community growth**: +${total_stars_added}⭐ +${total_forks_added} forks · ${new_contributors} new contributors
- **Economic activity**: $${total_distributed} in $AEON to ${recipient_count} recipients · token ${token_7d_pct}% 7d (${token_verdict})
- **Article**: output/articles/operator-scorecard-${today}.md
- **Dashboard**: apps/dashboard/outputs/operator-scorecard.json
- **Notification sent**: ${yes|no — dry-run|no — INSUFFICIENT_DATA}
- **Status**: OPERATOR_SCORECARD_OK | OPERATOR_SCORECARD_QUIET | OPERATOR_SCORECARD_NO_DATA
```

## Scorecard exit taxonomy

| Status | Meaning | Notify? |
|--------|---------|---------|
| `OPERATOR_SCORECARD_OK` | scorecard rendered, ≥1 lane has data | Yes |
| `OPERATOR_SCORECARD_QUIET` | dry-run mode | No (article + JSON written, log only) |
| `OPERATOR_SCORECARD_NO_DATA` | every lane returned `INSUFFICIENT_DATA` (fresh fork, never ran any upstream skill) | No (log only, no article overwrite) |

## Scorecard constraints

- **Synthesis-only.** Every number prints from a file another skill wrote. If a source file is missing, the matching lane reports `INSUFFICIENT_DATA` and the branch continues — never fabricate numbers to fill a gap.
- **Three-paragraph contract.** Agent health, community growth, economic activity. In that order. Adding a fourth lane is a separate skill, not a scope creep here.
- **No issue filing.** Anomalies surface in the verdict; persistence and resolution belong to `skill-health`. This branch is read-only across `memory/issues/`.
- **Worst-of-three rollup.** The overall verdict mirrors heartbeat's P-flag vocabulary so operators don't need to learn new terminology.
- **Idempotent.** Same-day reruns overwrite the article and JSON spec. The log entry appends (one block per run) so re-running shows drift.
- **Dry-run honored.** `dry-run` never sends a notification — but the article and JSON spec still write, because the dashboard widget refreshes regardless. The dry-run gate is for the operator's inbox, not the artifacts.
- **Window override is a power-user knob.** Default 7d is the contract; passing `336` for a 14d retrospective is supported but not advertised in headlines.

---

# Ops branch (`ops`)

Operational summary of one day — what Aeon shipped, what failed, what needs follow-up. The recap is not a log dump — the operator can read the log themselves. Its job is to deliver a **verdict on the shape of the day** and surface the calls that need a human. Lead with a one-sentence TL;DR; cap headlines; demand a URL on every shipped item; and never print empty sections.

Read `memory/MEMORY.md` for context and `memory/issues/INDEX.md` for open issues (both already loaded in the shared preamble — re-read the issues index here if not yet parsed).

## Steps

1. **Determine the date.** `ARG` from the selector is the optional date override.
   ```bash
   TODAY=${ARG:-$(date -u +%Y-%m-%d)}
   ```

2. **Read today's activity log.** Open `memory/logs/${TODAY}.md`.
   - Treat **both** `## ` and `### ` as skill-entry headers (existing logs use both styles — `### autoresearch`, `## Changelog Skill`). Capture each heading text as the skill name and the body until the next heading.
   - If the file is missing or whitespace-only, mark `log=missing` and continue to step 3 — silent failures may still need reporting before exiting.

3. **Cross-check `memory/cron-state.json` for silent failures.** Load it as JSON. For each skill present:
   - `consecutive_failures ≥ 1` and `last_status != "success"` → silent failure (force into Blockers regardless of log content).
   - `last_success` date == TODAY but no log entry for that skill → "ran without logging" (low-severity Blocker).
   - If the file is missing or unparseable, record `cron-state=unavailable` and skip the cross-check (do not abort).

4. **Deduplicate repeat runs.** If the same skill appears N>1 times in the log, fold into one entry labeled `skill ×N`. Keep the most informative run's headline (the one with a PR/URL or the longest body); collapse the rest to `+K more`.

5. **Extract every artifact link.** For each entry, capture every URL or file path in the body (PR link, run URL, `output/articles/...` path, `apps/dashboard/outputs/...` path, ISS-NNN reference). An entry with no concrete artifact is "talk, not ship" — demote it to the Notable tier.

6. **Score and tier each entry on leverage.** What matters for tomorrow's decisions:
   - **Headlines (top tier, cap 5):** new PR opened, change merged, new article shipped, issue resolved or newly filed, new failure pattern.
   - **Notable (mid tier, cap 5):** routine successful runs, repeat outputs, expected cron firings, talk-not-ship entries.
   - **Skip:** pure noise (heartbeat OK with nothing flagged, dedup-only runs, "no new items" reports). Collapse to a count for the footer.

7. **Identify decisions for tomorrow.** Re-scan the day for items that need a *human call*:
   - Failing skills past their retry budget (cron-state `consecutive_failures ≥ 2`).
   - PRs awaiting merge for >24h (use `gh pr list --state open --json number,title,url,createdAt` if `gh` is available; skip if not).
   - Open issues from `memory/issues/INDEX.md` mentioned in today's log without resolution.
   - Conflicting outputs across skills.
   List as concrete asks naming the target ("merge PR #N", "decide whether ISS-007 is wontfix"). If none, omit the section.

8. **Write the TL;DR last.** After steps 2–7, write one sentence that takes a stance on the shape of the day. Examples:
   - "heavy ship day — 5 evolution PRs filed and 0 failures"
   - "quiet — only crons fired, nothing shipped"
   - "two regressions opened, one resolved; net negative"
   - "first failure of `fetch-tweets` in a week — investigate before tomorrow's run"
   No hedging, no "today saw...", no "various activity occurred".

9. **Compose and send the recap via `./notify`.**

   ```
   *Ops Recap — ${TODAY}*
   _TL;DR: <one-sentence verdict from step 8>_

   *Headlines:*
   - [skill] — [one-line outcome] · <URL>
   - ...

   *Notable:*  (omit section if empty)
   - [skill ×N] — [one-line]
   - ...

   *Decisions for tomorrow:*  (omit if empty)
   - [specific ask, named target]

   *Blockers:*  (omit if empty)
   - [skill] — [error in ≤8 words] · <run URL if available>

   _+M routine runs collapsed · sources: log=[ok|missing|empty] cron-state=[ok|unavailable]_
   ```

   **Hard rules:**
   - ≤2000 chars total.
   - **Every Headline bullet must include a URL.** No URL → demote to Notable.
   - TL;DR is mandatory and must take a stance.
   - Never print "none" or "clean" — omit the section instead.
   - Always include the source-health footer line so future-you can debug "why was this recap empty".
   - Lead with shipped artifacts, not skills attempted.
   - **Empty-day exit:** if `log=missing` AND no silent failures AND no decisions, send a single line `*Ops Recap — ${TODAY}*: quiet day, no activity recorded · sources: log=missing cron-state=ok` and stop.

10. **Log to memory.** Append to `memory/logs/${TODAY}.md` (create the file if it didn't exist) under the shared `### operator-scorecard` heading (see the **Log** section) with a `branch: ops` discriminator:
    ```
    ### operator-scorecard
    - branch: ops
    - Sent for ${TODAY}: H headlines, N notable, B blockers, D decisions queued, M collapsed
    - TL;DR: <copy the one-sentence verdict>
    - Sources: log=X cron-state=Y
    ```

---

# Push branch (`push`)

Deep-dive recap of all pushes — reads diffs, ranks impact, separates user-visible shipments from internal work, delivers a verdict. If `ARG` (from the selector) is set, only recap that repo (owner/repo format); if empty, recap all watched repos.

## Config

Reads repos from `memory/watched-repos.md`. If the file doesn't exist, bootstrap it with the repo from `git remote get-url origin` (one line: `owner/repo`) and continue. If bootstrap fails, notify `push-recap: no watched repos configured` and stop. (If `ARG` names a single `owner/repo`, restrict to that repo and skip the file read.)

`memory/MEMORY.md` and the last 2 days of `memory/logs/` are already loaded in the shared preamble for context.

## The thesis

A flat chronological list of commits hides the answer readers actually want: **what shipped to users today, what's internal churn, and what's stuck**. This branch ranks commits by impact, separates user-visible work from maintenance, and leads with a one-line verdict. Noisy days get suppressed instead of flooding the channel.

## Steps

### 1. Gate on signal

Fetch push events + commits for each watched repo from the last 24h:

```bash
SINCE="$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)"

gh api repos/OWNER/REPO/events --jq '[.[] | select(.type == "PushEvent") | {actor: .actor.login, created_at: .created_at, ref: .payload.ref, commits: [.payload.commits[] | {sha: .sha[0:7], message: .message, author: .author.name}]}]' --paginate

gh api repos/OWNER/REPO/commits -X GET -f since="$SINCE" --jq '.[] | {sha: .sha[0:7], full_sha: .sha, message: .commit.message, author: .commit.author.name, date: .commit.author.date}' --paginate
```

Also pull **merged PRs** in the same window (they anchor themes better than raw commits):

```bash
gh pr list --repo OWNER/REPO --state merged --search "merged:>=$SINCE" --json number,title,author,mergedAt,mergeCommit,additions,deletions,files,body,labels --limit 50
```

**Bot filter.** Drop commits whose author matches `dependabot[bot]`, `renovate[bot]`, `github-actions[bot]`, `*-bot`, or whose message starts with `chore(deps):` **unless** they touch files outside `package*.json`/`*.lock`/`.github/`. Note the dropped count — you'll surface it in the footer.

**Significance gate.** After bot-filtering, if the remaining set is all empty across every watched repo: log `PUSH_RECAP_QUIET` to `memory/logs/${today}.md` and **stop — send no notification, write no article**.

If any fetch errors (non-empty `stderr`, rate-limit hit, 5xx), record the repo under `errors[]` and continue with partial data. If **every** fetch fails, log `PUSH_RECAP_ERROR` with the per-repo reasons and notify `push-recap: all sources failed — [reasons]` then stop.

### 2. Classify every commit (user-visible vs internal)

For each commit, read the diff:

```bash
gh api repos/OWNER/REPO/commits/FULL_SHA --jq '{files: [.files[] | {filename, status, additions, deletions, patch}]}'
```

If `patch` is `null` for any file (diff too large), note it and fall back to `{filename, status, additions, deletions}` only.

Classify by file paths touched. A commit is **user-visible** if it touches any of:
- Product source paths (`src/`, `app/`, `lib/`, `pkg/`, `cmd/`, `components/`, `pages/`, `api/`, `routes/`, `handlers/`, `public/`)
- New public surface: new file with `export`, new HTTP route, new CLI flag, new config key, new migration, new schema field
- UI strings, copy, templates, public docs
- Release/version files (`package.json` version bump, `CHANGELOG.md`, `VERSION`)

A commit is **internal** if it *only* touches: `tests/`, `__tests__/`, `*.test.*`, `.github/`, `ci/`, `scripts/`, `docs/internal/`, `.vscode/`, lockfiles, dotfiles, or is a pure dependency bump.

A commit is **infra** if it *only* touches CI/CD, Docker, Terraform, workflow files. Infra is a third bucket — not user-visible, not internal engineering churn, but worth calling out separately.

### 3. Rank impact

Compute an impact score per commit:

```
impact = (additions + deletions) × user_visible_multiplier × breadth_multiplier
  user_visible_multiplier = 2.0 if user-visible, 1.2 if infra, 1.0 if internal
  breadth_multiplier = 1 + 0.2 × min(files_touched, 5)
```

Read diffs in full for the **top 10 by impact** plus every commit linked to a merged PR. For the rest, skim filename + stats only.

### 4. Write the verdict

After ranking, produce a **one-line verdict** that describes today in ≤12 words. Pick exactly one shape:
- `SHIPPING — <user-visible thing that went out>`
- `BUILDING — <feature in progress, not yet user-visible>`
- `HARDENING — <bugs/robustness work dominates>`
- `REFACTORING — <internal restructuring dominates>`
- `MAINTAINING — <deps, CI, chore dominate>`
- `MIXED — <two-thread summary>`

The verdict must be specific (name the thing, not "various improvements").

### 5. Group by theme, then by audience

Cluster commits into 2-4 themes. **Within each theme**, split into subsections:
- **Shipped to users** — user-visible commits. Lead with these.
- **Under the hood** — internal refactors/tests that support the user-visible work.
- **Infra** — CI/CD/deploy changes tied to the theme.

If a theme has no user-visible commits, label it `Internal: <theme>` and push it below user-visible themes in the article.

### 6. Write the deep recap

Write to `output/articles/push-recap-${today}.md`:

```markdown
# Push Recap — ${today}

## Verdict
> <one-line verdict>

**Shape:** X user-visible commits · Y internal · Z infra · N bot-filtered
**Volume:** X files changed, +Y/-Z lines across N commits by M authors
**Merged PRs:** <count> (<#num> <title>; <#num> <title>...)

---

## Top impact today
1. `abc1234` — <commit message>. <one sentence: what the diff actually shows and who notices>. (<files> files, +X/-Y)
2. `def5678` — <commit message>. <one sentence>. (<files> files, +X/-Y)
3. `ghi9012` — <commit message>. <one sentence>. (<files> files, +X/-Y)

---

## owner/repo

### [Theme 1 — descriptive name]

**What this is:** <2 sentences stating the user-facing or developer-facing outcome — not the commit messages repeated>.

**Shipped to users**
- `abc1234` — <message>
  - `path/to/file.ts`: <what the patch actually introduces in plain language> (+85/−4)
  - `new/file.ts`: <what this new file contains> (+45/−0)
- `def5678` — <message>
  - `path/to/other.ts`: <specific change> (+23/−4)

**Under the hood** *(only if present)*
- `ghi9012` — <message>: <one-liner>

### [Theme 2 — descriptive name]
...

### Internal: [Theme 3] *(only if any purely-internal theme exists)*
...

---

## Developer notes
- **New dependencies:** <list with versions, or "none">
- **Breaking changes:** <API/config/schema changes that ripple, or "none">
- **New public surface:** <new routes, CLI flags, config keys, exported functions — the things that show up in docs>
- **Tech debt added:** <new TODOs/FIXMEs introduced in the diff, or "none">

## Open threads
- <branches pushed but not merged, with PR link if any>
- <incomplete work visible in diffs — stubbed functions, commented-out blocks, TODO comments added>

## Sources
<per-repo status line — see the Push source-status footer>
```

Keep it substantive. If there are fewer than 3 user-visible commits, drop the `Top impact today` header and merge those commits into the theme section — don't pad.

### 7. Log before notifying

Append to `memory/logs/${today}.md` under the shared `### operator-scorecard` heading (see the **Log** section) with a `branch: push` discriminator:

```
### operator-scorecard
- branch: push
- Repos: <list>
- Commits: <total> (user-visible: X, internal: Y, infra: Z, bot-filtered: B)
- Merged PRs: <count>
- Verdict: <the one-line verdict>
- Article: output/articles/push-recap-${today}.md
- Sources: <per-repo ok/error/empty>
```

### 8. Notify with significance gating

**Skip the notification entirely** if all of the following are true (log `PUSH_RECAP_LOW_SIGNAL` and stop):
- Zero user-visible commits
- ≤3 internal commits
- Zero merged PRs

Otherwise send via `./notify`:

```
*Push Recap — ${today}*
<repo> — <verdict>

Shipped to users:
• <top user-visible commit, specific sentence>
• <second>
• <third — omit if fewer than 3 user-visible>

Under the hood:
• <top internal change worth mentioning, or omit this block if noise>

Shape: X user-visible · Y internal · Z infra · N bot-filtered · P merged PRs
Volume: X files, +Y/-Z lines

Full recap: https://github.com/$(git remote get-url origin | sed -E 's|.*github.com[:/]([^/]+/[^/.]+).*|\1|')/blob/main/output/articles/push-recap-${today}.md
```

The notification must let a reader know what shipped without clicking through. Names and numbers, not "various improvements." Each bullet must cite at least one: specific file, specific feature, specific user impact.

## Push source-status footer (required in article)

End every push-recap article with:

```
## Sources
- OWNER/REPO: <ok | rate-limited | partial (<reason>) | empty | error (<reason>)>
- gh api events: <ok | fail>
- gh api commits: <ok | fail>
- gh pr list: <ok | fail>
- bot-filtered: <count>
- diff-truncated: <count>
```

This distinguishes `PUSH_RECAP_QUIET` (real empty) from `PUSH_RECAP_ERROR` (all fetches failed) from `PUSH_RECAP_PARTIAL` (some repos fetched, some didn't) in future-you's debugging.

## Push constraints

- Do not repeat the commit message verbatim as "what changed" — read the patch and state what the code now does.
- Do not invent user impact. If the diff only shows internals, say "internal: <what>", not "improves user experience by <speculation>".
- Do not pad the notification with boilerplate when the day was quiet — the gate exists so the channel stays high-signal.
- Do not skip the source-status footer even on successful runs.

---

## Log

All three branches log under a single `### operator-scorecard` heading (the health loop parses this shape) with a `branch:` discriminator line naming which branch ran:

- **`branch: scorecard`** → the block from scorecard step 9 (window, verdict, three-lane summary, article + dashboard paths, notification-sent, `OPERATOR_SCORECARD_*` status).
- **`branch: ops`** → the block from ops step 10 (H/N/B/D counts, TL;DR, sources).
- **`branch: push`** → the block from push step 7 (repos, commit split, merged PRs, verdict, article, sources), or the bare `PUSH_RECAP_QUIET` / `PUSH_RECAP_ERROR` / `PUSH_RECAP_LOW_SIGNAL` status line when the branch stops early before composing the full block.

Append one block per run (never overwrite) so re-running the same branch on the same day shows drift.

## Network note

- **scorecard branch:** Pure local file I/O — no curl, no `gh api`, no secrets on the command line. Works in a GitHub Actions run without any of the extra auth handling the other branches need. The only outbound call is `./notify` itself, which stages to `.pending-notify/` for the workflow to re-deliver after the run.
- **ops branch:** All inputs are local file reads (logs, issues index, cron-state). `gh pr list` runs through the GitHub CLI (auth handled internally) — if it fails, treat the source as unavailable and skip the PR-staleness check. `./notify` stages to `.pending-notify/` for re-delivery after the run, so delivery is reliable.
- **push branch:** `gh api` and `gh pr list` handle auth internally and work in a GitHub Actions run. If a call returns a rate-limit error (403 with `X-RateLimit-Remaining: 0`), record it in the source-status footer and continue with what you have. For large diffs where the `patch` field is `null`, fall back to filename + additions/deletions stats. Never use raw `curl` against the GitHub API — always `gh api`.
