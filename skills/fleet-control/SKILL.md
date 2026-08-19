---
name: fleet-control
description: Operate managed Aeon instances from memory/instances.json - health-check, dispatch, and status snapshots (control), plus a fleet scorecard of runs, tokens, cost, and reliability (scorecard).
metadata:
  title: Fleet Control
  category: core
  var: ""
  tags:
    - dev
    - meta
    - fleet
    - report
    - cost
  requires:
    - GH_READ_PAT?
  cron: "0 9,15 * * *"
---
<!-- autoresearch: variation B — sharper output: verdict line + delta vs prior + per-instance action column + state-change-gated notify -->

> **${var}** — Command / view selector. Empty (or unrecognized) → **Health Check** (default control view). `status` → full **Status Mode** (control view). `dispatch <instance|*> <skill> [var=<value>]` → **Dispatch Mode**: trigger a skill on one child or all healthy/degraded children (control view). `scorecard` → **Scorecard Mode**: fleet-wide runs/tokens/cost/reliability scorecard with day-over-day deltas + alerts (scorecard view).

Today is ${today}. Operate the fleet of Aeon instances registered in `memory/instances.json`. The **control view** (health/status/dispatch) is **decision-ready**: every run leads with a verdict, then a delta vs prior check, then per-instance lines that name the next concrete action. The **scorecard view** publishes the daily fleet-wide cost/reliability scorecard.

The fleet is **discovered at runtime, never hardcoded**: it is this repo ("self") plus every non-archived entry in `memory/instances.json` (the registry `fleet-control` and `spawn-instance` maintain). With zero managed instances the scorecard simply covers the single self repo — still useful.

## Shared preamble (every run)

1. **Read memory** — read `memory/MEMORY.md` for high-level context and scan the last ~3 days of `memory/logs/` for recent activity; don't re-report a signal already logged there.

2. **Voice** — if `soul/SOUL.md` and `soul/STYLE.md` exist and are populated, read them and match the operator's voice in every notification. If they are empty templates or absent, use a clear, direct, neutral tone — terse, lowercase, no fluff.

3. **Parse `${var}` → mode**:
   - empty / unrecognized → **Health Check Mode** (control view; default)
   - exactly `status` → **Status Mode** (control view)
   - starts with `dispatch ` → **Dispatch Mode** (control view)
   - exactly `scorecard` → **Scorecard Mode** (scorecard view)

4. **Route**:
   - **Health Check / Status / Dispatch** → run the **Control-view pre-flight** below, then the matching mode section. These modes make live `gh` calls.
   - **Scorecard** → skip the control-view pre-flight entirely and jump straight to **Scorecard Mode**, which gathers its own data in-run via `node scripts/fleet-scorecard.mjs`.

---

## Control-view pre-flight (health / status / dispatch only)

1. **Verify gh auth** — `gh auth status` must succeed. If not, log `FLEET_NO_AUTH` to `memory/logs/${today}.md` and notify `Fleet Control: gh auth missing — check GITHUB_TOKEN secret.` Stop.

2. **Check rate limit** — `REMAINING=$(gh api rate_limit --jq '.resources.core.remaining')`. If `REMAINING < 50`, log `FLEET_RATE_LIMITED:remaining=${REMAINING}` and notify a one-line warning, then stop.

3. **Load the registry** — read `memory/instances.json`. If the file is missing, write `{"instances": []}` to bootstrap. If `.instances` is absent or `[]`:
   - Log `FLEET_EMPTY: no managed instances` to `memory/logs/${today}.md`.
   - **Stop. Do NOT notify.**

4. **Load prior state** — read `memory/state/fleet-control-state.json` (create the directory and file with `{"instances": {}, "last_full_summary_date": ""}` if missing). Shape:
   ```json
   {
     "instances": {
       "<name>": { "health": "<status>", "last_checked": "<ISO>", "consecutive_unreachable": 0 }
     },
     "last_full_summary_date": "YYYY-MM-DD"
   }
   ```

