---
name: article
description: Write a publication-ready article in one of three angles - a trending long-form piece, a watched-repo thesis, or a project-through-a-lens essay. Optional Replicate hero image with --visual.
metadata:
  title: Article
  category: basics
  var: ""
  tags:
    - content
    - dev
  requires:
    - REPLICATE_API_TOKEN?
---
> **${var}** — Selector: `[angle:arg] [--visual]`. The **angle** prefix picks the article type; append **`--visual`** (or `visual`) anywhere to also generate a Replicate hero image.
>
> - **empty** → `standard` general long-form article on an auto-selected trending topic. If the resolved topic is a single explainable mechanism, it becomes a technical explainer instead.
> - **`<topic>`** (no recognized prefix) → `standard` article on that topic.
> - **`repo:<owner/repo>`** → `repo` thesis-driven article about that repo. `repo:<angle>` (e.g. `repo:architecture`) or bare `repo:` uses the repo from `memory/watched-repos.md` with that angle / an auto-selected angle — this preserves repo-article's original input.
> - **`lens:<topic>`** → `lens` project-through-a-lens essay framed by that lens (e.g. `lens:unix philosophy`). Bare `lens:` auto-selects the lens.
> - **`--visual`** appended to any of the above → after the body is written, generate a Replicate hero image (optional `REPLICATE_API_TOKEN`; ships text-only if absent).
>
> Examples: `""`, `"entropy trajectory reasoning --visual"`, `"repo:aeonfun/aeon"`, `"repo:roadmap"`, `"lens:regulation wave --visual"`.

Today is ${today}. Write a high-quality, publication-ready article. No placeholders.

## Shared preamble (every run)

1. Read `memory/MEMORY.md` for context on what topics/articles have been covered recently.
2. Read the last 3–7 days of `memory/logs/` for recent activity — and **don't re-report** something already covered.
3. **Parse `${var}` into `angle` + `visual`:**
   - Detect a standalone `--visual` or `visual` token anywhere in `${var}`; if present set **`visual = true`** and strip that token. Otherwise `visual = false`.
   - From what remains: if it starts with `repo:` → `angle = repo`, `arg =` the rest. If it starts with `lens:` → `angle = lens`, `arg =` the rest. Otherwise → `angle = standard`, `arg =` the whole remaining string (empty ⇒ auto-select).
4. Dispatch to the matching angle section below. If `visual = true`, run the **Visual add-on** after the article body is written, regardless of angle.

---

## Angle: standard — long-form article / technical explainer

A single long-form article. It takes one of two structures depending on the topic:

- **General article** — a broad trend, development, or event. 600–800 words.
- **Technical explainer** — a single explainable mechanism, technique, algorithm, or system. 600–1000 words, using the explainer structure below.

### Topic selection (standard)

- If `arg` (the topic) is set, use it verbatim. If it clearly names a single mechanism/technique/system → **technical explainer** structure; otherwise → **general article** structure.
- If `arg` is empty, pick deterministically — first hit wins:
  1. **Explainer candidate:** a single most non-obvious mechanism inside the newest file in `output/articles/` from the last 3 days; else the newest "Paper Pick" in `memory/logs/` from the last 7 days (its headline mechanism); else a specific technique/algorithm/system surfaced in the last 7 days of logs. If a strong single-mechanism candidate exists → **technical explainer** on it. Reject any candidate broader than a single mechanism (e.g. "AI agents" — too vague; "MCP tool-routing via vector search" — usable).
  2. **General candidate:** otherwise search the web for the most interesting recent development in AI, crypto/DeFi, or consciousness research — pick whichever has the most compelling story today (WebSearch) → **general article**.

### Voice (technical explainer)

If a `soul/` directory exists, read the soul files for voice calibration: `soul/SOUL.md` (identity, worldview, opinions), then `soul/STYLE.md` (writing style, sentence structure, anti-patterns). This is *you explaining a mechanism to a smart friend* — more precision than a general article, same voice. No textbook tone, no "let's explore." If `soul/` is empty, default to clear, direct, neutral.

