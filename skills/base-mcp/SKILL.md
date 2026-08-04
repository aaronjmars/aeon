---
name: base-mcp
description: Access a Base Account via the Base MCP server (mcp.base.org) - wallet, portfolio, sending, swapping, signing, x402 payments, batched calls, and transaction history.
metadata:
  title: Base MCP
  mode: read-only
  category: crypto
  tags:
    - crypto
    - onchain
  mcp:
    - base
  version: 0.1.0
---

# Base MCP

> [!IMPORTANT]
> ## Run onboarding at the start of every conversation that touches Base MCP
>
> Including conversations that jump straight to a plugin topic. Onboarding is short — see below.

## Detection

The Base MCP exposes its tools to the harness when connected. If no Base MCP tool is callable, the MCP server is not installed: direct the user to https://docs.base.org/ai-agents/quickstart (or load [references/install.md](references/install.md) for app-specific steps) and stop.

If Base MCP tools are available, load [references/tone.md](references/tone.md) — its rules apply for the entire conversation — then continue to Onboarding. If — and only if — sibling files aren't readable (e.g. you were handed just this `SKILL.md` body and have no local filesystem access to the skill directory), fetch the same relative path from `https://docs.base.org/ai-agents/skills/references/tone.md` using the `web_request` tool from Base MCP. The same fallback applies to every other reference and plugin link in this file (see "Loading referenced files" below).

## Onboarding

Keep it short. Do this once per session, before doing real work:

1. **Briefly mention what's available** — one or two sentences. The user has a Base Account wallet and can do things like check balances, send and swap tokens, sign messages, make x402 payments, batch contract calls, and (if installed) use partner plugins for DeFi, swaps, and other onchain actions. Do not enumerate every tool — the agent discovers tools and plugins directly from the MCP.

2. **Show this disclaimer verbatim** before proceeding:

   > By using the Base MCP, you agree to the Base Account and Base App Terms of Service. Plugins available in the Base repo are authored by Base, not by the third-party protocols they reference.

3. **Wallet address and balance are optional** — only fetch and display them when the user asks, or when a pending operation actually needs the address (e.g., a write call, a position lookup). Don't volunteer a wallet dump up front.

## Tools

The Base MCP advertises its own tool catalog to the harness. Read the tool descriptions exposed by the MCP — they are the source of truth and may change over time. Do not assume a fixed list; do not preload a tool catalog from this skill.

Two patterns deserve their own references because they span multiple tools:

| Topic | Reference |
|-------|-----------|
| Approval flow (for any write tool that returns an approval URL) | [references/approval-mode.md](references/approval-mode.md) |
| Batched contract calls (EIP-5792) | [references/batch-calls.md](references/batch-calls.md) |
| Custom / non-native plugins and the `web_request` allowlist | [references/custom-plugins.md](references/custom-plugins.md) |
| Platform install steps | [references/install.md](references/install.md) |
| Tone and language rules | [references/tone.md](references/tone.md) |

### Loading referenced files

- **Default — local.** Read each `references/…` or `plugins/…` link from the same directory as this `SKILL.md` (filesystem read, e.g. `Read`/`cat`). This is the canonical source — always try this first.
- **Fallback — web (only when local read fails).** If — and only if — the local file is genuinely unreadable (e.g. you were handed `SKILL.md` as a pasted body with no skill directory on disk, or the filesystem read errors), then fetch the same relative path from `https://docs.base.org/ai-agents/skills/<path>` (replace `<path>` with the relative link, e.g. `references/tone.md`, `plugins/morpho.md`). Use the `web_request` tool from Base MCP for this fetch — that is the required mechanism on every surface, including ones with a built-in web/fetch tool. Do not skip this fallback and do not try to operate from memory or guesses — if the local read fails, you must `web_request` the file before acting on its contents.
- **Lazy.** Only load a reference or plugin when the conversation actually needs it. Don't preload the catalog.

## Plugins

Plugins extend Base MCP with partner-specific functionality (lending, swaps, perps, etc.). The available set may change and users might drop additional instructions in the chat or custom plugins that would allow you to use other protocols with the MCP.

Plugins currently maintained alongside this skill (the **native plugins**):

| Plugin | Reference |
|--------|-----------|
| Morpho | [plugins/morpho.md](plugins/morpho.md) |
| Moonwell | [plugins/moonwell.md](plugins/moonwell.md) |
| Uniswap | [plugins/uniswap.md](plugins/uniswap.md) |
| Avantis (hybrid) | [plugins/avantis.md](plugins/avantis.md) |
| Virtuals | [plugins/virtuals.md](plugins/virtuals.md) |
| Aerodrome (CLI-only) | [plugins/aerodrome.md](plugins/aerodrome.md) |
| Bankr | [plugins/bankr.md](plugins/bankr.md) |

Load a plugin reference only when the user's request matches it, following the same local-first, web-fallback rule as references (see [Loading referenced files](#loading-referenced-files) above). For a plugin's own external tools, defer to the plugin file first, then to any CLI help, API schema, or MCP tool descriptions it explicitly tells you to use.

### Native plugins vs. custom / user-supplied plugins

Native plugin HTTP hosts may be allowlisted in the Base MCP `web_request` tool. Aerodrome is CLI-only and requires a harness with shell access. Avantis is hybrid: view-only reads (market data, positions, PnL) work on every surface via `web_request`, while tx-builder calls require a CLI harness — on chat-only surfaces the plugin links the user to the Avantis web UI instead (see [plugins/avantis.md](plugins/avantis.md)). Morpho is hybrid too: use Morpho CLI when shell access exists, otherwise use or install the Morpho MCP as described in [plugins/morpho.md](plugins/morpho.md). Custom or user-supplied plugins usually aren't allowlisted — load [references/custom-plugins.md](references/custom-plugins.md) for the decision tree on which HTTP path to use (harness HTTP tool vs. user-paste fallback, and the GET-only constraint on Claude/ChatGPT consumer surfaces).

## Installation

```bash
npx skills add base/skills --skill base-mcp
```
