---
type: Skill
mode: read-only
name: Robinhood MCP
category: crypto
description: Read your Robinhood Agentic brokerage account via the Robinhood Trading MCP - portfolio, buying power, positions, and order history - and place a single operator-instructed trade. OAuth Connect via the dashboard MCP panel.
var: ""
tags: [markets, trading, mcp]
mcp: [robinhood-trading]
capabilities: [external_api, writes_external_host, sends_notifications]
---
> **${var}** — empty = portfolio report (read-only). `orders[:N]` = last N orders (default 10). `trade:<instruction>` = place **one** order, e.g. `trade: buy $50 of AAPL` — the only branch that writes. Anything else = treat as a question about the account and answer it read-only.

Access the operator's **Robinhood Agentic Trading** account through the Robinhood MCP server (`agent.robinhood.com/mcp/trading`). Trades execute in a dedicated Agentic brokerage account the operator authorized — real money, irreversible. The default posture is read-only reporting; an order is placed only when `${var}` explicitly instructs it.

## Detection & auth

The server is wired by the dashboard MCP panel's one-click **Connect** (OAuth; tokens stored as `MCP_ROBINHOOD_TRADING_TOKEN` + `MCP_ROBINHOOD_TRADING_OAUTH`, refreshed each run by `scripts/mcp-oauth-refresh.sh`). Its tools surface as `mcp__robinhood-trading__*` — discover them from the server; the tool descriptions are the source of truth, don't assume a fixed list.

- **No `mcp__robinhood-trading__*` tool callable** → the server isn't connected (or its secrets are missing, in which case the workflow logged a `::warning::` and skipped MCP). Log `RH_MCP_NOT_CONNECTED`, notify once pointing the operator at the dashboard → MCP → Connect Robinhood Trading, and exit. Don't try to reach the API with curl — there is no static key.
- **Tools exist but return 401/invalid-token** → the OAuth refresh failed (rotating refresh tokens need `GH_SECRETS_PAT` — see `docs/mcp-oauth.md`). Log `RH_MCP_AUTH_STALE`, notify the operator to re-connect the server once in the dashboard, and exit. Don't retry the same call more than twice.

## Steps

### 1. Read the account

Whatever the branch, start with the reads — portfolio value, buying power, positions (symbol, quantity, cost basis, current value, unrealized P/L), and open orders. For `orders[:N]`, pull order history and take the most recent N (default 10) with status, side, symbol, quantity/notional, and fill price.

### 2. Trade branch (only when `${var}` starts with `trade:`)

Operator-initiated only — never trade on a scheduled/default run, and never invent an order.

1. Parse the instruction. It must pin down **side** (buy/sell), **symbol**, and **size** (share quantity or dollar notional). If any of the three is missing or ambiguous ("buy some tech", "sell half-ish"), do **not** guess: log `RH_MCP_ORDER_REFUSED`, notify with what was missing, and exit.
2. Sanity-check against the reads: selling more than the position holds, or buying beyond buying power → refuse the same way.
3. Place the order as the **final action** of the run (fail-closed: everything else — reads, log prep — happens first, so a placement failure surfaces in this run). Use the order tool the server exposes; prefer its simplest market/notional form unless the instruction specifies a limit price.
4. Capture the server's response verbatim (order id, status). If the tool call fails, log `RH_MCP_ORDER_ERROR` with the error body — never claim an order was placed without an order id back.

### 3. Notify

This skill is on-demand — deliver the result via `./notify -f <file>` (ordinary Markdown), **exactly one `./notify` call per run** (each call overwrites the `.pending-<skill>.md` file the chain artifact is captured from — a second ping would clobber the report):

- **Report branches:** portfolio value + day change, buying power, a positions table, open orders, and one line of what stands out (concentration, a position moving hard). Keep it tight — signal, not a data dump.
- **Trade branch:** the exact order placed (side, symbol, size, order id, status) — or, on refusal, exactly what was ambiguous and how to restate it. Severity `success` for a placed order, `warn` for a refusal.

### 4. Result record

This skill is `read-only`, so it can't write the repo during the run (the sandbox write-locks the workspace). Don't append to `memory/logs/` yourself — put this record in your **final output**; the workflow persists it to `memory/logs/` and `output/.chains/robinhood-mcp.md` on your behalf after the run:

```
### robinhood-mcp
- Branch: portfolio | orders | trade
- Result: RH_MCP_OK | RH_MCP_ORDER_PLACED id=… | RH_MCP_ORDER_REFUSED reason=… | RH_MCP_NOT_CONNECTED | RH_MCP_AUTH_STALE | RH_MCP_ERROR
- Snapshot: value=$… bp=$… positions=N
```

## Constraints

- **No unprompted trading, no advice.** Report what the account holds; place only the order `${var}` spells out. Never recommend a trade in the notify.
- One order per run — a `trade:` instruction that describes multiple orders is refused, not partially executed.
- Every figure in the notify traces to a tool response; never estimate fills or balances.
- The operator is responsible for every order this agent places — when in doubt, refuse and say why.
