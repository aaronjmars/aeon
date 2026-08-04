---
name: idea-pipeline
description: Execution-gap audit - cross-references the startup idea backlog against shipped skills, prototypes, and cross-repo PRs, surfacing the top 3 ideas to build next by narrative and operator fit.
metadata:
  category: productivity
  var: ""
  tags:
    - meta
    - creative
---
> **${var}** — Optional theme filter (e.g. "crypto", "AI agents", "consumer"). If empty, scans all ideas. A `pick:<id|name>` value (from the "build next?" force-reply — e.g. `pick:2` or `pick:Onchain reputation`) instead marks that idea as chosen-to-build in the backlog and ends, skipping the audit — see step 0.

Today is ${today}. Read `memory/MEMORY.md` before starting. If `soul/SOUL.md` + `soul/STYLE.md` exist and are populated, read them to ground "operator fit" scoring; otherwise score on the idea's general buildability and timing alone.

## Why this skill exists

`idea-validator` evaluates ideas. Nothing tracks execution. Backlogs of dozens of ideas accumulate — some validated, most unscreened — with zero visibility into which ones have been acted on vs which are rotting. This skill gives that view: pipeline size, execution rate, and the 3 ideas closest to being buildable right now.

## Steps

### 0. Force-reply interception — `pick:<idea>` (run FIRST, before anything else)

Before any other work, inspect `${var}`. If it **starts with `pick:`**, this run is the operator answering the "which idea to build next?" force-reply — do **not** run the normal audit. Handle it and end:

1. Strip the prefix: `sel="${var#pick:}"`, then trim surrounding whitespace. The remainder may contain colons/spaces — keep them.
2. If `sel` is empty, send a plain re-ask (no force-reply) and end: `./notify "Which idea should I mark as next to build? Reply with its name or backlog number."`
3. Read the shared backlog `memory/topics/startup-ideas.md`. If it's missing or has no idea rows, `./notify "No idea backlog yet — nothing to mark. Run idea-forge generate to fill it first."` and end.
4. Resolve `sel` to exactly one idea row in the table (columns `| date | name | one-liner | fit | T+F+E |`):
   - **By name (preferred):** case-insensitive exact match on the `name` cell; else fuzzy — the row whose name shares the most significant words with `sel`, or where `sel` is a substring of the name (or vice-versa). Require one clear best match.
   - **By number:** if `sel` is a bare integer N and no name matches, take the Nth data row (1-based, in file order).
   - If nothing matches, or two rows tie with no clear winner, send a plain re-ask listing 3–5 candidate names and end: `./notify "Couldn't find an idea matching \"<sel>\". Reply with the exact name or backlog number. Candidates: <name1>, <name2>, <name3>."`
5. **Mark it chosen-to-build** — the shared marking convention (identical in idea-forge): append ` ✓ selected ${today}` to the end of that row's `name` cell, keeping the table pipes intact. If the cell already carries a `✓ selected` marker, leave it (idempotent) — it's already queued.
6. Confirm with a short `./notify` (keep it clean — no `test`/`trace`/`ping`/`debug` substrings): `./notify "Marked \"<idea name>\" as next to build — flagged in the backlog. Run /feature or /deploy-prototype on it when you're ready."` Do not auto-dispatch any skill — marking chosen is the safe action.
7. Log to `memory/logs/${today}.md` under a `### idea-pipeline` heading: `- IDEA_PIPELINE_PICK: marked "<idea name>" as chosen-to-build (from a pick: reply)`.
8. **End the run.** Do not proceed to step 1 or run the audit.

### 1. Load the idea backlog

Read `memory/topics/startup-ideas.md`. If it doesn't exist, log `IDEA_PIPELINE_SKIP: no backlog at memory/topics/startup-ideas.md` and stop — there's nothing to audit.

Parse the ideas table: extract name, one-liner, category/vertical, and date added for each idea. Total = N_total.

### 2. Load screening results

Read `memory/topics/startup-ideas-screened.md` (create if missing — empty table header only).

Extract ideas that have been screened. N_screened = count of rows.

