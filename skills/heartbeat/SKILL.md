---
name: heartbeat
description: Ambient fleet-health check that surfaces anything worth attention (default), or an on-demand priority brief - the 3 things to focus on, why now, and what moved (var=brief)
scorable: false  # meta skill: no gradable output, skip the post-run quality scorer
metadata:
  title: Heartbeat
  category: core
  var: ""  # ""=ambient fleet check (LIVE scheduled path, unchanged); "brief"/"brief:<area>"=priority brief; any other value=ambient check focused on that area
  tags:
    - meta
  requires:
    - RESEND_API_KEY?
---
> **${var}** — selector. **Empty (default)** = the ambient fleet check — the live path a cron runs once a day; leave it empty for the scheduled run. **`brief`** = the priority brief. See the grammar below.

## Selector / `${var}` grammar

- **`` (empty)** — **Ambient check** across all skills / PRs / issues, and regenerate the public status page. This is the live, scheduled path (08:00 UTC daily); its behaviour is unchanged. Leave `${var}` empty for the cron.
- **`<area>`** (any non-empty value that is not `brief`, e.g. `crypto`, `prs`) — **Ambient check**, with the checks focused on that area (original heartbeat focus-area behaviour).
- **`brief`** — **Priority brief**: rank the 3 things to focus on today, why now, and what moved since yesterday; send via `./notify` + email.
- **`brief:<area>`** (e.g. `brief:crypto`) — **Priority brief** biased toward `<area>`.

## Shared setup (every run)

Read `memory/MEMORY.md` and the last 2 days of `memory/logs/` for context.

Parse `${var}` to pick the branch:
- **starts with `brief`** (i.e. `brief` or `brief:<area>`) → run the **Priority brief** branch. Any text after `brief:` is the emphasis area.
- **otherwise** (empty, or any other value) → run the **Ambient check** branch. A non-empty value is the focus area; empty runs all checks.

The two branches are mutually exclusive — run exactly one per invocation.

---

## Ambient check  (default — empty `${var}`; the LIVE scheduled path)

If `${var}` is set to a focus area, focus checks on that specific area.

### Checks (in priority order)

#### P0 — Failed & stuck skills (check first)

