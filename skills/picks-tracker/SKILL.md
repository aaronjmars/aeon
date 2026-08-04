---
name: picks-tracker
description: Retrospective on past token and prediction market picks - what hit, what flopped, what the score is
metadata:
  title: Picks Tracker
  category: crypto
  schedule: "0 9 * * 0"
  tags:
    - crypto
    - review
    - meta
  requires:
    - COINGECKO_API_KEY?
---

Today is ${today}. Your task is to audit the last 30 days of token picks and score them against current prices.

Read memory/MEMORY.md for context.

## Network note

`curl` works — there is no network sandbox. For every curl call, if it fails or returns empty/error, use **WebFetch** for the same URL as a fallback for a flaky public GET.

## Steps

### 1. Extract token picks from logs

Scan the last 30 days of `memory/logs/` for token picks. For each log file, grep for lines matching `**Token:**`. Extract:
- Symbol (e.g., XMR, HYPE, TAO)
- Date (from the filename, e.g., 2026-04-19)
- Pick price (the number after `$` on the same line, ignoring `~` approximations)

Also extract prediction market picks from lines matching `**Market:**`:
- The question text (in quotes)
- The position taken (YES or NO)
- The price/odds at pick time

Expected log format (written by token-pick and monitor-polymarket):
```
- **Token:** XMR — $350.52 (+1.17% 24h, +2.55% 7d)
- **Market:** "US x Iran permanent peace deal by April 30?" — NO $0.615 (YES 38.5%)
```

Focus on the last **30 days** of logs. If a token was picked multiple times, record each instance separately.

If zero picks are found in the window, log `PICKS_TRACKER_SKIP: no picks in last 30 days — enable token-pick / monitor-polymarket` and stop (no notification).

### 2. Fetch current token prices

For each unique token symbol, fetch the current price from CoinGecko.

First, try the search endpoint to get the coin ID:
```bash
curl -s "https://api.coingecko.com/api/v3/search?query=SYMBOL" \
  ${COINGECKO_API_KEY:+-H "x-cg-demo-api-key: $COINGECKO_API_KEY"}
```

Then fetch the price:
```bash
curl -s "https://api.coingecko.com/api/v3/simple/price?ids=COIN_ID&vs_currencies=usd&include_24hr_change=true" \
  ${COINGECKO_API_KEY:+-H "x-cg-demo-api-key: $COINGECKO_API_KEY"}
```

**Fallback:** If curl fails, use WebFetch for the same URL (drop the API key header).

**Common ID mappings** (use directly, skip search step):
- HYPE → hyperliquid
- XMR → monero
- TAO → bittensor
- ENJ → enjincoin
- DASH → dash
- ORDI → ordinals
- MORPHO → morpho
- RENDER → render-token
- JUP → jupiter-exchange-solana
- KAS → kaspa
- ENA → ethena
- ALGO → algorand
- APT → aptos
- FET → fetch-ai
- ZEC → zcash
- ETHFI → ether-fi

For tokens not in the list, use the search endpoint. If a symbol is ambiguous or the token isn't found, mark as `N/A (not found)`.

### 3. Calculate performance

For each pick:
```
performance % = ((current_price - pick_price) / pick_price) * 100
```

Round to 1 decimal place. Use a `~` prefix if the pick price was approximate.

If the same token was picked multiple times, calculate performance from each individual pick date.

Classify each pick:
- 🟢 **Win** — +10% or better
- 🟡 **Hold** — between -10% and +10%
- 🔴 **Loss** — -10% or worse

### 4. Check prediction market pick resolution

For each prediction market pick, search the Polymarket API to check if the market resolved:
```bash
# Search by question text
curl -s "https://gamma-api.polymarket.com/markets?closed=true&limit=10&q=KEYWORDS_FROM_QUESTION"
```

If WebFetch is needed: `https://gamma-api.polymarket.com/markets?closed=true&limit=10&q=KEYWORDS_FROM_QUESTION`

For each market pick:
- If resolved: was the position correct? Mark ✅ (correct) or ❌ (wrong) or ⏳ (still open)
- Note the resolution price/outcome if available

Markets with no Polymarket equivalent (internal or experimental markets) — mark as ⏳ or skip.

### 5. Score summary

Tally the token picks:
- Total picks in window
- Wins / Holds / Losses count
- Average return across all picks (equally weighted)
- Best pick (highest % gain)
- Worst pick (biggest % loss)
- Hit rate: (wins / total_picks) * 100

Keep it honest. No cherry-picking dates.

### 6. Format and send notification

Send via `./notify` (inline multi-line literal — do NOT pipe or use `$(cat)`):

```
*picks scorecard — [START_DATE] → [TODAY]*

*token picks ([N] total)*
[SYMBOL] [DATE] — picked $[PICK] → now $[CURRENT] ([PERF]%) [EMOJI]
...sorted best to worst...

*score: [WINS]W [HOLDS]H [LOSSES]L | avg [AVG]% | hit rate [HIT_RATE]%*
*best: [SYMBOL] +[BEST]% | worst: [SYMBOL] [WORST]%*

*market picks*
[QUESTION_SNIPPET] — [POSITION] [STATUS_EMOJI]
...

no financial advice. just tracking the record.

read it: https://github.com/aeonfun/aeon/blob/main/output/articles/picks-scorecard-${today}.md
```

Keep the message under 3000 chars. If too long, truncate to the most recent 10 picks.

### 7. Save scorecard

Write a brief scorecard to `output/articles/picks-scorecard-${today}.md`:
```markdown
# Picks Scorecard — [DATE]

## Token Performance
| Symbol | Picked | Pick Price | Current | Change | Result |
|--------|--------|-----------|---------|--------|--------|
...

## Summary
- Window: last 30 days
- Total picks: N
- Wins / Holds / Losses: X / Y / Z
- Average return: X%
- Hit rate: X%

## Market Picks
| Question | Position | Status |
...
```

### 8. Log to memory

Append to `memory/logs/${today}.md`:
```
### picks-tracker
- **Window:** last 30 days (N picks)
- **Score:** [WINS]W [HOLDS]H [LOSSES]L | avg [AVG]% | hit rate [HIT_RATE]%
- **Best:** [SYMBOL] +[BEST]%
- **Worst:** [SYMBOL] [WORST]%
- **Notification sent:** yes
- PICKS_TRACKER_OK
```

## Environment Variables

- `COINGECKO_API_KEY` — optional, increases rate limits. Skill works without it via free tier + WebFetch fallback.
