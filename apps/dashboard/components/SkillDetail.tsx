'use client'

import { useState } from 'react'
import type { Skill, Run, Secret, SkillKeyRef, SkillMcpRef, McpServers } from '../lib/types'
import { modelsForHarness, keyProvidedByHarness } from '../lib/constants'
import { MCP_BY_SLUG } from '../lib/mcp-catalog'
import { displayName, getSkillStatus, cronLabel, statusDot, inputCls, runStatusColor, runStatusGlyph } from '../lib/utils'
import { ScheduleEditor } from './ScheduleEditor'
import { timeAgo } from '../lib/utils'
import { Scramble } from './ui/Animated'

interface SkillDetailProps {
  skill: Skill
  runs: Run[]
  model: string
  harness: string
  secrets: Secret[]
  mcpServers: McpServers
  busy: Record<string, boolean>
  onToggle: (name: string, enabled: boolean) => void
  onRun: (name: string, v?: string, m?: string) => void
  onDelete: (name: string) => void
  onUpdateSchedule: (name: string, schedule: string) => void
  onUpdateVar: (name: string, v: string) => void
  onUpdateModel: (name: string, m: string) => void
  onGoToSecret: (name: string) => void
  onGoToMcp: () => void
  onViewRun: (run: Run) => void
}

function Section({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-[rgba(250,250,250,0.10)] pt-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="font-display text-[13px] tracking-[0.18em] text-aeon-red uppercase">{label}</span>
        <span className="flex-1 h-px bg-[rgba(250,250,250,0.10)]" />
        {action}
      </div>
      {children}
    </section>
  )
}

// A single declared credential. The key name and the right-hand action both
// jump to Settings → Access Keys, scrolled to this key with its input open —
// so the operator can paste the value in one click.
function KeyRow({ kref, secret, harness, onGoTo }: { kref: SkillKeyRef; secret?: Secret; harness: string; onGoTo: (name: string) => void }) {
  const isSet = !!secret?.isSet
  // The harness may cover this key natively (Grok Build → XAI_API_KEY). Then the
  // row reads as satisfied even unset, but the key stays settable as an override
  // (it's what the Claude harness uses, and it also powers the grok gateway).
  const providedByHarness = !isSet && keyProvidedByHarness(kref.key, harness)
  const satisfied = isSet || providedByHarness
  const desc = secret?.description || 'Third-party credential referenced by this skill.'

  // Status color: satisfied → green. Missing required → red. Missing "works better" → muted amber.
  const dot = satisfied ? 'bg-aeon-green' : kref.optional ? 'bg-aeon-red/60' : 'bg-aeon-red-alert'
  const tierLabel = kref.optional ? 'Works better' : 'Required'
  const tierColor = kref.optional ? 'text-aeon-red/80' : 'text-aeon-red'
  const statusText = isSet ? '· set' : providedByHarness ? '· covered by Grok Build' : '· not set'

  return (
    <div className="px-[var(--space-md)] py-[var(--space-sm)]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
            <button onClick={() => onGoTo(kref.key)} title="Open in Settings to set this key" className="font-mono text-xs text-aeon-fg hover:text-aeon-red underline decoration-dotted underline-offset-2 transition-colors">{kref.key}</button>
            <span className={`text-[9px] font-mono uppercase tracking-[0.18em] ${tierColor}`}>{tierLabel}</span>
            <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-primary-35">{statusText}</span>
          </div>
          <div className="text-[11px] text-primary-40 font-mono mt-0.5 leading-relaxed">
            {providedByHarness ? 'Covered by the Grok Build harness via its built-in web search - set a key for the premium xAI x_search feed (used by both harnesses).' : desc}
          </div>
        </div>
        <button
          onClick={() => onGoTo(kref.key)}
          className={`${isSet ? 'btn-mini-go' : 'btn-mini'} shrink-0`}
        >
          {isSet ? '✓ in vault' : providedByHarness ? 'Override →' : 'Set →'}
        </button>
      </div>
    </div>
  )
}

