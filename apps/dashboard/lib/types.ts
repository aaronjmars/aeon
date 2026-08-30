import { GATEWAY_SLUGS, type GatewaySlug } from './gateway-registry'

export interface SkillKeyRef { key: string; optional: boolean }
export interface SkillMcpRef { slug: string; optional: boolean }
export interface Skill { name: string; description: string; tags: string[]; category: string; pack: string; packName: string; enabled: boolean; schedule: string; var: string; varHint: string; model: string; harness: string; requires: SkillKeyRef[]; mcp: SkillMcpRef[] }
export interface Run { id: number; workflow: string; status: string; conclusion: string | null; created_at: string; url: string }
// Result of a Telegram setup probe (webhook registration / chat-id lookup), shown inline in the Telegram credential helpers.
export interface TelegramStatus { ok: boolean; msg: string }

// --- Skill packs ---
// A skill inside a first-party pack, joined with its live enabled state from
// aeon.yml. `slug` is the skill dir name; `name` is the display name.
export interface PackSkill { slug: string; name: string; description: string; category: string; enabled: boolean }
// First-party pack (from packs.json) with live counts computed by /api/packs.
export interface Pack {
  key: string
  name: string
  description: string
  color: string
  category: string | null
  default_enabled: string[]
  skills: PackSkill[]
  total: number
  enabled: number
}
// Community pack (from skill-packs.json), browse-only in the dashboard.
export interface CommunityPack {
  repo: string
  path?: string
  name: string
  description: string
  author: string
  license?: string
  homepage?: string
  category: string
  trust_level?: string
  skills: string[]
  secrets_required?: string[]
  capabilities?: string[]
  installedCount: number
}
export interface Secret { name: string; group: string; description: string; isSet: boolean; either?: string }
export interface SkillOutput { filename: string; skill: string; timestamp: string; spec: { root: string; state?: Record<string, unknown>; elements: Record<string, SpecElement> } }
export interface SpecElement { type: string; props?: Record<string, unknown>; children?: string[] }

// Shape of `gh run list`/`gh run view --json` output. Routes Pick<> the columns they request.
export interface GhRunJson {
  databaseId: number
  name: string
  status: string
  conclusion: string | null
  createdAt: string
  updatedAt: string
  url: string
  displayTitle: string
  event: string
  jobs: Array<{ name: string; status: string; conclusion: string | null }>
}

// `auto` resolves the provider at run time from whichever secret is set
// (see scripts/llm-gateway.sh); `direct` is no gateway. Named providers come from
// the gateway registry - add new ones there, not here.
export type GatewayProvider = 'auto' | 'direct' | GatewaySlug

export const GATEWAY_PROVIDERS: GatewayProvider[] = ['auto', 'direct', ...GATEWAY_SLUGS]

// Which agent CLI runs skills. `claude` = Claude Code (default, uses the gateway
// above); `grok` = Grok Build CLI (own auth, own models). codex/pi/vibe/kimi run
// through harness-adapter's `run-harness` on one OPENROUTER_API_KEY (see
// harness-adapter/docs/aeon-integration.md and scripts/run-grok.sh for the seam).
// `fx` also runs through run-harness but has NO OpenRouter fallback (Vercel AI
// Gateway / VERCEL_OIDC_TOKEN only) — see lib/harness-auth.ts's fx entry and
// resolve-harness.sh's fx case.
export type Harness = 'claude' | 'grok' | 'codex' | 'fx' | 'pi' | 'vibe' | 'kimi' | 'cursor' | 'hermes'
export const HARNESSES: Harness[] = ['claude', 'grok', 'codex', 'fx', 'pi', 'vibe', 'kimi', 'cursor', 'hermes']

export interface UploadFile { path: string; content: string }

// The dashboard's top-level view, shared by the page shell, the top bar and the sidebar.
export type DashboardView = 'hq' | 'packs' | 'secrets' | 'strategy' | 'mcp' | 'soul'

