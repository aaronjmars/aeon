---
type: Skill
name: Skill Repair
category: evolution
description: Diagnose and fix failing or degraded skills automatically - systemic-first triage, per-category playbooks, and a verification plan
var: ""
tags: [meta, dev]
depends_on: [skill-health]
---
<!-- autoresearch: variation D — systemic-first triage + per-category playbooks + verification (folds A's regression hunter, B's structured PR + risk class + verdict, C's exit taxonomy + preflight + cooldown) -->

> **${var}** — Skill name to repair. If empty, runs systemic triage and picks the worst fixable target.
> **`${var}` modifiers**: prefix `dry-run:` to diagnose only without writing a PR (e.g. `dry-run:digest`).

Today is ${today}. Your task is to diagnose and repair the worst-impact failing or degraded skill — preferring a single shared fix over N per-skill patches when failures cluster.

## Phases

`PREFLIGHT → TRIAGE → DIAGNOSE → REPAIR → VERIFY → LOG`

Stop early at the appropriate exit code if any phase finds nothing actionable.

## Exit taxonomy

Pick exactly one before notifying.

| Code | Meaning |
|---|---|
| `REPAIR_OK_FIXED` | Per-skill fix applied, PR opened |
| `REPAIR_OK_SYSTEMIC` | Shared root cause across N skills — single shared fix or shared issue filed |
| `REPAIR_DIAGNOSED_NO_FIX` | Root cause known but requires operator action (e.g. missing secret, upstream API down). Issue updated, no PR |
| `REPAIR_NO_TARGETS` | All tracked skills healthy and no open fixable issues |
| `REPAIR_DRY_RUN` | `var=dry-run:NAME` — diagnostic only, no PR |
| `REPAIR_BLOCKED` | Preflight failed (gh auth, missing files) or cooldown active |

## 1. PREFLIGHT

Bail early with `REPAIR_BLOCKED` (and notify with the reason) if any of these fails:

- `gh auth status` succeeds.
- `memory/cron-state.json` exists and parses as JSON.
- `memory/issues/INDEX.md` exists. If absent, bootstrap a minimal one (Open + Resolved tables, no rows).
- `memory/state/skill-repair-history.json` exists. If absent, create `{}`.

**Cooldown / idempotency** (skip target with `REPAIR_BLOCKED` if any matches; don't loop on a fix that didn't take):
- The chosen target appears in `memory/state/skill-repair-history.json` with `last_repair_at` within 24h. (Operator can override by deleting the entry.)
- An open PR already exists matching `fix/skill-repair-{name}-*` — `gh pr list --state open --search "head:fix/skill-repair-{name}"`.
- More than 3 skill-repair PRs already opened in the current UTC day — rate-limit our own PRs.

If `${var}` starts with `dry-run:`, strip the prefix to get the target name and skip the cooldown.

## 2. TRIAGE

Identify the target. Two paths:

**Path A — `${var}` set explicitly:** repair that skill. Skip step 2's clustering.

**Path B — `${var}` empty (auto-select):**

1. Read `memory/issues/INDEX.md`. Extract open issues. Skip `permanent-limitation`.
2. Read `memory/cron-state.json`. Compute candidates where any of:
   - `consecutive_failures >= 2`, OR
   - `success_rate < 0.5` AND `total_runs >= 3`, OR
   - `last_status == "failed"` AND `last_failed` within 48h, OR
   - `last_quality_score <= 2` (degraded output even when "successful").
3. **Cluster by error signature.** Group candidates by normalized `last_error` (lowercase, strip timestamps/ids/digits) AND by issue `category`. If 2+ skills share a signature OR a non-trivial category (`api-change`, `rate-limit`, `missing-secret`, `sandbox-limitation`):
   - This is **systemic**. Switch to systemic mode:
     - File or update a single shared issue (`affected_skills: [list]`) instead of N per-skill issues.
     - If the shared root cause is fixable in one place (e.g., a shared script under `scripts/`, a CLAUDE.md pattern, a shared config), open one PR addressing that. Otherwise emit `REPAIR_DIAGNOSED_NO_FIX` with the systemic finding.
     - Exit with `REPAIR_OK_SYSTEMIC` after step 5.
4. **Pick worst single target.** Sort: critical issue > high issue > consecutive_failures desc > lowest success_rate > stalest `last_success`. Skip `permanent-limitation` and any target whose preflight cooldown blocks it. If nothing remains: `REPAIR_NO_TARGETS`.

## 3. DIAGNOSE

Build a diagnostic dossier for the target before touching any file. Sources are independent — each one's status feeds the source-status footer (`ok`/`empty`/`fail`).

a. **Skill file**: read `skills/{name}/SKILL.md`. Note frontmatter, declared data sources, env-var references.

b. **Cron-state entry**: extract `last_error`, `last_failed`, `last_success`, `success_rate`, `consecutive_failures`, `last_quality_score`.

c. **Regression hunter**: if `last_success` exists, run

   ```bash
   git log --oneline --since="$LAST_SUCCESS" -- skills/{name}/SKILL.md aeon.yml scripts/
   ```

   Any commit listed is a candidate regression source. If exactly one commit touched the skill file in this window, it is the prime suspect — record its SHA + subject in the dossier.

d. **Recent failed runs (last 5, not just 1)**:

   ```bash
   gh run list --workflow=aeon.yml --limit 50 --json databaseId,name,conclusion,createdAt \
     | jq -r '[.[] | select(.name | contains("{name}")) | select(.conclusion=="failure")] | .[0:5]'
   ```

   For each, prefer `gh run view "$RUN_ID" --log-failed` (already filtered to failed steps) over the full log; fall back to `gh run view "$RUN_ID" --log` only if `--log-failed` returns nothing. Then:

   ```bash
   gh api "repos/{owner}/{repo}/actions/runs/$RUN_ID/check-runs" \
     | jq -r '.check_runs[].output.annotations[]? | "\(.path):\(.start_line) \(.annotation_level): \(.message)"'
   ```

   Annotations give clean error rows; logs give context. Distinguish **consistent** (same signature 4-5/5 runs → likely deterministic bug, secret, API change) from **intermittent** (1-2/5 → rate limit, flaky upstream).

e. **Logs**: search last 3 days of `memory/logs/*.md` for `{name}` mentions. Surface any prior diagnoses.

f. **Quality history**: if `memory/skill-health/{name}.json` exists, note `avg_score` trend.

g. **Output expectations**: read the target skill's own `SKILL.md` (its Output / format section and `## Summary` contract) for the shape a good run must produce — required sections, a word floor, forbidden placeholders. A passing run that violates its own spec is `quality-regression`.

h. **Issue**: if `memory/issues/INDEX.md` lists an open issue for this skill, read the file — its `category` and `root_cause` short-circuit the playbook lookup below.

## 4. REPAIR — per-category playbook

Categories follow `CLAUDE.md`. Pick the **most specific** category that fits the diagnostic dossier (issue category if present > error-signature pattern match > best inference). Apply the matching playbook.

| Category | Playbook |
|---|---|
| **`api-change`** | WebFetch the live API spec / status page / release notes. Update endpoints, payload shape, headers, error codes in the skill. Cite the spec URL in the PR body. Never guess — if WebFetch fails, drop to `REPAIR_DIAGNOSED_NO_FIX`. |
| **`rate-limit`** | Add backoff (`sleep`), reduce request count, or add a fallback endpoint. Never raise the limit from the skill side. If the skill's `schedule` is too aggressive, propose a less-frequent cron in the PR body but **don't edit `aeon.yml`** unless the issue file already authorizes it. |
| **`timeout`** | Split work into stages, add early-return on partial success, downgrade `model:` to `claude-haiku-4-5-20251001` for the skill that doesn't need Sonnet or Opus. |
| **`sandbox-limitation`** | Usually the "sandbox blocks the network" myth — there is **no** network sandbox. The real cause is a bare `$SECRET` on the command line (refused by the Bash permission layer) or a non-allowlisted command. Fix: route auth-required calls through `./secretcurl` with a `{ENV_NAME}` placeholder, or `gh api` for GitHub (auth handled internally). **Irreversible side-effects** (email / spend / on-chain / deploy) run **in-run** via `./secretcurl` as the skill's final, fail-closed action — never for reads. Add/refresh a "Network note" section. (There are **no** `scripts/prefetch-*.sh` or `scripts/postprocess-*.sh` scripts — both patterns were retired; auth'd reads and irreversible sends alike happen in-run.) |
| **`prompt-bug`** | Minimum-edit specificity insertion. Don't rewrite — add the missing constraint, a forbidden phrase, a required output structure, or a clarifying example. Diff should be < 30 added/removed lines. |
| **`output-format`** / **`quality-regression`** | Re-read the target skill's own output spec in its `SKILL.md`. Edit the skill so the next run satisfies that spec. Cite the exact requirement (section / line) in the PR body. |
| **`missing-secret`** | **Do not modify `aeon.yml` or the workflow.** File or update the issue with `status: open`, `category: missing-secret`, naming the secret. Notify operator with the env-var name. Exit `REPAIR_DIAGNOSED_NO_FIX`. |
| **`config`** | Reversible aeon.yml edits only — `schedule`, `var`, `model`, `enabled: false`. **Never** add or remove top-level structure or chains. Keep diff < 5 lines in aeon.yml. |
| **`permanent-limitation`** | Skip — should not have reached repair. Update issue, exit `REPAIR_DIAGNOSED_NO_FIX`. |
| **`unknown`** | Do **not** edit blindly. Append the full diagnostic dossier (regression candidates, top error lines, source-status) to the issue file as a `## Diagnosis Notes` section, exit `REPAIR_DIAGNOSED_NO_FIX`. Operator triages. |

