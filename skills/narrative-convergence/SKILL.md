---
name: narrative-convergence
description: Cross-skill signal detector - finds entities or themes surfaced independently by 3+ different skill categories within 48h and surfaces them as high-confidence write opportunities
metadata:
  category: core
  var: ""
  tags:
    - content
    - meta
    - intelligence
---
> **${var}** — Optional entity or theme filter (e.g. "Anthropic", "coordination markets"). If empty, scans all skill output categories.

Today is ${today}. Read `memory/MEMORY.md` before starting.

## Voice

If `soul/SOUL.md` and `soul/STYLE.md` exist and are populated, read them and match the operator's voice when drafting the write angles and hook lines (step 5) and the notification. Otherwise use a clear, direct, neutral tone — short, declarative, position-first.

## Why this skill exists

`topic-momentum` surfaces content gaps by scanning the content-discovery pipeline against article history. It works well for pre-tagged narrative categories.

This skill does something different: it detects **emergent cross-skill convergence** — when independent operational skills (security scanners, market trackers, sector pulses, etc.) all surface the same entity, company, protocol, or theme within 48h, without any prior coordination. That kind of convergence is a higher-signal indicator than any single source — it often precedes a breakout narrative. Example: a security skill flags a company's automated-vulnerability work, a social digest catches that same company announcing a major deal, and a market tracker notes a related fraud-prevention win — three independent skills, one entity, in 48h. That bleedthrough is the signal. This skill catches it automatically.

## Config

The signal-category map is **operator-editable** and lives in `memory/topics/signal-categories.md`. If the file doesn't exist, create the seed below and continue. The categories are what let the skill measure *cross-category* diversity (the core of the convergence score) — edit them to match the skills you actually run.

```markdown
# Signal Categories

## Housekeeping (excluded — no external signals)
config-validator, janitor, frequency-guard, heartbeat, memory-flush,
memory-dedupe, skill-health, skill-repair, self-improve,
cost-report, fleet-scorecard, fleet-control, repo-scanner, narrative-convergence

## Signal categories (skill → category)
| Category | Skills |
|----------|--------|
| market | market-context, token-pick, token-movers, rwa-pulse, defi-overview |
| social | tweet-roundup, list-digest, narrative-tracker, remix-tweets, refresh-x |
| ecosystem | github-issues, github-trending, project-lens, builder-map, external-feature, milestone-tracker |
| sector | mcp-pulse, compute-pulse, x402-monitor, agent-displacement, pm-pulse |
| security | vuln-scanner, vuln-tracker, disclosure-tracker, pvr-watchlist, pvr-triage |
| research | paper-pick, article, idea-validator, idea-pipeline |
| opportunity | startup-idea, deal-flow, launch-radar |
```

## Steps

### 1. Identify which outputs to read

List `output/.chains/*.md` with the Glob tool. Exclude the **Housekeeping** skills from `signal-categories.md` — they carry no external signal.

Map each remaining output file to its category using the table in `signal-categories.md`. Any signal skill not listed in the table goes into an `other` category (so newly-added skills still count toward convergence, just without a named lane).

If `${var}` is set, note it as a filter hint but still read all outputs — apply filtering at the scoring step.

### 2. Read each signal skill's output

For each signal skill output file that exists:

1. Read the file (or first 600 chars if large — enough to get entities and theme).
2. Extract: **named entities** (companies, protocols, people, tokens, projects) and **key themes** (e.g. "DNS rebinding", "coordination markets", "compute commoditization").
3. Note the **skill name** and **category**.

Build an entity/theme map:
```
{
  "<Entity>": [{ skill: "vuln-scanner", category: "security" }, { skill: "tweet-roundup", category: "social" }],
  "<theme>": [{ skill: "pm-pulse", category: "sector" }, ...],
  ...
}
```

Also read memory logs from the last 2 days (Glob `memory/logs/*.md`, take the 2 most recent). From each log, extract entities/themes mentioned in specific skill run entries and add them to the map with their source skill. Every skill appends a log entry, so the signal map can be reconstructed from logs alone when `output/.chains/` is sparse.

### 3. Score convergence signals

For each entity or theme, compute a **convergence score**:

