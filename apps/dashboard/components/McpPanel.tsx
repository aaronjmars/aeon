'use client'

import { useState, useEffect } from 'react'
import { Scramble } from './ui/Animated'
import { inputCls } from '../lib/utils'
import { MCP_CATALOG } from '../lib/mcp-catalog'
import type { Secret, McpServer, McpServers, Harness } from '../lib/types'

// One-click starters - public HTTP MCP servers that install with no token.
const FEATURED = MCP_CATALOG

// Codex can't call MCP tools in headless runs: under `codex exec` each tool call
// raises an approval prompt that reads EOF on the closed stdin and resolves as
// cancel, so the tool never runs (upstream openai/codex#24135). Wiring a server
// on codex would silently no-op at run time, so the MCP controls are disabled and
// the operator is told to switch harness. Keep in sync with harness-adapter.
const MCP_DISABLED_MSG = "Codex can't run MCP tools in headless runs (openai/codex#24135). Switch the harness to claude, grok, kimi or vibe to use MCP."

interface McpPanelProps {
  harness: Harness
  servers: McpServers
  loading: boolean
  saving: boolean
  secrets: Secret[]
  busy: Record<string, boolean>
  onSave: (servers: McpServers) => void
  onSetSecret: (name: string, value: string) => void
  onDeleteSecret: (name: string) => void
  onGoToSecret: (name: string) => void
}

// The ${VAR} secret references a server needs at runtime.
function refsOf(server: McpServer): string[] {
  const out = new Set<string>()
  const re = /\$\{([A-Z_][A-Z0-9_]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(JSON.stringify(server)))) out.add(m[1])
  return [...out]
}

function describe(server: McpServer): string {
  if (typeof server.url === 'string') return server.url
  if (typeof server.command === 'string') {
    const args = Array.isArray(server.args) ? ' ' + (server.args as string[]).join(' ') : ''
    return server.command + args
  }
  return '-'
}

function transportOf(server: McpServer): string {
  if (typeof server.type === 'string') return server.type
  return typeof server.command === 'string' ? 'stdio' : 'http'
}

