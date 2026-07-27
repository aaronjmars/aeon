'use client'

import { useState } from 'react'
import { GATEWAY_REGISTRY } from '@/lib/gateway-registry'

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
const GLYPHS: Record<string, 'mail' | 'key'> = {
  NOTIFY_EMAIL_TO: 'mail',
}

// Explicit logo overrides for services whose favicon is wrong/outdated. Vendored
// into public/icons so they don't depend on a third-party host staying up.
const ICON_URLS: Record<string, string> = {
}

// Same idea, keyed by DOMAIN — applies to group headers (which pass `domain`
// directly) as well as any credential resolving to that domain. Langfuse's
// favicon-service icon renders as a generic mark, so we vendor the real logo.
const DOMAIN_ICON_URLS: Record<string, string> = {
  'langfuse.com': '/icons/langfuse.svg',
}

// Heroicons (outline) paths - match the stroke icons used elsewhere in the UI.
const GLYPH_PATHS: Record<'mail' | 'key', string> = {
  mail: 'M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75',
  key: 'M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25z',
}

function faviconUrl(domain: string): string {
  return `https://icons.duckduckgo.com/ip3/${domain}.ico`
}

function initials(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9]/g, '')
  return (clean.slice(0, 2) || '?').toUpperCase()
}

interface ServiceIconProps {
  // A credential / group name resolved against the maps above…
  name?: string
  // …or pass a domain / glyph directly (used for group headers).
  domain?: string
  glyph?: 'mail' | 'key'
  className?: string
}

// Resolve a credential / group to the mark it renders: a logo `src`, a `glyph`,
// or neither (the initials badge). Exported so a test can assert every catalogued
// secret earns a real mark. The maps above and lib/secrets-catalog.ts are separate
// lists, and a credential added to only one of them silently degrades to a grey
// two-letter badge - which is how CODEX_AUTH, KIMI_AUTH, OPENAI_API_KEY,
// MOONSHOT_API_KEY, MISTRAL_API_KEY, GH_READ_PAT and GH_SECRETS_PAT lost theirs.
export function resolveServiceMark({ name, domain, glyph }: Omit<ServiceIconProps, 'className'>): {
  src?: string
  glyph?: 'mail' | 'key'
} {
  const resolvedDomain = domain ?? (name ? DOMAINS[name] : undefined)
  // Explicit override wins over the domain favicon; a vendored domain logo wins
  // over the favicon service.
  const explicitSrc = name ? ICON_URLS[name] : undefined
  const domainSrc = resolvedDomain ? (DOMAIN_ICON_URLS[resolvedDomain] ?? faviconUrl(resolvedDomain)) : undefined
  return { src: explicitSrc ?? domainSrc, glyph: glyph ?? (name ? GLYPHS[name] : undefined) }
}

export function ServiceIcon({ name, domain, glyph, className = '' }: ServiceIconProps) {
  const [failed, setFailed] = useState(false)
  const { src, glyph: resolvedGlyph } = resolveServiceMark({ name, domain, glyph })

  // Light chip backing so dark/filled marks (GitHub, Base, x.AI…) stay legible
  // against the near-black UI. Logos sit grayscale-and-calm, lifting to full
  // colour on row hover.
  const box = `inline-flex items-center justify-center w-[22px] h-[22px] rounded-sm overflow-hidden shrink-0 ring-1 ring-[rgba(250,250,250,0.14)] bg-[rgba(248,248,248,0.94)] ${className}`

  if (src && !failed) {
    return (
      <span className={box} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          loading="lazy"
          width={16}
          height={16}
          onError={() => setFailed(true)}
          className="w-[16px] h-[16px] object-contain grayscale opacity-85 transition-[filter,opacity] duration-200 group-hover:grayscale-0 group-hover:opacity-100"
        />
      </span>
    )
  }

  if (resolvedGlyph) {
    return (
      <span className={box} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-[13px] h-[13px] text-[rgba(10,10,10,0.55)]">
          <path strokeLinecap="round" strokeLinejoin="round" d={GLYPH_PATHS[resolvedGlyph]} />
        </svg>
      </span>
    )
  }

  return (
    <span className={`${box} font-mono text-[9px] tracking-tight text-[rgba(10,10,10,0.6)]`} aria-hidden="true">
      {initials(name ?? '')}
    </span>
  )
}
