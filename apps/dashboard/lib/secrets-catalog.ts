import { execFileSync } from 'child_process'
import { ghAvailable, ghArgsRepo, dispatchCommandsWorkflow } from './gh'
import { syncGatewayProvider } from './gateway'
import { GATEWAY_SECRET_NAMES } from './gateway-registry'
import { MCP_SECRET_RE, MCP_SECRET_OWNER, mcpServerLabel, oauthVar } from './mcp-catalog'
import type { Secret } from './types'

// The curated credential catalog: every secret the dashboard/CLI knows how to
// describe, grouped for display. Skills reference these by the exact env-var
// name (verified by a global scan of skills/). Unset builtins still render so
// the operator can see what's available — the surface a raw `gh secret list`
// can't provide. Extracted from app/api/secrets/route.ts so the secrets CLI
// command and the HTTP route share one definition.
export const BUILTIN_SECRETS: Omit<Secret, 'isSet'>[] = [
  { name: 'CLAUDE_CODE_OAUTH_TOKEN', group: 'Core', description: 'How Claude Code signs in - option 1 of 2. Runs Aeon on your Claude Pro/Max subscription (no per-token billing). Easiest: click AUTH above; or run claude setup-token locally and paste the token here.', either: 'auth' },
  { name: 'GROK_CREDENTIALS', group: 'Core', description: 'Grok Build (grok CLI) X-account OAuth session - base64 of your ~/.grok login, captured by "Connect X account" in AUTH. Lets the grok harness (harness: grok) run in CI on your SuperGrok / X Premium+ entitlement. Alternative: set XAI_API_KEY instead.' },
  { name: 'ANTHROPIC_API_KEY', group: 'Core', description: 'How Claude Code signs in - option 2 of 2. A pay-as-you-go Anthropic API key (sk-ant-...) billed via the Console, or any Anthropic-compatible key for a proxy. Create one at console.anthropic.com.', either: 'auth' },
  { name: 'BANKR_LLM_KEY', group: 'Core', description: 'Bankr Gateway API key (bk_...) - enable at bankr.bot/api-keys' },
  { name: 'OPENROUTER_API_KEY', group: 'Core', description: 'OpenRouter API key (sk-or-...) - dual purpose: (1) routes Claude Code through openrouter.ai (a gateway provider), and (2) the shared fallback auth for the codex, pi, vibe and kimi harnesses, which all run on OpenRouter via run-harness. One key covers all four. Create at openrouter.ai/keys' },
  // Native harness auth - each of the run-harness harnesses can run on its OWN
  // provider instead of the shared OpenRouter key. The two OAuth captures
  // (CODEX_AUTH/KIMI_AUTH) are set by `aeon auth --harness <h>` or the dashboard's
  // Connect button, which drive the CLI's login and store the captured session.
  { name: 'CODEX_AUTH', group: 'Core', description: 'Codex (ChatGPT) login captured for CI - a base64 tar of ~/.codex/auth.json. Set it with `aeon auth --harness codex` or the dashboard "Connect ChatGPT" button (runs `codex login`, stores the session here). Runs the codex harness on your ChatGPT plan instead of OpenRouter.' },
  { name: 'KIMI_AUTH', group: 'Core', description: 'Kimi (Moonshot) device login captured for CI - a base64 tar of ~/.kimi-code/credentials. Set it with `aeon auth --harness kimi` or the dashboard "Connect Kimi" button. Runs the kimi harness on your Moonshot account instead of OpenRouter.' },
  { name: 'OPENAI_API_KEY', group: 'Core', description: 'OpenAI API key (sk-...) - API-key auth for the codex harness (alternative to the ChatGPT login) and a provider pi can use. Create at platform.openai.com/api-keys' },
  { name: 'MOONSHOT_API_KEY', group: 'Core', description: 'Moonshot API key - API-key auth for the kimi harness (alternative to the device login). From platform.moonshot.ai' },
  { name: 'MISTRAL_API_KEY', group: 'Core', description: "Mistral API key - native auth for the vibe harness (its default provider). vibe's own `vibe` sign-in stores its credential in the OS keychain (not a portable file, like Claude Code), so it can't be captured for CI - set the key here instead. Create at console.mistral.ai" },
  { name: 'USEPOD_TOKEN', group: 'Core', description: "UsePod proxy token - routes Claude through UsePod's gateway (token embedded in the base URL). Get one at usepod.ai" },
  { name: 'VENICE_API_KEY', group: 'Core', description: 'Venice API key - routes Claude through api.venice.ai via a local translator. Create at venice.ai/settings/api' },
  { name: 'SURPLUS_API_KEY', group: 'Core', description: 'Surplus Intelligence API key (inf_...) - routes Claude through surplusintelligence.ai via a local translator' },
  { name: 'TELEGRAM_BOT_TOKEN', group: 'Telegram', description: 'Bot token from @BotFather' },
  { name: 'TELEGRAM_CHAT_ID', group: 'Telegram', description: 'Your chat ID' },
  { name: 'TELEGRAM_ALLOWED_USER_ID', group: 'Telegram', description: 'Optional - your numeric Telegram user ID (from @userinfobot). Only needed when TELEGRAM_CHAT_ID is a group/public chat: it restricts who can command the bot to this one user, so a random group member cannot dispatch skills or schedule crons by tapping a button. Defaults to TELEGRAM_CHAT_ID, which is correct for a 1:1 DM. In a group, button taps and messages fail closed until this is set.' },
  { name: 'DISCORD_BOT_TOKEN', group: 'Discord', description: 'Discord bot token' },
  { name: 'DISCORD_CHANNEL_ID', group: 'Discord', description: 'Channel ID for messages' },
  { name: 'DISCORD_WEBHOOK_URL', group: 'Discord', description: 'Webhook URL for notifications' },
  { name: 'SLACK_BOT_TOKEN', group: 'Slack', description: 'Slack bot OAuth token' },
  { name: 'SLACK_CHANNEL_ID', group: 'Slack', description: 'Channel ID for messages' },
  { name: 'SLACK_WEBHOOK_URL', group: 'Slack', description: 'Webhook URL for notifications' },
  { name: 'NOTIFY_EMAIL_TO', group: 'Email', description: 'Recipient address for the email notification channel - pairs with RESEND_API_KEY to email you (the operator) every skill notification, alongside Telegram/Discord/Slack. Optional repo variables: NOTIFY_EMAIL_FROM (default aeon@notifications.aeon.bot, must be a Resend-verified sender), NOTIFY_EMAIL_SUBJECT_PREFIX (default [Aeon]).' },
  // Observability - optional. Set both keys to stream every Claude Code run to a
  // Langfuse project as a trace (LLM calls, tokens, cost, prompts/responses) via
  // OpenTelemetry. No-op when unset. Region/host + toggles are repo VARIABLES:
  // LANGFUSE_HOST (default https://cloud.langfuse.com), LANGFUSE_TRACING (0 to
  // disable), LANGFUSE_LOG_CONTENT (0 = metadata only, all = incl. tool bodies).
  { name: 'LANGFUSE_PUBLIC_KEY', group: 'Observability', description: 'Langfuse public key (pk-lf-...) - pairs with LANGFUSE_SECRET_KEY to trace every run to Langfuse. Pick EU or US cloud with the region dropdown below (default EU). Keys in Langfuse → Settings → API Keys.' },
  { name: 'LANGFUSE_SECRET_KEY', group: 'Observability', description: 'Langfuse secret key (sk-lf-...) - the other half of the Langfuse trace-ingestion credential. Both keys must be set for tracing to activate.' },
  // Skill Keys - third-party API keys individual skills call. Each is opt-in:
  // unset means the skills that need it skip rather than fail. Names below are
  // the exact env vars referenced across skills/ (verified by global scan).
  { name: 'XAI_API_KEY', group: 'Skill Keys', description: 'xAI / Grok API key (xai-...) - triple-duty: (1) tweet & X-analysis skills, (2) the Grok gateway (routes Claude Code at api.x.ai), (3) API-key auth for the grok harness. Create at console.x.ai' },
  { name: 'COINGECKO_API_KEY', group: 'Skill Keys', description: 'CoinGecko API key - crypto price/market skills. Get one at coingecko.com/en/api' },
  { name: 'ALCHEMY_API_KEY', group: 'Skill Keys', description: 'Alchemy API key - on-chain RPC/data skills. Create at dashboard.alchemy.com' },
  { name: 'ETHERSCAN_API_KEY', group: 'Skill Keys', description: 'Etherscan multichain (V2) API key - one key covers Ethereum + Base + other chains for on-chain skills (tx-explain, investigation-report, onchain-monitor); lifts rate limits. Get one at etherscan.io/apis' },
  { name: 'BASESCAN_API_KEY', group: 'Skill Keys', description: 'Base explorer key for on-chain skills (investigation-report). Etherscan V2 is one multichain key, so the simplest setup is the SAME value as ETHERSCAN_API_KEY; a standalone basescan.org key also works. Optional - lifts Base rate limits. Keys at etherscan.io/apis' },
  { name: 'BANKR_API_KEY', group: 'Skill Keys', description: 'Bankr Wallet API key (X-API-Key) - token distribution skills (distribute-tokens). Enable at bankr.bot/api-keys' },
  { name: 'VERCEL_TOKEN', group: 'Skill Keys', description: 'Vercel access token - deploy skills (deploy-prototype). Create at vercel.com/account/settings/tokens' },
  { name: 'REPLICATE_API_TOKEN', group: 'Skill Keys', description: 'Replicate API token - hero image generation (article). Get one at replicate.com/account/api-tokens' },
  { name: 'RESEND_API_KEY', group: 'Skill Keys', description: 'Resend API key - powers ALL outbound email: the operator email-notification channel (with NOTIFY_EMAIL_TO), emailed digests, and security disclosures (send-email, heartbeat, vuln-scanner). Create at resend.com' },
  { name: 'ADMANAGE_API_KEY', group: 'Skill Keys', description: 'AdManage API key - ad-campaign skill (schedule-ads). From admanage.ai/api-docs' },
  { name: 'GH_GLOBAL', group: 'Skill Keys', description: 'GitHub PAT with cross-repo WRITE access - cross-repo skills & deploys (changelog push-to, feature external, deploy-prototype, vuln-scanner). Auto-promoted to the run\'s GITHUB_TOKEN. Create one at github.com/settings/tokens' },
  { name: 'GH_READ_PAT', group: 'Skill Keys', description: 'GitHub read-only PAT - optional. Enriches cross-repo / private-repo reads (bd-radar); kept separate from the write-capable GH_GLOBAL for least privilege. Without it those skills fall back to public data. Create a read-only token at github.com/settings/tokens' },
  { name: 'GH_SECRETS_PAT', group: 'Skill Keys', description: 'Fine-grained GitHub PAT with Secrets: read/write on THIS repo - keeps OAuth-connected MCP servers and the Grok X-account harness working. Providers rotate the refresh token on every run; the runner needs this PAT to save each rotation back, otherwise auth breaks one run after Connect. Create at github.com/settings/personal-access-tokens: add this repo under Repository access (a PAT without it 404s) + Repository permissions > Secrets: Read and write. Then re-connect any already-connected server once' },
  { name: 'BASE_RPC_URL', group: 'Skill Keys', description: 'Custom Base RPC endpoint - onchain Base skills (investigation-report, token-movers). Optional: a public RPC is used by default; set a paid endpoint to lift rate limits. Find a provider at docs.base.org/chain/node-providers' },
  { name: 'PAGESPEED_API_KEY', group: 'Skill Keys', description: 'Google PageSpeed Insights API key - optional, lets seo-audit fold Core Web Vitals (CrUX field data: LCP/INP/CLS) into the SEO audit. Without it the audit still runs, minus Web Vitals. Enable the PageSpeed Insights API in Google Cloud, then create a key at console.cloud.google.com/apis/credentials' },
]

