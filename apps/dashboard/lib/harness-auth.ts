// Native per-harness authentication for the run-harness harnesses (codex, pi,
// vibe, kimi). Each can run in CI on its OWN provider instead of the shared
// OPENROUTER_API_KEY:
//
//   - codex / kimi have real OAuth device flows (codex → ChatGPT, kimi → Moonshot).
//     We drive the login locally, then tar+base64 the credential file into a repo
//     secret and restore it in CI — the exact pattern aeon already uses for grok's
//     X-account session (GROK_CREDENTIALS). See lib/harness-auth-server.ts.
//   - pi / vibe take a native provider API key (pi reads standard provider env
//     vars; vibe a Mistral key).
//
// This module is PURE DATA (no node imports) so it's safe to import from client
// components AND from the CLI/route server code. The provider a harness runs on
// is decided by which of `authSecrets` is set — native first, OpenRouter last —
// and the workflow's "Resolve harness" / "Install harness CLI" steps branch on
// exactly that order (.github/workflows/aeon.yml).

export interface HarnessOAuth {
  // The CLI binary and login args. Both codex (`codex login` → local callback
  // server + browser) and kimi (`kimi login` → device URL + browser) open their
  // own browser and complete on approval, so the same args work for the aeon CLI
  // (TTY, inherit stdio) and the dashboard route (spawn, wait for exit 0). The
  // route must NOT open the URL as well, or the operator lands on two tabs.
  cli: string
  ttyArgs: string[]
  deviceArgs: string[]
  // $HOME-relative paths of the credential file(s) to capture/restore.
  credPaths: string[]
  // The repo secret the tar+base64 archive is stored under.
  secret: string
  // Human label for the connect button ("Connect ChatGPT").
  label: string
}

export interface HarnessApiKey {
  // Default secret the key is stored under. `detect` (pi) may pick a different
  // one from the key's prefix, since pi reads several provider env vars.
  secret: string
  detect?: (key: string) => string
  placeholder: string
}

export interface HarnessAuthSpec {
  // Every secret that authenticates this harness, MOST-PREFERRED FIRST. Drives
  // authSecretsForHarness (the run-gate + Auth CTA) and the workflow's provider
  // precedence. OPENROUTER_API_KEY is always last: the universal fallback.
  authSecrets: string[]
  oauth?: HarnessOAuth
  apiKey?: HarnessApiKey
}

// Detect the right Anthropic/OpenAI/OpenRouter secret for a pasted pi key by its
// prefix — pi auto-selects its provider from whichever of these env vars is set.
function detectPiSecret(key: string): string {
  const k = key.trim()
  if (k.startsWith('sk-ant-oat')) return 'ANTHROPIC_OAUTH_TOKEN'
  if (k.startsWith('sk-ant')) return 'ANTHROPIC_API_KEY'
  if (k.startsWith('sk-or')) return 'OPENROUTER_API_KEY'
  if (k.startsWith('sk-')) return 'OPENAI_API_KEY'
  return 'ANTHROPIC_API_KEY'
}

const HARNESS_AUTH_SPECS = {
  codex: {
    authSecrets: ['CODEX_AUTH', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'],
    oauth: {
      cli: 'codex',
      // Plain `codex login` (NOT --device-auth): it runs a localhost callback
      // server and auto-completes on browser approval — right for a local
      // dashboard. --device-auth prints a code the user must type by hand.
      ttyArgs: ['login'],
      deviceArgs: ['login'],
      credPaths: ['.codex/auth.json'],
      secret: 'CODEX_AUTH',
      label: 'Connect ChatGPT',
    },
    apiKey: { secret: 'OPENAI_API_KEY', placeholder: 'sk-...' },
  },
  kimi: {
    authSecrets: ['KIMI_AUTH', 'MOONSHOT_API_KEY', 'OPENROUTER_API_KEY'],
    oauth: {
      cli: 'kimi',
      ttyArgs: ['login'],
      deviceArgs: ['login'], // `kimi login` is device-code by default
      credPaths: ['.kimi-code/credentials/kimi-code.json', '.kimi-code/device_id'],
      secret: 'KIMI_AUTH',
      label: 'Connect Kimi',
    },
    apiKey: { secret: 'MOONSHOT_API_KEY', placeholder: 'sk-...' },
  },
  pi: {
    authSecrets: ['ANTHROPIC_API_KEY', 'ANTHROPIC_OAUTH_TOKEN', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'],
    apiKey: { secret: 'ANTHROPIC_API_KEY', detect: detectPiSecret, placeholder: 'sk-ant-… / sk-…' },
  },
  vibe: {
    authSecrets: ['MISTRAL_API_KEY', 'OPENROUTER_API_KEY'],
    apiKey: { secret: 'MISTRAL_API_KEY', placeholder: 'Mistral API key' },
  },
} satisfies Record<string, HarnessAuthSpec>

// Every caller indexes this with a harness name that came off the wire, out of
// aeon.yml, or off an argv flag — so the value type carries the miss. Under the
// old `Record<string, HarnessAuthSpec>` the `if (!spec)` guards at all six call
// sites were dead code the compiler believed could never fire.
export const HARNESS_AUTH: Record<string, HarnessAuthSpec | undefined> = HARNESS_AUTH_SPECS

// The URL a device-auth flow prints for the operator to approve in the browser.
// Permissive on purpose — codex (ChatGPT) and kimi (Moonshot) print different
// hosts, and we only need the first https URL to hand to openBrowser.
export const DEVICE_URL_RE = /https?:\/\/[^\s'"]+/
