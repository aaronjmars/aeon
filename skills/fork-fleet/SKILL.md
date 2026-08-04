---
name: fork-fleet
description: Fork divergence monitor - tracks where the fleet's active forks diverge in CODE (unique commits, new/modified skills) and CONFIG (enable/var/model/schedule vs upstream), gated on real change.
metadata:
  category: core
  var: ""
  tags:
    - dev
    - meta
  cron: "0 10 * * 1"
---
> **${var}** — Divergence scope selector; space-separated tokens, order-independent, all optional:
> - **scope** (`code` | `config` | `both`, default `both`) — which divergence dimension to run.
> - **`repo=owner/name`** — override the parent repo whose forks are scanned (else auto-resolved).
> - **`fork=owner/name`** — drill into a single fork (forces `code` scope; config math needs a fleet).
>
> Empty ⇒ **both** dimensions over the auto-resolved parent. Examples: `` (both, all forks) · `code` · `config` · `config repo=octo/aeon` · `fork=alice/aeon`.

Today is ${today}. This is the fleet's **divergence monitor**. It answers two questions the popularity/liveness skills don't:
1. **Code divergence** — which active forks are building real work (unique commits, new/modified skills) that's worth pulling back upstream?
2. **Config divergence** — where does the configured fleet systematically disagree with upstream's `enabled` / `var` / `model` / `schedule` defaults, so the operator can flip a default the fleet has already voted on?

`skill-gap` ranks **what's popular** (top 15 by enabled count). This skill's **code** branch surfaces **per-fork unique work**; its **config** branch surfaces **where operators disagree with defaults**. If 6 of 8 configured forks enable a skill upstream defaults off, upstream is shipping the wrong default; if 5 of 8 disable a skill upstream defaults on, that skill is noise. Both are peer-learning signals.

## Operating principles

- **Verdict first, catalog second.** The operator reads one line and knows if action is needed.
- **Silent when nothing changed.** Weekly cadence + a dormant/undivergent fleet = a read-once habit to kill. A clean run notifies nothing.
- **Per-fork compare is one call, not three.** `/compare/{owner}:main...{fork_owner}:main` returns ahead/behind/unique commits/files in a single round-trip; the recursive git-tree returns the fork's whole file list in one call.
- **Substance ≠ noise.** A new `skills/*/SKILL.md` is worth 100 cron-time edits in `aeon.yml`. Score accordingly. On the config side, an untouched template fork is not a "vote" — exclude it from divergence math.

---

## Shared setup (all scopes)

### S0. Bootstrap + load state

```bash
mkdir -p memory/topics
[ -f memory/instances.json ] || echo '{}' > memory/instances.json
[ -f memory/topics/fork-fleet-state.json ] || echo '{"forks":{},"last_run":null}' > memory/topics/fork-fleet-state.json
[ -f memory/topics/fork-digest-state.json ] || echo '{"last_run":null}' > memory/topics/fork-digest-state.json
```

Read `memory/MEMORY.md` for high-level context and scan the last ~3 days of `memory/logs/` — drop anything already reported so a weekly signal isn't re-sent.

- Read `memory/instances.json` → the set of repo `full_name`s that are **managed instances** (tagged separately from organic community forks in the report).
- Read `memory/topics/fork-fleet-state.json` → prior run's per-fork `{pushed_at, ahead_by, default_branch, new_skill_count}` keyed by `full_name`. Used for the **code** what-changed delta.
- Read `memory/topics/fork-digest-state.json` → prior config-divergence snapshot (schema in step B8). Used for the **config** week-over-week delta.

### S1. Parse the scope selector

Parse `${var}` into tokens:
- `SCOPE` = `code`, `config`, or `both` (default `both` if no scope keyword present).
- `REPO_OVERRIDE` = value of a `repo=owner/name` token, if any.
- `SINGLE_FORK` = value of a `fork=owner/name` token, if any. **If `SINGLE_FORK` is set, force `SCOPE=code`** (single-fork config divergence is meaningless — the config math needs a fleet of ≥2 configured forks).

### S2. Resolve the parent/target repo

Resolve `PARENT_REPO` in priority order:
1. `REPO_OVERRIDE` if the `repo=` token was given.
2. Else auto-resolve from this running instance:
   ```bash
   PARENT_REPO=$(gh api repos/$(gh repo view --json nameWithOwner -q .nameWithOwner) --jq '.parent.full_name // .full_name')
   ```
