import { GATEWAY_REGISTRY } from './gateway-registry'
import { MCP_SECRET_OWNER, MCP_SECRET_RE } from './mcp-catalog'

// Which brand mark each credential / group carries, and the rules for picking it.
// Kept apart from components/ui/ServiceIcon.tsx (the rendering) so it stays plain
// TS: apps/cli typechecks ../dashboard/lib/**/*.ts without `jsx`, so anything a
// lib test imports has to be reachable without touching a .tsx.

// LLM-gateway domains derive from the single registry so a new provider doesn't
// need a hand-added row here.
const GATEWAY_DOMAINS: Record<string, string> = Object.fromEntries(
  Object.values(GATEWAY_REGISTRY).map((p) => [p.secretName, p.domain] as [string, string]),
)

// Maps each credential / group to the brand domain whose logo we show. Logos
// come from DuckDuckGo's privacy-respecting favicon service (no domain list
// leaked to Google) and are rendered grayscale-by-default, lifting to full
// colour on row hover so they stay calm against the monochrome shell. When a
// service has no favicon (or the request fails) we fall back to a glyph or a
// monochrome initials badge so every row still carries a mark.
const DOMAINS: Record<string, string> = {
  // Core - Claude-native auth (LLM-gateway domains spread in from the registry)
  CLAUDE_CODE_OAUTH_TOKEN: 'claude.ai',
  ANTHROPIC_API_KEY: 'anthropic.com',
  // Grok Build (grok CLI) X-account OAuth session — same brand as XAI_API_KEY.
  GROK_CREDENTIALS: 'x.ai',
  // Native harness auth. A captured OAuth session carries the same brand as the
  // provider key it substitutes for, so CODEX_AUTH sits under OpenAI (Codex signs
  // in with ChatGPT) and KIMI_AUTH under Kimi, its own product domain.
  CODEX_AUTH: 'openai.com',
  OPENAI_API_KEY: 'openai.com',
  KIMI_AUTH: 'kimi.com',
  MOONSHOT_API_KEY: 'moonshot.ai',
  MISTRAL_API_KEY: 'mistral.ai',
  ...GATEWAY_DOMAINS,
  // Channels
  TELEGRAM_BOT_TOKEN: 'telegram.org',
  TELEGRAM_CHAT_ID: 'telegram.org',
  DISCORD_BOT_TOKEN: 'discord.com',
  DISCORD_CHANNEL_ID: 'discord.com',
  DISCORD_WEBHOOK_URL: 'discord.com',
  SLACK_BOT_TOKEN: 'slack.com',
  SLACK_CHANNEL_ID: 'slack.com',
  SLACK_WEBHOOK_URL: 'slack.com',
  // Skill keys
  XAI_API_KEY: 'x.ai',
  COINGECKO_API_KEY: 'coingecko.com',
  ALCHEMY_API_KEY: 'alchemy.com',
  ETHERSCAN_API_KEY: 'etherscan.io',
  BASESCAN_API_KEY: 'basescan.org',
  BANKR_API_KEY: 'bankr.bot',
  VERCEL_TOKEN: 'vercel.com',
  REPLICATE_API_TOKEN: 'replicate.com',
  RESEND_API_KEY: 'resend.com',
  ADMANAGE_API_KEY: 'admanage.ai',
  // All three GitHub PATs (write / read-only / secrets-write) carry the same mark.
  GH_GLOBAL: 'github.com',
  GH_READ_PAT: 'github.com',
  GH_SECRETS_PAT: 'github.com',
  BASE_RPC_URL: 'base.org',
  // Observability
  LANGFUSE_PUBLIC_KEY: 'langfuse.com',
  LANGFUSE_SECRET_KEY: 'langfuse.com',
}

// Non-brand entries - no logo exists, so show a meaningful glyph instead.
const GLYPHS: Record<string, ServiceGlyph> = {
  NOTIFY_EMAIL_TO: 'mail',
}

// MCP server credentials (MCP_<SLUG>_TOKEN / _OAUTH) carry their server's brand,
// taken from the same MCP_CATALOG row that drives the MCP page's Featured card -
// so a credential and the server it belongs to always show the same mark. These
// are full image URLs, not domains, so they ride in as explicit overrides rather
// than through the favicon service.
const MCP_ICON_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(MCP_SECRET_OWNER).map(([name, entry]) => [name, entry.logo]),
)

// Explicit logo overrides for services whose favicon is wrong/outdated. Vendored
// into public/icons so they don't depend on a third-party host staying up.
const ICON_URLS: Record<string, string> = {
  ...MCP_ICON_URLS,
}

// A credential's glyph fallback. Custom MCP servers aren't in the catalog, so
// there's no logo to show - give them the generic server mark rather than the
// grey two-letter badge, which would make a whole MCP group look broken.
function glyphFor(name: string): ServiceGlyph | undefined {
  if (GLYPHS[name]) return GLYPHS[name]
  if (MCP_SECRET_RE.test(name)) return 'server'
  return undefined
}

// Same idea, keyed by DOMAIN — applies to group headers (which pass `domain`
// directly) as well as any credential resolving to that domain. Langfuse's
// favicon-service icon renders as a generic mark, so we vendor the real logo.
const DOMAIN_ICON_URLS: Record<string, string> = {
  'langfuse.com': '/icons/langfuse.svg',
}

export type ServiceGlyph = 'mail' | 'key' | 'server'

export interface ServiceMarkQuery {
  // A credential / group name resolved against the maps above…
  name?: string
  // …or pass a domain / glyph directly (used for group headers).
  domain?: string
  glyph?: ServiceGlyph
}

export function faviconUrl(domain: string): string {
  return `https://icons.duckduckgo.com/ip3/${domain}.ico`
}

// Resolve a credential / group to the mark it renders: a logo `src`, a `glyph`,
// or neither (the initials badge). Exported so a test can assert every catalogued
// secret earns a real mark. The maps above and lib/secrets-catalog.ts are separate
// lists, and a credential added to only one of them silently degrades to a grey
// two-letter badge - which is how CODEX_AUTH, KIMI_AUTH, OPENAI_API_KEY,
// MOONSHOT_API_KEY, MISTRAL_API_KEY, GH_READ_PAT and GH_SECRETS_PAT lost theirs.
export function resolveServiceMark({ name, domain, glyph }: ServiceMarkQuery): {
  src?: string
  glyph?: ServiceGlyph
} {
  const resolvedDomain = domain ?? (name ? DOMAINS[name] : undefined)
  // Explicit override wins over the domain favicon; a vendored domain logo wins
  // over the favicon service.
  const explicitSrc = name ? ICON_URLS[name] : undefined
  const domainSrc = resolvedDomain ? (DOMAIN_ICON_URLS[resolvedDomain] ?? faviconUrl(resolvedDomain)) : undefined
  return { src: explicitSrc ?? domainSrc, glyph: glyph ?? (name ? glyphFor(name) : undefined) }
}
