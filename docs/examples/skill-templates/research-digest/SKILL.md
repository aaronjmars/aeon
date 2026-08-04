---
name: [REPLACE: SKILL_NAME]
description: Digest of the most interesting new posts on [REPLACE: TOPIC] from RSS feeds and the open web
metadata:
  category: research
  var: ""
  tags:
    - research
---

> **${var}** — Optional. Pass a different topic to override the default. If empty, digests [REPLACE: TOPIC].

Today is ${today}. Build a digest of the [REPLACE: MAX_ITEMS] most interesting new posts on **[REPLACE: TOPIC]**.

## Steps

1. **Read sources** — pull the last 24h of entries from each feed:

   ```text
   [REPLACE: FEED_URLS]
   ```

   (Comma- or newline-separated list of RSS/Atom URLs.)

   Use **WebFetch** to retrieve each feed and parse the entries. If a feed 404s or returns malformed XML, log a single warning line and skip that feed for this run.

2. **Augment with web search** — run a `WebSearch` for `[REPLACE: TOPIC] latest` and pick up to 5 fresh links published in the last 24h that aren't already in the feed results.

3. **Score and rank** — for each candidate, score on:
   - **Recency** — within the last 24h gets full marks.
   - **Source weight** — feeds in the configured list outrank generic search results.
   - **Specificity** — items mentioning concrete numbers, code, or named systems beat opinion pieces.

   Drop anything obviously off-topic (the `${var}` or `[REPLACE: TOPIC]` keyword should appear somewhere in title or summary).

4. **Pick the top [REPLACE: MAX_ITEMS]** — write `output/articles/[REPLACE: SKILL_NAME]-${today}.md` with one entry each:
   ```markdown
   ### [Title](url)
   *[Source · published date]*
   2-3 sentences distilling the takeaway. No filler.
   ```

5. **Notify** via `./notify` with:
   ```
   *[REPLACE: TOPIC] digest — ${today}*

   [N] picks. Top item: [shortened title].

   Full digest: https://github.com/${GITHUB_REPOSITORY}/blob/main/output/articles/[REPLACE: SKILL_NAME]-${today}.md
   ```

6. **Log** — append to `memory/logs/${today}.md`:
   ```
   ## [REPLACE: SKILL_NAME]
   - **Sources scanned**: N feeds + 1 web search
   - **Items picked**: N (of M candidates)
   - **Top source**: domain
   - **Status**: DIGEST_OK | DIGEST_QUIET (no items) | DIGEST_DEGRADED (some feeds failed)
   ```

## Network note

`WebFetch` and `WebSearch` are built-in Claude tools. There is no network sandbox — `curl` works too; use `WebFetch` as the fallback for a flaky public GET. For this research skill the reads are unauthenticated, so `WebSearch` + `WebFetch` are the simplest path.

## Constraints

- **Never repeat**. Track which item URLs went out via `memory/topics/[REPLACE: SKILL_NAME]-seen.txt` (append-only). Skip anything that's already in there.
- **No filler**. If fewer than `[REPLACE: MAX_ITEMS]` items meet the bar, send fewer items — never pad with low-signal content.
- **Quote, don't paraphrase the news**. Say "Anthropic released X" not "AI labs are releasing things." Specificity beats hand-waving.
