---
title: "Installing Base MCP"
description: "Skill reference for installing the Base MCP server in Claude, ChatGPT, Cursor, Codex, and other surfaces."
---

# Installing Base MCP

> Canonical source: **[https://docs.base.org/ai-agents/quickstart](https://docs.base.org/ai-agents/quickstart)**. That page is kept up to date with the latest one-click install links, deep-links, and connector flows for each surface. Send the user there first; the instructions below are a backup so the agent can still walk a user through install without leaving the chat.

The MCP server URL is the same everywhere: **`https://mcp.base.org`**

---

## Claude (Claude.ai web, Claude Desktop, iOS, Android)

One-click add:

```
https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Base%20MCP&connectorUrl=https%3A%2F%2Fmcp.base.org
```

Or manually:

1. Open **Customize → Connectors → Add custom connector**
2. Fill in:
   - **Name**: `Base MCP`
   - **Remote MCP server URL**: `https://mcp.base.org`
3. Click **Add**

A browser tab opens to authorize on first use — sign in with Base.

---

## ChatGPT

Open [https://chatgpt.com/#settings/Connectors](https://chatgpt.com/#settings/Connectors) (or **Settings → Connectors**), then:

1. Enable **Developer Mode** if prompted (under Advanced)
2. Click **Create** → **New App** modal opens
3. Fill in:
   - **Name**: `Base MCP`
   - **Description** (optional): `Wallet and onchain tools for Base`
   - **MCP Server URL**: `https://mcp.base.org`
   - **Authentication**: `OAuth`
4. Check **I understand and want to continue** on the risk warning
5. Click **Create**

ChatGPT prompts for authorization the first time a wallet tool is called.

---

## Claude Code

Add to the current project:

```bash
claude mcp add --transport http base-mcp https://mcp.base.org
```

Install globally across all projects:

```bash
claude mcp add --transport http --scope user base-mcp https://mcp.base.org
```

Verify:

```bash
claude mcp list
```

The `base-mcp` server shows with a tool count once active. Inside a session, `/mcp` also shows server status.

---

## Codex

```bash
codex mcp add base-mcp --url https://mcp.base.org/
```

Or in `codex.toml`:

```toml
[mcp_servers.base-mcp]
url = "https://mcp.base.org/"
```

---

## Cursor

Deep link install:

```
cursor://anysphere.cursor-deeplink/mcp/install?name=base-mcp&config=eyJ1cmwiOiJodHRwczovL21jcC5iYXNlLm9yZyJ9
```

Or manually in `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "base-mcp": {
      "url": "https://mcp.base.org"
    }
  }
}
```

Restart Cursor, then **Settings → MCP** to confirm `base-mcp` is active.

---

## Hermes

Hand the agent the quickstart and let it install itself:

```
Install the Base MCP server from https://docs.base.org/ai-agents/quickstart
```

Manual install — edit `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  base-mcp:
    url: "https://mcp.base.org"
```

Then start a new chat (or `/reload-mcp` in an existing one).

---

## Authorization (first use)

The first time a wallet tool is called, an auth modal opens for the user to authorize the Base Account. Click **Allow** once. (See the live demo on the quickstart page.) After that, write operations still require per-transaction approval — see [approval-mode.md](approval-mode.md).

---

## Did it work?

Ask the assistant:

> Show me my wallets

If it replies with a wallet address, the MCP is connected. If it says it doesn't have wallet tools, the MCP isn't loaded — retry the install steps or fall back to the quickstart link.

---

## Troubleshooting

| Symptom | Try |
|---------|-----|
| No browser tab for sign-in | Open `https://mcp.base.org` directly, sign in, then re-add the server. |
| "Integration not found" / "Tool not available" | Restart the app — the server may not have finished loading. |
| Integrations / Connectors tab missing | App version is too old — update to the latest. |
| `web_request` rejects a hostname | The hostname isn't in the allowlist. For native HTTP plugins, use the harness HTTP tool if one is available; for custom plugins see [custom-plugins.md](custom-plugins.md). CLI-only plugins do not use `web_request`. |
| Anything else | Send the user to [https://docs.base.org/ai-agents/quickstart](https://docs.base.org/ai-agents/quickstart). |
