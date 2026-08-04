---
title: "Virtuals Plugin"
description: "Skill plugin reference for creating and operating Virtuals (ACP) AI agents through the Virtuals MCP, signed in via Base MCP."
---

# Virtuals Plugin

> [!IMPORTANT]
> Complete the short Base MCP onboarding flow defined in `SKILL.md` before calling any Virtuals tool. Virtuals is **session-authenticated**: every tool requires a JWT `token` parameter obtained via a SIWE login that the user must approve through Base MCP. Run the [Auth flow](#auth-flow) once per session and reuse the token for subsequent calls.

Virtuals (ACP — Agent Commerce Protocol) is a platform for creating and operating autonomous AI agents that can transact onchain, hold payment cards, and own email identities. The Virtuals MCP server prepares and executes agent management, agent card, and agent email operations. The Base MCP wallet is used only to sign the SIWE login challenge — Virtuals does not route onchain transactions through Base MCP after auth.

The exact list of Virtuals tools, their parameters, and the capabilities they expose are advertised by the Virtuals MCP itself — read the tool descriptions rather than relying on a fixed catalog in this file. Tools may be added, renamed, or removed.

## MCP Server

URL: `https://mcp.acp.virtuals.io/`

## Detection

If no Virtuals tools (e.g. `login_start`, `agent_list`, `agent_card_*`, `agent_email_*`) are exposed to the harness, the Virtuals MCP isn't installed — don't try to reach Virtuals' HTTP API directly, the SIWE auth and most tool paths require the MCP. Instead, help the user install it for their current surface. Detect the harness from environment signals (available CLIs like `claude` / `codex` / `cursor`, working directory, tool names) and walk through the matching step:

- **Claude Code:** `claude mcp add virtuals --transport http https://mcp.acp.virtuals.io/`
- **Codex:** `codex mcp add virtuals --url https://mcp.acp.virtuals.io/` (or add `[mcp_servers.virtuals] url = "https://mcp.acp.virtuals.io/"` to `codex.toml`)
- **Cursor / JSON-config harnesses:** add the snippet from [Installation](#installation-alongside-base-mcp) to the harness's MCP config (e.g. `~/.cursor/mcp.json` or the project's `.cursor/mcp.json`) and restart it.
- **Claude.ai web / Claude Desktop / iOS / Android:** Customize → Connectors → Add custom connector, name `virtuals`, URL `https://mcp.acp.virtuals.io/`.
- **ChatGPT:** Settings → Connectors → Create, name `virtuals`, MCP Server URL `https://mcp.acp.virtuals.io/`, Authentication `OAuth` (enable Developer Mode if prompted).
- **Other / unknown harness:** show the JSON snippet from [Installation](#installation-alongside-base-mcp) and ask the user where their MCP config lives.

After install, ask the user to reconnect or restart the session so the new tools register, then run the [Auth flow](#auth-flow) and retry.

## Capabilities Overview

Three main capability groups (consult the MCP tool catalog for the current exact tool names):

- **Agent management** — create agents, list your agents, prepare and poll the launch flow.
- **Agent cards** — sign agents up for payment cards, issue cards, set spend limits, manage 3DS codes, update card profile, set up payment methods.
- **Agent email** — give agents an email identity, read/search the inbox, fetch threads/attachments, compose and reply to emails, extract OTPs or links from messages.

## Auth Flow

Virtuals authentication is stateless from the MCP's perspective — no session is stored server-side. Every authenticated tool requires the JWT `token` from `login_complete` as an explicit parameter. Run this flow **once at the start of the session** and reuse the token until it expires (~1 hour); use `login_refresh` with the refresh token thereafter.

```
get_wallets (Base MCP)            → baseAccount.address
   ↓
login_start (Virtuals)            → SIWE message (with nonce + 30-min expiry)
   ↓
sign type=personal_sign (Base MCP) → approvalUrl + requestId
   ↓ user approves at the link
get_request_status (Base MCP)     → { signature, status: "signed" }
   ↓
login_complete (Virtuals) message + signature → { token, refreshToken, walletAddress }
   ↓
Reuse `token` as the `token` parameter on every subsequent Virtuals tool call.
```

### Step-by-step

1. **Fetch the wallet address.** Call Base MCP `get_wallets` and use `baseAccount.address`.
2. **Start login.** Call Virtuals `login_start` with that address. Returns the SIWE `message` to sign and a `nonce` valid for 30 minutes.
3. **Sign with Base MCP.** Call `sign` with `type: "personal_sign"` and `data: { message: <SIWE message verbatim> }`. Returns an `approvalUrl` and `requestId`.
4. **Present the approval link.** Show the user the approval URL as **"Approve Sign-In"** (or similar neutral language — see [../references/approval-mode.md](../references/approval-mode.md)). Wait for them to confirm.
5. **Poll for the signature.** Call Base MCP `get_request_status` once after the user confirms; the result includes the `signature` value.
6. **Complete login.** Call Virtuals `login_complete` with the **exact** `message` from step 2 and the `signature` from step 5. Returns `{ token, refreshToken, walletAddress }`.
7. **Store and reuse the token.** Pass `token` as the `token` parameter on every subsequent Virtuals tool call. Refresh with `login_refresh` once the JWT expires.

## Troubleshooting

The Base MCP wallet is a Base Account smart wallet (contract account, not a plain EOA). The SIWE signing path has a few sharp edges — these are the failure modes we've observed.

### 1. `Invalid SIWE signature` (401) on `login_complete`

**Start with wallet identity, not signature format.** The most frequent root cause is that the user is approving the sign-in with a different wallet than the one named in the SIWE `message` — not signature wrapping. Virtuals fully supports Base Account smart wallets (contract accounts), so smart-wallet support is **not** the issue.

Typical address-mismatch scenarios:

- **Cross-device cache drift.** Base MCP was authenticated on one device (e.g. desktop) and `get_wallets` returned the address cached there, but the user is approving the sign-in popup on another device (e.g. phone) — or vice versa. The wallet that actually signs is different from the one named in the SIWE message.
- **Multiple wallets in the same client.** The active wallet in the approval popup isn't the one Base MCP `get_wallets` returned.
- **Stale `get_wallets` result.** You fetched the address earlier in the session and the user has since switched the active wallet in Base MCP, so `login_start` was called with a stale address.

**Recovery — always try this first:**

1. Re-run `get_wallets` (Base MCP) to refresh `baseAccount.address`.
2. Confirm with the user *which* wallet and *which* device they intend to sign with. If they don't match the refreshed address, ask them to switch to the right wallet/device before retrying.
3. Restart from `login_start` with the confirmed address so the SIWE message names the wallet the user will actually approve.

Only after ruling out wallet mismatch, consider the signature-format cause below.

#### Less common: ERC-6492 wrapped signature

In some Base Account smart wallet flows, Base MCP `sign` returns an **ERC-6492 wrapped** signature (used for counterfactual or contract-deployment-attached signing), and the Virtuals verifier expects a plain **ERC-1271** signature.

Recognize ERC-6492 wrapped signatures by:
- Length: thousands of hex characters (the inner ERC-1271 signature is much shorter).
- They end with the magic suffix `6492649264926492649264926492649264926492649264926492649264926492`.

**Recovery:** restart the auth flow from `login_start`. Subsequent approvals from the same wallet can produce a plain ERC-1271 signature that Virtuals accepts; the wrapping behavior isn't deterministic from one approval to the next. If it keeps returning ERC-6492 wrapped signatures, ask the user to confirm via the same approval URL again — repeated retries typically resolve to a plain ERC-1271 signature within a few attempts.

Do **not** try to unwrap the ERC-6492 envelope manually and submit just the inner bytes — Virtuals rejects that too, because the inner Base Account smart wallet signature format isn't a vanilla ERC-1271 `(r, s, v)` either.

### 2. Address case mismatch

Pass the wallet address to `login_start` exactly as returned by Base MCP `get_wallets`. The returned address is lowercase, which is fine — Virtuals normalises it. But when calling `login_complete`, **the `message` you pass must be the verbatim string returned by `login_start`** (which uses the EIP-55 checksummed address). Do not lowercase or otherwise reformat the message. A single character change in casing inside the message hashes to a different value than what was signed and the server will return `Invalid SIWE signature`.

Verified working pattern:
- `login_start` input: lowercase address (e.g. `0xca8f1eb...`) → fine
- `login_complete` `message`: verbatim string from the `login_start` response (contains the checksummed `0xCa8F1eB...`) → required

### 3. Nonce expired

SIWE nonces expire 30 minutes after `login_start`. If the user took a long time to approve, or you waited and tried again later, `login_complete` will fail. Restart from `login_start` to get a fresh nonce — do not reuse an old one.

### 4. Message whitespace / newlines

The SIWE `message` field in `sign` (as `data.message`) and the `message` field in `login_complete` must be byte-identical to what `login_start` returned. JSON-escape `\n` correctly when embedding in the `sign` tool's `data` payload. When passing the message to `login_complete`, use real newlines (the same characters the JSON `\n` escapes decoded to). Any mismatch — extra trailing whitespace, CRLF vs LF, etc. — breaks the hash and yields `Invalid SIWE signature`.

### 5. Wallet not deployed on Base

ERC-1271 verification calls the wallet contract on Base. If the Base Account smart wallet has never been activated on Base mainnet, the contract isn't deployed and verification will fail even with a structurally correct signature. Confirm deployment by checking `eth_getCode` for the address on Base mainnet — non-empty bytecode means it's deployed. Most Base MCP users will already have a deployed wallet; if not, ask the user to perform a no-op transaction first (any Base transaction will deploy the wallet).

### 6. Token expired mid-session

JWTs returned by `login_complete` expire after about an hour. When a Virtuals tool returns a 401, call `login_refresh` with the stored `refreshToken` to get a new access token; only re-run the full SIWE flow if the refresh token is also rejected.

## Example Prompts

```
Log me into Virtuals
```
1. `get_wallets` (Base MCP) → `baseAccount.address`.
2. `login_start` (Virtuals) with that address → SIWE message.
3. `sign` (Base MCP) with `type: "personal_sign"`, `data: { message }` → approval URL.
4. Show the user the approval link; wait for confirmation.
5. `get_request_status` (Base MCP) → signature.
6. `login_complete` (Virtuals) with the message + signature → token.
7. Confirm: *"You're signed in. Your Virtuals session is good for about an hour."*

```
List all my Virtuals agents
```
1. Ensure session token is current (run [Auth flow](#auth-flow) if not).
2. Call the Virtuals agent-list tool with `token`.

```
Create a Virtuals agent with email and a payment card
```
1. Ensure session token.
2. Call the Virtuals agent-create tool.
3. For email: call the email-identity creation tool with the new `agentId`.
4. For a card: call the card signup tool, poll until verified, then issue a card and set spend limits.

## Important Notes

- **Stateless auth.** The token must be passed to every Virtuals tool — the MCP server doesn't remember it between calls.
- **Session scope.** Only one wallet can be authenticated per token. To switch wallets, run the full SIWE flow again with the new address.
- **No onchain operations through Base MCP after auth.** The Base MCP wallet is only used for the SIWE signature. Virtuals' tools (card issuance, email, agent ops) operate against Virtuals' own backend.
- **Sensitive outputs.** Agent card details and email contents can include private information. Don't echo card numbers, 3DS codes, OTPs, or email bodies to chat unless the user has clearly asked for them.
- **Wallet vs Base Account.** Use `baseAccount.address` from `get_wallets` for SIWE — not the agent wallets (`agentWallets[]`), which are session-scoped delegations for transactional flows.