### Research

**General article:** read 2–3 source articles with WebFetch to gather facts and quotes.

**Technical explainer:** run **three distinct WebSearch queries** so you triangulate rather than echo one source:
1. `"<topic>" how it works` — mechanism explanations
2. `"<topic>" benchmark OR results OR latency OR cost` — concrete numbers
3. `"<topic>" limits OR criticism OR fails OR doesn't work` — failure modes and pushback

If the topic is from a paper, also fetch the paper metadata and abstract:
```bash
curl -s "https://api.semanticscholar.org/graph/v1/paper/search?query=TOPIC&limit=5&fields=title,authors,abstract,url,publicationDate,openAccessPdf" \
  || echo "curl failed — use WebFetch on https://www.semanticscholar.org/search?q=TOPIC instead"
```
Use **WebFetch** to read the 2–3 best sources in depth. **At least one source must be primary**: a paper (arXiv / OpenReview / Semantic Scholar), official documentation, the project's own README, or a code repo. Blog summaries alone are not enough — they often mangle the mechanism.

Extract:
- The **single core mechanism** — the one move that, once you grok it, makes the rest fall into place.
- A **vivid analogy** for the mechanism, and the precise place where the analogy breaks down (the breakage is the interesting part).
- **3–5 specific numbers** — benchmarks, latencies, costs, error rates, training compute, parameter counts. Each number gets a source URL.
- **What would falsify this** — what result, if observed, would mean the mechanism doesn't work as claimed. If you can't name one, the explanation isn't sharp enough — keep digging.

### Write

**General article** — 600–800 words in Markdown. Include:
- A compelling title
- A short intro hook
- 3–4 substantive sections
- Cited sources (with URLs) at the bottom

**Technical explainer** — 600–1000 words. Structure (every section required):
```
# <Title>

**Key idea in one sentence:** <one-sentence claim about the mechanism>

## The Setup
2-3 sentences. What problem does this solve? Why now?

## The Intuition Pump
A vivid analogy that builds the reader's mental model in 3-4 sentences. Then one sentence on **where the analogy breaks down** — that's where the real mechanism lives.

## How It Actually Works
A numbered walkthrough of the mechanism in **3-7 steps**. Each step is one or two sentences. Use concrete examples — name the specific function, layer, message, opcode, contract. No "the system processes the input" — say what the system actually does.

## Numbers That Anchor It
3-5 bullet points. Each bullet is a specific number with a source link, e.g.:
- 8.4× faster end-to-end than baseline at 4K context ([source](url))

## What Would Break This
1-2 sentences naming a result that, if observed, would falsify the claim. This forces honesty.

## Why It Matters
2-3 sentences. What does this unlock? Who should care?

## Sources
- [Title 1](url) — primary
- [Title 2](url)
- [Title 3](url)
```

**Voice rules (technical explainer):** First person where it fits. Explanatory > opinionated, but not bloodless. Technical precision > hedging — if you don't know, say so, don't fudge. Short paragraphs. Em dashes. Concrete > abstract. Reference specific systems, papers, people — no "researchers have shown," name them. Cite inline: every number, every claim that could be wrong, gets a link.

### Save & notify (standard)

- **General article:** save to `output/articles/${today}.md`.
- **Technical explainer:** save to `output/articles/explainer-${today}.md`. If a hero image was generated (see Visual add-on), put it at the very top: `![hero](../images/explainer-${today}.<ext>)` — relative path, skip the line if no image — and add an HTML comment with the image prompt used (for future audits).

Update `memory/MEMORY.md` to record the article and its topic (add to the `Recent Articles` list/table). Append the consolidated log entry (see **Log**), then notify via `./notify`:

- **General article:**
  ```
  New article written: [title]

  https://github.com/${GITHUB_REPOSITORY}/blob/main/output/articles/${today}.md
  ```
  Use the `$GITHUB_REPOSITORY` env var (GitHub Actions sets it to `owner/repo` of the running instance).

