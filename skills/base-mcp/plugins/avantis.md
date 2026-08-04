---
title: "Avantis Plugin"
description: "Skill plugin reference for reading Avantis market data and positions on any surface, and building perpetual-futures transactions from CLI harnesses (with an Avantis UI fallback on chat-only surfaces). Aligned with the canonical Avantis-Labs/avantis-trading-skill spec."
---

# Avantis Plugin

> [!IMPORTANT]
> Complete the short Base MCP onboarding flow defined in `SKILL.md` before calling any Avantis endpoint. The user's wallet address — used as `trader` in every tx-builder call — is fetched lazily when needed.

Avantis is a perpetual futures DEX on Base mainnet (`chainId` 8453). The plugin returns **unsigned** call data; signing and broadcasting are the wallet's job (Base MCP `send_calls`).

## Surface routing

| Capability | Hosts | Where it runs |
| --- | --- | --- |
| **View-only reads** — pair config, leverage envelopes, fees, open positions, limit orders, trade history, PnL, market-order settlement | `data.avantisfi.com`, `core.avantisfi.com`, `api.avantisfi.com` | Every surface. Use the harness HTTP tool when available; otherwise Base MCP `web_request` — these hosts are on the allowlist. |
| **Transaction-builder** — open/close trades, cancel orders, deposit/withdraw margin, set TP/SL, approve USDC, set/remove delegate | `tx-builder.avantisfi.com` | CLI harnesses (Claude Code, Codex, Cursor terminal). On chat-only surfaces (ChatGPT, Claude.ai), do not retry through `web_request`; link the user to the Avantis web UI — see [Chat-only fallback](#chat-only-fallback-avantis-ui). |

Routing order for any Avantis HTTP call:

1. **Harness HTTP tool** (`curl`, `fetch`, shell) — works for every host, any method, no allowlist.
2. **Base MCP `web_request`** — chat-only surfaces, view-only hosts only.
3. **Avantis web UI** — chat-only surfaces, tx-builder operations. See [Chat-only fallback](#chat-only-fallback-avantis-ui).

Do not sign, approve, or submit transactions unless the user explicitly asks. Generating call data and `send_calls` approval links is safe; the user approves any real transaction.

No API key or Authorization header is required for the documented public endpoints.

> [!IMPORTANT]
> **CORS caveat for `web_request`.** Most Avantis hosts return `Access-Control-Allow-Origin: *`, but two paths are **not** in the open-CORS prefix list:
> - `https://api.avantisfi.com/v2/history/referral/*`
> - `https://api.avantisfi.com/v2/market-order-initiated/*`
>
> Base MCP `web_request` is a server-side fetch and is not affected by browser CORS, so these still work from `web_request`. Only flag this if you ever proxy these requests from a browser context.

---

## API Services

| Service | Base URL | Routing | Purpose |
| --- | --- | --- | --- |
| tx-builder | `https://tx-builder.avantisfi.com` | CLI; UI fallback on chat-only | GET-only ABI-encoder for Avantis `Trading` and `USDC` calls |
| data | `https://data.avantisfi.com/v2/trading` | CLI or `web_request` | Pair + group config, fees, leverage envelopes, open interest, Pyth feed metadata |
| core | `https://core.avantisfi.com` | CLI or `web_request` | Current open positions, open limit orders, per-pair open interest |
| history | `https://api.avantisfi.com` | CLI or `web_request` | Closed/all trade history, PnL aggregates, referral stats, market-order settlement status |

Source of truth for tx-builder shape:

```
GET https://tx-builder.avantisfi.com/openapi.json
GET https://tx-builder.avantisfi.com/docs
```

---

## Base-Only Rules

- All tx-builder call data targets Base mainnet (`chainId` 8453). There is no chain selector.
- Collateral is USDC only. ETH is used only for gas and the Avantis execution-fee `value`.
- Canonical Base USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- Default USDC spender is Avantis `TradingStorage`: `0x8a311D7048c35985aa31C131B9A13e03a5f7422d`.

Live contract addresses:

```
GET https://tx-builder.avantisfi.com/addresses
# → { chainId, Trading, TradingStorage, USDC, PairStorage, PairInfos, PriceAggregator, Multicall, Referral }
```

| Contract | Mainnet address |
| --- | --- |
| `Trading` | `0x44914408af82bC9983bbb330e3578E1105e11d4e` |
| `TradingStorage` | `0x8a311D7048c35985aa31C131B9A13e03a5f7422d` |
| `PairStorage` | `0x5db3772136e5557EFE028Db05EE95C84D76faEC4` |
| `PairInfos` | `0x81F22d0Cc22977c91bEfE648C9fddf1f2bd977e5` |
| `PriceAggregator` | `0x64e2625621970F8cfA17B294670d61CB883dA511` |
| `USDC` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `Multicall` | `0xA7cFc43872F4D7B0E6141ee8c36f1F7FEe5d099e` |
| `Referral` | `0x1A110bBA13A1f16cCa4b79758BD39290f29De82D` |

---

## tx-builder Response Envelope

All calldata-producing tx-builder endpoints return:

```json
{
  "ok": true,
  "data": {
    "to": "0x44914408af82bC9983bbb330e3578E1105e11d4e",
    "from": "0x1111111111111111111111111111111111111111",
    "data": "0x19cde9a1...",
    "value": "0x13e52b9abe000",
    "chainId": 8453,
    "description": "Open long BTC/USD 10x with 100 USDC (market)",
    "meta": {}
  }
}
```

| Field | Notes |
| --- | --- |
| `to`, `data`, `value` | Forwarded into Base MCP `send_calls`. `value` is `0x`-prefixed wei; convert with `BigInt(value)` if you need a numeric. |
| `from` | Who must sign. With `&delegate=0x...`, `from` is the delegate. |
| `chainId` | Always `8453`. |
| `nonce`, `gas` | Never returned. The wallet manages them. |
| `meta` | Endpoint-specific context. `/trade/open` includes a `validation` block; see [Pre-Trade Validation](#pre-trade-validation). |

Errors:

```json
{ "ok": false, "error": { "code": "BAD_REQUEST", "message": "...", "details": { ... } } }
```

Modern codes: `BAD_REQUEST`, `VALIDATION_ERROR` (with `details.fieldErrors`), `UPSTREAM_ERROR`, `NOT_FOUND`, `INTERNAL_ERROR`.

`send_calls` payload:

```json
{
  "chain": "base",
  "calls": [
    { "to": "<data.to>", "value": "<data.value>", "data": "<data.data>" }
  ]
}
```

---

## Units And Scaling

| Surface | Unit behavior |
| --- | --- |
| tx-builder request inputs (`collateralUsdc`, `amountUsdc`, `openPrice`, `takeProfit`, `stopLoss`, `leverage`, `slippagePercent`, `executionFeeEth`) | **Human decimals**, not raw scaled integers |
| tx-builder response `value` | `0x`-prefixed wei (ETH) |
| `data.avantisfi.com /v2/trading` | Human decimals everywhere |
| `core /user-data` `positions[]` and `limitOrders[]` | Raw stringified ints — USDC `/1e6`, prices / leverage / percent / slippage `/1e10` |
| `api.avantisfi.com /v2/history/portfolio/*` | Mixed; mostly human decimals — check each endpoint |
| `api.avantisfi.com /v2/history/referral/stats/*` | USDC fields **already** divided by `1e6` |

Do not pass `1e6` USDC or `1e10` price units into tx-builder query parameters — they take human decimals.

---

## Orchestration Pattern (open trade)

```
get_wallets                                                -> trader address
GET data /v2/trading                                       -> pair config, envelopes, OI, lazerFeed state
GET core /user-data?trader=...                             -> existing positions / limit orders
GET tx-builder /token/approve if allowance missing         -> send_calls preview
GET tx-builder /trade/open                                 -> send_calls preview
poll history /v2/market-order-initiated/status/<txHash>    -> only after a real tx is submitted
GET core /user-data?trader=...                             -> confirm final state
```

For management actions (close, cancel, margin, TP/SL) always read `core /user-data` first and use the **real** `positions[i].index` (positions) or `limitOrders[i].index` (resting orders) as `tradeIndex`. tx-builder will encode call data for an index that does not exist, and the call will then revert on chain.

---

## Step 1 — Pair, Leverage, Liquidity (data API)

```
GET https://data.avantisfi.com/v2/trading
```

Top-level shape:

```json
{
  "dataVersion": 1.5,
  "pairInfos":   { "0": {}, "1": {} },
  "groupInfo":   { "0": {}, "1": {} },
  "pairCount":   102,
  "maxTradesPerPair": 40,
  "totalOi":     38934218.65,
  "maxOpenInterest": 90871359.02
}
```

Use `pairInfos["<pairIndex>"]` to inspect a pair. Important fields:

| Field | Meaning |
| --- | --- |
| `index` | Pair index used by tx-builder and on-chain calls |
| `from`, `to` | Symbol components, e.g. `BTC` and `USD` |
| `isPairListed` | Must be `true` to open new trades |
| `leverages.minLeverage`, `leverages.maxLeverage` | Fixed-fee leverage envelope for `market`, `limit`, `stop_limit` |
| `leverages.pnlMinLeverage`, `leverages.pnlMaxLeverage` | ZFP leverage envelope for `market_zero_fee` |
| `pairMinLevPosUSDC` | Minimum notional: `collateralUsdc × leverage` |
| `pairOI`, `pairMaxOI` | Pair open interest and cap (USDC, human decimals) |
| `groupIndex` | Lookup key into `groupInfo` |
| `feed.attributes.is_open`, `feed.attributes.next_open`, `feed.attributes.next_close` | Market open / schedule |
| `lazerFeed.state` | `stable` → Lazer feed is available; use `priceSourcing=1` (PYTH_LAZER) where needed |

All numeric fields here are already human-decimal — no `1e6` / `1e10` math.

Market-open logic (for `market` orders):

- Open if `feed.attributes.is_open === true`, **or** `now > feed.attributes.next_open` **and** `now < feed.attributes.next_close`.
- Closed if `is_open === false` **and** `next_open > 0` **and** `now < next_open`.

Liquidity check:

```
pairAvail   = pair.pairMaxOI - pair.pairOI
groupAvail  = groupInfo[pair.groupIndex].groupMaxOI - groupInfo[pair.groupIndex].groupOI
available   = min(pairAvail, groupAvail)
positionSize = collateralUsdc × leverage
```

`positionSize` must be `<= available`, otherwise tx-builder will reject with `BAD_REQUEST` (insufficient liquidity).

Minimum-position check (`BELOW_MIN_POS`):

```
if (collateralUsdc × leverage) < pair.pairMinLevPosUSDC -> BAD_REQUEST
minCollateral = ceil(pair.pairMinLevPosUSDC / leverage)
minLeverage   = ceil(pair.pairMinLevPosUSDC / collateralUsdc)
```

The data API is cached server-side (`~5 min` TTL). If you call it directly from a hot path, cache locally too.

---

## Step 2 — Positions and Limit Orders (core backend)

```
GET https://core.avantisfi.com/user-data?trader=<address>
```

Response:

```json
{
  "positions": [
    {
      "trader":           "0x...",
      "pairIndex":        62,
      "index":            0,
      "buy":              false,
      "collateral":       "2000000000",
      "leverage":         "100000000000",
      "openPrice":        "443574692469",
      "tp":               "222108938128",
      "sl":               "479060667866",
      "liquidationPrice": "481278299403",
      "rolloverFee":      "10908",
      "lossProtection":   "1",
      "openedAt":         1758710931,
      "isPnl":            false,
      "isOneCT":          false
    }
  ],
  "limitOrders": [
    {
      "trader":           "0x...",
      "pairIndex":        21,
      "index":            0,
      "buy":              false,
      "block":            35961058,
      "collateral":       "30000000",
      "positionSize":     "3000000000",
      "price":            "37600000000000",
      "leverage":         "1000000000000",
      "tp":               "37528560000000",
      "sl":               "37670000000000",
      "slippageP":        "30000000000",
      "executionFee":     "0",
      "liquidationPrice": "37919600000000",
      "limitOrderType":   0,
      "isOneCT":          false
    }
  ]
}
```

`positions[]` scaling:

| Field | Scaling | Use |
| --- | --- | --- |
| `pairIndex` | — | tx-builder `pairIndex` |
| `index` | — | tx-builder `tradeIndex` |
| `buy` | — | `true` = long, `false` = short |
| `collateral` | `/ 1e6` | Use as `collateralUsdc` when closing full size |
| `leverage` | `/ 1e10` | Display / validation |
| `openPrice`, `tp`, `sl`, `liquidationPrice` | `/ 1e10` | Display / TP-SL decisions |
| `rolloverFee` | `/ 1e6` | Accrued margin fee, USDC |
| `lossProtection` | — | Tier integer (`0` = none) |
| `openedAt` | — | Unix seconds |
| `isPnl` | — | `true` = ZFP trade, `false` = fixed-fee |
| `isOneCT` | — | One-click-trading flag; ignore unless needed |

`limitOrders[]` adds:

| Field | Scaling | Meaning |
| --- | --- | --- |
| `price` | `/ 1e10` | Trigger price |
| `slippageP` | `/ 1e10` | Slippage tolerance percent at execution |
| `block` | — | Block number when the order was registered |
| `positionSize` | `/ 1e6` | `collateral × leverage` (USDC) |
| `executionFee` | `/ 1e6` | Currently `0` |
| `limitOrderType` | — | `0` = `LIMIT`, others reserved |

Unknown or malformed traders return `{ positions: [], limitOrders: [] }`, **not** an error. Treat empty as "no open state", not "lookup failed".

Other core endpoints (rarely needed by agents):

- `GET /open-interests` — per-pair `longOI / shortOI / pendingLongOI / pendingShortOI` (USDC, human decimals).
- `GET /v2/open-interests` — same plus per-market-maker `mmData` breakdown.
- `GET /user-data/config?wallet=0x...` — one-click-trading feature flags. Not a trading-permission gate.
- `GET /health` — plain text `OK`.

Rate-limited at the gateway (`HTTP 429` under load).

---

## Step 3 — Approve USDC

Exact approval:

```
GET https://tx-builder.avantisfi.com/token/approve
  ?trader=<address>
  &amountUsdc=100
```

Unlimited approval (typical for trading bots):

```
GET https://tx-builder.avantisfi.com/token/approve?trader=<address>
```

Optional custom spender:

```
GET https://tx-builder.avantisfi.com/token/approve
  ?trader=<address>
  &amountUsdc=100
  &spender=0x...
```

`spender` defaults to `TradingStorage`. `to` is USDC; `value` is `0x0`. Approval must be confirmed on chain before trade calls that require allowance can succeed, unless approval and action are submitted as a valid batch and the wallet/account contract supports the batch.

---

## Step 4 — Open A Trade

```
GET https://tx-builder.avantisfi.com/trade/open
  ?trader=<address>
  &pair=BTC/USD                  # OR &pairIndex=1
  &side=long                     # long | short
  &orderType=market              # market | limit | stop_limit | market_zero_fee (default market)
  &collateralUsdc=100            # required, > 0
  &leverage=10                   # required; pair envelope + sanity cap 1000
  &slippagePercent=1             # default 1; > 0 and <= 100
  &openPrice=                    # required for limit / stop_limit; optional market override
  &takeProfit=                   # optional, human-decimal price
  &stopLoss=                     # optional, human-decimal price
  &delegate=0x...                # optional; wraps in Trading.delegatedAction(trader, calldata)
  &executionFeeEth=0.00035       # optional override, default ~0.00035 ETH, sanity cap 1 ETH
  &skipValidation=true           # optional, default false; bypasses pre-trade checks
```

### Order types (and on-chain enum)

| `orderType` (skill) | On-chain enum | Numeric | Notes |
| --- | --- | --- | --- |
| `market` | `MARKET` | `0` | Fixed-fee path; `openPrice` auto-resolved if omitted |
| `stop_limit` | `REVERSAL` | `1` | Requires `openPrice` |
| `limit` | `MOMENTUM` | `2` | Requires `openPrice` |
| `market_zero_fee` | `MARKET_PNL` | `3` | Zero-Fee Protocol (ZFP); uses `pnlMinLeverage`..`pnlMaxLeverage` |

Note the **counterintuitive ordering**: `stop_limit=1` and `limit=2`, not the other way round. Important when decoding logs.

`value` on the returned tx is the execution fee in wei.

ZFP example (small notional):

```
GET https://tx-builder.avantisfi.com/trade/open
  ?trader=<address>
  &pair=BTC/USD
  &side=long
  &orderType=market_zero_fee
  &collateralUsdc=1
  &leverage=100
  &slippagePercent=1
```

Limit example with TP/SL:

```
GET https://tx-builder.avantisfi.com/trade/open
  ?trader=<address>
  &pair=BTC/USD
  &side=long
  &orderType=limit
  &openPrice=60000
  &collateralUsdc=200
  &leverage=5
  &takeProfit=75000
  &stopLoss=55000
```

### Pair separators

`pair` accepts `/`, `-`, or `_`. `BTC/USD`, `btc-usd`, `eth_usd` all resolve. Use `&pairIndex=` directly if you already have the integer.

---

## Pre-Trade Validation

`tx-builder` enforces four checks on `/trade/open` before encoding. Each failure is `400 BAD_REQUEST` with a human-readable message:

| Check | Source | Rejects when |
| --- | --- | --- |
| **Pair listed** | data API | `isPairListed === false` |
| **Minimum position** | `pair.pairMinLevPosUSDC` | `collateralUsdc × leverage < pairMinLevPosUSDC` |
| **Leverage envelope** | `leverages.*` | leverage outside `[minLeverage, maxLeverage]` (fixed-fee) or `[pnlMinLeverage, pnlMaxLeverage]` (ZFP) |
| **Liquidity** | `pairMaxOI − pairOI` and `groupMaxOI − groupOI` | `positionSize > min(pairAvail, groupAvail)` |

On success, `meta.validation` carries the computed envelope:

```json
"validation": {
  "positionSizeUsdc": 1000,
  "pairAvailableUsdc": 33683421.1,
  "groupAvailableUsdc": 31539778.34,
  "availableUsdc": 31539778.34,
  "minLeverage": 1,
  "maxLeverage": 75,
  "minPositionUsdc": 100,
  "isZfp": false
}
```

Use this to surface concrete numbers to the user. Do not pass `&skipValidation=true` unless the user explicitly asks.

`BELOW_MIN_POS` recovery: compute `minCollateral = ceil(pair.pairMinLevPosUSDC / leverage)` and `minLeverage = ceil(pair.pairMinLevPosUSDC / collateralUsdc)`, then present both options to the user (within the pair's leverage envelope). Do not silently adjust parameters.

---

## Step 5 — Close, Cancel, Margin, TP/SL

Always read `core /user-data` first and use real indices from the returned arrays.

### Close

```
GET https://tx-builder.avantisfi.com/trade/close
  ?trader=<address>
  &pairIndex=<positions[i].pairIndex>
  &tradeIndex=<positions[i].index>
  &collateralUsdc=<human decimal>      # full collateral for full close; smaller for partial
  &delegate=0x...                      # optional
  &executionFeeEth=0.00035             # optional
```

`value` is the execution fee in wei.

### Cancel resting limit / stop-limit

```
GET https://tx-builder.avantisfi.com/trade/cancel
  ?trader=<address>
  &pairIndex=<limitOrders[i].pairIndex>
  &tradeIndex=<limitOrders[i].index>
  &delegate=0x...                      # optional
```

`value` is `0x0`.

### Deposit / withdraw margin

```
GET https://tx-builder.avantisfi.com/margin/update
  ?trader=<address>
  &pairIndex=<positions[i].pairIndex>
  &tradeIndex=<positions[i].index>
  &action=deposit                      # deposit | withdraw
  &collateralUsdc=50
  &priceUpdateData=0x...               # optional Pyth update bytes
  &priceSourcing=0                     # optional: 0=PYTH_CORE/HERMES, 1=PYTH_LAZER/PRO
  &delegate=0x...                      # optional
```

`value` is `0x1`. When `priceUpdateData` is omitted, tx-builder fetches it from `feed-v3.avantisfi.com` and picks `priceSourcing` based on the pair's Lazer status (`lazerFeed.state === 'stable'` → `1`; otherwise `0`). To run fully offline supply **both** `priceUpdateData` and `priceSourcing`.

### Set / update TP and SL

```
GET https://tx-builder.avantisfi.com/tpsl/update
  ?trader=<address>
  &pairIndex=<positions[i].pairIndex>
  &tradeIndex=<positions[i].index>
  &takeProfit=80000                    # required, > 0
  &stopLoss=65000                      # required; pass 0 to clear SL
  &priceUpdateData=0x...               # optional
  &priceSourcing=0                     # optional, same semantics as /margin/update
  &delegate=0x...                      # optional
```

`value` is `0x1`. Same Pyth auto-fetch behavior as `/margin/update`.

To modify a resting limit order's parameters, cancel it via `/trade/cancel` and create a new `/trade/open` with `orderType=limit` (or `stop_limit`).

---

## Delegated Trading

```
GET https://tx-builder.avantisfi.com/delegate/set?trader=<address>&delegate=<delegateAddress>
GET https://tx-builder.avantisfi.com/delegate/remove?trader=<address>
```

`from` is the trader (only the trader can grant or revoke). `value` is `0x0`. After a delegate is set, any trade-side endpoint accepts `&delegate=<delegateAddress>`; the response `from` becomes the delegate, the delegate signs, and the position still belongs to `trader`.

Only one delegate per trader; `/delegate/set` replaces any prior delegate.

---

## Batching With send_calls

```json
{
  "chain": "base",
  "calls": [
    { "to": "<approve.data.to>", "value": "<approve.data.value>", "data": "<approve.data.data>" },
    { "to": "<open.data.to>",    "value": "<open.data.value>",    "data": "<open.data.data>" }
  ]
}
```

Useful preview batches:

- Approval + open trade.
- Approval + margin deposit.
- Cancel resting order + create replacement limit order.
- Multiple independent generated calls, all on Base, that are logically safe together.

Keep approval before the action that needs allowance. Do not mix chains.

---

## Settlement Polling (history API)

Market opens and closes settle after the submitted transaction emits a `MarketOrderInitiated` event. Only poll when you have a real tx hash from a submitted transaction.

```
GET https://api.avantisfi.com/v2/market-order-initiated/status/<txHash>
```

Response (executed):

```json
{
  "success": true,
  "data": {
    "status":  "executed",
    "orderId": "12345",
    "initiated": {
      "trader":         "0x...",
      "pairIndex":      1,
      "open":           true,
      "timestamp":      1758710900,
      "blockNumber":    35961058,
      "blockTimestamp": 1758710900,
      "txHash":         "0x..."
    },
    "executed": {
      "blockNumber":      35961100,
      "blockTimestamp":   1758710930,
      "logIndex":         12,
      "txHash":           "0x...",
      "orderId":          "12345",
      "t_trader":         "0x...",
      "t_pairIndex":      1,
      "t_index":          0,
      "t_positionSizeUSDC": 100,
      "t_openPrice":      112002.68,
      "t_buy":            true,
      "t_leverage":       10,
      "t_tp":             0,
      "t_sl":             0,
      "open":             true,
      "price":            112002.68,
      "positionSizeUSDC": 100,
      "percentProfit":    0,
      "usdcSentToTrader": 0,
      "isPnl":            false,
      "lossProtectionTier": 0
    }
  }
}
```

`status` is one of:

| status | Blocks present |
| --- | --- |
| `executed` | `initiated` + `executed` |
| `canceled` | `initiated` + `canceled` (`blockNumber`, `blockTimestamp`, `logIndex`, `txHash`, `orderId`, `txFrom`, `trader`, `pairIndex`) |
| `pending` | `initiated` only |

Unknown hashes return HTTP 200 with `{ "success": false, "errorMessage": "Market order not found ..." }`. Treat as still-pending or invalid hash — do not interpret as canceled.

Polling pattern (exponential backoff, ~60 s cap):

```ts
async function waitForSettlement(txHash, maxMs = 60_000) {
  const t0 = Date.now();
  let delay = 500;
  while (Date.now() - t0 < maxMs) {
    const r = await fetch(`https://api.avantisfi.com/v2/market-order-initiated/status/${txHash}`).then(x => x.json());
    if (r.success && r.data.status !== 'pending') return r.data;
    await new Promise(res => setTimeout(res, delay));
    delay = Math.min(delay * 2, 4000);
  }
  throw new Error('settlement timeout');
}
```

Limit fills are not observed through this endpoint. They become regular positions in `core /user-data` and emit `LimitExecuted` events on chain.

---

## History And PnL (history API)

All `api.avantisfi.com` endpoints return **HTTP 200 even on logical failure** and use the legacy envelope:

```json
{ "success": true, "data": ... }
{ "success": false, "errorMessage": "..." }
```

Always check `success` before reading data. `userAddress` must be `0x`-prefixed; the service short-circuits otherwise.

### Endpoint reference

| Endpoint | Purpose |
| --- | --- |
| `GET /v2/history/portfolio/history/:userAddress/:page/:limit?` | Closed trades, paginated. **`page` is 1-indexed** (first page = `1`). `limit` capped at `20`. |
| `GET /v2/history/portfolio/all/:userAddress/:page/:limit?` | All trades (open + closed). Same `page` / `limit` rules as above. |
| `GET /v2/history/portfolio/top/:userAddress` | Top 3 closed trades by net PnL. |
| `GET /v2/history/portfolio/top/:userAddress/:limit?/:timeStamp?` | Top N by net PnL, optionally from a **Unix-seconds** floor. Includes still-open market entries (filter differs from `/top/:userAddress`). |
| `GET /v2/history/portfolio/profit-loss/:userAddress/:grouped?/:startDate?` | Aggregate PnL. `grouped` must be the literal string `grouped` to bucket per `pairIndex`; anything else (including omitted) returns a single combined bucket. `startDate` is anything `new Date(...)` can parse; omit (or pass `false`) for no time filter — internally compared in Unix seconds. |
| `GET /v2/history/referral/stats/:userAddress` | Referral activity (as referrer and as trader). USDC fields here are **pre-divided by 1e6**. |
| `GET /v2/market-order-initiated/status/:txHash` | See [Settlement Polling](#settlement-polling-history-api). |

**Correct page index — examples:**

```
GET https://api.avantisfi.com/v2/history/portfolio/history/<address>/1/20   # ✅ first page
GET https://api.avantisfi.com/v2/history/portfolio/history/<address>/0/20   # ❌ undefined behavior
```

### `/history` response

```json
{
  "success": true,
  "portfolio": [
    {
      "event": {
        "args": {
          "t":                  { "trader": "0x...", "pairIndex": 1, "index": 0 },
          "positionSizeUSDC":   0.98542,
          "price":              112002.68,
          "usdcSentToTrader":   0,
          "_feeInfo":           { "closingFee": 0.147813, "r": 0.222313 }
        }
      },
      "_grossPnl": -0.615294,
      "timeStamp": "2025-09-23T02:54:35.000Z"
    }
  ],
  "count": 70892,
  "pageCount": 7090
}
```

- `event.args.t` is the on-chain `Trade` struct at open time.
- `event.args.positionSizeUSDC` is the **collateral closed in this event**, not the position notional.
- `_grossPnl` is per-close gross PnL in USDC (negative = loss).

### `/all` response adds

```json
{
  "trade":              { "trader": "0x...", "pairIndex": 1, "index": 0 },
  "collateral":         100,
  "positionSize":       1000,
  "executionPrice":     112002.68,
  "isPnl":              false,
  "grossPnl":           -0.615294,
  "netPnl":             -0.815294,
  "openingFee":         0.045,
  "open":               true,
  "timestamp":          1758710931,
  "longTimestamp":      "2025-09-23T02:54:35.000Z",
  "orderId":            123,
  "orderIdOfOpenTrade": 122
}
```

`open` flips from `true` to `false` after the trade closes.

### `/profit-loss` response

```json
{
  "success": true,
  "data": [
    { "total": 1234.56, "totalCollateral": 5000.00, "pairIndex": 1 },
    { "total": -89.20,  "totalCollateral": 2500.00, "pairIndex": 5 }
  ]
}
```

Per-row PnL convention:

- `_mapped_netPnl` when `event.args.isPnl === true` (ZFP).
- `_mapped_grossPnl` otherwise (fixed-fee).

In the **ungrouped** case `pairIndex` is `null`.

### `/referral/stats` response

```json
{
  "success": true,
  "data": {
    "asReferrer": { "totalFees": 12345.67, "totalRebates": 1234.56, "totalTraders": 42 },
    "asTrader":   { "totalVolume": 98765.43, "totalFeeDiscount": 234.56 }
  }
}
```

USDC fields here are already plain decimals (pre-divided by `1e6`).

### Rate limit

History API: ~10 req/s per IP. Batch and cache when possible.

---

## Chat-only fallback: Avantis UI

When the user wants a tx-builder action (open, close, cancel, margin update, TP/SL change, USDC approval, delegate set/remove) and there is no shell, terminal, or direct HTTP tool in the current surface (typical for ChatGPT, Claude.ai):

1. Use `web_request` against `data.avantisfi.com`, `core.avantisfi.com`, or `api.avantisfi.com` to answer the read side of the question (pair info, the user's open positions, recent PnL).
2. Tell the user plainly that signing and submitting Avantis trades from this surface requires the Avantis web UI (or a CLI harness like Claude Code, Codex, or Cursor terminal).
3. Build a deep link to the relevant market and surface it as a clickable link. URL pattern:

   ```
   https://www.avantisfi.com/trade?asset=<SYMBOL>-USD
   ```

   `<SYMBOL>` is the pair's `from` from `pairInfos["<pairIndex>"]` (e.g. `BTC`, `ETH`, `SNDK`). Examples:

   - `https://www.avantisfi.com/trade?asset=ETH-USD`
   - `https://www.avantisfi.com/trade?asset=BTC-USD`
   - `https://www.avantisfi.com/trade?asset=SNDK-USD`

4. If the user already supplied concrete trade parameters (side, leverage, collateral, TP, SL), summarize them in your message so they can reproduce the intent inside the UI. Do not claim the position was opened or modified — the UI flow is user-driven.

Only use this fallback for tx-builder operations. View-only reads continue to work via `web_request` on the same surfaces.

---

## Error Handling

tx-builder error envelope:

```json
{
  "ok": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Position size 0.01 USDC is below the minimum of 100 USDC for BTC/USD (collateral 0.01 x leverage 1)"
  }
}
```

| Code | Meaning |
| --- | --- |
| `VALIDATION_ERROR` | Query shape: bad address, missing required field, out-of-range numeric. `details.fieldErrors` is populated. |
| `BAD_REQUEST` | Pre-trade check failed (delisted, min position, leverage envelope, liquidity) or domain rule violated (e.g. `takeProfit=0`). |
| `UPSTREAM_ERROR` | `data.avantisfi.com` or `feed-v3.avantisfi.com` returned non-2xx. |
| `NOT_FOUND` | Unknown route or pair index lookup miss. |
| `INTERNAL_ERROR` | Unexpected service error. Surface and report. |

History endpoints: HTTP 200 with `success:false` is the normal failure mode. For a wallet with no portfolio, some endpoints return `success:false` with `Unable to get the portfolio.` while others return `success:true` with empty data. Treat as empty/unknown unless the user expected existing history.

Recommended handling:

- Surface validation messages verbatim — they describe the exact constraint that failed.
- For `/trade/open`, inspect `meta.validation` on success and show the user position size, min position, leverage envelope, and available liquidity when useful.
- For management actions, do not rely on tx-builder to prove the position/order exists. Verify via `core /user-data`.
- Never silently retry a `BAD_REQUEST` with adjusted parameters; show options and ask the user.

---

## Sanity Caps (tx-builder server-side)

These are looser than per-pair envelopes — the per-pair check still applies.

| Field | Server cap | Notes |
| --- | --- | --- |
| `leverage` | `<= 1000` | Per-pair max is stricter; see `meta.validation.maxLeverage` |
| `slippagePercent` | `<= 100` | |
| `executionFeeEth` | `<= 1` ETH | Default `~0.00035` |
| `priceUpdateData` | `<= 16 KB` | URL length is the practical limit |

EIP-55 address handling: `trader`, `delegate`, `spender` accept both checksummed and all-lowercase; the service normalizes to checksum in the response.

---

## Scaling Quick Reference (on-chain side)

| Domain | Scale | Example |
| --- | --- | --- |
| Prices, leverage, percentages, slippage | `× 10^10` | `10x` leverage → `100_000_000_000` |
| USDC amounts (collateral, position size, fees) | `× 10^6` | `100 USDC` → `100_000_000` |
| ETH amounts (`value`, execution fee) | `× 10^18` | `0.00035 ETH` → `350_000_000_000_000` |

These apply when reading raw `core /user-data` strings or decoding on-chain logs. tx-builder inputs and `data.avantisfi.com` are always human-decimal.

---

## Current tx-builder Endpoint Inventory

| Endpoint | Calldata? | Purpose | `value` |
| --- | --- | --- | --- |
| `GET /trade/open` | Yes | Open market, ZFP, limit, or stop-limit trade | execution fee wei |
| `GET /trade/close` | Yes | Close (full or partial) | execution fee wei |
| `GET /trade/cancel` | Yes | Cancel a resting limit / stop-limit | `0x0` |
| `GET /margin/update` | Yes | Deposit / withdraw collateral | `0x1` |
| `GET /tpsl/update` | Yes | Update TP and SL | `0x1` |
| `GET /delegate/set` | Yes | Set delegate | `0x0` |
| `GET /delegate/remove` | Yes | Remove delegate | `0x0` |
| `GET /token/approve` | Yes | Approve USDC | `0x0` |
| `GET /pairs` | No | Pair summaries (index + symbol + Lazer flag) | — |
| `GET /pairs/<index>` | No | Single pair detail | — |
| `GET /addresses` | No | Contract addresses on Base | — |
| `GET /health` | No | `{ status:"ok", chainId:8453 }` | — |
| `GET /docs` | No | Swagger UI | — |
| `GET /openapi.json` | No | OpenAPI 3.1 spec | — |

---

## Portfolio Inspection Recipe

To answer "show me my Avantis activity" combine three sources:

| Source | What it returns |
| --- | --- |
| `GET core.avantisfi.com/user-data?trader=<addr>` | Current open positions + resting limit orders |
| `GET api.avantisfi.com/v2/history/portfolio/all/<addr>/1/20` | Page of all trades (open + closed), chronological with PnL |
| `GET api.avantisfi.com/v2/history/portfolio/profit-loss/<addr>/grouped` | Aggregate PnL per pair |

Sketch:

```ts
const [open, history, pnl] = await Promise.all([
  fetch(`https://core.avantisfi.com/user-data?trader=${trader}`).then(r => r.json()),
  fetch(`https://api.avantisfi.com/v2/history/portfolio/all/${trader}/1/20`).then(r => r.json()),
  fetch(`https://api.avantisfi.com/v2/history/portfolio/profit-loss/${trader}/grouped`).then(r => r.json()),
]);

