'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface Skill {
  name: string
  description: string
  enabled: boolean
  schedule: string
  var: string
  model: string
}

interface Run {
  id: number
  workflow: string
  status: string
  conclusion: string | null
  created_at: string
  url: string
}

interface Secret {
  name: string
  group: string
  description: string
  isSet: boolean
  either?: string
}

const MODELS = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
]

const DAYS = [
  { label: 'All', value: -1 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
]

// Get the user's UTC offset in hours (e.g. UTC-5 → -5, UTC+9 → 9)
function getUtcOffsetHours(): number {
  return -(new Date().getTimezoneOffset() / 60)
}

function getLocalTzAbbr(): string {
  try {
    return Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date())
      .find(p => p.type === 'timeZoneName')?.value || 'Local'
  } catch {
    return 'Local'
  }
}

function utcToLocal24(utcH: number): number {
  return ((utcH + getUtcOffsetHours()) % 24 + 24) % 24
}

function localToUtc24(localH: number): number {
  return ((localH - getUtcOffsetHours()) % 24 + 24) % 24
}

function parseCron(cron: string): { mode: 'interval'; value: number; unit: 'm' | 'h' } | { mode: 'time'; hour12: number; minute: number; ampm: 'AM' | 'PM'; days: number[] } {
  const parts = cron.split(' ')
  const m = parts[0]
  const h = parts[1]
  const dow = parts[4]
  if (m.includes('/')) {
    return { mode: 'interval', value: parseInt(m.split('/')[1]) || 5, unit: 'm' }
  }
  if (h === '*' || h.includes('/')) {
    return { mode: 'interval', value: h === '*' ? 1 : parseInt(h.split('/')[1]) || 1, unit: 'h' }
  }
  const utcH = parseInt(h)
  const minute = parseInt(m) || 0
  const localH = utcToLocal24(utcH)
  return {
    mode: 'time',
    hour12: localH > 12 ? localH - 12 : localH === 0 ? 12 : localH,
    minute,
    ampm: localH >= 12 ? 'PM' : 'AM',
    days: dow === '*' ? [-1] : dow.split(',').map(d => parseInt(d)).filter(d => !isNaN(d)),
  }
}

function cronLabel(cron: string): string {
  const p = parseCron(cron)
  if (p.mode === 'interval') return `Every ${p.value}${p.unit}`
  const time = `${p.hour12}:${String(p.minute).padStart(2, '0')} ${p.ampm}`
  if (p.days.includes(-1)) return `${time} daily`
  const dayNames = p.days.map(d => DAYS.find(x => x.value === d)?.label || '').filter(Boolean)
  return `${time} ${dayNames.join(',')}`
}

function buildCron(mode: 'interval' | 'time', intervalValue: number, intervalUnit: 'm' | 'h', hour12: number, minute: number, ampm: 'AM' | 'PM', days: number[]): string {
  if (mode === 'interval') return intervalUnit === 'm' ? `*/${intervalValue} * * * *` : `0 */${intervalValue} * * *`
  let localH = hour12
  if (ampm === 'PM' && localH !== 12) localH += 12
  if (ampm === 'AM' && localH === 12) localH = 0
  const utcH = localToUtc24(localH)
  const dowField = days.includes(-1) ? '*' : days.sort((a, b) => a - b).join(',')
  return `${minute} ${utcH} * * ${dowField}`
}