// Client→server build briefs. The panels collect them; the build routes accept
// them as Partial (every field is untrusted/optional on the wire).
export interface SoulSources { handle: string; name: string; links: string }
export interface StrategySources { goal: string; repo: string; links: string }

// `.mcp.json` server map. A server's shape varies by transport: http (`url`,
// optional `headers`) or stdio (`command`, `args`, `env`). The known fields are
// typed; the index signature keeps this an open record so an operator's hand-edited
// .mcp.json (extra/unknown keys) still parses and consumers narrow as needed.
export interface McpServer {
  type?: 'http' | 'stdio' | 'sse'
  url?: string
  command?: string
  args?: string[]
  headers?: Record<string, string>
  env?: Record<string, string>
  [key: string]: unknown
}
export type McpServers = Record<string, McpServer>

export interface SkillMetrics {
  name: string
  total: number
  success: number
  failure: number
  inProgress: number
  successRate: number // over completed runs only
  lastRun: string | null
  lastConclusion: string | null
  streak: number // positive = consecutive successes, negative = consecutive failures
}

export interface Insight {
  type: 'warning' | 'info' | 'success'
  message: string
}

interface AnalyticsSummary {
  totalRuns: number
  overallSuccessRate: number
}

export interface AnalyticsData {
  skills: SkillMetrics[]
  insights: Insight[]
  summary: AnalyticsSummary
}

// --- Client-facing API response shapes ---
// Narrow views of what the API routes' NextResponse.json(...) actually return,
// for the fetch reads in app/page.tsx. Fields a route may omit stay optional so
// the casts don't introduce false non-null assumptions.

// GET /api/skills
export interface SkillsResponse {
  skills: Skill[]
  model?: string
  harness?: Harness
  gateway?: { provider: GatewayProvider }
  repo?: string
  jsonrenderEnabled?: boolean
}

// GET /api/runs
export interface RunsResponse {
  runs: Run[]
}

// GET /api/packs
export interface PacksResponse {
  firstParty: Pack[]
  community: CommunityPack[]
}

// GET /api/secrets
export interface SecretsResponse {
  secrets?: Secret[]
  ghReady?: boolean
}

// GET /api/sync
export interface SyncStatusResponse {
  hasChanges: boolean
  changedFiles?: number
  behind?: number
}

// GET /api/mcp
export interface McpResponse {
  exists?: boolean
  servers?: McpServers
  sha?: string
  raw?: string
}

// GET /api/outputs
export interface OutputsResponse {
  outputs?: SkillOutput[]
}

// GET /api/strategy
export interface StrategyResponse {
  exists?: boolean
  content?: string
  sha?: string
}

// GET /api/soul
export interface SoulResponse {
  soul?: { content: string; exists?: boolean }
  style?: { content: string; exists?: boolean }
}

// Standard write+sync body ({ ok, synced, syncError? }) from lib/http syncResult.
export interface SyncResult {
  ok?: boolean
  synced?: boolean
  syncError?: string
}

// POST /api/mcp-auth - the OAuth connect result. `server` is the .mcp.json
// descriptor the panel adds through its normal save path; `warning` is set when
// the grant carried no refresh token.
export interface McpAuthResponse {
  ok?: boolean
  slug?: string
  server?: McpServer
  durable?: boolean
  warning?: string
  error?: string
}

// GET /api/soul/examples - the gallery people available to install.
export interface SoulExample { key: string; label: string; blurb: string }
export interface SoulExamplesResponse { examples: SoulExample[] }

// POST /api/soul/examples - syncResult plus the installed file contents on
// success, or { error } on the not-found / failure paths.
export interface SoulExampleResponse extends SyncResult {
  soul?: string
  style?: string
  error?: string
}

// POST /api/upload
export interface UploadResponse {
  name: string
  filesWritten?: number
  detectedSecrets?: string[]
  configUpdated?: boolean
  configError?: string
  synced?: boolean
}

// Generic { error?: string } body returned on a route's non-OK paths.
export interface ErrorResponse {
  error?: string
}
