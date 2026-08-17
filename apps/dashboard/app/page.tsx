'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  Skill, Run, Secret, SkillOutput, GatewayProvider, Harness, UploadFile, AnalyticsData,
  SkillsResponse, RunsResponse, SecretsResponse, SyncStatusResponse, McpResponse,
  OutputsResponse, StrategyResponse, SoulResponse, SyncResult, SoulExampleResponse,
  UploadResponse, ErrorResponse, PacksResponse, McpServers, SoulSources, StrategySources,
  DashboardView,
} from '../lib/types'
import { getJson, postJson, putJson, patchJson, del, scheduleRunRefresh } from '../lib/api-client'
import { MODELS, authSecretsForHarness, PACK_BY_KEY, FIRST_PARTY_KEYS, DEFAULT_VISIBLE_PACKS, HARNESSES, modelsForHarness } from '../lib/constants'
import { displayName } from '../lib/utils'
import TargetCursor from '../components/ui/TargetCursor'
import { LoadingScreen } from '../components/LoadingScreen'
import { ErrorScreen } from '../components/ErrorScreen'
import { LeftSidebar } from '../components/LeftSidebar'
import { TopBar } from '../components/TopBar'
import { HQOverview } from '../components/HQOverview'
import { SkillDetail } from '../components/SkillDetail'
import { SecretsPanel } from '../components/SecretsPanel'
import { StrategyPanel } from '../components/StrategyPanel'
import { SoulPanel, type SoulFile } from '../components/SoulPanel'
import { McpPanel } from '../components/McpPanel'
import { PacksPanel } from '../components/PacksPanel'
import { RightPanel } from '../components/RightPanel'
import { ImportModal } from '../components/ImportModal'
import { AuthModal } from '../components/AuthModal'
import { GrokAuthModal } from '../components/GrokAuthModal'
import { HarnessAuthModal } from '../components/HarnessAuthModal'
import { HARNESS_AUTH } from '../lib/harness-auth'
import { PanelError } from '../components/PanelError'