---

## Health Check Mode (default — control view)

For each registered instance, skip rows with `archived: true` from per-instance work (count them separately). Run the three calls per instance in parallel using `&` + `wait` and write each to `/tmp/fleet/${SAFE}.{repo,runs,cron}.json`:

a. **Repo metadata**:
   ```bash
   gh api "repos/${REPO}" \
     --jq '{full_name, pushed_at, archived, default_branch, open_issues_count}' \
     > "/tmp/fleet/${SAFE}.repo.json" 2>"/tmp/fleet/${SAFE}.repo.err" &
   ```

b. **Workflow runs in last 24h** (precise window, not "last 5"):
   ```bash
   SINCE=$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)
   gh api "repos/${REPO}/actions/runs?created=>${SINCE}&per_page=100&exclude_pull_requests=true" \
     --jq '{total_count, runs:[.workflow_runs[]|{name,status,conclusion,created_at,html_url}]}' \
     > "/tmp/fleet/${SAFE}.runs.json" 2>"/tmp/fleet/${SAFE}.runs.err" &
   ```

c. **Cron-state from child**:
   ```bash
   gh api "repos/${REPO}/contents/memory/cron-state.json" --jq '.content' 2>"/tmp/fleet/${SAFE}.cron.err" \
     | base64 -d > "/tmp/fleet/${SAFE}.cron.json" &
   ```

`wait` after launching all three for an instance (or batch across all instances if you trust your parallelism — keep ≤16 concurrent calls to stay under rate limit).

**Classify each instance** with precise thresholds:
- **unreachable** — repo metadata call returned non-zero (404/403/etc.)
- **archived** — repo metadata returns `archived: true`
- **pending_secrets** — `runs.total_count == 0` for the 24h window AND repo `pushed_at` ≥ 7 days old (newly-spawned instances under 7 days stay unclassified-but-tracked)
- **stale** — `runs.total_count == 0` AND `pushed_at` > 7 days old AND not `archived`
- **degraded** — ≥1 cron-state skill with `consecutive_failures ≥ 3` OR (24h failure_count / total_count) ≥ 0.5 with total_count ≥ 2
- **warning** — 24h failure_count ≥ 1 but ratio < 0.5
- **healthy** — has runs in last 24h, all conclusions `success` or `in_progress`/`queued`, no degraded cron-state skills

For each instance compute a **next_action** (one short imperative phrase):
- `pending_secrets` → `add ANTHROPIC_API_KEY at https://github.com/${REPO}/settings/secrets/actions`
- `degraded` → `investigate <skill_name> (<consecutive_failures>× in a row, last_error: <signature, ≤60 chars>)`
- `warning` → `monitor — <N>/<Total> runs failed in 24h`
- `stale` → `confirm intent: no runs in 24h, last push <relative_date>; archive or re-enable` — if it *should* be running, dispatch `aeon-doctor` to that instance (Dispatch Mode) to lint for a silent config bug (unquoted `schedule:` / duplicate key / broken entry) before assuming it's abandoned
- `unreachable` → `verify access: <reason from repo.err>`
- `healthy` → `none`
- `archived` → `none (archived)`

**Compute delta** vs prior state (per-instance `prior.health` vs `current.health`):
- **NEW** — instance not in prior state
- **DEGRADED** — was healthy/warning, now degraded/unreachable/stale/pending_secrets
- **RECOVERED** — was degraded/unreachable/stale/pending_secrets, now healthy/warning
- **DROPPED** — was in prior state, no longer in registry
- (no change → no delta line)

**Update the registry** — write back `health`, `last_checked` (ISO UTC), and `next_action` per instance to `memory/instances.json`. Preserve all other fields (`purpose`, `parent`, `created`, `skills_enabled`, etc.).

**Update the state file** — write the current per-instance health snapshot to `memory/state/fleet-control-state.json`. Update `last_full_summary_date` to today **only when this run notifies**. Increment `consecutive_unreachable` for unreachable instances; reset to 0 otherwise.

