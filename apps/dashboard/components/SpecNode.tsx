import type { SpecElement } from '../lib/types'

// The feed panel is a fixed ~288px column. Two problems used to push content out
// of its card:
//  1. Long unbreakable strings (prices like 0.00002483, $268.0K, @handles, URLs)
//     have a min-content width wider than their track. `hard` (overflow-wrap:
//     anywhere) lets them break mid-token; `soft` (break-words) wraps ordinary
//     prose/labels at spaces only so words aren't split into "PRIC E".
//  2. A fixed N-column Grid of Stats can't fit N usable cells in 288px, so it
//     either overflowed (old bug) or crushed each cell to a sliver. The Grid is
//     now responsive: cells keep a usable min width and surplus columns wrap to
//     the next row. `min-w-0` on flex/grid items lets them shrink instead of
//     forcing the row wider than the card.
const hard = '[overflow-wrap:anywhere] break-words'
const soft = 'break-words'

export function SpecNode({ id, elements }: { id: string; elements: Record<string, SpecElement> }) {
  const el = elements[id]; if (!el) return null
  const p = (el.props || {}) as Record<string, string | number | boolean | string[][] | string[] | undefined>
  const kids = el.children?.map(cid => <SpecNode key={cid} id={cid} elements={elements} />)
  switch (el.type) {
    case 'Card': return (<div className="card-hst p-[var(--space-md)] min-w-0 overflow-hidden">{(p.title || p.description) && <div className="mb-3 min-w-0">{p.title && <h3 className={`font-display text-lg text-primary-100 ${soft}`}>{String(p.title)}</h3>}{p.description && <p className={`text-xs text-primary-50 mt-0.5 ${soft}`}>{String(p.description)}</p>}</div>}<div className="space-y-3 min-w-0">{kids}</div></div>)
    case 'Stack': return <div className={`flex ${p.direction === 'horizontal' ? 'flex-row' : 'flex-col'} ${p.gap === 'lg' ? 'gap-[var(--space-lg)]' : p.gap === 'sm' ? 'gap-[var(--space-xs)]' : 'gap-[var(--space-sm)]'} min-w-0 [&>*]:min-w-0`}>{kids}</div>
    // auto-fit + a min track width means the requested column count is a target, not
    // a mandate: cells that can't reach the min width wrap to a new row instead of
    // being crushed. The min is content-aware - driven by the widest Stat value in
    // the grid - so a row of long-number stats (e.g. $0.000002025) collapses to a
    // single full-width column where the value fits on one line, instead of three
    // narrow columns each wrapping the number one character per line. Short-value
    // grids keep their columns. `min(100%, …)` keeps a single wide child in-box.
    case 'Grid': {
      const cols = typeof p.columns === 'number' ? p.columns : 2
      let maxLen = 0
      const visit = (cid: string) => { const c = elements[cid]; if (!c) return; if (c.type === 'Stat') { const v = String((c.props as Record<string, unknown> | undefined)?.value ?? ''); if (v.length > maxLen) maxLen = v.length } c.children?.forEach(visit) }
      el.children?.forEach(visit)
      const base = cols >= 3 ? 92 : 120
      const min = Math.min(260, Math.max(base, maxLen ? maxLen * 13 + 24 : base))
      return <div className="grid gap-[var(--space-sm)] min-w-0 [&>*]:min-w-0" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))` }}>{kids}</div>
    }
    case 'Heading': { const cls = p.level === 'h1' ? 'font-display text-2xl' : p.level === 'h2' ? 'font-display text-lg' : 'font-display text-sm text-primary-70'; return <div className={`${cls} ${soft}`}>{String(p.text || '')}</div> }
    case 'Text': { const cls = p.variant === 'caption' ? 'text-micro text-primary-40' : p.variant === 'muted' ? 'text-xs text-primary-50' : p.variant === 'lead' ? 'text-sm text-primary-70' : 'text-xs text-primary-70'; return <p className={`${cls} ${soft}`}>{String(p.text || '')}</p> }
    case 'Badge': { const v = p.variant || 'default'; const cls = v === 'destructive' ? 'bg-aeon-red-alert/10 text-aeon-red-alert border-aeon-red-alert/30' : v === 'secondary' ? 'bg-aeon-bg text-primary-50 border-[rgba(250,250,250,0.08)]' : 'bg-aeon-green/10 text-aeon-green border-aeon-green/30'; return <span className={`inline-block max-w-full text-[11px] px-2 py-0.5 border font-mono ${soft} ${cls}`}>{String(p.text || '')}</span> }
    case 'Table': { const columns = (p.columns || []) as string[]; const rows = (p.rows || []) as string[][]; return (<div className="overflow-x-auto"><table className="w-full text-[11px] font-mono"><thead><tr>{columns.map((c, i) => <th key={i} className="text-left text-primary-40 font-medium px-2 py-1.5 border-b border-[rgba(250,250,250,0.08)]">{c}</th>)}</tr></thead><tbody>{rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci} className={`px-2 py-1.5 text-primary-70 border-b border-[rgba(250,250,250,0.04)] ${hard}`}>{cell}</td>)}</tr>)}</tbody></table></div>) }
    case 'Stat': { const trend = p.trend as string | undefined; const dc = trend === 'up' ? 'text-aeon-green' : trend === 'down' ? 'text-aeon-red' : 'text-primary-50'; return (<div className="bg-aeon-bg p-3 min-w-0 overflow-hidden">{p.label && <div className={`text-label mb-1 ${soft}`}>{String(p.label)}</div>}<div className={`font-display text-xl text-primary-100 leading-tight ${hard}`}>{String(p.value || '')}</div>{p.delta && <div className={`text-xs font-mono ${dc} ${hard}`}>{String(p.delta)}</div>}</div>) }
    case 'Progress': { const pct = Math.min(100, (Number(p.value || 0) / Number(p.max || 100)) * 100); return (<div className="min-w-0">{p.label && <div className={`text-label mb-1.5 ${soft}`}>{String(p.label)}</div>}<div className="progress-bar"><div className="progress-bar-fill" style={{ width: `${pct}%` }} /></div></div>) }
    case 'TweetCard': return (<div className="card-hst p-3 min-w-0 overflow-hidden">{p.author && <div className="flex items-center gap-1.5 mb-1 min-w-0"><span className={`text-xs font-medium text-primary-100 ${soft}`}>{String(p.author)}</span>{p.handle && <span className={`text-[11px] text-primary-40 ${hard}`}>{String(p.handle)}</span>}</div>}<p className={`text-xs text-primary-70 leading-relaxed ${soft}`}>{String(p.text || '')}</p>{(p.likes || p.retweets) && <div className="flex gap-3 mt-1.5 text-[11px] text-primary-40 font-mono">{p.likes && <span>{String(p.likes)} likes</span>}{p.retweets && <span>{String(p.retweets)} RTs</span>}</div>}</div>)
    case 'StoryLink': return (<a href={String(p.href || '#')} target="_blank" rel="noopener noreferrer" className="block card-hst card-hst-orange p-3 min-w-0 overflow-hidden"><div className={`text-xs text-primary-100 ${soft}`}>{String(p.title || '')}</div><div className="flex gap-2 mt-0.5 text-[11px] text-primary-40 font-mono min-w-0">{p.source && <span className={hard}>{String(p.source)}</span>}{p.score && <span>{String(p.score)}</span>}</div></a>)
    case 'Link': return <a href={String(p.href || '#')} target="_blank" rel="noopener noreferrer" className={`block text-xs text-aeon-red hover:underline underline-offset-2 font-mono ${hard}`}>{String(p.label || p.href || '')}</a>
    case 'Alert': { const t = p.type || 'info'; const cls = t === 'error' ? 'border-aeon-red-alert/30 bg-aeon-red-alert/10 text-aeon-red-alert' : t === 'warning' ? 'border-aeon-amber/30 bg-aeon-amber/10 text-aeon-amber' : t === 'success' ? 'border-aeon-green/30 bg-aeon-green/10 text-aeon-green' : 'border-white/15 bg-white/5 text-primary-70'; return (<div className={`p-3 border min-w-0 overflow-hidden ${cls}`}>{p.title && <div className={`text-xs font-bold mb-0.5 ${soft}`}>{String(p.title)}</div>}{p.message && <div className={`text-[11px] opacity-80 ${soft}`}>{String(p.message)}</div>}</div>) }
    case 'Separator': return <div className="warning-stripes" />
    default: return null
  }
}