export function McpPanel({ harness, servers, loading, saving, secrets, busy, onSave, onSetSecret, onDeleteSecret, onGoToSecret }: McpPanelProps) {
  // Codex can't use MCP headlessly (see MCP_DISABLED_MSG): grey out every MCP
  // action so a run isn't configured to use tools it will silently skip.
  const mcpDisabled = harness === 'codex'

  const [draft, setDraft] = useState<McpServers>(servers)
  useEffect(() => { setDraft(servers) }, [servers])

  // Per-row token entry - set an existing server's referenced secret inline,
  // exactly like a credential row in Settings (paste value → Set → saved to GH).
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({})
  const isSecretSet = (n: string) => secrets.some(s => s.name === n && s.isSet)
  const saveRowSecret = (n: string) => {
    const v = (secretDraft[n] ?? '').trim()
    if (!v) return
    onSetSecret(n, v)
    setSecretDraft(d => ({ ...d, [n]: '' }))
  }

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<'http' | 'stdio'>('http')
  const [url, setUrl] = useState('')
  const [bearerToken, setBearerToken] = useState('')
  const [command, setCommand] = useState('npx')
  const [args, setArgs] = useState('')

  // OAuth connect (featured servers flagged `oauth`): the dashboard drives the
  // browser flow server-side (POST /api/mcp-auth), which captures the tokens as
  // secrets and returns the server descriptor to add. Per-slug busy + error.
  const [oauthBusy, setOauthBusy] = useState<string | null>(null)
  const [oauthError, setOauthError] = useState('')

  // The operator never types a secret name. They paste the bearer token (which
  // IS the secret); we derive the env-var to store it under from the server name.
  const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '')
  const tokenVar = (slug: string) => 'MCP_' + slug.toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '_TOKEN'

  const dirty = JSON.stringify(draft) !== JSON.stringify(servers)
  const names = Object.keys(draft)
  const allRefs = [...new Set(names.flatMap(n => refsOf(draft[n])))]

  const resetForm = () => {
    setAdding(false); setName(''); setUrl(''); setBearerToken(''); setCommand('npx'); setArgs(''); setTransport('http')
  }

  const addServer = () => {
    const slug = slugify(name)
    if (!slug) return
    let server: McpServer
    if (transport === 'http') {
      if (!url.trim()) return
      server = { type: 'http', url: url.trim() }
      if (bearerToken.trim()) {
        // The token IS the secret. Derive its var from the server name, store
        // the value on GH, and reference it in .mcp.json - no name to type.
        const varName = tokenVar(slug)
        server.headers = { Authorization: `Bearer \${${varName}}` }
        onSetSecret(varName, bearerToken.trim())
      }
    } else {
      if (!command.trim()) return
      server = { type: 'stdio', command: command.trim() }
      if (args.trim()) server.args = args.trim().split(/\s+/)
    }
    setDraft({ ...draft, [slug]: server })
    resetForm()
  }

  // A credential this panel minted for a server is stored as MCP_<SLUG>_TOKEN.
  const isMcpToken = (r: string) => /^MCP_[A-Z0-9_]+_TOKEN$/.test(r)

  // One-click install a featured server: add it to .mcp.json and persist
  // immediately (same as Save). Public / OAuth / x402 servers need no token; a
  // server with `authSecret` installs with an `Authorization: Bearer ${VAR}`
  // header, and the per-row paste-token box below collects the key (runs skip
  // MCP with a warning until it's set, same as any unset ref).
  const isFeaturedInstalled = (url: string) => Object.values(draft).some(s => s.url === url)
  const installFeatured = (f: typeof FEATURED[number]) => {
    if (isFeaturedInstalled(f.url)) return
    if (f.oauth) { connectOAuth(f); return }
    const slug = draft[f.slug] ? `${f.slug}-mcp` : f.slug
    const server: McpServer = { type: f.transport ?? 'http', url: f.url }
    if (f.authSecret) server.headers = { Authorization: `Bearer \${${f.authSecret}}` }
    const next = { ...draft, [slug]: server }
    setDraft(next)
    onSave(next)
  }

  // Run the browser OAuth flow for a featured server, then add the returned
  // descriptor via the normal save path. The tokens are captured + stored
  // server-side; the panel never sees them.
  const connectOAuth = async (f: typeof FEATURED[number]) => {
    const slug = draft[f.slug] ? `${f.slug}-mcp` : f.slug
    setOauthBusy(f.slug); setOauthError('')
    try {
      const res = await fetch('/api/mcp-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, url: f.url, name: f.name, scopes: f.oauthScopes, clientId: f.oauthClientId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `Connect failed (${res.status})`)
      const next = { ...draft, [slug]: data.server as McpServer }
      setDraft(next)
      onSave(next)
      if (data.warning) setOauthError(`Connected, but: ${data.warning}`)
    } catch (e) {
      setOauthError(e instanceof Error ? e.message : 'OAuth connect failed')
    } finally {
      setOauthBusy(null)
    }
  }

  const removeServer = (n: string) => {
    const next = { ...draft }; delete next[n]
    // Any MCP token this server owned that nothing else references is now orphaned
    // on GitHub - delete it so removing a server actually removes its credentials.
    // Only touch panel-minted MCP_*_TOKEN secrets, never shared/builtin ones.
    const stillUsed = new Set(Object.values(next).flatMap(refsOf))
    const orphans = refsOf(draft[n]).filter(r => isMcpToken(r) && !stillUsed.has(r) && isSecretSet(r))
    if (orphans.length && !confirm(`Remove server "${n}" and delete its credential${orphans.length === 1 ? '' : 's'} (${orphans.join(', ')}) from GitHub?`)) return
    orphans.forEach(onDeleteSecret)
    setDraft(next)
  }

  return (
    <div className="max-w-5xl mx-auto pb-16 space-y-8">
      <section className="relative overflow-hidden border border-[rgba(250,250,250,0.10)] bg-aeon-panel">
        <div className="dither" aria-hidden="true" />
        <div className="relative z-10 px-8 pt-10 pb-8">
          <h1 className="font-display uppercase leading-[0.92] tracking-tight text-aeon-fg"
              style={{ fontSize: 'clamp(40px, 6.5vw, 88px)' }}>
            <Scramble text="MCP" />{' '}
            <span className="text-aeon-red"><Scramble text="SERVERS" delay={160} /></span>
          </h1>
          <p className="mt-4 max-w-xl text-sm text-primary-70 leading-relaxed">
            Servers your skills can <span className="text-primary-100">call</span> during a run - GitHub, a database,
            a paid API.
          </p>
        </div>
      </section>

      {mcpDisabled && (
        <div className="border border-aeon-red/40 bg-aeon-panel px-[var(--space-md)] py-[var(--space-sm)]">
          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-aeon-red mb-1.5">⚠ MCP is unavailable on the Codex harness</p>
          <p className="text-[11px] text-primary-40 leading-relaxed">
            {MCP_DISABLED_MSG} You can still view your servers below, but the actions are disabled until you switch harness in the top bar.
          </p>
        </div>
      )}

      <section className="border-t border-[rgba(250,250,250,0.10)] pt-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="font-display text-[13px] tracking-[0.18em] text-aeon-red uppercase">Featured</span>
          <span className="flex-1 h-px bg-[rgba(250,250,250,0.10)]" />
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary-35">one-click install</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURED.map(f => {
            const installed = isFeaturedInstalled(f.url)
            return (
              <div key={f.slug} className="border border-[rgba(250,250,250,0.10)] bg-aeon-panel px-[var(--space-md)] py-[var(--space-sm)] flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.logo} alt={f.name} width={36} height={36} className="w-9 h-9 rounded object-cover bg-aeon-bg shrink-0 border border-[rgba(250,250,250,0.10)]" />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs text-primary-100">{f.name}</div>
                  <div className="text-[11px] text-primary-40 font-mono truncate">{f.url}</div>
                </div>
                {installed ? (
                  <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-aeon-green shrink-0">✓ installed</span>
                ) : (
                  <button onClick={() => installFeatured(f)} disabled={saving || oauthBusy === f.slug || mcpDisabled} className="btn-mini-go shrink-0" title={mcpDisabled ? MCP_DISABLED_MSG : f.oauth ? 'Opens your browser to authorize, then stores the tokens' : undefined}>
                    {oauthBusy === f.slug ? 'Connecting…' : f.oauth ? 'Connect' : 'Install'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {oauthError && <p className="mt-3 text-[11px] font-mono text-aeon-red">{oauthError}</p>}
        {/* Secrets-PAT setup section. OAuth providers rotate their refresh token
            on every run; the runner can only save each rotation back if a
            secrets-write PAT is set. Without one, an OAuth MCP server works for
            exactly one run after Connect and then its auth breaks. Shown until
            GH_SECRETS_PAT (or repo-wide GH_GLOBAL) exists; hidden once set. */}
        {!(isSecretSet('GH_SECRETS_PAT') || isSecretSet('GH_GLOBAL')) && (
          <div className="mt-3 border border-[rgba(250,250,250,0.10)] bg-aeon-panel px-[var(--space-md)] py-[var(--space-sm)]">
            <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-aeon-red mb-1.5">⚠ OAuth MCP servers won&apos;t keep working without a secrets PAT</p>
            <p className="text-[11px] text-primary-40 leading-relaxed">
              Providers rotate their refresh token on every run, and the runner needs a secrets-write credential to save each rotation — without it a Connected server works once, then its auth breaks. To set it up: create a fine-grained PAT at <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener noreferrer" className="text-primary-70 underline decoration-dotted underline-offset-2 hover:text-aeon-fg transition-colors">github.com/settings/personal-access-tokens</a>, add this repo under <span className="text-primary-70">Repository access</span>, grant <span className="text-primary-70">Secrets: Read and write</span>, and save it as{' '}
              <button onClick={() => onGoToSecret('GH_SECRETS_PAT')} title="Open in Settings to set this key" className="text-aeon-red-alert underline decoration-dotted underline-offset-2 hover:text-aeon-fg transition-colors">GH_SECRETS_PAT</button>
              {' '}in Settings. Already Connected a server? Re-connect it once after adding the PAT.
            </p>
          </div>
        )}
      </section>

      <section className="border-t border-[rgba(250,250,250,0.10)] pt-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="font-display text-[13px] tracking-[0.18em] text-aeon-red uppercase">.mcp.json</span>
          <span className="flex-1 h-px bg-[rgba(250,250,250,0.10)]" />
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary-35">{names.length} server{names.length === 1 ? '' : 's'}</span>
        </div>

        {loading ? (
          <div className="text-xs font-mono text-primary-40 py-8">Loading…</div>
        ) : (
          <>
            {names.length > 0 ? (
              <div className="border border-[rgba(250,250,250,0.10)] divide-y divide-[rgba(250,250,250,0.08)]">
                {names.map(n => {
                  const s = draft[n]
                  const refs = refsOf(s)
                  return (
                    <div key={n} className="px-[var(--space-md)] py-[var(--space-sm)] flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-primary-100">{n}</span>
                          <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-primary-40 border border-[rgba(250,250,250,0.12)] px-1.5 py-0.5">{transportOf(s)}</span>
                        </div>
                        <div className="text-[11px] text-primary-40 font-mono truncate mt-0.5">{describe(s)}</div>
                        {refs.length > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {refs.map(r => {
                              const ok = isSecretSet(r)
                              const pending = !!busy[`sec-${r}`]
                              return (
                                <div key={r} className="flex items-center gap-2">
                                  <span className={`text-[10px] font-mono border px-1.5 py-0.5 shrink-0 ${ok ? 'text-aeon-green border-aeon-green/30' : 'text-aeon-red border-aeon-red/30'}`}>${'{'}{r}{'}'}</span>
                                  {ok ? (
                                    <span className="text-[10px] font-mono text-aeon-green">✓ set</span>
                                  ) : pending ? (
                                    <span className="text-[10px] font-mono text-primary-40">setting…</span>
                                  ) : (
                                    <>
                                      <input type="password" value={secretDraft[r] ?? ''} onChange={e => setSecretDraft(d => ({ ...d, [r]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && saveRowSecret(r)} placeholder="paste bearer token - saved to GitHub & wired in" className="flex-1 min-w-0 bg-aeon-bg border border-[rgba(250,250,250,0.10)] px-2 py-1 text-[11px] font-mono text-primary-100 outline-none focus:border-aeon-red transition-colors cursor-target" />
                                      <button onClick={() => saveRowSecret(r)} disabled={!(secretDraft[r] ?? '').trim() || mcpDisabled} title={mcpDisabled ? MCP_DISABLED_MSG : undefined} className="btn-mini-go shrink-0">Set</button>
                                    </>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                      <button onClick={() => removeServer(n)} className="btn-mini-danger shrink-0">Remove</button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-xs font-mono text-primary-40 py-6 border border-dashed border-[rgba(250,250,250,0.10)] text-center">No servers yet. Add one below.</div>
            )}

            {/* Add form */}
            <div className="mt-4">
              {adding ? (
                <div className="border border-[rgba(250,250,250,0.10)] p-[var(--space-md)] space-y-3">
                  <div className="flex gap-2">
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="server name (e.g. github)" autoFocus className={inputCls} />
                    <div className="flex shrink-0 border border-[rgba(250,250,250,0.10)]">
                      {(['http', 'stdio'] as const).map(t => (
                        <button key={t} onClick={() => setTransport(t)}
                          className={`text-[11px] font-mono uppercase tracking-[0.14em] px-3 py-2 transition-colors ${transport === t ? 'bg-aeon-red text-white' : 'text-primary-40 hover:text-primary-70'}`}>{t}</button>
                      ))}
                    </div>
                  </div>
                  {transport === 'http' ? (
                    <>
                      <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://mcp.example.com/v1" className={inputCls} />
                      <input type="password" value={bearerToken} onChange={e => setBearerToken(e.target.value)} placeholder="bearer token (optional) - paste it, saved to GitHub & wired in" className={inputCls} />
                      {bearerToken.trim() && slugify(name) && (
                        <p className="text-[10px] font-mono text-primary-40 px-0.5">→ stored as secret <span className="text-primary-70">{tokenVar(slugify(name))}</span>, referenced from this server in <span className="text-primary-70">.mcp.json</span></p>
                      )}
                    </>
                  ) : (
                    <>
                      <input value={command} onChange={e => setCommand(e.target.value)} placeholder="command (e.g. npx)" className={inputCls} />
                      <input value={args} onChange={e => setArgs(e.target.value)} placeholder="args, space-separated (e.g. -y @modelcontextprotocol/server-sequential-thinking)" className={inputCls} />
                    </>
                  )}
                  <div className="flex gap-2">
                    <button onClick={addServer} className="btn-mini-go">Add server</button>
                    <button onClick={resetForm} className="btn-mini">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setAdding(true)} disabled={mcpDisabled} title={mcpDisabled ? MCP_DISABLED_MSG : undefined} className="w-full text-sm font-mono uppercase tracking-[0.14em] text-primary-60 border border-dashed border-[rgba(250,250,250,0.16)] py-3.5 hover:text-aeon-red hover:border-aeon-red/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-primary-60 disabled:hover:border-[rgba(250,250,250,0.16)]">+ Add server</button>
              )}
            </div>

            {/* Footer: secrets reminder + save */}
            {allRefs.some(r => !isSecretSet(r)) && (
              <p className="mt-5 text-[11px] text-primary-40 leading-relaxed">
                <span className="text-aeon-red">Secrets:</span> paste each unset token in the box on its server above - it saves straight to GitHub
                and the runner wires it into every run automatically. Until set, runs skip MCP rather than fail.
              </p>
            )}
            <div className="flex items-center justify-end mt-4">
              <div className="flex items-center gap-2">
                {dirty && <button onClick={() => setDraft(servers)} className="btn-mini">Revert</button>}
                <button onClick={() => onSave(draft)} disabled={!dirty || saving || mcpDisabled} title={mcpDisabled ? MCP_DISABLED_MSG : undefined} className="btn-mini-go">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