3. Else fall back to the first non-comment, non-empty line of `memory/watched-repos.md`.

If none resolves, write status `FORK_DIVERGENCE_NO_TARGET` to `memory/logs/${today}.md` and stop (no notification).

```bash
PARENT_NAME="${PARENT_REPO##*/}"
PARENT_OWNER="${PARENT_REPO%%/*}"
PARENT_DEFAULT_BRANCH=$(gh api "repos/${PARENT_REPO}" --jq '.default_branch')
```

### S3. List + classify forks (single call, shared by both branches)

One paginated listing — includes `default_branch`, `archived`, `disabled`, `pushed_at`, stars, description:

```bash
gh api "repos/${PARENT_REPO}/forks" --paginate \
  --jq '[.[] | {full_name, owner: .owner.login, default_branch, pushed_at, pushed_at_epoch: (.pushed_at | fromdateiso8601), stargazers_count, open_issues_count, archived, disabled, description}]'
```

Skip `archived=true` or `disabled=true`. Retain the rest as the total fork population (`N_TOTAL`). Classify by activity window:

- **Active** = `pushed_at` within last 30 days.
- **Stale** = 30–365 days.
- **Dormant** = >365 days or never pushed after creation.

The **Active** set (pushed in the last 30 days) is the shared working set for both branches — this matches the config branch's original 30-day cutoff exactly.

- **If `SINGLE_FORK` is set:** filter to that one fork, treat it as active, and skip the classification math.
- **If zero active forks** (and `SINGLE_FORK` unset): both branches short-circuit. If there is also no code-side state change (no new forks, none flipped active↔stale vs prior `fork-fleet-state.json`), write status `FORK_DIVERGENCE_QUIET` to the log, update the state files' `last_run`, send **no notification**, and stop.

Cap active-fork deep processing at **50 per run** — if more, rank by `pushed_at_epoch` desc and trim (log `truncated_at=50`).

Now dispatch: run **Branch A** if `SCOPE ∈ {code, both}`, **Branch B** if `SCOPE ∈ {config, both}`.

---

## Branch A — Code divergence (runs when `SCOPE ∈ {code, both}`)

### A1. Per-fork compare (one call each)

For each active fork, call cross-repo compare using the fork's own `default_branch` and `full_name` (absorbs any repo-rename drift):

```bash
gh api "repos/${PARENT_REPO}/compare/${PARENT_OWNER}:${PARENT_DEFAULT_BRANCH}...${FORK_OWNER}:${FORK_DEFAULT_BRANCH}" \
  --jq '{ahead_by, behind_by, status, files: [.files[]? | {filename, status, additions, deletions}], commits: [.commits[]? | {sha: .sha[0:7], msg: .commit.message | split("\n")[0], author: .commit.author.name, date: .commit.author.date}]}'
```

On `404` (branch missing / fork emptied): mark fork `UNREADABLE` and continue.
On `429`: sleep 60s, retry once. On `5xx`: sleep 10s, retry once. On persistent fail: mark `API_FAIL` for that fork.

Cross-repo compare returns unique fork commits (`commits`) and changed files (up to 300) in one shot — no separate `/commits` calls needed.

### A2. Classify divergence signals per fork

From the `files` array, tag each fork:
- **New skills**: files with `status=added` under `skills/*/SKILL.md`
- **Modified skills**: `status=modified` under `skills/*/SKILL.md`
- **Custom schedule**: any change to `aeon.yml`
- **Modified dashboard**: any change under `apps/dashboard/`
- **Custom notify**: change to `notify` or `notify-jsonrender`
- **New content**: additions under `output/articles/` or `memory/topics/`
- **Config changes**: changes to `CLAUDE.md`, `.github/`, `bin/`, or root `scripts/`
- **Workflow changes**: changes under `.github/workflows/`

### A3. Score each fork (substance-weighted)

```
score =  10 × (new skill files)
       +  4 × (modified skill files)
       +  2 × min(unique_commits, 15)
       +  3 × (new content files, capped at 5)
       +  2 × (workflow/config files, capped at 3)
       +  1 × (custom-schedule flag)
       +  1 × stargazers
```

Sort active forks by score descending. Flag any fork with ≥1 new skill file as a **PROMOTE** candidate; ≥3 unique commits OR ≥1 modified skill as **REVIEW**; otherwise **NOTE**.