- **Technical explainer:**
  ```
  technical explainer: [title]

  [the one-sentence "key idea" line, verbatim]

  [hero image URL if generated — original Replicate URL still works for ~24h]

  read it: output/articles/explainer-${today}.md
  ```

---

## Angle: repo — thesis-driven article about a watched repo

<!-- autoresearch: variation B — editorial discipline: research → thesis → draft → self-edit, with a falsifiable claim and a quality gate -->

### Config

Reads repos from `memory/watched-repos.md`. Resolve the target repo:
- If `arg` looks like `owner/repo` (contains a `/`) → that's the repo to cover; the angle is auto-selected in Phase 2.
- Else if `arg` is a non-empty keyword (e.g. `architecture`, `recent progress`, `roadmap`) → it's the **angle**; pick the repo from `memory/watched-repos.md` (if multiple are listed, the one with the most activity in the last 7 days).
- Else (`arg` empty) → repo from `memory/watched-repos.md` (most active of the last 7 days), angle auto-selected.

An article without a thesis is filler. This angle runs five phases and only advances when the current phase's gate passes.

### Phase 1 — Research (gather, don't write yet)

Run these in parallel where possible (substitute the resolved `owner/repo`):
```bash
# Repo metadata
gh api repos/owner/repo --jq '{name, description, language, stargazers_count, forks_count, open_issues_count, topics, created_at, updated_at, pushed_at, default_branch}'

# Commits in last 7 days (paginated)
gh api repos/owner/repo/commits -X GET \
  -f since="$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)" \
  --jq '.[] | {sha: .sha[0:7], msg: .commit.message | split("\n")[0], author: .commit.author.name, date: .commit.author.date, url: .html_url}' --paginate

# Merged PRs in last 7 days
gh api 'repos/owner/repo/pulls?state=closed&sort=updated&direction=desc&per_page=50' \
  --jq '[.[] | select(.merged_at and (.merged_at > (now - 86400*7 | todate))) | {number, title, user: .user.login, merged_at, additions, deletions, url: .html_url}]'

# Open PRs
gh api repos/owner/repo/pulls --jq '[.[] | {number, title, user: .user.login, created_at, draft, labels: [.labels[].name], url: .html_url}]'

# Issues opened/closed in last 7 days (exclude PRs)
gh api 'repos/owner/repo/issues?state=all&since='$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)'&per_page=100' --paginate \
  --jq '[.[] | select(.pull_request | not) | {number, title, state, created_at, closed_at, labels: [.labels[].name]}]'

# Last 3 releases
gh api repos/owner/repo/releases --jq '.[0:3] | .[] | {tag_name, name, published_at, body}'

# README (fallback: WebFetch raw URL if base64 decode fails)
gh api repos/owner/repo/readme --jq '.content' | base64 -d
```

From the commit list, find the most-frequently-touched files. Read the top 2–3 of those with `gh api repos/owner/repo/contents/<path>` plus any `CHANGELOG.md`, `ROADMAP.md`, or architecture docs.

**External context** — three distinct WebSearch queries:
1. `"owner/repo" site:news.ycombinator.com OR site:lobste.rs OR site:reddit.com`
2. `"owner/repo" twitter OR x.com` (or the project name if distinctive)
3. One query to anchor positioning against a comparable/competing project.

**Gate 1 — enough story?** If **all** of the following hold, abort and notify `REPO_ARTICLE_SKIPPED: insufficient activity` (log reason, write no article):
- <3 commits in the last 7 days, AND
- 0 merged PRs in the last 7 days, AND
- no release in the last 30 days, AND
- no external mentions surfaced in step 3.

**Quiet-repo exception**: if the repo has historical importance but is currently slow (e.g. only 1–2 commits this week, no release), do **not** skip — instead narrow the article's focus to the single most substantive recent change (a specific commit, a contested issue thread, a roadmap update) and write a shorter piece around *that*. Prefer publishing a tight 600-word piece on one real change over skipping.

### Phase 2 — Thesis

