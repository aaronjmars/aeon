---
title: "Approval Mode"
description: "Skill reference for how Base MCP returns approval URLs and request IDs for every write call."
---

> Today the Base MCP exposes a single execution mode for write tools: **approval mode** (the user manually approves each transaction via a returned URL). Other modes may be added later. Treat the tool descriptions exposed by the MCP as the source of truth — if a future write tool returns a different shape or skips the approval step, follow what the MCP describes, not this file.

# Approval Mode

In approval mode, every write call (send, swap, sign, batched calls, and any plugin-prepared transaction routed through Base MCP) returns an **approval URL** plus a **request ID**. The user opens the URL, approves the action in Base Account, and then the agent polls the request ID for completion.

## Flow

1. **Call the write tool.** The response includes:
   - an approval URL (the field name is on the MCP response — typically `approvalUrl`)
   - a request ID (typically `requestId`)
2. **Show the user the link.** Present it as **"Approve Transaction"** (or similar neutral language). Refer to the approval destination as Base Account, not as the raw URL hostname or an implementation-specific provider. Just give the user the link to click.
   - Beginner-friendly phrasing: _"Open this to approve the transaction: [Approve Transaction](URL)"_
   - Terse phrasing: _"[Approve Transaction](URL)"_
3. **In CLI harnesses, also open the link automatically.** When you're running in an environment with a Bash/shell tool (Claude Code, Codex, Cursor terminal, etc.), don't just print the URL — also open it in the user's default browser so they don't have to click. Always print the link too as a fallback, then run the platform-appropriate open command:
   - macOS: `open "<url>"`
   - Linux: `xdg-open "<url>"` (fall back to `wslview` under WSL)
   - Windows: `start "" "<url>"` (or via PowerShell: `Start-Process "<url>"`)

   Skip this step on chat-only surfaces (ChatGPT, Claude.ai) — they don't have a shell, so just show the link.
4. **Wait for the user to confirm they approved.** Don't poll in a tight loop while they're still acting.
5. **Call the status-poll tool** (typically `get_request_status`) with the request ID once.
6. **Only report success** when the status tool confirms completion.

## Common mistakes

- Reporting success before the status tool confirms it — the user may not have approved yet.
- Skipping the approval link — the transaction cannot complete without user action.
- Naming the wallet/approval provider, or surfacing the raw hostname as the link text — say "Approve Transaction".
- Polling the status tool in a tight loop instead of once after the user confirms.
- Forgetting to also auto-open the link in CLI harnesses where a shell is available — printing alone makes the user copy-paste unnecessarily.
- Trying to auto-open in chat-only harnesses where no shell exists — that just produces an error.
