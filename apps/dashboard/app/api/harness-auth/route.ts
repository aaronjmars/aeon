import { NextResponse } from 'next/server'
import { syncHarness } from '@/lib/gateway'
import { errorResponse, requireGh } from '@/lib/http'
import { HARNESS_AUTH } from '@/lib/harness-auth'
import { driveDeviceLogin, captureHarnessCreds, setHarnessApiKey } from '@/lib/harness-auth-server'
import type { Harness } from '@/lib/types'

// Native per-harness auth for codex/pi/vibe/kimi — the generic parallel to
// app/api/grok-auth. Because the dashboard runs on the operator's own machine it
// can drive the CLI directly. POST { harness, key? }:
//   - key present (or the harness is key-only) → store it under the harness's
//     provider secret (pi auto-detects the secret from the key prefix). No browser.
//   - no key + the harness has an OAuth flow → run its device login (the CLI opens
//     the browser itself), capture the credential file into its secret.
// The OAuth captures (CODEX_AUTH/KIMI_AUTH) are that-harness-only, so — exactly
// like connecting the X account for grok — they also switch the repo to that
// harness. The api-key paths don't (a provider key isn't an unambiguous signal).

export async function POST(request: Request) {
  try {
    const notReady = requireGh()
    if (notReady) return notReady

    const body = (await request.json().catch(() => ({}))) as { harness?: string; key?: string }
    const harness = typeof body.harness === 'string' ? body.harness : ''
    const spec = HARNESS_AUTH[harness]
    if (!spec) return NextResponse.json({ error: `Unknown harness '${harness}'` }, { status: 400 })
    const key = typeof body.key === 'string' ? body.key.trim() : ''

    // Path 1 — API key (given, or the only option for pi/vibe).
    if (key || !spec.oauth) {
      if (!spec.apiKey) return NextResponse.json({ error: `${harness} needs its login flow, not a key` }, { status: 400 })
      if (!key) return NextResponse.json({ error: `${harness} takes a provider API key` }, { status: 400 })
      const { secret } = setHarnessApiKey(harness, key)
      return NextResponse.json({ ok: true, harness, method: 'api-key', secret })
    }

    // Path 2: native OAuth. Drive the device login (the CLI opens the browser), capture.
    await driveDeviceLogin(harness)
    const { secret } = captureHarnessCreds(harness)
    const sync = await syncHarness(harness as Harness)
    return NextResponse.json({ ok: true, harness, method: 'oauth', secret, synced: sync.synced })
  } catch (error: unknown) {
    return errorResponse(error, 'Failed to connect harness')
  }
}
