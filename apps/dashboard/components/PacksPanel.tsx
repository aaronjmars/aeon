'use client'

import { useState } from 'react'
import type { Pack, CommunityPack, Skill } from '../lib/types'
import { displayName } from '../lib/utils'
import { FIRST_PARTY_KEYS, DEFAULT_VISIBLE_PACKS } from '../lib/constants'
import { Section } from './ui/Section'

interface PacksPanelProps {
  firstParty: Pack[]
  community: CommunityPack[]
  skills: Skill[]
  enabledPacks: string[]
  loading: boolean
  busy: Record<string, boolean>
  onTogglePack: (key: string) => void
  onToggleSkill: (slug: string, enabled: boolean) => void
  onSelectSkill: (slug: string) => void
  onInstallPack: (arg: string) => Promise<void> | void
}

// A pack's skills can live in a subdirectory of its repo (declared via `path` in
// skill-packs.json). Forward it as a `--path` flag so both the one-click install
// and the copyable command point the installer at the right manifest. See #492.
function installArg(pack: CommunityPack): string {
  return pack.path ? `${pack.repo} --path ${pack.path}` : pack.repo
}

function trustTone(level?: string): string {
  if (level === 'trusted') return 'text-aeon-green border-aeon-green/40 bg-aeon-green/10'
  if (level === 'community') return 'text-aeon-amber border-aeon-amber/40 bg-aeon-amber/10'
  return 'text-primary-40 border-[rgba(250,250,250,0.18)]'
}