export const BUILTIN_NAMES = new Set(BUILTIN_SECRETS.map(s => s.name))

// Valid env var name pattern (builtins + custom secrets).
export const VALID_SECRET_NAME = /^[A-Z][A-Z0-9_]{1,}$/

// Names of the secrets currently set in the managed repo. Throws when `gh secret
// list` fails (rate limit, lost repo permission, network) — an all-unset list
// would be a lie the operator acts on by re-pasting live keys. The "gh not
// authenticated" case is handled one layer up by getSecrets() via ghAvailable().
export function listSecretNames(): string[] {
  const out = execFileSync('gh', ['secret', 'list', ...ghArgsRepo(), '--json', 'name', '-q', '.[].name'], {
    stdio: 'pipe',
    cwd: process.cwd(),
  }).toString().trim()
  return out ? out.split('\n').filter(Boolean) : []
}

// The full secret roster: every builtin (with its set/unset state) plus any
// repo secret not in the catalog, surfaced as a custom "Skill Keys" entry.
// `ghReady` is false when the gh CLI isn't authenticated — the state can't be
// read, so callers should tell the operator to `gh auth login` rather than
// present an all-unset list as truth.
export function getSecrets(): { secrets: Secret[]; ghReady: boolean } {
  if (!ghAvailable()) return { secrets: [], ghReady: false }

  const setSecrets = new Set(listSecretNames())
  const secrets: Secret[] = BUILTIN_SECRETS.map(s => ({ ...s, isSet: setSecrets.has(s.name) }))
  for (const name of setSecrets) {
    if (BUILTIN_NAMES.has(name)) continue
    secrets.push(MCP_SECRET_RE.test(name)
      ? { name, group: 'MCP', description: describeMcpSecret(name, setSecrets), isSet: true }
      : { name, group: 'Skill Keys', description: 'Custom secret', isSet: true })
  }
  return { secrets, ghReady: true }
}