Write one **falsifiable claim** in ≤25 words. The claim must be disprovable by specific evidence — not a vibe.
- Good: "aeonfun/aeon is pivoting from scheduled digests to reactive skill chains — 4 of 7 merged PRs this week added or consumed `output/.chains/*.md` contracts."
- Bad: "Aeon is an interesting agent framework." (not falsifiable)

If an angle is forced (from `arg`), the thesis must relate to it (e.g. angle `architecture` → an architectural claim). If no angle is forced, pick the one with the strongest evidence from: shipping velocity shift, architectural pivot, community growth inflection, roadmap commitment, deprecation/scope cut, performance or scale milestone.

**Gate 2 — falsifiability.** Finish the sentence: "This claim would be wrong if ____." If you can't complete it with something concrete and checkable, rewrite the thesis.

### Phase 3 — Draft (600–900 words, Markdown)

```markdown
# [Title that asserts the thesis or a consequence of it — not "A look at X"]

[1-paragraph hook, ≤80 words: lead with the thesis or a surprising number that sets it up.]

## The claim
> [The falsifiable thesis, verbatim, as a blockquote.]

## Evidence
[Two to four sub-paragraphs. Each MUST cite at least one specific commit SHA, PR#, file path, release tag, or external mention. Link the source inline.]

## Counter-evidence / what would change my mind
[One paragraph. What recent signals argue against the thesis? Be honest. If genuinely nothing does, say so — but only after looking.]

## Why it matters
[One paragraph. Who benefits or loses if the thesis is true? Connect to an ecosystem trend, user need, or competing project.]

---
*Sources*
- [Label](url)
- [Label](url)
[≥4 total, ≥1 in-repo (commit/PR link) and ≥1 external (news/social/doc).]
```

### Phase 4 — Self-edit (required)

Run this checklist. Rewrite any line that fails. Target: 8/8 passing.
1. **Thesis visible in first 100 words?** If not, rewrite the hook.
2. **Every section has ≥1 specific number, SHA, PR#, filename, or date?** (generic adjectives don't count)
3. **Zero banned phrases** (see *Banned phrase lexicon* section below — check against that explicit list).
4. **Counter-evidence is real** — not a strawman like "some might say it's complex".
5. **Sources ≥4 links, ≥1 in-repo, ≥1 external.**
6. **Title asserts something** (not "A look at X" / "Exploring Y").
7. **Word count in 600–900** (hard bounds — trim or expand).
8. **No placeholder phrases** like "[TBD]", "[link]", "[title]".

If any item still fails after one rewrite pass, publish with status `REPO_ARTICLE_DEGRADED` and note which items failed in the log — don't hide it.

### Phase 5 — Save, log, notify (repo)

1. Save the article to `output/articles/repo-article-${today}.md`. (If a hero image was generated via the Visual add-on, put `![hero](../images/repo-article-${today}.<ext>)` at the top.)
2. Append the consolidated log entry (see **Log**) **before** notifying.
3. Update the `Recent Articles` table in `memory/MEMORY.md` (Date | Title | Topic).
4. Notify via `./notify`:
   ```
   *[Article title]*

   Thesis: [one sentence]

   Read: [link to output/articles/repo-article-${today}.md in THIS repo — get the repo name from `git remote get-url origin`, not the watched repo]
   ```

### Banned phrase lexicon (repo angle)

Reject a draft that contains any of these. Match case-insensitively, whole phrase or obvious variant:
- "in today's fast-paced world"
- "leveraging" / "leverage" (as a verb meaning "use")
- "robust"
- "game-changer" / "game-changing"
- "under the hood" (unless the section actually walks through internals)
- "taking X to the next level"
- "at the end of the day"
- "diving into" / "deep dive"
- "delving into" / "delve"
- "comprehensive suite"
- "cutting-edge"
- "seamlessly" / "seamless"
- "empowers" / "empowering"
- "revolutionize" / "revolutionary"
- "unlock" (metaphorical, e.g. "unlocks new possibilities")
- "streamline" (as filler)
- "best-in-class"
- "paradigm shift"