// A single declared MCP server. Mirrors KeyRow: logo + name + install/installed
// status, with the action jumping to the MCP page to install it.
function McpRow({ mref, installed, onGoTo }: { mref: SkillMcpRef; installed: boolean; onGoTo: () => void }) {
  const entry = MCP_BY_SLUG[mref.slug]
  const name = entry?.name || mref.slug
  const url = entry?.url || ''
  const desc = entry?.description || 'MCP server this skill calls during a run.'
  const dot = installed ? 'bg-aeon-green' : mref.optional ? 'bg-aeon-red/60' : 'bg-aeon-red-alert'
  const tierLabel = mref.optional ? 'Works better' : 'Required'
  const tierColor = mref.optional ? 'text-aeon-red/80' : 'text-aeon-red'

  return (
    <div className="px-[var(--space-md)] py-[var(--space-sm)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {entry?.logo
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={entry.logo} alt={name} width={32} height={32} className="w-8 h-8 rounded object-cover bg-aeon-bg shrink-0 border border-[rgba(250,250,250,0.10)] mt-0.5" />
            : <span className={`w-2 h-2 rounded-full shrink-0 mt-2 ${dot}`} />}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={onGoTo} title="Manage on the MCP page" className="font-mono text-xs text-aeon-fg hover:text-aeon-red underline decoration-dotted underline-offset-2 transition-colors">{name}</button>
              <span className={`text-[9px] font-mono uppercase tracking-[0.18em] ${tierColor}`}>{tierLabel}</span>
              <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-primary-35">{installed ? '· installed' : '· not installed'}</span>
            </div>
            {url && <div className="text-[11px] text-primary-50 font-mono mt-0.5 truncate">{url}</div>}
            <div className="text-[11px] text-primary-40 font-mono mt-0.5 leading-relaxed">{desc}</div>
          </div>
        </div>
        <button
          onClick={onGoTo}
          className={`${installed ? 'btn-mini-go' : 'btn-mini'} shrink-0`}
        >
          {installed ? '✓ installed' : 'Install →'}
        </button>
      </div>
    </div>
  )
}

