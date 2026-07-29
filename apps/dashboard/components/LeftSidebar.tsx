'use client'

import { useState } from 'react'
import type { Skill, Run, Secret, DashboardView } from '../lib/types'
import { packGroups, keyProvidedByHarness } from '../lib/constants'
import { displayName, initials, getSkillStatus, statusDot } from '../lib/utils'

interface LeftSidebarProps {
  view: DashboardView
  setView: (v: DashboardView) => void
  selectedSkill: string | null
  skills: Skill[]
  runs: Run[]
  secrets: Secret[]
  repo: string
  harness: string
  enabledCount: number
  workingCount: number
  categoryFilter: string | null
  setCategoryFilter: (c: string | null) => void
  onSkillSelect: (name: string) => void
  onShowImport: () => void
}

export function LeftSidebar({ view, setView, selectedSkill, skills, runs, secrets, repo, harness, enabledCount, workingCount, categoryFilter, setCategoryFilter, onSkillSelect, onShowImport }: LeftSidebarProps) {
  const [skillSearch, setSkillSearch] = useState('')
  // The roster only ever holds skills from *enabled packs* (Core by default —
  // the parent filters before passing `skills`), so it's already focused. We
  // show all of those skills (enabled or not); "Enabled" is an opt-in filter,
  // off by default, to narrow to what's actually on duty.
  const [enabledOnly, setEnabledOnly] = useState(false)

  // A skill is "key-blocked" when it's enabled but a required (non-optional)
  // credential it declares isn't set AND isn't provided natively by the active
  // harness (Grok Build covers XAI_API_KEY) - flagged inline so the operator sees
  // it without opening each skill.
  const setSecretNames = new Set(secrets.filter(s => s.isSet).map(s => s.name))
  const missingRequiredKeys = (s: Skill) =>
    (s.requires ?? []).filter(r => !r.optional && !setSecretNames.has(r.key) && !keyProvidedByHarness(r.key, harness))

  // `categoryFilter` holds a PACK key - the sidebar groups by pack. Picking a
  // pack reveals ALL its skills (enabled + disabled) so you can switch them on in
  // context; with no pack selected the roster stays focused on enabled skills.
  const effectiveEnabledOnly = enabledOnly && !categoryFilter
  const matchesFilters = (s: Skill) => {
    if (categoryFilter && (s.pack || 'lab') !== categoryFilter) return false
    if (skillSearch && !(displayName(s.name).toLowerCase().includes(skillSearch.toLowerCase()) || s.name.includes(skillSearch.toLowerCase()))) return false
    if (effectiveEnabledOnly && !s.enabled) return false
    return true
  }
  const visibleCount = skills.filter(matchesFilters).length

  return (
    <div className="w-[240px] border-r border-[rgba(250,250,250,0.10)] flex flex-col shrink-0 bg-aeon-panel">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-[rgba(250,250,250,0.10)]">
        <div className="flex items-center gap-3">
          <span className="brand-mark w-[22px] h-[22px]" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/android-chrome-192x192.png" alt="" />
          </span>
          <div className="min-w-0">
            <div className="font-display text-sm leading-tight uppercase tracking-tight text-aeon-fg truncate">
              {repo ? repo.split('/').pop() : 'Aeon'} HQ
            </div>
            <div className="text-[10px] text-primary-40 font-mono uppercase tracking-[0.18em]">
              {enabledCount} enabled
              {workingCount > 0 ? <span className="text-aeon-red"> · {workingCount} working</span> : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div className="px-2 py-2 border-b border-[rgba(250,250,250,0.10)] space-y-0.5">
        {[
          { id: 'hq', label: 'HQ', icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z' },
          { id: 'packs', label: 'Packs', icon: 'M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9' },
          { id: 'strategy', label: 'Strategy', icon: 'M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5' },
          { id: 'soul', label: 'Soul', icon: 'M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z' },
          { id: 'mcp', label: 'MCP', icon: 'M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z' },
          { id: 'secrets', label: 'Settings', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z' },
        ].map(item => (
          <button key={item.id} onClick={() => { setView(item.id as DashboardView); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-mono uppercase tracking-[0.14em] transition-all ${view === item.id && !selectedSkill ? 'bg-aeon-bg text-aeon-fg border-l-2 border-aeon-red pl-[10px]' : 'text-primary-50 hover:text-primary-100 hover:bg-aeon-bg'}`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d={item.icon} /></svg>
            {item.label}
          </button>
        ))}
      </div>

      {/* Team roster */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-4 pb-1 flex items-center justify-between">
          <span className="text-label">Skills</span>
          <button onClick={onShowImport} className="text-[10px] font-mono uppercase tracking-[0.14em] text-primary-50 hover:text-aeon-red transition-colors cursor-target">+ Add</button>
        </div>
        <div className="px-3 pb-2">
          <input type="text" value={skillSearch} onChange={(e) => setSkillSearch(e.target.value)} placeholder="Search..." className="w-full bg-aeon-bg text-aeon-fg text-[11px] px-3 py-2 border border-[rgba(250,250,250,0.10)] outline-none font-mono focus:border-aeon-red transition-colors placeholder:text-primary-35 cursor-target" />
        </div>

        {/* Category filter */}
        <div className="px-3 pb-3 flex flex-wrap gap-1">
          <button
            onClick={() => setCategoryFilter(null)}
            className={`text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 border transition-colors ${categoryFilter === null ? 'text-aeon-fg border-aeon-fg/50 bg-aeon-fg/10' : 'text-primary-40 border-[rgba(250,250,250,0.12)] hover:text-primary-70 hover:border-[rgba(250,250,250,0.22)]'}`}
          >
            All
          </button>
          <button
            onClick={() => setEnabledOnly(v => !v)}
            title="Show only enabled skills"
            className={`text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 border flex items-center gap-1.5 transition-colors ${enabledOnly ? 'text-aeon-green border-aeon-green/50 bg-aeon-green/10' : 'text-primary-40 border-[rgba(250,250,250,0.12)] hover:text-primary-70 hover:border-[rgba(250,250,250,0.22)]'}`}
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-aeon-green" />
            Enabled
          </button>
          {packGroups(skills).map(cat => {
            const active = categoryFilter === cat.key
            return (
              <button
                key={cat.key}
                onClick={() => setCategoryFilter(active ? null : cat.key)}
                title={`${cat.label} - show this pack's skills`}
                className={`text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 border flex items-center gap-1.5 transition-colors ${active ? '' : 'text-primary-40 border-[rgba(250,250,250,0.12)] hover:text-primary-70 hover:border-[rgba(250,250,250,0.22)]'}`}
                style={active ? { color: cat.color, borderColor: cat.color, backgroundColor: cat.color + '1A' } : undefined}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                {cat.short}
              </button>
            )
          })}
        </div>

        {packGroups(skills).map(cat => {
          if (categoryFilter && cat.key !== categoryFilter) return null
          const catSkills = skills.filter(s => (s.pack || 'lab') === cat.key)
          if (!catSkills.length) return null
          const searched = skillSearch ? catSkills.filter(s => displayName(s.name).toLowerCase().includes(skillSearch.toLowerCase()) || s.name.includes(skillSearch.toLowerCase())) : catSkills
          const filtered = effectiveEnabledOnly ? searched.filter(s => s.enabled) : searched
          if (!filtered.length) return null
          const en = filtered.filter(s => s.enabled).length
          return (
            <div key={cat.key} className="mb-1">
              <div className="flex items-center gap-2 px-4 py-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                <span className="text-[11px] font-mono text-primary-40 uppercase tracking-[2px] flex-1">{cat.label}</span>
                <span className="text-[11px] font-mono text-primary-35">{en}</span>
              </div>
              {filtered.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)).map(s => {
                const st = getSkillStatus(s.name, s.enabled, runs)
                const sel = selectedSkill === s.name
                const keyGap = s.enabled && missingRequiredKeys(s).length > 0
                return (
                  <button key={s.name} onClick={() => onSkillSelect(s.name)}
                    className={`w-full flex items-center gap-2.5 px-4 py-2 transition-all text-left ${sel ? 'bg-aeon-bg selected-indicator' : 'hover:bg-aeon-bg'}`}>
                    <div className="w-7 h-7 flex items-center justify-center text-[10px] font-bold shrink-0 text-white" style={{ backgroundColor: s.enabled ? cat.color : 'rgba(250,250,250,0.15)' }}>
                      {initials(s.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-primary-100 truncate">{displayName(s.name)}</div>
                      <div className="flex items-center gap-1.5">
                        <div className={statusDot(st.color)} />
                        <span className="text-[10px] text-primary-40 font-mono truncate">{st.label}</span>
                      </div>
                    </div>
                    {keyGap && (
                      <span title="Enabled but a required API key is missing" className="shrink-0 text-aeon-red-alert" aria-label="Missing required API key">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}

        {visibleCount === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-primary-40">
              {enabledOnly ? 'No skills enabled' : 'No skills match'}
            </p>
            {enabledOnly && (
              <button
                onClick={() => setEnabledOnly(false)}
                className="mt-2 text-[10px] font-mono uppercase tracking-[0.14em] text-primary-50 hover:text-aeon-red transition-colors cursor-target"
              >
                Show all skills
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
