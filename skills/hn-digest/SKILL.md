---
name: HN Digest
description: Top Hacker News stories filtered by interests
var: ""
---
> **${var}** — Topic filter for stories (e.g. "rust", "LLMs", "biotech"). If empty, uses default interest areas.

Read memory/MEMORY.md for context.
Read the last 2 days of memory/logs/ to avoid repeating stories.

## Steps

1. Fetch top stories from the HN API:
   ```bash
   # Get top 30 story IDs
   STORY_IDS=$(curl -s "https://hacker-news.firebaseio.com/v0/topstories.json" | jq '.[0:30][]')
   # Fetch each story's metadata
   for ID in $STORY_IDS; do
     curl -s "https://hacker-news.firebaseio.com/v0/item/${ID}.json"
   done
   ```

2. Filter stories by relevance. If `${var}` is set, prioritize stories matching that topic. Otherwise show the top stories by points — no topic filter applied.
   Also include anything with 200+ points regardless of topic.

3. For the top 5-7 stories:
   - If the story has a URL, fetch it with WebFetch for more context
   - Write a one-sentence summary
   - Include the HN discussion link: `https://news.ycombinator.com/item?id=ID`

4. Send via `./notify` (under 4000 chars):
   ```
   *HN Digest — ${today}*

   1. [Title](url) (X pts, Y comments)
      Summary of why it matters.
      [Discussion](https://news.ycombinator.com/item?id=ID)

   2. ...
   ```

5. If `SUPERNOTES_API_KEY` is set, save the digest as a Supernotes card:
   ```bash
   curl -s -X POST "https://api.supernotes.app/v1/cards/simple" \
     -H "Api-Key: $SUPERNOTES_API_KEY" \
     -H "Content-Type: application/json" \
     -d "$(jq -n \
       --arg name "HN Digest — ${TODAY}" \
       --arg markup "$DIGEST_MARKUP" \
       --arg color "blue" \
       '{name: $name, markup: $markup, color: $color, tags: ["hn-digest", "aeon"]}')"
   ```
   Where `$DIGEST_MARKUP` is the full digest in markdown (same content sent via notify, but with proper markdown links).
   If the API call fails, log a warning and continue — don't block the rest of the skill.

6. Log to memory/logs/${today}.md.
   If no relevant stories found, log "HN_DIGEST_OK" and end.