export function SkillDetail({ skill, runs, model, harness, secrets, mcpServers, busy, onToggle, onRun, onDelete, onUpdateSchedule, onUpdateVar, onUpdateModel, onGoToSecret, onGoToMcp, onViewRun }: SkillDetailProps) {
  // Per-skill model-override options must track the active harness, like the
  // global picker (TopBar/page.tsx) — otherwise a non-claude harness only offers
  // Claude models here, so an operator can't pin a skill to e.g. kimi-k3 and
  // picking a Claude id would bake a mismatched `model:` into the skill.
  const modelOptions = modelsForHarness(harness)
  const [editingSchedule, setEditingSchedule] = useState(false)
  const [editingVar, setEditingVar] = useState(false)
  const [varDraft, setVarDraft] = useState('')

  const skillRuns = runs.filter(r => r.workflow.toLowerCase().includes(skill.name))
  const st = getSkillStatus(skill.name, skill.enabled, runs)
  // "On demand" skills carry no cron — they only fire on a manual Run now / dispatch.
  const isManual = skill.schedule === 'workflow_dispatch'
  const statusTextCls = st.color === 'green' ? 'text-aeon-green' : st.color === 'orange' ? 'text-aeon-amber' : st.color === 'red' ? 'text-aeon-red-alert' : 'text-primary-50'

  // Join the skill's declared `requires` against the central credential registry
  // (the same list shown in Settings → Access Keys) for descriptions + set state.
  const secretByName = new Map(secrets.map(s => [s.name, s]))
  const requires = skill.requires ?? []
  const requiredKeys = requires.filter(r => !r.optional)
  const worksBetterKeys = requires.filter(r => r.optional)
  // A required key is only "missing" if it's neither set nor provided natively by
  // the active harness (Grok Build covers XAI_API_KEY via its built-in search_x).
  const missingRequired = requiredKeys.filter(r => !secretByName.get(r.key)?.isSet && !keyProvidedByHarness(r.key, harness))

  // Join the skill's declared `mcp:` servers against the live .mcp.json config
  // (installed = its URL is present) and the MCP catalog for name/logo/url.
  const installedMcpUrls = new Set(Object.values(mcpServers ?? {}).map(s => s?.url).filter(Boolean) as string[])
  const isMcpInstalled = (slug: string) => { const u = MCP_BY_SLUG[slug]?.url; return !!u && installedMcpUrls.has(u) }
  const mcp = skill.mcp ?? []
  const requiredMcp = mcp.filter(m => !m.optional)
  const worksBetterMcp = mcp.filter(m => m.optional)
  const missingRequiredMcp = requiredMcp.filter(m => !isMcpInstalled(m.slug))

  // Scramble locks each word to `white-space: nowrap`, so a long unbreakable
  // token (e.g. "INVESTIGATION", 13 chars) can't wrap and would overflow the
  // hero box. Scale the max font-size down by the longest word so it always fits.
  const title = displayName(skill.name)
  const longestWord = title.split(' ').reduce((m, w) => Math.max(m, w.length), 0)
  const titleMaxPx = longestWord >= 13 ? 50 : longestWord >= 11 ? 60 : longestWord >= 9 ? 72 : 88

  return (
    <div className="max-w-5xl mx-auto pb-16 space-y-10">
      <section className="relative overflow-hidden border border-[rgba(250,250,250,0.10)] bg-aeon-panel">
        <div className="dither" aria-hidden="true" />
        <div className="relative z-10 px-8 pt-10 pb-8">
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <span className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.18em]">
              <span className={statusDot(st.color)} />
              <span className={statusTextCls}>{st.label}</span>
              {skill.enabled && (
                <>
                  <span className="text-primary-35">·</span>
                  <span className="text-primary-50">
                    {isManual ? 'On demand' : `Runs ${cronLabel(skill.schedule)}`}
                  </span>
                </>
              )}
            </span>
          </div>
          <h1 className="font-display uppercase leading-[0.92] tracking-tight text-aeon-fg break-words"
              style={{ fontSize: `clamp(32px, 6vw, ${titleMaxPx}px)` }}>
            <Scramble key={skill.name} text={title} />
          </h1>
          {skill.description && (
            <p className="mt-4 max-w-2xl text-sm text-primary-70 leading-relaxed">{skill.description}</p>
          )}

          <div className="mt-7 flex items-center gap-4 flex-wrap">
            {/* Not a <button>: the target-cursor auto-frames button/a/select, which
                would bracket the whole switch+label. A div with role="switch" keeps
                a11y while letting `cursor-target` scope the brackets to just the pill. */}
            <div
              role="switch"
              aria-checked={skill.enabled}
              aria-disabled={!!busy[skill.name]}
              tabIndex={0}
              onClick={() => { if (!busy[skill.name]) onToggle(skill.name, !skill.enabled) }}
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy[skill.name]) { e.preventDefault(); onToggle(skill.name, !skill.enabled) } }}
              title={skill.enabled ? 'Enabled — click to turn off' : 'Disabled — click to turn on'}
              className={`inline-flex items-center gap-3 group select-none outline-none ${busy[skill.name] ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
            >
              <span className={`cursor-target relative w-12 h-[26px] rounded-full border transition-colors duration-200 group-focus-visible:ring-2 group-focus-visible:ring-aeon-green/40 ${skill.enabled ? 'bg-aeon-green/25 border-aeon-green' : 'bg-[rgba(250,250,250,0.05)] border-[rgba(250,250,250,0.22)] group-hover:border-[rgba(250,250,250,0.4)]'}`}>
                <span className={`absolute top-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full transition-all duration-200 ${skill.enabled ? 'left-[26px] bg-aeon-green' : 'left-[3px] bg-[rgba(250,250,250,0.5)]'}`} />
              </span>
              <span className={`font-display text-sm uppercase tracking-[0.14em] transition-colors ${skill.enabled ? 'text-aeon-green' : 'text-primary-50'}`}>
                {skill.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <button
              onClick={() => onRun(skill.name, skill.var, skill.model)}
              disabled={!!busy[`r-${skill.name}`]}
              className="btn-solid disabled:opacity-50"
              style={{ background: 'var(--aeon-red)', borderColor: 'var(--aeon-red)', color: 'var(--aeon-fg-pure)' }}
            >
              {busy[`r-${skill.name}`] ? '…' : 'Run now'}
            </button>
            <button
              onClick={() => { if (confirm(`Delete ${displayName(skill.name)}?`)) onDelete(skill.name) }}
              className="btn-mini-danger ml-auto uppercase tracking-[0.18em]"
            >
              Delete
            </button>
          </div>
        </div>
      </section>

      <Section
        label="Skill schedule"
        action={
          <button
            onClick={() => setEditingSchedule(!editingSchedule)}
            className="btn-mini uppercase tracking-[0.18em]"
          >
            {editingSchedule ? 'Cancel' : 'Change schedule'}
          </button>
        }
      >
        {editingSchedule ? (
          <div className="border border-[rgba(250,250,250,0.10)] p-5 bg-aeon-panel">
            <ScheduleEditor cron={skill.schedule} onSave={(c) => { onUpdateSchedule(skill.name, c); setEditingSchedule(false) }} />
          </div>
        ) : (
          <div className="flex items-center gap-4 flex-wrap">
            <span className={`font-display uppercase tracking-tight ${skill.enabled && !isManual ? 'text-aeon-fg' : 'text-primary-50'}`} style={{ fontSize: 'clamp(24px, 3vw, 36px)' }}>
              {cronLabel(skill.schedule)}
            </span>
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.16em] px-2.5 py-1 border ${!skill.enabled ? 'text-aeon-amber border-aeon-amber/40' : isManual ? 'text-primary-50 border-[rgba(250,250,250,0.2)]' : 'text-aeon-green border-aeon-green/40'}`}>
              {!skill.enabled ? 'Disabled' : isManual ? 'Manual only' : 'Runs automatically'}
            </span>
          </div>
        )}
      </Section>

      {requires.length > 0 && (
        <Section label="API keys">
          {missingRequired.length > 0 && (
            <div className="mb-4 flex items-start gap-3 border border-aeon-red-alert/40 bg-aeon-red-alert/5 px-4 py-3">
              <span className="text-aeon-red-alert text-sm leading-none mt-0.5">▲</span>
              <p className="text-[12px] text-primary-70 font-mono leading-relaxed">
                Missing {missingRequired.length} required key{missingRequired.length > 1 ? 's' : ''} -
                this skill won&apos;t work until {missingRequired.length > 1 ? 'they are' : 'it is'} set:{' '}
                {missingRequired.map((r, i) => (
                  <span key={r.key}>
                    {i > 0 && ', '}
                    <button onClick={() => onGoToSecret(r.key)} title="Open in Settings to set this key" className="text-aeon-red-alert underline decoration-dotted underline-offset-2 hover:text-aeon-fg transition-colors">{r.key}</button>
                  </span>
                ))}
              </p>
            </div>
          )}
          {requiredKeys.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-aeon-red mb-2">Required to run</div>
              <div className="border border-[rgba(250,250,250,0.10)] divide-y divide-[rgba(250,250,250,0.08)]">
                {requiredKeys.map(r => (
                  <KeyRow key={r.key} kref={r} secret={secretByName.get(r.key)} harness={harness} onGoTo={onGoToSecret} />
                ))}
              </div>
            </div>
          )}
          {worksBetterKeys.length > 0 && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-aeon-red/80 mb-2">Works better with</div>
              <div className="border border-[rgba(250,250,250,0.10)] divide-y divide-[rgba(250,250,250,0.08)]">
                {worksBetterKeys.map(r => (
                  <KeyRow key={r.key} kref={r} secret={secretByName.get(r.key)} harness={harness} onGoTo={onGoToSecret} />
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {mcp.length > 0 && (
        <Section label="MCP servers">
          {missingRequiredMcp.length > 0 && (
            <div className="mb-4 flex items-start gap-3 border border-aeon-red-alert/40 bg-aeon-red-alert/5 px-4 py-3">
              <span className="text-aeon-red-alert text-sm leading-none mt-0.5">▲</span>
              <p className="text-[12px] text-primary-70 font-mono leading-relaxed">
                Missing {missingRequiredMcp.length} required MCP server{missingRequiredMcp.length > 1 ? 's' : ''} -
                this skill won&apos;t work until {missingRequiredMcp.length > 1 ? 'they are' : 'it is'} installed from the{' '}
                <button onClick={onGoToMcp} className="text-aeon-red-alert underline decoration-dotted underline-offset-2 hover:text-aeon-fg transition-colors">MCP page</button>:{' '}
                <span className="text-aeon-red-alert">{missingRequiredMcp.map(m => MCP_BY_SLUG[m.slug]?.name || m.slug).join(', ')}</span>
              </p>
            </div>
          )}
          {requiredMcp.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-aeon-red mb-2">Required to run</div>
              <div className="border border-[rgba(250,250,250,0.10)] divide-y divide-[rgba(250,250,250,0.08)]">
                {requiredMcp.map(m => (
                  <McpRow key={m.slug} mref={m} installed={isMcpInstalled(m.slug)} onGoTo={onGoToMcp} />
                ))}
              </div>
            </div>
          )}
          {worksBetterMcp.length > 0 && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-aeon-red/80 mb-2">Works better with</div>
              <div className="border border-[rgba(250,250,250,0.10)] divide-y divide-[rgba(250,250,250,0.08)]">
                {worksBetterMcp.map(m => (
                  <McpRow key={m.slug} mref={m} installed={isMcpInstalled(m.slug)} onGoTo={onGoToMcp} />
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      <Section label="Skill settings">
        {editingVar ? (
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              value={varDraft}
              onChange={(e) => setVarDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { onUpdateVar(skill.name, varDraft); setEditingVar(false) } }}
              placeholder="e.g. AI, bitcoin, owner/repo"
              autoFocus
              className={inputCls}
            />
            <button onClick={() => { onUpdateVar(skill.name, varDraft); setEditingVar(false) }} className="btn-mini-go">Save</button>
            <button onClick={() => setEditingVar(false)} className="btn-mini">Cancel</button>
          </div>
        ) : skill.var ? (
          <button onClick={() => { setEditingVar(true); setVarDraft(skill.var) }} className="group flex items-center gap-3 text-left cursor-target" title="Click to edit">
            <span className="font-display uppercase tracking-tight text-aeon-fg" style={{ fontSize: 'clamp(22px, 2.4vw, 30px)' }}>
              &ldquo;{skill.var}&rdquo;
            </span>
            <span className="btn-mini opacity-0 group-hover:opacity-100 transition-opacity">Edit</span>
          </button>
        ) : (
          <button onClick={() => { setEditingVar(true); setVarDraft('') }} className="group w-full flex items-center gap-3 border border-dashed border-[rgba(250,250,250,0.16)] px-4 py-4 hover:border-aeon-red/40 transition-colors cursor-target">
            <span className="text-sm text-primary-40 font-mono uppercase tracking-[0.18em] group-hover:text-primary-70 transition-colors">No custom settings</span>
            <span className="btn-mini-go ml-auto">+ Set var</span>
          </button>
        )}
      </Section>

      <Section label="Capability level">
        <select
          value={skill.model}
          onChange={(e) => onUpdateModel(skill.name, e.target.value)}
          className="bg-aeon-panel text-aeon-fg text-sm px-4 py-3 border border-[rgba(250,250,250,0.10)] outline-none font-mono w-full max-w-md cursor-pointer hover:border-[rgba(250,250,250,0.22)] focus:border-aeon-red transition-colors"
        >
          <option value="">Default ({modelOptions.find(m => m.id === model)?.label ?? model})</option>
          {modelOptions.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </Section>

      <Section label="Activity log">
        <div className="border border-[rgba(250,250,250,0.10)] divide-y divide-[rgba(250,250,250,0.08)]">
          {skillRuns.slice(0, 10).map(run => (
            <button
              key={run.id}
              onClick={() => onViewRun(run)}
              className="w-full flex items-center gap-4 px-5 py-3 hover:bg-aeon-panel transition-colors text-left group"
            >
              <span className={`text-sm w-4 shrink-0 ${runStatusColor(run)}`}>{runStatusGlyph(run)}</span>
              <span className="text-xs text-primary-70 truncate flex-1 font-mono group-hover:text-aeon-fg transition-colors">
                {run.conclusion === 'success' ? 'Task completed' : run.conclusion === 'failure' ? 'Task failed' : run.status === 'in_progress' ? 'Working…' : 'Queued'}
              </span>
              <span className="text-[10px] text-primary-35 font-mono tabular-nums uppercase tracking-[0.14em]">{timeAgo(run.created_at)}</span>
            </button>
          ))}
          {!skillRuns.length && (
            <div className="px-6 py-12 text-center">
              <p className="font-display uppercase text-aeon-fg text-xl tracking-wide">No activity</p>
              <p className="text-[11px] text-primary-40 font-mono mt-2 uppercase tracking-[0.18em]">This skill hasn&apos;t fired yet</p>
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}
