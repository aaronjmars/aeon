'use client'

import { useEffect, useState } from 'react'
import type { Run, SkillOutput, AnalyticsData } from '../lib/types'
import type { RunLogs } from '../lib/runs'
import { timeAgo, runStatusColor, runStatusGlyph } from '../lib/utils'
import { SpecNode } from './SpecNode'
import { PanelError } from './PanelError'

// The Activity and Runs tabs render the same row; only their empty-state copy differs.
function RunRow({ run, onView }: { run: Run; onView: (run: Run) => void }) {
  return (
    <button onClick={() => onView(run)}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 border-b border-[rgba(250,250,250,0.04)] hover:bg-aeon-bg transition-colors text-left">
      <span className={`text-xs ${runStatusColor(run)}`}>{runStatusGlyph(run)}</span>
      <span className="text-xs text-primary-70 truncate flex-1 font-mono">{run.workflow}</span>
      <span className="text-[11px] text-primary-35 font-mono tabular-nums">{timeAgo(run.created_at)}</span>
    </button>
  )
}

interface RightPanelProps {
  runs: Run[]
  outputs: SkillOutput[]
  feedLoading: boolean
  feedError: boolean
  analyticsData: AnalyticsData | null
  analyticsError: boolean
  onRefresh: () => void
  onFetchAnalytics: () => void
}

