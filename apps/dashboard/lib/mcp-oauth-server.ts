// Server-only glue for the MCP OAuth flow: the shared pending-flow store (bridges
// the POST that starts the flow and the GET callback) and persisting the captured
// tokens as repo secrets + wiring the server into .mcp.json. Kept out of
// lib/mcp-oauth.ts so that module stays pure/fetch-only and unit-testable; this
// one imports gh + the child_process/github helpers.
import { ghSecretSet } from './gh'
import type { McpServer } from './types'
import { tokenVar, oauthVar, type TokenSet, type OAuthSecret } from './mcp-oauth'

export interface PendingFlow {
  slug: string
  name: string
  url: string
  tokenEndpoint: string
  clientId: string
  clientSecret?: string
  verifier: string
  redirectUri: string
  resource: string
  resolve: (t: TokenSet) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// Module-level singleton, keyed by the OAuth `state`. The dashboard is local-first
// and single-process (same assumption as app/api/grok-auth's spawn-based flow), so
// the POST that opens the browser and the GET callback share this map. A
// multi-instance/serverless deploy would need external state instead.
export const pendingFlows = new Map<string, PendingFlow>()

// Ample time for the operator to approve in the browser, under Node's request cap.
export const OAUTH_TIMEOUT_MS = 240_000

// Persist the captured tokens as repo secrets and return the .mcp.json server
// descriptor for the caller (the panel) to add via its normal save path — keeping
// .mcp.json single-writer and the panel state in sync without a reload:
//   - MCP_<SLUG>_TOKEN  = the (short-lived) access token, referenced by the header.
//   - MCP_<SLUG>_OAUTH  = the refresh material scripts/mcp-oauth-refresh.sh needs.
// The tokens themselves are stored server-side (they never reach the browser).
// Returns whether durable (refresh-token) auth was captured, plus the server to add.
export function storeSecrets(flow: PendingFlow, tokens: TokenSet): { durable: boolean; server: McpServer } {
  ghSecretSet(tokenVar(flow.slug), tokens.access_token)

  const durable = Boolean(tokens.refresh_token)
  // Narrow on the value, not on `durable` — the boolean doesn't carry the
  // refresh token's non-undefined-ness into the block.
  if (tokens.refresh_token) {
    ghSecretSet(oauthVar(flow.slug), JSON.stringify({
      token_endpoint: flow.tokenEndpoint,
      client_id: flow.clientId,
      ...(flow.clientSecret ? { client_secret: flow.clientSecret } : {}),
      refresh_token: tokens.refresh_token,
      ...(tokens.scope ? { scope: tokens.scope } : {}),
      slug: flow.slug,
    } satisfies OAuthSecret))
  }

  const server: McpServer = {
    type: 'http',
    url: flow.url,
    headers: { Authorization: `Bearer \${${tokenVar(flow.slug)}}` },
  }
  return { durable, server }
}
