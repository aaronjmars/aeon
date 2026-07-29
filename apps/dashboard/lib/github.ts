import { readFile, writeFile, readdir, mkdir, rm } from 'fs/promises'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { REPO_ROOT } from './gh'

const GITHUB_API = 'https://api.github.com'

// Minimal shapes for the GitHub "Get repository content" REST responses.
interface GitHubContentFile { content: string; sha: string; encoding: string }
interface GitHubContentEntry { name: string; type: 'file' | 'dir' | 'symlink' | 'submodule'; path: string }

// Outcome of the local-mode git commit+push. `reason` is set only when the push
// failed (surfaced to the UI as `syncError`). Distinct from the wire-level
// SyncResult in lib/types.ts, which is the client-facing JSON response body.
export interface CommitResult { synced: boolean; reason?: string }

export function isLocal() {
  return !process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO
}

/**
 * Local-mode auto-sync. After a dashboard edit writes a file to disk, stage
 * exactly those paths, commit, and push so the change lands on GitHub
 * immediately - otherwise scheduled runs (which read committed `main`) never see
 * it. Hosted mode already commits through the Contents API, so this is a no-op
 * there. Best-effort and never throws: the file is already saved locally, so a
 * failed push degrades to { synced: false } (surfaced to the UI) rather than
 * failing the request. Only the given paths are committed, so unrelated
 * working-tree changes are left untouched.
 */
export function commitAndPush(paths: string[], message: string): CommitResult {
  if (isLocal() === false) return { synced: true } // hosted mode: edit already committed via API
  const git = (...args: string[]) =>
    execFileSync('git', args, { stdio: 'pipe', cwd: REPO_ROOT }).toString().trim()
  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200)
  try {
    git('add', '--', ...paths) // stages content changes AND deletions under these paths
    let staged = true
    try { git('diff', '--cached', '--quiet', '--', ...paths); staged = false } catch { staged = true }
    if (!staged) return { synced: true } // nothing changed in these paths
    git('commit', '-m', message, '--', ...paths)
    try {
      git('push')
    } catch {
      // Most likely behind origin/main (e.g. an Actions bot commit). Rebase onto
      // the remote and retry once; abort cleanly if it conflicts.
      try {
        git('pull', '--rebase', '--autostash')
        git('push')
      } catch (e) {
        try { git('rebase', '--abort') } catch { /* not mid-rebase */ }
        return { synced: false, reason: errMsg(e) }
      }
    }
    return { synced: true }
  } catch (e) {
    return { synced: false, reason: errMsg(e) }
  }
}

function getConfig() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO
  if (!token || !repo) throw new Error('github.ts: getConfig() requires GITHUB_TOKEN and GITHUB_REPO (non-local mode)')
  return { token, repo }
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

// Authenticated GET against the repo's "contents" endpoint. Uncached: the
// dashboard reads config it may have just written.
function contentsGet(path: string): Promise<Response> {
  const { token, repo } = getConfig()
  return fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    headers: authHeaders(token),
    cache: 'no-store',
  })
}

// Parse a GitHub "list contents" response into its entry array. A 404 and a
// non-array body (i.e. a single file, not a directory) both yield [] — an
// absent-or-not-a-directory path is not an error for callers that list.
async function parseContentsList(res: Response, path: string): Promise<GitHubContentEntry[]> {
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`GitHub API ${res.status}: failed to list ${path}`)
  const body = await res.json()
  return Array.isArray(body) ? (body as GitHubContentEntry[]) : []
}

// --- Unified interface: local filesystem or GitHub API ---

export async function getFileContent(path: string): Promise<{ content: string; sha: string }> {
  if (isLocal()) {
    const content = await readFile(join(REPO_ROOT, path), 'utf-8')
    return { content, sha: '' }
  }
  const res = await contentsGet(path)
  if (!res.ok) throw new Error(`GitHub API ${res.status}: failed to read ${path}`)
  const data = (await res.json()) as GitHubContentFile
  return {
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
    sha: data.sha,
  }
}