| Criterion | Points |
|-----------|--------|
| Mentioned by 5+ independent skills | 10 |
| Mentioned by 4 skills | 7 |
| Mentioned by 3 skills | 5 |
| Mentioned by 2 skills | 2 |
| Spans 3+ distinct categories | +4 |
| Spans 2 distinct categories | +2 |
| All sources from 1 category | −3 |
| Matches a known operator interest (from `soul/SOUL.md`, if present) | +2 |
| Adjacent to operator interest | +1 |

**Minimum to include: 5 points.** Drop everything below.

If `${var}` is set, require the entity/theme to match `${var}` (substring, case-insensitive), or include it only if closely related.

Rank descending by score. Take top 5 (or fewer if <5 clear signals).

### 4. Check against recent article coverage

Glob `output/articles/*.md`, filter to the last 14 days. For each top signal:
- If an article covered this entity/theme in the last 7 days: suppress it (−10, effectively dropping it).
- If covered 8–14 days ago: note "recently covered" as a caveat.

Update the final ranking after suppression. (If no `output/articles/` dir exists, skip this step.)

### 5. Develop write opportunities

For each surviving top signal (minimum 2 signals to notify, else skip):
- State the **convergence story**: "3 independent skills surfaced X in 48h — [skill1] saw Y angle, [skill2] saw Z angle".
- Suggest a **specific write angle** that synthesizes the signals (operator voice if soul files present).
- Draft a **hook line**: short, declarative, position-first.

Example format:
```
<ENTITY> (score 11) — security + social + market
→ vuln-scanner: automated vuln-finding at scale; tweet-roundup: major platform deal; market-context: fraud-prevention win
→ angle: AI-finds-vulns is becoming industrial — not a research project, a service. who charges for it?
→ hook: "the vulnerability bounty economy just got automated"
```

### 6. Update memory

Write `memory/topics/convergence-signals.md` (overwrite if exists):

```markdown
# Convergence Signals — Last Updated: ${today}

## Active Signals (score ≥ 5)

### [Entity/Theme] — Score: N
**Sources (N skills, N categories):** skill1 (category), skill2 (category), ...
**Convergence story:** [what each source noticed, one line each]
**Write angle:** [specific take, not generic]
**Hook:** [suggested opener]
**Last article coverage:** [date or "never"]

[repeat for each signal]

---
*Generated by narrative-convergence on ${today}. Top signal has N source skills across N categories.*
*Consumed by: article skill, topic-momentum.*
```

If no signals meet the threshold: write a minimal file noting the scan ran clean.

### 7. Send notification (only if ≥ 2 strong signals)

If fewer than 2 signals survive after suppression: skip notification. Log `NARRATIVE_CONVERGENCE_SKIP: no strong cross-skill convergence found today`.

Otherwise, write to `.pending-notify-temp/narrative-convergence-${today}.md` (create the dir if needed):

```
narrative convergence — ${today}

N entities surfaced by 3+ independent skills in 48h:

1. [entity/theme] — N skills × N categories — [hook in one line]
2. [entity/theme] — N skills × N categories — [hook in one line]
[up to 5]

these aren't single-source signals. they're bleedthrough.

full breakdown: memory/topics/convergence-signals.md
```

Keep under 900 chars. Run:
```bash
./notify -f .pending-notify-temp/narrative-convergence-${today}.md
```

### 8. Log to memory/logs/${today}.md

Append:
```markdown
## Narrative Convergence
- **Skills scanned:** N
- **Entities/themes mapped:** N
- **Signals above threshold:** N
- **Top signal:** [entity/theme] (score N, N skills, N categories)
- **Notification:** sent / skipped
- NARRATIVE_CONVERGENCE_OK
```

If skipped: `NARRATIVE_CONVERGENCE_SKIP: <reason>`.

## Required Env Vars

None. All reads from local `output/.chains/`, `memory/`, and `output/articles/` dirs.

## Network Note

No network calls required. All data comes from local files written by other skills. If `output/.chains/` is sparse (e.g. first morning run before skills have written), fall back to reading the last 3 memory logs directly — every skill appends a log entry, so the signal map can be reconstructed from logs alone. The only outbound call is `./notify`, which works reliably.