// MCP credentials can't be builtins: they're minted per server by the MCP page
// (paste-a-bearer-token, or the OAuth Connect flow), so their names aren't known
// until one exists. Describe them at read time instead, from the catalog when
// the server is a featured one — otherwise the group would be a wall of
// undescribed MCP_*_TOKEN rows in the "Skill Keys" catch-all, which is where
// they used to land.
export function describeMcpSecret(name: string, setSecrets: ReadonlySet<string>): string {
  const label = mcpServerLabel(name)
  // A catalogued server is named by its brand; a custom one only has the slug
  // the operator typed, so quote it to make clear it's their name, not ours.
  const via = MCP_SECRET_OWNER[name] ? `the ${label} MCP server` : `your "${label}" MCP server`

  if (name.endsWith('_OAUTH')) {
    return `OAuth refresh material for ${via} - token endpoint, client ID and refresh token, captured by Connect on the MCP page. The runner mints a fresh access token from this before every run; providers rotate it, so GH_SECRETS_PAT must be set for the rotation to persist. Managed automatically: remove it to revoke, then re-connect.`
  }
  // A sibling _OAUTH secret means this token is Connect-minted and re-minted
  // every run; without one it's a static bearer the operator pasted in.
  return setSecrets.has(oauthVar(mcpSlugStem(name)))
    ? `Access token for ${via}, referenced as \${${name}} by its Authorization header in .mcp.json. Short-lived and re-minted from the stored refresh material before every run, so don't paste over it by hand - re-connect on the MCP page instead.`
    : `Static bearer token for ${via}, referenced as \${${name}} by its Authorization header in .mcp.json. Pasted on the MCP page when the server was added; re-paste it there to rotate.`
}