From screened ideas, note those with `viability >= 9` (high-potential). These are the priority pipeline.

### 3. Check execution — what's been built

**Scan skills directory:**
```bash
ls skills/
```
Collect the list of skill directory names. These are "executed ideas" in the agent space.

**Scan cross-repo PRs by the operator and their bot accounts.** Read `memory/topics/git-identities.md` if present (operator-defined list of GitHub usernames to scan). Fall back to the workflow's `GITHUB_ACTOR` if no list is configured.

```bash
gh pr list --author ${USERNAME} --state merged --limit 30 --json title,url,mergedAt
```

**Scan deployed prototypes:** read `memory/topics/prototypes.md` (or `memory/topics/vercel.md`) if either exists. Treat any project flagged as a prototype/MVP as a shipped idea.

**Scan recent builds:** read the last 14 days of `memory/logs/` and collect any `BUILD_SKILL_OK`, `CREATE_SKILL_OK`, or `DEPLOY_PROTOTYPE_OK` entries.

### 4. Cross-reference: idea vs execution

For each idea in the full backlog:
- Check if any skill name or PR title contains keywords from the idea name/one-liner (fuzzy keyword match — at least 2 significant words overlap, or the core concept is clearly represented)
- Classify as: `executed` (clear match found) or `unexecuted`

N_executed = count of ideas with a clear match.
N_gap = N_total − N_executed.

### 5. Load narrative context

Read `memory/topics/market-context.md` if present for current narrative keywords (tokens trending, tech themes, regulatory signals).

Read recent logs for any narrative signals (last 3 days).

Compile a list of 8–12 active narrative keywords (e.g. "agent payments", "RWA", "prediction markets", "privacy coins"). If no market-context source exists, derive keywords from recent `digest`, `hacker-news`, or `github-trending` outputs.

### 5b. Load builder-ecosystem signal

Read `memory/topics/ecosystem.md` if it exists (written by `builder-map`). This is the second-stream feed — "who's adopting the watched stack" becomes idea fodder.

Extract two things:

- **Underserved categories** — Builder Categories with 0 or 1 known builders in the ecosystem map. Example: "social-sim" with no entries = an opening for a sim-prototype.
- **Adjacent verticals** — non-obvious verticals with active builders. Verticals that already crossed over tell you which directions the stack travels well.

Compile:
- `underserved_categories` — list of 2–5 categories with thin builder coverage
- `adjacent_verticals` — list of 2–4 non-obvious verticals with active builders

If `memory/topics/ecosystem.md` doesn't exist yet, skip this step and log `idea_pipeline: ecosystem_feed=unavailable` in step 10. Do not block the run.

### 6. Score unexecuted ideas for "build this week"

For each UNEXECUTED idea, compute a priority score:

```
priority = narrative_fit + operator_fit_estimated + recency_bonus + ecosystem_gap_bonus

narrative_fit:          0–4 (count of active narrative keywords that appear in idea name/one-liner/category; cap at 4)
operator_fit_estimated: 0–2 — read `soul/SOUL.md` if present; +2 if the idea matches the operator's stated themes, +1 if it's solo-buildable AND adjacent to current work, 0 otherwise. If no soul file, score 0 here and let other factors decide.
recency_bonus:          2 if added in last 14 days; 1 if last 30 days; 0 otherwise
ecosystem_gap_bonus:    3 if idea's category matches an `underserved_category` from step 5b; 2 if it matches an `adjacent_vertical`; 0 otherwise
```

Tie-break preference when scores match: ideas that fill an underserved-category gap > ideas that hit a hot narrative. The ecosystem signal is structural (where the stack is going); narratives rotate.

If `${var}` is set, additionally filter to ideas whose category/text matches `${var}`.

Sort descending. Pick top 3. For each pick, in step 7's `Why now:` line, name the ecosystem signal explicitly if `ecosystem_gap_bonus > 0` (e.g. "no builders on the stack in this category yet" or "adjacent-vertical adoption arc").

### 7. Format and write the report

