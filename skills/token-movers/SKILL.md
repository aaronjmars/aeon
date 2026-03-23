---
name: Token Movers
description: Top 10 token winners and losers by 24h price change from CoinGecko
var: ""
---
> **${var}** — Token symbol or category to highlight (e.g. "SOL", "layer-2", "meme coins"). If empty, shows top 10 winners/losers across all tokens.

Read memory/MEMORY.md for context.
Read the last 2 days of memory/logs/ to avoid repeating items.

## Steps

1. Fetch the top 250 coins by market cap:
   ```bash
   curl -s "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h" \
     ${COINGECKO_API_KEY:+-H "x-cg-pro-api-key: $COINGECKO_API_KEY"}
   ```

2. Sort by `price_change_percentage_24h`:
   - **Top 10 winners**: highest 24h % change
   - **Top 10 losers**: lowest 24h % change
   - For each coin: name, symbol, current price (USD), 24h % change
   - If `${var}` is set, also highlight that specific token or filter to tokens in that category, and add its detailed stats (price, volume, market cap, 7d change) at the top.

3. Send via `./notify` (under 4000 chars):
   ```
   *Token Movers — ${today}*

   *Top 10 Winners (24h)*
   1. SYMBOL: $price (+X.X%)
   2. ...

   *Top 10 Losers (24h)*
   1. SYMBOL: $price (-X.X%)
   2. ...
   ```

4. Log to memory/logs/${today}.md.