**Risk classification** (pick one, gate the PR):
- **LOW** — clarifying prompt, adding fallback, comment-only changes, single-section edit (< 30 lines diff).
- **MED** — changes a data source, adds a new env-var reference (must already be in workflow), or modifies output format.
- **HIGH** — touches `aeon.yml`, removes existing features, disables a skill, modifies a `scripts/*.sh` file. **HIGH risk PRs must add the label `manual-review` and must NOT be auto-mergeable** (skip `auto-merge`-friendly framing in the PR body).

**Frontmatter integrity check**: after editing `skills/{name}/SKILL.md`, re-read it. Confirm the YAML frontmatter still has `name`, `description`, `var`, `tags`. If broken, abort the edit and exit `REPAIR_BLOCKED`.

## 5. VERIFY — append a verification plan to the PR

Every PR (except `REPAIR_DIAGNOSED_NO_FIX`) must include a Verification section the operator can execute. Use this template:

```markdown
## Verification

**Manual trigger:** [Run skill](https://github.com/{owner}/{repo}/actions/workflows/aeon.yml) with `skill={name}` and `var={var}`.

**Expected result:**
- Workflow conclusion: `success`
- Output file matches `{evals.json output_pattern or "memory/logs/${today}.md mentions {name}"}`
- {category-specific signal — e.g. "no `rate limit` strings in run logs" / "produces ≥ {min_words} words" / "annotation count ≤ 0"}

**If still failing after this PR:** delete `memory/state/skill-repair-history.json[{name}]` to remove the cooldown, then re-dispatch `skill-repair` with `var={name}` for a second pass.
```

