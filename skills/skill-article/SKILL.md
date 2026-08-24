---
name: skill-article
description: Turn any skill in this instance into a publish-ready launch article - proof-stat headline, one contrarian thesis, mechanics, war stories from real run history, a mental-model reframe, and the full SKILL.md embedded verbatim so readers can steal it. Optional Higgsfield title banner with --banner.
metadata:
  title: Skill Article
  category: basics
  var: ""
  tags:
    - content
    - meta
---

> **${var}** — Selector: `<skill-name> [--brand <handle>] [--banner]`.
>
> - **`<skill-name>`** → announce that skill (must exist under `skills/<skill-name>/`).
> - **empty** → pick the most article-worthy skill from the last 14 days of `memory/logs/`: prefer a skill that shipped recently, produced verified output, or hit a milestone. If nothing qualifies, log `SKILL_ARTICLE_NO_TARGET`, send no notification, and exit clean.
> - **`--brand <handle>`** anywhere → byline/handle for the outreach footer (default: this instance's public identity from `soul/`, else the repo's org).
> - **`--banner`** anywhere → also generate one 16:9 title banner through the Higgsfield MCP (spends credits; see Step 5). Off by default - a blank run never spends.
>
> Examples: `"aeon-update"`, `"rug-scan --brand @myproject --banner"`.

Today is ${today}. Write a launch article for one skill, modeled on the security-industry "skill announcement" format: the article sells the *insight* the skill encodes, not the file - and then gives the file away.

## Shared preamble

1. Read `memory/MEMORY.md` and the last 14 days of `memory/logs/` - know what this skill has actually done.
2. If a `soul/` directory exists, read `soul/SOUL.md` and `soul/STYLE.md` for voice. Default voice: terse, declarative, builder-wrote-this-fast.
3. Read the target's full `skills/<name>/SKILL.md`. Every claim in the article must trace to a line in it.

## Step 1 — Mine the track record (real numbers only)

Hunt for countable proof before writing a word:

- `memory/logs/` entries under the skill's `### <name>` headings: runs, OK/error statuses, notable outcomes.
- `output/` files the skill produced; PRs or issues it opened (`gh pr list --search`).
- `git log -- skills/<name>/` for ship date and iteration history.

A real stat ("84 verified findings", "31 runs, 0 false alarms") becomes the headline. **If no real count exists, the headline uses the mechanism instead.** Never invent a number - a fabricated stat is the one thing that kills this format.

## Step 2 — Find the thesis

Answer: **what does this skill see that the default workflow throws away?** That gap is the thesis.

Write 3 candidate contrast pairs (two-sided sentences like "production code shows what the system does; tests show what its developers thought it did") and keep the sharpest. Everything in the article hangs on this one insight.

## Step 3 — Collect war stories

1-3 concrete moments where the skill caught or produced something a naive approach would miss - pulled from `memory/logs/` and `output/`, anonymized where needed, mechanism kept visible.

If the skill has no run history yet, write "how it plays out" scenarios and **label them as scenarios**. Never dress a hypothetical as a case study.

## Step 4 — Write the article

Structure, in order:

1. **Headline**: `<Skill Name>: <proof stat or mechanism claim>`. Bold claim, not a setup.
2. **Provenance** (2 short paragraphs): what it is, where it runs, ship date, track record if real.
3. **Thesis section** with a punchy heading (a claim, never a label): what everyone else's workflow misses.
4. **Mechanics** (2-4 short paragraphs) built around the contrast pair.
5. **War stories**: one mini-heading per story, 2-4 sentences each, ending with the generalized pattern ("The same blind spot appears when...").
6. **Reframe section**: the mental-model shift the reader keeps even if they never run the skill.
7. **Ship it**: where it lives + one-line CTA (star the upstream repo).
8. **`CODENAME: <Skill Name>`**: the target SKILL.md embedded verbatim in a fenced block (use a 4-backtick fence - skill files contain 3-backtick fences). Do not paraphrase or trim it.
9. **Outreach footer**: 1-2 sentences, DMs-open style, pointing at the brand handle.

