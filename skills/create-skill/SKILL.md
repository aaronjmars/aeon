---
type: Skill
name: Create Skill
category: evolution
description: Generate a complete new skill from a one-line prompt and ship it as a PR
var: ""
tags: [dev, meta]
---
> **${var}** — A natural-language description of the skill to create. **Required.** Example: `"monitor Hacker News for AI papers and send a summary"` or `"track gas prices on Ethereum and alert when below 10 gwei"`.

<!-- autoresearch: variation B — sharper output via PR-first workflow + quality enforcement + exit taxonomy + new-secret guard -->

If `${var}` is empty, exit `CREATE_SKILL_NO_VAR`:
```bash
./notify "create-skill aborted: var empty — pass a description e.g. \"monitor X for Y\""
```
Then stop.

Today is ${today}. Your task is to generate a complete, production-ready skill from `${var}`, score it against a quality bar, and ship it as a PR — **never commit directly to `main`**.

## Steps

1. **Parse the request.** Extract from `${var}`:
   - Core action verb (monitor, fetch, generate, analyze, alert, track, scan, etc.)
   - Data source(s) — APIs, websites, RSS, on-chain, GitHub, etc.
   - Output format — notification, article, file, PR, dashboard, etc.
   - Configurable parameter(s) the new skill will accept via its own `${var}`
   - Suggested cadence (daily, hourly, weekly, on-demand)

   Save a one-paragraph structured request summary; you'll use it in the PR body.

2. **Duplicate detection (deep — not just `ls`).** Find functional overlap, not just name collision.
   ```bash
   keywords=$(echo "${var}" | tr '[:upper:]' '[:lower:]' | grep -oE '[a-z]{4,}' \
     | grep -vE '^(send|with|from|that|this|when|each|into|over|some|like|just|than|then|also|will|have|been|using|monitor|track|fetch|alert)$' \
     | sort -u)
   for kw in $keywords; do
     grep -liE "$kw" skills/*/SKILL.md | head -5
   done
   ```
   Read the top 3 candidates fully. For each, judge: does it already do this? Could the request be solved by running an existing skill with a different `var=`?
   - **Near-duplicate exists** → exit `CREATE_SKILL_DUPLICATE`. Notify with the existing skill name and a one-line suggestion ("use existing `{skill}` with `var={...}` instead"). Stop.
   - **Functionally adjacent** → design the new skill to complement (different angle/cadence/output). Document the boundary in the PR body.

3. **Research the data sources.** For every API or data source the new skill needs:
   - **WebSearch** for the current API documentation. Cross-check against a secondary source when feasible (a recent GitHub repo using it, an official changelog, or a Stack Overflow answer dated ≥2026) to confirm the endpoint isn't deprecated.
   - **WebFetch** the canonical docs URL — record it as a comment in the SKILL.md and in the PR body's "Sources researched" section.
   - Identify exact endpoints, required headers, auth scheme, response schema, and rate limits.
   - Note every required environment variable / API key.
   - Determine fallback strategy when an optional API key isn't set (WebSearch / WebFetch / cached data / public endpoint).

   **Research bar (soft):** at least one confirmed source URL or exemplar (a working docs page or a public repo using the API). If none, do **not** hard-abort — log `CREATE_SKILL_INSUFFICIENT_RESEARCH`, ask the operator via `./notify` with what was tried and why each source failed, and stop. The operator can re-dispatch with a clearer prompt or a source hint.

4. **New-secret guard.** Secrets values are never inspectable from the workflow — only names are listed. Use `gh api repos/:owner/:repo/actions/secrets --jq '.secrets[].name'` to read the **names** of secrets already configured (this endpoint returns names only, never values). Cross-reference with env-var usage in `aeon.yml` and existing workflows. For each env var the new skill needs:
   - **Name present** → continue.
   - **Name missing** → record as `NEW_SECRET_REQUIRED`. The generated skill **must** gracefully degrade or skip when the secret is absent (no hard crash). Add a `### Required secrets` section to the PR body listing what the operator must add to GitHub Actions secrets before enabling.

   If the secret has no graceful fallback, the generated skill's step 1 must do:
   ```bash
   if [ -z "$VAR" ]; then ./notify "{skill} skipped: VAR not set"; exit 0; fi
   ```

