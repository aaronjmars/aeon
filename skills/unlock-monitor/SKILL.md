---
name: unlock-monitor
description: Token unlock and vesting tracker - quantify supply pressure via absorption ratio, classify cliff vs linear, and deliver one-line market reads
metadata:
  title: Unlock Monitor
  category: crypto
  schedule: "0 10 * * 1"
  commits: true
  tags:
    - crypto
  permissions:
    - contents:write
---

<!-- autoresearch: variation B — sharper output via Absorption Ratio (unlock $ / avg daily volume), Cliff vs Linear classification, and a one-line market-read verdict per unlock. Replaces qualitative HIGH/MED/LOW tiers with quantitative liquidity-strain thresholds backed by Keyrock's 16k-unlock study. Folds in source-status observability (from C) and CoinGecko volume enrichment (from A) as cheap wins. -->

Read memory/MEMORY.md for context on market positions and active narratives.
Read the last 7 days of memory/logs/ to dedup against any unlock already covered.
Read `memory/state/unlock-monitor-seen.json` if present — a list of `${ticker}:${unlock_date}` keys already shipped. Skip exact matches; if file is absent, treat as empty.

## Core thesis

The original skill ranked unlocks by **% of circulating supply**. That's a weak proxy. The right metric is **Absorption Ratio = unlock_dollar_value / 7-day avg daily volume**. Keyrock's analysis of 16k+ unlocks shows that ratios above ~2.4× consistently strain liquidity and produce measurable price drawdown. Below ~0.5× the market typically yawns. This skill ranks by absorption ratio first, supply % second, and folds in cliff-vs-linear structure plus pre-unlock price action to produce a per-event verdict.

## Steps

### 1. Gather candidate unlocks

Run these WebSearches in parallel:

- `"token unlock schedule" "${week_of}" site:tokenomist.ai OR site:defillama.com`
- `"token unlock" "this week" cliff vesting team investor ${current_year}`
- `"upcoming unlocks" cryptorank OR dropstab ${current_year}`
- `"FTX distribution" OR "Mt. Gox" OR "Celsius" OR "creditor payout" crypto ${current_year}` (court-ordered supply shocks count)
- `"$10M" OR "$50M" OR "$100M" token unlock ${week_of}` (dollar-value angle catches what supply % misses)

Also fetch (WebFetch fallback if any URL fails):

- `https://tokenomist.ai` — primary, source-verified across 500+ tokens with cliff/linear labeling
- `https://defillama.com/unlocks` — DeFi protocols, with $ values
- `https://cryptorank.io/token-unlock` — broad coverage, recipient-category labeled
- `https://dropstab.com/vesting` — alternative cross-source verification
- `https://www.coingecko.com/en/highlights/incoming-token-unlocks` — Tokenomist-powered

Record which sources returned data → emit a `sources:` line in the log (see step 7).

### 2. Enrich each candidate with volume + structure

For each candidate unlock, fetch from CoinGecko search results or WebFetch on `https://www.coingecko.com/en/coins/${slug}`:

- **7-day average daily volume** (USD) — denominator for the absorption ratio
- **Spot price** at fetch time
- **30-day price change %** — input to the market-read verdict
- **Vesting structure**: `cliff` (lump-sum unlock) vs `linear` (gradual) vs `mixed` — usually labeled by tokenomist / cryptorank
- **Recipient category**: `team`, `investor`, `ecosystem`, `community`, `creditor`

If volume data is unavailable, mark the unlock `vol=unknown` and tier it conservatively — do not skip it, but flag the gap in the output.

### 3. Compute Absorption Ratio and tier

For each unlock with known volume:

```
absorption_ratio = unlock_usd_value / avg_daily_volume_usd_7d
```

Tier the events:

| Tier | Absorption Ratio | Meaning |
|------|------------------|---------|
| **CRISIS** | > 2.4× | Liquidity cannot absorb without significant slippage |
| **STRAIN** | 1.0× – 2.4× | Will require multiple sessions to digest |
| **DIGESTIBLE** | 0.3× – 1.0× | Notable but absorbable |
| **TRIVIAL** | < 0.3× | Background noise, skip unless recipient flag elevates it |

**Recipient override**: a `team` or `investor` unlock with absorption ratio one tier lower than CRISIS gets bumped up one tier (cost-basis-zero sellers act differently than airdrop recipients). A `community` or `staking-reward` unlock with ratio one tier higher gets bumped *down* one tier.

**Court-ordered distributions** (FTX, Mt. Gox, Celsius) bypass the tier system — always include, label `forced`, note the legal timeline.

### 4. Classify pre-unlock market read

For each event, set a one-line `market_read` based on 30d price change and vesting type:

- **`priced in`** — token is down >20% over 30d AND ratio ≤ STRAIN. Selling has already happened; unlock day may mark a bottom.
- **`market asleep`** — token is flat or up over 30d AND tier is STRAIN or CRISIS. Asymmetric downside; the move hasn't started.
- **`fade pump`** — token is up >15% over 30d AND tier is CRISIS. Classic pre-cliff bid-then-dump pattern.
- **`forced sellers`** — court-ordered. Different beast — legal timeline, not market-driven.
- **`absorbable`** — TRIVIAL or DIGESTIBLE with no recipient flag. Nothing to see here.

For cliff unlocks: weakness usually starts ~30 days before; vol peaks at unlock; recovery 10–14 days later. Note this pattern explicitly when relevant.

### 5. Rank and select

Sort by absorption ratio descending, then by recipient flag (team/investor first), then by dollar value. Take the top 8 (drop TRIVIAL unless a court-order or recipient flag elevates them).

Deduplicate against `memory/state/unlock-monitor-seen.json` and the last 7 days of logs.

If the resulting list is empty, that's a real signal — output `UNLOCK_MONITOR_QUIET` and a one-line note explaining why (e.g. "No unlocks above 0.3× absorption ratio this week — supply side is calm").

### 6. Send via `./notify` (under 4000 chars)

Lead with the headline — the single most-leveraged unlock — then tiered groups, then the read.

```
*Unlock Monitor — week of ${date}*

This week's most leveraged: **$TOKEN** unlocks Wed at $XM (Y× daily vol). [market read]

CRISIS (> 2.4× daily vol)
- **$TOKEN** — Mon Apr 22 — X tokens (Z% supply, $YM)
  cliff · investor · 3.1× vol · 30d -8% → market asleep
  Note: cliff pattern — expect weakness running into the date

STRAIN (1.0×–2.4×)
- **$TOKEN** — details · 1.6× vol · 30d -25% → priced in

DIGESTIBLE (0.3×–1.0×)
- **$TOKEN** — details · 0.6× vol · linear · ecosystem → absorbable

FORCED
- **$TOKEN** — Mon — court-ordered creditor batch, $XM, no schedule discretion

*Supply read:* 2-3 sentences. Where's the real pressure, where's the noise, where's the asymmetry. Reference any cliff timing patterns. If the week is quiet, say so plainly.

sources: tokenomist=ok, defillama=ok, cryptorank=ok, dropstab=fail, coingecko=ok
```

### 7. Persist state and log

Append every shipped event's key (`${ticker}:${unlock_date}`) to `memory/state/unlock-monitor-seen.json` (create the file and `memory/state/` directory if absent). Trim the file to the last 90 days of keys.

Log to `memory/logs/${today}.md`:

```
### unlock-monitor
- Week of: ${date}
- Shipped: N events (X CRISIS, Y STRAIN, Z DIGESTIBLE)
- Top leverage: $TOKEN at A.A× daily vol
- Verdict mix: K priced-in, L asleep, M fade-pump, N forced
- Sources: tokenomist=ok|fail, defillama=ok|fail, cryptorank=ok|fail, dropstab=ok|fail, coingecko=ok|fail
- Status: UNLOCK_MONITOR_OK | UNLOCK_MONITOR_QUIET | UNLOCK_MONITOR_DEGRADED (if 2+ sources failed) | UNLOCK_MONITOR_ERROR (if all failed)
```

## Guidelines

- The Absorption Ratio is the headline metric. % of circulating supply is secondary — useful for context but not for ranking.
- Team and investor unlocks at low cost basis are the strongest sell signals. Bias the recipient override toward overstating their impact, not understating.
- Linear unlocks rarely produce single-day shocks — say so explicitly when one shows up high in the list. The danger from linear is cumulative, not pointwise.
- Cliff unlocks have a recognizable pattern: weakness ~30 days prior, peak vol on the date, recovery 10–14 days later. Reference this pattern when timing matters.
- Pre-unlock price action is the cheapest signal of whether the market has done its work already. A token bleeding for 30 days into a known unlock is *priced in*. A token ripping into a known cliff is a *fade pump*.
- Court-ordered distributions are unique — forced liquidation under legal timelines, no strategic discretion. Tier them separately.
- Be direct. "this one's priced in", "market's asleep on this", "fade the pump" — say it plainly. No hedging.
- A quiet week on supply is a signal too. Ship `UNLOCK_MONITOR_QUIET` with one sentence, don't pad.
- Cross-reference active narratives in MEMORY.md — unlocks during a fading narrative hit harder; unlocks into a hot narrative get absorbed.

## Network note

`curl` works — there is no network sandbox. Use **WebFetch** as a fallback for a flaky public GET — all data sources here are public, no auth required. If WebFetch on a specific source also fails, mark it `fail` in the source-status line and proceed with whatever sources returned data. Only emit `UNLOCK_MONITOR_ERROR` if *all* sources failed.

## Environment Variables Required

- None (uses WebSearch + WebFetch only)
- Notification channels configured via repo secrets (see CLAUDE.md)