function ScheduleEditor({ cron, onSave }: { cron: string; onSave: (cron: string) => void }) {
  const parsed = parseCron(cron)
  const [mode, setMode] = useState<'interval' | 'time'>(parsed.mode)
  const [intervalValue, setIntervalValue] = useState(parsed.mode === 'interval' ? parsed.value : 3)
  const [intervalUnit, setIntervalUnit] = useState<'m' | 'h'>(parsed.mode === 'interval' ? parsed.unit : 'h')
  const [hour12, setHour12] = useState(parsed.mode === 'time' ? parsed.hour12 : 7)
  const [minute, setMinute] = useState(parsed.mode === 'time' ? parsed.minute : 0)
  const [ampm, setAmpm] = useState<'AM' | 'PM'>(parsed.mode === 'time' ? parsed.ampm : 'AM')
  const [days, setDays] = useState<number[]>(parsed.mode === 'time' ? parsed.days : [-1])

  const toggleDay = (value: number) => {
    setMode('time')
    if (value === -1) {
      setDays([-1])
      return
    }
    const without = days.filter(d => d !== -1 && d !== value)
    if (days.includes(value)) {
      setDays(without.length === 0 ? [-1] : without)
    } else {
      setDays([...without, value])
    }
  }

  const apply = () => onSave(buildCron(mode, intervalValue, intervalUnit, hour12, minute, ampm, days))

  return (
    <div className="px-4 py-2 bg-zinc-900/80 border-b border-zinc-800/30 flex flex-wrap items-center gap-x-4 gap-y-2" onClick={(e) => e.stopPropagation()}>
      {/* Interval */}
      <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
        <input type="radio" name="sched-mode" checked={mode === 'interval'} onChange={() => setMode('interval')} className="accent-green-500 w-3 h-3" />
        <span className="text-[10px] text-zinc-400">Every</span>
        <input
          type="number" min={1} max={intervalUnit === 'm' ? 59 : 24} value={intervalValue}
          onFocus={() => setMode('interval')}
          onChange={(e) => { setIntervalValue(Math.max(1, Math.min(intervalUnit === 'm' ? 59 : 24, parseInt(e.target.value) || 1))); setMode('interval') }}
          className="w-10 bg-zinc-800 text-zinc-200 text-[10px] rounded px-1.5 py-0.5 border border-zinc-700/50 outline-none text-center font-mono"
        />
        <div className="flex text-[10px] rounded overflow-hidden border border-zinc-700/50">
          <button type="button" onClick={() => { setIntervalUnit('m'); setMode('interval') }}
            className={`px-1.5 py-0.5 ${intervalUnit === 'm' ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>m</button>
          <button type="button" onClick={() => { setIntervalUnit('h'); setMode('interval') }}
            className={`px-1.5 py-0.5 ${intervalUnit === 'h' ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>h</button>
        </div>
      </label>

      <span className="text-zinc-700">|</span>

      {/* Time */}
      <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
        <input type="radio" name="sched-mode" checked={mode === 'time'} onChange={() => setMode('time')} className="accent-green-500 w-3 h-3" />
        <span className="text-[10px] text-zinc-400">At</span>
        <input
          type="number" min={1} max={12} value={hour12}
          onFocus={() => setMode('time')}
          onChange={(e) => { setHour12(Math.max(1, Math.min(12, parseInt(e.target.value) || 1))); setMode('time') }}
          className="w-10 bg-zinc-800 text-zinc-200 text-[10px] rounded px-1.5 py-0.5 border border-zinc-700/50 outline-none text-center font-mono"
        />
        <span className="text-[10px] text-zinc-400">:</span>
        <input
          type="number" min={0} max={59} value={String(minute).padStart(2, '0')}
          onFocus={() => setMode('time')}
          onChange={(e) => { setMinute(Math.max(0, Math.min(59, parseInt(e.target.value) || 0))); setMode('time') }}
          className="w-10 bg-zinc-800 text-zinc-200 text-[10px] rounded px-1.5 py-0.5 border border-zinc-700/50 outline-none text-center font-mono"
        />
        <div className="flex text-[10px] rounded overflow-hidden border border-zinc-700/50">
          <button type="button" onClick={() => { setAmpm('AM'); setMode('time') }}
            className={`px-1.5 py-0.5 ${ampm === 'AM' ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>AM</button>
          <button type="button" onClick={() => { setAmpm('PM'); setMode('time') }}
            className={`px-1.5 py-0.5 ${ampm === 'PM' ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>PM</button>
        </div>
      </label>

      {/* Day pills — multi-select */}
      {mode === 'time' && (
        <div className="flex gap-0.5 shrink-0">
          {DAYS.map(d => (
            <button key={d.value} type="button" onClick={() => toggleDay(d.value)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                (d.value === -1 ? days.includes(-1) : days.includes(d.value))
                  ? 'bg-green-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}>{d.label}</button>
          ))}
        </div>
      )}

      {/* Apply */}
      <button type="button" onClick={apply} className="bg-green-600 hover:bg-green-500 text-white text-[10px] px-2.5 py-0.5 rounded transition-colors ml-auto shrink-0">
        Apply
      </button>
    </div>
  )
}

function VarEditor({ value: initial, onSave }: { value: string; onSave: (v: string) => void }) {
  const [value, setValue] = useState(initial)

  return (
    <div className="px-4 py-2 bg-zinc-900/60 border-b border-zinc-800/30 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
      <span className="text-[10px] text-zinc-500 shrink-0">Var</span>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSave(value)}
        placeholder="e.g. AI, bitcoin, owner/repo"
        className="flex-1 bg-zinc-800 text-zinc-200 text-[10px] rounded px-2 py-1 border border-zinc-700/50 outline-none placeholder:text-zinc-600 font-mono"
      />
      <button
        type="button"
        onClick={() => onSave(value)}
        disabled={value === initial}
        className="bg-green-600 hover:bg-green-500 text-white text-[10px] px-2.5 py-0.5 rounded transition-colors disabled:opacity-30 shrink-0"
      >
        Save
      </button>
      {value && (
        <button
          type="button"
          onClick={() => { setValue(''); onSave('') }}
          className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors shrink-0"
        >
          Clear
        </button>
      )}
    </div>
  )
}

// --- json-render feed types and components ---

interface SkillOutput {
  filename: string
  skill: string
  timestamp: string
  spec: {
    root: string
    state?: Record<string, unknown>
    elements: Record<string, SpecElement>
  }
}

interface SpecElement {
  type: string
  props?: Record<string, unknown>
  children?: string[]
}

function SpecNode({ id, elements }: { id: string; elements: Record<string, SpecElement> }) {
  const el = elements[id]
  if (!el) return null
  const p = (el.props || {}) as Record<string, string | number | boolean | string[][] | string[] | undefined>
  const kids = el.children?.map(cid => <SpecNode key={cid} id={cid} elements={elements} />)

  switch (el.type) {
    case 'Card':
      return (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {(p.title || p.description) && (
            <div className="px-4 pt-4 pb-2">
              {p.title && <h3 className="text-sm font-medium text-zinc-200">{String(p.title)}</h3>}
              {p.description && <p className="text-xs text-zinc-500 mt-0.5">{String(p.description)}</p>}
            </div>
          )}
          <div className="px-4 pb-4 space-y-3">{kids}</div>
        </div>
      )
    case 'Stack': {
      const dir = p.direction === 'horizontal' ? 'flex-row' : 'flex-col'
      const gap = p.gap === 'lg' ? 'gap-4' : p.gap === 'sm' ? 'gap-1' : 'gap-2'
      return <div className={`flex ${dir} ${gap}`}>{kids}</div>
    }
    case 'Grid': {
      const cols = typeof p.columns === 'number' ? p.columns : 2
      const gap = p.gap === 'lg' ? 'gap-4' : p.gap === 'sm' ? 'gap-1' : 'gap-2'
      return <div className={`grid ${gap}`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>{kids}</div>
    }
    case 'Heading': {
      const level = p.level || 'h3'
      const cls = level === 'h1' ? 'text-lg font-semibold' : level === 'h2' ? 'text-sm font-semibold' : level === 'h4' ? 'text-xs font-medium text-zinc-400' : 'text-xs font-medium text-zinc-300'
      return <div className={cls}>{String(p.text || '')}</div>
    }
    case 'Text': {
      const variant = p.variant || 'body'
      const cls = variant === 'caption' ? 'text-[10px] text-zinc-500' : variant === 'muted' ? 'text-xs text-zinc-500' : variant === 'lead' ? 'text-sm text-zinc-300' : 'text-xs text-zinc-400'
      return <p className={cls}>{String(p.text || '')}</p>
    }
    case 'Badge': {
      const v = p.variant || 'default'
      const cls = v === 'destructive' ? 'bg-red-900/30 text-red-400 border-red-800/30' : v === 'secondary' ? 'bg-zinc-800 text-zinc-400 border-zinc-700/50' : v === 'outline' ? 'bg-transparent text-zinc-400 border-zinc-700' : 'bg-green-900/30 text-green-400 border-green-800/30'
      return <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{String(p.text || '')}</span>
    }
    case 'Table': {
      const columns = (p.columns || []) as string[]
      const rows = (p.rows || []) as string[][]
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead><tr>{columns.map((c, i) => <th key={i} className="text-left text-zinc-500 font-medium px-2 py-1 border-b border-zinc-800/50">{c}</th>)}</tr></thead>
            <tbody>{rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci} className="px-2 py-1 text-zinc-400 border-b border-zinc-800/20">{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )
    }
    case 'Stat': {
      const trend = p.trend as string | undefined
      const deltaColor = trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-zinc-500'
      return (
        <div className="bg-zinc-800/40 rounded-lg px-3 py-2">
          {p.label && <div className="text-[10px] text-zinc-500 mb-0.5">{String(p.label)}</div>}
          <div className="text-sm font-semibold text-zinc-200 font-mono">{String(p.value || '')}</div>
          {p.delta && <div className={`text-[10px] ${deltaColor} font-mono`}>{String(p.delta)}</div>}
        </div>
      )
    }
    case 'Progress': {
      const value = Number(p.value || 0)
      const max = Number(p.max || 100)
      const pct = Math.min(100, (value / max) * 100)
      return (
        <div>
          {p.label && <div className="text-[10px] text-zinc-500 mb-1">{String(p.label)}</div>}
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )
    }
    case 'TweetCard':
      return (
        <div className="bg-zinc-800/30 rounded-lg px-3 py-2 border border-zinc-800/50">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-medium text-zinc-300">{String(p.author || '')}</span>
            {p.handle && <span className="text-[10px] text-zinc-600">{String(p.handle)}</span>}
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">{String(p.text || '')}</p>
          {(p.likes || p.retweets) && (
            <div className="flex gap-3 mt-1.5 text-[10px] text-zinc-600">
              {p.likes && <span>{String(p.likes)} likes</span>}
              {p.retweets && <span>{String(p.retweets)} RTs</span>}
            </div>
          )}
        </div>
      )
    case 'StoryLink':
      return (
        <a href={String(p.href || '#')} target="_blank" rel="noopener noreferrer" className="block bg-zinc-800/30 rounded-lg px-3 py-2 border border-zinc-800/50 hover:border-zinc-700 transition-colors">
          <div className="text-xs text-zinc-300 hover:text-zinc-100">{String(p.title || '')}</div>
          <div className="flex gap-2 mt-0.5 text-[10px] text-zinc-600">
            {p.source && <span>{String(p.source)}</span>}
            {p.score && <span>{String(p.score)}</span>}
          </div>
        </a>
      )
    case 'Link':
      return <a href={String(p.href || '#')} target="_blank" rel="noopener noreferrer" className="text-xs text-green-400 hover:text-green-300 underline underline-offset-2">{String(p.label || p.href || '')}</a>
    case 'Alert': {
      const t = p.type || 'info'
      const cls = t === 'error' ? 'border-red-800/30 bg-red-900/10 text-red-400' : t === 'warning' ? 'border-yellow-800/30 bg-yellow-900/10 text-yellow-400' : t === 'success' ? 'border-green-800/30 bg-green-900/10 text-green-400' : 'border-blue-800/30 bg-blue-900/10 text-blue-400'
      return (
        <div className={`rounded-lg px-3 py-2 border ${cls}`}>
          {p.title && <div className="text-xs font-medium mb-0.5">{String(p.title)}</div>}
          {p.message && <div className="text-[11px] opacity-80">{String(p.message)}</div>}
        </div>
      )
    }
    case 'Button': {
      const v = p.variant || 'primary'
      const cls = v === 'danger' ? 'bg-red-600 hover:bg-red-500 text-white' : v === 'secondary' ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-green-600 hover:bg-green-500 text-white'
      return <button className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${cls}`}>{String(p.label || '')}</button>
    }
    case 'Separator':
      return <div className={`${p.orientation === 'vertical' ? 'w-px h-full bg-zinc-800' : 'h-px w-full bg-zinc-800'}`} />
    default:
      return <div className="text-[10px] text-zinc-600">[Unknown: {el.type}]</div>
  }
}

function SpecRenderer({ spec }: { spec: SkillOutput['spec'] }) {
  if (!spec?.root || !spec?.elements) return <div className="text-[10px] text-zinc-600">Invalid spec</div>
  return <SpecNode id={spec.root} elements={spec.elements} />
}

function SkillFeed({ refreshKey }: { refreshKey: number }) {
  const [outputs, setOutputs] = useState<SkillOutput[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/outputs')
      .then(r => r.ok ? r.json() : { outputs: [] })
      .then(d => setOutputs(d.outputs || []))
      .finally(() => setLoading(false))
  }, [refreshKey])

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <div className="relative flex items-center justify-center">
        <div className="absolute h-8 w-8 rounded-full border border-green-500/20" style={{ animation: 'pulse-ring 2s ease-out infinite' }} />
        <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
      </div>
    </div>
  )

  if (outputs.length === 0) return (
    <div className="px-4 py-12 text-center text-zinc-600 text-xs">
      No feed outputs yet. Enable JSONRENDER_ENABLED to generate feed cards from skill runs.
    </div>
  )

  return (
    <div className="space-y-3 p-3">
      {outputs.map(o => (
        <div key={o.filename}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-mono text-green-400">{o.skill}</span>
            <span className="text-[10px] text-zinc-600">{o.timestamp.replace(/T/, ' ').replace(/-(?=\d{2}Z)/g, ':').replace('Z', ' UTC')}</span>
          </div>
          <SpecRenderer spec={o.spec} />
        </div>
      ))}
    </div>
  )
}

function timeAgo(date: string): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function Dashboard() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [repo, setRepo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState('')
  const [editingSecret, setEditingSecret] = useState<string | null>(null)
  const [secretValue, setSecretValue] = useState('')
  const [hasChanges, setHasChanges] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [openSchedule, setOpenSchedule] = useState<string | null>(null)
  const [addingSecret, setAddingSecret] = useState(false)
  const [newSecretName, setNewSecretName] = useState('')

  // Run logs viewer
  const [selectedRun, setSelectedRun] = useState<Run | null>(null)
  const [runLogs, setRunLogs] = useState('')
  const [runSummary, setRunSummary] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [showFullLogs, setShowFullLogs] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Import modal
  const [col1Tab, setCol1Tab] = useState<'skills' | 'secrets'>('skills')
  const [col3Tab, setCol3Tab] = useState<'runs' | 'feed' | 'analytics'>('feed')

  // Analytics
  const [analyticsData, setAnalyticsData] = useState<{
    skills: Array<{
      name: string; total: number; success: number; failure: number;
      cancelled: number; inProgress: number; successRate: number;
      lastRun: string | null; lastConclusion: string | null;
      avgDurationMin: number | null; streak: number;
    }>;
    insights: Array<{ type: 'warning' | 'info' | 'success'; message: string }>;
    summary: { totalRuns: number; totalSuccess: number; totalFailure: number; overallSuccessRate: number; uniqueSkills: number; periodDays: number };
  } | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [jsonrenderEnabled, setJsonrenderEnabled] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [feedKey, setFeedKey] = useState(0)
  const [behind, setBehind] = useState(0)

  const [showImport, setShowImport] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [uploadFiles, setUploadFiles] = useState<Array<{ path: string; content: string }>>([])
  const [uploadDragOver, setUploadDragOver] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auth
  const [authStatus, setAuthStatus] = useState<{ authenticated: boolean } | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authKey, setAuthKey] = useState('')

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth')
      if (res.ok) setAuthStatus(await res.json())
    } catch { /* ignore */ }
  }

  const setupAuth = async (key?: string) => {
    setAuthLoading(true)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(key ? { key } : {}),
      })
      if (res.ok) {
        flash('Auth token saved to GitHub')
        setAuthStatus({ authenticated: true })
        setShowAuthModal(false)
        setAuthKey('')
        fetchData()
      } else {
        // Auto-setup failed — show modal so user can paste key manually
        if (!key) {
          setShowAuthModal(true)
        }
        const data = await res.json()
        flash(data.error || 'Auto-setup failed — paste your API key')
      }
    } finally {
      setAuthLoading(false)
    }
  }

  const checkSync = async () => {
    try {
      const res = await fetch('/api/sync')
      if (res.ok) {
        const data = await res.json()
        setHasChanges(data.hasChanges)
        if (typeof data.behind === 'number') setBehind(data.behind)
      }
    } catch { /* ignore */ }
  }

  const syncToGithub = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        flash(data.message || 'Synced to GitHub')
        setHasChanges(false)
      } else {
        flash('Sync failed — check terminal')
      }
    } finally {
      setSyncing(false)
    }
  }

  const pullFromGithub = async () => {
    setPulling(true)
    try {
      const res = await fetch('/api/outputs', { method: 'POST' })
      if (res.ok) {
        flash('Pulled latest from GitHub')
        setFeedKey(k => k + 1)
        fetchData()
      } else {
        flash('Pull failed — check terminal')
      }
    } finally {
      setPulling(false)
    }
  }

  const toggleJsonRender = async (enabled: boolean) => {
    setJsonrenderEnabled(enabled)
    try {
      const res = await fetch('/api/skills', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrenderEnabled: enabled }),
      })
      if (res.ok) {
        flash(`Feed ${enabled ? 'enabled' : 'disabled'}`)
        checkSync()
      }
    } catch { /* ignore */ }
  }

  const fetchData = useCallback(async () => {
    try {
      const [skillsRes, runsRes, secretsRes] = await Promise.all([
        fetch('/api/skills'),
        fetch('/api/runs'),
        fetch('/api/secrets'),
      ])
      if (skillsRes.ok) {
        const data = await skillsRes.json()
        setSkills(data.skills)
        if (data.model) setModel(data.model)
        if (data.repo) setRepo(data.repo)
        if (typeof data.jsonrenderEnabled === 'boolean') setJsonrenderEnabled(data.jsonrenderEnabled)
      }
      if (runsRes.ok) setRuns((await runsRes.json()).runs)
      if (secretsRes.ok) {
        const data = await secretsRes.json()
        if (data.secrets) setSecrets(data.secrets)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to connect')
    } finally {
      setLoading(false)
    }
    checkSync()
    checkAuth()
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // --- Skill actions ---

  const updateModel = async (newModel: string) => {
    setModel(newModel)
    try {
      const res = await fetch('/api/skills', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: newModel }),
      })
      if (res.ok) {
        flash(`Model set to ${MODELS.find(m => m.id === newModel)?.label || newModel}`)
        checkSync()
      }
    } catch { /* ignore */ }
  }

  const toggleSkill = async (name: string, enabled: boolean) => {
    setBusy(b => ({ ...b, [name]: true }))
    try {
      const res = await fetch('/api/skills', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, enabled }),
      })
      if (res.ok) {
        setSkills(s => s.map(sk => sk.name === name ? { ...sk, enabled } : sk))
        flash(`${name} ${enabled ? 'enabled' : 'disabled'}`)
        checkSync()
      }
    } finally {
      setBusy(b => ({ ...b, [name]: false }))
    }
  }

  const updateSchedule = async (name: string, schedule: string) => {
    setBusy(b => ({ ...b, [`s-${name}`]: true }))
    try {
      const res = await fetch('/api/skills', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, schedule }),
      })
      if (res.ok) {
        setSkills(s => s.map(sk => sk.name === name ? { ...sk, schedule } : sk))
        flash(`${name} schedule updated`)
        checkSync()
      }
    } finally {
      setBusy(b => ({ ...b, [`s-${name}`]: false }))
    }
  }

  const refreshRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/runs')
      if (res.ok) setRuns((await res.json()).runs)
    } catch { /* ignore */ }
  }, [])

  const viewRunLogs = async (run: Run) => {
    setSelectedRun(run)
    setRunLogs('')
    setRunSummary('')
    setShowFullLogs(false)
    setLogsLoading(true)
    try {
      const res = await fetch(`/api/runs/${run.id}/logs`)
      if (res.ok) {
        const data = await res.json()
        setRunSummary(data.summary || '')
        setRunLogs(data.logs || '(No logs)')
      } else {
        setRunLogs('Failed to fetch logs')
      }
    } catch {
      setRunLogs('Failed to fetch logs')
    } finally {
      setLogsLoading(false)
    }
  }

  const fetchAnalytics = async () => {
    setAnalyticsLoading(true)
    try {
      const res = await fetch('/api/analytics')
      if (res.ok) setAnalyticsData(await res.json())
    } catch { /* ignore */ }
    finally { setAnalyticsLoading(false) }
  }

  // Fetch analytics when tab is selected
  useEffect(() => {
    if (col3Tab === 'analytics' && !analyticsData && !analyticsLoading) fetchAnalytics()
  }, [col3Tab, analyticsData, analyticsLoading])

  // Auto-refresh runs every 10s
  useEffect(() => {
    const id = setInterval(refreshRuns, 10_000)
    return () => clearInterval(id)
  }, [refreshRuns])

  const updateVar = async (name: string, v: string) => {
    try {
      const res = await fetch('/api/skills', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, var: v }),
      })
      if (res.ok) {
        setSkills(s => s.map(sk => sk.name === name ? { ...sk, var: v } : sk))
        flash(`${name} var updated`)
        checkSync()
      }
    } catch { /* ignore */ }
  }

  const updateSkillModel = async (name: string, m: string) => {
    try {
      const res = await fetch('/api/skills', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, skillModel: m }),
      })
      if (res.ok) {
        setSkills(s => s.map(sk => sk.name === name ? { ...sk, model: m } : sk))
        flash(`${name} model ${m ? `set to ${MODELS.find(x => x.id === m)?.label || m}` : 'reset to global default'}`)
        checkSync()
      }
    } catch { /* ignore */ }
  }

  const deleteSkill = async (name: string) => {
    setBusy(b => ({ ...b, [`d-${name}`]: true }))
    try {
      const res = await fetch('/api/skills', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.ok) {
        setSkills(s => s.filter(sk => sk.name !== name))
        setOpenSchedule(null)
        flash(`${name} deleted`)
        checkSync()
      } else {
        const data = await res.json()
        flash(data.error || 'Delete failed')
      }
    } finally {
      setBusy(b => ({ ...b, [`d-${name}`]: false }))
    }
  }

  const runSkill = async (name: string, v?: string, skillModel?: string) => {
    setBusy(b => ({ ...b, [`r-${name}`]: true }))
    try {
      const res = await fetch(`/api/skills/${name}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ var: v || '', model: skillModel || model }),
      })
      if (res.ok) {
        flash(`${name} triggered${v ? ` (${v})` : ''}`)
        // Poll runs a few times so the new run appears quickly
        for (const delay of [2000, 5000, 10000, 20000]) {
          setTimeout(refreshRuns, delay)
        }
      } else {
        const data = await res.json()
        flash(data.error || 'Failed to trigger')
      }
    } finally {
      setBusy(b => ({ ...b, [`r-${name}`]: false }))
    }
  }

  // --- Secret actions ---

  const saveSecret = async (name: string) => {
    if (!secretValue.trim()) return
    setBusy(b => ({ ...b, [`sec-${name}`]: true }))
    try {
      const res = await fetch('/api/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, value: secretValue.trim() }),
      })
      if (res.ok) {
        setSecrets(s => {
          const exists = s.some(sec => sec.name === name)
          if (exists) return s.map(sec => sec.name === name ? { ...sec, isSet: true } : sec)
          return [...s, { name, group: 'Skill Keys', description: 'Custom secret', isSet: true }]
        })
        setEditingSecret(null)
        setSecretValue('')
        setAddingSecret(false)
        setNewSecretName('')
        flash(`${name} saved`)
      } else {
        const data = await res.json()
        flash(data.error || 'Failed to save')
      }
    } finally {
      setBusy(b => ({ ...b, [`sec-${name}`]: false }))
    }
  }

  const deleteSecret = async (name: string) => {
    setBusy(b => ({ ...b, [`sec-${name}`]: true }))
    try {
      const res = await fetch('/api/secrets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.ok) {
        setSecrets(s => s.map(sec => sec.name === name ? { ...sec, isSet: false } : sec))
        flash(`${name} removed`)
      }
    } finally {
      setBusy(b => ({ ...b, [`sec-${name}`]: false }))
    }
  }

  // --- Upload actions ---

  const readFilesFromInput = async (fileList: FileList) => {
    const files: Array<{ path: string; content: string }> = []
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i]
      // webkitRelativePath is set when uploading a folder, otherwise use file.name
      const path = (file as { webkitRelativePath?: string }).webkitRelativePath || file.name
      const content = await file.text()
      files.push({ path, content })
    }
    setUploadFiles(files)
    // Auto-fill name from SKILL.md / .skill frontmatter
    const skillFile = files.find(f => {
      const lower = f.path.toLowerCase()
      return lower === 'skill.md' || lower.endsWith('/skill.md') || lower.endsWith('.skill')
    })
    if (skillFile) {
      const fm = skillFile.content.match(/^---\s*\n([\s\S]*?)\n---/)
      if (fm) {
        const nameMatch = fm[1].match(/name:\s*(.+)/)
        if (nameMatch) {
          const slug = nameMatch[1].trim().replace(/^['"]|['"]$/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          if (slug) setUploadName(slug)
        }
      }
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setUploadDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      await readFilesFromInput(e.dataTransfer.files)
    }
  }

  const uploadSkill = async () => {
    if (uploadFiles.length === 0) return
    setImportLoading(true)
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: uploadFiles, name: uploadName || undefined }),
      })
      if (res.ok) {
        const data = await res.json()
        const missing = (data.detectedSecrets as string[] || []).filter(
          (name: string) => !secrets.some(s => s.name === name && s.isSet)
        )
        if (missing.length > 0) {
          flash(`Uploaded "${data.name}" — needs secrets: ${missing.join(', ')}`)
          // Add missing secrets to the list so user can set them
          setSecrets(s => {
            const newSecrets = missing
              .filter((name: string) => !s.some(sec => sec.name === name))
              .map((name: string) => ({ name, group: 'Skill Keys', description: `Required by ${data.name}`, isSet: false }))
            return [...s, ...newSecrets]
          })
        } else {
          flash(`Uploaded skill "${data.name}" (${data.filesWritten} files)`)
        }
        setShowImport(false)
        setUploadFiles([])
        setUploadName('')
        // Refresh skills list but not secrets (detected secrets were just added to local state)
        fetch('/api/skills').then(r => r.ok ? r.json() : null).then(d => {
          if (d) { setSkills(d.skills); if (d.model) setModel(d.model); if (d.repo) setRepo(d.repo) }
        })
        checkSync()
      } else {
        const data = await res.json()
        flash(data.error || 'Upload failed')
      }
    } finally {
      setImportLoading(false)
    }
  }

  // --- Render ---

  const enabledCount = skills.filter(s => s.enabled).length
  const secretsSet = secrets.filter(s => s.isSet).length

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6">
        <div className="relative flex items-center justify-center">
          <div className="absolute h-16 w-16 rounded-full border border-green-500/20" style={{ animation: 'pulse-ring 2s ease-out infinite' }} />
          <div className="absolute h-16 w-16 rounded-full border border-green-500/20" style={{ animation: 'pulse-ring 2s ease-out infinite 0.6s' }} />
          <div className="absolute h-16 w-16 rounded-full border border-green-500/20" style={{ animation: 'pulse-ring 2s ease-out infinite 1.2s' }} />
          <div className="h-3 w-3 rounded-full bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.4)]" />
        </div>
        <div style={{ animation: 'fade-in-up 0.5s ease-out 0.3s both' }} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-sm">
          <p className="text-red-400 font-medium mb-2">Connection Error</p>
          <p className="text-zinc-500 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 bg-zinc-800 border border-zinc-700 text-zinc-200 px-4 py-2 rounded-lg text-sm shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <header className="border-b border-zinc-800/50 px-5 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <img src="/logo.png" alt="AEON" className="h-16" />
          <div className="flex items-center gap-2">
            {authStatus && !authStatus.authenticated && (
              <button
                onClick={() => setupAuth()}
                disabled={authLoading}
                className="bg-green-600 hover:bg-green-500 text-white text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {authLoading ? 'Setting up...' : 'Authenticate'}
              </button>
            )}
            {repo && (
              <a
                href={`https://github.com/${repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-3 py-1.5 rounded-lg border border-zinc-700/50 transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                GitHub
              </a>
            )}
            <select
              value={model}
              onChange={(e) => updateModel(e.target.value)}
              className="bg-zinc-800 text-zinc-300 text-xs rounded-lg pl-2.5 pr-7 py-1.5 border border-zinc-700/50 outline-none cursor-pointer appearance-none font-mono"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', width: `${(MODELS.find(m => m.id === model)?.label.length || 10) + 5.5}ch` }}
            >
              {MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <button
              onClick={() => setShowImport(true)}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-3 py-1.5 rounded-lg border border-zinc-700/50 transition-colors"
            >
              + Add
            </button>
            <button
              onClick={pullFromGithub}
              disabled={pulling}
              className="relative bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-3 py-1.5 rounded-lg border border-zinc-700/50 transition-colors disabled:opacity-50"
            >
              {behind > 0 && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]" />}
              {pulling ? 'Pulling...' : '\u2190 Pull'}
            </button>
            <button
              onClick={syncToGithub}
              disabled={syncing || !hasChanges || behind > 0}
              title={behind > 0 ? 'Pull first \u2014 remote has new commits' : undefined}
              className="relative bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-3 py-1.5 rounded-lg border border-zinc-700/50 transition-colors disabled:opacity-50"
            >
              {hasChanges && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]" />}
              {syncing ? 'Pushing...' : 'Push \u2192'}
            </button>
          </div>
        </div>
      </header>

      {/* 2-column layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr] min-h-0">

        {/* Column 1: Skills / Secrets (tabbed) */}
        <div className="border-r border-zinc-800/50 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/30">
            <div className="flex items-center gap-1">
              {(['skills', 'secrets'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setCol1Tab(tab)}
                  className={`text-xs font-medium uppercase tracking-wider px-2 py-0.5 rounded transition-colors ${
                    col1Tab === tab ? 'text-zinc-200 bg-zinc-800' : 'text-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-zinc-600">
              {col1Tab === 'skills' ? `${enabledCount}/${skills.length}` : `${secretsSet}/${secrets.length}`}
            </span>
          </div>

          {col1Tab === 'skills' ? (
          <div className="flex-1 overflow-y-auto">
            {[...skills].sort((a, b) => Number(b.enabled) - Number(a.enabled)).map(skill => (
              <div key={skill.name} className={`border-b border-zinc-800/20 border-l-2 ${skill.enabled ? 'bg-green-950/10 border-l-green-500' : 'border-l-transparent'}`}>
                <div
                  onClick={() => setOpenSchedule(openSchedule === skill.name ? null : skill.name)}
                  className="px-3 py-2 hover:bg-zinc-900/50 transition-colors cursor-pointer"
                >
                  {/* Line 1: Toggle + Name + Description */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSkill(skill.name, !skill.enabled) }}
                      disabled={!!busy[skill.name]}
                      className={`relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors ${
                        skill.enabled ? 'bg-green-600' : 'bg-zinc-700'
                      }`}
                    >
                      <span className={`inline-block h-2.5 w-2.5 rounded-full bg-white transition-transform ${
                        skill.enabled ? 'translate-x-[11px]' : 'translate-x-[2px]'
                      }`} />
                    </button>
                    <span className={`font-mono text-[11px] font-medium shrink-0 ${skill.enabled ? 'text-green-300' : ''}`}>{skill.name}</span>
                    {skill.description && (
                      <span className="text-[9px] text-zinc-600 truncate">{skill.description}</span>
                    )}
                  </div>
                  {/* Line 2: Schedule + Model badge + Run */}
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                      openSchedule === skill.name
                        ? 'bg-zinc-700 text-zinc-200'
                        : skill.enabled
                          ? 'bg-green-900/30 text-green-400 border border-green-800/30'
                          : 'bg-zinc-800/60 text-zinc-500 border border-zinc-800/50'
                    }`}>
                      {cronLabel(skill.schedule)}
                    </span>
                    {skill.model && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-400 border border-purple-800/30 truncate font-mono" title={`Model: ${skill.model}`}>
                        {MODELS.find(m => m.id === skill.model)?.label || skill.model}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); runSkill(skill.name, skill.var, skill.model) }}
                      disabled={!!busy[`r-${skill.name}`] || (authStatus !== null && !authStatus.authenticated)}
                      title={authStatus !== null && !authStatus.authenticated ? 'Authenticate first' : undefined}
                      className="text-zinc-500 hover:text-zinc-300 text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/40 hover:bg-zinc-800 border border-zinc-800/50 transition-colors disabled:opacity-50 shrink-0 ml-auto"
                    >
                      {busy[`r-${skill.name}`] ? '\u00b7\u00b7\u00b7' : '\u25b6 Run'}
                    </button>
                  </div>
                  {/* Line 3: Var (only if set) */}
                  {skill.var && (
                    <div className="flex mt-1">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800/60 text-zinc-500 border border-zinc-800/50 truncate max-w-[180px] font-mono" title={skill.var}>
                        {skill.var}
                      </span>
                    </div>
                  )}
                </div>

                {/* Inline schedule + var + model editor */}
                {openSchedule === skill.name && (
                  <>
                    <ScheduleEditor
                      cron={skill.schedule}
                      onSave={(cron) => {
                        updateSchedule(skill.name, cron)
                        setOpenSchedule(null)
                      }}
                    />
                    <VarEditor
                      value={skill.var}
                      onSave={(v) => updateVar(skill.name, v)}
                    />
                    {/* Per-skill model override */}
                    <div className="px-4 py-2 bg-zinc-900/60 border-b border-zinc-800/30 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                      <span className="text-[10px] text-zinc-500 shrink-0">Model</span>
                      <select
                        value={skill.model}
                        onChange={(e) => updateSkillModel(skill.name, e.target.value)}
                        className="flex-1 bg-zinc-800 text-zinc-200 text-[10px] rounded px-2 py-1 border border-zinc-700/50 outline-none font-mono appearance-none cursor-pointer"
                      >
                        <option value="">Global default ({MODELS.find(m => m.id === model)?.label || model})</option>
                        {MODELS.map(m => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="px-4 py-2 bg-zinc-900/40 border-b border-zinc-800/30 flex justify-end" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => { if (confirm(`Delete skill "${skill.name}"? This removes the skill folder and config.`)) deleteSkill(skill.name) }}
                        disabled={!!busy[`d-${skill.name}`]}
                        className="text-[10px] text-red-400/60 hover:text-red-400 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                      >
                        {busy[`d-${skill.name}`] ? 'Deleting...' : 'Delete skill'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          ) : (
          <div className="flex-1 overflow-y-auto">
            {['Core', 'Telegram', '_feed', 'Discord', 'Slack', 'Skill Keys'].map(group => {
              if (group === '_feed') {
                return (
                  <div key={group}>
                    <div className="px-4 pt-3 pb-1">
                      <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider">Feed</span>
                    </div>
                    <div className="px-4 py-2 border-b border-zinc-800/20">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs">JSONRENDER_ENABLED</span>
                            <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${jsonrenderEnabled ? 'bg-green-500' : 'bg-zinc-600'}`} />
                          </div>
                          <div className="text-[10px] text-zinc-600">Write json-render specs from skill runs</div>
                        </div>
                        <button
                          onClick={() => toggleJsonRender(!jsonrenderEnabled)}
                          className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${jsonrenderEnabled ? 'bg-green-600' : 'bg-zinc-700'}`}
                        >
                          <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${jsonrenderEnabled ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              }
              const groupSecrets = secrets.filter(s => s.group === group)
              if (groupSecrets.length === 0) return null
              return (
                <div key={group}>
                  <div className="px-4 pt-3 pb-1">
                    <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider">{group}</span>
                  </div>
                  {groupSecrets.map((secret, i) => {
                    const eitherSibling = secret.either
                      ? groupSecrets.find(s => s.either === secret.either && s.name !== secret.name)
                      : null
                    const siblingIsSet = eitherSibling?.isSet ?? false
                    const dimmed = !secret.isSet && siblingIsSet
                    // Show "or" divider between either-grouped secrets
                    const prevSecret = i > 0 ? groupSecrets[i - 1] : null
                    const showOr = secret.either && prevSecret?.either === secret.either

                    return (<div key={secret.name}>
                    {showOr && (
                      <div className="flex items-center gap-2 px-4 py-0.5">
                        <div className="flex-1 border-t border-zinc-800/40" />
                        <span className="text-[9px] text-zinc-600 uppercase tracking-wider">or</span>
                        <div className="flex-1 border-t border-zinc-800/40" />
                      </div>
                    )}
                    <div className={`px-4 py-2 border-b border-zinc-800/20 hover:bg-zinc-900/50 transition-colors ${dimmed ? 'opacity-40' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs truncate">{secret.name}</span>
                            <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                              secret.isSet ? 'bg-green-500' : 'bg-zinc-600'
                            }`} />
                          </div>
                          <div className="text-[10px] text-zinc-600">{secret.description}</div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {!secret.isSet && editingSecret !== secret.name && (
                            <button
                              onClick={() => {
                                setEditingSecret(secret.name)
                                setSecretValue('')
                              }}
                              className="text-[10px] text-zinc-500 hover:text-zinc-300 px-1.5 py-0.5 rounded transition-colors"
                            >
                              set
                            </button>
                          )}
                          {editingSecret === secret.name && (
                            <button
                              onClick={() => { setEditingSecret(null); setSecretValue('') }}
                              className="text-[10px] text-zinc-500 hover:text-zinc-300 px-1.5 py-0.5 rounded transition-colors"
                            >
                              cancel
                            </button>
                          )}
                          {secret.isSet && editingSecret !== secret.name && (
                            <button
                              onClick={() => deleteSecret(secret.name)}
                              disabled={!!busy[`sec-${secret.name}`]}
                              className="text-[10px] text-red-400/50 hover:text-red-400 px-1.5 py-0.5 rounded transition-colors disabled:opacity-50"
                            >
                              delete
                            </button>
                          )}
                        </div>
                      </div>
                      {editingSecret === secret.name && (
                        <div className="flex gap-1.5 mt-2">
                          <input
                            type="password"
                            value={secretValue}
                            onChange={(e) => setSecretValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveSecret(secret.name)}
                            placeholder="paste value..."
                            autoFocus
                            className="flex-1 bg-zinc-800 text-zinc-200 text-xs rounded px-2 py-1 border border-zinc-700/50 outline-none placeholder:text-zinc-600 font-mono"
                          />
                          <button
                            onClick={() => saveSecret(secret.name)}
                            disabled={!secretValue.trim() || !!busy[`sec-${secret.name}`]}
                            className="bg-green-600 hover:bg-green-500 text-white text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-50"
                          >
                            {busy[`sec-${secret.name}`] ? '\u00b7\u00b7\u00b7' : 'Save'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>)
                  })}
                </div>
              )
            })}
            {/* Add custom secret */}
            <div className="px-4 py-3">
              {addingSecret ? (
                <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={newSecretName}
                    onChange={(e) => setNewSecretName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                    placeholder="SECRET_NAME"
                    autoFocus
                    className="w-full bg-zinc-800 text-zinc-200 text-xs rounded px-2 py-1.5 border border-zinc-700/50 outline-none placeholder:text-zinc-600 font-mono"
                  />
                  {newSecretName && (
                    <div className="flex gap-1.5">
                      <input
                        type="password"
                        value={secretValue}
                        onChange={(e) => setSecretValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && newSecretName && secretValue.trim() && saveSecret(newSecretName)}
                        placeholder="paste value..."
                        className="flex-1 bg-zinc-800 text-zinc-200 text-xs rounded px-2 py-1 border border-zinc-700/50 outline-none placeholder:text-zinc-600 font-mono"
                      />
                      <button
                        onClick={() => saveSecret(newSecretName)}
                        disabled={!secretValue.trim()}
                        className="bg-green-600 hover:bg-green-500 text-white text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  )}
                  <button
                    onClick={() => { setAddingSecret(false); setNewSecretName(''); setSecretValue('') }}
                    className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors self-start"
                  >
                    cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingSecret(true)}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  + Add Secret
                </button>
              )}
            </div>
          </div>
          )}
        </div>

        {/* Column 2: Feed / Runs */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/30">
            <div className="flex gap-1">
              {(['feed', 'runs', 'analytics'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setCol3Tab(tab)}
                  className={`text-xs font-medium uppercase tracking-wider px-2 py-0.5 rounded transition-colors ${
                    col3Tab === tab ? 'text-zinc-200 bg-zinc-800' : 'text-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <button onClick={() => { fetchData(); setFeedKey(k => k + 1); if (col3Tab === 'analytics') { setAnalyticsData(null); fetchAnalytics() } }} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
              refresh
            </button>
          </div>
          {col3Tab === 'analytics' ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {analyticsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="relative flex items-center justify-center">
                    <div className="absolute h-8 w-8 rounded-full border border-green-500/20" style={{ animation: 'pulse-ring 2s ease-out infinite' }} />
                    <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                  </div>
                </div>
              ) : analyticsData ? (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-zinc-800/40 rounded-lg p-3 border border-zinc-800/50">
                      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Total Runs</div>
                      <div className="text-lg font-mono text-zinc-200">{analyticsData.summary.totalRuns}</div>
                      <div className="text-[10px] text-zinc-600">{analyticsData.summary.periodDays}d period</div>
                    </div>
                    <div className="bg-zinc-800/40 rounded-lg p-3 border border-zinc-800/50">
                      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Success Rate</div>
                      <div className={`text-lg font-mono ${analyticsData.summary.overallSuccessRate >= 80 ? 'text-green-400' : analyticsData.summary.overallSuccessRate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {analyticsData.summary.overallSuccessRate}%
                      </div>
                      <div className="text-[10px] text-zinc-600">{analyticsData.summary.totalSuccess} passed</div>
                    </div>
                    <div className="bg-zinc-800/40 rounded-lg p-3 border border-zinc-800/50">
                      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Skills</div>
                      <div className="text-lg font-mono text-zinc-200">{analyticsData.summary.uniqueSkills}</div>
                      <div className="text-[10px] text-zinc-600">{analyticsData.summary.totalFailure} failures</div>
                    </div>
                  </div>

                  {/* Insights */}
                  {analyticsData.insights.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Insights</div>
                      {analyticsData.insights.map((insight, i) => (
                        <div key={i} className={`text-[11px] px-2.5 py-1.5 rounded border ${
                          insight.type === 'warning' ? 'text-yellow-300 bg-yellow-500/5 border-yellow-500/20' :
                          insight.type === 'success' ? 'text-green-300 bg-green-500/5 border-green-500/20' :
                          'text-blue-300 bg-blue-500/5 border-blue-500/20'
                        }`}>
                          {insight.type === 'warning' ? '! ' : insight.type === 'success' ? '+ ' : '~ '}{insight.message}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Per-skill breakdown */}
                  <div className="space-y-1">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Per-Skill Breakdown</div>
                    {analyticsData.skills.map(s => {
                      const maxRuns = Math.max(...analyticsData.skills.map(sk => sk.total), 1)
                      return (
                        <div key={s.name} className="group">
                          <div className="flex items-center gap-2 py-1.5">
                            <span className={`text-xs w-3 text-center ${
                              s.lastConclusion === 'success' ? 'text-green-400' :
                              s.lastConclusion === 'failure' ? 'text-red-400' : 'text-zinc-600'
                            }`}>
                              {s.lastConclusion === 'success' ? '\u2713' : s.lastConclusion === 'failure' ? '\u2717' : '\u00b7'}
                            </span>
                            <span className="font-mono text-[11px] text-zinc-300 w-32 truncate">{s.name}</span>
                            <div className="flex-1 h-3 bg-zinc-800/50 rounded-sm overflow-hidden flex">
                              {s.success > 0 && (
                                <div className="bg-green-500/60 h-full" style={{ width: `${(s.success / maxRuns) * 100}%` }} />
                              )}
                              {s.failure > 0 && (
                                <div className="bg-red-500/60 h-full" style={{ width: `${(s.failure / maxRuns) * 100}%` }} />
                              )}
                              {s.cancelled > 0 && (
                                <div className="bg-zinc-600/60 h-full" style={{ width: `${(s.cancelled / maxRuns) * 100}%` }} />
                              )}
                            </div>
                            <span className="text-[10px] text-zinc-500 tabular-nums w-8 text-right">{s.total}</span>
                            <span className={`text-[10px] tabular-nums w-10 text-right ${
                              s.successRate >= 80 ? 'text-green-400' : s.successRate >= 50 ? 'text-yellow-400' : 'text-red-400'
                            }`}>{s.successRate}%</span>
                          </div>
                          <div className="hidden group-hover:flex items-center gap-3 pl-5 pb-1.5 text-[10px] text-zinc-600">
                            {s.avgDurationMin !== null && <span>avg {s.avgDurationMin}m</span>}
                            {s.streak !== 0 && (
                              <span className={s.streak > 0 ? 'text-green-500' : 'text-red-500'}>
                                {s.streak > 0 ? `${s.streak} streak` : `${Math.abs(s.streak)} fails`}
                              </span>
                            )}
                            {s.lastRun && <span>last {timeAgo(s.lastRun)}</span>}
                          </div>
                        </div>
                      )
                    })}
                    {analyticsData.skills.length === 0 && (
                      <div className="text-xs text-zinc-600 text-center py-8">No run data available yet</div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-xs text-zinc-600 text-center py-8">Failed to load analytics</div>
              )}
            </div>
          ) : col3Tab === 'feed' ? (
            <div className="flex-1 overflow-y-auto">
              <SkillFeed refreshKey={feedKey} />
            </div>
          ) : selectedRun ? (
            /* Log viewer */
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800/30 shrink-0">
                <button
                  onClick={() => { setSelectedRun(null); setRunLogs(''); setRunSummary(''); setShowFullLogs(false) }}
                  className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
                >
                  &larr;
                </button>
                <span className={`text-xs ${
                  selectedRun.conclusion === 'success' ? 'text-green-400' :
                  selectedRun.conclusion === 'failure' ? 'text-red-400' :
                  selectedRun.status === 'in_progress' ? 'text-yellow-400' :
                  'text-zinc-600'
                }`}>
                  {selectedRun.conclusion === 'success' ? '\u2713' :
                   selectedRun.conclusion === 'failure' ? '\u2717' :
                   selectedRun.status === 'in_progress' ? '\u25cc' : '\u00b7'}
                </span>
                <span className="font-mono text-xs text-zinc-300 truncate flex-1">{selectedRun.workflow}</span>
                <a
                  href={selectedRun.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 px-2 py-0.5 rounded bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-800/50 transition-colors shrink-0"
                >
                  Open on GitHub
                </a>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {logsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="relative flex items-center justify-center">
                      <div className="absolute h-8 w-8 rounded-full border border-green-500/20" style={{ animation: 'pulse-ring 2s ease-out infinite' }} />
                      <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {runSummary ? (
                      <pre className="text-[11px] leading-relaxed font-mono text-zinc-300 whitespace-pre-wrap break-words">
                        {runSummary.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/gm, '')}
                      </pre>
                    ) : (
                      <p className="text-[11px] text-zinc-600 italic">No summary available</p>
                    )}
                    <button
                      onClick={() => setShowFullLogs(!showFullLogs)}
                      className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors flex items-center gap-1"
                    >
                      <span className="transform transition-transform" style={{ display: 'inline-block', transform: showFullLogs ? 'rotate(90deg)' : 'rotate(0deg)' }}>&rsaquo;</span>
                      Full logs
                    </button>
                    {showFullLogs && (
                      <pre className="text-[11px] leading-relaxed font-mono text-zinc-500 whitespace-pre-wrap break-words border-t border-zinc-800/30 pt-3">
                        {runLogs.replace(/\x1b\[[0-9;]*m/g, '')}
                      </pre>
                    )}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Run list */
            <div className="flex-1 overflow-y-auto">
              {runs.length === 0 ? (
                <div className="px-4 py-12 text-center text-zinc-600 text-xs">
                  No runs yet
                </div>
              ) : (
                runs.map(run => (
                  <button
                    key={run.id}
                    onClick={() => viewRunLogs(run)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800/20 hover:bg-zinc-900/50 transition-colors text-left"
                  >
                    <span className={`text-xs ${
                      run.conclusion === 'success' ? 'text-green-400' :
                      run.conclusion === 'failure' ? 'text-red-400' :
                      run.status === 'in_progress' ? 'text-yellow-400' :
                      'text-zinc-600'
                    }`}>
                      {run.conclusion === 'success' ? '\u2713' :
                       run.conclusion === 'failure' ? '\u2717' :
                       run.status === 'in_progress' ? '\u25cc' : '\u00b7'}
                    </span>
                    <span className="font-mono text-xs text-zinc-300 truncate flex-1">{run.workflow}</span>
                    <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">{timeAgo(run.created_at)}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md mx-4 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-medium text-sm">Upload Skill</h2>
              <button
                onClick={() => { setShowImport(false); setUploadFiles([]); setUploadName('') }}
                className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && readFilesFromInput(e.target.files)}
            />
            <input
              ref={(el) => { if (el) el.setAttribute('webkitdirectory', '') }}
              type="file"
              className="hidden"
              id="folder-input"
              onChange={(e) => e.target.files && readFilesFromInput(e.target.files)}
            />
            <div
              onDragOver={(e) => { e.preventDefault(); setUploadDragOver(true) }}
              onDragLeave={() => setUploadDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                uploadDragOver ? 'border-green-500 bg-green-950/20' : 'border-zinc-700 hover:border-zinc-600'
              }`}
            >
              {uploadFiles.length === 0 ? (
                <>
                  <div className="text-zinc-500 text-sm mb-3">
                    Drag & drop a skill folder here, or
                  </div>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-3 py-1.5 rounded-lg border border-zinc-700/50 transition-colors"
                    >
                      Choose Files
                    </button>
                    <button
                      onClick={() => document.getElementById('folder-input')?.click()}
                      className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-3 py-1.5 rounded-lg border border-zinc-700/50 transition-colors"
                    >
                      Choose Folder
                    </button>
                  </div>
                  <div className="text-zinc-600 text-[10px] mt-3">
                    Must include a SKILL.md or .skill file
                  </div>
                </>
              ) : (
                <>
                  <div className="text-zinc-300 text-sm mb-1">
                    {uploadFiles.length} file{uploadFiles.length !== 1 ? 's' : ''} selected
                  </div>
                  <div className="text-zinc-500 text-xs mb-3 max-h-24 overflow-y-auto font-mono">
                    {uploadFiles.map(f => f.path).join(', ')}
                  </div>
                  <button
                    onClick={() => { setUploadFiles([]); setUploadName(''); if (fileInputRef.current) fileInputRef.current.value = '' }}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>

            {uploadFiles.length > 0 && (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">Skill name (optional — auto-detected from folder or SKILL.md)</label>
                  <input
                    type="text"
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    placeholder={uploadFiles[0]?.path.split('/')[0] || 'my-skill'}
                    className="w-full bg-zinc-800 text-zinc-200 text-sm rounded-lg px-3 py-2 border border-zinc-700/50 outline-none placeholder:text-zinc-600 font-mono"
                  />
                </div>
                <button
                  onClick={uploadSkill}
                  disabled={importLoading}
                  className="w-full bg-green-600 hover:bg-green-500 text-white text-sm py-2.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  {importLoading ? 'Uploading...' : 'Upload Skill'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm mx-4 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-medium text-sm">Authenticate</h2>
              <button
                onClick={() => { setShowAuthModal(false); setAuthKey('') }}
                className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
              >
                &times;
              </button>
            </div>
            <p className="text-zinc-500 text-xs mb-4">
              Paste your API key or OAuth token to enable skill runs on GitHub Actions.
            </p>
            <input
              type="password"
              value={authKey}
              onChange={(e) => setAuthKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && authKey.trim() && setupAuth(authKey.trim())}
              placeholder="sk-ant-..."
              autoFocus
              className="w-full bg-zinc-800 text-zinc-200 text-sm rounded-lg px-3 py-2 border border-zinc-700/50 outline-none placeholder:text-zinc-600 font-mono mb-4"
            />
            <button
              onClick={() => setupAuth(authKey.trim())}
              disabled={!authKey.trim() || authLoading}
              className="w-full bg-green-600 hover:bg-green-500 text-white text-sm py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {authLoading ? 'Saving...' : 'Save to GitHub'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
