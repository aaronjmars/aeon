---
name: skill-health
description: Fleet skill observability with two views - health audits per-skill metrics and files/resolves issues in memory/issues/; analytics ranks the fleet by 7d runs, success rates, and anomaly flags.
metadata:
  title: Skill Health
  category: evolution
  var: ""
  tags:
    - meta
---
> **${var}** — View selector.
> - **empty** → health check across all scheduled skills (default).
> - a **skill slug** (e.g. `token-movers`) → health check for that one skill.
> - `analytics` or `metrics` (optionally `analytics:HOURS`, e.g. `metrics:72`) → fleet metrics view over the last HOURS (default 168 = 7d, cap 720).
> - a bare **integer** (e.g. `168`) → metrics view with that window in hours (legacy shorthand).

<!-- autoresearch: variation C — more robust: memory/issues integration per CLAUDE.md health-skill contract, state-change-gated notifications, graceful missing-data; folds in B's TL;DR+action-directives+top-5 and A's skill-runs fallback. Analytics view absorbed from skill-analytics: ranked fleet view, exit-taxonomy distribution, significance-gated notify + article + dashboard JSON. -->

## Overview

This skill provides two views over the same GitHub-Actions skill-run data. They share a preamble but branch into distinct logic:

- **health** (default): per-skill classification, issue filing/resolution against `memory/issues/`, and a state-change-gated notification. This is the load-bearing self-healing view — its issue contract, `memory/skill-health/` scoring, and `### skill-health` log shape are depended on by the health loop and other skills. Do not weaken it.
- **analytics** (metrics): a fleet-wide ranked view — top runners, failure rates, exit-taxonomy distribution, silent-scheduled detection, and anomaly flags — with a significance-gated notification plus an article and a dashboard JSON spec. `heartbeat` gives binary ok/not-ok per run and the health view audits skills one degradation-band at a time; the analytics view is the only place the operator sees the entire fleet ranked side-by-side.

## Shared preamble (run for either view)

1. Read `memory/MEMORY.md` for high-level context and scan the last ~3 days of `memory/logs/` for recent activity — drop anything already reported so you don't re-report the same signal.
2. Compute `${today}` (UTC date, `YYYY-MM-DD`).
3. **Parse `${var}` → selector** (trim whitespace first):
   - **empty** → `VIEW=health`, `TARGET=all` (all scheduled skills).
   - lowercase first token is `analytics` or `metrics` → `VIEW=analytics`. Parse an optional window argument after a `:` or a space (`analytics:72`, `metrics 336`): if it is a positive integer, `WINDOW_HOURS = min(that, 720)`; otherwise `WINDOW_HOURS = 168`.
   - a bare positive integer (e.g. `168`) → `VIEW=analytics`, `WINDOW_HOURS = min(that, 720)` (legacy skill-analytics shorthand).
   - anything else (a non-keyword, non-integer slug) → `VIEW=health`, `TARGET=<that slug>` (single-skill health check).
4. Dispatch: if `VIEW=health`, run **Health view**; if `VIEW=analytics`, run **Analytics view**.

---

# Health view

`VIEW=health`. Audit skill quality metrics, detect API degradation, **file issues for new failures and resolve them when skills recover**, and notify only when fleet health state actually changes. If `TARGET` is a single skill slug, only check that skill.

## Data sources

