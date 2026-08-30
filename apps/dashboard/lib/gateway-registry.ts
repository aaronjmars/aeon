// Single source of truth for the LLM-gateway providers. Each one routes Claude
// Code at a fixed base URL via its mapped repo secret; the workflow resolves
// which provider is live at run time (scripts/llm-gateway.sh), so the dashboard
// keeps aeon.yml's gateway.provider on `auto` rather than pinning one.
//
// Add a provider HERE and it flows everywhere: the GatewayProvider union and
// GATEWAY_PROVIDERS list (lib/types), CLAUDE_AUTH_SECRETS (lib/constants), the
// secrets route's gateway-key set, the auth key-detection, and the service-icon domain.
export const GATEWAY_REGISTRY = {
  bankr: { label: 'Bankr', secretName: 'BANKR_LLM_KEY', prefixes: ['bk_'], domain: 'bankr.bot' },
  openrouter: { label: 'OpenRouter', secretName: 'OPENROUTER_API_KEY', prefixes: ['sk-or-'], domain: 'openrouter.ai' },
  // UsePod and Venice have no distinctive key/token prefix, so they can't be
  // detected from the key alone — they must be pinned explicitly (`aeon config
  // set gateway <provider>`). (UsePod's token is embedded in the base URL by the
  // workflow, not sent as a header.)
  usepod: { label: 'UsePod', secretName: 'USEPOD_TOKEN', prefixes: [], domain: 'usepod.ai' },
  venice: { label: 'Venice', secretName: 'VENICE_API_KEY', prefixes: [], domain: 'venice.ai' },
  surplus: { label: 'Surplus Intelligence', secretName: 'SURPLUS_API_KEY', prefixes: ['inf_'], domain: 'surplusintelligence.ai' },
  // Grok (xAI) as a GATEWAY: Claude Code routed at xAI's Anthropic-compatible
  // api.x.ai. Reuses the XAI_API_KEY secret (xAI keys are prefixed `xai-`). This
  // is separate from the grok CLI *harness* (harness: grok), which runs the grok
  // binary itself — see lib/config.ts Harness + scripts/run-grok.sh.
  grok: { label: 'Grok (xAI)', secretName: 'XAI_API_KEY', prefixes: ['xai-'], domain: 'x.ai' },
  // GLM Coding Plan as a GATEWAY: Claude Code routed at Z.AI's Anthropic
  // endpoint. No distinctive key prefix (dropdown-only, like UsePod/Venice).
  // Not a harness - there is no glm CLI; harness: glm is a dead name.
  glm: { label: 'GLM (Z.AI)', secretName: 'GLM_API_KEY', prefixes: [], domain: 'z.ai' },
} as const

export type GatewaySlug = keyof typeof GATEWAY_REGISTRY

export const GATEWAY_SLUGS = Object.keys(GATEWAY_REGISTRY) as GatewaySlug[]
export const GATEWAY_SECRET_NAMES: string[] = Object.values(GATEWAY_REGISTRY).map((p) => p.secretName)