Read `memory/cron-state.json`. **If the file is missing or empty** (e.g. a fresh fork whose scheduler hasn't written it yet), treat state as empty: report `no cron-state yet` for the P0 tier, skip the failure/degradation checks below, and still render the status page (every enabled skill shows `not yet run`). This file tracks every scheduled skill's state and quality metrics:
```json
{
  "skill-name": {
    "last_dispatch": "2026-04-06T12:00:00Z",
    "last_status": "dispatched|success|failed",
    "last_success": "2026-04-06T12:05:00Z",
    "last_failed": "2026-04-05T12:03:00Z",
    "total_runs": 10,
    "total_successes": 8,
    "total_failures": 2,
    "consecutive_failures": 0,
    "success_rate": 0.80,
    "last_quality_score": 4,
    "last_error": "error signature text"
  }
}
```

**Bootstrap grace (fresh / warming-up fleets).** Before flagging anything, decide whether the fleet has *completed* any run yet. A skill has **completed a run** if its entry has `total_runs ≥ 1` **or** a non-null `last_success`/`last_failed`. A skill that only ever shows `last_status: "dispatched"` (or has no entry) has **not** completed a run — it is *warming up*, the normal state right after a fork or after a skill is enabled, **not** a failure. The scheduler stamps `dispatched` at run *start* and the outcome only lands *after* the run finishes, so a just-dispatched skill legitimately has no outcome yet.
- **If no skill has completed any run yet, the whole fleet is bootstrapping** — expected on a fresh fork. Do **not** flag warming-up skills as failed or stuck, do **not** fire a notification, and set the overall status to `🟢 OK` with a warming-up note (see [Overall status](#overall-status)). Still render the status page (skills show `⏳ warming up` / `not yet run`), then end.
- **Otherwise** (some skills have completed runs) run the checks below, but keep the distinction: a skill that has *never completed a run* is never a 🔴 "stuck" — it belongs on the softer warming-up line.

**Self-reference.** Heartbeat is, by definition, running *right now*, so its own entry is never evidence of a problem:
- **Exclude heartbeat's own entry from the Stuck check.** Its `dispatched` watermark is just the current (or a prior in-flight) heartbeat run.
- The Self-check below fires **only once heartbeat has succeeded at least once**. A never-succeeded heartbeat is bootstrap, not degradation — its first success only lands *after* this run finishes, so "no success yet" must never turn the page red.

Flag these conditions:
- **Failed skills**: any entry with `last_status: "failed"`. Report the skill name and when it failed. (A skill whose only recorded outcome is a failure is still a completed run — report it; the severity rules decide whether it reddens the page.)
- **Stuck skills**: any entry (**excluding heartbeat itself**) with `last_status: "dispatched"`, `last_dispatch` **>45 minutes ago**, that has **completed ≥1 run before** (`total_runs ≥ 1`) and whose `last_dispatch` is newer than `last_success`. The skill was working, then a later dispatch never reported back — a hang, or a lost outcome-write. If `last_success` is recent (within ~2h of the stale dispatch), lean toward a lost outcome-write (a 🟡 blip), not a hard hang.
  - A skill dispatched >45min ago that has **never** completed a run is *warming up*, not stuck — put it on the warming-up line, not P0. Only if that first dispatch is **>24h** old, surface it as a 🟡 WATCH (`dispatched Nh ago, never completed — scheduler may not be wired up`); still not 🔴.
- **API degradation**: any skill with `consecutive_failures >= 3`. This likely indicates an external API is down or rate-limiting. Report the skill, failure count, and `last_error`. If multiple skills share similar error signatures, flag the shared dependency.
- **Chronic failures**: any skill with `success_rate < 0.5` (and `total_runs >= 5`). The skill is failing more than it succeeds.
- **Self-check**: only if heartbeat's own entry has **≥1 success** (`total_successes ≥ 1`) **and** its `last_success` is **>36 hours ago**, note that heartbeat itself may be unreliable. If heartbeat has never succeeded, say nothing here — that's warming-up, covered by Bootstrap grace above.

#### P1 — Stalled PRs & urgent issues

- [ ] Any open PRs stalled > 24h? (use `gh pr list`)
- [ ] Any GitHub issues labeled urgent? (use `gh issue list`)

#### P2 — Flagged memory items

- [ ] Anything flagged in memory/MEMORY.md that needs follow-up?

#### P3 — Missing scheduled skills

Read `aeon.yml` for enabled skills with schedules. Cross-reference with `memory/cron-state.json`:
- If an enabled skill has **no entry at all** in the state file, it has never been dispatched by the scheduler.
- If a skill's `last_success` is **>2x its schedule interval** old (e.g., a daily skill hasn't succeeded in >48h), flag it.

**Skip P3 entirely on a bootstrapping fleet** (per [Bootstrap grace](#p0--failed--stuck-skills-check-first) — no skill has completed a run yet). On a fresh fork *every* skill is un-dispatched or warming up; that is expected, not a fleet of missing skills, and must not generate findings or a notification. Only run P3 once the fleet has warmed (at least one completed run), and even then a skill still in its very first dispatch window is warming up, not missing.

Do NOT use `gh run list` for this — the state file is authoritative.

### Dedup & notification

Before sending any notification, grep memory/logs/ for the same item. If it appears in the last 48h of logs, skip it. Never notify about the same item twice.

Batch all findings into a **single notification**, grouped by priority tier:
```
🔴 FAILED: skill-a (failed 2h ago), skill-b (stuck 1h ago)
🟡 STALLED: PR #42 open 3 days
🔵 MEMORY: follow-up on X flagged 2 days ago
```

### Public status page

After the priority checks (even when everything is green — this step **always** runs), regenerate `docs/status.md` so it reflects current fleet health.

#### Data sources
- `memory/cron-state.json` — per-skill run state (authoritative)
- `memory/issues/INDEX.md` — open issue table
- `aeon.yml` — enabled skill list with schedules
- Latest `output/articles/token-report-*.md` (most recent by filename date) — optional; powers the Token Pulse section. Skipped silently when no file exists.

#### Overall status
Compute one of three overall states from the same signals used above. This verdict drives the **public, fork-facing** status page, so reserve 🔴 for skills that are *currently broken* — a single transient failure a skill has already recovered from must not flip the whole page red, and a fresh fork whose skills simply haven't finished their first cycle must never read 🔴:

**Bootstrap first.** If the fleet is *warming up* — no skill has completed a run yet (per [Bootstrap grace](#p0--failed--stuck-skills-check-first)) — the status is `🟢 OK`, annotated `🌱 warming up — N skill(s) dispatched, awaiting first completed run`. Skip the rest of this ladder. Warming-up skills (dispatched, never completed) never count toward 🔴 or 🟡 (except the >24h "may not be wired up" watch-item), and heartbeat's own entry never counts toward its own verdict.

Otherwise:
- `🔴 DEGRADED` — a skill is **currently and persistently broken**: a stuck skill (per the refined Stuck rule — completed ≥1 run before and a later dispatch has hung; **not** a warming-up first dispatch, **not** heartbeat's own entry); `consecutive_failures ≥ 3`; chronic failures (`success_rate < 0.5` with `total_runs ≥ 5`); heartbeat self-check >36h stale (only once heartbeat has ≥1 success); or a `last_status: "failed"` skill that has **not recovered since** (`last_failed` ≥ `last_success`) **and** `consecutive_failures ≥ 2`.
- `🟡 WATCH` — a transient blip or watch-item: a `last_status: "failed"` skill that already recovered (`last_success` > `last_failed`); **or** any other `last_status: "failed"` skill that does not meet the 🔴 bar above (e.g. a first or isolated failure, `consecutive_failures ≤ 1`, including a skill whose only run so far failed) — a non-recovered failure must never read 🟢 OK; a stuck skill whose `last_success` is recent (likely a lost outcome-write, not a hang); a warming-up skill whose first dispatch is >24h old (possibly not wired up); or any P1/P2/P3 flag (stalled PRs, urgent issues, flagged memory items, skills >2x their schedule interval old); or any open issue with severity `critical` or `high`.
- `🟢 OK` — no flags at all (a fully warmed, healthy fleet, or a bootstrapping fleet per the Bootstrap-first clause).

This refines **only** the public status-page colour. It does **not** change the P0 notification rules above — a fresh `last_status: "failed"` still fires its notification (deduped per the rules above) so the operator is always told; the page just won't read 🔴 for a blip the fleet has already shrugged off.

#### Format

Write `docs/status.md` with frontmatter so it renders as a status page:

```markdown
---
layout: default
title: "Status"
permalink: /status/
---

# Agent Status

**Overall:** 🟢 OK
**Updated:** 2026-04-24 19:06 UTC
**Open issues:** 0
**Next scheduled run:** heartbeat at 08:00 UTC

Auto-generated by the `heartbeat` skill on every run (daily at 08:00 UTC). If the Updated timestamp is more than ~26h stale, the agent is not running.

## Token pulse

| Token | Price | 24h | Liquidity | Volume (24h) | FDV |
|-------|-------|-----|-----------|--------------|-----|
| <TOKEN> | $0.0000032626 | -11.16% | $223.4K | $41.3K | $326.3K |

_Source: `output/articles/token-report-YYYY-MM-DD.md` · verdict: SLIDING_ (illustrative — symbol/figures come from the latest token-report)

## Skill health (last 7 days)

| Skill | Last run | Status | Success rate | Consecutive failures |
|-------|----------|--------|-------------:|---------------------:|
| token-report | 2026-04-24 12:30 UTC | ✅ success | 100% | 0 |
| fetch-tweets | 2026-04-24 06:53 UTC | ✅ success | 95% | 0 |
| …           | …                    | …         | …    | … |

## Open issues

_(if INDEX.md has any open rows, render them here; otherwise: "No open issues.")_

| ID | Title | Severity | Category | Detected |
|----|-------|----------|----------|----------|
| ISS-001 | … | medium | rate-limit | 2026-04-22 |

---
*Fork this repo and your copy inherits this page automatically — [how it works](/memory/).*
```

#### Rules
- Include **all** enabled skills from `aeon.yml` (not only those with recent runs). For skills with no entry in cron-state.json, show `—` for timestamp and `not yet run` in status.
- Sort the skill table by last-run timestamp descending (most recent first); skills that have never run sink to the bottom.
- Format timestamps as `YYYY-MM-DD HH:MM UTC` (strip seconds and the `Z`).
- Success rate shows `total_successes / total_runs × 100` rounded to whole percent; display `—` when `total_runs == 0`.
- Status column icons: `✅ success`, `❌ failed`, `⏳ dispatched` (if last_dispatch within 45min), `🌱 warming up` (dispatched > 45min but the skill has **never completed a run** — `total_runs == 0` and no `last_success`/`last_failed`; this is a fresh dispatch, not a hang), `🕸 stuck` (dispatched > 45min, still `dispatched`, **and** the skill has completed ≥1 run before), `—` (never run). Heartbeat's own row, while its current run is in flight, shows `⏳ dispatched` — never `🕸 stuck`.
- For the `Next scheduled run:` line, pick the enabled skill with the soonest upcoming cron time relative to now.
- Dedup state: re-running heartbeat overwrites `docs/status.md` wholesale each time — do not append.
- Never expose values from `.env`, secrets, or anything outside cron-state.json + issues/INDEX.md + aeon.yml + output/articles/token-report-*.md. This file is public.

#### Token pulse rules
- Pick the **latest** `output/articles/token-report-*.md` by filename date (sort descending, take the first match).
- **Staleness:** if the picked file's date is older than 24h relative to the heartbeat run timestamp, render `_No recent token data (latest report YYYY-MM-DD)._` in place of the table — do not lift stale figures into the table.
- **No file at all:** omit the `## Token pulse` section entirely. The status page must still render cleanly with no token row.
- **Token symbol:** read from `memory/MEMORY.md` "Tracked Token" table (first row, `Token` column). If the table is missing, render the heading as `## Token pulse` with the symbol column blank.
- **Field extraction (regex, tolerant of both old `Value | 24h Change` and new `Now | 24h Δ` table layouts):**
  - **Price:** first `| Price |` row → first `$` value in the row → strip whitespace.
  - **24h:** same Price row → first `±?\d+(\.\d+)?%` token in the row (typically the second cell). Render as written, preserving sign. If absent, render `—`.
  - **Liquidity:** first `| Liquidity |` row → first `$` value.
  - **Volume (24h):** first row whose first cell matches `Volume\b.*24h` or `24h Volume` → first `$` value.
  - **FDV:** first `| FDV |` row → first `$` value.
  - For any field whose row or `$` value cannot be located, render `—` for that cell only — do not skip the section.
- **Verdict line:** if the source article contains a `**Verdict:** LABEL` line, append `· verdict: LABEL` to the source line. If no Verdict line is present (older format), omit the suffix.
- **Source link:** the trailing `_Source: ..._` line names the exact article file used so a reader can verify the numbers.

The file lands on `main` through the workflow's auto-commit step — no explicit `git` commands needed in this skill.

### Output (ambient)

If nothing needs attention, log "HEARTBEAT_OK" (plus the overall status page verdict, e.g. `HEARTBEAT_OK · STATUS_PAGE=OK`) and end your response.

**A bootstrapping / warming-up fleet counts as "nothing needs attention".** Still regenerate `docs/status.md` (verdict `🟢 OK`, warming-up note), log `HEARTBEAT_OK · STATUS_PAGE=OK (warming up)`, and **send no notification** — a fresh fork should be quiet, not a red alert. Warming-up skills are not "findings".

If something needs attention:
1. Send a single concise notification via `./notify` (grouped by priority as above)
2. Log the findings and actions taken to memory/logs/${today}.md (under the shared `### heartbeat` heading — see [Log](#log) — with a `mode: ambient` discriminator line)
3. Log one line with the status-page verdict, e.g. `STATUS_PAGE=DEGRADED — wrote docs/status.md`

---

## Priority brief  (`${var}` = `brief` or `brief:<area>`)

<!-- autoresearch: variation B — priority-driven, decision-ready output (cut noise, demand "why now") -->

Runs **instead of** the ambient check. Any text after `brief:` (e.g. `brief:crypto`) is the area to emphasize; a bare `brief` covers all areas.

A good brief is a **priming document**, not a news dump. Every line must answer "so what?".

Today is ${today}. Read `memory/MEMORY.md`, `memory/logs/${yesterday}.md` (and today's if it exists), and `memory/cron-state.json` (if present).

### 1. Rank, don't aggregate

Collect candidate items from:
- MEMORY.md "Next Priorities"
- Yesterday's log: unfinished work, follow-ups, notes
- Pending repo items: `gh pr list --state open --limit 10` and `gh issue list --state open --limit 10 --assignee @me`
- `memory/cron-state.json`: skills with `consecutive_failures >= 2` or `success_rate < 0.8`
- `aeon.yml`: skills whose cron matches today

Score each candidate on **leverage × urgency**:
- Leverage = does progressing this change the next 7 days?
- Urgency = does delay today make it worse?

Keep at most **3 focus items**. Everything else either goes in "Since yesterday" or is dropped. If the emphasis area is set (`brief:<area>`), bias ranking toward that area but do not force a focus item if nothing qualifies.

### 2. Headlines — only if they change priorities

Use `WebSearch` for 2 headlines in the user's tracked areas (AI and crypto by default; emphasize the `brief:<area>` value if set). Include a headline **only if** it meaningfully updates one of the 3 focus items, flags a new risk, or implies an action (a deadline, a market move, a shipped competitor, a disclosed exploit). If nothing qualifies, omit the Watch section entirely. No filler.

### 3. Format — terse, scannable, opinionated

```
*Priority Brief — ${today}*

*Focus today*
1. [item] — why now: [≤12 words]
2. [item] — why now: [≤12 words]
3. [item] — why now: [≤12 words]

*Since yesterday*
- [moved]: what changed (link if relevant)
- [stuck]: what's blocked, on whom

*Watch* (omit entirely if nothing qualifies)
- [headline] — implication for focus #N

*Running today*
- skill @ HH:MM UTC
```

Style rules:
- Every focus item should state *why now* in ≤12 words. If you can't, demote it.
- "Since yesterday" is ≤5 bullets; merge duplicates across PR/issue/log sources.
- No throat-clearing ("here's your briefing…"). Lead with Focus.
- No empty sections — omit rather than print "(none)".
- If fewer than 3 candidates survive the why-now bar, allow **up to 1 background item** (tagged `background:` instead of `why now:`) so the brief still surfaces something worth knowing on quiet days. Never invent items, and never include more than 1 background item.
- If soul files under `soul/` are populated, match that voice; otherwise keep it direct and neutral (per CLAUDE.md).

### 4. Send via `./notify` and email

- Send the formatted brief with `./notify "..."`.
- Send email via Resend (**optional — skip cleanly when unconfigured**):
  - **Preflight:** if `$RESEND_API_KEY` is empty/unset **or** `$BRIEF_RECIPIENTS` has no addresses, **skip the email step entirely** — the `./notify` send above already delivered the brief. Note the skip in the log (`email: skipped (no RESEND_API_KEY)`) and continue; do **not** fail the run. `RESEND_API_KEY` is an optional dependency.
  - When configured:
    - Build the brief as HTML (wrap each section in `<h2>` headers, `<ul>/<li>` bullets)
    - Also keep a plain-text copy (the `./notify` content above, as-is)
    - Parse `$BRIEF_RECIPIENTS` as a comma-separated list of addresses
    - POST to `https://api.resend.com/emails`:
      ```
      Authorization: Bearer $RESEND_API_KEY
      Content-Type: application/json

      {
        "from": "Aeon Briefings <onboarding@resend.dev>",
        "to": ["<each recipient>"],
        "subject": "[Aeon] Priority Brief — ${today}",
        "html": "<html version>",
        "text": "<plain-text version>"
      }
      ```
    - Log the `id` field from the Resend response to `memory/logs/${today}.md` for traceability
    - If the key **is** set and Resend returns an error, log the full error body and fail loudly (do not silently continue) — a real send failure is a signal, an absent optional key is not
- Append to `memory/logs/${today}.md` under the shared `### heartbeat` heading (see [Log](#log)) with a `mode: brief` discriminator line: timestamp, the 3 focus items (one line each), headline count, and any skills flagged from cron-state. This becomes tomorrow's "since yesterday" input.

---

## Log

Both branches append to `memory/logs/${today}.md` under a **single `### heartbeat` heading** (the health loop parses this shape). Begin the entry with a discriminator line naming the branch that ran:
- `mode: ambient` — the default fleet check. Log the status-page verdict, e.g. `STATUS_PAGE=OK`, or `HEARTBEAT_OK · STATUS_PAGE=OK` when nothing needed attention; on findings, log the findings and actions taken plus the `STATUS_PAGE=…` line.
- `mode: brief` — the priority brief. Log the timestamp, the 3 focus items (one line each), the headline count, and any skills flagged from cron-state.

## Network note

Applies to both branches. `curl` works — there is no network sandbox. Use **WebFetch** as a fallback for a flaky public GET. For GitHub queries (both branches use `gh pr list` / `gh issue list`), use the `gh` CLI (handles auth internally) rather than curl. The priority-brief Resend POST carries the `RESEND_API_KEY` secret — a bare `$RESEND_API_KEY` on the command line is refused by the Bash permission layer, so send it with `./secretcurl` using a `{RESEND_API_KEY}` placeholder (WebFetch can't carry a secret).
