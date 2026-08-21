import { execFileSync, execSync } from 'child_process'
import { ghArgsRepo, ghSecretSet } from './gh'
import { normalizeAuthConfig } from './auth-provider'
import { syncGatewayProvider } from './gateway'

export interface AuthResult {
  ok: true
  method: string
  secret?: string
  baseUrl?: boolean
  gateway?: string
}

// Configure how Claude Code authenticates, then push the credential to the repo.
// Shared by POST /api/auth and `aeon auth`. Three paths, exactly as the route:
//   - a gateway/API/OAuth key in `key`  → gh secret set <resolved secret name>
//   - a custom `baseUrl`                → gh variable set ANTHROPIC_BASE_URL
//   - neither                           → run `claude setup-token`, capture the
//                                         sk-ant-oat token, set CLAUDE_CODE_OAUTH_TOKEN
// Throws on validation errors (bad base URL, OAuth+baseUrl, unknown gateway) and
// on a gh/claude failure. Always re-syncs the gateway provider afterward.
export async function configureAuth(
  body: { key?: string; baseUrl?: string; provider?: string } = {},
): Promise<AuthResult> {
  const config = normalizeAuthConfig(body)

  if (config.baseUrl) {
    execFileSync('gh', ['variable', 'set', 'ANTHROPIC_BASE_URL', ...ghArgsRepo(), '--body', config.baseUrl], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  if (config.key) {
    ghSecretSet(config.secretName, config.key)
    await syncGatewayProvider()
    return { ok: true, method: config.method, secret: config.secretName, baseUrl: Boolean(config.baseUrl), gateway: config.gateway }
  }

  // No key provided → mint an OAuth token locally via the Claude CLI.
  // 5-minute timeout: `claude setup-token` opens a browser and blocks on the
  // sign-in + approval. A first-time sign-in routinely takes longer than a
  // minute, and at the old 60s cap execSync SIGKILLed the flow mid-approval, so
  // the button "failed silently" with no token saved. Matches the device-login
  // wait in lib/harness-auth-server.ts.
  const output = execSync('claude setup-token', { stdio: 'pipe', timeout: 300000 }).toString()

  const tokenBlock = output.slice(output.indexOf('sk-ant-oat'))
  if (!tokenBlock.startsWith('sk-ant-oat')) {
    throw new Error('Could not extract token. Paste your API key manually instead.')
  }

  const tokenChars: string[] = []
  for (const line of tokenBlock.split('\n')) {
    const segment = line.trim().match(/^[A-Za-z0-9_\-]+/)?.[0] ?? ''
    if (!segment) break
    tokenChars.push(segment)
  }
  const token = tokenChars.join('')
  if (!token.startsWith('sk-ant-oat')) {
    throw new Error('Could not extract a valid OAuth token. Paste your API key manually instead.')
  }

  ghSecretSet('CLAUDE_CODE_OAUTH_TOKEN', token)
  await syncGatewayProvider()
  return { ok: true, method: 'oauth' }
}
