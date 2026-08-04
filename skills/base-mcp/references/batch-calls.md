---
title: "Batched Contract Calls"
description: "Skill reference for Base MCP's EIP-5792 batched contract calls."
---

# Batched Contract Calls (EIP-5792)

Base MCP exposes a batched-calls tool (typically `send_calls`) that submits multiple contract calls for a single user approval. Use it for arbitrary contract interactions, multi-step transactions, or any flow that combines an approval with a follow-up action.

> **Batching is preferred whenever a flow involves a token approval followed by a protocol action** (approve + deposit, approve + supply, approve + swap, etc.). Also batch whenever a plugin or protocol endpoint returns multiple transactions in a single response. Don't split these into sequential single-`send` calls when one batched approval can execute them atomically.

## When to use

- Protocol interactions not covered by `send` or `swap` (DeFi, NFT mints, approvals, governance actions).
- Combining multiple operations into one user approval.
- Executing a transaction array returned by a plugin's prepare-style endpoint — pass the array straight through.

## Shape

The MCP advertises the exact parameter names and types — defer to its tool description. The general shape is:

- A `chain` string (`base`, `base-sepolia`, `ethereum`, `optimism`, `polygon`, `arbitrum`, `bsc`, or `avalanche`).
- A `calls` array of `{ to, value, data }` objects:
  - `to` — target address, `0x`-prefixed (required)
  - `value` — hex ETH in wei (e.g. `0x0`), optional
  - `data` — calldata hex, optional

## Approval flow

Same as any write tool: the response returns an approval URL and request ID. See [approval-mode.md](approval-mode.md).

## Generic orchestration

```
plugin or protocol API → { transactions: [...] } (or equivalent)
   ↓ map each transaction to a { to, value, data } call
batched-calls tool (chain, calls) → approval URL + request ID
   ↓ user approves
status-poll tool (request ID) → confirmed
```