5. **Design the skill.** Decide:
   - **Skill name** — lowercase, hyphenated, 2-3 words max (e.g., `gas-alert`, `hn-papers`). Must not collide with any existing entry under `skills/`.
   - **Description** — one sentence, starts with a verb, ≤90 chars.
   - **Tags** — pick from: `content`, `crypto`, `dev`, `meta`, `news`, `research`, `social`. Max 3.
   - **Variable behavior** — what `${var}` controls; what happens when empty (sane default OR clean abort with notify).
   - **Steps** — 4-8 numbered, following the standard pattern: read context → fetch/search → process/analyze → write output → log → notify.
   - **Schedule suggestion** — choose a cron slot. Read existing schedules in `aeon.yml`; avoid co-scheduling at the same minute as heavy skills (article, repo-scanner, deep-research, telegram-digest) unless the new skill is lightweight (<30s expected). Prefer a `:30` minute offset if the natural hour is already crowded.
   - **Model** — default `claude-sonnet-5`. Pick `claude-haiku-4-5-20251001` if the skill is high-frequency aggregation/digestion (cost optimization), or `claude-opus-5` if it needs the strongest reasoning. Document the choice in the PR body.
   - **Category** — the pack the skill joins. Pick one: `research` `dev` `crypto` `onchain-security` `social` `productivity` `meta`. (`core` and `fleet` are curated in `packs.config.json`, not chosen here.) If none fits, omit it and the skill lands in the **Lab** catch-all for later triage. See `docs/skill-packs.md`.

6. **Write the SKILL.md draft** at `skills/{skill-name}/SKILL.md` with this exact structure:

   ```markdown
   ---
   name: {Display Name}
   category: {category}
   description: {One-sentence description starting with a verb}
   var: ""
   tags: [{tags}]
   ---
   > **${var}** — {What the variable controls}. {If-empty behavior}.

   Today is ${today}. {One sentence describing the task.}

   ## Steps

   1. **{Step title}.** {Specific instructions — endpoints, commands, formats.}

   2. **{Step title}.** {More instructions. Code blocks for curl/bash when relevant.}

   ...

   N-1. **Log.** Append to `memory/logs/${today}.md`:
   - Skill: {skill-name}
   - What was done and key outputs

   N. **Notify.** Send via `./notify`:
   {Output format template — specify ≤4000 chars, clickable URLs}

   ## Network note

   {How this skill reaches the network — ./secretcurl with an {ENV_NAME} placeholder for auth'd APIs, gh api for GitHub, curl + WebFetch fallback for public}
   ```

   Hard rules for the generated content:
   - Complete `curl` commands with proper headers and URL encoding (no pseudo-code).
   - `jq` parsing for JSON APIs.
   - Notification character limit explicitly stated (under 4000 chars total).
   - Every link clickable (full URLs, not placeholders).
   - Fallback behavior defined for every optional secret.
   - Use only `${var}` and `${today}` template variables — no other invented variables.
   - No TODOs, no placeholders, no "fill in later".
   - Mandatory `## Network note` section (accurate model — see the `## Network note` in this skill for the canonical wording; there is no network sandbox).