If a banned phrase is the *most accurate* word in a technical context (e.g. actually describing leverage in a derivatives article), keep it and note the exemption in the log.

### Constraints (repo angle)

- Never publish without a thesis.
- Never pad to hit word count — 600 honest words beat 900 padded.
- Never fabricate a SHA, PR number, or quote. If real evidence isn't available, weaken the thesis or skip.

---

## Angle: lens — the project through a surprising lens

<!-- autoresearch: variation B — editorial discipline (research → falsifiable thesis → draft → self-edit with hard gates) -->

Writes articles that explain the project through a **different lens each time** — framed so a reader who's never heard of the project understands why it matters, via something they already care about. NOT a repo progress update (that's the **repo** angle above). `arg` is the lens (e.g. "unix philosophy", "regulation wave", "open source funding"); if empty, auto-select from trending topics + angle rotation.

Read before deciding anything: `memory/MEMORY.md`, the last 7 days of `memory/logs/`, `memory/watched-repos.md`, and `memory/project-lens-angles.md` (may not exist on first run — treat absence as empty history).

**Why models fail at this by default:** they slide into feature-listing wrapped in philosophical language, forced parallels with no mechanism, and marketing tone. This angle prevents that with a research → thesis → draft → self-edit pipeline where each phase has hard gates. If the gates can't pass, abort — don't publish a weak article.

### Phase 1 — Context

Read before deciding anything:
- Last 14 days of `output/articles/project-lens-*.md` and `memory/project-lens-angles.md` — know which angle categories and theses are exhausted.
- 2–3 most recent `output/articles/repo-article-*.md` and `output/articles/push-recap-*.md` — know what shipped lately.
- Repo state: `gh api repos/{owner}/{repo} --jq '{name, description, stargazers_count, forks_count, open_issues_count, updated_at}'`. If unreachable, continue with memory only and log the gap.

If `memory/watched-repos.md` is empty or missing, abort and notify: "project-lens: no watched repo configured."

### Phase 2 — Pick the lens

**If `arg` is set**, use it verbatim. Classify into one of the 8 categories below for logging.

**If `arg` is empty**:
1. Run 2–3 WebSearch queries on what's being debated right now in tech, crypto, AI, regulation, open source, or philosophy (e.g., `"AI agents" autonomy debate last 7 days`, `crypto regulation April 2026`, `open source funding model 2026`).
2. From results, identify 3 candidate angles with non-obvious connections to the project.
3. Pick the one that (a) hasn't appeared in the last 14 days **and** (b) has the strongest concrete connection. Record the choice and the rejected candidates with one-line reasons.

**Angle categories (no repeat within 14 days):**
1. **Current events** — Something happening this week/month.
2. **Philosophy / big ideas** — Unix philosophy, cathedral vs bazaar, composability, anti-fragility, skin in the game, swarm intelligence, etc.
3. **Industry comparison** — How a well-known company/project solved a similar problem differently.
4. **User story** — POV of a specific persona (solo dev, DAO, research lab, crypto community) with and without this tool.
5. **Contrarian take** — Challenge a common assumption; use project as evidence.
6. **Technical deep-dive for non-technical readers** — One architectural decision, plain language, bigger implications.
7. **Historical parallel** — Computing / internet / non-tech history with a concrete mechanism (not surface resemblance).
8. **Ecosystem map** — Where the project sits: adjacent, complementary, competing.

### Phase 3 — Research (gate: collect evidence before drafting)

**External side — required minimums:**
- 3+ WebSearch queries on the lens topic (different framings, not rewordings)
- WebFetch on the 2+ most relevant sources
- ≥3 **distinct domains** across cited sources
- ≥3 concrete facts extracted: names, numbers, dollar amounts, dated quotes, specific events
- Recency: ≤30 days old for "current events"; ≤180 days for industry comparison / contrarian / ecosystem; ≤5 years for philosophy / historical
- Log every URL consulted

