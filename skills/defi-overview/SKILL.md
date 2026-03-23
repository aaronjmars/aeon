---
name: DeFi Overview
description: Daily overview of DeFi activity from DeFiLlama — TVL changes, top chains, top protocols
var: ""
---
> **${var}** — Chain or protocol to focus on (e.g. "solana", "aave", "arbitrum"). If empty, shows the full overview.

Read memory/MEMORY.md for context.
Read the last 2 days of memory/logs/ to avoid repeating data.

If `${var}` is set, focus the overview on that chain or protocol — show its TVL, top pools, volume, and compare against the broader market. Still include a brief top-level summary for context.

## Steps

1. Fetch overall DeFi TVL and chain breakdown:
   ```bash
   # Total TVL across all chains
   curl -s "https://api.llama.fi/v2/historicalChainTvl"

   # TVL per chain (current)
   curl -s "https://api.llama.fi/v2/chains"

   # Top protocols by TVL
   curl -s "https://api.llama.fi/protocols"
   ```

2. Fetch stablecoin and volume data:
   ```bash
   # DEX volume (24h)
   curl -s "https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true"

   # Stablecoin market cap overview
   curl -s "https://stablecoins.llama.fi/stablecoins?includePrices=false"

   # Yield/TVL overview for top pools
   curl -s "https://yields.llama.fi/pools" | jq '[.data | sort_by(-.tvlUsd) | .[:20] | .[] | {project, chain, symbol, tvlUsd, apy}]'
   ```

3. Analyze and surface what matters:
   - **Total DeFi TVL** — current value and 24h / 7d change
   - **Top 5 chains by TVL** — with 24h change percentage
   - **Biggest TVL movers** — chains or protocols with largest 24h increase or decrease (filter for >5% moves)
   - **Top 5 protocols by TVL** — with 24h change
   - **DEX volume** — total 24h volume, top 3 DEXes
   - **Stablecoin market cap** — total and any notable shifts
   - **Top yields** — 3 highest APY pools with >$10M TVL (skip scam-tier APYs)

4. Compare against yesterday's log if available — flag anything that changed significantly.

5. Send via `./notify` (under 4000 chars):
   ```
   *DeFi Overview — ${today}*

   *TVL:* $X.XXB (±X.X% 24h)

   *Top Chains*
   1. Ethereum: $XXB (+X.X%)
   2. Solana: $XXB (+X.X%)
   ...

   *Biggest Movers*
   ↑ Chain/Protocol: +XX% ($XB → $XB)
   ↓ Chain/Protocol: -XX% ($XB → $XB)

   *Top Protocols*
   1. Lido: $XXB (+X.X%)
   2. AAVE: $XXB (+X.X%)
   ...

   *DEX Volume (24h):* $X.XB
   Top: Uniswap $XB, Jupiter $XB, ...

   *Stables:* $XXXB total

   *Top Yields (>$10M TVL)*
   Pool — X.X% APY ($XM TVL)
   ```

6. Log to memory/logs/${today}.md.