## Voice rules (the anti-tells)

- Short declarative sentences. Cut every sentence that only sets up the next one.
- Banned: "revolutionary", "game-changing", "unleash", "delve", "Let's dive in".
- No parallel-structure trios, no "not X, but Y" scaffolding.
- Section headings are claims or scenes ("There is an alpha in the test folder"), never labels ("Overview").
- Verify the repo/link in the CTA exists this run before naming it.
- Never reference private forks or internal accounts - describe this instance generically and point at the upstream/public repo.

## Step 5 — Title banner (only with `--banner`)

Skip this step entirely unless `--banner` was passed. When it was:

1. **Check the connection first.** If no `mcp__higgsfield__*` tool is callable, the banner is skipped, not the article: note `banner: HIGGS_NOT_CONNECTED` for the log, point the operator at the dashboard → MCP → Connect Higgsfield in the notify, and continue to Step 6. Same on 401/stale auth (`banner: HIGGS_AUTH_STALE`) or insufficient credits (`banner: HIGGS_NO_CREDITS`). The article never fails because the banner did.
2. **Build the prompt from the thesis, not the feature list.** The banner is a visual metaphor for the Step 2 contrast pair - the scene that makes the insight visible. Image models garble long text, so the only text allowed in the prompt is the skill's short name (or none); the headline lives in the article, not the pixels. Match `soul/` aesthetic if it defines one; otherwise: clean, high-contrast, one focal object, no collage.
3. **Generate exactly one image**, `--ar 16:9`, following the `higgsfield` skill's spend rules: one generation per run, one retry at most on a transient error, never re-submit a job that already succeeded. Poll to completion with a bounded number of polls; on timeout record `banner: HIGGS_FAILED` and move on.
4. **Capture the asset URL verbatim.** Never fabricate one. Banner asset URLs may be time-limited signed URLs - flag that in the notify so the operator saves it.

Embed the result at the top of the article file, next to the alts block:

```markdown
<!-- banner: <asset-url> · model: <model> · job: <id> -->
```

## Step 6 — Deliver

1. Write the article to `output/skill-articles/${today}-<skill-name>.md` (shell redirection; `mkdir -p` first). Include an `<!-- alts -->` comment block at the top with 2 alternative headline + thesis-heading pairs so the operator can iterate without a rewrite.
2. Notify with `./notify -f /tmp/skill-article-notify.md` (write the body under `/tmp/`): the headline, the thesis in one line, whether the stats are real or the headline fell back to mechanism, the banner URL when one was generated (with a save-it note if the URL is signed/expiring), and a **clickable** link built from the run's environment:

   ```bash
   ARTICLE_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/blob/main/output/skill-articles/<file>.md"
   ```

3. Log to `memory/logs/${today}.md` under a `### skill-article` heading: target skill, headline, thesis pair, stats-real-or-mechanism, output path, and - when `--banner` was passed - a `banner:` line (`HIGGS_OK <url>` | `HIGGS_NOT_CONNECTED` | `HIGGS_AUTH_STALE` | `HIGGS_NO_CREDITS` | `HIGGS_FAILED` | `skipped`). Status codes: `SKILL_ARTICLE_OK` on success, `SKILL_ARTICLE_NO_TARGET` when `${var}` was empty and nothing article-worthy exists, `SKILL_ARTICLE_NOT_FOUND` when the named skill has no `SKILL.md`.

## Limits

- This writes the article; it does not post it. Publishing is the operator's call (or a posting skill's, explicitly chained).
- The banner is opt-in and spends real Higgsfield credits - one image per run, hard cap, and its failure never blocks the article.
- Track-record mining is only as good as `memory/logs/` - a skill that runs but never logs will read as unproven, and the article will say so rather than guess.
- One skill per run. Announcing a pack is a different article; run once per skill instead.
