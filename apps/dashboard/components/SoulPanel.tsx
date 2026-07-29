'use client'

import { useState, useEffect } from 'react'
import { Scramble } from './ui/Animated'
import { SOUL_SCAFFOLD, STYLE_SCAFFOLD, ARCHETYPES } from '../lib/soul-templates'
import { editorCls, panelInputCls } from '../lib/utils'
import type { SoulSources, SoulExample, SoulExamplesResponse } from '../lib/types'

export type SoulFile = 'soul' | 'style'

interface SoulPanelProps {
  soul: string
  style: string
  loading: boolean
  saving: boolean
  building: boolean
  installing: string | null
  onSave: (file: SoulFile, content: string) => void
  onBuild: (sources: SoulSources) => void
  onInstallExample: (key: string) => void
}

const EXAMPLES_URL = 'https://github.com/aeonfun/soul.md/tree/main/examples'

// Strip HTML comments, headings and whitespace - what's left is real authored
// content. Empty ⇒ still the scaffold, so badge it "template".
function isBlank(md: string): boolean {
  return md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#.*$/gm, '')
    .replace(/^[-*]\s*$/gm, '')
    .trim().length === 0
}

export function SoulPanel({ soul, style, loading, saving, building, installing, onSave, onBuild, onInstallExample }: SoulPanelProps) {
  const [active, setActive] = useState<SoulFile>('soul')
  const [soulDraft, setSoulDraft] = useState(soul)
  const [styleDraft, setStyleDraft] = useState(style)
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [links, setLinks] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)
  const [examples, setExamples] = useState<SoulExample[]>([])

  useEffect(() => { setSoulDraft(soul) }, [soul])
  useEffect(() => { setStyleDraft(style) }, [style])
  // Ready-made souls from the soul.md gallery - installable into soul/ in one click.
  useEffect(() => { fetch('/api/soul/examples').then(r => r.ok ? r.json() as Promise<SoulExamplesResponse> : { examples: [] }).then(d => setExamples(d.examples || [])).catch(() => {}) }, [])

  const installExample = (ex: SoulExample) => {
    if (installing) return
    if (!window.confirm(`Install ${ex.label}'s soul? This overwrites soul/SOUL.md and soul/STYLE.md on your repo.`)) return
    onInstallExample(ex.key)
  }

  const content = active === 'soul' ? soul : style
  const draft = active === 'soul' ? soulDraft : styleDraft
  const setDraft = active === 'soul' ? setSoulDraft : setStyleDraft
  const scaffold = active === 'soul' ? SOUL_SCAFFOLD : STYLE_SCAFFOLD

  const dirty = draft !== content
  const blank = isBlank(draft)

  const applyTemplate = (next: string) => {
    if (!blank && !window.confirm('Replace the current editor content with this template?')) return
    setDraft(next)
    setShowTemplates(false)
  }
  const applyArchetype = (key: string) => {
    const a = ARCHETYPES.find(x => x.key === key)
    if (!a) return
    applyTemplate(active === 'soul' ? a.soul : a.style)
  }

  const cleanHandle = handle.trim().replace(/^@/, '').replace(/^https?:\/\/(x|twitter)\.com\//i, '').replace(/\/.*$/, '')
  const canBuild = (cleanHandle.length > 0 || name.trim().length > 0 || links.trim().length > 0) && !building
  const build = () => { if (canBuild) onBuild({ handle: cleanHandle, name: name.trim(), links: links.trim() }) }

  return (
    <div className="max-w-5xl mx-auto pb-16 space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden border border-[rgba(250,250,250,0.10)] bg-aeon-panel">
        <div className="dither" aria-hidden="true" />
        <div className="relative z-10 px-8 pt-10 pb-8">
          <h1 className="font-display uppercase leading-[0.92] tracking-tight text-aeon-fg"
              style={{ fontSize: 'clamp(40px, 6.5vw, 88px)' }}>
            <Scramble text="SOUL" />
            <span className="text-aeon-red">.MD</span>
          </h1>
          <p className="mt-4 max-w-xl text-sm text-primary-70 leading-relaxed">
            Who Aeon speaks as. Every content skill reads{' '}
            <span className="font-mono text-primary-100">soul/SOUL.md</span> and{' '}
            <span className="font-mono text-primary-100">soul/STYLE.md</span> to match your voice.
          </p>
        </div>
      </section>

      {/* Build my soul */}
      <section className="border border-[rgba(250,250,250,0.10)] bg-aeon-panel p-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="font-display text-[13px] tracking-[0.18em] text-aeon-red uppercase">BUILD MY SOUL</span>
          <span className="flex-1 h-px bg-[rgba(250,250,250,0.10)]" />
        </div>
        <p className="text-[12px] text-primary-50 font-mono leading-relaxed mb-4">
          <span className="text-primary-80">Every field is optional - give just one, or stack all three.</span>{' '}
          The <span className="text-primary-80">soul-builder</span> agent reads whatever you provide, then drafts
          SOUL.md, STYLE.md and voice examples - committed straight to <span className="text-primary-80">soul/</span>.
          More signal → sharper soul.
        </p>

        <div className="grid sm:grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-primary-40">X / Twitter handle</span>
            <div className="flex items-center bg-aeon-bg border border-[rgba(250,250,250,0.10)] focus-within:border-aeon-red transition-colors">
              <span className="pl-3 text-primary-40 font-mono text-[13px] select-none">@</span>
              <input
                type="text" value={handle} onChange={(e) => setHandle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') build() }}
                placeholder="handle" spellCheck={false}
                className="bg-transparent text-aeon-fg text-[13px] px-2 py-2.5 outline-none font-mono w-full placeholder:text-primary-35 cursor-target"
              />
            </div>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-primary-40">Full name <span className="text-primary-30">· web search</span></span>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') build() }}
              placeholder="Jane Doe - founder of …" spellCheck={false}
              className={`${panelInputCls} w-full`}
            />
          </label>

          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-primary-40">Links <span className="text-primary-30">· LinkedIn, website, blog, Substack, GitHub - comma separated</span></span>
            <input
              type="text" value={links} onChange={(e) => setLinks(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') build() }}
              placeholder="linkedin.com/in/jane, janedoe.com, jane.substack.com" spellCheck={false}
              className={`${panelInputCls} w-full`}
            />
          </label>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={build} disabled={!canBuild}
            className="bg-aeon-red text-white text-[11px] font-mono uppercase tracking-[0.14em] px-5 py-2.5 hover:opacity-90 transition-opacity disabled:opacity-40 cursor-target"
          >
            {building ? 'Dispatching…' : 'Build my soul'}
          </button>
          <span className="text-[10px] text-primary-35 font-mono">Any one field is enough - all optional.</span>
        </div>
      </section>

      {/* Editor */}
      <section className="border-t border-[rgba(250,250,250,0.10)] pt-6">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {/* File switcher */}
          <div className="flex">
            {([['soul', 'SOUL.md'], ['style', 'STYLE.md']] as [SoulFile, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActive(key)}
                className={`font-display text-[13px] tracking-[0.18em] px-3 py-1 border transition-colors ${
                  active === key
                    ? 'text-aeon-red border-aeon-red bg-aeon-red/10'
                    : 'text-primary-40 border-[rgba(250,250,250,0.12)] hover:text-primary-70'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="flex-1 h-px bg-[rgba(250,250,250,0.10)]" />
          {blank
            ? <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-aeon-red">empty</span>
            : <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-aeon-green">configured</span>}
          <button
            onClick={() => setShowTemplates(v => !v)}
            className="btn-mini cursor-target"
          >
            {showTemplates ? 'Close' : 'Templates'}
          </button>
        </div>

        {/* Template picker - two per row */}
        {showTemplates && (
          <div className="mb-4 border border-[rgba(250,250,250,0.10)] bg-aeon-panel p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] text-primary-50 font-mono">
                Start from a scaffold, or an archetype that shows the shape of a good {active === 'soul' ? 'SOUL.md' : 'STYLE.md'}.
                Replaces the current editor content.
              </p>
              <a
                href={EXAMPLES_URL} target="_blank" rel="noopener noreferrer"
                className="shrink-0 text-[10px] font-mono uppercase tracking-[0.14em] text-primary-50 hover:text-aeon-red transition-colors cursor-target whitespace-nowrap"
              >
                Real examples ↗
              </a>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => applyTemplate(scaffold)}
                className="text-left border border-[rgba(250,250,250,0.12)] hover:border-aeon-red px-3 py-2.5 transition-colors cursor-target"
              >
                <div className="text-[12px] text-primary-100 font-medium">Blank scaffold</div>
                <div className="text-[10px] text-primary-40 font-mono">Guided headings, no content</div>
              </button>
              {ARCHETYPES.map(a => (
                <button
                  key={a.key}
                  onClick={() => applyArchetype(a.key)}
                  className="text-left border border-[rgba(250,250,250,0.12)] hover:border-aeon-red px-3 py-2.5 transition-colors cursor-target"
                >
                  <div className="text-[12px] text-primary-100 font-medium">{a.label}</div>
                  <div className="text-[10px] text-primary-40 font-mono leading-snug">{a.blurb}</div>
                </button>
              ))}
            </div>

            {/* Install a ready-made real soul straight into the repo */}
            {examples.length > 0 && (
              <div className="pt-3 mt-1 border-t border-[rgba(250,250,250,0.08)]">
                <p className="text-[11px] text-primary-50 font-mono mb-2">
                  Or install a real soul from the gallery - writes SOUL.md + STYLE.md + examples to{' '}
                  <span className="text-primary-80">soul/</span> and syncs to GitHub.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {examples.map(ex => (
                    <div key={ex.key} className="border border-[rgba(250,250,250,0.12)] px-3 py-2.5 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[12px] text-primary-100 font-medium truncate">{ex.label}</div>
                        {ex.blurb && <div className="text-[10px] text-primary-40 font-mono leading-snug">{ex.blurb}</div>}
                      </div>
                      <button
                        onClick={() => installExample(ex)}
                        disabled={!!installing}
                        className="shrink-0 text-[10px] font-mono uppercase tracking-[0.14em] px-2.5 py-1.5 border border-aeon-red/50 text-aeon-red hover:bg-aeon-red/10 transition-colors disabled:opacity-40 cursor-target"
                      >
                        {installing === ex.key ? 'Installing…' : 'Install'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="text-xs font-mono text-primary-40 py-8">Loading…</div>
        ) : (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              rows={26}
              placeholder={active === 'soul' ? SOUL_SCAFFOLD : STYLE_SCAFFOLD}
              className={editorCls}
            />
            <div className="flex items-center justify-end mt-3">
              <div className="flex items-center gap-2">
                {dirty && (
                  <button onClick={() => setDraft(content)} className="btn-mini">
                    Revert
                  </button>
                )}
                <button onClick={() => onSave(active, draft)} disabled={!dirty || saving} className="btn-mini-go cursor-target">
                  {saving ? 'Saving…' : 'SAVE'}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
