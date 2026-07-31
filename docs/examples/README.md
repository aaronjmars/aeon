# Aeon integration examples

Aeon ships an [MCP server](../apps/mcp-server/) so any Claude client can call its 66 skills. The scripts here are the shortest possible "first call works" demos — build the server, run `python <file>`, get a real Aeon output back.

| File | Stack | Skill called | What it shows |
|------|-------|--------------|---------------|
| [`mcp/test_connection.py`](mcp/test_connection.py) | MCP (stdio) | `aeon-heartbeat` (default) | List + invoke any `aeon-*` tool |
| [`mcp/claude_desktop_config.json`](mcp/claude_desktop_config.json) | Claude Desktop | — | Drop-in config snippet |

## MCP — verify the round-trip

```bash
bin/add-mcp --build-only          # produce apps/mcp-server/dist/index.js
pip install mcp                 # official Anthropic MCP client
python docs/examples/mcp/test_connection.py
```

You should see the full list of `aeon-*` tools followed by a real `aeon-heartbeat` output. Once that works, hand `apps/mcp-server/dist/index.js` to Claude Code with `bin/add-mcp` (already done if you ran `bin/add-mcp` without `--build-only`) or to Claude Desktop using [`mcp/claude_desktop_config.json`](mcp/claude_desktop_config.json) — replace `/ABSOLUTE/PATH/TO/aeon` with your actual repo path.

## Picking a different skill

`catalog/skills.json` is the source of truth — every entry is callable as `aeon-<slug>` from MCP. Some good first calls:

- `aeon-heartbeat` — reads local fleet health, no secrets required, safe to run anywhere
- `aeon-token-movers` (`var=AEON`) — public CoinGecko data, no secrets required
- `aeon-article` (`var="your topic"`) — long-running; expect several minutes
- `aeon-fetch-tweets` (`var="your topic"`) — needs `XAI_API_KEY` in the Aeon repo's environment

Skills that hit external APIs need the same secrets the Aeon GitHub Actions runner uses. Drop them into a `.env` file at the Aeon repo root before you start the MCP server.

## What the server is doing under the hood

Every Aeon skill is a markdown prompt at `skills/<slug>/SKILL.md`. The MCP server spawns `claude -p -` with the same prompt the GitHub Actions runner uses — so a skill behaves identically whether it fires on a cron, from your terminal, or from a Claude client. No re-implementation, no drift.
