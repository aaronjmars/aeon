---
name: Trending Coins
description: Top trending and most searched coins on CoinGecko in the last 24 hours
var: ""
---
> **${var}** — Specific coin to highlight or category to filter (e.g. "PEPE", "AI tokens", "DePIN"). If empty, shows all trending coins.

Read memory/MEMORY.md for context.
Read the last 2 days of memory/logs/ to avoid repeating data.

## Steps

1. Fetch trending coins from CoinGecko:
   ```bash
   # Trending searches (top 15 coins people are searching for)
   curl -s "https://api.coingecko.com/api/v3/search/trending" \
     ${COINGECKO_API_KEY:+-H "x-cg-pro-api-key: $COINGECKO_API_KEY"}
   ```

2. For each trending coin, extract:
   - Name, symbol, market cap rank
   - Current price (USD)
   - 24h price change percentage
   - Market cap
   - The `score` field (lower = more trending)

3. Also fetch the top gainers for additional context:
   ```bash
   # Top 250 coins sorted by market cap — we'll extract biggest 24h movers
   curl -s "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h" \
     ${COINGECKO_API_KEY:+-H "x-cg-pro-api-key: $COINGECKO_API_KEY"}
   ```

4. Cross-reference: flag any trending coin that is also a top mover (trending + pumping = notable signal).
   If `${var}` is set, also fetch detailed data for that specific coin or filter trending results to that category, and highlight it in the output.

5. Send via `./notify` (under 4000 chars):
   ```
   *Trending Coins — ${today}*

   *Most Searched (CoinGecko)*
   1. NAME (SYMBOL) — #X market cap rank
      $price (±X.X% 24h) | $XB mcap
   2. ...

   *Notable:* SYMBOL is trending AND up XX% — [brief note if relevant]
   ```

6. Log to memory/logs/${today}.md.
   If the API returns empty or errors, log "TRENDING_COINS_OK" and end.