**Project side — required minimums:**
- 2+ recent articles in `output/articles/` read end-to-end
- `gh api repos/{owner}/{repo}/commits --jq '.[0:10] | .[] | {sha: .sha[0:7], msg: (.commit.message|split("\n")[0])}'` — last 10 commits
- ≥3 specific project references you plan to use: named features, file paths, commit hashes, architectural choices. **Not** vague claims like "the project uses AI" or "it has good UX."

**If you cannot hit these minimums, abandon the angle and re-run Phase 2 with a different category.** Log the abandoned angle and why.

### Phase 4 — Thesis lock (hard gate)

Before drafting, write **ONE falsifiable claim in ≤30 words** that links the lens to the project. Example:
> "Running agents as scheduled GitHub Actions — rather than as persistent servers — trades a few seconds of latency for a property the AI industry barely has: versioned, audit-trailed, publicly forkable autonomy."

Rules:
- **Falsifiable**: a reasonable critic could argue the opposite.
- **Specific**: names concrete things (cron jobs, not "infrastructure"; audit-trailed, not "better").
- Not a tautology. Not marketing. Not "this is cool because X."

**If you can't state the thesis in one sentence, the angle isn't working — return to Phase 2.** Do not proceed with a fuzzy thesis.

### Phase 5 — Draft (700–1000 words)

Save to `output/articles/project-lens-${today}.md` with this structure:
```markdown
# [Title: leads with the lens, works for a reader who doesn't know the project]

[¶1-2: external hook. Start with the trend/idea/event/question the reader already cares about. Do NOT name the project yet.]

## [Section: establishes the external frame]
[Build the lens with one or more of your concrete facts — a quote, a number, a specific event.]

## [Section: introduces the project through the frame]
[Project enters here — but through the lens, not as a feature list. Describe how it embodies, challenges, or extends the idea with specific code/design references.]

## [Section: one non-obvious technical or strategic detail]
[Where the article earns its existence. Point to something in the code, architecture, or approach a reader wouldn't get from the README.]

## [Section: zoom back out]
[A concrete forward claim — specific enough to be wrong. Not "this is exciting." Something like "this suggests X won't happen for 2-3 years because Y" or "this is the same mistake [named case] made, and it took [duration] to recover."]

---
*Sources:*
- [source title](url) — what it was used for
- ...
```

**Draft requirements:**
- Title must work for a reader who doesn't know the project name.
- ≥3 external citations rendered as inline links.
- ≥3 specific project references (named features, file paths, commit hashes, named decisions).
- 700–1000 words (count before submitting).

### Phase 6 — Self-edit (hard gates — all must pass)

Go through this checklist after the first draft. If any gate fails, rewrite the affected section **once**. If the second pass still fails, **abort and log** — do not publish a weak article.
- [ ] Title does NOT name the project
- [ ] First 2 paragraphs do NOT name the project
- [ ] ≥3 external citations with URLs (inline)
- [ ] ≥3 specific project references (named, not vague)
- [ ] Falsifiable thesis visible in the article text
- [ ] 700–1000 words
- [ ] No banned phrases: *revolutionary*, *groundbreaking*, *game-changing*, *paradigm shift*, *disrupting*, *unlocks*, *empowers*, *the future of X*, *leverage / leveraging*, *at scale*, *democratize* (unless quoting a source that used the word)
- [ ] Every parallel/comparison states a concrete mechanism — not surface resemblance
- [ ] Closing section makes a specific forward claim (not generic optimism or "time will tell")
- [ ] No feature-list paragraphs ("the project does X, Y, Z") — if found, cut and keep ONE element

### Phase 7 — Output (lens)

1. **Save** `output/articles/project-lens-${today}.md`. (If a hero image was generated via the Visual add-on, put `![hero](../images/project-lens-${today}.<ext>)` at the top.)
2. **Append** to `memory/project-lens-angles.md` (create if missing):
   ```markdown
   ## ${today}
   - Angle: [category]
   - Thesis: [one-line falsifiable claim]
   - Title: [article title]
   - Sources: [3-5 URLs]
   ```