Write to `output/articles/idea-pipeline-${today}.md`:

```markdown
# Idea Pipeline — ${today}

**Total ideas:** N_total | **Screened:** N_screened | **Executed:** N_executed | **Gap:** N_gap

## Build This Week

### 1. [Idea Name]
**One-liner:** [one-liner from backlog]
**Why now:** [1–2 sentences connecting to active narratives or ecosystem signal]
**Operator fit:** [why this fits the operator's stack/worldview — derived from soul/SOUL.md if present, otherwise the idea's general buildability]
**Execution path:** [one sentence on fastest way to build — skill, prototype, or external PR]

### 2. [Idea Name]
...

### 3. [Idea Name]
...

## Execution Log
Ideas already shipped (skill/prototype/PR match found):
- [executed idea] → [matching skill name or PR URL]
- ...

## High-Potential Unscreened
Top 3 ideas not yet screened by idea-validator that look most promising by keyword signal alone:
- [idea] — [one-liner]
- ...

---
*Source: memory/topics/startup-ideas.md | Generated by idea-pipeline*
```

### 8. Decide whether to notify

Always notify.

### 9. Format and send notification

Write to `.pending-notify-temp/idea-pipeline-${today}.md` (create dir if needed), then:

```bash
mkdir -p .pending-notify-temp
./notify -f .pending-notify-temp/idea-pipeline-${today}.md
```

**Notification format** — match the operator's voice if soul files are populated, otherwise direct and neutral:

```
idea pipeline — ${today}

${N_total} ideas. ${N_screened} screened. ${N_executed} executed. ${N_gap} waiting.

build this week:

1. [Idea Name] — [one-liner]
   why now: [1 sentence on timing/narrative fit]
   path: [skill / prototype / external-PR in ~N days]

2. [Idea Name] — [one-liner]
   why now: [1 sentence]
   path: [...]

3. [Idea Name] — [one-liner]
   why now: [1 sentence]
   path: [...]
```

Keep under 3000 chars.

### 9b. Offer a "build next?" follow-up (force-reply)

If **at least one** idea was surfaced under "Build This Week", offer the operator a one-tap way to pick which to build — as a **separate** `./notify` after the digest (a digest and a force-reply prompt can't share one Telegram message). Skip the offer entirely on a run that surfaced no picks.

Dedup to once per day: scan the last ~2 days of `memory/logs/` for `FORCE_REPLY_OFFERED: idea-pipeline::pick`; if present, skip this offer. Otherwise send:

```bash
./notify "Which of these should I mark as next to build? Reply with the idea's number or name." \
  --force-reply --placeholder "idea # or name" \
  --context "idea-pipeline::pick"
```

Then record the `FORCE_REPLY_OFFERED: idea-pipeline::pick` marker in step 10. A `pick:` reply routes back to this skill and is handled by step 0.

### 10. Log to memory

Append to `memory/logs/${today}.md`:

```markdown
### idea-pipeline
- **Total ideas:** N_total
- **Screened:** N_screened (by idea-validator)
- **Executed:** N_executed (skill/prototype/PR match)
- **Gap:** N_gap unexecuted ideas
- **Top pick:** [idea name] — [priority score]
- **Ecosystem feed:** [available / unavailable] — [N underserved categories, M adjacent verticals] (from builder-map ecosystem.md, last run [date])
- **Filter:** [var value or "none"]
- **Notification:** sent
- **Force-reply offer:** [offered / skipped — already offered in last 2 days / skipped — no picks]
- FORCE_REPLY_OFFERED: idea-pipeline::pick   ← include this exact line ONLY when the offer was actually sent (it's the once/day dedup marker)
- IDEA_PIPELINE_OK
```

## Required Env Vars

None. Uses local file reads and `gh` CLI (authenticated via GITHUB_TOKEN in workflow).

## Network Note

No external network calls in the main logic. `gh pr list` uses the `gh` CLI which handles auth internally (no curl + token pattern needed). WebSearch not required — narrative context comes from `memory/topics/market-context.md` if a `market-context` skill has populated it.
