---
name: [REPLACE: SKILL_NAME]
description: Mention/keyword sweep on social platforms for [REPLACE: KEYWORDS] — trends, sentiment, top posts
metadata:
  category: social
  var: ""
  tags:
    - social
  requires:
    - XAI_API_KEY?
---

> **${var}** — Optional. Pass alternative keywords (comma-separated) to override the default. If empty, monitors `[REPLACE: KEYWORDS]`.

Today is ${today}. Monitor social mentions of **[REPLACE: KEYWORDS]** and produce a summary.

## Steps

1. **Resolve keywords** — `KEYWORDS="${var:-[REPLACE: KEYWORDS]}"`. Split on commas, trim each, lower-case. Each token becomes its own search query.

2. **Search X** — for each keyword, use the X / xAI search path (project's standard pattern):

   ```bash
   # Uses XAI_API_KEY in-run via ./secretcurl (the key is injected via requires:).
   # Mirror the fetch-tweets skill: POST https://api.x.ai/v1/responses with
   #   ./secretcurl -H "Authorization: Bearer {XAI_API_KEY}" -d @/tmp/payload.json
   # WebFetch (or a Nitter mirror) is the last-resort fallback.
   ```

   Restrict to language `[REPLACE: LANGUAGE]` (e.g. `en`, `fr`, `any`). Drop posts with fewer than `[REPLACE: MIN_LIKES]` likes — that filter is what protects the channel from low-signal noise.

3. **Search Reddit** — for each keyword:

   ```bash
   # Reddit's keyless JSON endpoint. WebFetch fallback if curl fails (sandbox).
   curl -sf "https://www.reddit.com/search.json?q=$KEYWORD&t=day&restrict_sr=0" \
     -H "User-Agent: aeon/1.0" > .reddit-cache.json || \
     echo "use WebFetch on https://www.reddit.com/search.json?q=$KEYWORD&t=day"
   ```

4. **Score and pick top 5 per platform** — score on engagement (likes, comments, score) × recency (last 24h gets full marks). Drop reposts and obvious bot accounts (handles like `*_bot`, account age < 7 days with > 100 posts).

5. **Tag sentiment** — for the top 10 posts overall, label each `positive` / `neutral` / `negative` based on tone of the post text. Keep this lightweight — one-token classification, no nested reasoning.

6. **Write `output/articles/[REPLACE: SKILL_NAME]-${today}.md`**:
   ```markdown
   # [REPLACE: KEYWORDS] — ${today}

   ## Volume
   - X: N posts (vs 7d avg M)
   - Reddit: N posts (vs 7d avg M)

   ## Sentiment
   positive: X · neutral: Y · negative: Z

   ## Top posts
   1. [Author · platform · timestamp]
      "Excerpt or paraphrase."
      → URL

   2. ...
   ```

7. **Notify** via `./notify` with a 2-3 line summary: `*[REPLACE: KEYWORDS] — ${today}* · N posts · sentiment skews positive/negative · top: <one-line title>. Full digest: <url>`. Silent on quiet days (volume < 25% of 7d average AND no negative-sentiment spike).

8. **Log** to `memory/logs/${today}.md`:
   ```
   ## [REPLACE: SKILL_NAME]
   - **Volume**: x_posts=N, reddit_posts=N, vs_7d_avg=Δ%
   - **Sentiment**: pos=X, neu=Y, neg=Z
   - **Status**: SOCIAL_OK | SOCIAL_QUIET | SOCIAL_SPIKE (vol > 2x avg) | SOCIAL_DEGRADED
   ```

## Network note

X / xAI requires `XAI_API_KEY`; a bare `$XAI_API_KEY` on a `curl` line is refused by the Bash analyzer, so call `./secretcurl` with the `{XAI_API_KEY}` placeholder (the key is injected via `requires:`). Reddit's JSON endpoint is keyless but rate-limited per IP — `WebFetch` is the fallback when `curl` returns 429.

## Constraints

- **Bot filter** is critical. New accounts with high posting velocity dominate any keyword and are almost always inauthentic. Strict drop.
- **Volume is more honest than sentiment**. A `SPIKE` (volume > 2x 7d avg) is a real signal; sentiment shifts within normal volume often aren't.
- **Engagement filters scale**. `MIN_LIKES = [REPLACE: MIN_LIKES]` is a starting threshold — raise it as the topic gains attention so noise stays out.