1. **`memory/cron-state.json`** — Per-skill quality metrics (as before).
2. **`memory/skill-health/*.json`** — Per-skill quality analysis (Haiku post-run).
3. **`memory/skill-health/last-report.json`** — Last run's classification snapshot (this skill writes it). Used to dedup notifications and detect flapping.
4. **`aeon.yml`** — Enabled skills and schedules.
5. **`memory/issues/INDEX.md`** and `memory/issues/ISS-*.md` — Open issues tracker. Check before filing, update on recovery.
6. **`./scripts/skill-runs --hours 168 --failures --json`** — Fallback source for failures that never wrote to cron-state (runs that crashed before writing, etc.). Run once, parse JSON.
7. **`memory/logs/YYYY-MM-DD.md`** (last 3 days) — Grep for `SKILL_*_ERROR` or `EMPTY` signatures keyed to skills missing from skill-health/*.json.

## Steps

### 1. Gather state

- Parse `aeon.yml` → list of enabled skills with schedules. If `TARGET` is a single skill, filter to just that skill.
- Load `memory/cron-state.json` (if missing or unparseable, treat as empty — first run, not failure).
- Load every `memory/skill-health/*.json` (except `last-report.json`).
- Load `memory/skill-health/last-report.json` if present → `prev_report`. If missing, `prev_report = {}`.
- Run `./scripts/skill-runs --hours 168 --failures --json 2>/dev/null || echo '{}'` → extract any skill with failures in the last 7d that isn't in cron-state (runs that failed before writing state).
- Parse `memory/issues/INDEX.md` → extract open issues with `detected_by: skill-health` and their affected skills. If missing, treat as empty.

### 2. Classify each enabled skill

For each enabled skill, assign one status using the **first matching rule**:

| Status | Trigger |
|---|---|
| **CRITICAL** | `consecutive_failures >= 3` OR (status==failed AND days_since_last_success >= 3) |
| **DEGRADED** | `success_rate < 0.6` OR (latest `skill-health/*.json` avg_score < 2.5 over ≥3 runs) |
| **FLAPPING** | 3+ status transitions (success↔failed) in last 7 days per cron-state history *or* `skill-runs` output |
| **WARNING** | `success_rate < 0.8` OR `consecutive_failures >= 1` |
| **HEALTHY** | `success_rate >= 0.8` AND `consecutive_failures == 0` AND (no skill-health data OR avg_score >= 3) |
| **NO DATA** | no entry in cron-state AND never seen in skill-runs |

Compute **severity score** for sorting: `consecutive_failures × (1 + days_since_last_success/7)`. Ties broken by days_since_last_success desc.

For each CRITICAL/DEGRADED/FLAPPING skill, record:
- `last_error` (from cron-state or nearest log signature)
- `api_host` if the error clearly names one (e.g. `api.coingecko.com`, `api.github.com`)
- `suggested_action` — one of: `FIX CONFIG` (missing secret, bad arg), `WAIT-API` (rate limit, 5xx, timeout on third-party host), `INVESTIGATE` (unrecognised error), `DISPATCH-SKILL` (NO DATA but scheduled — scheduler gap)

### 3. Detect systemic patterns

Group non-HEALTHY skills by shared `api_host` OR shared `last_error` signature. If ≥2 skills share one:
- Emit a single `SYSTEMIC:` callout (e.g. `SYSTEMIC: 3 skills failing on api.coingecko.com (rate_limit)`).
- Do **not** duplicate the same error across per-skill rows — reference the systemic line.

### 4. Reconcile with memory/issues/

**Precondition guard:** only perform issue filing/resolution if `memory/issues/INDEX.md` already exists. If it is missing, the operator has not opted into the issue-tracker contract yet — log `SKILL_HEALTH_ISSUE_TRACKER_MISSING` to `memory/logs/${today}.md`, skip this entire step (and the reconciliation side of step 5), and continue with classification + notification only. Do **not** auto-create `INDEX.md`.

For each CRITICAL or FLAPPING skill, check if an open issue already exists with this skill in `affected_skills` AND a matching `root_cause` signature:

- **Open issue exists, same root cause** → do nothing (no new file, no notification for this skill).
- **Open issue exists, different root cause** → append a note to the existing ISS file's body: `Update YYYY-MM-DD: new signature: <error>`. Do not file a new issue.
- **No open issue** → file a new one (see below).

For each skill now HEALTHY whose name appears in any open issue's `affected_skills`:
- Remove it from that issue's `affected_skills`. If the list becomes empty, set `status: resolved`, set `resolved_at: <now ISO>`, and move the row from Open to Resolved in INDEX.md.

**Filing a new issue:**
1. Find next ID: scan `memory/issues/ISS-*.md`, take max `NNN`, add 1. Format as zero-padded 3 digits (`ISS-042`).
2. Write `memory/issues/ISS-NNN.md` with YAML frontmatter:
   ```yaml
   ---
   id: ISS-NNN
   title: <skill> <concise failure>
   status: open
   severity: critical | high | medium | low   # critical=CRITICAL status, high=FLAPPING, medium=DEGRADED
   category: rate-limit | timeout | missing-secret | config | api-change | sandbox-limitation | unknown
   detected_by: skill-health
   detected_at: <ISO timestamp>
   affected_skills: [<skill>, ...]    # may grow later
   root_cause: <error signature, 1 line>
   fix_pr: null
   ---
   
   ## What happened
   <2-3 line summary>
   
   ## Signal
   - consecutive_failures: N
   - days_since_last_success: N
   - last_error: "<error>"
   - related skills: <list or "none">
   ```
3. Append a row to `memory/issues/INDEX.md` under **Open**: `| ISS-NNN | title | severity | category | YYYY-MM-DD | skill-a, skill-b |`.

All issue writes must be atomic per file — never partial updates mid-run.

### 5. Decide whether to notify

Build a stable signature from the current classification: sorted list of `CRITICAL+FLAPPING+DEGRADED skill names + SYSTEMIC callouts`. SHA-256 it → `current_hash`.

- If `current_hash == prev_report.hash` AND `now - prev_report.last_notified_at < 24h` → **do not notify**. State unchanged.
- Otherwise → **notify** (there's new signal or the daily reminder cadence elapsed).

Always write `memory/skill-health/last-report.json`:
```json
{
  "hash": "<current_hash>",
  "last_notified_at": "<ISO if notified this run, else previous value>",
  "last_run_at": "<ISO now>",
  "classification": { "critical": [...], "degraded": [...], "flapping": [...], "warning": [...], "healthy_count": N, "no_data": [...] }
}
```

### 6. Format the report

**Top line:** `HEALTH: OK` | `HEALTH: WARNING(W)` | `HEALTH: DEGRADED(D)` | `HEALTH: CRITICAL(C)` — most severe wins.

**Body (notify-channel format, max 1 message):**

```
*Skill Health — ${today}*
HEALTH: CRITICAL(2)  [systemic: api.coingecko.com rate_limit — 3 skills]

🔴 CRITICAL
- token-movers — 5 fails, 3d down — WAIT-API (rate_limit) → ISS-042
- defi-monitor — 4 fails, 2d down — WAIT-API (rate_limit) → ISS-042

🟡 DEGRADED / FLAPPING
- digest — 52% success (14d), avg quality 2.1 — INVESTIGATE → ISS-043

⚪ NO DATA (2): skill-x, skill-y — DISPATCH-SKILL
🟢 HEALTHY: 34

Open issues: 2 · Resolved this run: 1 (rss-digest)
```

Rules for formatting:
- Cap per-section rows at 5; collapse the rest as `+N more — see memory/issues/INDEX.md`.
- Omit HEALTHY list (count only). Omit any empty section.
- Always end with `Open issues: X · Resolved this run: Y`.
- If NO CRITICAL/DEGRADED/FLAPPING and no new/resolved issues → body is just `HEALTH: OK — N skills healthy`.

### 7. Notify and log

- If the gate in step 5 said notify → `./notify "<report body>"`. Update `last_notified_at` in last-report.json to now.
- If gate said skip → do not call `./notify`. Log to memory/logs/${today}.md:
  ```
  ### skill-health
  - view: health
  - SKILL_HEALTH_NOOP — state unchanged since <prev_run_at>, hash=<short>
  ```

On notify, log to memory/logs/${today}.md:
```
### skill-health
- view: health
- HEALTH: <OK|WARNING|DEGRADED|CRITICAL>
- filed: [ISS-NNN, ...]
- resolved: [ISS-NNN, ...]
- open: N
- systemic: <pattern or none>
```

If all skills healthy, the body-only shortcut from step 6 still fires (once per 24h, per gate) so the operator gets confirmation the audit actually ran — but suppress if last-report.json shows a notify <24h ago with the same OK hash.

## Health-view constraints

- Never file two open issues for the same `(skill, root_cause)` pair — always check INDEX.md first.
- Never edit a Resolved issue. If a previously-resolved issue re-fires, file a new ISS with a pointer (`related: ISS-NNN`) in the body.
- Do not notify on pure HEALTHY runs more than once per 24h.
- If in single-skill mode (selector was a skill slug), skip INDEX.md updates only if the single skill is HEALTHY — otherwise file/resolve as normal.
- Never touch `memory/issues/INDEX.md` Resolved section except to move rows into it; never delete rows.

---

# Analytics view

`VIEW=analytics`. Generate a fleet-level performance view of every Aeon skill that has run in the window. **The point of this view is to answer four questions in one report:** which skills run most, which fail most, which are silently skipping (new exit taxonomy from the autoresearch-evolution rewrites), and which scheduled skills haven't fired at all.

## Why this exists

`heartbeat` runs daily and emits a per-skill ✓/✗. The health view (above) files issues for skills that breach degradation thresholds. Neither produces a ranked, fleet-wide view. The 80 autoresearch-evolution rewrites (aeon PRs #46–#136) introduced new exit taxonomies — `SKIP_UNCHANGED`, `NEW_INFO`, `SKIP_QUIET` — that classify quiet-but-correct runs separately from failures. Existing health checks treat any non-`*_OK` exit as worth attention; the analytics view makes the actual distribution visible so a skill running mostly `SKIP_UNCHANGED` reads as healthy-quiet, not silently broken.

## Steps

### 1. Determine the window

- `WINDOW_HOURS` was set by the selector parse (default 168 = 7 days; a positive integer from `analytics:N`, `metrics N`, or a bare integer; capped at 720 = 30 days — anything longer slows the `gh api` paginate).
- Compute `WINDOW_LABEL` (e.g. `"last 7d"` or `"last 72h"`).

### 2. Pull the run snapshot

```bash
./scripts/skill-runs --json --hours $WINDOW_HOURS > output/.chains/skill-analytics-runs.json 2>/dev/null
```

If the script fails (auth, rate limit, network error) or the JSON is empty:
- Log `SKILL_ANALYTICS_NO_DATA — skill-runs returned empty (gh api / network error?)` to `memory/logs/${today}.md` (under the `### skill-health` heading, see step 13) and stop with **no notification**. A silent fleet view is correct on data-fetch failure — fall back rather than guess.

The script's JSON shape (see `scripts/skill-runs`):
```json
{
  "period": {"since": "...", "until": "...", "hours": 168},
  "summary": {"total": N, "succeeded": N, "failed": N, "cancelled": N, "in_progress": N},
  "skills": [{"skill": "name", "total": N, "success": N, "failure": N, "cancelled": N, "in_progress": N, "last_run": "...", "last_conclusion": "..."}],
  "anomalies": {"duplicates": [...], "failing": [...]}
}
```

### 3. Cross-reference with cron schedule

Read `aeon.yml` and build `SCHEDULED_SKILLS`: dict `{skill_name -> {enabled: bool, schedule: str}}` for every entry under `skills:`. Treat `schedule: "workflow_dispatch"` and `schedule: "reactive"` as exempt from the "no runs in window" anomaly — those are dispatched on demand, not by cron.

For every skill in `SCHEDULED_SKILLS` where `enabled: true` AND schedule is a valid cron expression AND the skill is **not** present in the snapshot's `skills` array, mark `silent_scheduled: true` (zero runs in window despite an active schedule).

### 4. Cross-reference with cron-state.json

Load `memory/cron-state.json` if present (missing → empty dict, not failure). For each skill in the snapshot, attach:
- `consecutive_failures` (0 if missing)
- `last_status` (`"unknown"` if missing)

Used to compute the consecutive-failure anomaly without a second `gh api` round-trip.

### 5. Mine exit taxonomy from logs

For each daily log file `memory/logs/YYYY-MM-DD.md` whose date falls in the window, scan for these markers (one match per skill section):
- `_OK` → success (excluding `_OK_SILENT`)
- `_OK_SILENT` / `_QUIET` / `SKIP_QUIET` → quiet-success
- `SKIP_UNCHANGED` → skip-unchanged (autoresearch-evolution exit)
- `NEW_INFO` → new-info (autoresearch-evolution exit)
- `_SKIP*` (other) → skip-other
- `_ERROR` / `_FAILED` → error
- `_PARTIAL` → partial
- (no match) → uncategorized

Build `EXIT_DIST[skill]` = `{ok: N, quiet: N, skip_unchanged: N, new_info: N, skip_other: N, error: N, partial: N, uncategorized: N}`. The dominant bucket per skill is the one with the largest count; ties broken in the order listed above. If a skill has no log markers in the window, dominant bucket is `"uncategorized"`.

This step is best-effort — the markers are regex-grepped from human-written logs, not parsed from a contract. A miss-rate of 10–20% is expected and acceptable; the GitHub Actions success/failure counts from step 2 remain the ground truth for pass/fail. The taxonomy distribution is a secondary signal.

### 6. Anomaly classification

For each skill in the snapshot OR `silent_scheduled`, assign **at most one** anomaly flag, first match wins:

| Flag | Trigger |
|---|---|
| `🔴 SILENT` | `silent_scheduled: true` (enabled cron skill, zero runs in window) |
| `🔴 ALL_FAIL` | `total >= 2` AND `failure == total` |
| `🟠 CONSECUTIVE_FAILURES` | `consecutive_failures >= 3` (from cron-state) |
| `🟠 LOW_SUCCESS` | `total >= 3` AND `success / total < 0.80` |
| `🟡 ALL_SKIP` | `total >= 3` AND `EXIT_DIST.ok + EXIT_DIST.quiet + EXIT_DIST.new_info == 0` AND `EXIT_DIST.skip_unchanged + EXIT_DIST.skip_other > 0` (every run skipped — possibly correct, possibly stuck) |
| `🟡 DUPLICATE_RUNS` | `total > 2 × expected_runs(schedule, window)` (more runs than the cron should produce — manual reruns or scheduler glitch) |

`expected_runs(schedule, window)` is a coarse estimate — for a cron `"0 H * * *"` over 7 days, expect 7; for `"0 H,H,H * * *"`, expect 21; for weekly `"0 H * * D"`, expect 1. If the schedule string is unparseable, skip the duplicate check for that skill (do not flag false positives).

A skill with no flag is considered HEALTHY for analytics purposes.

### 7. Compute summary

```
total_runs:          sum of every skill's total
distinct_skills:     count of skills with total >= 1
overall_success_pct: snapshot.summary.succeeded / (succeeded + failed) × 100  (cancelled + in_progress excluded)
anomaly_count:       count of skills with any flag in step 6
silent_scheduled_count: count of SILENT flags
exit_dominant:       top 3 dominant exit buckets across the fleet, e.g. "ok (42), skip_unchanged (18), error (3)"
```

### 8. Build the verdict line

Pick the strongest single claim, in priority:

1. Any `🔴 SILENT` exists → `"${N} scheduled skill(s) didn't run this window — ${first_skill}"`
2. Any `🔴 ALL_FAIL` exists → `"${first_skill} failed every run (${N}/${N}) — investigate"`
3. Any `🟠 CONSECUTIVE_FAILURES` exists → `"${first_skill} on ${N}-run failure streak"`
4. Any `🟠 LOW_SUCCESS` exists → `"${first_skill} ${pct}% success over ${total} runs — degraded"`
5. Any `🟡 ALL_SKIP` exists → `"${N} skill(s) only emitting skip-class exits this window — verify intent"`
6. Otherwise → `"All ${distinct_skills} active skills healthy — ${overall_success_pct}% success across ${total_runs} runs"`

### 9. Significance gate

**Notify only if `anomaly_count >= 1`.** Silent run = correct (no anomalies in fleet) = no notification. Following the autoresearch-evolution / fork-digest pattern: noisy skills break trust faster than missing pings.

If gate says skip, still write the article and JSON spec, and log `SKILL_ANALYTICS_QUIET` (no anomalies). The dashboard widget refreshes regardless; only the push notification is gated.

### 10. Write the article

Path: `output/articles/skill-analytics-${today}.md`. Overwrite if it exists (idempotent same-day reruns).

```markdown
# Skill Analytics — ${today}

**Verdict:** ${verdict_line}

*Window: ${WINDOW_LABEL} · ${total_runs} runs across ${distinct_skills} skills · ${overall_success_pct}% success · ${anomaly_count} anomalies*

## Anomalies

| Flag | Skill | Detail | Action |
|------|-------|--------|--------|
| 🔴 SILENT | name | scheduled `<cron>` but zero runs in window | run **aeon-doctor** — zero-runs-despite-schedule is usually a static config bug (unquoted `schedule:`, dup key) it can't be seen in run data |
| 🔴 ALL_FAIL | name | N/N failed | investigate root cause |
| 🟠 CONSECUTIVE_FAILURES | name | N-run streak (last_error: "...") | see health view for filed issue |
| 🟠 LOW_SUCCESS | name | N% over M runs | review failures |
| 🟡 ALL_SKIP | name | M runs, all skip-class | confirm SKIP_UNCHANGED is the intent |
| 🟡 DUPLICATE_RUNS | name | M runs, expected ~K | check for manual reruns |

(If `anomaly_count == 0`: write `No anomalies — fleet healthy across ${distinct_skills} skills.`)

## Top runners (by run count)

| # | Skill | Runs | Success | Last status | Dominant exit |
|---|-------|------|---------|-------------|---------------|
| 1 | name  | N    | XX%     | success     | ok            |
| 2 | name  | N    | XX%     | success     | skip_unchanged |
...

(Top 15 by total runs desc. If fewer than 15 active skills, list all.)

## Failure rate (sorted, ≥1 failure)

| Skill | Runs | Failures | Success rate | Last conclusion |
|-------|------|----------|--------------|-----------------|

(All skills with `failure >= 1`, sorted by `failure / total` desc. If none: "Zero failures across ${distinct_skills} skills this window.")

## Exit taxonomy distribution

| Bucket | Count | % | Top skills |
|--------|-------|---|------------|
| ok            | N | XX% | a, b, c |
| skip_unchanged | N | XX% | d, e |
| new_info      | N | XX% | f |
| quiet         | N | XX% | g |
| error         | N | XX% | h |
| partial       | N | XX% |   |
| uncategorized | N | XX% |   |

(Sourced from `memory/logs/*.md` — best-effort regex grep, see Step 5. Cell-aligns to summary cells above where available.)

## Silent scheduled skills (enabled, zero runs)

${list of {skill, schedule} pairs OR "none — every enabled cron skill ran at least once."}

> **Root-cause pointer:** an enabled cron skill with *zero* runs is most often a **static config** fault the run data can't reveal — an unquoted `schedule:` the scheduler regex silently skips, a duplicate `aeon.yml` key, or an entry pointing at a missing `SKILL.md`. That class is `aeon-doctor`'s job; dispatch it (`./aeon skills run aeon-doctor`) to pinpoint the cause instead of guessing at the scheduler.

## Source status

- skill-runs JSON: ${ok|empty|fetch_error}
- Window: ${WINDOW_HOURS}h (${period.since} → ${period.until})
- aeon.yml: ${ok|missing}
- cron-state.json: ${ok|missing — first run for this fork?}
- Daily logs scanned: ${N_LOG_FILES}/${expected_log_files} for exit taxonomy

---
*The analytics view of `skill-health` (per-skill issue filing lives in the health view) and a companion to `heartbeat` (per-run pulse). Fleet-wide observability is the gap this view closes. Methodology: GitHub Actions run history is ground truth for pass/fail; daily-log markers are best-effort secondary signal for exit taxonomy.*
```

### 11. Write the dashboard JSON spec

Path: `apps/dashboard/outputs/skill-analytics.json`. Use the catalog components (Card / Stack / Heading / Text / Badge / Table).

```json
{
  "version": "1",
  "generated_at": "${ISO timestamp}",
  "skill": "skill-analytics",
  "title": "Skill Analytics — ${today}",
  "spec": {
    "type": "Stack",
    "props": {"direction": "vertical", "gap": "md"},
    "children": [
      {"type": "Heading", "props": {"level": 2, "children": "Skill Analytics — ${today}"}},
      {"type": "Text", "props": {"variant": "muted", "children": "${verdict_line}"}},
      {"type": "Grid", "props": {"columns": 4, "gap": "sm"}, "children": [
        {"type": "Card", "props": {"children": [
          {"type": "Text", "props": {"variant": "muted", "children": "Total runs"}},
          {"type": "Heading", "props": {"level": 3, "children": "${total_runs}"}}
        ]}},
        {"type": "Card", "props": {"children": [
          {"type": "Text", "props": {"variant": "muted", "children": "Active skills"}},
          {"type": "Heading", "props": {"level": 3, "children": "${distinct_skills}"}}
        ]}},
        {"type": "Card", "props": {"children": [
          {"type": "Text", "props": {"variant": "muted", "children": "Success rate"}},
          {"type": "Heading", "props": {"level": 3, "children": "${overall_success_pct}%"}}
        ]}},
        {"type": "Card", "props": {"children": [
          {"type": "Text", "props": {"variant": "muted", "children": "Anomalies"}},
          {"type": "Heading", "props": {"level": 3, "children": "${anomaly_count}"}}
        ]}}
      ]},
      {"type": "Heading", "props": {"level": 3, "children": "Top runners"}},
      {"type": "Table", "props": {
        "columns": [
          {"key": "rank", "header": "#"},
          {"key": "skill", "header": "Skill"},
          {"key": "runs", "header": "Runs"},
          {"key": "success", "header": "Success"},
          {"key": "exit", "header": "Dominant exit"}
        ],
        "rows": [
          {"rank": "1", "skill": "name", "runs": "N", "success": "XX%", "exit": "ok"}
        ]
      }}
    ]
  }
}
```

If `anomaly_count >= 1`, prepend an `Alert` block before the verdict:

```json
{"type": "Alert", "props": {"variant": "destructive", "children": "${anomaly_count} anomaly flag(s) raised — see Anomalies section"}}
```

If the file write fails (filesystem read-only, missing directory), log a warning but do not abort — the article is the canonical artifact, the JSON spec is a dashboard convenience.

### 12. Send notification (only if gate from step 9 passed)

Via `./notify`:

```
*Skill Analytics — ${today}*
${verdict_line}

Window: ${WINDOW_LABEL} · ${total_runs} runs · ${distinct_skills} skills · ${overall_success_pct}% success
Anomalies: ${anomaly_count}

${If 🔴 flags (cap top 3):}
🔴 Critical:
- ${skill} — ${flag}: ${detail}

${If 🟠 flags (cap top 3):}
🟠 Degraded:
- ${skill} — ${flag}: ${detail}

${If 🟡 flags (top 3, only if no 🔴/🟠 already filled the slots):}
🟡 Watch:
- ${skill} — ${flag}: ${detail}

Top by runs: ${top_3_skills_by_run_count_with_counts}

Full: output/articles/skill-analytics-${today}.md
```

Keep the message body tight for signal. Drop the "Top by runs" line first if it runs long; flags are higher signal. (`./notify` auto-chunks, so length is about signal, not transport.)

### 13. Log to `memory/logs/${today}.md`

Log under the shared `### skill-health` heading (the health loop parses this shape), with a `view: analytics` discriminator:

```
### skill-health
- view: analytics
- **Window**: ${WINDOW_LABEL} (${WINDOW_HOURS}h)
- **Total runs**: ${total_runs} across ${distinct_skills} skills
- **Overall success rate**: ${overall_success_pct}%
- **Anomalies**: ${anomaly_count} (🔴 ${red_count}, 🟠 ${orange_count}, 🟡 ${yellow_count})
- **Silent scheduled**: ${silent_scheduled_count} skills (${comma list capped at 5})
- **Top runner**: ${top_skill} (${top_runs} runs)
- **Exit dominant**: ${exit_dominant_summary}
- **Verdict**: ${verdict_line}
- **Article**: output/articles/skill-analytics-${today}.md
- **Dashboard**: apps/dashboard/outputs/skill-analytics.json
- **Notification sent**: ${yes|no — quiet (no anomalies)}
- **Status**: SKILL_ANALYTICS_OK | SKILL_ANALYTICS_QUIET | SKILL_ANALYTICS_NO_DATA
```

## Analytics-view exit taxonomy

| Status | Meaning | Notify? |
|--------|---------|---------|
| `SKILL_ANALYTICS_OK` | snapshot fetched, ≥1 anomaly flagged | Yes |
| `SKILL_ANALYTICS_QUIET` | snapshot fetched, zero anomalies | No (article + JSON written, log only) |
| `SKILL_ANALYTICS_NO_DATA` | skill-runs returned empty / fetch failed | No (log only, no article overwrite) |

## Analytics-view constraints

- **Significance-gated.** A clean fleet must produce zero notifications. Article and JSON spec still write so the dashboard reflects the latest state, but `./notify` is silent.
- **Never invent runs.** If `skill-runs` returns empty, exit `SKILL_ANALYTICS_NO_DATA` — do not synthesise data from cron-state alone (cron-state's view is per-skill, not chronologically ordered, and would produce a misleading "top runners" table).
- **Best-effort exit-taxonomy parsing.** Log markers are human-written; expect a 10–20% miss rate. Do not block the article on parse failures — drop the affected skill into `uncategorized` and continue.
- **Idempotent.** Same-day reruns overwrite the article and JSON spec. The log entry is appended (one block per run, lets the operator see analytic drift across reruns).
- **No issue filing in this view.** The analytics view does not write to `memory/issues/` — that contract belongs to the health view. Anomalies surface here as flags; persistence and resolution live in the health view's domain.
- **Respect workflow_dispatch / reactive.** Skills with non-cron schedules cannot be SILENT — they fire only on demand. Excluding them from the silent-scheduled check prevents permanent false positives.

---

## Network note (both views)

This skill fetches no URLs directly — all data is local or via `gh` / `./scripts/skill-runs` (which uses `gh api`, so auth comes from `GITHUB_TOKEN` with no secret ever on the command line). No `curl` fallback needed.

- **Health view:** if `./scripts/skill-runs` fails, log `SKILL_HEALTH_PARTIAL — skill-runs unavailable` and continue with cron-state only.
- **Analytics view:** if `gh api` is rate-limited or the runner's network is degraded, `./scripts/skill-runs` exits non-zero; catch that and fall through to `SKILL_ANALYTICS_NO_DATA` rather than emitting a partial fleet view that would mislead.