// The slug stem inside an MCP credential name, in the sanitized form both
// tokenVar() and oauthVar() produce - so `MCP_GLIM_TOKEN` maps to the sibling
// `MCP_GLIM_OAUTH` without needing to recover the original slug's punctuation.
function mcpSlugStem(name: string): string {
  return name.replace(/^MCP_/, '').replace(/_(TOKEN|OAUTH)$/, '')
}

// Set a repo secret via gh, then run the same side-effects the dashboard route
// does: keep the gateway on `auto` when a gateway key changes, and auto-register
// the Telegram command menu the moment the bot token lands. Caller must
// pre-validate `name` against VALID_SECRET_NAME. Throws on a gh failure.
export async function setSecret(name: string, value: string): Promise<void> {
  execFileSync('gh', ['secret', 'set', name, ...ghArgsRepo(), '-b', value], {
    stdio: 'pipe',
    cwd: process.cwd(),
  })
  if (GATEWAY_SECRET_NAMES.includes(name)) await syncGatewayProvider()
  if (name === 'TELEGRAM_BOT_TOKEN') {
    try { dispatchCommandsWorkflow() } catch { /* non-fatal — token is still saved */ }
  }
}

// Delete a repo secret via gh; re-resolve the gateway if a gateway key was dropped.
export async function deleteSecret(name: string): Promise<void> {
  execFileSync('gh', ['secret', 'delete', name, ...ghArgsRepo()], { stdio: 'pipe', cwd: process.cwd() })
  if (GATEWAY_SECRET_NAMES.includes(name)) await syncGatewayProvider()
}