export default function Dashboard() {
  const [view, setView] = useState<DashboardView>('hq')
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [secretFocus, setSecretFocus] = useState<string | null>(null)
  // Shared with the sidebar's category chips - HQ category cards toggle it too.
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const mainScrollRef = useRef<HTMLDivElement>(null)

  const [skills, setSkills] = useState<Skill[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [secrets, setSecrets] = useState<Secret[]>([])
  // Did the last /api/secrets read succeed? Distinguishes "no key set" from
  // "couldn't read the vault" (GitHub API 503 / gh not authenticated) so the
  // run-gate can't blame a missing key when the truth is an unreadable vault.
  const [secretsReadOk, setSecretsReadOk] = useState(false)
  const [model, setModel] = useState('claude-sonnet-5')
  const [harness, setHarness] = useState<Harness>('claude')
  const [gateway, setGateway] = useState<GatewayProvider>('auto')
  const [repo, setRepo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState('')
  const [hasChanges, setHasChanges] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [behind, setBehind] = useState(0)
  const [feedKey, setFeedKey] = useState(0)

  const [outputs, setOutputs] = useState<SkillOutput[]>([])
  const [feedLoading, setFeedLoading] = useState(false)
  const [feedError, setFeedError] = useState(false)
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null)
  const [analyticsError, setAnalyticsError] = useState(false)

  const [packs, setPacks] = useState<PacksResponse | null>(null)
  const [packsLoaded, setPacksLoaded] = useState(false)
  const [packsError, setPacksError] = useState(false)
  // Which packs are *visible* across the dashboard. A pack is a visibility lens:
  // by default only Core shows everywhere; enabling a pack reveals its skills in
  // the sidebar + HQ. Pure client-side view preference - it never changes what
  // runs (that's the per-skill `enabled` toggle in aeon.yml). Persisted below.
  const [enabledPacks, setEnabledPacks] = useState<string[]>(Array.from(DEFAULT_VISIBLE_PACKS))

  const [showImport, setShowImport] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
  const [grokLoading, setGrokLoading] = useState(false)
  const [harnessAuthLoading, setHarnessAuthLoading] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)

  const [strategy, setStrategy] = useState('')
  const [strategyLoaded, setStrategyLoaded] = useState(false)
  const [strategyError, setStrategyError] = useState(false)
  const [strategySaving, setStrategySaving] = useState(false)
  const [strategyBuilding, setStrategyBuilding] = useState(false)
  const [mcpServers, setMcpServers] = useState<McpServers>({})
  const [mcpLoaded, setMcpLoaded] = useState(false)
  const [mcpError, setMcpError] = useState(false)
  const [mcpSaving, setMcpSaving] = useState(false)
  const [soul, setSoul] = useState('')
  const [soulStyle, setSoulStyle] = useState('')
  const [soulLoaded, setSoulLoaded] = useState(false)
  const [soulError, setSoulError] = useState(false)
  const [soulSaving, setSoulSaving] = useState(false)
  const [soulBuilding, setSoulBuilding] = useState(false)
  const [soulInstalling, setSoulInstalling] = useState<string | null>(null)

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }
  // Config writes auto-commit+push in local mode (no-op in hosted mode). Reflect
  // the result: clear the "needs Sync" nudge on success, raise it only if the
  // push failed (e.g. behind origin/main → resolve via the manual Sync button).
  const flashSynced = (base: string, d: { synced?: boolean }) => {
    const failed = d?.synced === false
    setHasChanges(failed)
    flash(failed ? `${base} · saved locally, not pushed` : base)
  }

  // --- API ---
  const fetchData = useCallback(async () => {
    try { const [sr, rr, secr] = await Promise.all([fetch('/api/skills'), fetch('/api/runs'), fetch('/api/secrets')]); if (sr.ok) { const d = await sr.json() as SkillsResponse; setSkills(d.skills); if (d.model) setModel(d.model); if (d.harness) setHarness(d.harness); if (d.gateway?.provider) setGateway(d.gateway.provider); if (d.repo) setRepo(d.repo) }; if (rr.ok) setRuns((await rr.json() as RunsResponse).runs); if (secr.ok) { const d = await secr.json() as SecretsResponse; if (d.secrets) { setSecrets(d.secrets); setSecretsReadOk(true) } } else { setSecretsReadOk(false) } } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to connect') } finally { setLoading(false) }
    try { const r = await fetch('/api/sync'); if (r.ok) { const d = await r.json() as SyncStatusResponse; setHasChanges(d.hasChanges); if (typeof d.behind === 'number') setBehind(d.behind) } } catch {}
    // Preload MCP servers so each skill's "MCP servers" panel can show install state.
    try { const r = await fetch('/api/mcp'); if (r.ok) { const d = await r.json() as McpResponse; setMcpServers(d.servers || {}); setMcpLoaded(true) } } catch {}
  }, [])
  const refreshRuns = useCallback(async () => { try { const r = await fetch('/api/runs'); if (r.ok) setRuns((await r.json() as RunsResponse).runs) } catch {} }, [])
  // Optimistically mark a just-saved secret as set. We know it's set (the write
  // succeeded), so reflect it even before the follow-up /api/secrets read lands -
  // and flag the vault readable so the run-gate stops blaming a missing key when
  // that read is flaky (the GitHub-503 case behind #878).
  const markSecretSet = (name: string, group = 'Skill Keys') => { setSecrets(s => s.some(x => x.name === name) ? s.map(x => x.name === name ? { ...x, isSet: true } : x) : [...s, { name, group, description: 'Custom', isSet: true }]); setSecretsReadOk(true) }
  useEffect(() => { fetchData() }, [fetchData])
  // Restore the operator's enabled-pack selection from a prior visit, scoped to
  // THIS repo (Core is always on). Per-repo keying so testing multiple forks on
  // the same localhost doesn't bleed one fork's pack selection into another — a
  // fresh fork starts Core-only. Runs once the repo is known.
  const restoredRepoRef = useRef<string | null>(null)
  useEffect(() => {
    if (!repo || restoredRepoRef.current === repo) return
    restoredRepoRef.current = repo
    let saved: string[] = []
    try {
      const raw = localStorage.getItem(`aeon.enabledPacks:${repo}`)
      if (raw) { const arr: unknown = JSON.parse(raw); if (Array.isArray(arr)) saved = arr.filter((k: unknown): k is string => typeof k === 'string') }
    } catch {}
    setEnabledPacks(Array.from(new Set([...DEFAULT_VISIBLE_PACKS, ...saved])))
  }, [repo])
  useEffect(() => { const id = setInterval(refreshRuns, 10_000); return () => clearInterval(id) }, [refreshRuns])
  useEffect(() => { setFeedLoading(true); setFeedError(false); getJson<OutputsResponse>('/api/outputs').then(d => setOutputs(d.outputs || [])).catch(() => setFeedError(true)).finally(() => setFeedLoading(false)) }, [feedKey])
  useEffect(() => { if (view === 'strategy' && !strategyLoaded) { getJson<StrategyResponse>('/api/strategy').then(d => { setStrategy(d.content || ''); setStrategyLoaded(true) }).catch(() => { setStrategyError(true); setStrategyLoaded(true) }) } }, [view, strategyLoaded])
  useEffect(() => { if (view === 'mcp' && !mcpLoaded) { getJson<McpResponse>('/api/mcp').then(d => { setMcpServers(d.servers || {}); setMcpLoaded(true) }).catch(() => { setMcpError(true); setMcpLoaded(true) }) } }, [view, mcpLoaded])
  useEffect(() => { if (view === 'soul' && !soulLoaded) { getJson<SoulResponse>('/api/soul').then(d => { setSoul(d.soul?.content || ''); setSoulStyle(d.style?.content || ''); setSoulLoaded(true) }).catch(() => { setSoulError(true); setSoulLoaded(true) }) } }, [view, soulLoaded])
  useEffect(() => { if (view === 'packs' && !packsLoaded) { getJson<PacksResponse>('/api/packs').then(d => { setPacks(d); setPacksLoaded(true) }).catch(() => { setPacksError(true); setPacksLoaded(true) }) } }, [view, packsLoaded])
  // Reset the main content scroll to the top whenever the active view or the
  // selected skill changes, so each screen (Soul, Strategy, a skill, …) opens at the top.
  useEffect(() => { mainScrollRef.current?.scrollTo({ top: 0 }) }, [view, selectedSkill])

  const toggleSkill = async (n: string, en: boolean) => { setBusy(b => ({ ...b, [n]: true })); try { const { ok, data } = await patchJson<SyncResult>('/api/skills', { name: n, enabled: en }); if (ok) { setSkills(s => s.map(sk => sk.name === n ? { ...sk, enabled: en } : sk)); flashSynced(`${displayName(n)} ${en ? 'enabled' : 'disabled'}`, data) } else { flash(`${displayName(n)} update failed`) } } catch { flash('Network error') } finally { setBusy(b => ({ ...b, [n]: false })) } }
  const runSkill = async (n: string, v?: string, sm?: string) => { if (!secrets.some(s => s.isSet && authSecretsForHarness(harness).includes(s.name))) { flash(secretsReadOk ? 'No provider key set - add one in Settings before running skills' : "Couldn't read repo secrets - GitHub API error or gh not authenticated. Retry, or run `gh auth login`."); return } setBusy(b => ({ ...b, [`r-${n}`]: true })); try { const { ok, data } = await postJson<ErrorResponse>(`/api/skills/${n}/run`, { var: v || '', model: sm || model }); if (ok) { flash(`${displayName(n)} started`); scheduleRunRefresh(refreshRuns) } else { flash(data.error || 'Failed') } } finally { setBusy(b => ({ ...b, [`r-${n}`]: false })) } }
  const updateSchedule = async (n: string, s: string) => { try { const { ok, data } = await patchJson<SyncResult>('/api/skills', { name: n, schedule: s }); if (ok) { setSkills(sk => sk.map(x => x.name === n ? { ...x, schedule: s } : x)); flashSynced('Schedule updated', data) } } catch { flash('Network error') } }
  const updateVar = async (n: string, v: string) => { try { const { ok, data } = await patchJson<SyncResult>('/api/skills', { name: n, var: v }); if (ok) { setSkills(s => s.map(x => x.name === n ? { ...x, var: v } : x)); flashSynced('Brief updated', data) } } catch { flash('Network error') } }
  const updateSkillModel = async (n: string, m: string) => { try { const { ok, data } = await patchJson<SyncResult>('/api/skills', { name: n, skillModel: m }); if (ok) { setSkills(s => s.map(x => x.name === n ? { ...x, model: m } : x)); flashSynced('Capability updated', data) } } catch { flash('Network error') } }
  const updateModel = async (m: string) => { setModel(m); try { const { data } = await patchJson<SyncResult>('/api/skills', { model: m }); flashSynced(`Default: ${modelsForHarness(harness).find(x => x.id === m)?.label || m}`, data) } catch { flash('Network error') } }
  // Switch the agent harness. If the current model doesn't belong to the new
  // harness's model set, snap it to that harness's default so the picker + runs
  // stay coherent (persisted in the same PATCH round-trip).
  const updateHarness = async (h: string) => { const hh: Harness = HARNESSES.find(x => x.id === h)?.id ?? 'claude'; setHarness(hh); const list = modelsForHarness(hh); const nextModel = list.some(x => x.id === model) ? undefined : list[0]?.id; if (nextModel) setModel(nextModel); try { const { data } = await patchJson<SyncResult>('/api/skills', { harness: hh, ...(nextModel ? { model: nextModel } : {}) }); flashSynced(`Harness: ${HARNESSES.find(x => x.id === hh)?.label || hh}`, data) } catch { flash('Network error') } }
  const deleteSkill = async (n: string) => { setBusy(b => ({ ...b, [`d-${n}`]: true })); try { const { ok, data } = await del<SyncResult>('/api/skills', { name: n }); if (ok) { setSkills(s => s.filter(x => x.name !== n)); setSelectedSkill(null); flashSynced(`${displayName(n)} removed`, data) } else { flash(`${displayName(n)} removal failed`) } } catch { flash('Network error') } finally { setBusy(b => ({ ...b, [`d-${n}`]: false })) } }
  const syncToGithub = async () => { setSyncing(true); try { const { ok } = await postJson('/api/sync'); if (ok) { flash('Synced'); setHasChanges(false) } else { flash('Sync failed') } } catch { flash('Network error') } finally { setSyncing(false) } }
  // Pull rebases origin/main onto the working tree, so the whole dashboard can be
  // stale afterward. Refetch core data + the feed, and drop cached panel state so
  // strategy/soul/mcp/analytics reload from the freshly-pulled files.
  const pullFromGithub = async () => { setPulling(true); try { const { ok, data } = await postJson<ErrorResponse>('/api/outputs'); if (ok) { flash('Pulled - refreshing'); setAnalyticsData(null); setStrategyLoaded(false); setMcpLoaded(false); setSoulLoaded(false); setFeedKey(k => k + 1); await fetchData() } else { flash(data.error || 'Pull failed') } } finally { setPulling(false) } }
  const setupAuth = async (auth?: string | { key: string, baseUrl?: string, provider?: string }) => { setAuthLoading(true); try { const body = typeof auth === 'string' ? { key: auth } : (auth || {}); const { ok, data } = await postJson<ErrorResponse>('/api/auth', body); if (ok) { flash('Authenticated'); setShowAuthModal(false); fetchData() } else { const msg = typeof data?.error === 'string' ? data.error : (auth ? 'Auth failed' : 'Auto-setup failed'); if (!auth) setShowAuthModal(true); flash(msg) } } finally { setAuthLoading(false) } }
  // Connect the grok harness: no arg captures the local X-account OAuth session
  // (GROK_CREDENTIALS); a key stores XAI_API_KEY instead.
  const setupGrokAuth = async (payload?: { key: string }) => { setGrokLoading(true); try { const { ok, data } = await postJson<ErrorResponse & { harness?: Harness; synced?: boolean }>('/api/grok-auth', payload || {}); if (ok) { if (data?.harness === 'grok') { setHarness('grok'); flashSynced('X account connected - harness set to grok', data) } else { if (payload?.key) markSecretSet('XAI_API_KEY'); flash(payload?.key ? 'XAI_API_KEY saved' : 'X account connected') } setShowAuthModal(false); fetchData() } else { flash(typeof data?.error === 'string' ? data.error : 'Grok connect failed') } } finally { setGrokLoading(false) } }
  // Native auth for codex/pi/vibe/kimi (the /api/harness-auth parallel to grok):
  // no arg = OAuth capture (codex→ChatGPT, kimi→device), which also switches the
  // repo to that harness; {key} = a provider key stored under its own secret.
  const setupHarnessAuth = async (targetHarness: string, payload?: { key: string }) => { setHarnessAuthLoading(true); try { const { ok, data } = await postJson<ErrorResponse & { harness?: Harness; method?: string; secret?: string; synced?: boolean }>('/api/harness-auth', { harness: targetHarness, ...(payload || {}) }); if (ok) { if (data?.method === 'oauth' && data?.harness) { setHarness(data.harness); flashSynced(`${data.harness} connected - harness set`, data) } else { if (data?.secret) markSecretSet(data.secret); flash(`${data?.secret || 'Key'} saved`) } setShowAuthModal(false); fetchData() } else { flash(typeof data?.error === 'string' ? data.error : 'Connect failed') } } finally { setHarnessAuthLoading(false) } }
  const saveSecret = async (n: string, value: string) => { setBusy(b => ({ ...b, [`sec-${n}`]: true })); try { const { ok } = await postJson('/api/secrets', { name: n, value }); if (ok) { markSecretSet(n); flash(`${n} saved`) } } finally { setBusy(b => ({ ...b, [`sec-${n}`]: false })) } }
  const deleteSecret = async (n: string) => { setBusy(b => ({ ...b, [`sec-${n}`]: true })); try { const { ok } = await del('/api/secrets', { name: n }); if (ok) { setSecrets(s => s.map(x => x.name === n ? { ...x, isSet: false } : x)); flash(`${n} removed`) } } finally { setBusy(b => ({ ...b, [`sec-${n}`]: false })) } }
  const importSkill = async (files: UploadFile[], name?: string, category?: string) => { const { ok, data } = await postJson<UploadResponse>('/api/upload', { files, name, category }); if (ok) { flash(`${displayName(data.name)} added`); fetchData() } }
  // Enable/disable a pack's *visibility* (not its skills). Core is always on.
  // Toggling reveals or hides the pack's skills across the sidebar + HQ; it's a
  // view preference, persisted to localStorage, with zero effect on what runs.
  const togglePack = (key: string) => {
    if (DEFAULT_VISIBLE_PACKS.has(key)) return
    setEnabledPacks(prev => {
      const has = prev.includes(key)
      const next = has ? prev.filter(k => k !== key) : [...prev, key]
      try { if (repo) localStorage.setItem(`aeon.enabledPacks:${repo}`, JSON.stringify(next.filter(k => !DEFAULT_VISIBLE_PACKS.has(k)))) } catch {}
      flash(`${PACK_BY_KEY[key]?.label || key} ${has ? 'hidden' : 'revealed'}`)
      return next
    })
  }
  const saveStrategy = async (content: string) => { setStrategySaving(true); try { const { ok, data } = await putJson<SyncResult>('/api/strategy', { content }); if (ok) { setStrategy(content); flashSynced('Strategy saved', data) } else { flash('Save failed') } } finally { setStrategySaving(false) } }
  const buildStrategy = async (sources: StrategySources) => { setStrategyBuilding(true); try { const { ok, data } = await postJson<ErrorResponse>('/api/strategy/build', { ...sources, model }); if (ok) { flash('Strategy-builder started'); scheduleRunRefresh(refreshRuns) } else { flash(data.error || 'Build failed to dispatch') } } finally { setStrategyBuilding(false) } }
  const saveMcp = async (servers: McpServers) => { setMcpSaving(true); try { const { ok, data } = await putJson<SyncResult>('/api/mcp', { servers }); if (ok) { setMcpServers(servers); flashSynced('MCP servers saved', data) } else { flash('Save failed') } } finally { setMcpSaving(false) } }
  const saveSoul = async (file: SoulFile, content: string) => { setSoulSaving(true); try { const { ok, data } = await putJson<SyncResult>('/api/soul', { file, content }); if (ok) { if (file === 'soul') setSoul(content); else setSoulStyle(content); flashSynced(`${file === 'soul' ? 'SOUL.md' : 'STYLE.md'} saved`, data) } else { flash('Save failed') } } finally { setSoulSaving(false) } }
  const buildSoul = async (sources: SoulSources) => { setSoulBuilding(true); try { const { ok, data } = await postJson<ErrorResponse>('/api/soul/build', { ...sources, model }); if (ok) { const label = sources.handle ? `@${sources.handle}` : sources.name || 'your links'; flash(`Soul-builder started for ${label}`); scheduleRunRefresh(refreshRuns) } else { flash(data.error || 'Build failed to dispatch') } } finally { setSoulBuilding(false) } }
  const installSoulExample = async (key: string) => { setSoulInstalling(key); try { const { ok, data } = await postJson<SoulExampleResponse>('/api/soul/examples', { example: key }); if (ok) { setSoul(data.soul || ''); setSoulStyle(data.style || ''); setSoulLoaded(true); flashSynced(`Installed ${key} soul`, data) } else { flash(data.error || 'Install failed') } } finally { setSoulInstalling(null) } }

  // Jump from a skill's API-keys panel straight to Settings → Access Keys,
  // scrolled to the chosen key with its input open and ready to paste.
  const goToSecret = (name: string) => { setSelectedSkill(null); setView('secrets'); setSecretFocus(name) }
  const goToMcp = () => { setSelectedSkill(null); setView('mcp') }

  // --- Derived ---
  const skill = selectedSkill ? skills.find(s => s.name === selectedSkill) || null : null
  // Any model/provider key set means Aeon can authenticate - the "Auth" CTA hides.
  // Harness-aware: the grok harness needs its OWN auth (X-account session or an
  // xAI key), so a Claude token doesn't count when grok is selected — that's what
  // surfaces the Auth CTA → "Connect X account". Derived from live `secrets`.
  const hasModelKey = secrets.some(s => s.isSet && authSecretsForHarness(harness).includes(s.name))
  // Skills visible across the dashboard = first-party skills whose pack is
  // enabled (Core always on), PLUS every community skill — anything in a pack
  // that isn't first-party was installed from another repo on purpose, so it's
  // never hidden behind the pack lens regardless of its pack key (`installed`,
  // or a per-source pack like `antfleet-pr-review`). The sidebar + HQ render
  // this; the Packs view keeps the full roster so you can enable more.
  const visibleSkills = skills.filter(s => {
    const k = s.pack || 'lab'
    return FIRST_PARTY_KEYS.has(k) ? enabledPacks.includes(k) : true
  })
  const enabledCount = visibleSkills.filter(s => s.enabled).length
  const workingCount = runs.filter(r => r.status === 'in_progress').length

  if (loading) return <LoadingScreen />
  if (error) return <ErrorScreen error={error} />

  return (
    <div className="h-screen flex bg-aeon-bg text-aeon-fg">
      <TargetCursor />
      {toast && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-aeon-fg text-aeon-bg px-5 py-2.5 text-xs font-mono uppercase tracking-[0.18em] shadow-xl">{toast}</div>}

      <LeftSidebar
        view={view} setView={(v) => { setView(v); setSelectedSkill(null) }}
        selectedSkill={selectedSkill}
        skills={visibleSkills} runs={runs} secrets={secrets} repo={repo} harness={harness}
        enabledCount={enabledCount} workingCount={workingCount}
        categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter}
        onSkillSelect={(name) => { setSelectedSkill(name); setView('hq') }}
        onShowImport={() => setShowImport(true)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          skill={skill} view={view} repo={repo} model={model} harness={harness} gateway={gateway}
          hasModelKey={hasModelKey} authLoading={authLoading}
          pulling={pulling} syncing={syncing} hasChanges={hasChanges} behind={behind}
          onSetupAuth={() => setShowAuthModal(true)} onUpdateModel={updateModel} onUpdateHarness={updateHarness}
          onPull={pullFromGithub} onSync={syncToGithub}
        />

        <div ref={mainScrollRef} className="flex-1 overflow-y-auto p-[var(--space-lg)]">
          {view === 'secrets' && !selectedSkill && (
            <SecretsPanel secrets={secrets} skills={skills} busy={busy} repo={repo} harness={harness} focusKey={secretFocus} onFocusHandled={() => setSecretFocus(null)} onSave={saveSecret} onDelete={deleteSecret} onSelectSkill={(name) => { setSelectedSkill(name); setView('hq') }} onConnectClaude={() => setupAuth()} connecting={authLoading} onConnectGrok={() => setupGrokAuth()} grokConnecting={grokLoading} onConnectHarness={(h) => setupHarnessAuth(h)} harnessConnecting={harnessAuthLoading} />
          )}
          {view === 'strategy' && !selectedSkill && (
            strategyError
              ? <PanelError label="strategy" onRetry={() => { setStrategyError(false); setStrategyLoaded(false) }} />
              : <StrategyPanel content={strategy} loading={!strategyLoaded} saving={strategySaving} building={strategyBuilding} onSave={saveStrategy} onBuild={buildStrategy} />
          )}
          {view === 'mcp' && !selectedSkill && (
            mcpError
              ? <PanelError label="MCP servers" onRetry={() => { setMcpError(false); setMcpLoaded(false) }} />
              : <McpPanel harness={harness} servers={mcpServers} loading={!mcpLoaded} saving={mcpSaving} secrets={secrets} busy={busy} onSave={saveMcp} onSetSecret={saveSecret} onDeleteSecret={deleteSecret} onGoToSecret={goToSecret} />
          )}
          {view === 'soul' && !selectedSkill && (
            soulError
              ? <PanelError label="soul" onRetry={() => { setSoulError(false); setSoulLoaded(false) }} />
              : <SoulPanel soul={soul} style={soulStyle} loading={!soulLoaded} saving={soulSaving} building={soulBuilding} installing={soulInstalling} onSave={saveSoul} onBuild={buildSoul} onInstallExample={installSoulExample} />
          )}
          {view === 'hq' && !selectedSkill && (
            <HQOverview skills={visibleSkills} runs={runs} enabledCount={enabledCount} workingCount={workingCount} categoryFilter={categoryFilter} onCategoryClick={(key) => setCategoryFilter(categoryFilter === key ? null : key)} onViewRun={() => {}} onOpenPacks={() => setView('packs')} />
          )}
          {view === 'packs' && !selectedSkill && (
            packsError
              ? <PanelError label="packs" onRetry={() => { setPacksError(false); setPacksLoaded(false) }} />
              : <PacksPanel firstParty={packs?.firstParty ?? []} community={packs?.community ?? []} skills={skills} enabledPacks={enabledPacks} loading={!packsLoaded} busy={busy} onTogglePack={togglePack} onToggleSkill={toggleSkill} onSelectSkill={(name) => { setSelectedSkill(name); setView('hq') }} onInstallPack={(arg) => runSkill('install-skill', arg)} />
          )}
          {skill && (
            <SkillDetail
              skill={skill} runs={runs} model={model} harness={harness} secrets={secrets} mcpServers={mcpServers} busy={busy}
              onToggle={toggleSkill} onRun={runSkill} onDelete={deleteSkill}
              onUpdateSchedule={updateSchedule} onUpdateVar={updateVar} onUpdateModel={updateSkillModel}
              onGoToSecret={goToSecret} onGoToMcp={goToMcp}
              onViewRun={() => {}}
            />
          )}
        </div>
      </div>

      <RightPanel
        runs={runs} outputs={outputs} feedLoading={feedLoading} feedError={feedError} analyticsData={analyticsData} analyticsError={analyticsError}
        onRefresh={() => { fetchData(); setFeedKey(k => k + 1); setAnalyticsData(null); setAnalyticsError(false) }}
        onFetchAnalytics={() => { if (!analyticsData) { setAnalyticsError(false); getJson<AnalyticsData>('/api/analytics').then(d => setAnalyticsData(d)).catch(() => setAnalyticsError(true)) } }}
      />

      {showImport && <ImportModal onClose={() => setShowImport(false)} onImport={importSkill} />}
      {showAuthModal && (harness === 'grok'
        ? <GrokAuthModal loading={grokLoading} onClose={() => setShowAuthModal(false)} onGrokAuth={(p) => setupGrokAuth(p)}
            patSet={secrets.some(s => s.isSet && (s.name === 'GH_SECRETS_PAT' || s.name === 'GH_GLOBAL'))}
            onGoToSecret={(n) => { setShowAuthModal(false); goToSecret(n) }} />
        : HARNESS_AUTH[harness]
        ? <HarnessAuthModal harness={harness} loading={harnessAuthLoading} onClose={() => setShowAuthModal(false)} onHarnessAuth={(p) => setupHarnessAuth(harness, p)} />
        : <AuthModal loading={authLoading} onClose={() => setShowAuthModal(false)} onAuth={(auth) => setupAuth(auth)} />)}
    </div>
  )
}
