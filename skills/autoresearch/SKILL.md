---
name: autoresearch
description: Evolve a skill by generating variations, evaluating them, and updating the best version
metadata:
  title: Autoresearch
  category: evolution
  var: ""
  tags:
    - meta
    - dev
---
> **${var}** — Name of the skill to evolve (e.g. `token-movers`). Required.

If `${var}` is empty, abort with: "autoresearch requires var= set to a skill name" and exit.

Read memory/MEMORY.md for context.

## Goal

Improve an existing skill by researching better approaches, generating 4 distinct variations, scoring them against a rubric, and committing the winning version as a PR.

## Steps

### 1. Load the target skill

Read `skills/${var}/SKILL.md`. If the file doesn't exist, abort and notify: "Skill '${var}' not found."

Parse the skill's:
- **Purpose**: what it does
- **Data sources**: APIs, URLs, commands it calls
- **Output format**: what it produces (article, notification, file)
- **Dependencies**: env vars, tools, other files it reads

Save the original content — you'll need it for the PR diff later.

### 2. Research improvements

Search the web for better approaches to what this skill does:
- Alternative or complementary APIs/data sources
- Best practices for the skill's domain (e.g., crypto analysis, RSS aggregation, security scanning)
- Common pitfalls or failure modes for the techniques the skill uses
- Output formats that are more actionable or readable

Also review:
- Recent memory/logs/ entries where this skill ran — did it produce useful output? Were there failures?
- `memory/cron-state.json` — has this skill been failing?

### 3. Generate 4 variations

Create 4 distinct improved versions of the SKILL.md, each with a different thesis:

**Variation A — Better inputs**: Improve data sources. Add alternative/complementary APIs, better search queries, more reliable endpoints. Fix any broken or deprecated sources found in step 2.

**Variation B — Sharper output**: Improve the output format and content quality. Make notifications more actionable, articles more substantive, analysis more insightful. Reduce noise, improve signal.

**Variation C — More robust**: Improve reliability and edge-case handling. Add fallback logic for when APIs fail, better deduplication, graceful handling of empty data, clearer error messages.

**Variation D — Rethink**: Take a fundamentally different approach to achieving the same goal. Different methodology, different angle, or a creative combination of techniques the original didn't consider.

Each variation must:
- Preserve the original frontmatter format (name, description, var, tags)
- Follow Aeon skill conventions (read memory, log to memory/logs/${today}.md, notify via `./notify`)
- Be a complete, ready-to-run SKILL.md — no placeholders
- Include a one-line comment at the top of the body: `<!-- autoresearch: variation X — thesis description -->`

### 4. Evaluate and score

Score each variation on a 1-5 scale across these criteria:

| Criterion | What to evaluate |
|-----------|-----------------|
| **Clarity** | Will Claude execute this correctly? Are instructions unambiguous? |
| **Data quality** | Are sources reliable, diverse, and likely to return useful data? |
| **Output value** | Is the output actionable and worth reading? Low noise? |
| **Robustness** | Does it handle failures, empty data, and edge cases? |
| **Conventions** | Does it follow Aeon patterns? (memory, logging, notify, var usage) |
| **Improvement** | How much better is this than the original? |

Write out your scoring with brief justification for each score. Calculate a weighted total:
- Improvement: 3x weight (the whole point)
- Output value: 2x weight
- Clarity, Data quality, Robustness: 1.5x weight each
- Conventions: 1x weight

### 5. Select and apply the winner

Pick the highest-scoring variation. If scores are very close (within 2 points total), prefer the variation that makes the biggest single improvement rather than small incremental changes.

Write the winning variation to `skills/${var}/SKILL.md`, replacing the original.

### 6. Create a PR

Create a branch named `autoresearch/${var}` and commit the change:
```bash
git checkout -b autoresearch/${var}
git add skills/${var}/SKILL.md
git commit -m "improve(${var}): autoresearch evolution

Variation chosen: [A/B/C/D] — [thesis]
Key changes: [1-2 sentence summary]"
git push -u origin autoresearch/${var}
```

Open a PR with:
- **Title**: `improve(${var}): autoresearch evolution`
- **Body**: Include the full scoring table, the winning variation's thesis, and a diff summary of what changed. Include all 4 variation summaries so the reviewer can see what was considered.

```bash
gh pr create --title "improve(${var}): autoresearch evolution" --body "..."
```

### 7. Notify and log

Send via `./notify`:
```
*Autoresearch — ${var}*
Winner: Variation [X] — [thesis]
Score: [total]/50
Key changes: [summary]
PR: [url]
```

Log to `memory/logs/${today}.md`:
```
### autoresearch
- Target: ${var}
- Winner: Variation [X] ([score]/50)
- Thesis: [description]
- PR: [url]
- Runners-up: [brief scores]
```

## Network note

There is no network sandbox — `curl` works, with **WebFetch** as the fallback for a flaky public GET. For an auth'd API, call `./secretcurl` with a `{ENV_NAME}` placeholder (the key is injected via `requires:`), never a bare `$SECRET`.

## Constraints

- Never downgrade a working skill. If all variations score lower than or equal to the original on "Improvement", skip the update and notify: "No improvement found for ${var} — all variations scored at baseline."
- Preserve the skill's core purpose — evolution, not replacement.
- Do not change the skill's tags or var semantics without strong justification.
- Do not add env vars that aren't already available in the workflow (check aeon.yml secrets).
