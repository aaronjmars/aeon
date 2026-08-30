'use client'

import { useState, useEffect } from 'react'
import type { Secret, Skill } from '../lib/types'
import { inputCls, displayName } from '../lib/utils'
import { keyProvidedByHarness } from '../lib/constants'
import { Scramble } from './ui/Animated'
import { ServiceIcon } from './ui/ServiceIcon'
import type { ServiceGlyph } from '../lib/service-icons'
import { linkify } from './ui/Linkify'
import { InstantModeCard } from './InstantModeCard'
import { LangfuseRegionCard } from './LangfuseRegionCard'
import { TelegramCommandsCard } from './TelegramCommandsCard'
import { TelegramChatIdHelper } from './TelegramChatIdHelper'
import { OAUTH_SECRET_HARNESS } from '../lib/harness-auth'

// Logo shown next to each credential group's header. Brand groups use their
// favicon; non-brand groups use a glyph.
const GROUP_ICON: Record<string, { domain?: string; glyph?: ServiceGlyph }> = {
  Core: { glyph: 'key' },
  Telegram: { domain: 'telegram.org' },
  Discord: { domain: 'discord.com' },
  Slack: { domain: 'slack.com' },
  Email: { glyph: 'mail' },
  Observability: { domain: 'langfuse.com' },
  MCP: { glyph: 'server' },
  'Skill Keys': { glyph: 'key' },
}

// Render order. MCP sits next to Skill Keys because both answer "what can a
// skill reach out to". It's populated dynamically from whatever MCP_*_TOKEN /
// _OAUTH secrets exist (see describeMcpSecret in lib/secrets-catalog.ts), so
// the section simply doesn't render until a server is connected.
const GROUP_ORDER = ['Core', 'Telegram', 'Discord', 'Slack', 'Email', 'Observability', 'MCP', 'Skill Keys']

interface SecretsPanelProps {
  secrets: Secret[]
  skills: Skill[]
  busy: Record<string, boolean>
  repo: string
  harness: string
  focusKey?: string | null
  onFocusHandled?: () => void
  onSave: (name: string, value: string) => void
  onDelete: (name: string) => void
  onSelectSkill: (name: string) => void
  onConnectClaude: () => void
  connecting?: boolean
  onConnectGrok: () => void
  grokConnecting?: boolean
  onConnectHarness: (harness: string) => void
  harnessConnecting?: boolean
  onConnectGithub: () => void
  githubConnecting?: boolean
}

