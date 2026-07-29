import { execSync, execFileSync } from 'child_process'
import { resolve } from 'path'

// The dashboard runs from apps/dashboard/, so the repo it manages is two levels
// up from cwd. Other consumers of this lib (e.g. the apps/cli command-line tool)
// can't rely on that cwd, so an explicit `AEON_REPO_ROOT` overrides the guess.
// Unset — the dashboard's case — keeps the original cwd-relative behaviour.
export const REPO_ROOT = process.env.AEON_REPO_ROOT
  ? resolve(process.env.AEON_REPO_ROOT)
  : resolve(process.cwd(), '..', '..')

// Whether the `gh` CLI is installed and authenticated.
export function ghAvailable(): boolean {
  try {
    execSync('gh auth status', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

// Resolve the active repo: explicit `gh` default first, inferred remote second.
function ghRepo(): string | null {
  try {
    const repo = execSync('gh repo set-default --view', { stdio: 'pipe', cwd: REPO_ROOT }).toString().trim()
    if (repo && !repo.startsWith('no default')) return repo
  } catch {}
  try {
    const repo = execSync('gh repo view --json nameWithOwner -q .nameWithOwner', { stdio: 'pipe', cwd: REPO_ROOT }).toString().trim()
    if (repo) return repo
  } catch {}
  return null
}

// `-R owner/repo` args for `gh` subcommands, or empty when the repo is unresolved.
export function ghArgsRepo(): string[] {
  const repo = ghRepo()
  return repo ? ['-R', repo] : []
}

// Ensure GitHub Actions in the managed repo may open (and auto-merge) pull
// requests. install-skill runs in Actions, where the default GITHUB_TOKEN is
// read-only and *forbidden from creating PRs* unless the repo's
// "Allow GitHub Actions to create and approve pull requests" setting is on —
// a repo setting that does NOT inherit to forks and that a workflow's own
// `permissions:` block cannot override. Flipping it needs admin, which the
// in-Actions token never has but the operator's local `gh` does — so the
// dashboard ensures it here, right before dispatching a PR-opening skill.
// Idempotent and best-effort: a missing-admin / API hiccup must never block the
// run (install-skill degrades to leaving the branch + a compare link).
export function ensureActionsCanOpenPRs(): void {
  const repo = ghRepo()
  if (!repo) return
  try {
    // Grant write + the create/approve-PRs capability in one PUT.
    execFileSync('gh', ['api', '-X', 'PUT',
      `repos/${repo}/actions/permissions/workflow`,
      '-f', 'default_workflow_permissions=write',
      '-F', 'can_approve_pull_request_reviews=true',
    ], { stdio: 'pipe', cwd: REPO_ROOT })
  } catch { /* lacks admin or transient API error — leave as-is, don't block */ }
  try {
    // Let install-skill's `gh pr merge --auto` queue the merge behind CI.
    execFileSync('gh', ['repo', 'edit', repo, '--enable-auto-merge'],
      { stdio: 'pipe', cwd: REPO_ROOT })
  } catch { /* auto-merge unavailable (e.g. private free repo) — skill falls back to direct merge */ }
}

// Write a repo secret. The value goes in on stdin, never as an argv token, so it
// stays out of the process table and any shell history.
export function ghSecretSet(name: string, value: string): void {
  execFileSync('gh', ['secret', 'set', name, ...ghArgsRepo()], {
    input: value,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

// Dispatch the "Setup Telegram Commands" workflow (.github/workflows/setup-commands.yml).
// It reads TELEGRAM_BOT_TOKEN server-side (where secrets are readable) and pushes the
// bot's `/` command menu via setMyCommands + setChatMenuButton — no token pasting. Used
// both by the manual "Re-register" button and automatically right after the bot token is
// saved. Throws on failure so the API route can surface it; wrap in try/catch for the
// best-effort auto-register path.
export function dispatchCommandsWorkflow(): void {
  execFileSync('gh', ['workflow', 'run', 'setup-commands.yml', ...ghArgsRepo()],
    { stdio: 'pipe', cwd: REPO_ROOT })
}
