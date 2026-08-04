---
title: "Bankr Plugin"
description: "Skill plugin reference for discovering the latest token launches on Base via the Bankr API and buying them with Base MCP's swap tool."
---

# Bankr Plugin

> [!IMPORTANT]
> Complete the short Base MCP onboarding flow defined in `SKILL.md` before calling any Bankr flow. This plugin reads from the Bankr public API and then routes the actual purchase through Base MCP's `swap` tool — there is no separate Bankr MCP server.

[Bankr](https://bankr.bot) is a launch and discovery surface for tokens on Base. The public API exposes the latest deployed token launches (name, symbol, contract address, deployer, links). This plugin uses that feed to surface fresh launches to the user, then buys the selected token through Base MCP's `swap` tool — Bankr is only the discovery layer; the swap is a regular Base MCP `swap` call paying ETH (or USDC) for the target ERC-20.

No additional MCP server is required.

**Prerequisite:** `api.bankr.bot` must be on the Base MCP `web_request` allowlist. If requests are rejected, inform the user and fall back to the harness's HTTP/fetch tool if one is available.

**Chain:** Base mainnet (chainId `8453` / `0x2105`)

---

## API

Base URL: `https://api.bankr.bot`

### `GET /token-launches`

Returns the most recent token launches on Base, newest first. No auth required, no query parameters.

```json
{
  "launches": [
    {
      "activityId": "6a1067ea1d736e44884096d5",
      "status": "deployed",
      "launchType": "doppler",
      "tokenName": "Whop",
      "tokenSymbol": "WHOP",
      "chain": "base",
      "tokenAddress": "0xe7d8e68525af7e10a16724bbd3001c0828828ba3",
      "poolId": "0x2fee469c920ad9cd8d7fed1510c6034531e0f9fb7c94dbeea35623a358b7580f",
      "txHash": "0xc989ca12...",
      "deployer": {
        "walletAddress": "0x67cb...",
        "xUsername": "TheLordSherlock",
        "xProfileImageUrl": "https://pbs.twimg.com/..."
      },
      "feeRecipient": { "walletAddress": "0xccebfd...." },
      "tweetUrl": "https://x.com/i/status/...",
      "websiteUrl": "https://whop.com",
      "metadataUri": "ipfs://bafkrei...",
      "timestamp": 1779460074566
    }
  ]
}
```

Field notes:

- `tokenAddress` — the ERC-20 contract on Base. Pass this verbatim to `swap` as `toAsset`.
- `status` — always `"deployed"` in the current feed; treat anything else as a non-tradable preview and skip.
- `chain` — always `"base"` in the current feed; skip anything else.
- `launchType` — currently `"doppler"` (Doppler v3/v4 pools). Other values may appear later; the swap path is the same as long as the token has a tradeable pool.
- `timestamp` — milliseconds since epoch (note: more than 13 digits in the sample because the API uses a high-precision counter; treat as monotonically decreasing in array order).
- `deployer.xUsername`, `tweetUrl`, `websiteUrl` — optional context to surface to the user before they buy.

The API returns roughly 50 launches per call. There is no pagination parameter; if you need older launches, you'll see them shift out as new ones land.

### `GET /token-launches/{tokenAddress}`

Returns a single launch's metadata by token contract address. The address is case-insensitive (the API lowercases it on the response). No auth required.

```text Example
GET https://api.bankr.bot/token-launches/0x32F66Ec2Ffb26d262058965cf294F951e47F8ba3
```

```json
{
  "launch": {
    "activityId": "69b0716db2c1b3e9b71c7290",
    "status": "deployed",
    "launchType": "doppler",
    "tokenName": "AGNT SOCIAL",
    "tokenSymbol": "AGNT",
    "chain": "base",
    "imageUri": "ipfs://bafkrei...",
    "tokenAddress": "0x32f66ec2ffb26d262058965cf294f951e47f8ba3",
    "poolId": "0xebe171fc...",
    "txHash": "0x58155b40...",
    "deployer": {
      "walletAddress": "0x58584e...",
      "xUsername": "SirKekius67",
      "xProfileImageUrl": "https://pbs.twimg.com/..."
    },
    "feeRecipient": { "walletAddress": "0xe8737f...", "xUsername": "Tuteth_" },
    "tweetUrl": "https://x.com/...",
    "metadataUri": "ipfs://bafkrei...",
    "timestamp": 1773171053648
  }
}
```

Same field shape as items in the list endpoint, with one addition:

- `imageUri` — IPFS URI for the token's image/logo (only returned by the single-launch endpoint, not the list endpoint).

Use this endpoint when the user names a token by **address** (instead of picking from the latest-launches list) — for confirmation before swapping, or to enrich an address the user pasted from elsewhere. If the address isn't in Bankr's index the API returns a 404; fall back to a regular swap and warn that the token wasn't found in the Bankr launches feed.

---

## Orchestration

```text
1. web_request GET https://api.bankr.bot/token-launches
2. Filter to status="deployed" and chain="base", take the first N (default 5–10)
3. Show the user a compact list (symbol — name, deployer @handle, age)
4. Wait for the user to pick one and confirm an amount
5. get_wallets → address (only if not already cached)
6. swap (Base MCP) with fromAsset=ETH (or USDC), toAsset=<tokenAddress>, amount=<human-readable amount>
7. Open the approvalUrl
8. get_request_status only after the user acts
```

Do not auto-buy. Always require an explicit "buy X amount of `<symbol>`" confirmation from the user before calling `swap` — the launches feed contains low-liquidity and meme tokens, and the swap is irreversible.

### Discovery call

```text
web_request:
  method: GET
  url: https://api.bankr.bot/token-launches
```

Filter client-side:

```js
const fresh = response.launches
  .filter((l) => l.status === "deployed" && l.chain === "base")
  .slice(0, 10);
```

### Presenting launches to the user

Surface enough context that the user can judge whether to buy — at minimum: symbol, name, deployer handle (if any), website/tweet link, and how recent the launch is. Do **not** echo the full IPFS metadata or all 50 entries; that's noise.

Example summary line per launch:

```text
WHOP — Whop · by @TheLordSherlock · launched 2m ago · whop.com
  0xe7d8e68525af7e10a16724bbd3001c0828828ba3
```

### Swap call

The actual purchase is a regular Base MCP `swap` call. Read the `swap` tool's own parameter descriptions from the MCP — they are the source of truth. Typical shape:

```json
{
  "chain": "base",
  "fromAsset": "ETH",
  "toAsset": "<launch.tokenAddress>",
  "amount": "0.001"
}
```

- `fromAsset`: use a supported symbol like `ETH` or `USDC`, or a contract address when needed.
- `toAsset`: use the launch token contract address.
- `amount`: human-readable decimal amount of `fromAsset`. For 0.001 ETH pass `"0.001"`; for 5 USDC pass `"5"`.

The `swap` tool returns an `approvalUrl` and `requestId` like any other write call. Surface the URL to the user neutrally ("Approve Swap"), then poll `get_request_status` once they've acted. The full approval/polling pattern is in [`../references/approval-mode.md`](../references/approval-mode.md).

---

## Example Prompts

**Show me the latest token launches on Base**
1. `web_request` GET `https://api.bankr.bot/token-launches`.
2. Filter to `status="deployed"` and `chain="base"`; take the top 10.
3. Show symbol, name, deployer handle, website/tweet, and contract address.
4. Do **not** auto-buy. Ask the user which one (and how much) they want.

**Buy 0.001 ETH worth of the newest token on Bankr**
1. `web_request` GET `https://api.bankr.bot/token-launches`.
2. Take `launches[0]` (or the first one matching `status="deployed"`).
3. Show: symbol, name, address, deployer. Ask the user to confirm — "Buy 0.001 ETH of `<SYMBOL>` (`<address>`)?".
4. On confirmation: `swap` with `fromAsset=ETH`, `toAsset=<launch.tokenAddress>`, `amount="0.001"`, `chain="base"`.
5. Open the approval URL; poll `get_request_status` once the user has approved.

**Buy 5 USDC of $WHOP**
1. `web_request` GET `https://api.bankr.bot/token-launches`.
2. Find the entry with `tokenSymbol="WHOP"`; if multiple, prefer the most recent and confirm the contract address with the user.
3. `swap` with `fromAsset=USDC`, `toAsset=<launch.tokenAddress>`, `amount="5"`, `chain="base"`.
4. Open the approval URL; poll.

**Are there any launches from @0xtinylabs in the last hour?**
1. `web_request` GET `https://api.bankr.bot/token-launches`.
2. Filter by `deployer.xUsername === "0xtinylabs"` and `timestamp` within the last hour (use the array's relative ordering — the feed is newest first).
3. List matches with symbol, name, address, tweet/website.

**What is this token? 0x32F66Ec2Ffb26d262058965cf294F951e47F8ba3**
1. `web_request` GET `https://api.bankr.bot/token-launches/0x32F66Ec2Ffb26d262058965cf294F951e47F8ba3`.
2. If 200: summarize `tokenName`, `tokenSymbol`, deployer handle, tweet/website, and launch age from `timestamp`.
3. If 404: tell the user the address isn't in Bankr's launches index; offer to swap anyway via the regular `swap` flow with extra confirmation.

**Buy 0.001 ETH of 0x32F66Ec2Ffb26d262058965cf294F951e47F8ba3**
1. `web_request` GET `https://api.bankr.bot/token-launches/0x32F66Ec2Ffb26d262058965cf294F951e47F8ba3` to confirm symbol/name/deployer.
2. Show those details and ask the user to confirm — "Buy 0.001 ETH of `<SYMBOL>` (`<address>`)?".
3. On confirmation: `swap` with `fromAsset=ETH`, `toAsset=<address>`, `amount="0.001"`, `chain="base"`.
4. Open the approval URL; poll.

---

## Execution Warnings

New launches commonly have thin liquidity and volatile prices. Base MCP's core `swap` tool does not expose a slippage parameter, so do not invent one. Warn the user that fresh-launch swaps may revert or fill at a materially worse price, then require explicit confirmation of the token address and amount before calling `swap`.

---

## Safety Notes

- **Symbol collisions.** Multiple launches can share the same symbol (the sample feed contains three `simstudioai` launches with different symbols and addresses). Always disambiguate by `tokenAddress` and confirm with the user before swapping.
- **No endorsement.** The Bankr feed is unfiltered. The Base MCP and this plugin do not vet, endorse, or audit listed tokens — many are low-liquidity, short-lived, or meme tokens. Mention this once before the first buy of a session.
- **Adversarial metadata.** Token names, symbols, deployer handles, and website URLs are user-supplied and can be misleading or impersonate legitimate projects. Don't follow links from the feed; surface them to the user for context only.
- **Address case.** Pass `tokenAddress` to `swap` verbatim — lowercased addresses from the API work fine; do not re-checksum or modify them.
- **Buy size.** Do not propose a default buy amount. The user must specify the amount.

---

## Notes

- Native ETH address: `0x0000000000000000000000000000000000000000`
- USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- WETH on Base: `0x4200000000000000000000000000000000000006`
- Swap amounts are human-readable decimals for `fromAsset`. If you ever use a contract address as `fromAsset`, include that token's `fromDecimals`.
- Always use `chain: "base"` (string) with `swap`, not the numeric chainId.
- The feed updates frequently (new launches every few minutes during peak hours). If the user asks "what's brand new", fetch again rather than reusing an earlier response.
