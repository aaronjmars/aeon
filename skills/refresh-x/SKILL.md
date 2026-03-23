---
name: Refresh X
description: Fetch a tracked X/Twitter account's latest tweets and save the gist to memory
var: ""
---
> **${var}** — The @handle to check (e.g. "@elonmusk", "vitalikbuterin"). **Required** — set this in aeon.yml or pass it when triggering the skill.

Read memory/MEMORY.md for context.
Read the last 2 days of memory/logs/ to avoid logging duplicate tweets.

## Steps

1. Fetch the latest tweets from the specified account over the past 24 hours:
   ```bash
   FROM_DATE=$(date -u -d "yesterday" +%Y-%m-%d 2>/dev/null || date -u -v-1d +%Y-%m-%d)
   TO_DATE=$(date -u +%Y-%m-%d)
   ACCOUNT="${var}"
   # Strip @ if present
   ACCOUNT="${ACCOUNT#@}"

   if [ -z "$ACCOUNT" ]; then
     echo "Error: var must be set to a Twitter handle (e.g. 'elonmusk')"
     exit 1
   fi

   curl -s -X POST "https://api.x.ai/v1/responses" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $XAI_API_KEY" \
     -d '{
       "model": "grok-4-1-fast",
       "input": [{"role": "user", "content": "Search X for all tweets posted by @'"$ACCOUNT"' from '"$FROM_DATE"' to '"$TO_DATE"'. Return every tweet — not just popular ones. For each: the full tweet text, date/time posted, engagement stats (likes, retweets, replies), and the direct link (https://x.com/'"$ACCOUNT"'/status/ID). If it was a reply, note who it was replying to. If it was a quote tweet, include what was quoted. Return as a chronological list."}],
       "tools": [{"type": "x_search", "from_date": "'"$FROM_DATE"'", "to_date": "'"$TO_DATE"'"}]
     }'
   ```
   If `XAI_API_KEY` is not set, skip and log that the skill requires it.

2. Summarize what was posted:
   - How many tweets/replies/quote tweets
   - Top themes and topics covered
   - Which tweets got the most engagement and why
   - Any threads or multi-tweet arcs
   - Tone/mood of the day (shitposting? serious? argumentative?)

3. Save the gist to memory/logs/${today}.md:
   ```
   ## Refresh X
   - **Account:** @ACCOUNT
   - **Tweets found:** N (X original, Y replies, Z quotes)
   - **Top themes:** theme1, theme2, theme3
   - **Best performing:** "[tweet excerpt]" — X likes, Y RTs
   - **Gist:** [2-3 sentence summary of what they were talking about and the vibe]
   ```

4. If there are tweets worth remembering (strong takes, announcements, threads), also note them in memory/MEMORY.md under a relevant section.

5. Send a brief summary via `./notify`:
   ```
   x refresh: @ACCOUNT posted N tweets yesterday
   top themes: theme1, theme2
   best: "[excerpt]" (X likes)
   ```

## Environment Variables Required
- `XAI_API_KEY` — X.AI API key for Grok x_search
