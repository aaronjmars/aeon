---
name: action-converter
description: 5 concrete real-life actions, leverage-scored against open loops with specificity and anti-fluff gates
metadata:
  title: Action Converter
  category: basics
  var: ""
  tags:
    - meta
---
<!-- autoresearch: variation B — sharper output via specificity gates, leverage scoring, banned-phrase lint, open-loop anchoring, empty-state taxonomy -->

> **${var}** — Optional focus area (e.g. `health`, `networking`, `learning`, `shipping`, `crypto`, `repo`). If empty, covers all areas. Treated as a tiebreaker, not a hard filter.

Read `memory/MEMORY.md` for stated goals, "Next Priorities", tracked items, and current topics.
Read the last 7 days of `memory/logs/` for recent activity, patterns, and what's already been suggested or done.
Read `memory/topics/` (every file) for active threads.
Read `memory/cron-state.json` for failing or stuck skills.
Read `memory/watched-repos.md` for repos under attention.
Read `output/articles/` (last 7 days, filenames only — peek at the 2 most recent for theme).
If `soul/SOUL.md` exists, read it for identity, voice, focus areas.
Run `gh pr list --state open --limit 20 --json number,title,createdAt,isDraft,reviewDecision,headRefName 2>/dev/null` to get open PRs (used to anchor "ship" / "review" / "merge" loops).

**Graceful bootstrap** — each of the reads above may be missing on cold starts. For every source, if the file/directory is missing or empty (including `memory/topics/*.md`, `memory/cron-state.json`, and `gh pr list` returning empty or erroring), skip it and record `BOOTSTRAP: <resource> not yet populated` in the run's working notes. Continue with whatever signals are available — the skill must degrade gracefully, never fail. If every single source is empty, fall through to the `ACTION_CONVERTER_NO_CONTEXT` mode below.

## Steps

### 1. Detect mode

Decide which exit mode this run will produce based on context volume:

- **ACTION_CONVERTER_NO_CONTEXT** — if BOTH `memory/logs/` has 0 entries AND `memory/MEMORY.md` is the unmodified template (matches "*Last consolidated: never*" AND "Configure notification channels"). Notify the operator and stop — do not invent actions out of thin air.
- **ACTION_CONVERTER_BOOTSTRAP** — if `memory/logs/` has <3 distinct dates in the last 14 days OR `memory/MEMORY.md` "Next Priorities" still contains template entries ("Configure notification channels", "Run first digest"). Switch the action pool to setup-completion actions: enable specific skills in `aeon.yml`, configure missing notification secrets, run the first digest, populate `memory/topics/` for the first tracked thread, etc. These are still real, named, completable actions — not generic onboarding advice.
- **ACTION_CONVERTER_OK** — otherwise. Use the full leverage-scored loop pipeline below.

### 2. Extract open loops

Build a single deduped list of named open loops from every source above. A loop is a specific in-flight thing, not an area. Each loop captures at minimum: `id` (short slug), `text` (one phrase), `source` (where it came from), `age_days`, `urgency_signal` (deadline / blocker / stalled / fresh).

Sources to mine:
- **Open PRs** — every entry from `gh pr list`. Loop text: `PR #N: <title>` with urgency = `stalled` if >3 days old or review_decision is REQUEST_CHANGES.
- **MEMORY.md "Next Priorities"** — each bullet becomes a loop. Skip template lines.
- **`memory/topics/*.md`** — for each topic file, scan for headings or bullets that look like ongoing work (TODO, WIP, "In progress", "Tracking", trailing question marks, dated items in the last 30 days).
- **`memory/cron-state.json`** — every skill with `consecutive_failures > 0` OR `last_status != success` becomes a loop: `fix <skill>`. Urgency = `blocker` if consecutive_failures ≥ 3.
- **Recent logs (last 7 days)** — any line ending in `?`, containing "blocked", "next:", "todo", "follow-up", "unfinished", or naming a deferred decision.
- **Recent articles (last 7 days)** — each new article opens a distribution/syndication loop ("syndicate <slug>") if `syndicate-article` is enabled, and a feedback loop ("respond to comments on <slug>") if traffic is plausible.
- **${var}** — if set, add a synthetic loop "advance ${var}" so at least one action ties to the requested focus area.

Deduplicate by similarity in `text`. Cap the loop list at 25.

### 3. Score loops

Score every loop on three 1–5 axes. Total = leverage × urgency × concreteness.

| Axis | 1 | 3 | 5 |
|---|---|---|---|
| **leverage** | personal hygiene | useful but local | unblocks others, shippable artifact, or compounds |
| **urgency** | nice-to-have | this week | today (deadline / blocker / >5 day stall on hot loop) |
| **concreteness** | "think about X" | known shape, no draft | next step is one named action |

Drop any loop scoring <8 from the candidate pool. If `${var}` is set, give a +0.5 leverage bump to loops touching that area.

### 4. Convert loops to actions

