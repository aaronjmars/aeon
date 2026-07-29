// MCP OAuth (Authorization Code + PKCE) helper — the core of the dashboard's
// "Connect" flow for OAuth-gated MCP servers. Because the dashboard runs on the
// operator's own machine (same assumption as app/api/grok-auth), it can open the
// browser for the authorization step and store the resulting tokens as repo
// secrets, exactly parallel to how "Connect X account" captures GROK_CREDENTIALS.
//
// The durable part: we persist the *refresh* token (+ token endpoint + client id)
// in an MCP_<SLUG>_OAUTH secret, and scripts/mcp-oauth-refresh.sh mints a fresh
// access token before every headless run. .mcp.json only ever references the
// short-lived access token as `Authorization: Bearer ${MCP_<SLUG>_TOKEN}`.
//
// Spec basis: OAuth 2.0 Authorization Code + PKCE (RFC 7636), Protected Resource
// Metadata (RFC 9728), Authorization Server Metadata (RFC 8414 / OIDC discovery),
// and Dynamic Client Registration (RFC 7591) — the set the MCP Authorization spec
// builds on. Every network hop is best-effort with clear errors: a server that
// advertises none of this simply can't be auto-connected, and we say so.
import { randomBytes, createHash } from 'crypto'

// --- secret names -----------------------------------------------------------
// A server's access token and its OAuth refresh material derive their secret
// names from the slug, so the operator never types a secret name. Defined in
// ./mcp-catalog (dependency-free, so the MCP panel and the credential catalog
// can share the exact derivation without importing node:crypto via this file);
// re-exported here because the OAuth flow is this module's public surface.
export { tokenVar, oauthVar } from './mcp-catalog'

// --- PKCE + state -----------------------------------------------------------
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function makePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32)) // 43 chars, within RFC 7636's 43–128
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}
export function makeState(): string {
  return base64url(randomBytes(16))
}

// --- discovery --------------------------------------------------------------
export interface AsMetadata {
  issuer?: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  scopes_supported?: string[]
  code_challenge_methods_supported?: string[]
}

// The `resource` value (RFC 8707) the MCP server identifies itself by, plus the
// resolved authorization-server metadata used to drive the flow.
export interface Discovery {
  resource: string
  authServer: string
  metadata: AsMetadata
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } })
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status}`)
  return res.json()
}

// Resolve a URL against a well-known suffix, preserving any resource path per
// RFC 9728 (`/.well-known/oauth-protected-resource` MAY carry the resource path).
function wellKnown(base: string, suffix: string): string {
  const u = new URL(base)
  const path = u.pathname.replace(/\/$/, '')
  return `${u.origin}/.well-known/${suffix}${path && path !== '' ? path : ''}`
}

// Given an MCP server URL, discover its authorization server + endpoints.
export async function discover(mcpUrl: string): Promise<Discovery> {
  const origin = new URL(mcpUrl).origin
  // 1. Protected Resource Metadata (RFC 9728) — optional. Try path- then origin-scoped.
  let prm: { authorization_servers?: string[]; resource?: string } | undefined
  for (const url of [wellKnown(mcpUrl, 'oauth-protected-resource'), `${origin}/.well-known/oauth-protected-resource`]) {
    try { prm = (await fetchJson(url)) as typeof prm; if (prm?.authorization_servers?.length) break } catch { /* try next */ }
  }
  // If PRM names an authorization server, use it. Otherwise fall back to the MCP
  // server's OWN origin acting as its authorization server — the behavior compliant
  // clients use for a self-issuing server that skips PRM (e.g. Base: issuer ==
  // mcp.base.org, AS metadata at the origin well-known). Its metadata is loaded next.
  const authServer = prm?.authorization_servers?.[0] ?? origin
  const resource = prm?.resource ?? origin

  // 2. Authorization Server Metadata (RFC 8414), falling back to OIDC discovery.
  let meta: AsMetadata | undefined
  for (const url of [
    wellKnown(authServer, 'oauth-authorization-server'),
    `${new URL(authServer).origin}/.well-known/oauth-authorization-server`,
    `${authServer.replace(/\/$/, '')}/.well-known/openid-configuration`,
  ]) {
    try {
      const m = (await fetchJson(url)) as AsMetadata
      if (m?.authorization_endpoint && m?.token_endpoint) { meta = m; break }
    } catch { /* try next */ }
  }
  if (!meta) {
    throw new Error(
      `No OAuth metadata found for ${mcpUrl} — it advertises neither Protected Resource ` +
      `Metadata nor Authorization Server Metadata. It likely uses a static bearer token; ` +
      `paste one on the server row instead.`,
    )
  }
  return { resource, authServer, metadata: meta }
}

// --- dynamic client registration (RFC 7591) ---------------------------------
export interface ClientCreds { client_id: string; client_secret?: string }

export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  clientName = 'Aeon Dashboard',
): Promise<ClientCreds> {
  const body = {
    client_name: clientName,
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none', // public client (PKCE); AS may override
  }
  const reg = (await fetchJson(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })) as ClientCreds
  if (!reg.client_id) throw new Error('Dynamic client registration returned no client_id')
  return { client_id: reg.client_id, client_secret: reg.client_secret }
}

// --- authorization URL ------------------------------------------------------
export function authorizeUrl(opts: {
  metadata: AsMetadata
  clientId: string
  redirectUri: string
  challenge: string
  state: string
  resource: string
  scopes?: string[]
}): string {
  const u = new URL(opts.metadata.authorization_endpoint)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', opts.clientId)
  u.searchParams.set('redirect_uri', opts.redirectUri)
  u.searchParams.set('code_challenge', opts.challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('state', opts.state)
  u.searchParams.set('resource', opts.resource) // RFC 8707 audience binding
  if (opts.scopes?.length) u.searchParams.set('scope', opts.scopes.join(' '))
  return u.toString()
}

// --- token endpoint (exchange + refresh) ------------------------------------
export interface TokenSet {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
}

function tokenForm(params: Record<string, string | undefined>): URLSearchParams {
  const f = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) f.set(k, v)
  return f
}

async function postToken(tokenEndpoint: string, form: URLSearchParams, clientSecret?: string): Promise<TokenSet> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
  // Confidential clients authenticate with HTTP Basic; public (PKCE) clients pass client_id in the body.
  if (clientSecret) {
    const clientId = form.get('client_id') ?? ''
    headers.Authorization = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    form.delete('client_secret')
  }
  const res = await fetch(tokenEndpoint, { method: 'POST', headers, body: form.toString() })
  const text = await res.text()
  if (!res.ok) throw new Error(`token endpoint → ${res.status}: ${text.slice(0, 200)}`)
  const tok = JSON.parse(text) as TokenSet
  if (!tok.access_token) throw new Error('token endpoint returned no access_token')
  return tok
}

export async function exchangeCode(opts: {
  tokenEndpoint: string
  code: string
  verifier: string
  clientId: string
  clientSecret?: string
  redirectUri: string
  resource: string
}): Promise<TokenSet> {
  return postToken(opts.tokenEndpoint, tokenForm({
    grant_type: 'authorization_code',
    code: opts.code,
    code_verifier: opts.verifier,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
    resource: opts.resource,
  }), opts.clientSecret)
}

// The JSON blob persisted as the MCP_<SLUG>_OAUTH secret. Everything the runtime
// refresh (scripts/mcp-oauth-refresh.sh) needs to mint a fresh access token, with
// no interactive step. Note it carries refresh material — treat as a secret.
export interface OAuthSecret {
  token_endpoint: string
  client_id: string
  client_secret?: string
  refresh_token: string
  scope?: string
  slug: string
}
