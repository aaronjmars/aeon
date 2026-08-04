---
name: token-pick
description: One token recommendation and one prediction market pick - scored, quantified, with a skip branch when signals are weak
metadata:
  title: Token Pick
  mode: read-only
  category: crypto
  var: ""
  tags:
    - crypto
  requires:
    - COINGECKO_API_KEY?
  capabilities:
    - external_api
    - sends_notifications
---
<!-- autoresearch: variation B — sharper output via signal scoring, edge calculation, conviction tiers, and a skip-day branch -->

> **${var}** — Focus area or thesis (e.g. "AI tokens", "election markets", "contrarian bets"). If empty, scans broadly.

Read `memory/MEMORY.md` for context.
Read the last 7 days of `memory/logs/` and grep for prior `Token Pick` entries — extract the symbols and market questions already picked. **Hard dedup gate**: do not re-pick the same token or the same prediction market unless there is a materially new catalyst that you can name in one sentence.

## Goal

Produce ONE token call and ONE prediction-market call per day, each with a numeric signal/edge score and a conviction tier. If neither qualifies for at least MEDIUM conviction, send a short "no picks today" message rather than forcing a weak pick.

## Steps

### 1. Fetch token data

```bash
# Trending coins
curl -s "https://api.coingecko.com/api/v3/search/trending" \
  ${COINGECKO_API_KEY:+-H "x-cg-demo-api-key: $COINGECKO_API_KEY"}

# Top 250 by market cap with 24h and 7d changes
curl -s "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d" \
  ${COINGECKO_API_KEY:+-H "x-cg-demo-api-key: $COINGECKO_API_KEY"}

# BTC + ETH 24h/7d for relative-strength benchmark (extract from the markets call above; no extra request needed)

# DEX-side cross-confirmation (no auth, optional but preferred)
curl -s "https://api.dexscreener.com/latest/dex/search?q=trending"
```

If any curl returns empty or errors, retry once with **WebFetch** for the same URL. Track per-source status (`cg=ok|fail`, `dex=ok|fail`) — surfaced in the output footer.

### 2. Fetch prediction markets

```bash
# Top events by 24h volume (events group multi-outcome questions)
curl -s "https://gamma-api.polymarket.com/events?active=true&closed=false&order=volume_24hr&ascending=false&limit=30"

# Newer markets gaining traction
curl -s "https://gamma-api.polymarket.com/markets?closed=false&order=startDate&ascending=false&limit=20"
```

WebFetch fallback on failure. Track `poly=ok|fail`.

### 3. Score every candidate token (0–10 scale)

For each token in the top 250 (and the trending list), compute a signal score:

| Signal | Points |
|---|---|
| 24h price change > 0 | +1 |
| 7d price change > 0 | +1 |
| Both 24h and 7d > +5% | +2 (in addition to above) |
| Appears on CoinGecko trending list | +2 |
| Volume/MarketCap ratio ≥ 0.10 | +2 |
| Volume/MarketCap ratio ≥ 0.20 (replaces above) | +3 |
| Outperforming BOTH BTC and ETH on the 7d | +2 |
| Confirmed on DexScreener trending/gainers (cross-source) | +1 |
| Matches `${var}` thesis when set | +1 |

Drop candidates with market cap < $20M (too pumpable) unless `${var}` explicitly targets micro-caps. Drop any token already picked in the last 7 days (per dedup gate) unless you can name a fresh catalyst.

Pick the highest-scoring token. Use **WebSearch** to surface the most likely catalyst and at least one named risk (regulatory, unlock, narrative-faded, exchange listing, etc.).

### 4. Score prediction markets — edge calculation

For the top ~10 markets by 24h volume that pass the dedup gate (and `${var}` filter when set), do this for each:

1. Read the question and current YES price (`price`/`outcomePrices`).
2. Use **WebSearch** to gather 1–3 recent data points relevant to the resolution.
3. Estimate a **fair YES probability** as a single number (your best calibrated guess, not a range). State the 1–3 inputs you used.
4. Compute `edge = |fair − current_price|` as percentage points.
5. Liquidity gate: require 24h volume ≥ $50k AND market not resolving in < 24h (no last-minute mean-reversion roulette).

Pick the market with the largest edge that clears the gate. If you cannot defend a fair-value estimate within ±10% (insufficient public info), discard and try the next market.

### 5. Conviction tiers

| Tier | Token criterion | Market criterion |
|---|---|---|
| HIGH | signal score ≥ 7 | edge ≥ 10pp |
| MEDIUM | signal score 4–6 | edge 5–10pp |
| SKIP | signal score < 4 | edge < 5pp |

