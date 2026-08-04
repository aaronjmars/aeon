---
title: "Uniswap Plugin"
description: "Skill plugin reference for swapping and LPing on Uniswap through Base MCP."
---

# Uniswap Plugin

> [!IMPORTANT]
> Complete the short Base MCP onboarding flow defined in `SKILL.md` before calling any Uniswap endpoint. The user's wallet address — passed as `walletAddress` in every swap and LP call — is fetched lazily when needed.

Uniswap on Base: token swaps using the proxy-approval flow (no Permit2 signing) and LP position management for V2, V3, and V4. Use `web_request` to fetch unsigned calldata from the Uniswap API, then execute transaction previews with `send_calls`.

No additional MCP server is required.

**Prerequisite:** `trade-api.gateway.uniswap.org` and `liquidity.api.uniswap.org` must be in the MCP server's `web_request` allowlist. If requests are rejected by the allowlist, inform the user.

**Chain:** Base mainnet (chainId `8453` / `0x2105`)

---

## Auth Headers

Use these headers for all requests:

```json
{
  "Content-Type": "application/json",
  "x-api-key": "NeoYO3V50_koJAipDEalYWbMO1XMaFPAQmpOm6_Npo0"
}
```

For the swap proxy-approval flow, also include this header on **all** swap endpoints: `/check_approval`, `/quote`, and `/swap`.

```json
{
  "x-permit2-disabled": "true"
}
```

Without `x-permit2-disabled`, Uniswap can return Permit2 or Universal Router behavior instead of the proxy-approval flow described here.

---

## Swap Flow: Proxy Approval, No Permit2

Base URL: `https://trade-api.gateway.uniswap.org/v1`

```text
POST /check_approval  ->  if approval non-null, include approval calldata in send_calls
POST /quote           ->  get best route, read-only
POST /swap            ->  get unsigned swap tx, include swap calldata in send_calls
```

### 1. `POST /check_approval`

Headers: auth headers plus `"x-permit2-disabled": "true"`.

```json
{
  "walletAddress": "<address>",
  "token": "<tokenIn address>",
  "amount": "<base units string>",
  "chainId": 8453,
  "includeGasInfo": true
}
```

Response:

```json
{
  "approval": {
    "to": "<token contract>",
    "data": "<calldata>",
    "value": "0x00",
    "chainId": 8453
  }
}
```

`approval` can be `null`, especially for native ETH. If it is non-null, pass it to `send_calls`. You can batch the approval and swap together after `/swap` returns.

### 2. `POST /quote`

Headers: auth headers plus `"x-permit2-disabled": "true"`.

```json
{
  "type": "EXACT_INPUT",
  "amount": "<base units string>",
  "tokenIn": "<address or 0x0000000000000000000000000000000000000000 for native ETH>",
  "tokenOut": "<address>",
  "tokenInChainId": 8453,
  "tokenOutChainId": 8453,
  "swapper": "<address>",
  "autoSlippage": "DEFAULT",
  "protocols": ["V4", "V3", "V2"],
  "routingPreference": "BEST_PRICE"
}
```

