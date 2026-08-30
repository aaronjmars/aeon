import { NextResponse } from 'next/server'
import { requireGh, errorResponse } from '@/lib/http'
import { captureGithubToken } from '@/lib/github-auth'

// POST /api/github-auth - copy this machine's `gh auth token` into the
// GH_GLOBAL repo secret. Parallel to POST /api/auth (Claude) and
// POST /api/grok-auth, minus a browser flow: gh is already authenticated
// or the dashboard would have 503'd, and gho_ tokens do not expire.
export async function POST() {
  try {
    const notReady = requireGh()
    if (notReady) return notReady
    return NextResponse.json(captureGithubToken())
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Could not read') || msg.includes('not authenticated')) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return errorResponse(error, 'Failed to connect GitHub')
  }
}
