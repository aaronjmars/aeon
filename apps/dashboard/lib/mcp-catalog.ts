// Central catalog of known MCP servers - the single source of truth shared by
// the MCP page's one-click "Featured" installs and the per-skill "MCP servers"
// requirement panel. A skill declares the servers it needs via the `mcp:`
// frontmatter field (slugs below); the dashboard joins on slug for name + logo +
// install URL, exactly like API keys join against the credential registry.
export interface McpCatalogEntry {
  slug: string
  name: string
  url: string
  logo: string
  description?: string
  // Transport for the installed server. Defaults to 'http' (streamable HTTP);
  // set 'sse' for servers that speak MCP over Server-Sent Events.
  transport?: 'http' | 'sse'
  // When set, one-click install wires an `Authorization: Bearer ${<authSecret>}`
  // header referencing this repo secret, and the MCP panel surfaces a paste-token
  // row for it. Omit for public / OAuth / x402 servers (the existing default).
  authSecret?: string
  // When true, one-click install runs the dashboard OAuth flow (POST /api/mcp-auth)
  // instead of wiring a static header: it opens the browser to authorize, captures
  // the tokens into MCP_<slug>_TOKEN + MCP_<slug>_OAUTH, and scripts/mcp-oauth-
  // refresh.sh mints a fresh access token before each headless run. Optionally pin
  // oauthScopes / oauthClientId when the provider needs them (no dynamic client
  // registration). Mutually exclusive with authSecret.
  oauth?: boolean
  oauthScopes?: string[]
  oauthClientId?: string
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    slug: 'base',
    name: 'Base',
    url: 'https://mcp.base.org',
    logo: 'https://pbs.twimg.com/profile_images/2060695832840556549/R0s33fMN_400x400.jpg',
    description: 'Base Account access - wallet, portfolio, swaps, signing, x402 payments, and batched contract calls.',
    // Base is its own OAuth authorization server: no Protected Resource Metadata,
    // but full AS metadata (+ DCR) at https://mcp.base.org/.well-known/oauth-authorization-server.
    // discover() falls back to the MCP origin, so Connect works one-click. We request
    // only the least-privilege transact scope by default; `agent_wallet:escalate` is
    // also offered by the server for elevated actions.
    oauth: true,
    oauthScopes: ['agent_wallet:transact'],
  },
  {
    slug: 'robinhood-trading',
    name: 'Robinhood Trading',
    url: 'https://agent.robinhood.com/mcp/trading',
    logo: 'https://pbs.twimg.com/profile_images/1844399977482813442/1fTlYz2c_400x400.png',
    description: 'Robinhood Agentic Trading - read your portfolio, buying power, positions, and order history, and place trades from your agent. Remote HTTP MCP with OAuth; trades execute in a dedicated Agentic brokerage account you authorize. You are responsible for every order your agent places.',
    // Standard OAuth, self-issuing: PRM (well-known path) names the MCP URL itself
    // as the authorization server, AS metadata at agent.robinhood.com/.well-known/
    // oauth-authorization-server/mcp/trading. Supports authorization_code +
    // refresh_token grants, PKCE S256, DCR (registration_endpoint), public client
    // (auth method "none"). Its ONLY advertised scope is "internal" — do NOT request
    // offline_access here (glim needs it, Robinhood doesn't have it and would reject
    // it); refresh tokens come from the refresh_token grant by default. Durable
    // refresh (rotated-token persistence via GH_SECRETS_PAT) is handled generically
    // by scripts/mcp-oauth-refresh.sh — see docs/mcp-oauth.md.
    oauth: true,
  },
  {
    slug: 'executor',
    name: 'Executor',
    url: 'https://executor.sh/mcp',
    logo: 'https://executor.sh/favicon-192.png',
    description: 'Executor Cloud - one MCP endpoint in front of all your integrations: add MCP servers, OpenAPI specs, and GraphQL APIs once and every tool joins a single policy-governed catalog. Credentials live in Executor, never in the agent; each tool call is allowed, approval-gated, or blocked by policy.',
    // Standard OAuth, probed live 2026-07-16: the 401 carries a WWW-Authenticate
    // resource_metadata pointer to PRM at /.well-known/oauth-protected-resource/mcp,
    // which names AS https://signin.executor.sh (full metadata: authorization_code +
    // refresh_token grants, PKCE S256, DCR registration_endpoint, public client via
    // auth method "none"). Request offline_access so the token endpoint returns a
    // refresh token (durable headless auth); openid for identity. Skip profile/email
    // — not needed for API access (same shape as glim).
    oauth: true,
    oauthScopes: ['openid', 'offline_access'],
  },
  {
    slug: 'glim',
    name: 'glim.sh',
    url: 'https://glim.sh/mcp',
    logo: 'https://raw.githubusercontent.com/glim-sh/glim-mcp/main/assets/icon-400.png',
    description: 'glim.sh - live data for AI agents: web search, full page extraction, Twitter/X, Reddit, GitHub, Amazon, YouTube transcripts. Pay-per-call with x402 (Base/Solana USDC) or MPP (Tempo), or sign in and draw from a prepaid account balance.',
    // Standard OAuth (PRM https://glim.sh/api/auth → AS metadata + DCR). Request
    // offline_access so the token endpoint returns a refresh token (durable headless
    // auth); openid for identity. Skip profile/email — not needed for API access.
    oauth: true,
    oauthScopes: ['openid', 'offline_access'],
  },
  {
    slug: 'finance-district',
    name: 'Finance District Agent Wallet',
    url: 'https://wallet-mcp.fd.xyz',
    logo: 'https://fd.xyz/apple-icon.png',
    description: 'Non-custodial MCP wallet for AI agents: hold and send across EVM, Solana, Bitcoin and Sui, swap tokens, earn DeFi yield, and make x402 payments — all within server-enforced spending caps, with keys that never leave a secure enclave (the agent never holds them).',
    // Standard OAuth. PRM (RFC 9728) at wallet-mcp.fd.xyz/.well-known/oauth-protected-resource
    // names AS https://oauth.fd.xyz (RFC 8414: authorization_code + refresh_token grants,
    // PKCE S256, DCR registration_endpoint, public client via auth "none"). offline_access
    // returns a refresh token; the resource scope grants tool access. oauth.fd.xyz rotates
    // refresh tokens, so GH_SECRETS_PAT is required (same as the other providers here).
    // Scopes verified live against the PRM's advertised scopes_supported — do NOT trim the
    // resource scope: unlike glim/executor this server gates tool access on it.
    oauth: true,
    oauthScopes: ['openid', 'offline_access', 'api://fd-agent-wallet-mcp/mcp:tools'],
  },
  {
    slug: 'posthog',
    name: 'PostHog',
    url: 'https://mcp.posthog.com/mcp',
    logo: 'https://avatars.githubusercontent.com/u/60330232?s=200&v=4',
    description: 'PostHog - product analytics from the agent: insights & HogQL/SQL queries, dashboards, feature flags, experiments, error tracking, and session replays. Hosted streamable-HTTP MCP with one-click OAuth Connect.',
    // Standard OAuth, probed live 2026-07-21: the 401 on /mcp carries a WWW-Authenticate
    // resource_metadata pointer to PRM at /.well-known/oauth-protected-resource/mcp,
    // which names AS https://oauth.posthog.com (full metadata: authorization_code +
    // refresh_token grants, PKCE S256, DCR registration_endpoint, public client via
    // auth method "none"). PostHog does NOT advertise offline_access (like Robinhood) —
    // refresh tokens come from the refresh_token grant by default, so don't request it.
    // Durable refresh (rotated-token persistence via GH_SECRETS_PAT) is handled
    // generically by scripts/mcp-oauth-refresh.sh — see docs/mcp-oauth.md.
    // Scope the grant to the read access these skills need: the flow otherwise falls
    // back to ALL scopes_supported, which includes every :write scope. Widen oauthScopes
    // when a skill needs more. Streamable HTTP (transport defaults to 'http').
    // NOTE: 'user:read' is REQUIRED even for read-only use — the MCP server calls a
    // whoami on session init and 403s the whole connection ("insufficient_scope,
    // scope=user:read") without it (verified 2026-07-21 against a live token). Missing
    // it makes every tool invisible: the handshake fails, so Claude Code sees no
    // mcp__posthog__* tools at all.
    oauth: true,
    oauthScopes: ['openid', 'user:read', 'organization:read', 'project:read', 'error_tracking:read'],
  },
  {
    slug: 'higgsfield',
    name: 'Higgsfield',
    url: 'https://mcp.higgsfield.ai/mcp',
    logo: 'https://higgsfield.ai/apple-touch-icon.png',
    description: 'Higgsfield - generative media from the agent: text-to-image, image-to-video and text-to-video with motion control, consistent characters, product placement, and cinematic looks across 100+ models. Hosted streamable-HTTP MCP with one-click OAuth Connect. Generation draws from your Higgsfield account credits.',
    // Standard OAuth, probed live 2026-08-04: a 401 on /mcp carries WWW-Authenticate
    // resource_metadata → PRM at /.well-known/oauth-protected-resource/mcp, which names
    // AS https://mcp.higgsfield.ai (upstream Clerk) with authorization_code + refresh_token
    // grants, PKCE S256, DCR (registration_endpoint /oauth2/register), public client via
    // auth method "none". Advertises offline_access, so the token endpoint returns a refresh
    // token (durable headless auth) — request it plus openid + email for identity. The PRM
    // also lists a device_code AS (fnf-device-auth.higgsfield.ai) for redirect-less clients;
    // the dashboard does the auth-code+PKCE flow, so we don't use it.
    // Durable refresh (rotated-token persistence via GH_SECRETS_PAT) is handled generically
    // by scripts/mcp-oauth-refresh.sh — see docs/mcp-oauth.md.
    oauth: true,
    oauthScopes: ['openid', 'email', 'offline_access'],
  },
]