### A4. Deep-read top upstream candidates

For every PROMOTE fork (capped at 5), fetch each unique skill's SKILL.md from the fork's default branch:

```bash
gh api "repos/${FORK_FULL_NAME}/contents/${SKILL_PATH}?ref=${FORK_DEFAULT_BRANCH}" --jq '.content' | base64 -d
```

On failure fall back to the file-tree listing and note "could not read content". Synthesize each unique skill into a 1–2 sentence description of what it does. Do **not** deep-read REVIEW or NOTE forks (output stays actionable).

### A5. Compute week-over-week delta (code)

Compare the current active-fork set to prior `fork-fleet-state.json`:
- **NEW_FORK**: full_name absent from prior state
- **NEW_ACTIVE**: was stale/dormant, now active
- **WENT_STALE**: was active, now stale/dormant
- **NEW_SKILLS**: active in both snapshots, `new_skill_count` increased
- **GONE**: archived / deleted since prior run

### A6. Pick the code verdict

One line. Priority order:
1. `NEW UPSTREAM CANDIDATE: {fork}` — if ≥1 PROMOTE fork has ≥1 new skill not present in prior state
2. `ACTIVE FLEET: {N} forks building` — if ≥3 PROMOTE+REVIEW combined
3. `FLEET STIRRING: {N} new active` — if ≥2 NEW_FORK or NEW_ACTIVE
4. `HOLDING PATTERN: {N} active, no new work` — active forks present but nothing crossed REVIEW
5. `DORMANT: no active forks` — shouldn't reach notify (S3 gates it); included for the log-only path

### A7. Build the code-divergence article part

Assemble this block (it becomes **Part 1** of the combined article in the final section):

```markdown
## What changed this week
- **New forks**: [list or "none"]
- **Went active**: [list or "none"]
- **New skills landed**: [fork → skill names, or "none"]
- **Went stale**: [list or "none"]
- **Archived/deleted**: [list or "none"]
(Omit the entire section if every bucket is empty.)

## PROMOTE — upstream contribution candidates

### {fork_full_name} — score N [MANAGED | COMMUNITY]
**Activity:** last pushed YYYY-MM-DD · stars N · +N/-M commits vs upstream
**Unique skills:**
- `skills/foo/SKILL.md` — {one-line synthesis of what it does, from deep-read}
- `skills/bar/SKILL.md` — {synthesis}

**Why promote:** {1–2 sentence take — what this skill does that upstream lacks, and whether it's generalizable}
**Suggested action:** Open a PR cherry-picking `skills/foo/` (or reach out to {owner} to upstream themselves).

(Repeat for each PROMOTE fork, capped at 5. If PROMOTE is empty: "No upstream candidates this week.")

## REVIEW — worth a look

| Fork | Score | Ahead | New/Modified | Notable |
|------|-------|-------|--------------|---------|
| owner/repo | N | +N/-M | 0/2 | dashboard rewrite, custom notify |

(Omit if empty.)

## NOTE — low divergence

Terse one-liner per fork: `owner/repo (+N/-M, schedule tweak only)`. Collapse into a count if >5 entries. Omit if empty.

## Fleet vs community

| Category | Count |
|----------|-------|
| Managed instances | N |
| Community forks | N |
| Stale (30-365d) | N |
| Dormant (>365d) | N |

## Code source status
`forks_list=ok|fail · compare_ok=N/M · deep_read=N/M · rate_limit_retries=N · unreadable=N`
```

If PROMOTE has >5 forks, keep only the top 5 by score; list the rest in REVIEW.

### A8. Update code state

Write `memory/topics/fork-fleet-state.json`:

```json
{
  "last_run": "${today}",
  "last_status": "FORK_FLEET_OK",
  "parent_repo": "owner/repo",
  "forks": {
    "owner/repo": {
      "pushed_at": "YYYY-MM-DD...",
      "default_branch": "main",
      "ahead_by": N,
      "behind_by": N,
      "new_skill_count": N,
      "score": N,
      "tier": "PROMOTE|REVIEW|NOTE|UNREADABLE|API_FAIL",
      "unique_skills": ["skills/foo/SKILL.md", "..."]
    }
  }
}
```

### A9. Set the code branch status