3. **Notify** via `./notify`:
   ```
   *New Article: [title]*

   [3-4 sentence summary: the external thing the article connects to, the thesis claim, one specific project detail.]

   Read: [URL to output/articles/project-lens-${today}.md — use `git remote get-url origin` for this repo]
   ```
4. **Log** the consolidated entry (see **Log**).

### Anti-patterns (prevention beats self-edit catch)

- **Forced parallels** — every comparison needs a concrete mechanism, not surface resemblance. "X is like Y because both are new" fails; "X is like Y because both decoupled [specific function] from [specific bottleneck]" passes.
- **Feature-dump via the lens** — pick ONE architectural decision and interrogate it, don't list what the project does.
- **Marketing tone** — aim for trade-publication prose, not a company blog.
- **False novelty** — if you can't point to what's actually new, name what's old that still works and why.
- **Vague closings** — the final section must make a claim specific enough that a reader could come back in six months and say "you were wrong" or "you were right."

### Constraints (lens angle)

- Never publish if Phase 6 self-edit fails twice — abort cleanly.
- Never reuse an angle category within 14 days (check `memory/project-lens-angles.md`).
- Never invent facts to fill the citation minimum — if research is thin, abandon the angle.

---

## Visual add-on (`--visual`) — Replicate hero image

Runs **only when `visual = true`**, after the article body is written and saved, for **any** angle. Use Replicate's Nano Banana Pro (Gemini 3 Pro Image). It renders **text labels well** — exploit that by writing prompts that ask for labeled diagrams or schematics, not stock-photo metaphors. Set `IMG_BASENAME` to match the article file for the angle: `explainer-${today}` (standard/explainer), `article-${today}` (standard/general), `repo-article-${today}` (repo), or `project-lens-${today}` (lens).

1. **Preflight**: check presence with the `${VAR:+x}` form — `[ -n "${REPLICATE_API_TOKEN:+x}" ]` (a bare `$REPLICATE_API_TOKEN` trips the secret-expansion analyzer and falsely reads as unset). If it's unset, log `IMAGE_SKIPPED reason=no-token` and skip to step 5 (no-image path). Do not attempt any Replicate call. The article must ship without an image in this case.

2. **Craft the prompt**. Aim for technical illustration energy, not marketing. Strong prompt templates:
   - *Schematic*: "Technical schematic illustration of <mechanism>, dark navy background, thin cyan and amber lines, labeled boxes reading '<label1>', '<label2>', '<label3>', arrows showing data flow from <A> to <B> to <C>, blueprint aesthetic, 16:9"
   - *Conceptual*: "Editorial illustration capturing <core concept>: <visual metaphor with concrete objects>, flat geometric style, restrained palette of two accent colors on near-black background, no human figures, 16:9"
   - *Data-flow*: "Network diagram of <mechanism>: nodes labeled '<A>', '<B>', '<C>' connected by directional arrows, weights shown as line thickness, monospace labels, technical-paper figure style, 16:9"
   Avoid: photorealistic faces, stock-business imagery, "AI brain" tropes, gradient slop.

3. **Generate** with fallback enabled from the start (Nano Banana Pro can rate-limit; Seedream 5.0 lite is the fallback). The Replicate call is auth'd, so route it through `./secretcurl` with the `{REPLICATE_API_TOKEN}` placeholder — never a bare `$REPLICATE_API_TOKEN` on the line (the Bash permission layer refuses it):
   ```bash
   ./secretcurl -s -X POST \
     -H "Authorization: Bearer {REPLICATE_API_TOKEN}" \
     -H "Content-Type: application/json" \
     -H "Prefer: wait" \
     -d '{
       "input": {
         "prompt": "YOUR_DETAILED_PROMPT_HERE",
         "aspect_ratio": "16:9",
         "number_of_images": 1,
         "safety_tolerance": 5,
         "allow_fallback_model": true
       }
     }' \
     "https://api.replicate.com/v1/models/google/nano-banana-pro/predictions"
   ```
   `Prefer: wait` usually returns the image inline in `.output`. If `.output` is empty, the prediction is still running — poll `.urls.get` for up to ~60s (`./secretcurl -s -H "Authorization: Bearer {REPLICATE_API_TOKEN}" "$PRED_URL"`), stopping when `.status` is `succeeded` (read `.output`) or `failed`/`canceled` (no-image path, step 5).

