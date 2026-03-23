---
name: List Digest
description: Top tweets from tracked X lists in the past 24 hours
var: ""
---
> **${var}** — Comma-separated X list IDs to track (e.g. "1953536336675365173,1937207796270829766"). Optionally append a topic filter after a pipe: "LIST_ID1,LIST_ID2|AI agents". **Required** — set your list IDs in aeon.yml.

Read memory/MEMORY.md for context.
Read the last 2 days of memory/logs/ to avoid repeating tweets.

## Steps

1. Parse the `${var}` input:
   - Split on `|` — left side is comma-separated list IDs, right side (if present) is topic filter
   - If `${var}` is empty, log an error: "var must contain at least one X list ID" and exit

2. For each list, use the X.AI API to fetch the top tweets from the past 24 hours:
   ```bash
   FROM_DATE=$(date -u -d "yesterday" +%Y-%m-%d 2>/dev/null || date -u -v-1d +%Y-%m-%d)
   TO_DATE=$(date -u +%Y-%m-%d)

   # Parse list IDs from var (split on | first, then comma)
   IDS_PART="${var%%|*}"
   TOPIC_FILTER="${var#*|}"
   if [ "$TOPIC_FILTER" = "$IDS_PART" ]; then TOPIC_FILTER=""; fi

   for LIST_ID in $(echo "$IDS_PART" | tr ',' ' '); do
     curl -s -X POST "https://api.x.ai/v1/responses" \
       -H "Content-Type: application/json" \
       -H "Authorization: Bearer $XAI_API_KEY" \
       -d '{
         "model": "grok-4-1-fast",
         "input": [{"role": "user", "content": "Look at X list https://x.com/i/lists/'"$LIST_ID"'. First, tell me the name and description of this list. Then find the most popular and engaging tweets posted by members of this list from '"$FROM_DATE"' to '"$TO_DATE"'. Rank by engagement (likes, retweets, quotes). Return the top 10 tweets. For each: @handle, a one-line summary, engagement stats if visible, and the direct link (https://x.com/username/status/ID). Skip retweets of non-members."}],
         "tools": [{"type": "x_search", "from_date": "'"$FROM_DATE"'", "to_date": "'"$TO_DATE"'"}]
       }'
     echo "---"
   done
   ```
   If `XAI_API_KEY` is not set, skip and log that the skill requires it.

3. For each list:
   - Note the list name/description (Grok will return it)
   - Pick the top 5 tweets by engagement and substance
   - If a topic filter was provided, prioritize tweets related to that topic
   - Deduplicate across lists (same tweet may appear on multiple lists)
   - Deduplicate against recent logs

4. Send via `./notify` (under 4000 chars):
   ```
   List Digest — ${today}

   [List Name 1]
   1. @handle — summary [link]
   2. @handle — summary [link]
   ...

   [List Name 2]
   1. @handle — summary [link]
   2. @handle — summary [link]
   ...
   ```

   If one list has no notable tweets, just write "quiet day" under that list name.

5. Log to memory/logs/${today}.md.
   If nothing found across all lists, log "LIST_DIGEST_OK" and end.

## Environment Variables Required
- `XAI_API_KEY` — X.AI API key for Grok x_search