**Log** to `memory/logs/${today}.md` (under the consolidated heading — see **Log** section):
```
### fleet-control
- Mode: health check
- Verdict: [FLEET_OK | NEEDS_ATTENTION:N]
- Sizes: total=N, healthy=N, warning=N, degraded=N, stale=N, pending=N, unreachable=N, archived=N
- Deltas: [list NEW/DEGRADED/RECOVERED/DROPPED, or "none"]
- Sources: gh=ok, rate_remaining=N
```

**Notification gate** — send the notification if **any** of:
- `len(deltas) > 0`
- today != prior `last_full_summary_date` (first check of UTC day → daily rollup)
- any current instance is `degraded` or `unreachable`

Otherwise skip notify (silent no-op when nothing changed mid-day — operator isn't trained to ignore).

**Notification body** (when sent):
```
*Fleet Control — ${today}*
Verdict: <FLEET_OK | NEEDS_ATTENTION:N>

[If deltas exist]:
What changed:
- NEW: <name> (<repo>) — <health>
- DEGRADED: <name> — was <prior>, now <current>: <reason>
- RECOVERED: <name> — was <prior>, now <current>
- DROPPED: <name> — no longer in registry

Fleet (N total):
- <name> [<HEALTH>]: <repo> — <next_action>
- ...

[If first-of-day rollup]:
Counts: healthy <H> · warning <W> · degraded <D> · stale <S> · pending <P> · unreachable <U> · archived <A>

Sources: gh=ok · rate_remaining=N
```

Cap the per-instance list at 12 lines; if more, append `...and N more — see memory/instances.json`. Always include archived in counts; never list archived rows in the per-instance section.

---

## Dispatch Mode (control view)

Parse var: `dispatch <instance|*> <skill> [var=<value>]`.

**Resolve targets**:
- If `<instance>` is `*`, target = every registry entry whose **current** health is `healthy`, `warning`, or `degraded` (skip unreachable, stale, pending, archived).
- Otherwise, exact name match against the registry. Not found → notify `Fleet Dispatch: instance '<name>' not in registry` and stop.

For each target instance:

1. **Validate skill exists in child**:
   ```bash
   gh api "repos/${REPO}/contents/skills/${SKILL}/SKILL.md" >/dev/null 2>&1 \
     || { OUTCOME="missing_skill"; continue; }
   ```

2. **Check skill is enabled in child's aeon.yml** (best-effort warning, not a block — workflow_dispatch can override `enabled: false`):
   ```bash
   gh api "repos/${REPO}/contents/aeon.yml" --jq '.content' 2>/dev/null | base64 -d \
     | grep -E "^[[:space:]]*${SKILL}:.*enabled:[[:space:]]*true" >/dev/null \
     || NOT_ENABLED_WARN=1
   ```

3. **Trigger the skill**:
   ```bash
   if [ -n "$DISPATCH_VAR" ]; then
     gh workflow run aeon.yml --repo "${REPO}" -f skill="${SKILL}" -f var="${DISPATCH_VAR}" \
       && OUTCOME="dispatched" || OUTCOME="api_failed:$?"
   else
     gh workflow run aeon.yml --repo "${REPO}" -f skill="${SKILL}" \
       && OUTCOME="dispatched" || OUTCOME="api_failed:$?"
   fi
   ```

Collect per-target outcomes: `dispatched | missing_skill | api_failed:<code>` (with optional `not_enabled_warn` flag).

**Log**:
```
### fleet-control
- Mode: dispatch
- Command: dispatch <inst|*> <skill> [var=...]
- Targets: N
- Dispatched: N | missing_skill: N | api_failed: N
- Per-target: [<name>: <outcome>, ...]
```

**Notify** (always, in dispatch mode):
```
*Fleet Dispatch*
Command: dispatch <inst|*> <skill>
Targets: <N> — Dispatched: <N>
Successful: <comma-sep names>
[If failures]:
Failed: <name>: <reason>, ...
[If not_enabled_warn]:
Warning: <name> has skill disabled in aeon.yml — dispatched anyway
```

If 0 dispatched out of N targets, the verdict line reads `Fleet Dispatch: 0/${N} — see failures below` and exit code logged is `FLEET_DISPATCH_FAILED:no_targets_succeeded`.

---

## Status Mode (control view)

Generate the comprehensive snapshot, but make it scannable.

For each registered instance (skip `archived` from detail blocks but count them in the summary), gather in parallel:
- Repo meta: `stargazers_count`, `pushed_at`, `open_issues_count`, `default_branch`
- Last 10 workflow runs:
  ```bash
  gh api "repos/${REPO}/actions/runs?per_page=10&exclude_pull_requests=true" \
    --jq '[.workflow_runs[]|{name,status,conclusion,created_at,html_url}]'
  ```
- Full `cron-state.json`
- `aeon.yml` (parse enabled skills)
- Last 5 commits (one-line `gh api repos/${REPO}/commits?per_page=5 --jq ...`)

Compute the same delta block, but compare against the most recent prior `output/articles/fleet-status-*.md` (parse the per-instance health rows; if none exists, mark the section "no prior status to diff against").

Write to `output/articles/fleet-status-${today}.md`:
```markdown
# Fleet Status — ${today}

## Verdict
<one line: FLEET_OK | NEEDS_ATTENTION:N | DEGRADED:N — top issue first>

## Top Issue
<one paragraph: the single highest-priority instance and what it needs, OR "none">

## Fleet Health
| Instance | Repo | Health | Last Active | Skills | Open Action |
|----------|------|--------|-------------|--------|-------------|

## What Changed Since Last Status
<list of NEW/DEGRADED/RECOVERED/WENT_STALE/DROPPED instances since prior fleet-status article, or "no changes">

## Per-Instance Detail

### <name> — <repo>
- Purpose: <from registry>
- Health: <status>, last checked <ISO>
- Last 10 runs:
  | Skill | Status | Conclusion | When |
  |-------|--------|-----------|------|
- Skills enabled: <comma list>
- Recent commits:
  - <sha> <message>
- Action: <next_action>

## Counts
| Metric | Value |
|--------|-------|

## Sources
gh=ok · rate_remaining=N · registry=N instances · prior_status=<filename or "none">
```

**Log**:
```
### fleet-control
- Mode: status
- Article: output/articles/fleet-status-${today}.md
- Verdict: <line>
- Sizes: total=N, healthy=N, ...
```

**Notify** (always, in status mode):
```
*Fleet Status — ${today}*
<verdict>
Top issue: <one line, or "none">
Counts: healthy <H> · warning <W> · degraded <D> · stale <S> · pending <P> · unreachable <U>
Article: output/articles/fleet-status-${today}.md
```

---

## Scorecard Mode (scorecard view)

Publish the daily **fleet scorecard** to `memory/scorecard.md` and append a trend row to `memory/scorecard-history.csv`. (Ran daily at 13:00 UTC as its own dispatch when this skill is scheduled with `var: scorecard`.)

### 0. Gather the data in-run

Run the committed collector — it discovers the fleet (self + non-archived `memory/instances.json`), fetches each repo's workflow runs + skill count + `token-usage.csv` from the GitHub API, computes the pricing/aggregation, and writes the tables. It reads its token from the environment (`GH_READ_PAT` — the read-only PAT declared in this skill's `requires:`, needed to read **private** fleet members — falling back to `GH_TOKEN`/`GITHUB_TOKEN`), so **no secret ever touches a command line**:

```bash
node scripts/fleet-scorecard.mjs   # → /tmp/fleet-scorecard/{scorecard-body.md,metrics.json}
```

The deterministic maths lives in the script (not this run) — do **not** recompute or alter its numbers. A repo the token can't read is simply absent from the tables rather than crashing the collector.

### Inputs (produced by step 0 — read these)

- `/tmp/fleet-scorecard/scorecard-body.md` — the computed markdown tables (Fleet totals, Per-repo, Top skills by cost, Least reliable skills). Authoritative — **do not recompute or alter them.**
- `/tmp/fleet-scorecard/metrics.json` — today's key totals: `total_runs, total_failures, generations, prompt_tokens, cached_tokens, completion_tokens, total_tokens, est_cost_usd, cache_discount_usd`.

If `/tmp/fleet-scorecard/scorecard-body.md` is missing or empty, the collector failed or resolved an empty fleet — write a one-line note to `/tmp/skill-result.txt` saying so and stop (do not overwrite the existing scorecard, do not notify).

### Steps

#### 1. Load today's metrics and yesterday's baseline

- Read `/tmp/fleet-scorecard/metrics.json` (today).
- Read the **last row** of `memory/scorecard-history.csv` if it exists (the previous run's metrics) to compute deltas. If the file doesn't exist yet, this is the first run — deltas are "—".

#### 2. Compute day-over-day deltas

For `total_runs`, `total_failures`, `generations`, `total_tokens`, `est_cost_usd`, `cache_discount_usd`, compute `today − previous`. Format as signed (e.g. `+312 runs`, `+$148`, `+5 failures`). These are cumulative all-time figures, so deltas show the last ~24h of activity.

#### 3. Build the Alerts block

Scan the computed tables in `scorecard-body.md` and flag:
- Any skill in **"Least reliable skills (last 14d)"** with **fail rate ≥ 25%** (call it out by name + repo + rate). That table is already windowed to 14 days, so long-resolved incidents won't trigger false alarms — anything listed there is a *current* problem worth surfacing.
- Any **cost spike**: `est_cost_usd` delta > 1.5× the median daily delta from history (if ≥7 history rows exist), or just note the day's cost increase otherwise.
- If `total_failures` rose by **more than 10** since yesterday, flag it.
- If no issues, write `✅ No anomalies — fleet healthy.`

#### 4. Write `memory/scorecard.md`

Structure (overwrite the file):

```
# 🛰️ Aeon Fleet Scorecard — as of ${today}

_Auto-generated daily by skills/fleet-control (scorecard view). Tokens reported OpenRouter-style (cached_tokens ⊆ prompt_tokens)._

## Since last update (~24h)
| Metric | Δ |
|---|---:|
| Runs | <signed> |
| Failures | <signed> |
| Generations | <signed> |
| Total tokens | <signed, humanized> |
| Est. cost | <signed $> |
| Cache discount | <signed $> |

## Alerts
<the alerts block from step 3>

<PASTE the full contents of /tmp/fleet-scorecard/scorecard-body.md verbatim here>

---
_Sources: GitHub Actions run history + each repo's `memory/token-usage.csv`. Fleet resolved from memory/instances.json + self. Cost = Anthropic list price (estimate)._
```

#### 5. Append the trend row

Append one line to `memory/scorecard-history.csv` (create with a header if it doesn't exist):

```
date,total_runs,total_failures,generations,prompt_tokens,cached_tokens,completion_tokens,total_tokens,est_cost_usd,cache_discount_usd
```

Use `${today}` for the date and the values straight from `metrics.json`. **Append, never rewrite** prior rows.

#### 6. Notify

Write a terse daily pulse to `/tmp/scorecard-notify.md` and send it with `./notify -f /tmp/scorecard-notify.md`. One short paragraph — today's totals (runs, est. cost, total tokens), the headline deltas, and any alert. Example shape: _"fleet at 12.5k runs, ~$7.8k notional. +312 runs / +$148 since yesterday. cost-report still failing (88% fail). caching saved ~$43k."_ Also copy this text to `/tmp/skill-result.txt` so the framework captures it.

#### 7. Memory log

Append the scorecard entry under the consolidated `### fleet-control` heading in `memory/logs/${today}.md` (see **Log** section), noting the headline numbers (so future skills like self-improve/reflect see it).

### Scorecard notes
- Numbers come only from the collector's output files (`/tmp/fleet-scorecard/*`) — never invent or estimate figures yourself.
- The scorecard is cumulative/all-time; the deltas are what make the daily run useful.
- GitHub Actions retains runs ~90 days, so the run history is a rolling window; the token CSVs are the durable record committed in each repo.

---

## Log

All modes append under **one** `### fleet-control` heading in `memory/logs/${today}.md`, with a `- Mode:` discriminator line (the health loop parses this shape). Use the per-mode block shown in each mode section above. For **Scorecard Mode** use:
```
### fleet-control
- Mode: scorecard
- Scorecard: memory/scorecard.md updated — <total_runs> runs, ~$<est_cost_usd> notional, <total_tokens humanized>
- Deltas: <+runs> / <+$cost> since yesterday
- Alerts: <alert summary or "none">
```

## Exit taxonomy

Every run logs exactly one of these to memory:
- `FLEET_CONTROL_OK` — health/status/dispatch/scorecard completed normally
- `FLEET_EMPTY` — no instances in registry (silent stop; control view)
- `FLEET_NO_AUTH` — gh auth missing (control view)
- `FLEET_RATE_LIMITED:remaining=N` — abandoned to preserve quota (control view)
- `FLEET_DISPATCH_OK:N/M` — dispatched N of M targets
- `FLEET_DISPATCH_FAILED:<reason>` — dispatch produced 0 dispatches
- `FLEET_SCORECARD_EMPTY` — collector produced no data (empty fleet / all repos unreadable); scorecard skipped without overwriting or notifying

## Network note

**Control view (health / status / dispatch):** always use `gh api` over raw curl (it handles auth internally, so no `$SECRET` appears on the command line for the Bash permission layer to refuse). All cross-repo calls go through `gh api` or `gh workflow run`. No outbound HTTP needed beyond what `gh` does internally.

**Scorecard view:** gathers its data **in-run** by executing `node scripts/fleet-scorecard.mjs` (step 0), which fetches workflow runs + token usage from the GitHub API and computes the tables into `/tmp/fleet-scorecard/`. The collector authenticates with `GH_READ_PAT` when set (a read-only PAT with cross-repo scope, declared in this skill's `requires:` and injected into the run) so **private** managed instances are readable; when unset, the run's `GH_TOKEN` (= `GH_GLOBAL`) reads the same private members, the standard single-key setup. It reads the token from `process.env` internally, so the secret never appears on a command line. A repo the token can't read is simply absent from the tables rather than crashing the collector.

## Required env vars

`GH_READ_PAT` (optional, read-only) — declared in `requires:` and read from `process.env` by `scripts/fleet-scorecard.mjs` (scorecard view) to reach private managed instances; it falls back to `GH_GLOBAL`/`GH_TOKEN`/`GITHUB_TOKEN` (the run's repo-wide token, which also reads private members) when unset, and reads `GITHUB_REPOSITORY` to resolve "self". The control view relies on the workflow-provided `GITHUB_TOKEN` for its live `gh` calls.

## Constraints

- Never delete an instance from `memory/instances.json` automatically — only update fields. Even `unreachable` instances stay in the registry until the operator removes them by hand.
- Preserve all registry fields not explicitly written by this skill (purpose, parent, created, skills_enabled, etc.).
- Never write secrets to logs or notifications.
- Cap notification length at ~30 lines; truncate the per-instance list with `...and N more` when needed.
- Health Check stays silent when nothing changed mid-day — the daily-rollup path handles the recurring "is everything fine?" question without spam.
- Scorecard Mode never overwrites `memory/scorecard.md` when the collector output is missing/empty, and appends (never rewrites) prior rows in `memory/scorecard-history.csv`.
- Do not change the skill's tags, var semantics, or schedule without strong justification.

Write complete, working code. No TODOs or placeholders.

## Output

After completing any task, end with a `## Summary` listing what you did, files created/modified, and any follow-up actions needed.