7. **Quality enforcement (self-edit pass).** Score the draft 1-5 across:

   | Criterion | What to check |
   |-----------|---------------|
   | Frontmatter complete | `name`, `category`, `description`, `var`, `tags` present and well-formed |
   | Var doc | Single `>` block-quote line; if-empty behavior defined |
   | API calls complete | Curl + headers + jq, not pseudo-code |
   | Fallback behavior | Graceful degradation for every optional secret |
   | Output spec | Char limits, clickable URLs, format template explicit |
   | Network note | Present and matches the auth pattern of the API used (`./secretcurl` for auth'd, `gh api` for GitHub, WebFetch fallback for public) |

   Any criterion <4 → rewrite that section once. Still <4 after one rewrite → exit `CREATE_SKILL_VALIDATION_FAILED` with a notify listing failed criteria. **Do not ship a low-quality skill.**

8. **Post-write validation.** Re-read the SKILL.md from disk and verify:
   - Frontmatter YAML is parseable; required keys present.
   - No literal substring matches: `TODO`, `FIXME`, `XXX`, `placeholder`, `fill in`, `lorem`, `<your-`, `your_api_key_here`, `example.com`.
   - Every `${...}` template variable resolves to `${var}` or `${today}`.
   - At least one `./notify` invocation appears in the body.
   - At least one `memory/logs/${today}.md` write appears.
   - `## Network note` section exists.

   Any failure → delete the partial file and any other writes, exit `CREATE_SKILL_VALIDATION_FAILED` with a notify listing the failed checks. No partial state.

9. **Register in `aeon.yml`.** Insert the new skill in the appropriate time-slot section:
   - Format: `  {skill-name}: { enabled: false, schedule: "{suggested_cron}" }`
   - Add `model: "claude-haiku-4-5-20251001"` (or `"claude-opus-5"`) if chosen in step 5.
   - Add `var: ""` if the skill takes a default var.
   - Add a brief trailing comment if the name doesn't make purpose obvious.
   - Place near related skills (crypto with crypto, content with content, etc.).
   - **Always** `enabled: false`. Operator decides when to turn it on.

   Verify YAML still parses after the edit. If parsing fails, revert the change and exit `CREATE_SKILL_VALIDATION_FAILED`.

10. **Open as a PR (never commit to `main`).**
    ```bash
    name="{skill-name}"
    git checkout -b create-skill/$name
    git add skills/$name/SKILL.md aeon.yml
    git commit -m "create skill: $name

    {one-sentence description}

    Generated by create-skill from var: \"{request summary, ≤80 chars}\""
    git push -u origin create-skill/$name
    gh pr create --title "create skill: $name" --body "$(cat <<'EOF'
    ## Skill
    **Name**: `{skill-name}`
    **Description**: {description}
    **Tags**: {tags}
    **Schedule**: `{cron}` (disabled by default)
    **Model**: {model}
    **Var**: {var-doc}

    ## Request
    ```
    ${var}
    ```

    ## Sources researched
    - {URL 1}
    - {URL 2}
    - {URL 3}

    ## Required secrets
    {list of NEW_SECRET_REQUIRED env vars OR "None — uses existing secrets"}

    ## Quality scores
    | Criterion | Score |
    |-----------|-------|
    | Frontmatter | X/5 |
    | Var doc | X/5 |
    | API calls | X/5 |
    | Fallback behavior | X/5 |
    | Output spec | X/5 |
    | Network note | X/5 |

    ## Trigger manually
    Workflow dispatch with `skill={skill-name}` and `var={example-var}`.
    EOF
    )"
    ```
    Capture the PR URL.

11. **Log.** Append to `memory/logs/${today}.md`:
    ```
    ### create-skill
    - Request: {var, ≤80 chars}
    - Created: skills/{skill-name}/SKILL.md
    - Registered in aeon.yml: schedule={cron}, model={model}
    - Required secrets: {list or "none"}
    - Quality scores: F/V/A/Fb/O/N = X/X/X/X/X/X
    - PR: {url}
    - Exit: CREATE_SKILL_OK (or CREATE_SKILL_NEW_SECRET_REQUIRED)
    ```

12. **Notify.** Send via `./notify`:
    ```
    *create-skill — {skill-name}*
    {one-line description}
    Schedule: `{cron}` (disabled by default)
    {Required secrets line if any}
    PR: {url}
    Trigger: dispatch skill=`{skill-name}` var=`{example}`
    ```

## Exit taxonomy

| Code | When | Action |
|------|------|--------|
| `CREATE_SKILL_OK` | New skill created, validated, PR opened | Notify with PR link |
| `CREATE_SKILL_NEW_SECRET_REQUIRED` | Same as OK plus operator must add a new secret before enabling | Notify with PR link + secret call-out |
| `CREATE_SKILL_NO_VAR` | `${var}` empty | Notify abort reason; stop |
| `CREATE_SKILL_DUPLICATE` | Existing skill covers the request | Notify with existing-skill suggestion; stop |
| `CREATE_SKILL_INSUFFICIENT_RESEARCH` | Couldn't confirm ≥1 working data source after WebSearch + WebFetch | Notify with what was tried; stop |
| `CREATE_SKILL_VALIDATION_FAILED` | Quality enforcement or post-write checks failed | Delete partial files; revert aeon.yml; notify with failed criteria; stop |

## Network note

There is no network sandbox — `curl` works, with **WebFetch** as the fallback for a flaky public GET during research. For an auth'd API the new skill will call, route it through `./secretcurl` with a `{ENV_NAME}` placeholder (the key injected via the skill's `requires:`), and `gh api` for GitHub. **Irreversible side-effects** (email, spend, on-chain writes, deploys) run **in-run** via `./secretcurl` as the skill's final, fail-closed action — there is no deferred/postprocess step, and never defer a read (see CLAUDE.md).

## Constraints

- **Never** commit a generated skill directly to `main`. Always open a PR.
- **Never** enable a generated skill in `aeon.yml` (`enabled: false` always — operator decides).
- **Never** add an API key/secret to the workflow that isn't already there. Surface as `NEW_SECRET_REQUIRED` and document in the PR body.
- **Never** ship a skill that fails validation. Aborting cleanly is always better than shipping broken.
- **Never** overwrite an existing `skills/{name}/SKILL.md` — name collisions are blocking errors.