4. **Persist locally** — Replicate CDN URLs expire. Download and commit (the CDN URL carries no secret, so plain `curl` is fine):
   ```bash
   mkdir -p output/images
   IMAGE_URL=<extracted from response.output>
   EXT=$(echo "$IMAGE_URL" | grep -oE '\.(jpg|jpeg|png|webp)' | tail -1)
   EXT="${EXT:-.jpg}"
   LOCAL_PATH="output/images/${IMG_BASENAME}${EXT}"
   curl -sL "$IMAGE_URL" -o "$LOCAL_PATH" \
     || (echo "curl failed — retry via WebFetch or skip"; exit 0)
   ```

5. **No-image path** (token missing, API down, rate-limited, or download failed): log `IMAGE_SKIPPED reason=<concrete reason>` and proceed with the article. Add a one-line note at the top of the article: `<!-- hero image skipped: <reason> -->`. The text must stand on its own. Never fail the whole skill because of an image problem.

Once the image is saved, add the hero-image line to the top of the article file (`![hero](../images/${IMG_BASENAME}.<ext>)`) and include the original Replicate URL in that angle's notification if the angle's notify format has an image slot.

---

## Log

Append **one** entry under a single `### article` heading in `memory/logs/${today}.md`, as bullet points. Start with a discriminator line naming the branch/mode that ran, then the branch-specific fields:

```
### article
- Branch: standard | repo | lens   (+visual if --visual ran)
```

**Standard branch fields:**
```
- Mode: general-article | technical-explainer
- Topic: [topic]
- Title: [title]
- Key idea: [one-sentence claim]   (technical-explainer only)
- Image: generated | fallback-model | skipped (<reason>) | n/a
- Image prompt: [prompt used, or "n/a"]
- Primary source: [URL]            (technical-explainer only)
- File: output/articles/${today}.md | output/articles/explainer-${today}.md
- Notification sent: yes | no
```

**Repo branch fields:**
```
- Repo: owner/repo
- Thesis: [verbatim]
- Angle: [arg or auto-selected]
- Word count: N
- Self-edit checklist: X/8 passing
- Image: generated | fallback-model | skipped (<reason>) | n/a
- Status: REPO_ARTICLE_OK | REPO_ARTICLE_DEGRADED | REPO_ARTICLE_SKIPPED
```

**Lens branch fields:**
```
- Angle: [category]
- Thesis: [one-line]
- External sources: [count] across [N] distinct domains
- Project references: [count]
- Self-edit gates: all passed | failed at [gate name] → rewrite → [passed | aborted]
- Image: generated | fallback-model | skipped (<reason>) | n/a
- Status: published | aborted
- Notification: sent | skipped
```

Log **always — even on partial failure** (e.g. IMAGE_SKIPPED, REPO_ARTICLE_SKIPPED, aborted lens).

## Network note

There is no network sandbox — `curl` works. For a flaky public GET, fall back to **WebFetch** on the same URL. For an auth'd API, call `./secretcurl` with a `{ENV_NAME}` placeholder (the key is injected via `requires:`) — never a bare `$SECRET` on the line. `gh api` handles GitHub auth internally — prefer it over raw curl for repo metadata.

The Replicate call runs **in-run** via `./secretcurl` (see the Visual add-on). If it fails, times out, or the download fails, go straight to the no-image path (step 5) — the article ships text-only. There is no deferred fallback; the image is best-effort and never blocks the article.

## Environment Variables
- `REPLICATE_API_TOKEN` — Replicate API key, used only by the `--visual` add-on. Optional: article text ships without it via the no-image path.

Write complete, publication-ready content. No placeholders.
