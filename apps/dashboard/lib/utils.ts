import { DAYS } from './constants'
import type { Run } from './types'

export function displayName(slug: string): string {
  const special: Record<string, string> = { pr: 'PR', hn: 'HN', rss: 'RSS', defi: 'DeFi', ai: 'AI', x: 'X', mcp: 'MCP', lp: 'LP', pvr: 'PVR', api: 'API' }
  return slug.split('-').map(w => special[w] || (w[0]?.toUpperCase() + w.slice(1))).join(' ')
}

// Narrowing guard for a non-null, non-array object - the building block for
// validating untrusted JSON bodies / parsed files before reading fields off
// them. Lives here (not lib/http) so client components can use it too.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Normalise an arbitrary string into a slug: lowercase, non-alphanumeric runs
// collapsed to single hyphens, leading/trailing hyphens trimmed.
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function initials(slug: string): string {
  const words = slug.split('-')
  return words.length === 1 ? words[0].slice(0, 2).toUpperCase() : (words[0][0] + words[1][0]).toUpperCase()
}

function getUtcOffsetHours(): number { return -(new Date().getTimezoneOffset() / 60) }
function utcToLocal24(utcH: number): number { return ((utcH + getUtcOffsetHours()) % 24 + 24) % 24 }
export function localToUtc24(localH: number): number { return ((localH - getUtcOffsetHours()) % 24 + 24) % 24 }

export function parseCron(cron: string) {
  const [m, h, , , dow] = (cron ?? '').split(' ')
  // Schedules that aren't 5-field crons (e.g. "workflow_dispatch") have no
  // minute/hour fields - fall back to a daily 9 AM default so the editor renders
  // instead of crashing on undefined.includes().
  if (m === undefined || h === undefined) {
    return { mode: 'time' as const, hour12: 9, minute: 0, ampm: 'AM' as 'AM' | 'PM', days: [-1] }
  }
  if (m.includes('/')) return { mode: 'interval' as const, value: parseInt(m.split('/')[1]) || 5, unit: 'm' as const }
  if (h === '*' || h.includes('/')) return { mode: 'interval' as const, value: h === '*' ? 1 : parseInt(h.split('/')[1]) || 1, unit: 'h' as const }
  const localH = utcToLocal24(parseInt(h))
  return { mode: 'time' as const, hour12: localH > 12 ? localH - 12 : localH === 0 ? 12 : localH, minute: parseInt(m) || 0, ampm: (localH >= 12 ? 'PM' : 'AM') as 'AM' | 'PM', days: dow === '*' ? [-1] : dow.split(',').map(d => parseInt(d)).filter(d => !isNaN(d)) }
}

export function cronLabel(cron: string): string {
  if (cron === 'workflow_dispatch') return 'On demand'
  const p = parseCron(cron)
  if (p.mode === 'interval') return `Every ${p.value}${p.unit}`
  const time = `${p.hour12}:${String(p.minute).padStart(2, '0')} ${p.ampm}`
  if (p.days.includes(-1)) return `${time} daily`
  return `${time} ${p.days.map(d => DAYS.find(x => x.value === d)?.label || '').filter(Boolean).join(', ')}`
}

export function buildCron(mode: 'interval' | 'time', iv: number, iu: 'm' | 'h', h12: number, min: number, ap: 'AM' | 'PM', days: number[]): string {
  if (mode === 'interval') return iu === 'm' ? `*/${iv} * * * *` : `0 */${iv} * * *`
  let lh = h12; if (ap === 'PM' && lh !== 12) lh += 12; if (ap === 'AM' && lh === 12) lh = 0
  return `${min} ${localToUtc24(lh)} * * ${days.includes(-1) ? '*' : days.sort((a, b) => a - b).join(',')}`
}

export function timeAgo(date: string): string {
  const t = new Date(date).getTime()
  // Unparseable/empty timestamps would yield "NaNd ago" - show nothing instead.
  if (Number.isNaN(t)) return ''
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`
}

export function getSkillStatus(name: string, enabled: boolean, runs: Run[]) {
  const sr = runs.filter(r => r.workflow.toLowerCase().includes(name))
  if (sr.length > 0) {
    if (sr[0].status === 'in_progress') return { label: 'Working', color: 'orange' }
    if (sr[0].conclusion === 'failure') return { label: 'Error', color: 'red' }
  }
  return enabled ? { label: 'Enabled', color: 'green' } : { label: 'Disabled', color: 'gray' }
}

export function statusDot(color: string) {
  return `w-2 h-2 rounded-full shrink-0 ${color === 'green' ? 'bg-aeon-green' : color === 'orange' ? 'bg-aeon-red animate-pulse' : color === 'red' ? 'bg-aeon-red-alert' : 'bg-[rgba(250,250,250,0.22)]'}`
}

// Tailwind text-color class for a run's outcome, shared by the run lists in
// HQOverview / RightPanel / SkillDetail (success→green, failure→red,
// in-progress→orange, else muted).
export function runStatusColor(run: Pick<Run, 'status' | 'conclusion'>) {
  return run.conclusion === 'success' ? 'text-aeon-green' : run.conclusion === 'failure' ? 'text-aeon-red-alert' : run.status === 'in_progress' ? 'text-aeon-red' : 'text-primary-35'
}

// Glyph half of the same run-outcome pair, kept beside runStatusColor so the two
// can't drift apart at the four call sites that render them together.
export function runStatusGlyph(run: Pick<Run, 'status' | 'conclusion'>) {
  return run.conclusion === 'success' ? '✓' : run.conclusion === 'failure' ? '✗' : run.status === 'in_progress' ? '◌' : '·'
}

export const inputCls = "w-full bg-aeon-bg text-aeon-fg text-xs px-3 py-2 border border-[rgba(250,250,250,0.10)] outline-none font-mono focus:border-aeon-red transition-colors placeholder:text-primary-35 cursor-target"

// Larger input variant shared by the Soul/Strategy builder panels (no w-full —
// the panels append their own width/resize utilities at each call site).
export const panelInputCls = "bg-aeon-bg text-aeon-fg text-[13px] px-3 py-2.5 border border-[rgba(250,250,250,0.10)] outline-none font-mono focus:border-aeon-red transition-colors placeholder:text-primary-35 cursor-target"

export const editorCls = "w-full bg-aeon-bg text-aeon-fg text-[13px] leading-relaxed px-4 py-3 border border-[rgba(250,250,250,0.10)] outline-none font-mono focus:border-aeon-red transition-colors resize-y"
