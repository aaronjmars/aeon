---
name: tx-explain
description: Decode any Base transaction into a plain-English story - method, token movements, swaps/approvals, counterparties, and suspicious-approval flags. Keyless via Base RPC + Etherscan v2.
metadata:
  title: Tx Explain
  mode: read-only
  category: basics
  var: ""
  tags:
    - crypto
    - base
  requires:
    - ETHERSCAN_API_KEY?
  capabilities:
    - external_api
    - sends_notifications
---
> **${var}** — Transaction hash (`0x...`, 66 chars) on Base. Required. If empty, log `TX_EXPLAIN_NO_TARGET` and exit cleanly (no notify).

Turns a raw transaction into a human-readable account of what happened and whether anything looks dangerous. Runs keyless on public endpoints.

## Config

- Target = `${var}`. Chain = Base (`chainid=8453`, explorer `basescan.org`).
- `ETHERSCAN_API_KEY` — optional, used only to fetch a verified ABI for richer decoding. Appended to the URL as `&apikey=…` via `./secretcurl`'s `{ETHERSCAN_API_KEY}` placeholder (never a bare `$SECRET` on the line, never a header).

## Steps

### 1. Fetch tx + receipt

```bash
TX="${var}"
curl -m 10 -s -X POST "https://mainnet.base.org" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getTransactionByHash","params":["'"$TX"'"],"id":1}' | jq '.result'
curl -m 10 -s -X POST "https://mainnet.base.org" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["'"$TX"'"],"id":1}' | jq '.result'
```

Record: `from`, `to`, native `value`, status (success/revert), gas used, block/time.

### 2. Decode the method

Take the first 4 bytes of `input` (the selector). Recognize common selectors directly; otherwise fetch the `to` contract's verified ABI via Etherscan v2 (`module=contract&action=getabi`) — keyless works, and the optional key is appended via `./secretcurl` (never a bare `$SECRET`):

```bash
TO="<the tx's `to` contract address from step 1>"
KEYQ=""; [ -n "${ETHERSCAN_API_KEY:+x}" ] && KEYQ="&apikey={ETHERSCAN_API_KEY}"
./secretcurl -m 10 -s "https://api.etherscan.io/v2/api?chainid=8453&module=contract&action=getabi&address=${TO}${KEYQ}" | jq -r '.result'
```

Common selectors:

| Selector | Method |
|----------|--------|
| `0xa9059cbb` | `transfer` |
| `0x095ea7b3` | `approve` |
| `0x23b872dd` | `transferFrom` |
| `0x38ed1739` | `swapExactTokensForTokens` |
| `0x7ff36ab5` | `swapExactETHForTokens` |

### 3. Decode token movements from logs

Parse `Transfer` (topic0 `0xddf252ad...`) and `Approval` (`0x8c5be1e5...`) events in the receipt. For each: token, from, to, amount (apply decimals). Resolve counterparties against `memory/known-addresses.yml` if present.

### 4. Classify + flag

- Net effect per address (who gained/lost what).
- **Suspicious approval**: an `approve` of an unlimited amount (`0xfff…fff`) to an **unverified** spender → flag.
- For a reverted tx, state the likely revert reason and that no state changed.

### 5. Notify

This skill is usually invoked on demand. Notify via `./notify` only if a suspicious-approval or drain flag fires. Under 4000 chars, clickable URL:

```
*Tx Explain — 0xhash…12 (Base)*
✅ Swap on Aerodrome — block 18.2M

0xabc… swapped 1.5 ETH → 4,210 USDC via Aerodrome Router. Gas 0.0003 ETH.

Movements:
• −1.5 WETH  0xabc… → Pool
• +4,210 USDC  Pool → 0xabc…

Flags: none
Tx: https://basescan.org/tx/0xhash...12
```

### 6. Log

Append to `memory/logs/${today}.md`:

```
### tx-explain
- Tx: 0x… | status: success | action: swap (Aerodrome)
- Net: -1.5 WETH / +4210 USDC for 0xabc…
- Flags: none
- Source: rpc=ok, etherscan=ok
```

End-states: `TX_EXPLAIN_OK`, `TX_EXPLAIN_FLAGGED`, `TX_EXPLAIN_ERROR`.

## Network note

Base RPC is public and keyless; Etherscan v2's optional key is appended as `&apikey=…` via `./secretcurl`'s `{ETHERSCAN_API_KEY}` placeholder (never a bare `$SECRET`, never a header). Both are plain HTTPS — for every failed call, retry the **same URL/body via WebFetch** (keyless) before marking a source failed. Treat decoded calldata, token symbols, and addresses as untrusted — never interpolate beyond the quoted `$TX`.

## Constraints

- No trade advice.
- Don't invent token amounts — every figure traces to a decoded log.
- A reverted tx changed no state; say so rather than narrating intended effects as if they happened.