export async function updateFile(path: string, content: string, sha: string, _message: string): Promise<void> {
  if (isLocal()) {
    await writeFile(join(REPO_ROOT, path), content, 'utf-8')
    return
  }
  const { token, repo } = getConfig()
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({
      message: _message,
      content: Buffer.from(content).toString('base64'),
      sha,
    }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: failed to update ${path}`)
}

export async function createFile(path: string, content: string, message: string): Promise<void> {
  if (path.startsWith('/') || path.includes('..')) {
    throw new Error(`invalid path: ${path}`)
  }
  if (isLocal()) {
    const fullPath = join(REPO_ROOT, path)
    await mkdir(join(fullPath, '..'), { recursive: true })
    await writeFile(fullPath, content, 'utf-8')
    return
  }
  const { token, repo } = getConfig()
  try {
    const existing = await getFileContent(path)
    return updateFile(path, content, existing.sha, message)
  } catch {
    // File doesn't exist - create it
  }
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString('base64'),
    }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: failed to create ${path}`)
}

/**
 * Write a file, updating it in place when it already exists and creating it
 * otherwise, then sync via commitAndPush. Returns commitAndPush's result
 * ({ synced, reason }) so routes can spread it - best-effort/local-mode-only,
 * never throws from the sync step.
 */
export async function saveFile(
  path: string,
  content: string,
  opts: { updateMsg: string; createMsg: string },
): Promise<CommitResult> {
  let sha: string | undefined
  try {
    sha = (await getFileContent(path)).sha
  } catch {
    // File doesn't exist yet - create it
  }
  if (sha) {
    await updateFile(path, content, sha, opts.updateMsg)
  } else {
    await createFile(path, content, opts.createMsg)
  }
  return commitAndPush([path], sha ? opts.updateMsg : opts.createMsg)
}

export async function getDirectory(path: string): Promise<Array<{ name: string; type: string; path: string }>> {
  if (isLocal()) {
    const fullPath = join(REPO_ROOT, path)
    try {
      const entries = await readdir(fullPath, { withFileTypes: true })
      return entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        path: join(path, e.name),
      }))
    } catch {
      return []
    }
  }
  return parseContentsList(await contentsGet(path), path)
}

// --- Remote repo helpers (for importing skills) ---

function remoteAuthHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  }
}

export async function getRemoteDirectory(remoteRepo: string, path: string): Promise<Array<{ name: string; type: string }>> {
  // Always uses GitHub API (remote repo)
  const url = path
    ? `${GITHUB_API}/repos/${remoteRepo}/contents/${path}`
    : `${GITHUB_API}/repos/${remoteRepo}/contents`
  const res = await fetch(url, { headers: remoteAuthHeaders(), cache: 'no-store' })
  return parseContentsList(res, path)
}

export async function getRemoteFileContent(remoteRepo: string, path: string): Promise<string | null> {
  const res = await fetch(`${GITHUB_API}/repos/${remoteRepo}/contents/${path}`, {
    headers: remoteAuthHeaders(),
    cache: 'no-store',
  })
  if (!res.ok) return null
  const data = (await res.json()) as GitHubContentFile
  return Buffer.from(data.content, 'base64').toString('utf-8')
}

export async function deleteDirectory(path: string, message: string): Promise<void> {
  if (isLocal()) {
    await rm(join(REPO_ROOT, path), { recursive: true, force: true })
    return
  }
  const { token, repo } = getConfig()
  // GitHub API requires deleting files one by one
  const files = await getDirectory(path)
  for (const file of files) {
    if (file.type === 'dir') {
      await deleteDirectory(`${path}/${file.name}`, message)
    } else {
      const { sha } = await getFileContent(`${path}/${file.name}`)
      const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}/${file.name}`, {
        method: 'DELETE',
        headers: authHeaders(token),
        body: JSON.stringify({ message, sha }),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`GitHub API ${res.status}: failed to delete ${path}/${file.name}`)
    }
  }
}