export function RightPanel({ runs, outputs, feedLoading, feedError, analyticsData, analyticsError, onRefresh, onFetchAnalytics }: RightPanelProps) {
  const [rightTab, setRightTab] = useState<'feed' | 'runs' | 'analytics'>('feed')
  const [selectedRun, setSelectedRun] = useState<Run | null>(null)
  const [runLogs, setRunLogs] = useState('')
  const [runSummary, setRunSummary] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [showFullLogs, setShowFullLogs] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  // Restore the collapsed state on mount (set in an effect, not the initializer,
  // to avoid an SSR/client hydration mismatch).
  useEffect(() => {
    if (localStorage.getItem('aeon-panel-collapsed') === '1') setCollapsed(true)
  }, [])

  const toggleCollapsed = (next: boolean) => {
    setCollapsed(next)
    try { localStorage.setItem('aeon-panel-collapsed', next ? '1' : '0') } catch {}
  }

  const viewRunLogs = async (run: Run) => {
    setSelectedRun(run); setRunLogs(''); setRunSummary(''); setShowFullLogs(false); setLogsLoading(true); setRightTab('runs')
    try { const r = await fetch(`/api/runs/${run.id}/logs`); if (r.ok) { const d = await r.json() as RunLogs; setRunSummary(d.summary || ''); setRunLogs(d.logs || '') } } catch { setRunLogs('Failed') } finally { setLogsLoading(false) }
  }

  // Collapsed: a thin rail with an expand control and a vertical label.
  if (collapsed) {
    return (
      <div className="w-9 border-l border-[rgba(250,250,250,0.10)] flex flex-col items-center shrink-0 bg-aeon-panel">
        <button
          onClick={() => toggleCollapsed(false)}
          title="Expand panel"
          aria-label="Expand panel"
          className="h-12 w-full flex items-center justify-center text-sm text-primary-40 hover:text-aeon-fg transition-colors shrink-0 border-b border-[rgba(250,250,250,0.10)]"
        >&#8249;</button>
        <button
          onClick={() => toggleCollapsed(false)}
          title="Expand panel"
          aria-label="Expand panel"
          className="flex-1 w-full flex items-start justify-center pt-4 group"
        >
          <span className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary-35 group-hover:text-primary-70 transition-colors [writing-mode:vertical-rl]">Feed · Runs · Analytics</span>
        </button>
      </div>
    )
  }

  return (
    <div className="w-[288px] border-l border-[rgba(250,250,250,0.10)] flex flex-col shrink-0 bg-aeon-panel">
      <div className="h-12 border-b border-[rgba(250,250,250,0.10)] flex items-center px-3 gap-1 shrink-0">
        {(['feed', 'runs', 'analytics'] as const).map(tab => (
          <button key={tab} onClick={() => { setRightTab(tab); if (tab === 'analytics') onFetchAnalytics() }}
            className={`text-[11px] px-2.5 py-1.5 transition-colors font-mono uppercase tracking-[1px] ${rightTab === tab ? 'bg-aeon-fg text-aeon-bg' : 'text-primary-40 hover:text-primary-70'}`}>{tab}</button>
        ))}
        <button onClick={onRefresh} title="Refresh" aria-label="Refresh" className="text-sm leading-none text-primary-35 hover:text-aeon-red transition-colors ml-auto">&#8635;</button>
        <button
          onClick={() => toggleCollapsed(true)}
          title="Collapse panel"
          aria-label="Collapse panel"
          className="text-sm leading-none text-primary-35 hover:text-aeon-fg transition-colors ml-2 px-0.5"
        >&#8250;</button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* Feed */}
        {rightTab === 'feed' && (
          feedLoading ? <div className="flex justify-center py-12"><div className="w-2 h-2 rounded-full bg-aeon-red animate-pulse" /></div> :
          feedError ? <PanelError label="the feed" onRetry={onRefresh} /> :
          outputs.length > 0 ? (
          <div className="space-y-3 p-3">
            {outputs.map(o => (
              <div key={o.filename} className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[11px] font-mono text-aeon-red">{o.skill}</span>
                  <span className="text-[11px] text-primary-35 font-mono">{timeAgo(o.timestamp)}</span>
                </div>
                {o.spec?.root && o.spec?.elements ? <SpecNode id={o.spec.root} elements={o.spec.elements} /> : null}
              </div>
            ))}
          </div>
          ) : (
          <div>
            {!runs.length ? <div className="px-4 py-12 text-center text-xs text-primary-35 font-mono">No activity yet</div> :
              runs.map(run => <RunRow key={run.id} run={run} onView={viewRunLogs} />)}
          </div>
          )
        )}

        {/* Runs */}
        {rightTab === 'runs' && (
          selectedRun ? (
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[rgba(250,250,250,0.10)]">
                <button onClick={() => { setSelectedRun(null); setRunLogs(''); setRunSummary('') }} className="text-primary-40 hover:text-primary-100 text-xs">&larr;</button>
                <span className="font-mono text-xs text-primary-70 truncate flex-1">{selectedRun.workflow}</span>
                <a href={selectedRun.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary-40 font-mono border border-[rgba(250,250,250,0.10)] px-2 py-0.5 hover:border-aeon-red hover:text-aeon-red transition-colors">GitHub</a>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {logsLoading ? <div className="flex justify-center py-8"><div className="w-2 h-2 rounded-full bg-aeon-red animate-pulse" /></div> : (
                  <div className="space-y-3">
                    {runSummary ? (
                      <>
                        <pre className="text-[11px] leading-relaxed font-mono text-primary-70 whitespace-pre-wrap break-words">{runSummary.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/gm, '')}</pre>
                        <button onClick={() => setShowFullLogs(!showFullLogs)} className="text-[11px] text-primary-40 hover:text-aeon-red font-mono transition-colors">{showFullLogs ? '- Hide full logs' : '+ Show full logs'}</button>
                        {showFullLogs && <pre className="text-[11px] font-mono text-primary-50 whitespace-pre-wrap break-words border-t border-[rgba(250,250,250,0.10)] pt-3">{runLogs.replace(/\x1b\[[0-9;]*m/g, '')}</pre>}
                      </>
                    ) : (
                      <pre className="text-[11px] font-mono text-primary-50 whitespace-pre-wrap break-words">{runLogs.replace(/\x1b\[[0-9;]*m/g, '')}</pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              {!runs.length ? <div className="px-4 py-12 text-center text-xs text-primary-35 font-mono">No runs</div> :
                runs.map(run => <RunRow key={run.id} run={run} onView={viewRunLogs} />)}
            </div>
          )
        )}

        {/* Analytics */}
        {rightTab === 'analytics' && (
          analyticsError ? <PanelError label="analytics" onRetry={onFetchAnalytics} /> :
          !analyticsData ? <div className="flex justify-center py-12"><div className="w-2 h-2 rounded-full bg-aeon-red animate-pulse" /></div> : (
            <div className="p-3 space-y-4">
              <div className="grid grid-cols-2 gap-[var(--space-xs)]">
                <div className="card-hst p-3"><div className="text-label">Runs</div><div className="font-display text-2xl mt-1">{analyticsData.summary.totalRuns}</div></div>
                <div className="card-hst p-3"><div className="text-label">Success</div><div className={`font-display text-2xl mt-1 ${analyticsData.summary.overallSuccessRate >= 80 ? 'text-aeon-green' : analyticsData.summary.overallSuccessRate >= 50 ? 'text-aeon-amber' : 'text-aeon-red-alert'}`}>{analyticsData.summary.overallSuccessRate}%</div></div>
              </div>
              {analyticsData.insights.length > 0 && (
                <div className="space-y-1.5">
                  {analyticsData.insights.map((ins, i) => (
                    <div key={i} className={`text-[11px] font-mono px-3 py-2 border ${ins.type === 'warning' ? 'text-aeon-red bg-aeon-red/10 border-aeon-red/30' : ins.type === 'success' ? 'text-aeon-green bg-aeon-green/10 border-aeon-green/30' : 'text-primary-70 bg-white/5 border-white/15'}`}>{ins.message}</div>
                  ))}
                </div>
              )}
              <div className="space-y-1">
                {analyticsData.skills.map(s => (
                  <div key={s.name} className="flex items-center gap-2 py-1">
                    <span className={`text-xs w-3 text-center ${s.lastConclusion === 'success' ? 'text-aeon-green' : s.lastConclusion === 'failure' ? 'text-aeon-red-alert' : 'text-primary-35'}`}>
                      {s.lastConclusion === 'success' ? '\u2713' : s.lastConclusion === 'failure' ? '\u2717' : '\u00b7'}
                    </span>
                    <span className="font-mono text-[11px] text-primary-70 w-28 truncate">{s.name}</span>
                    <div className="flex-1 h-2 bg-aeon-bg overflow-hidden flex">
                      {s.success > 0 && <div className="bg-aeon-green/60 h-full" style={{ width: `${(s.success / Math.max(...analyticsData.skills.map(sk => sk.total), 1)) * 100}%` }} />}
                      {s.failure > 0 && <div className="bg-aeon-red-alert/40 h-full" style={{ width: `${(s.failure / Math.max(...analyticsData.skills.map(sk => sk.total), 1)) * 100}%` }} />}
                    </div>
                    <span className={`text-[10px] font-mono tabular-nums w-8 text-right ${s.successRate >= 80 ? 'text-aeon-green' : s.successRate >= 50 ? 'text-aeon-amber' : 'text-aeon-red-alert'}`}>{s.successRate}%</span>
                  </div>
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
