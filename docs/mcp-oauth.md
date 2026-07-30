---
type: Reference
title: MCP OAuth — durable headless auth for OAuth-gated MCP servers
description: How the dashboard captures an OAuth-gated MCP server's tokens and keeps them fresh for headless runs, the parallel to the grok X-account flow, and the known limits.
---

# MCP OAuth (durable)

Most MCP servers Aeon can wire with a static bearer token (a repo secret injected
as `Authorization: Bearer ${VAR}`). **OAuth-gated** servers are different: their
access tokens are short-lived and minted through a browser flow a headless GitHub
Actions run can't perform. This is the same problem the grok harness solves for the
X-account login — and the solution here mirrors it: capture once in the dashboard,
store as repo secrets, refresh before every run.

## The flow

1. **Connect (dashboard).** In the MCP panel, an OAuth-flagged featured server shows
   **Connect** instead of Install. Clicking it calls `POST /api/mcp-auth`, which:
   - discovers the server's auth endpoints — Protected Resource Metadata (RFC 9728)
     → Authorization Server Metadata (RFC 8414 / OIDC). A **self-issuing** server that
     skips PRM (e.g. Base, whose issuer *is* `mcp.base.org`) is handled by falling back
     to AS metadata at the MCP origin's well-known — what compliant clients do,
   - registers a client via Dynamic Client Registration (RFC 7591), or uses a
     pinned `oauthClientId`,
   - opens your browser to authorize (Authorization Code + PKCE, RFC 7636),
   - on the `/api/mcp-auth/callback` redirect, exchanges the code for tokens.
2. **Store.** The dashboard writes two repo secrets (the tokens never reach the
   browser):
   - `MCP_<SLUG>_TOKEN` — the (short-lived) access token, referenced by the header.
   - `MCP_<SLUG>_OAUTH` — the refresh material (`token_endpoint`, `client_id`,
     optional `client_secret`, `refresh_token`, `scope`) the runtime refresh needs.
   The server is added to `.mcp.json` with `Authorization: Bearer ${MCP_<SLUG>_TOKEN}`.
3. **Refresh (every run).** Before resolving `.mcp.json`'s `${VAR}`s, both workflows
   source [`scripts/mcp-oauth-refresh.sh`](../scripts/mcp-oauth-refresh.sh). For each
   `MCP_<SLUG>_OAUTH` secret it mints a fresh access token via the `refresh_token`
   grant and exports `MCP_<SLUG>_TOKEN`, so the header resolves to a live token. It
   is sourced, never fails the run, and never prints a token (masked with
   `::add-mask::`). Covers both harnesses (Claude via `--mcp-config`, grok natively).

## Current catalog

The featured OAuth servers (all probed live; the catalog file carries per-server
discovery notes) and their companion skills:

| Server (slug) | MCP URL | Scopes requested | Rotates refresh token? | Skill |
|---|---|---|---|---|
| Base (`base`) | `mcp.base.org` | `agent_wallet:transact` | yes | `base-mcp` |
| Robinhood Trading (`robinhood-trading`) | `agent.robinhood.com/mcp/trading` | *(default — no `offline_access`; it only advertises `internal`)* | unverified — assume yes | `robinhood-mcp` |
| glim.sh (`glim`) | `glim.sh/mcp` | `openid offline_access` | yes — **verified live 2026-07-16** | `glim-mcp` |
| Executor (`executor`) | `executor.sh/mcp` | `openid offline_access` | yes — **verified live 2026-07-16** | `executor-mcp` |
| Finance District Agent Wallet (`finance-district`) | `wallet-mcp.fd.xyz` | `openid offline_access api://fd-agent-wallet-mcp/mcp:tools` (resource scope gates tool access) | yes | `finance-district-mcp` |

The glim and Executor loops were verified end-to-end on a live instance
(Connect → per-run refresh → PAT-persisted rotation → refresh off the persisted
token, no re-connect): every catalog provider rotates, so treat `GH_SECRETS_PAT`
as **required** in practice, not optional.

## Code map

| Piece | File |
|---|---|
| OAuth core (PKCE, discovery, DCR, exchange/refresh — pure, unit-tested) | `apps/dashboard/lib/mcp-oauth.ts` |
| Server glue (pending-flow store, browser open, secret storage) | `apps/dashboard/lib/mcp-oauth-server.ts` |
| Start + callback routes | `apps/dashboard/app/api/mcp-auth/{route,callback/route}.ts` |
| Panel Connect button | `apps/dashboard/components/McpPanel.tsx` |
| Catalog `oauth` flag | `apps/dashboard/lib/mcp-catalog.ts` |
| Runtime refresh (sourced by both workflows) | `scripts/mcp-oauth-refresh.sh` |

## Limits (read before relying on it)

- **Local-first dashboard.** The flow opens your browser and shares the pending
  request in-process (same assumption as `app/api/grok-auth`). It works when the
  dashboard runs on your machine; a multi-instance serverless deploy would need
  external state.
- **Dynamic Client Registration required for one-click.** A server without DCR
  needs a pre-registered `client_id` (set `oauthClientId` on the catalog entry).
- **Rotating refresh tokens.** If a provider rotates the refresh token on each use,
  the old one is invalidated the moment it's used, so unless the replacement is
  saved the *next* headless run's refresh fails (`no access_token` / `invalid_grant`)
  and auth breaks one run later. Persisting a secret needs a **secrets-write
  credential** — the default `GITHUB_TOKEN` cannot write secrets. To make refresh
  durable for rotating providers, add a fine-grained PAT with **Secrets: read/write**
  on this repo as the secret **`GH_SECRETS_PAT`** (or a repo-wide `GH_GLOBAL`);
  `scripts/mcp-oauth-refresh.sh` then saves each rotated refresh token back to its
  `MCP_<SLUG>_OAUTH` secret and warns loudly when it can't. **After adding the PAT,
  re-connect the affected server once** to seed a valid refresh token — a refresh
  token already consumed by a prior run can't be revived by the PAT alone. Providers
  with stable refresh tokens (the common case) work indefinitely without a PAT.
  (Note: concurrent runs that each refresh the same rotating token still race — for
  many-server / high-parallelism setups, refresh centrally on a schedule so exactly
  one run mints and persists per interval.)
- **No offline scope, no refresh.** If the provider doesn't return a refresh token
  (e.g. it needs an explicit offline-access scope), only the access token is stored
  and it will expire — the panel warns when this happens.

## Testing it

The pure OAuth helpers and the refresh script are unit-tested
(`apps/dashboard/lib/mcp-oauth.test.ts`, `scripts/tests/test_mcp_oauth_refresh.sh`).
The end-to-end browser flow needs a real OAuth MCP server (e.g. Robinhood): run the
dashboard locally, click **Connect**, approve in the browser, confirm
`MCP_<SLUG>_TOKEN` + `MCP_<SLUG>_OAUTH` appear as repo secrets and the server lands
in `.mcp.json`, then dispatch a skill that calls it and confirm the refresh step
logs `refreshed MCP_<SLUG>_TOKEN` (with step debug logging on).