export function SecretsPanel({ secrets, skills, busy, repo, harness, focusKey, onFocusHandled, onSave, onDelete, onSelectSkill, onConnectClaude, connecting, onConnectGrok, grokConnecting, onConnectHarness, harnessConnecting, onConnectGithub, githubConnecting }: SecretsPanelProps) {
  const [editingSecret, setEditingSecret] = useState<string | null>(null)
  const [secretValue, setSecretValue] = useState('')
  const [addingSecret, setAddingSecret] = useState(false)
  const [newSecretName, setNewSecretName] = useState('')
  // Bot token saved this session, kept to pre-fill the chat-ID helper —
  // GitHub secrets are write-only, so it can't be read back later.
  const [sessionBotToken, setSessionBotToken] = useState('')

  // Deep-link from a skill's API-keys panel: open the requested key's editor,
  // scroll it into view, and clear the request so re-navigating works.
  useEffect(() => {
    if (!focusKey) return
    setEditingSecret(focusKey)
    setSecretValue('')
    const t = setTimeout(() => {
      document.getElementById(`secret-${focusKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 60)
    onFocusHandled?.()
    return () => clearTimeout(t)
  }, [focusKey, onFocusHandled])

  // Reverse index: which skills declare each credential, and whether they
  // require it or just work better with it. Powers the "used by" line so the
  // operator can see what a key unlocks before setting it.
  const usedBy = new Map<string, { name: string; optional: boolean }[]>()
  for (const sk of skills) {
    for (const r of sk.requires ?? []) {
      const list = usedBy.get(r.key) ?? []
      list.push({ name: sk.name, optional: r.optional })
      usedBy.set(r.key, list)
    }
  }

  // Claude Code auth is an either/or pair (OAuth token or API key). Once either
  // is set, auth is satisfied - so the OAuth "Connect" button is redundant.
  const claudeAuthSet = secrets.some(s => s.either === 'auth' && s.isSet)

  const handleSave = (name: string) => {
    if (!secretValue.trim()) return
    if (name === 'TELEGRAM_BOT_TOKEN') setSessionBotToken(secretValue.trim())
    onSave(name, secretValue.trim())
    setEditingSecret(null)
    setSecretValue('')
    setAddingSecret(false)
    setNewSecretName('')
  }

  return (
    <div className="max-w-5xl mx-auto pb-16 space-y-10">
      <section className="relative overflow-hidden border border-[rgba(250,250,250,0.10)] bg-aeon-panel">
        <div className="dither" aria-hidden="true" />
        <div className="relative z-10 px-8 pt-10 pb-8">
          <h1 className="font-display uppercase leading-[0.92] tracking-tight text-aeon-fg"
              style={{ fontSize: 'clamp(40px, 6.5vw, 88px)' }}>
            <Scramble text="ACCESS" />{' '}
            <span className="text-aeon-red"><Scramble text="KEYS" delay={180} /></span>
          </h1>
          <p className="mt-4 max-w-xl text-sm text-primary-70 leading-relaxed">
            Set a secret, the channel turns on.
          </p>
        </div>
      </section>

      {GROUP_ORDER.map(group => {
        const gs = secrets.filter(s => s.group === group); if (!gs.length) return null
        return (
          <section key={group} className="border-t border-[rgba(250,250,250,0.10)] pt-6">
            <div className="group flex items-center gap-3 mb-4">
              <ServiceIcon domain={GROUP_ICON[group]?.domain} glyph={GROUP_ICON[group]?.glyph} />
              <span className="font-display text-[13px] tracking-[0.18em] text-aeon-red uppercase">
                {group}
              </span>
              <span className="flex-1 h-px bg-[rgba(250,250,250,0.10)]" />
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary-35">
                {/* MCP rows only exist once a server is connected, so "n / n set"
                    would always read 100%. Count them instead. */}
                {group === 'MCP'
                  ? `${gs.length} credential${gs.length === 1 ? '' : 's'}`
                  : `${gs.filter(s => s.isSet).length} / ${gs.length} set`}
              </span>
            </div>
            {group === 'MCP' && (
              <p className="text-[11px] text-primary-40 leading-relaxed mb-3 -mt-1">
                Credentials belonging to the servers on the <span className="text-primary-70">MCP</span> page. They are
                created there (paste a bearer token, or Connect for OAuth) and listed here so every key the agent holds
                shows up in one inventory. Removing one here leaves its server wired in <span className="text-primary-70">.mcp.json</span> but
                unauthenticated, and runs will skip MCP with a warning until it is set again.
              </p>
            )}
            <div className="border border-[rgba(250,250,250,0.10)] divide-y divide-[rgba(250,250,250,0.08)]">
              {gs.map(secret => (
                <div key={secret.name} id={`secret-${secret.name}`} className={`group px-[var(--space-md)] py-[var(--space-sm)] scroll-mt-24 transition-colors ${editingSecret === secret.name ? 'bg-aeon-red/5' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <ServiceIcon name={secret.name} className="mt-0.5" />
                      <div className="min-w-0">
                      <div className="flex items-center gap-2"><span className="font-mono text-xs">{secret.name}</span><span className={`w-2 h-2 rounded-full ${secret.isSet ? 'bg-aeon-green' : 'bg-[rgba(250,250,250,0.15)]'}`} /></div>
                      <div className="text-[11px] text-primary-40 font-mono">{linkify(secret.description)}</div>
                      {keyProvidedByHarness(secret.name, harness) && !secret.isSet && (
                        <div className="text-[10px] text-aeon-green/80 font-mono mt-1 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-aeon-green shrink-0" />
                          Covered by the Grok Build harness (built-in web search) - optional here; set it for the premium xAI x_search feed, used by both harnesses.
                        </div>
                      )}
                      {secret.name === 'TELEGRAM_BOT_TOKEN' && (
                        <a
                          href="https://t.me/BotFather"
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Opens BotFather in Telegram. Send /newbot and follow the prompts (or /token for an existing bot) - it replies with the bot token, e.g. 123456789:AAxx... Paste that here."
                          className="inline-block text-[10px] font-mono text-aeon-red/80 hover:text-aeon-red transition-colors mt-1"
                        >
                          Get one from @BotFather ↗
                        </a>
                      )}
                      {secret.name === 'TELEGRAM_CHAT_ID' && (
                        <TelegramChatIdHelper
                          defaultToken={sessionBotToken}
                          onFound={(chatId) => { setEditingSecret('TELEGRAM_CHAT_ID'); setSecretValue(chatId) }}
                        />
                      )}
                      {(usedBy.get(secret.name)?.length ?? 0) > 0 && (
                        <div className="text-[10px] text-primary-35 font-mono mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                          <span className="uppercase tracking-[0.14em] text-primary-30">Used by</span>
                          {usedBy.get(secret.name)!
                            .sort((a, b) => Number(a.optional) - Number(b.optional))
                            .map(u => (
                              <button
                                key={u.name}
                                onClick={() => onSelectSkill(u.name)}
                                title={u.optional ? 'Works better with this key' : 'Required for this skill'}
                                className={`hover:text-aeon-fg transition-colors ${u.optional ? 'text-primary-40' : 'text-aeon-red/80'}`}
                              >
                                {displayName(u.name)}
                              </button>
                            ))}
                        </div>
                      )}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {secret.name === 'CLAUDE_CODE_OAUTH_TOKEN' && !claudeAuthSet && <button onClick={onConnectClaude} disabled={connecting} title="Run the Claude Code OAuth flow - signs in with your Claude Pro/Max plan, no API key or manual token needed." className="text-[11px] text-aeon-bg bg-aeon-fg font-mono px-2.5 py-1 hover:opacity-90 transition-opacity disabled:opacity-50">{connecting ? '…' : 'Connect'}</button>}
                      {secret.name === 'GROK_CREDENTIALS' && <button onClick={onConnectGrok} disabled={grokConnecting} title="Run the Grok Build device-auth flow - opens your browser to approve on accounts.x.ai, then stores the session for CI. Use Reconnect if the session expires." className="text-[11px] text-aeon-bg bg-aeon-fg font-mono px-2.5 py-1 hover:opacity-90 transition-opacity disabled:opacity-50">{grokConnecting ? '…' : (secret.isSet ? 'Reconnect' : 'Connect')}</button>}
                      {secret.name === 'GH_GLOBAL' && <button onClick={onConnectGithub} disabled={githubConnecting} title="Copy this machine's GitHub CLI token into GH_GLOBAL so Actions can push, open PRs, and call other repos. Uses the gh session the dashboard already has - no extra login. Use Reconnect after gh auth switch. Or paste a PAT with Set." className="text-[11px] text-aeon-bg bg-aeon-fg font-mono px-2.5 py-1 hover:opacity-90 transition-opacity disabled:opacity-50">{githubConnecting ? '…' : (secret.isSet ? 'Reconnect' : 'Connect')}</button>}
                      {OAUTH_SECRET_HARNESS[secret.name] && <button onClick={() => onConnectHarness(OAUTH_SECRET_HARNESS[secret.name])} disabled={harnessConnecting} title={`Run the ${OAUTH_SECRET_HARNESS[secret.name]} login flow - opens your browser to approve, then stores the session for CI. Use Reconnect if it expires.`} className="text-[11px] text-aeon-bg bg-aeon-fg font-mono px-2.5 py-1 hover:opacity-90 transition-opacity disabled:opacity-50">{harnessConnecting ? '…' : (secret.isSet ? 'Reconnect' : 'Connect')}</button>}
                      {!secret.isSet && editingSecret !== secret.name && !OAUTH_SECRET_HARNESS[secret.name] && <button onClick={() => { setEditingSecret(secret.name); setSecretValue('') }} className="btn-mini">Set</button>}
                      {secret.isSet && <button onClick={() => onDelete(secret.name)} disabled={!!busy[`sec-${secret.name}`]} className="btn-mini-danger">Remove</button>}
                    </div>
                  </div>
                  {editingSecret === secret.name && (
                    <div className="flex gap-2 mt-2">
                      <input type="password" value={secretValue} onChange={(e) => setSecretValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSave(secret.name)} placeholder="paste value..." autoFocus className={inputCls} />
                      <button onClick={() => handleSave(secret.name)} disabled={!secretValue.trim()} className="btn-mini-go">Save</button>
                      <button onClick={() => { setEditingSecret(null); setSecretValue('') }} className="btn-mini">Cancel</button>
                    </div>
                  )}
                </div>
              ))}
              {group === 'Telegram' && <TelegramCommandsCard tokenSet={secrets.some(s => s.name === 'TELEGRAM_BOT_TOKEN' && s.isSet)} />}
              {group === 'Telegram' && <InstantModeCard repo={repo} sessionBotToken={sessionBotToken} />}
              {group === 'Observability' && <LangfuseRegionCard keysSet={secrets.some(s => s.name === 'LANGFUSE_PUBLIC_KEY' && s.isSet) && secrets.some(s => s.name === 'LANGFUSE_SECRET_KEY' && s.isSet)} />}
            </div>
          </section>
        )
      })}
      <div>{addingSecret ? (<div className="space-y-2"><input type="text" value={newSecretName} onChange={(e) => setNewSecretName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} placeholder="SECRET_NAME" autoFocus className={inputCls} />{newSecretName && <div className="flex gap-2"><input type="password" value={secretValue} onChange={(e) => setSecretValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSave(newSecretName)} placeholder="value..." className={inputCls} /><button onClick={() => handleSave(newSecretName)} disabled={!secretValue.trim()} className="btn-mini-go">Save</button></div>}<button onClick={() => { setAddingSecret(false); setNewSecretName(''); setSecretValue('') }} className="btn-mini">Cancel</button></div>) : <button onClick={() => setAddingSecret(true)} className="w-full text-sm font-mono uppercase tracking-[0.14em] text-primary-60 border border-dashed border-[rgba(250,250,250,0.16)] py-3.5 hover:text-aeon-red hover:border-aeon-red/40 transition-colors">+ Add Credential</button>}</div>
    </div>
  )
}
