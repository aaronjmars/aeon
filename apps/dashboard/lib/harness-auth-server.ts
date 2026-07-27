import { execFileSync, spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { ghArgsRepo } from './gh'
import { HARNESS_AUTH, DEVICE_URL_RE } from './harness-auth'

// Server-side (Node) half of native harness auth. Shared by `aeon auth` and
// POST /api/harness-auth. The pure registry it drives is in ./harness-auth.
// Every one of these mirrors an existing grok/claude flow (lib/auth.ts,
// app/api/grok-auth) — same tar+base64 capture, same `gh secret set`.

// Store an API key for a harness under the right secret name and return it.
// pi may resolve a different secret from the key's prefix (see detectPiSecret).
export function setHarnessApiKey(harness: string, key: string): { secret: string } {
  const spec = HARNESS_AUTH[harness]
  if (!spec?.apiKey) throw new Error(`${harness} has no API-key auth path`)
  const k = key.trim()
  if (!k) throw new Error('empty key')
  const secret = spec.apiKey.detect ? spec.apiKey.detect(k) : spec.apiKey.secret
  execFileSync('gh', ['secret', 'set', secret, ...ghArgsRepo()], { input: k, stdio: ['pipe', 'pipe', 'pipe'] })
  return { secret }
}

// After a successful login has written the harness's credential file(s), tar +
// base64 them into the harness's OAuth secret ($HOME-relative so the archive
// restores to the same path in CI). Throws if no credential file appeared.
export function captureHarnessCreds(harness: string): { secret: string } {
  const spec = HARNESS_AUTH[harness]
  if (!spec?.oauth) throw new Error(`${harness} has no OAuth capture`)
  const home = homedir()
  const present = spec.oauth.credPaths.filter((p) => existsSync(join(home, p)))
  if (present.length === 0) {
    throw new Error(`Login completed but none of ${spec.oauth.credPaths.join(', ')} was found under $HOME. Try the login in a terminal, then connect again.`)
  }
  const archive = execFileSync('tar', ['czf', '-', '-C', home, ...present], { maxBuffer: 8 * 1024 * 1024 })
  execFileSync('gh', ['secret', 'set', spec.oauth.secret, ...ghArgsRepo()], {
    input: archive.toString('base64'),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return { secret: spec.oauth.secret }
}

// Drive the TTY login (inherit stdio: the tool shows its own prompts and opens
// its own browser), for the aeon CLI. Blocks until the flow finishes; throws on
// a non-zero exit.
export function driveTtyLogin(harness: string): void {
  const spec = HARNESS_AUTH[harness]
  if (!spec?.oauth) throw new Error(`${harness} has no OAuth login`)
  execFileSync(spec.oauth.cli, spec.oauth.deviceArgs.length && !process.stdout.isTTY ? spec.oauth.deviceArgs : spec.oauth.ttyArgs, { stdio: 'inherit' })
}

// Drive the DEVICE login for the dashboard route, waiting on the tab the CLI
// opens for itself. Resolves on approval. Faithful to grokLogin() in
// app/api/grok-auth/route.ts, including NOT opening the browser here: codex and
// kimi both launch it themselves ("If your browser did not open...", "Opening
// browser for Kimi device login"), so a second open just duplicates the tab.
export function driveDeviceLogin(harness: string, timeoutMs = 240_000): Promise<void> {
  const spec = HARNESS_AUTH[harness]
  if (!spec?.oauth) return Promise.reject(new Error(`${harness} has no OAuth login`))
  const { cli, deviceArgs } = spec.oauth
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(cli, deviceArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return reject(e)
    }
    let buf = ''
    const onData = (chunk: Buffer) => { buf += chunk.toString() }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    // The first EXTERNAL URL in the output, quoted back only when the flow fails
    // so an operator whose browser never opened can finish by hand. codex prints
    // its localhost callback server first (http://localhost:1455), which is not
    // the auth page, so skip loopback hosts.
    const verifyUrl = () => (buf.match(new RegExp(DEVICE_URL_RE.source, 'g')) || [])
      .find((u) => !/localhost|127\.0\.0\.1|\[::1\]/.test(u)) ?? ''
    const timer = setTimeout(() => {
      child.kill()
      const url = verifyUrl()
      reject(new Error(`Timed out waiting for approval. Approve in the browser and connect again.${url ? ` If no tab opened, visit ${url}` : ''}`))
    }, timeoutMs)
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(e.code === 'ENOENT' ? new Error(`${cli} CLI not found — install it first.`) : e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`${cli} login exited ${code}. ${buf.slice(-200)}`))
    })
  })
}
