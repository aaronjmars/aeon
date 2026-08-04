---
name: [REPLACE: SKILL_NAME]
description: Price and volume tracker for [REPLACE: TOKEN_SYMBOL] with anomaly alerts above [REPLACE: ALERT_THRESHOLD_PCT]% movement
metadata:
  category: crypto
  var: ""
  tags:
    - crypto
  requires:
    - COINGECKO_API_KEY?
---

> **${var}** — Optional. Pass a different CoinGecko ID to override the default. If empty, tracks the configured token.

Today is ${today}. Track [REPLACE: TOKEN_SYMBOL] price/volume and alert on anomalies.

## Steps

1. **Fetch current state** — query CoinGecko for the latest price, 24h change, 24h volume. Use `COINGECKO_API_KEY` if set, else the keyless endpoint:

   ```bash
   ID="${var:-[REPLACE: COINGECKO_ID]}"
   if [ -n "${COINGECKO_API_KEY:-}" ]; then
     URL="https://pro-api.coingecko.com/api/v3/simple/price?ids=$ID&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true"
     curl -sf -H "x-cg-pro-api-key: $COINGECKO_API_KEY" "$URL" > .token-cache.json
   else
     URL="https://api.coingecko.com/api/v3/simple/price?ids=$ID&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true"
     curl -sf "$URL" > .token-cache.json
   fi
   ```

   If a `curl` GET is flaky, use **WebFetch** on the same URL as a fallback (there is no network sandbox — WebFetch is just a convenience for flaky public reads).

2. **Read prior state** — last 7 days of `memory/logs/YYYY-MM-DD.md` for previous prices and volumes (parse lines like `**[REPLACE: TOKEN_SYMBOL]**: price=$N, volume_24h=$N`).

3. **Detect anomalies** — flag if `|price_change_24h| >= [REPLACE: ALERT_THRESHOLD_PCT]%` OR if 24h volume is `>= 2x` the 7-day median.

4. **Write `output/articles/[REPLACE: SKILL_NAME]-${today}.md`** with:
   - Current price, 24h change, 24h volume
   - 7-day price chart (sparkline as `▁▂▃▅▇` characters)
   - Anomaly verdict: `QUIET` / `STEADY` / `ANOMALY` (and which fired)
   - Links: CoinGecko page, Etherscan / explorer page if you know the contract address

5. **Notify** — if `ANOMALY`, send via `./notify` with the verdict + 1-2 sentences of context. Stay silent on QUIET/STEADY days.

6. **Log** — append to `memory/logs/${today}.md`:
   ```
   ## [REPLACE: SKILL_NAME]
   - **[REPLACE: TOKEN_SYMBOL]**: price=$N, change_24h=$N%, volume_24h=$N
   - **Verdict**: QUIET | STEADY | ANOMALY:price | ANOMALY:volume
   ```

## Network note

CoinGecko's keyless endpoint occasionally rate-limits. There is no network sandbox — `curl` works; use **WebFetch** as the fallback when a `curl` GET is flaky.

## Constraints

- Never spam. The `ALERT_THRESHOLD_PCT` gate is there to protect channel signal — don't lower it below 5%.
- Always cite sources in the article. Even a one-line link is better than no link.