**Skip-day branch**: if BOTH the chosen token and the chosen market land in SKIP, do not synthesize a pick. Send the skip message (step 6b) and log accordingly. This is a feature — forcing low-conviction picks degrades the signal of the whole feed.

### 6a. Notification — normal day (under 4000 chars)

Send via `./notify`:

```
*Daily Pick — ${today}*

*Token: SYMBOL*  [HIGH | MEDIUM]  signal X/10
Price: $X.XX (±X.X% 24h / ±X.X% 7d) | mcap $XB | vol $XM (vol/mcap X.XX)
Score breakdown: [trending+2, vol/mcap+3, RS vs BTC/ETH+2, narrative+1] = 8/10
Catalyst: [one sentence — what's driving this right now, named source/event]
Risk: [one sentence — concrete risk, not generic "could go down"]
Vs recent picks: [first time / repeat with new catalyst: ...]

*Market: "Question?"*  [HIGH | MEDIUM]  edge Xpp
Current: YES X¢ / NO Y¢ | 24h vol $Xm | resolves: DATE
Fair YES: ~Y% (inputs: [src1], [src2], [src3])
Thesis: [one sentence — why the market is wrong, action implied]
Risk: [one sentence — what could make your fair-value estimate wrong]

sources: cg=ok|fail, dex=ok|fail, poly=ok|fail
not financial advice — pattern-matching only
```

If only one of the two pick types qualifies, send just that one section (omit the other entirely — do not include a HIGH and a SKIP in the same message).

### 6b. Notification — skip day

```
*Daily Pick — ${today}* — no picks

Token signals weak today (best: SYMBOL @ score 3/10).
Markets either thin liquidity or no defensible edge ≥ 5pp (best: "Question?" edge 2pp).

Tomorrow.
sources: cg=ok|fail, dex=ok|fail, poly=ok|fail
```

If all sources failed, send `TOKEN_PICK_NO_DATA` with the source-status line — do not invent picks from cached intuition.

### 6c. Offer a deep-dive (force-reply — normal-day only)

Only after a **normal-day** send (6a) — never on the skip-day (6b) or the no-data path (weak signals → no pick, so no offer). This skill is `read-only`, so it can't run the deep report itself; instead it offers to hand off to **token-movers** (write mode), which owns the single-token deep report and the `deep-dive:` handler. Because `force_reply` and inline buttons can't share one message, send this as a SEPARATE `./notify` AFTER the 6a pick:

```bash
./notify "Want a deeper report on a token? Reply with a ticker or contract." \
  --force-reply --placeholder "e.g. WIF" \
  --context "token-movers::deep-dive"
```

The `token-movers::deep-dive` marker routes the operator's reply to **token-movers** as `var="deep-dive:<their text>"`; token-movers strips the `deep-dive:` prefix and produces the single-token deep report.

**Dedup.** token-pick runs once daily, so one offer per run is already once-per-day. Being `read-only`, it can't write a `FORCE_REPLY_OFFERED` marker — but it already reads recent logs, so if today's log already carries a `FORCE_REPLY_OFFERED: deep-dive` line (e.g. token-movers offered earlier today), SKIP this offer to avoid double-nagging.

### 7. Log to `memory/logs/${today}.md`

```
### token-pick
- **Token:** SYMBOL — $price (±X% 24h) — tier HIGH/MEDIUM/SKIP — score X/10
- **Token thesis:** [one line, including catalyst]
- **Market:** "Question?" — YES X¢ — tier HIGH/MEDIUM/SKIP — edge Xpp
- **Market thesis:** [one line, including fair-value estimate]
- **Sources:** cg=ok|fail, dex=ok|fail, poly=ok|fail
- **Notification sent:** yes (normal | skip | no-data)
```

Append symbol + market question on a single line for easy grep next-day dedup, e.g.:
```
TOKEN_PICK_DEDUP: SYMBOL | "Will X happen by Y?"
```

## Network note

There is no network sandbox — `curl` works, with **WebFetch** as the fallback for any URL fetch (CoinGecko, DexScreener, Polymarket all work without auth). For an auth'd API, call `./secretcurl` with a `{ENV_NAME}` placeholder (the key is injected via `requires:`). On total source failure, send the no-data notification rather than silent fail.

## Environment Variables
- `COINGECKO_API_KEY` — CoinGecko API key (optional, increases rate limits)

## Constraints

- **Never force a pick.** If signals are weak, the skip message IS the output.
- **Never re-pick** the same token or market within 7 days unless you can state a new catalyst in one sentence.
- **Show your work**: every score must show the breakdown; every edge must show the inputs.
- Liquidity gates (mcap ≥ $20M for tokens, 24h vol ≥ $50k for markets) are hard floors — ignoring them turns the feed into a degen casino.
- One token + one market max. Never bundle "honorable mentions" — that defeats the discipline.
