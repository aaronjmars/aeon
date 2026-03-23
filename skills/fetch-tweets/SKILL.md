---
name: Fetch Tweets
description: Search X/Twitter for tweets by keyword, username, or both
var: ""
---
> **${var}** — Search query for X/Twitter — keyword, @user, or #hashtag. **Required** — set your query in aeon.yml.


Today is ${today}. Search X for tweets matching **${var}**.

## Steps

1. **Search tweets via X.AI API** using curl:
   ```bash
   FROM_DATE=$(date -u -d "7 days ago" +%Y-%m-%d 2>/dev/null || date -u -v-7d +%Y-%m-%d)
   TO_DATE=$(date -u +%Y-%m-%d)
   curl -s -X POST "https://api.x.ai/v1/responses" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $XAI_API_KEY" \
     -d '{
       "model": "grok-4-1-fast",
       "input": [{"role": "user", "content": "Search X for: ${var}. Date range: '"$FROM_DATE"' to '"$TO_DATE"'. Return 10 tweets — prioritize the most interesting, insightful, or highly-engaged posts. For each tweet include: @handle, the full text, date posted, engagement (likes/retweets if available), and the direct link (https://x.com/handle/status/ID). Return as a numbered list."}],
       "tools": [{"type": "x_search", "from_date": "'"$FROM_DATE"'", "to_date": "'"$TO_DATE"'"}]
     }'
   ```
   Parse the response JSON to extract the assistant's output text.

2. **Save the results** to `memory/logs/${today}.md`.

3. **Log to memory** what was fetched.

4. **Send a notification via `./notify`** with a quick summary.

## Usage Examples

- `query=AI agents` — latest tweets about AI agents
- `query=from:elonmusk` — tweets from a specific user
- `query=solana NFT` — tweets about a topic
- `query=from:vaborsh ethereum` — tweets from a user about a topic
- `query=#DeFi` — tweets with a hashtag

## Environment Variables Required

- `XAI_API_KEY` — X.AI API key (required)