export const MCP_BY_SLUG: Record<string, McpCatalogEntry> =
  Object.fromEntries(MCP_CATALOG.map(e => [e.slug, e]))

// --- credential names -------------------------------------------------------
// A server's credentials derive their secret names from its slug, so the
// operator never types one. Canonical HERE rather than in lib/mcp-oauth.ts
// because this module is dependency-free: the client-side MCP panel, the
// server-side OAuth flow, and the credential catalog all need the same
// derivation, and mcp-oauth.ts pulls in node:crypto. mcp-oauth.ts re-exports
// these, so its importers are unaffected.
export function tokenVar(slug: string): string {
  return 'MCP_' + slug.toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '_TOKEN'
}
export function oauthVar(slug: string): string {
  return 'MCP_' + slug.toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '_OAUTH'
}

// Any repo secret the two helpers above could have minted. Used to sort MCP
// credentials into their own Access Keys group instead of the "Skill Keys"
// catch-all every uncatalogued secret otherwise lands in.
export const MCP_SECRET_RE = /^MCP_[A-Z0-9_]+_(TOKEN|OAUTH)$/

// secret name -> the catalog entry that owns it. Built FORWARD from the slugs:
// the reverse is ambiguous, since MCP_ROBINHOOD_TRADING_TOKEN could have come
// from `robinhood-trading` or `robinhood_trading` (both sanitize to the same
// name). Anything not in here is a custom server the operator added by hand.
export const MCP_SECRET_OWNER: Record<string, McpCatalogEntry> = Object.fromEntries(
  MCP_CATALOG.flatMap(e => ([
    [tokenVar(e.slug), e],
    [oauthVar(e.slug), e],
  ] as [string, McpCatalogEntry][])),
)

// Display name for an MCP credential: the catalog's brand when we know the
// server, otherwise the slug read back out of the secret name. Best effort on
// that fallback - a custom server's hyphens are unrecoverable, so a server
// added as `my-server` reads back as "my server".
export function mcpServerLabel(secretName: string): string {
  const owner = MCP_SECRET_OWNER[secretName]
  if (owner) return owner.name
  return secretName.replace(/^MCP_/, '').replace(/_(TOKEN|OAUTH)$/, '').toLowerCase().replace(/_/g, ' ')
}
