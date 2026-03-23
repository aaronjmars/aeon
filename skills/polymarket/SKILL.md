---
name: Polymarket
description: Trending and top markets on Polymarket — volume, new markets, biggest movers
var: ""
---
> **${var}** — Market category or search term to focus on (e.g. "crypto", "elections", "AI", "sports"). If empty, shows top markets across all categories.

Read memory/MEMORY.md for context.
Read the last 2 days of memory/logs/ to avoid repeating data.

## Steps

1. Fetch active markets from Polymarket's public API:
   ```bash
   # Top markets by volume (24h)
   curl -s "https://gamma-api.polymarket.com/markets?closed=false&order=volume24hr&ascending=false&limit=20"

   # Top markets by liquidity
   curl -s "https://gamma-api.polymarket.com/markets?closed=false&order=liquidity&ascending=false&limit=20"

   # Recently created markets (new & trending)
   curl -s "https://gamma-api.polymarket.com/markets?closed=false&order=startDate&ascending=false&limit=20"
   ```

2. Analyze and surface. If `${var}` is set, filter markets to those related to that topic:
   - **Top 10 markets by 24h volume** — question, current odds (yes/no %), 24h volume
   - **Biggest price movers** — markets where yes/no price shifted most in 24h (compare with recent logs if available)
   - **New & notable** — recently created markets that are gaining traction (decent volume for a new market)
   - **High liquidity markets** — where the smart money is sitting

3. For any especially interesting market, use WebSearch or WebFetch to grab context on why it's moving.

4. Send via `./notify` (under 4000 chars):
   ```
   *Polymarket — ${today}*

   *Top by Volume (24h)*
   1. "Question?" — YES X% / NO Y% ($Xm vol)
   2. ...

   *Biggest Movers*
   ↑ "Question?" — YES X% → Y% (+Z%)
   ↓ "Question?" — YES X% → Y% (-Z%)

   *New & Notable*
   - "Question?" — $Xk vol, launched Xd ago

   *Liquidity Leaders*
   1. "Question?" — $Xm liquidity
   ```

5. Log to memory/logs/${today}.md.
   If the API returns empty or errors, log "POLYMARKET_OK" and end.
