---
name: Write Tweet
description: Generate 10 tweet drafts across 5 size tiers (2 variations each) on a topic from today's outputs
var: ""
---
> **${var}** — Topic or URL to write about (e.g. "prediction markets are broken", "https://arxiv.org/..."). If empty, auto-selects the most tweetable insight from today's logs.

Read `memory/MEMORY.md` for context on recent articles, digests, and topics being tracked.
Read the last 3 days of `memory/logs/` to understand what's been covered and avoid repeating takes.

## Topic Selection

If `${var}` is set, use that as the topic (it may be a keyword, a thesis, or a URL).

Otherwise, read today's `memory/logs/${today}.md` and pick the **single most tweetable insight**. Prioritize:
1. A take from today's article (already researched and opinionated)
2. A surprising connection between two of today's findings
3. A reaction to something from a tweet roundup or digest

If the topic needs fresher context, use WebSearch to verify or expand.

If `XAI_API_KEY` is set, search X for what people are already saying about the topic:
```bash
curl -s -X POST "https://api.x.ai/v1/responses" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-4-1-fast",
    "input": [{"role": "user", "content": "Search X for what people are saying about TOPIC in the last 24 hours. Return the 5 most notable tweets with @handle and summary."}],
    "tools": [{"type": "x_search"}]
  }'
```
This helps understand the existing conversation so you can add signal, not noise.

## Voice

If soul files exist (`soul/SOUL.md`, `soul/STYLE.md`, `soul/examples/`), read them and match the owner's voice exactly.

If no soul files exist, write in a clear, direct, opinionated style:
- Short sentences. No hedging. No corporate voice.
- State the opinion first, reasoning after (if any).
- Reference specifics — names, projects, numbers — not vague hand-waving.
- No hashtags. No emojis. No "RT if you agree." No self-referential meta.

## Writing

Generate **10 drafts** — 5 size tiers with **2 variations each**. The two variations within a tier should take genuinely different angles (different framing, emphasis, mood) — not minor rewrites.

### Size tiers

**Tier 1 — One-liner** (~50–100 chars)
Single punchy sentence. Maximum compression — every word load-bearing.

**Tier 2 — Two-punch** (~100–180 chars)
Two sentences. First sets up, second lands the hit. Claim then evidence, or observation then implication.

**Tier 3 — Paragraph** (~180–280 chars)
A full thought in one tweet. Three to four sentences. Context, position, kicker.

**Tier 4 — Long tweet** (~280–600 chars)
Uses X's extended tweet length. A mini-essay with setup, turn, and conclusion. Grounded with a specific example or data point.

**Tier 5 — Thread opener** (first tweet under 280 chars + thread sketch)
First tweet hooks — sets up a thesis. Below the tweet, include a `---` separator and a 3–5 bullet sketch of where the thread goes (key beats, not full text).

### Approach styles (mix these across variations)
- **Hot take** — opinionated position stated directly
- **Observation** — pattern-match most people aren't seeing
- **Sardonic/ironic** — dry humor
- **Reframe** — question the premise of the mainstream take
- **Data drop** — lead with a specific number or fact, then the take
- **Narrative** — tiny story or anecdote that makes the point
- **Question** — a genuine question that reframes thinking

Each tier's two variations should use **different** approach styles.

### Constraints
- Tier 1–3: hard 280-character limit per tweet.
- Tier 4: up to 600 characters (X long tweet).
- Tier 5: first tweet under 280, thread sketch is bullet points only.
- No hashtags. No emojis. No "RT if you agree."
- No self-referential meta ("hot take:" or "unpopular opinion:").
- Count characters carefully.

## Output Format

```
## Tweet Drafts: [topic]

### Tier 1 — One-liner
**1a. [style]**
> [tweet text]

**1b. [style]**
> [tweet text]

### Tier 2 — Two-punch
**2a. [style]**
> [tweet text]

**2b. [style]**
> [tweet text]

### Tier 3 — Paragraph
**3a. [style]**
> [tweet text]

**3b. [style]**
> [tweet text]

### Tier 4 — Long tweet
**4a. [style]**
> [tweet text]

**4b. [style]**
> [tweet text]

### Tier 5 — Thread opener
**5a. [style]**
> [tweet text]
---
- [beat 1]
- [beat 2]
- [beat 3]

**5b. [style]**
> [tweet text]
---
- [beat 1]
- [beat 2]
- [beat 3]
```

After all 10, add a one-line pick for **best overall** and **best per tier**.

## Notify

Send the drafts via `./notify`:
```
tweet drafts: [topic]

— one-liner —
1a. [tweet text]
1b. [tweet text]

— two-punch —
2a. [tweet text]
2b. [tweet text]

— paragraph —
3a. [tweet text]
3b. [tweet text]

— long tweet —
4a. [tweet text]
4b. [tweet text]

— thread opener —
5a. [tweet text]
5b. [tweet text]

best: #[n] — [reason]
```

## Log

Append to `memory/logs/${today}.md`:
```
## Write Tweet
- **Topic:** [topic]
- **Drafts:** 10 generated (5 tiers x 2 variations)
- **Best overall:** #[n] — [style] / [tier]
- **Notification sent:** yes
```