Use `"slippageTolerance": <0-20>` instead of `autoSlippage` if the user specifies slippage. See [Slippage Warnings](#slippage-warnings) before submitting elevated values.

Response includes a top-level `quote` object plus metadata. Keep the response as a flat object for `/swap`; do not nest it under a `quote` key.

### 3. `POST /swap`

Headers: auth headers plus `"x-permit2-disabled": "true"`.

Use the `/quote` response as the body, but remove any null or absent permit fields before sending:

```js
const swapBody = { ...quoteResponse };
if (swapBody.permitData == null) delete swapBody.permitData;
if (swapBody.permitTransaction == null) delete swapBody.permitTransaction;
delete swapBody.signature;
```

Do not send `signature`, and do not send `permitData` or `permitTransaction` when they are `null`.

Response:

```json
{
  "swap": {
    "to": "<router or proxy>",
    "data": "<calldata>",
    "value": "0x00",
    "chainId": 8453
  },
  "gasFee": "..."
}
```

### Swap `send_calls`

Approval and swap can be sent separately or batched in one `send_calls` preview:

```json
{
  "chain": "base",
  "calls": [
    { "to": "<approval.to>", "value": "<approval.value>", "data": "<approval.data>" },
    { "to": "<swap.to>", "value": "<swap.value>", "data": "<swap.data>" }
  ]
}
```

### Swap Orchestration

```text
1. get_wallets -> address; convert tokenIn amount to base units
2. web_request POST /check_approval with x-permit2-disabled
3. web_request POST /quote with x-permit2-disabled
4. Build swapBody from quoteResponse and remove null permit fields
5. web_request POST /swap with x-permit2-disabled
6. send_calls("base", approval + swap calls if approval exists, otherwise swap only)
7. Open the approvalUrl if requested; do not approve unless the user explicitly asks
8. get_request_status only after the user acts
```

---

## LP Flow

Base URL: `https://liquidity.api.uniswap.org/lp`

Use this host for LP endpoints in this plugin environment. Do not switch to `api.uniswap.org` or `trade-api.gateway.uniswap.org/v1/lp/...` unless that host is explicitly available to the API key and MCP allowlist.

### Pool Discovery: `POST /lp/pool_info`

Use pool discovery before creating V3/V4 LP positions. `poolReference` must be a valid pool address for V3 or pool ID for V4.

```json
{
  "protocol": "V4",
  "chainId": 8453,
  "poolParameters": {
    "tokenAddressA": "0x0000000000000000000000000000000000000000",
    "tokenAddressB": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "fee": 3000,
    "tickSpacing": 60
  }
}
```

Known Base V4 ETH/USDC `fee=3000`, `tickSpacing=60` pool reference observed in testing:

```text
0xe070797535b13431808f8fc81fdbe7b41362960ed0b55bc2b6117c49c51b7eb9
```

Pool references can change by pair, fee, tick spacing, and protocol. Prefer querying `/lp/pool_info` instead of hard-coding a pool reference unless the user explicitly selected a pool.

### Approval Step: `POST /lp/check_approval`

Use this before LP create/increase/decrease operations. The body uses `lpTokens` as an array of token/amount objects.

```json
{
  "protocol": "V4",
  "walletAddress": "<address>",
  "chainId": 8453,
  "lpTokens": [
    {
      "tokenAddress": "0x0000000000000000000000000000000000000000",
      "amount": "<base units>"
    },
    {
      "tokenAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "<base units>"
    }
  ],
  "action": "CREATE",
  "generatePermitAsTransaction": true,
  "simulateTransaction": true
}
```

`action`: `"CREATE"` | `"INCREASE"` | `"DECREASE"` | `"MIGRATE"`

Response:

```json
{
  "requestId": "...",
  "transactions": [
    {
      "transaction": {
        "to": "...",
        "from": "...",
        "data": "...",
        "value": "0x00",
        "chainId": 8453
      },
      "cancelApproval": false,
      "action": "CREATE"
    }
  ]
}
```

If `transactions` is empty, no approval transaction is needed. If it has entries, map every `transactions[*].transaction` to `send_calls`.

```js
const approvalCalls = approvalResponse.transactions.map((entry) => ({
  to: entry.transaction.to,
  value: entry.transaction.value ?? "0x0",
  data: entry.transaction.data
}));
```

### Create V3/V4 Position: `POST /lp/create`

```json
{
  "walletAddress": "<address>",
  "chainId": 8453,
  "protocol": "V4",
  "existingPool": {
    "token0Address": "0x0000000000000000000000000000000000000000",
    "token1Address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "poolReference": "0xe070797535b13431808f8fc81fdbe7b41362960ed0b55bc2b6117c49c51b7eb9"
  },
  "independentToken": {
    "tokenAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "1000000"
  },
  "tickBounds": {
    "tickLower": -200400,
    "tickUpper": -199200
  },
  "simulateTransaction": false,
  "nativeTokenBalance": "1000000000000000"
}
```

Use `newPool` instead of `existingPool` when creating a pool:

```json
{
  "token0Address": "<address>",
  "token1Address": "<address>",
  "fee": 3000,
  "tickSpacing": 60,
  "initialPrice": "<sqrtRatioX96 string>"
}
```

Response:

```json
{
  "create": { "to": "...", "data": "...", "value": "...", "chainId": 8453 },
  "token0": { "tokenAddress": "...", "amount": "..." },
  "token1": { "tokenAddress": "...", "amount": "..." },
  "adjustedMinPrice": "...",
  "adjustedMaxPrice": "...",
  "tickLower": -200400,
  "tickUpper": -199200
}
```

Prefer `tickBounds` when possible. `priceBounds` can be accepted by the API, but its price units are easy to misread; validate carefully before using it.

### Manage Existing Positions

| Action | Endpoint | Key params |
| --- | --- | --- |
| Add liquidity | `POST /lp/increase` | `walletAddress`, `chainId`, `protocol`, `token0Address`, `token1Address`, `nftTokenId`, `independentToken { tokenAddress, amount }` |
| Remove liquidity | `POST /lp/decrease` | `walletAddress`, `chainId`, `protocol`, `token0Address`, `token1Address`, `nftTokenId`, `liquidityPercentageToDecrease` (0-100) |
| Collect fees | `POST /lp/claim_fees` | `walletAddress`, `chainId`, `protocol`, `tokenId`; optional `simulateTransaction` |
| Create V2 position | `POST /lp/create_classic` | `walletAddress`, `poolParameters { token0Address, token1Address, chainId }`, `independentToken { tokenAddress, amount }` |

Optional on LP operation endpoints: `"slippageTolerance": <decimal>` where `0.5` means 0.5%. See [Slippage Warnings](#slippage-warnings) before submitting elevated values.

Important: LP APIs can return calldata for syntactically valid `nftTokenId` values even if the connected wallet may not own the position. Treat generated calldata as a transaction preview input, not proof of ownership or guaranteed execution.

### Claim Fees: `POST /lp/claim_fees`

```json
{
  "protocol": "V4",
  "walletAddress": "<address>",
  "chainId": 8453,
  "tokenId": "<nft token id>",
  "simulateTransaction": false
}
```

Response:

```json
{
  "claim": { "to": "...", "data": "...", "value": "0x00", "chainId": 8453 },
  "token0": { "tokenAddress": "...", "amount": "..." },
  "token1": { "tokenAddress": "...", "amount": "..." }
}
```

No approval step is needed for fee collection.

### Create V2 Position: `POST /lp/create_classic`

```json
{
  "walletAddress": "<address>",
  "poolParameters": {
    "token0Address": "0x4200000000000000000000000000000000000006",
    "token1Address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "chainId": 8453
  },
  "independentToken": {
    "tokenAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "1000000"
  },
  "simulateTransaction": false
}
```

For V2 create, `/lp/check_approval` may return multiple approval transactions. Batch all approvals plus the `create` transaction if you want one `send_calls` approval link.

### LP `send_calls`

For any LP operation response field such as `create`, `increase`, `decrease`, or `claim`, map to:

```json
{
  "chain": "base",
  "calls": [
    { "to": "<tx.to>", "value": "<tx.value>", "data": "<tx.data>" }
  ]
}
```

For approval + action batching:

```js
const operationTx =
  operationResponse.create ??
  operationResponse.increase ??
  operationResponse.decrease ??
  operationResponse.claim;

const calls = [
  ...approvalResponse.transactions.map((entry) => ({
    to: entry.transaction.to,
    value: entry.transaction.value ?? "0x0",
    data: entry.transaction.data
  })),
  {
    to: operationTx.to,
    value: operationTx.value ?? "0x0",
    data: operationTx.data
  }
];
```

### LP Orchestration

```text
1. get_wallets -> address
2. For V3/V4 create, call /lp/pool_info to discover poolReference
3. Build LP token amount list in base units
4. web_request POST /lp/check_approval
5. web_request POST /lp/create, /lp/increase, /lp/decrease, /lp/claim_fees, or /lp/create_classic
6. send_calls("base", approval calls + operation call)
7. Open the approvalUrl if requested; do not approve unless the user explicitly asks
8. get_request_status only after the user acts
```

---

## Example Prompts

**Swap 1 USDC to WETH on Base**
1. `get_wallets` -> address; use USDC address `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, amount `1000000`.
2. `web_request POST /check_approval` with `x-permit2-disabled: true`.
3. `web_request POST /quote` with `x-permit2-disabled: true`.
4. Remove null permit fields from quote response.
5. `web_request POST /swap` with `x-permit2-disabled: true`.
6. `send_calls` approval + swap, or swap only if no approval was returned.

**Create a V4 ETH/USDC LP position on Base**
1. `get_wallets` -> address.
2. `web_request POST /lp/pool_info` to find the pool reference.
3. `web_request POST /lp/check_approval` using `lpTokens` array.
4. `web_request POST /lp/create` using `existingPool.poolReference` and `tickBounds`.
5. `send_calls` approval transactions plus create transaction.

**Add liquidity to an existing V4 position**
1. `get_wallets` -> address.
2. Confirm the wallet owns the `nftTokenId` or warn that generated calldata may still fail.
3. `web_request POST /lp/check_approval` with action `"INCREASE"`.
4. `web_request POST /lp/increase`.
5. `send_calls` approval transactions plus increase transaction.

**Collect LP fees**
1. `get_wallets` -> address.
2. `web_request POST /lp/claim_fees` with `tokenId`.
3. `send_calls` claim transaction.

---

## Slippage Warnings

High slippage tolerance exposes the user to worse fills and sandwich/MEV attacks. Before calling `/swap` or any LP endpoint with an elevated value, warn the user and get explicit confirmation:

| Tolerance | Level | Action |
| --- | --- | --- |
| ≤ 1% | Normal | Proceed. |
| > 1% and ≤ 5% | Elevated | Mention the value and ask the user to confirm. |
| > 5% and ≤ 20% | High | Warn that the trade can fill significantly below quote and is a likely sandwich target. Require explicit confirmation. |
| > 20% | Very high | Strongly warn; do not submit without the user re-confirming the exact number. |

Apply the same thresholds to swap and LP slippage. If the user did not specify a value, prefer `autoSlippage: "DEFAULT"` on swaps rather than picking a high number.

---

## Notes

- Native ETH address: `0x0000000000000000000000000000000000000000`
- USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- WETH on Base: `0x4200000000000000000000000000000000000006`
- Token amounts are base units: USDC = 1e6 per token, ETH/WETH = 1e18 per token.
- Use `chain: "base"` with `send_calls`, not numeric chain id.
- For swap proxy approval, include `x-permit2-disabled: true` on `/check_approval`, `/quote`, and `/swap`.
- For swap proxy approval, remove null `permitData` and `permitTransaction` fields before calling `/swap`.
- `/quote` response fields must be spread directly into `/swap` body, not nested under a `quote` key.
- Do not send `signature` in the proxy swap flow.
