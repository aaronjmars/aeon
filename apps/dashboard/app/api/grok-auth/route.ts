import { NextResponse } from 'next/server'
import { spawn, execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { ghArgsRepo } from '@/lib/gh'
import { syncGatewayProvider, syncHarness } from '@/lib/gateway'
import { errorResponse, requireGh } from '@/lib/http'

// One-click "Connect X account" for the Grok Build (`grok`) harness — the exact
// parallel to the Claude subscription flow (app/api/auth: run `claude
// setup-token`, capture the credential). Because the dashboard runs on the
// operator's own machine, the route can drive the CLI directly.
//
// Two paths:
//  1. key present → store it as the XAI_API_KEY secret (API-key auth; also powers
//     the Grok gateway). No browser flow.
//  2. no key → run `grok login --device-auth`. grok opens the verification URL in
//     the operator's browser ITSELF, so this route must not open it too - doing
//     both is what made Connect spawn two identical accounts.x.ai tabs. We still
//     parse the URL out of grok's live output (never hardcoded - xAI rotates the
//     per-attempt user_code), but only to hand back if the flow fails. On approval
//     grok writes ~/.grok/auth.json; we tar+base64 that into the GROK_CREDENTIALS
//     secret, which scripts/run-grok.sh restores into ~/.grok before each run.
//
// The credential file is ~/.grok/auth.json (confirmed on grok 0.2.106, mode 0600).

const GROK_DIR = '.grok'
const AUTH_FILE = `${GROK_DIR}/auth.json`
// Matches both .../oauth2/device?user_code=XXXX and .../oauth2/device/consent?...
const DEVICE_URL_RE = /https:\/\/accounts\.x\.ai\/oauth2\/device\S*/
const LOGIN_TIMEOUT_MS = 240_000 // ample time to approve in the browser (< Node's 5-min request cap)

// Run `grok login --device-auth` and wait for the operator to approve in the tab
// grok opened. Resolves on approval (exit 0), rejects otherwise, quoting the
// verification URL so an operator whose browser never opened can finish by hand.
function grokLogin(): Promise<void> {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn('grok', ['login', '--device-auth'], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return reject(e)
    }
    let buf = ''
    const onData = (chunk: Buffer) => { buf += chunk.toString() }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    // Read off the whole buffer at failure time rather than latching the first
    // chunk: a chunk boundary mid-URL would otherwise pin a truncated link.
    const verifyUrl = () => buf.match(DEVICE_URL_RE)?.[0] ?? ''

    const timer = setTimeout(() => {
      child.kill()
      const url = verifyUrl()
      reject(new Error(`Timed out waiting for approval. Approve in the browser and click Connect again.${url ? ` If no tab opened, visit ${url}` : ''}`))
    }, LOGIN_TIMEOUT_MS)

    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(e.code === 'ENOENT'
        ? new Error('grok CLI not found. Install it: npm i -g @xai-official/grok')
        : e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`grok login exited ${code}. ${buf.slice(-200)}`))
    })
  })
}

export async function POST(request: Request) {
  try {
    const notReady = requireGh()
    if (notReady) return notReady

    const body = (await request.json().catch(() => ({}))) as { key?: string }
    const key = typeof body.key === 'string' ? body.key.trim() : ''

    // Path 1 — API key.
    if (key) {
      execFileSync('gh', ['secret', 'set', 'XAI_API_KEY', ...ghArgsRepo()], {
        input: key,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      await syncGatewayProvider() // XAI_API_KEY is also the Grok gateway secret
      return NextResponse.json({ ok: true, method: 'api-key', secret: 'XAI_API_KEY' })
    }

    // Path 2 — one-click OAuth. Runs the browser flow, then captures the session.
    const home = homedir()
    await grokLogin()

    if (!existsSync(join(home, AUTH_FILE))) {
      return NextResponse.json({
        error: 'Login completed but no ~/.grok/auth.json was found. Try `grok login` in a terminal, then click Connect again.',
      }, { status: 400 })
    }

    // tar.gz just the credential (rooted at $HOME so it restores as ~/.grok/auth.json).
    const archive = execFileSync('tar', ['czf', '-', '-C', home, AUTH_FILE], { maxBuffer: 8 * 1024 * 1024 })
    execFileSync('gh', ['secret', 'set', 'GROK_CREDENTIALS', ...ghArgsRepo()], {
      input: archive.toString('base64'),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // GROK_CREDENTIALS is grok-CLI-only, so connecting the X account is an
    // unambiguous "use the grok harness" signal: switch harness to grok and push
    // aeon.yml — mirroring how setting a provider key auto-syncs the gateway.
    // (The API-key path above deliberately doesn't, since XAI_API_KEY is also a
    // gateway/tweet-skill secret.)
    const sync = await syncHarness('grok')

    return NextResponse.json({ ok: true, method: 'oauth', secret: 'GROK_CREDENTIALS', harness: 'grok', synced: sync.synced })
  } catch (error: unknown) {
    return errorResponse(error, 'Failed to connect Grok')
  }
}