| Status | Meaning |
|--------|---------|
| `FORK_FLEET_OK` | Active forks present AND (PROMOTE/REVIEW non-empty OR delta non-empty) → contributes a notify signal |
| `FORK_FLEET_NO_CHANGE` | Active forks exist but nothing crossed REVIEW and delta is empty → log only |
| `FORK_FLEET_QUIET` | Zero active forks and no state change → log only |
| `FORK_FLEET_API_FAIL` | Fork listing failed or >50% of compares failed → error signal |

---

## Branch B — Config divergence (runs when `SCOPE ∈ {config, both}`)

### B1. Snapshot upstream defaults

Read this running instance's local `aeon.yml` once. Build (these are baselines — never mutated):

- `UPSTREAM_DEFAULTS`: dict `{skill_name -> {enabled: bool, model: str|null, var: str, schedule: str|null}}` for every skill entry under `skills:`.
- `UPSTREAM_SKILLS`: set of skill directory names from `skills/` (use `ls skills/`).
- `UPSTREAM_TAGS`: dict `{skill_name -> [tags]}` parsed from each `skills/<name>/SKILL.md` frontmatter (best-effort; missing frontmatter → `[]`).

### B2. Per-fork enumeration (one tree call + one yml fetch each)

Operate over the **active-fork set** from shared step S3 (already filtered to forks pushed in the last 30 days — the config branch's original cutoff). For each active fork, run **one** recursive git-tree call to enumerate files (cheaper than per-path contents):

```bash
gh api "repos/${FORK_FULL}/git/trees/HEAD?recursive=1" --jq '[.tree[] | select(.type == "blob") | .path]'
```

Then fetch the fork's `aeon.yml` only if the tree contains it:

```bash
gh api "repos/${FORK_FULL}/contents/aeon.yml?ref=${FORK_DEFAULT_BRANCH}" --jq '.content' | base64 -d
```

Error handling:
- 404 / 409 (empty repo): mark `status: "no_tree"`, skip aeon.yml extraction, continue.
- 403 with `X-RateLimit-Remaining: 0`: sleep 60s, retry once. If still failing, mark `status: "rate_limited"` and continue.
- Tree contains aeon.yml but the contents call 404s: mark `status: "yml_unreadable"`, continue.
- aeon.yml present but YAML parse fails: mark `status: "yml_invalid"`, continue.

For each readable `aeon.yml`, extract per-skill `{enabled, model, var, schedule}`. Treat missing keys as inheriting the upstream default (do **not** count those as overrides).

Detect **fork-only skills**: directory names matching `skills/<name>/SKILL.md` in the fork's tree where `<name>` is NOT in `UPSTREAM_SKILLS`. Record `{fork_full_name, skill_name, path}` for each.

### B3. Tier each fork

Compute a divergence signal vector vs `UPSTREAM_DEFAULTS`:
- `enabled_diff`: count of skills where the fork's `enabled` differs from upstream
- `var_overrides`: count of skills with non-empty `var:` where upstream's was empty (or a different non-empty value)
- `model_overrides`: count of skills with `model:` differing from upstream
- `schedule_overrides`: count of skills with `schedule:` differing from upstream
- `fork_only_skill_count`: count from step B2

Tier the fork:
- **CONFIGURED**: any signal ≥1 (the fork actively diverged)
- **TEMPLATE**: aeon.yml readable but every signal is 0 — excluded from divergence math
- **UNREADABLE**: no_tree / no aeon.yml / yml_unreadable / yml_invalid / rate_limited — tracked in the source-status footer

Let `N_CONFIGURED` = count of forks tiered CONFIGURED. **If `N_CONFIGURED < 2`:** the config branch cannot produce meaningful divergence math. Set config status `FORK_SKILL_DIGEST_TEMPLATE_FLEET`, record active/template/unreadable counts, emit a stub Part 2 noting the conversion rate, and contribute **no** config notify signal. Skip steps B4–B6.

### B4. Aggregate divergence (the core config analysis)

For each skill name in `UPSTREAM_SKILLS`, compute four dimensions:

**Enable divergence:**
- `forks_enabled_count`: number of CONFIGURED forks with `enabled: true` for this skill
- `forks_disabled_count`: number of CONFIGURED forks with `enabled: false` (explicitly set, not inherited)
- `upstream_enabled`: bool from UPSTREAM_DEFAULTS
- `divergence_pct`:
  - If upstream `enabled: false`: `forks_enabled_count / N_CONFIGURED` (how many disagree by enabling)
  - If upstream `enabled: true`: `forks_disabled_count / N_CONFIGURED` (how many disagree by disabling)
- `direction`: `"ENABLE_UPWARD"` (upstream off, forks turn on) or `"DISABLE_DOWNWARD"` (upstream on, forks turn off)

**Var divergence:**
- `var_override_count`: number of CONFIGURED forks where `var:` differs from upstream
- `top_var_value`: most common non-empty fork value (with count) — only if ≥2 forks share it

**Model divergence:**
- `model_override_count`: number of forks with non-null model differing from upstream
- `top_model_value`: most common fork model (with count) — only if ≥2 forks share it (signals fleet consensus on a cheaper/different model)

**Schedule divergence:**
- `schedule_override_count`: number of forks with schedule differing from upstream
- `top_schedule_value`: most common fork schedule (with count) — only if ≥2 forks share it

### B5. Categorize divergent skills

Classify each skill into **at most one** bucket (first match wins, in this order):

- **DEFAULT_FLIP_ENABLE**: `direction == "ENABLE_UPWARD"` AND `divergence_pct >= 0.50` AND skill is not `workflow_dispatch` AND skill not tagged `meta`/`dev`. Recommend: flip upstream default to `enabled: true`.
- **DEFAULT_FLIP_DISABLE**: `direction == "DISABLE_DOWNWARD"` AND `divergence_pct >= 0.50`. Recommend: flip upstream default to `enabled: false` (the fleet is voting it as noise).
- **MODEL_CONSENSUS**: `top_model_value` non-null AND its count `>= max(2, ceil(N_CONFIGURED * 0.40))`. Recommend: match the fleet's model in upstream.
- **VAR_HOTSPOT**: `var_override_count >= max(2, ceil(N_CONFIGURED * 0.30))` AND `top_var_value` non-null. Recommend: surface the common var value in upstream docs or as the default.
- **EMERGING**: `direction == "ENABLE_UPWARD"` AND `0.25 <= divergence_pct < 0.50` AND not already in a flip bucket. Surface as a watchlist — fleet sentiment building but not yet majority.
- (otherwise: not categorized; appears only in the appendix divergence table if any signal is non-zero)

Skills with all-zero divergence are omitted.

### B6. Per-fork customization fingerprint

For each CONFIGURED fork:
- `total_overrides`: `enabled_diff + var_overrides + model_overrides + schedule_overrides + fork_only_skill_count`
- `category_lean`: dict `{tag -> count_of_enabled_skills_with_that_tag}` (using UPSTREAM_TAGS for upstream skills the fork enables; fork-only skills counted under tag `"fork-only"`)
- `dominant_category`: tag with max count, or `"mixed"` if no tag holds >40% of total enabled count

Rank forks by `total_overrides` desc. Top 5 = "heaviest customizers" — surface with dominant category and a one-line synthesis (e.g. `"owner/aeon — content-heavy: 14 article/digest skills enabled, 3 model overrides to claude-sonnet-4-6"`). The fingerprint is **descriptive only** — never recommend changes to individual forks.

### B7. Config week-over-week delta

Read the prior `memory/topics/fork-digest-state.json` snapshot (schema in B8). If it exists and `last_run` is within the last 14 days, compute:
- **NEW_FLIP**: skills now in DEFAULT_FLIP_* that weren't last run
- **STRENGTHENED**: skills that moved EMERGING → DEFAULT_FLIP_ENABLE
- **FADED**: skills that left a flip bucket since last run
- **NEW_FORK_ONLY**: fork-only skills not present last run
- **NEW_HEAVY_CUSTOMIZER**: forks now in the top-5 fingerprint that weren't before

If the file is missing or stale (>14 days), set all deltas to `"first divergence snapshot"`.

### B8. Pick the config verdict + persist snapshot

Config verdict line, strongest single claim first:
1. Any `DEFAULT_FLIP_ENABLE`: `"${N} forks enable ${skill} (upstream defaults off) — flip the default"`
2. Else any `DEFAULT_FLIP_DISABLE`: `"${N} forks disable ${skill} (upstream defaults on) — fleet is voting it as noise"`
3. Else any `MODEL_CONSENSUS`: `"${N} forks override ${skill} → ${model} — match upstream"`
4. Else any `NEW_FORK_ONLY` from delta: `"${fork_owner} shipped ${skill} — not in upstream"`
5. Else any `EMERGING`: `"${skill} adoption building (${pct}% of configured) — watchlist"`
6. Else: `"${N_CONFIGURED} configured forks; no divergence pattern crossed flip threshold"`

Persist `memory/topics/fork-digest-state.json` (overwrite each run — the JSON is the delta contract; do NOT parse last week's article):

```json
{
  "last_run": "${today}",
  "target_repo": "${PARENT_REPO}",
  "n_active": N_ACTIVE,
  "n_configured": N_CONFIGURED,
  "n_template": N_TEMPLATE,
  "n_unreadable": N_UNREADABLE,
  "buckets": {
    "DEFAULT_FLIP_ENABLE": [{"skill": "name", "forks": N, "pct": 0.NN}],
    "DEFAULT_FLIP_DISABLE": [{"skill": "name", "forks": N, "pct": 0.NN}],
    "MODEL_CONSENSUS": [{"skill": "name", "model": "value", "forks": N}],
    "VAR_HOTSPOT": [{"skill": "name", "var": "value", "forks": N}],
    "EMERGING": [{"skill": "name", "pct": 0.NN}]
  },
  "fork_only_skills": [{"fork": "owner/repo", "skill": "name"}],
  "fingerprints": [{"fork": "owner/repo", "total_overrides": N, "dominant_category": "tag"}]
}
```

### B9. Build the config-divergence article part

Assemble this block (it becomes **Part 2** of the combined article):

```markdown
*Scanned ${N_ACTIVE} active forks of ${PARENT_REPO} (pushed in last 30 days). ${N_CONFIGURED} are configured (aeon.yml diverges from upstream defaults). Divergence scored against the configured ${N_CONFIGURED}.*

## Default-flip candidates

### Enable upward (upstream off → fleet enables)
| Skill | Forks enabled | % of configured | Δ vs last week |
|-------|---------------|-----------------|----------------|
| name  | N             | XX%             | NEW / STRENGTHENED / — |

(Only DEFAULT_FLIP_ENABLE. If empty: "No skills crossed the 50% enable-upward threshold this week.")

### Disable downward (upstream on → fleet disables)
| Skill | Forks disabled | % of configured | Δ vs last week |
|-------|----------------|-----------------|----------------|
| name  | N              | XX%             | NEW / — |

(Only DEFAULT_FLIP_DISABLE. If empty: "No skills crossed the 50% disable-downward threshold.")

## Fleet consensus on alternative settings

### Model overrides
${MODEL_CONSENSUS entries: "skill X — N forks → claude-sonnet-4-6 (40% of configured)" OR "none this week"}

### Var hotspots
${VAR_HOTSPOT entries: "skill X — N forks set var to '${value}'" OR "none this week"}

### Schedule overrides
${skills where ≥2 forks share an alternative schedule, with the schedule string OR "none this week"}

## Watchlist (emerging — 25–49% adoption)
${EMERGING skills with adoption % OR "none this week"}

## Heaviest customizers (top 5)

| Fork | Total overrides | Dominant category | Notes |
|------|-----------------|-------------------|-------|
| owner/repo | N | content / dev / meta / fork-only / mixed | one-line synthesis |

## Fork-only skills

${list of {fork, skill_name} pairs OR "none this week"}

(These skills exist as `skills/<name>/SKILL.md` in a fork but not in upstream — fork experiments worth reviewing for upstreaming.)

## Config week-over-week

${"First divergence snapshot — no comparison" OR list of NEW_FLIP / STRENGTHENED / FADED / NEW_FORK_ONLY / NEW_HEAVY_CUSTOMIZER}

## Fleet composition (config tiers)

| Tier | Count | % |
|------|-------|---|
| Configured | N_CONFIGURED | XX% |
| Template (untouched aeon.yml) | N_TEMPLATE | XX% |
| Unreadable | N_UNREADABLE | XX% |
| **Total active** | N_ACTIVE | 100% |

## Config source status
- Trees fetched: N_TREES_OK / N_ACTIVE
- aeon.yml readable: (N_CONFIGURED + N_TEMPLATE) / N_ACTIVE
- YAML parse failures: N_YML_INVALID
- Rate-limited: N_RATE_LIMITED
- Fork-only skills inspected: N_FORK_ONLY_FILES

## Appendix — full divergence table

(Every skill with ≥1 non-zero divergence signal, sorted by total override count desc. Columns: skill, enable_diff, var_overrides, model_overrides, schedule_overrides. Cap at 30 rows; if more, append "+ N more skills with low-signal divergence".)
```

### Config branch status

| Status | Meaning |
|--------|---------|
| `FORK_SKILL_DIGEST_OK` | ≥2 configured forks AND ≥1 flip/consensus/new-fork-only signal → contributes a notify signal |
| `FORK_SKILL_DIGEST_QUIET` | ≥2 configured forks but no signal crossed thresholds → log only |
| `FORK_SKILL_DIGEST_TEMPLATE_FLEET` | <2 configured forks (mostly templates) → log only |
| `FORK_SKILL_DIGEST_NO_FORKS` | Zero active forks → log only |

---

## Assemble the report (all scopes)

### R1. Write the combined article

To `output/articles/fork-divergence-${today}.md`. Header first, then whichever parts ran:

```markdown
# Fork Divergence — ${today}

**Verdict:** {lead with the stronger of the two sub-verdicts — a code PROMOTE/NEW-UPSTREAM-CANDIDATE outranks a config flip only if it's a genuinely new skill; otherwise a DEFAULT_FLIP leads. Use judgment; one line.}

- **Code divergence:** {code verdict from A6, or "not run (scope=config)"}
- **Config divergence:** {config verdict from B8, or "not run (scope=code)"}

Fleet: N_TOTAL total forks · N_ACTIVE active · N_MANAGED managed instances · N_COMMUNITY community.

---

# Part 1 — Code divergence
{Branch A article part from A7; omit this whole part if SCOPE=config}

---

# Part 2 — Config divergence
{Branch B article part from B9; omit this whole part if SCOPE=code}

---
*Source: GitHub API — forks of ${PARENT_REPO}. Code divergence = per-fork unique commits/skills vs upstream. Config divergence = where configured forks' aeon.yml disagrees with upstream `enabled`/`var`/`model`/`schedule`; untouched templates are excluded from the config math. Companion to `skill-gap` (popularity).*
```

Cap the article at ~700 lines total (≈500 for code sections when both parts run). When only one branch ran, drop the other Part heading and the missing sub-verdict line.

### R2. Notify — gated

Read `soul/` (if present) to match the operator's voice. **Skip notify entirely** when neither branch produced a signal, i.e. when:
- code status ∈ {`FORK_FLEET_NO_CHANGE`, `FORK_FLEET_QUIET`} (or code didn't run), **AND**
- config status ∈ {`FORK_SKILL_DIGEST_QUIET`, `FORK_SKILL_DIGEST_TEMPLATE_FLEET`, `FORK_SKILL_DIGEST_NO_FORKS`} (or config didn't run).

If either branch hit `FORK_FLEET_API_FAIL`, send an **error** notify (`--severity warn`) noting the failure and source status.

Otherwise send one combined message via `./notify` (include only the sub-blocks whose branch produced signal; keep it tight):

```
*Fork Divergence — ${today}*
{combined verdict line}

Fleet: N_ACTIVE active / N_TOTAL total. {1 sentence on shape — "mostly managed instances", "community picking up", "template-heavy", etc.}

{If code PROMOTE non-empty:}
Upstream candidate: {top PROMOTE fork}
{2 sentences: what they built, why it's worth merging back}

{If code delta has NEW_SKILLS:}
New skills landed this week:
- {fork} → `skills/foo/SKILL.md` — {synthesis}

{If DEFAULT_FLIP_ENABLE non-empty (top 3):}
Flip enable (upstream off → fleet on):
- {skill} — {N} forks ({pct}%)

{If DEFAULT_FLIP_DISABLE non-empty (top 3):}
Flip disable (upstream on → fleet off):
- {skill} — {N} forks ({pct}%)

{If MODEL_CONSENSUS non-empty (top 2):}
Model consensus:
- {skill} → {model} ({N} forks)

{If config delta NEW_FORK_ONLY non-empty:}
New fork-only skills: {comma-separated owner/skill, capped at 3}

Full report: https://github.com/${GITHUB_REPOSITORY}/blob/main/output/articles/fork-divergence-${today}.md
```

Use `$GITHUB_REPOSITORY` for the URL (the article lives in this running instance's repo, not the target repo).

### R3. Log

Append to `memory/logs/${today}.md` under **one** heading. Include a discriminator line naming the scope that ran, then only the sub-blocks for branches that ran:

```
### fork-fleet
- Scope: {both | code | config}  ·  Combined status: {FORK_DIVERGENCE_OK | NO_CHANGE | QUIET | NO_TARGET | API_FAIL}
- Verdict: {combined verdict line}
- Fleet: N_ACTIVE active / N_TOTAL total (N_MANAGED managed, N_COMMUNITY community)

[code]  (only if Branch A ran)
- Code status: {FORK_FLEET_OK | NO_CHANGE | QUIET | API_FAIL}
- PROMOTE: N forks (list), REVIEW: N, NOTE: N
- Code delta: {new_forks:N, new_active:N, new_skills:N, went_stale:N}
- Code source: forks_list=ok|fail · compare_ok=N/M · deep_read=N/M · unreadable=N

[config]  (only if Branch B ran)
- Config status: {FORK_SKILL_DIGEST_OK | QUIET | TEMPLATE_FLEET | NO_FORKS}
- Configured: N (XX% conversion) · Template: N · Unreadable: N
- DEFAULT_FLIP_ENABLE: N · DEFAULT_FLIP_DISABLE: N · MODEL_CONSENSUS: N · VAR_HOTSPOT: N · EMERGING: N
- Fork-only skills: N · Heaviest customizer: {fork} ({N} overrides)

- Article: output/articles/fork-divergence-${today}.md
- Notification sent: yes/no
```

## Exit taxonomy (combined)

The combined status rolls up the per-branch statuses (kept verbatim in A9 / B-status above):

| Combined status | Rolls up when | Notify? |
|-----------------|---------------|---------|
| `FORK_DIVERGENCE_OK` | code = `FORK_FLEET_OK` **OR** config = `FORK_SKILL_DIGEST_OK` | Yes |
| `FORK_DIVERGENCE_NO_CHANGE` | both branches ran but neither reached OK (all `NO_CHANGE`/`QUIET`/`TEMPLATE_FLEET`/`NO_FORKS`) | No (log only) |
| `FORK_DIVERGENCE_QUIET` | zero active forks and no code-side state change (S3 short-circuit) | No (log only) |
| `FORK_DIVERGENCE_NO_TARGET` | no parent/target repo resolved (S2) | No (log only) |
| `FORK_DIVERGENCE_API_FAIL` | fork listing failed, or >50% of a branch's compares/trees failed | Yes (error notify) |

## Constraints

- **Cross-repo compare** accepts up to 300 files per response; if a fork exceeds this, note `files_truncated=true` for it and proceed.
- Cap active-fork deep processing at **50 per run** (S3) — rank by `pushed_at_epoch` desc and trim, logging `truncated_at=50`.
- Never deep-read content from a fork with `archived=true`, or when the SKILL.md path is absent from the compare `files` list (cheapest sanity check).
- **Never invent a PROMOTE candidate** — a fork with zero new skill files is at most REVIEW.
- **Config math needs a denominator:** never send a config signal when `N_CONFIGURED < 2` — the divergence percentages are meaningless without a configured base.
- Skills tagged `meta` or `dev` are excluded from `DEFAULT_FLIP_ENABLE` (operator tools — fork adoption isn't the success metric). They can still appear in MODEL_CONSENSUS, VAR_HOTSPOT, and the appendix.
- Skills with `schedule: "workflow_dispatch"` are excluded from **both** flip buckets (on-demand by design — adoption % is misleading).
- `heartbeat` is excluded from `DEFAULT_FLIP_DISABLE` (every fork inheriting upstream's `enabled: true` would game the disable count if any fork explicitly disables it to stay quiet).
- The per-fork fingerprint is descriptive only — only aggregate signals drive recommendations.
- Silent runs are **correct**, not failures. This skill is the divergence companion to `skill-gap` (popularity); avoid duplicating its headline metrics — focus on the code + config **divergence patterns** it doesn't surface.

## Network note

Every GitHub call uses `gh api`, which authenticates via `GITHUB_TOKEN` automatically — no `curl`, no `$SECRET` on the command line (so nothing for the Bash permission layer to refuse), no secrets beyond the default `GITHUB_TOKEN`. Retry policy: on `429`/`5xx` (compare) back off per step A1; on `403` with `X-RateLimit-Remaining: 0` (tree/contents) sleep 60s and retry once, then mark that fork `rate_limited` and proceed with a partial fleet (the verdict and source-status footers surface the gap). If the initial `/forks` listing fails after retry, combined status = `FORK_DIVERGENCE_API_FAIL` with `forks_list=fail`.