export function PacksPanel({ firstParty, community, skills, enabledPacks, loading, busy, onTogglePack, onToggleSkill, onSelectSkill, onInstallPack }: PacksPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)

  const handleCopy = async (pack: CommunityPack) => {
    try {
      await navigator.clipboard.writeText(`bin/install-skill-pack ${installArg(pack)}`)
      setCopied(pack.repo)
      setTimeout(() => setCopied(c => (c === pack.repo ? null : c)), 1500)
    } catch { /* clipboard blocked — the command is still shown in the tooltip */ }
  }

  const handleInstall = async (pack: CommunityPack) => {
    setInstalling(pack.repo)
    try { await onInstallPack(installArg(pack)) } finally { setInstalling(null) }
  }

  // Live enabled state comes from the skills roster (single source of truth), so
  // toggling a skill updates the counts here instantly. Hide declared-but-empty
  // packs (e.g. the Lab catch-all when nothing is unsorted).
  const enabledBySlug = new Map(skills.map(s => [s.name, s.enabled]))
  // Default-visible packs (Core + Basics) and community packs (anything not
  // first-party — installed from another repo) are always shown, not togglable:
  // Core/Basics are the load-bearing default set, and community skills are ones
  // you added on purpose.
  const isPackOn = (key: string) => DEFAULT_VISIBLE_PACKS.has(key) || !FIRST_PARTY_KEYS.has(key) || enabledPacks.includes(key)
  const visiblePacks = firstParty.filter(p => p.total > 0).map(p => {
    const members = p.skills.map(s => ({ ...s, enabled: enabledBySlug.get(s.slug) ?? false }))
    return { ...p, skills: members, enabled: members.filter(m => m.enabled).length }
  })
  const totalSkills = visiblePacks.reduce((n, p) => n + p.total, 0)
  const onDuty = visiblePacks.reduce((n, p) => n + p.enabled, 0)
  const packsOn = visiblePacks.filter(p => isPackOn(p.key)).length

  const stats = [
    { label: 'Packs', value: visiblePacks.length },
    { label: 'Enabled', value: packsOn, tone: 'text-aeon-green' },
    { label: 'Skills', value: totalSkills },
    { label: 'Enabled', value: onDuty, tone: 'text-aeon-green' },
  ]

  if (loading) {
    // Skeleton mirrors the loaded layout (hero + stat grid + card grid) so the
    // page doesn't reflow when data lands. Static labels stay real; only the
    // data-driven surfaces pulse.
    return (
      <div className="max-w-5xl mx-auto pb-16 space-y-10" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading packs…</span>

        {/* Hero skeleton */}
        <section className="relative overflow-hidden border border-[rgba(250,250,250,0.10)] bg-aeon-panel">
          <div className="dither" aria-hidden="true" />
          <div className="relative z-10 px-8 pt-10 pb-8">
            <div className="h-14 w-56 bg-[rgba(250,250,250,0.14)] animate-pulse" />
            <div className="mt-6 max-w-xl space-y-2">
              <div className="h-3 w-full bg-[rgba(250,250,250,0.07)] animate-pulse" />
              <div className="h-3 w-4/5 bg-[rgba(250,250,250,0.07)] animate-pulse" />
            </div>
          </div>
          <dl className="relative z-10 grid grid-cols-2 sm:grid-cols-4 border-t border-[rgba(250,250,250,0.10)]">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`px-6 py-5 ${i < 3 ? 'border-r border-[rgba(250,250,250,0.10)]' : ''}`}>
                <div className="h-2.5 w-12 bg-[rgba(250,250,250,0.10)] mb-3 animate-pulse" />
                <div className="h-8 w-10 bg-[rgba(250,250,250,0.12)] animate-pulse" />
              </div>
            ))}
          </dl>
        </section>

        {/* Pack card grid skeleton */}
        <Section label="Your packs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-[rgba(250,250,250,0.10)] border border-[rgba(250,250,250,0.10)]">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-aeon-bg px-6 py-5 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <span className="mt-1 w-2.5 h-2.5 rounded-full bg-[rgba(250,250,250,0.14)] shrink-0 animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-32 bg-[rgba(250,250,250,0.14)] animate-pulse" />
                    <div className="h-2.5 w-20 bg-[rgba(250,250,250,0.08)] animate-pulse" />
                  </div>
                </div>
                <div className="space-y-2 pt-1">
                  <div className="h-2.5 w-full bg-[rgba(250,250,250,0.06)] animate-pulse" />
                  <div className="h-2.5 w-5/6 bg-[rgba(250,250,250,0.06)] animate-pulse" />
                </div>
                <div className="mt-auto flex items-center gap-2 pt-2">
                  <div className="h-7 w-24 bg-[rgba(250,250,250,0.08)] animate-pulse" />
                  <div className="h-7 w-20 bg-[rgba(250,250,250,0.06)] animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto pb-16 space-y-10">
      {/* Hero */}
      <section className="relative overflow-hidden border border-[rgba(250,250,250,0.10)] bg-aeon-panel">
        <div className="dither" aria-hidden="true" />
        <div className="relative z-10 px-8 pt-10 pb-8">
          <h1 className="font-display uppercase leading-[0.92] tracking-tight text-aeon-fg" style={{ fontSize: 'clamp(40px, 6vw, 80px)' }}>
            PACKS
          </h1>
          <p className="mt-4 max-w-xl text-sm text-primary-70 leading-relaxed">
            Curated bundles of skills.
          </p>
        </div>
        <dl className="relative z-10 grid grid-cols-2 sm:grid-cols-4 border-t border-[rgba(250,250,250,0.10)]">
          {stats.map((s, i) => (
            <div key={i} className={`px-6 py-5 ${i < stats.length - 1 ? 'border-r border-[rgba(250,250,250,0.10)]' : ''}`}>
              <dt className="text-[10px] font-mono uppercase tracking-[0.22em] text-primary-35 mb-2">{s.label}</dt>
              <dd className={`font-display leading-none ${s.tone || 'text-aeon-fg'}`} style={{ fontSize: 'clamp(28px, 3vw, 44px)' }}>{s.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* First-party packs */}
      <Section label="Your packs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-[rgba(250,250,250,0.10)] border border-[rgba(250,250,250,0.10)]">
          {visiblePacks.map(pack => {
            const isDefaultVisible = DEFAULT_VISIBLE_PACKS.has(pack.key)
            const isCommunity = !FIRST_PARTY_KEYS.has(pack.key)
            const isLocked = isDefaultVisible || isCommunity
            const on = isPackOn(pack.key)
            const open = expanded === pack.key
            return (
              <div key={pack.key} className="bg-aeon-bg flex flex-col">
                <div className="px-6 py-5 flex flex-col gap-3 flex-1">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: on ? pack.color : 'rgba(250,250,250,0.18)' }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-display uppercase tracking-wide text-aeon-fg text-base leading-tight">{pack.name}</span>
                        {isCommunity && <span className="text-[9px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 border border-primary-40 text-primary-70">installed</span>}
                      </div>
                      <div className="text-[11px] text-primary-40 font-mono mt-1 uppercase tracking-[0.14em]">
                        {pack.total} skill{pack.total === 1 ? '' : 's'}
                        {pack.enabled > 0 && <span className="text-aeon-green"> · {pack.enabled} enabled</span>}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-primary-70 leading-relaxed">{pack.description}</p>

                  <div className="mt-auto flex items-center gap-2 pt-2">
                    <button
                      onClick={() => onTogglePack(pack.key)}
                      disabled={isLocked}
                      title={isCommunity ? 'Skills you installed are always shown' : isDefaultVisible ? 'Shown by default - always on' : on ? 'Hide this pack’s skills from the dashboard' : 'Reveal this pack’s skills across the sidebar and HQ'}
                      className={`text-[10px] font-mono uppercase tracking-[0.14em] px-3 py-1.5 border transition-colors cursor-target disabled:cursor-default ${on ? 'text-aeon-green border-aeon-green/50 bg-aeon-green/10' : 'text-primary-50 border-[rgba(250,250,250,0.18)] hover:text-primary-100 hover:border-[rgba(250,250,250,0.3)]'}`}
                    >
                      {isLocked ? 'Always on' : on ? '✓ Enabled' : 'Enable pack'}
                    </button>
                    <button
                      onClick={() => setExpanded(open ? null : pack.key)}
                      className="text-[10px] font-mono uppercase tracking-[0.14em] px-3 py-1.5 border border-[rgba(250,250,250,0.12)] text-primary-50 hover:text-primary-100 hover:border-[rgba(250,250,250,0.22)] transition-colors cursor-target"
                    >
                      {open ? 'Hide skills' : 'View skills'}
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="border-t border-[rgba(250,250,250,0.08)] divide-y divide-[rgba(250,250,250,0.06)]">
                    {pack.skills.map(s => {
                      const sb = busy[s.slug]
                      return (
                        <div key={s.slug} className="w-full flex items-center gap-2.5 px-6 py-2 hover:bg-aeon-panel transition-colors">
                          <button
                            onClick={() => onToggleSkill(s.slug, !s.enabled)}
                            disabled={sb}
                            title={s.enabled ? 'Disable skill' : 'Enable skill'}
                            className={`text-[9px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 border shrink-0 w-9 text-center transition-colors cursor-target disabled:opacity-50 ${s.enabled ? 'text-aeon-green border-aeon-green/40 hover:bg-aeon-green/10' : 'text-primary-40 border-[rgba(250,250,250,0.16)] hover:text-primary-70'}`}
                          >
                            {sb ? '…' : s.enabled ? 'on' : 'off'}
                          </button>
                          <button onClick={() => onSelectSkill(s.slug)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-target">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.enabled ? pack.color : 'rgba(250,250,250,0.18)' }} />
                            <span className="text-xs text-primary-100 truncate">{displayName(s.slug)}</span>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      {/* Community packs */}
      <Section label="Community packs">
        <p className="text-xs text-primary-50 leading-relaxed mb-4">
          Maintained by the community in external repos. Hit <span className="text-aeon-fg">Install pack</span> to run the security-scanned installer and open a PR - or copy the command to run it yourself. Skills land disabled; enable them here after merging.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-[rgba(250,250,250,0.10)] border border-[rgba(250,250,250,0.10)]">
          {community.map(pack => {
            const installed = pack.installedCount > 0
            return (
              <div key={pack.repo} className="bg-aeon-bg px-6 py-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-display uppercase tracking-wide text-aeon-fg text-sm leading-tight truncate">{pack.name}</div>
                    <div className="text-[10px] text-primary-40 font-mono mt-1 uppercase tracking-[0.14em] truncate">{pack.author} · {pack.category}</div>
                  </div>
                  <span className={`shrink-0 text-[9px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 border ${trustTone(pack.trust_level)}`}>{pack.trust_level || 'community'}</span>
                </div>
                <p className="text-xs text-primary-70 leading-relaxed line-clamp-3">{pack.description}</p>
                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-primary-40">
                  {pack.skills.length} skill{pack.skills.length === 1 ? '' : 's'}
                  {installed && <span className="text-aeon-green"> · {pack.installedCount} installed</span>}
                </div>
                {(pack.secrets_required?.length || pack.capabilities?.length) ? (
                  <div className="flex flex-wrap gap-1">
                    {pack.secrets_required?.map(sec => (
                      <span key={sec} className="text-[9px] font-mono px-1.5 py-0.5 border border-aeon-amber/30 text-aeon-amber">{sec}</span>
                    ))}
                    {pack.capabilities?.map(cap => (
                      <span key={cap} className="text-[9px] font-mono px-1.5 py-0.5 border border-[rgba(250,250,250,0.14)] text-primary-40">{cap}</span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-auto flex items-center gap-2 pt-2">
                  <button
                    onClick={() => handleInstall(pack)}
                    disabled={installing === pack.repo}
                    title={`Install into your fork - runs the install-skill skill (security-scanned) and opens a PR for review. Skills land disabled.`}
                    className="flex-1 text-[10px] font-mono uppercase tracking-[0.14em] px-3 py-1.5 border transition-colors cursor-target text-aeon-fg border-[rgba(250,250,250,0.25)] hover:border-aeon-red hover:text-aeon-red disabled:opacity-50 disabled:cursor-default"
                  >
                    {installing === pack.repo ? 'Installing…' : installed ? 'Reinstall' : 'Install pack'}
                  </button>
                  <button
                    onClick={() => handleCopy(pack)}
                    title={`Copy: bin/install-skill-pack ${installArg(pack)}`}
                    className="shrink-0 px-2 py-1.5 border border-[rgba(250,250,250,0.12)] text-primary-50 hover:text-primary-100 hover:border-[rgba(250,250,250,0.22)] transition-colors cursor-target"
                  >
                    {copied === pack.repo ? (
                      <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-aeon-green">copied</span>
                    ) : (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25" /></svg>
                    )}
                  </button>
                  {pack.homepage && (
                    <a href={pack.homepage} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[10px] font-mono uppercase tracking-[0.14em] text-primary-50 hover:text-aeon-red transition-colors cursor-target">site ↗</a>
                  )}
                </div>
              </div>
            )
          })}
          {!community.length && (
            <div className="bg-aeon-bg px-6 py-12 text-center sm:col-span-2">
              <p className="text-[11px] text-primary-40 font-mono uppercase tracking-[0.18em]">No community packs in the registry</p>
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}