Record the chosen verification command in the issue file's `## Repair Attempt` section so the next skill-repair run can read prior outcomes.

## 6. Branch, commit, PR

```bash
TODAY="${today}"
BRANCH="fix/skill-repair-{name}-${TODAY}"
git checkout -b "$BRANCH"
git add skills/{name}/SKILL.md  # plus aeon.yml or scripts/* iff in playbook
git commit -m "fix({name}): [one-line root cause → fix]"
git push -u origin "$BRANCH"

gh pr create --title "fix({name}): [short]" --body "$(cat <<'EOF'
## Symptom
[what failed — error signature, run URL]

## Diagnosis
[dossier summary: regression commit if any, consistent vs intermittent, category]

## Root cause
[one paragraph]

## Fix
[what changed and why]

## Risk
LOW | MED | HIGH — [rationale]

## Verification
[copy from step 5]

## Source status
cron_state=ok | issues_index=ok | gh_runs=ok | gh_logs=ok | git_log=ok | check_runs=ok
EOF
)"
```

If risk is HIGH, also: `gh pr edit "$PR_URL" --add-label manual-review`.

## 7. Update issue tracker (`memory/issues/`)

- If an open issue for this skill exists:
  - Fix applied → set `status: resolved`, `resolved_at: ${today}`, `fix_pr: <url>`. Move row from Open → Resolved in `INDEX.md`.
  - No fix possible → append `## Repair Attempt — ${today}` with the dossier and reason.
