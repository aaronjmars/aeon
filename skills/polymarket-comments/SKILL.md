---
name: Polymarket Comments
description: Top trending Polymarket markets and the most interesting comments from them
var: ""
---
> **${var}** — Market topic to focus on (e.g. "crypto", "elections", "AI"). If empty, checks top trending markets across all categories.

Read memory/MEMORY.md for context.
Read the last 2 days of memory/logs/ to avoid repeating data.

## Steps

1. Fetch trending markets from Polymarket:
   ```bash
   # Top markets by 24h volume
   curl -s "https://gamma-api.polymarket.com/markets?closed=false&order=volume24hr&ascending=false&limit=15"
   ```

2. From the results, pick the **5 most interesting markets** — prioritize:
   - High volume + active trading (something is happening)
   - Controversial or polarizing questions (where comments will be spicy)
   - If `${var}` is set, filter to markets matching that topic

3. For each of the 5 markets, fetch comments and community discussion. Use WebSearch and WebFetch to find:
   - Polymarket comment sections (search for the market question + "polymarket" + "comments")
   - Twitter/X discussion about the market (search for the market question + "polymarket")
   - Reddit or other forum threads discussing the market
   ```bash
   # Also try the Polymarket activity endpoint for each market
   # The slug is in the market data from step 1
   curl -s "https://gamma-api.polymarket.com/markets/$CONDITION_ID"
   ```

4. For each market, extract the **2-3 most interesting comments or takes**:
   - Contrarian positions with reasoning
   - Insider-sounding analysis
   - Funny or sharp observations
   - Whale behavior callouts
   - Resolution debates

5. Send via `./notify` (under 4000 chars):
   ```
   *Polymarket Comments — ${today}*

   *1. "Market question?"* — YES X% ($Xm vol)
   - [commenter/source]: "[interesting take]"
   - [commenter/source]: "[interesting take]"

   *2. "Market question?"* — YES X% ($Xm vol)
   - [commenter/source]: "[interesting take]"
   - [commenter/source]: "[interesting take]"

   ... (5 markets)
   ```

6. Log to memory/logs/${today}.md:
   ```
   ## Polymarket Comments
   - **Markets covered:** 5
   - **Top market:** "[question]" — $Xm volume
   - **Notable take:** "[best comment excerpt]"
   - **Notification sent:** yes
   ```
