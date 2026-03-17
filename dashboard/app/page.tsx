'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface Skill {
  name: string
  description: string
  enabled: boolean
  schedule: string
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
}

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

function parseCron(cron: string): { mode: 'interval'; hours: number } | { mode: 'time'; hour12: number; ampm: 'AM' | 'PM'; day: number } {
  const parts = cron.split(' ')
  const h = parts[1]
  const dow = parts[4]
  if (h === '*' || h.includes('/')) {
    return { mode: 'interval', hours: h === '*' ? 1 : parseInt(h.split('/')[1]) || 1 }
  }
  const utcH = parseInt(h)
  const localH = utcToLocal24(utcH)
  return {
    mode: 'time',
    hour12: localH > 12 ? localH - 12 : localH === 0 ? 12 : localH,
    ampm: localH >= 12 ? 'PM' : 'AM',
    day: dow === '*' ? -1 : parseInt(dow),
  }
}

function cronLabel(cron: string): string {
  const p = parseCron(cron)
  if (p.mode === 'interval') return `Every ${p.hours}h`
  const dayName = p.day === -1 ? 'daily' : DAYS.find(d => d.value === p.day)?.label || ''
  return `${p.hour12} ${p.ampm} ${dayName}`
}

function buildCron(mode: 'interval' | 'time', hours: number, hour12: number, ampm: 'AM' | 'PM', day: number): string {
  if (mode === 'interval') return `0 */${hours} * * *`
  let localH = hour12
  if (ampm === 'PM' && localH !== 12) localH += 12
  if (ampm === 'AM' && localH === 12) localH = 0
  const utcH = localToUtc24(localH)
  return `0 ${utcH} * * ${day === -1 ? '*' : day}`
}