Convert the top loops into actions until you have 5 distinct ones. Constraints on every action:

1. **Specificity gate** — must name at least one of: a file path, a PR number, a person/handle, a project/repo, a tool/CLI command, a URL, a tracked entity from MEMORY.md. Generic "reach out to people" / "review your goals" / "explore opportunities" fails this gate.
2. **Banned-phrase lint** — reject any action whose `action` text contains: `go for a walk`, `drink water`, `take a break`, `reflect`, `journal`, `meditate`, `brainstorm`, `review your`, `think about`, `consider`, `look into`, `explore opportunities`, `reach out to people`, `network with`, `clean up your inbox`, `organize your`, `plan tomorrow`, `do some reading`, `check social media`. These are filler, not actions.
3. **Time estimate** — must fit in ≤2 hours; bias toward 30–60 min slots.
4. **Definition of done** — one observable check. "PR opened" / "commit pushed" / "message sent to <handle>" / "doc has section X with ≥3 items". Not "feel better" or "have more clarity".
5. **Anti-template (14-day novelty check)** — for each candidate action, extract the verb + main noun. Reject if the same verb+noun appears in any `memory/logs/*.md` from the last 14 days. (Different verb+same noun is fine — only the bigram blocks.)
6. **Score ≥4 on the 1–5 quality scale** below. Anything <4 is dropped and replaced from the next loop in the queue.

Quality 1–5: 1 = filler, 2 = vague, 3 = specific but low-leverage, 4 = specific + tied to a real loop, 5 = specific + high-leverage + would visibly move the project today.

If after exhausting the loop list you have <5 surviving actions, fill the rest from the **category pool below** but only with category-specific candidates that pass all gates above. Categories exist as a fallback, not a checklist:
- **Build** — ship, write, create, deploy, fix, prototype, refactor against a named file/PR
- **Connect** — DM/reply/quote a *named* handle about a *named* topic; comment on a *named* PR/issue
- **Learn** — read a *named* paper/doc/repo and write a 5-bullet takeaway to `memory/topics/`
- **Health/Energy** — only if tied to a named, novel, non-banned action (rare; usually skipped)
- **Money** — concrete revenue/funding/deal step naming a counterparty
- **Position** — write a *named* tweet/cast/post on a *named* claim
- **Explore** — lateral move tied to a named external signal from this week's logs

If even with the category pool you can't reach 5, output fewer (3 or 4) and flag `ACTION_CONVERTER_THIN` in the notify — don't pad.

### 5. Compose the output

Build one **today's shape** line: ≤14 words capturing the dominant theme of the 5 actions ("Ship 2 PRs, unblock failing skill, syndicate yesterday's article" — not "be productive today"). This becomes the lede.

Order the 5 actions by descending quality score, then by descending urgency.

### 6. Send via `./notify`

Use this exact format (`./notify` renders the Markdown per-channel — just write it cleanly):

```
*5 Actions — ${today}*
Shape: <today's shape line>

1. <action — one imperative sentence, names a specific entity>
why: <≤18 words, what makes this leverage today, names a specific signal>
done: <one observable check>
loop: <loop id or "category:<name>" if filled from pool>

2. <action>
why: <…>
done: <…>
loop: <…>

3. <action>
why: <…>
done: <…>
loop: <…>

4. <action>
why: <…>
done: <…>
loop: <…>

5. <action>
why: <…>
done: <…>
loop: <…>

sources: memory=<lines> logs=<days> topics=<files> prs=<open> cron_failing=<n> mode=<OK|BOOTSTRAP|THIN>
```

Notification rules:
- Drop any action whose `done:` line couldn't be written without hand-waving.
- If mode is `ACTION_CONVERTER_NO_CONTEXT`, skip the action list entirely and notify: `*Action Converter — no context yet*` plus a one-line pointer ("Populate memory/MEMORY.md or run a skill to seed memory/logs/").
- If mode is `ACTION_CONVERTER_BOOTSTRAP`, prefix the shape line with `Bootstrap mode: ` and pull all actions from the setup-completion pool.

### 7. Log to `memory/logs/${today}.md`

Append:
```
### action-converter
- **Mode:** OK | BOOTSTRAP | THIN | NO_CONTEXT
- **Focus:** <var or "general">
- **Shape:** <today's shape line>
- **Actions:** N (quality avg <x.x>/5)
- **Loops anchored:** <list of loop ids surfaced>
- **Loops carried over:** <list of high-score loops not chosen, for tomorrow>
- **Notification sent:** yes
```

Carrying loops forward in the log is what powers the 14-day novelty check and lets the next run see what's been deferred.

## Network note

`gh pr list` works in a GitHub Actions run via the `gh` CLI (handles auth internally, so no token touches the command line). If `gh` is unavailable or returns empty, treat the open-PR loop source as `prs=0` and continue — do not block the whole run.

No outbound HTTP is required. All inputs are local files and `gh`. No new env vars.