if (!history.success) throw new Error(history.errorMessage);
if (!pnl.success)     throw new Error(pnl.errorMessage);

const openCount    = open.positions.length;
const pendingCount = open.limitOrders.length;
const pnlByPair    = pnl.data.reduce((acc, row) => { acc[row.pairIndex] = row.total; return acc; }, {});
```

Scaling reminders:

- `/user-data` returns raw stringified ints (USDC `/1e6`, prices/leverage `/1e10`).
- `/v2/history/portfolio/all` mixes — most numeric fields are already human decimals.
- `/v2/history/portfolio/profit-loss` returns human decimals rounded to two places.

For top trades, swap `profit-loss` for `/v2/history/portfolio/top/<addr>/5` (top 5 by net PnL).

---

## Cross-Recipe Pattern: Agent Loop

```
loop:
  - read intent (open / close / cancel / tp-sl / margin / approve / delegate)
  - resolve any symbol → pairIndex (data API or tx-builder /pairs)
  - read core /user-data when the action targets an existing position or order
  - build call data (tx-builder /trade/* | /margin/update | /tpsl/update | /delegate/* | /token/approve)
  - if response.ok === false → surface error.message, ask the user, do not silently retry
  - hand { to, data, value } to send_calls; collect tx hash from the approval flow
  - for market opens / closes: poll history /v2/market-order-initiated/status/<txHash> until non-pending
  - re-read core /user-data to confirm state, summarize for the user
```

Every flow above (open, close, cancel, TP/SL, margin, delegate, approve) is one branch of this loop.

---

## Pyth Feeds

Avantis prices flow through Pyth, never Chainlink directly for entry / settlement. Two paths:

| Path | When to use | tx-builder behavior |
| --- | --- | --- |
| **Pyth Core / Hermes** (`priceSourcing=0`) | Every pair has a `feed.feedId` (bytes32). Default for pairs without a stable Lazer feed. | Auto-fetches update bytes from `feed-v3.avantisfi.com /v2/pairs/<pairIndex>/price-update-data` (`core` leg). |
| **Pyth Lazer / Pro** (`priceSourcing=1`) | Pairs with `lazerFeed.state === 'stable'` get faster updates. | Auto-fetches from the same `feed-v3` endpoint and uses the `pro` leg. |

Agents do not normally call Pyth directly — tx-builder fetches the update bytes for `/margin/update` and `/tpsl/update`. Override via `priceUpdateData` + `priceSourcing` only when you have a fresh blob cached and want a fully offline call.

---

## On-Chain `Trade` Tuple

Order matches the on-chain `ITradingStorage.Trade` struct. Useful when reading raw events or debugging:

| # | Field | Type | Scale |
| --- | --- | --- | --- |
| 0 | `trader` | address | — |
| 1 | `pairIndex` | uint256 | — |
| 2 | `index` | uint256 | — (`0` on open; assigned at fill) |
| 3 | `initialPosToken` | uint256 | `× 10^6` (USDC collateral) |
| 4 | `positionSizeUSDC` | uint256 | `× 10^6` (often `0` on open; repurposed as timestamp on chain after open) |
| 5 | `openPrice` | uint256 | `× 10^10` |
| 6 | `buy` | bool | — (`true` = long) |
| 7 | `leverage` | uint256 | `× 10^10` |
| 8 | `tp` | uint256 | `× 10^10` (`0` = none) |
| 9 | `sl` | uint256 | `× 10^10` (`0` = none) |
| 10 | `timestamp` | uint256 | usually `0`; contract overrides |

`Trading.openTrade(t, type, slippageP)` — `type` is the `OpenLimitOrderType` enum from [Step 4 — Open A Trade](#step-4--open-a-trade); `slippageP` is `× 10^10` percent.

---

## Events Worth Indexing

If your agent indexes Avantis logs (rather than polling APIs):

| Event | When |
| --- | --- |
| `MarketOrderInitiated(orderId, trader, pairIndex, open)` | A market open / close has been queued |
| `MarketExecuted(orderId, t, open, price, positionSizeUSDC, percentProfit, usdcSentToTrader, isPnl, lossProtectionTier)` | Market order settled |
| `LimitExecuted(orderId, t, ...)` | Limit / stop-limit triggered |
| `OpenLimitPlaced` / `OpenLimitUpdated` / `OpenLimitCanceled` | Resting-limit lifecycle |
| `MarginUpdated` | Collateral deposit / withdrawal |
| `TpUpdated` / `SlUpdated` | TP / SL change |

`orderId` from `MarketOrderInitiated` (or just the `txHash`) is what to feed into `/v2/market-order-initiated/status/<txHash>`.

---

## Key Thresholds

| Constant | Value | Meaning |
| --- | --- | --- |
| Liquidation threshold | ~85% | Position liquidates once loss exceeds ~85% of collateral |
| Max stop-loss distance | 80% | `_MAX_SL_P` |
| Max slippage | 80% | `_MAX_SLIPPAGE` |
| Max execution / keeper reward | 10 USDC | `_MAX_EXEC_REWARD` |
| Default execution fee | 0.00035 ETH | Used by tx-builder when `executionFeeEth` omitted |
| Margin-withdraw threshold | 80% | Withdrawals must keep position above ~20% effective collateral |
