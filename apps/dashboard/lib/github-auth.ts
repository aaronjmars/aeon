import { execFileSync } from 'child_process'
import { ghSecretSet } from './gh'

export const GH_GLOBAL_SECRET = 'GH_GLOBAL'

// GitHub CLI OAuth (gho_), classic PAT (ghp_), fine-grained PAT (github_pat_).
// All work as GH_TOKEN in Actions. Reject anything else so we never stash an
// Actions installation token (ghs_) or leftover stdout.
export const GH_TOKEN_RE = /^(gho_|ghp_|github_pat_)[A-Za-z0-9_]+$/

export function parseGhAuthToken(raw: string): string {
  const token = raw.trim().split(/\s+/, 1)[0] ?? ''
  if (!GH_TOKEN_RE.test(token)) {
    throw new Error('Could not read a GitHub token from `gh auth token`. Run `gh auth login`, then Connect again. Or paste a PAT with Set.')
  }
  return token
}

// Copy the operator's already-authenticated `gh` session into GH_GLOBAL so
// Actions runs with that token. Shared by POST /api/github-auth and
// `aeon auth --github`. No extra browser flow: the dashboard already required
// `gh auth login` to start, and GitHub CLI gho_ tokens do not expire.
export function captureGithubToken(): { ok: true; method: 'oauth'; secret: string } {
  let raw: string
  try {
    raw = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  } catch {
    throw new Error('GitHub CLI not authenticated. Run: gh auth login')
  }
  const token = parseGhAuthToken(raw)
  ghSecretSet(GH_GLOBAL_SECRET, token)
  return { ok: true, method: 'oauth', secret: GH_GLOBAL_SECRET }
}