function ScheduleEditor({ cron, onSave }: { cron: string; onSave: (cron: string) => void }) {
  const parsed = parseCron(cron)
  const [mode, setMode] = useState<'interval' | 'time'>(parsed.mode)
  const [hours, setHours] = useState(parsed.mode === 'interval' ? parsed.hours : 3)
  const [hour12, setHour12] = useState(parsed.mode === 'time' ? parsed.hour12 : 7)
  const [ampm, setAmpm] = useState<'AM' | 'PM'>(parsed.mode === 'time' ? parsed.ampm : 'AM')
  const [day, setDay] = useState(parsed.mode === 'time' ? parsed.day : -1)

  const apply = () => onSave(buildCron(mode, hours, hour12, ampm, day))

  return (
    <div className="px-4 py-2 bg-zinc-900/80 border-b border-zinc-800/30 flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
      {/* Interval */}
      <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
        <input type="radio" name="sched-mode" checked={mode === 'interval'} onChange={() => setMode('interval')} className="accent-green-500 w-3 h-3" />
        <span className="text-[10px] text-zinc-400">Every</span>
        <input
          type="number" min={1} max={24} value={hours}
          onFocus={() => setMode('interval')}
          onChange={(e) => { setHours(Math.max(1, Math.min(24, parseInt(e.target.value) || 1))); setMode('interval') }}
          className="w-10 bg-zinc-800 text-zinc-200 text-[10px] rounded px-1.5 py-0.5 border border-zinc-700/50 outline-none text-center font-mono"
        />
        <span className="text-[10px] text-zinc-400">h</span>
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
        <div className="flex text-[10px] rounded overflow-hidden border border-zinc-700/50">
          <button type="button" onClick={() => { setAmpm('AM'); setMode('time') }}
            className={`px-1.5 py-0.5 ${ampm === 'AM' ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>AM</button>
          <button type="button" onClick={() => { setAmpm('PM'); setMode('time') }}
            className={`px-1.5 py-0.5 ${ampm === 'PM' ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>PM</button>
        </div>
      </label>

      {/* Day pills */}
      {mode === 'time' && (
        <div className="flex gap-0.5 shrink-0">
          {DAYS.map(d => (
            <button key={d.value} type="button" onClick={() => setDay(d.value)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                day === d.value ? 'bg-green-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState('')
  const [editingSecret, setEditingSecret] = useState<string | null>(null)
  const [secretValue, setSecretValue] = useState('')
  const [hasChanges, setHasChanges] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [openSchedule, setOpenSchedule] = useState<string | null>(null)

  // Import modal
  const [showImport, setShowImport] = useState(false)
  const [importTab, setImportTab] = useState<'github' | 'upload'>('github')
  const [importRepo, setImportRepo] = useState('')
  const [importSkills, setImportSkills] = useState<Array<{ name: string; description: string; installed: boolean }>>([])
  const [importLoading, setImportLoading] = useState(false)
  const [importSelected, setImportSelected] = useState<Set<string>>(new Set())
  const [uploadFiles, setUploadFiles] = useState<Array<{ path: string; content: string }>>([])
  const [uploadDragOver, setUploadDragOver] = useState(false)
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
      if (res.ok) setHasChanges((await res.json()).hasChanges)
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

  const fetchData = useCallback(async () => {
    try {
      const [skillsRes, runsRes, secretsRes] = await Promise.all([
        fetch('/api/skills'),
        fetch('/api/runs'),
        fetch('/api/secrets'),
      ])
      if (skillsRes.ok) setSkills((await skillsRes.json()).skills)
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

  const runSkill = async (name: string) => {
    setBusy(b => ({ ...b, [`r-${name}`]: true }))
    try {
      const res = await fetch(`/api/skills/${name}/run`, { method: 'POST' })
      if (res.ok) {
        flash(`${name} triggered`)
        setTimeout(fetchData, 5000)
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
        setSecrets(s => s.map(sec => sec.name === name ? { ...sec, isSet: true } : sec))
        setEditingSecret(null)
        setSecretValue('')
        flash(`${name} saved`)
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

  // --- Import actions ---

  const searchImport = async () => {
    if (!importRepo.trim()) return
    setImportLoading(true)
    setImportSkills([])
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', repo: importRepo.trim() }),
      })
      if (res.ok) {
        setImportSkills((await res.json()).skills)
        setImportSelected(new Set())
      } else {
        flash('Could not find skills in that repo')
      }
    } finally {
      setImportLoading(false)
    }
  }

  const installSkills = async () => {
    if (importSelected.size === 0) return
    setImportLoading(true)
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install', repo: importRepo.trim(), skills: Array.from(importSelected) }),
      })
      if (res.ok) {
        const data = await res.json()
        flash(`Installed ${data.installed.length} skill(s)`)
        setShowImport(false)
        fetchData()
      }
    } finally {
      setImportLoading(false)
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
        body: JSON.stringify({ files: uploadFiles }),
      })
      if (res.ok) {
        const data = await res.json()
        flash(`Uploaded skill "${data.name}" (${data.filesWritten} files)`)
        setShowImport(false)
        setUploadFiles([])
        fetchData()
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-zinc-500 text-sm">Loading...</div>
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
          <div className="flex gap-2">
            {authStatus && !authStatus.authenticated && (
              <button
                onClick={() => setupAuth()}
                disabled={authLoading}
                className="bg-red-600/80 hover:bg-red-500 text-white text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {authLoading ? 'Setting up...' : 'Authenticate'}
              </button>
            )}
            <button
              onClick={() => setShowImport(true)}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-3 py-1.5 rounded-lg border border-zinc-700/50 transition-colors"
            >
              + Import
            </button>
            <button
              onClick={syncToGithub}
              disabled={syncing || !hasChanges}
              className={`text-white text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                hasChanges ? 'bg-green-600 hover:bg-green-500' : 'bg-zinc-700'
              }`}
            >
              {syncing ? 'Pushing...' : 'Push to GitHub'}
            </button>
          </div>
        </div>
      </header>

      {/* 3-column layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_340px_300px] min-h-0">

        {/* Column 1: Skills */}
        <div className="border-r border-zinc-800/50 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/30">
            <div className="flex items-baseline gap-3">
              <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Skills</h2>
              <span className="text-xs text-zinc-600">{enabledCount} / {skills.length} enabled</span>
            </div>
            <span className="text-[10px] text-zinc-600">{getLocalTzAbbr()}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {skills.map(skill => (
              <div key={skill.name} className={`border-b border-zinc-800/20 border-l-2 ${skill.enabled ? 'bg-green-950/10 border-l-green-500' : 'border-l-transparent'}`}>
                <div
                  onClick={() => setOpenSchedule(openSchedule === skill.name ? null : skill.name)}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-900/50 transition-colors cursor-pointer"
                >
                  {/* Toggle */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleSkill(skill.name, !skill.enabled) }}
                    disabled={!!busy[skill.name]}
                    className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                      skill.enabled ? 'bg-green-600' : 'bg-zinc-700'
                    }`}
                  >
                    <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                      skill.enabled ? 'translate-x-[14px]' : 'translate-x-[2px]'
                    }`} />
                  </button>

                  {/* Name + description */}
                  <div className="flex-1 min-w-0">
                    <div className={`font-mono text-xs font-medium truncate ${skill.enabled ? 'text-green-300' : ''}`}>{skill.name}</div>
                    {skill.description && (
                      <div className="text-[10px] text-zinc-500 truncate">{skill.description}</div>
                    )}
                  </div>

                  {/* Schedule label */}
                  <span className={`text-[10px] px-2 py-1 rounded shrink-0 font-mono ${
                    openSchedule === skill.name
                      ? 'bg-zinc-700 text-zinc-200'
                      : skill.enabled
                        ? 'bg-green-900/30 text-green-400 border border-green-800/30'
                        : 'bg-zinc-800/60 text-zinc-500 border border-zinc-800/50'
                  }`}>
                    {cronLabel(skill.schedule)}
                  </span>

                  {/* Run */}
                  <button
                    onClick={(e) => { e.stopPropagation(); runSkill(skill.name) }}
                    disabled={!!busy[`r-${skill.name}`] || (authStatus !== null && !authStatus.authenticated)}
                    title={authStatus !== null && !authStatus.authenticated ? 'Authenticate first' : undefined}
                    className="text-zinc-500 hover:text-zinc-300 text-[10px] px-2 py-1 rounded bg-zinc-800/40 hover:bg-zinc-800 border border-zinc-800/50 transition-colors disabled:opacity-50 shrink-0"
                  >
                    {busy[`r-${skill.name}`] ? '\u00b7\u00b7\u00b7' : '\u25b6 Run'}
                  </button>
                </div>

                {/* Inline schedule editor */}
                {openSchedule === skill.name && (
                  <ScheduleEditor
                    cron={skill.schedule}
                    onSave={(cron) => {
                      updateSchedule(skill.name, cron)
                      setOpenSchedule(null)
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Column 2: Secrets */}
        <div className="border-r border-zinc-800/50 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/30">
            <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Secrets</h2>
            <span className="text-xs text-zinc-600">{secretsSet} / {secrets.length} set</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {['Core', 'Telegram', 'Discord', 'Slack', 'API Keys'].map(group => {
              const groupSecrets = secrets.filter(s => s.group === group)
              if (groupSecrets.length === 0) return null
              return (
                <div key={group}>
                  <div className="px-4 pt-3 pb-1">
                    <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider">{group}</span>
                  </div>
                  {groupSecrets.map(secret => (
                    <div key={secret.name} className="px-4 py-2 border-b border-zinc-800/20 hover:bg-zinc-900/50 transition-colors">
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
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        {/* Column 3: Runs */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/30">
            <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Runs</h2>
            <button onClick={fetchData} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
              refresh
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {runs.length === 0 ? (
              <div className="px-4 py-12 text-center text-zinc-600 text-xs">
                No runs yet
              </div>
            ) : (
              runs.map(run => (
                <a
                  key={run.id}
                  href={run.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800/20 hover:bg-zinc-900/50 transition-colors"
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
                </a>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md mx-4 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-medium text-sm">Import Skills</h2>
              <button
                onClick={() => { setShowImport(false); setImportSkills([]); setImportRepo(''); setUploadFiles([]) }}
                className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-5 bg-zinc-800/50 rounded-lg p-0.5">
              <button
                onClick={() => setImportTab('github')}
                className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                  importTab === 'github' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                GitHub Repo
              </button>
              <button
                onClick={() => setImportTab('upload')}
                className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                  importTab === 'upload' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Upload Files
              </button>
            </div>

            {/* GitHub tab */}
            {importTab === 'github' && (
              <>
                <div className="flex gap-2 mb-5">
                  <input
                    type="text"
                    value={importRepo}
                    onChange={(e) => setImportRepo(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchImport()}
                    placeholder="owner/repo"
                    className="flex-1 bg-zinc-800 text-zinc-200 text-sm rounded-lg px-3 py-2 border border-zinc-700/50 outline-none placeholder:text-zinc-600"
                  />
                  <button
                    onClick={searchImport}
                    disabled={importLoading || !importRepo.trim()}
                    className="bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {importLoading && importSkills.length === 0 ? '\u00b7\u00b7\u00b7' : 'Search'}
                  </button>
                </div>
                {importSkills.length > 0 && (
                  <>
                    <div className="max-h-60 overflow-y-auto -mx-2 mb-4">
                      {importSkills.map(skill => (
                        <label
                          key={skill.name}
                          className={`flex items-start gap-3 px-3 py-2.5 mx-1 rounded-lg cursor-pointer transition-colors ${
                            importSelected.has(skill.name) ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                          } ${skill.installed ? 'opacity-40' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={importSelected.has(skill.name)}
                            onChange={(e) => {
                              const next = new Set(importSelected)
                              e.target.checked ? next.add(skill.name) : next.delete(skill.name)
                              setImportSelected(next)
                            }}
                            className="mt-0.5 rounded border-zinc-600 accent-green-500"
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-mono">
                              {skill.name}
                              {skill.installed && <span className="text-zinc-500 text-xs ml-2">(installed)</span>}
                            </div>
                            {skill.description && (
                              <div className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{skill.description}</div>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                    <button
                      onClick={installSkills}
                      disabled={importSelected.size === 0 || importLoading}
                      className="w-full bg-green-600 hover:bg-green-500 text-white text-sm py-2.5 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {importLoading ? 'Installing...' : `Install ${importSelected.size} skill(s)`}
                    </button>
                  </>
                )}
              </>
            )}

            {/* Upload tab */}
            {importTab === 'upload' && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && readFilesFromInput(e.target.files)}
                />
                {/* @ts-expect-error webkitdirectory is a non-standard attribute */}
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
                        Must include a SKILL.md file
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-zinc-300 text-sm mb-1">
                        {uploadFiles.length} file{uploadFiles.length !== 1 ? 's' : ''} selected
                      </div>
                      <div className="text-zinc-500 text-xs mb-3 max-h-24 overflow-y-auto">
                        {uploadFiles.map(f => f.path).join(', ')}
                      </div>
                      <button
                        onClick={() => { setUploadFiles([]); if (fileInputRef.current) fileInputRef.current.value = '' }}
                        className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        Clear
                      </button>
                    </>
                  )}
                </div>
                {uploadFiles.length > 0 && (
                  <button
                    onClick={uploadSkill}
                    disabled={importLoading}
                    className="w-full mt-4 bg-green-600 hover:bg-green-500 text-white text-sm py-2.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {importLoading ? 'Uploading...' : 'Upload Skill'}
                  </button>
                )}
              </>
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
              Paste your Anthropic API key to enable skill runs on GitHub Actions.
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
