'use client'

import { useState } from 'react'
import { inputCls } from '../lib/utils'

// Grok Build harness auth. Two ways in:
//  - "Connect X account": one-click OAuth (runs `grok login --device-auth`, opens
//    the browser, captures ~/.grok/auth.json → GROK_CREDENTIALS). Parallels the
//    Claude subscription one-click.
//  - Paste an xAI API key (xai-…) → stored as XAI_API_KEY.
// Both post to /api/grok-auth.
interface GrokAuthModalProps {
  loading: boolean
  onClose: () => void
  onGrokAuth: (payload?: { key: string }) => void
  // Whether a secrets-write PAT (GH_SECRETS_PAT / GH_GLOBAL) is
  // set - the OAuth session rotates its refresh token and only survives past 6h if
  // the runner can persist each rotation back to GROK_CREDENTIALS. Hides the note once set.
  patSet: boolean
  onGoToSecret: (name: string) => void
}

export function GrokAuthModal({ loading, onClose, onGrokAuth, patSet, onGoToSecret }: GrokAuthModalProps) {
  const [key, setKey] = useState('')
  const submitKey = () => key.trim() && onGrokAuth({ key: key.trim() })

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-aeon-panel border border-[rgba(250,250,250,0.10)] w-full max-w-sm mx-4 p-[var(--space-lg)] shadow-2xl">
        <div className="flex items-center justify-between mb-[var(--space-sm)]">
          <h2 className="font-display text-xl">Grok</h2>
          <button onClick={onClose} className="text-primary-35 hover:text-primary-100 text-lg">&times;</button>
        </div>
        <p className="text-xs text-primary-50 font-mono mb-[var(--space-md)]">Run skills with the grok CLI on your X account. Click below: a browser tab opens to approve on <code className="text-primary-70">accounts.x.ai</code>, and the session is stored for CI. Needs SuperGrok / X Premium+ and the <code className="text-primary-70">grok</code> CLI installed.</p>
        <button onClick={() => onGrokAuth()} disabled={loading} className="w-full bg-aeon-fg text-aeon-bg text-sm py-3 font-mono uppercase tracking-[2px] hover:opacity-90 transition-opacity disabled:opacity-50">
          {loading ? '...' : 'Connect X account'}
        </button>
        {/* Secrets-PAT setup note (parallels McpPanel's). The X-account session
            rotates its refresh token on every run; the runner can only save each
            rotation back with a secrets-write PAT. Without one, a Connected account
            works ~6h and then its auth breaks. Hidden once GH_SECRETS_PAT / GH_GLOBAL
            is set. */}
        {!patSet && (
          <div className="mt-3 border border-[rgba(250,250,250,0.10)] bg-aeon-panel px-[var(--space-md)] py-[var(--space-sm)]">
            <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-aeon-red mb-1.5">⚠ The X-account session won&apos;t keep working without a secrets PAT</p>
            <p className="text-[11px] text-primary-40 leading-relaxed">
              Grok rotates its refresh token on every run, and the runner needs a secrets-write credential to save each rotation - without it a Connected account works once (~6h), then its auth breaks. To set it up: create a fine-grained PAT at <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener noreferrer" className="text-primary-70 underline decoration-dotted underline-offset-2 hover:text-aeon-fg transition-colors">github.com/settings/personal-access-tokens</a>, add this repo under <span className="text-primary-70">Repository access</span>, grant <span className="text-primary-70">Secrets: Read and write</span>, and save it as{' '}
              <button onClick={() => onGoToSecret('GH_SECRETS_PAT')} title="Open in Settings to set this key" className="text-aeon-red-alert underline decoration-dotted underline-offset-2 hover:text-aeon-fg transition-colors">GH_SECRETS_PAT</button>
              {' '}in Settings. Already Connected? Re-connect once after adding the PAT.
            </p>
          </div>
        )}
        <div className="my-[var(--space-md)] border-t border-[rgba(250,250,250,0.10)]" />
        <p className="text-xs text-primary-50 font-mono mb-[var(--space-md)]">Or use an xAI API key (no browser flow) - also powers the Grok gateway.</p>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitKey()} placeholder="xai-..." className={`${inputCls} mb-[var(--space-md)]`} />
        <button onClick={submitKey} disabled={!key.trim() || loading} className="w-full bg-aeon-panel text-aeon-fg border border-[rgba(250,250,250,0.14)] text-sm py-3 font-mono uppercase tracking-[2px] hover:border-aeon-red transition-colors disabled:opacity-50">{loading ? '...' : 'Save xAI Key'}</button>
      </div>
    </div>
  )
}