- If no issue exists but a real problem was found and fixed → create `memory/issues/ISS-{NNN}.md` with status already `resolved` (NNN = next free number from INDEX.md).
- If systemic clustering fired in step 2 → ensure `affected_skills:` lists every skill matched by the signature.

## 8. Persist cooldown

Update `memory/state/skill-repair-history.json`:

```json
{
  "{name}": {
    "last_repair_at": "${today}T...Z",
    "exit_code": "REPAIR_OK_FIXED",
    "fix_pr": "https://github.com/.../pull/N",
    "issue": "ISS-NNN"
  }
}
```

## 9. Notify

Send via `./notify` (one-paragraph max — verdict line first):

```
*skill-repair — {EXIT_CODE}*
Target: {name} (or systemic: skill-a, skill-b, ...)
Root cause: [one line]
Fix: [one line] (risk: LOW|MED|HIGH)
PR: {url}  Issue: {ISS-NNN}
Verify: workflow_dispatch skill={name}
```

## 10. Log

Append to `memory/logs/${today}.md`:

```markdown
### skill-repair
- Exit: {EXIT_CODE}
- Target: {name} (or systemic group)
- Category: {category}
- Diagnosis: [root cause]
- Fix: [what changed] (risk: {LOW|MED|HIGH})
- Regression suspect: {commit SHA or "none in window"}
- Failures observed: {N}/5 recent runs ({consistent|intermittent})
- PR: {url or "—"}
- Issue: {ISS-NNN created|updated|resolved or "—"}
- Source status: cron_state | issues_index | gh_runs | gh_logs | git_log | check_runs
```

## Network note

`gh` and `git` handle auth internally, so the diagnostic reads carry no `$SECRET` on the command line. There is no network sandbox — `curl` works; use `gh api` for GitHub reads, and prefer **WebFetch** over `curl` for any external API spec lookup in the `api-change` playbook (see `CLAUDE.md`). For an auth'd third-party API, route the call through `./secretcurl` with a `{ENV_NAME}` placeholder.

## Constraints

- One target per run (or one systemic cluster). Never bundle unrelated repairs.
- Minimum-edit principle: keep diffs as small as possible. The original failure mode is rarely "the skill needs a rewrite".
- Never modify secrets or the workflow files (`.github/workflows/aeon.yml`, `messages.yml`, `scheduler.yml`, `chain-runner.yml`).
- Never push to `main`. Always branch + PR.
- Never auto-merge HIGH-risk PRs. They carry the `manual-review` label.
- If a skill has been failing > 7 days with no clear root cause and the category is `unknown`, recommend (in the issue and notify) `enabled: false` in `aeon.yml` — but **do not apply that change** without an explicit operator-approved issue.
- Skip when `${var}` matches a skill that has been repaired in the last 24h unless operator clears the cooldown entry. This prevents repair loops on fixes that didn't take.
