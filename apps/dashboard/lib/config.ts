import { parseDocument, isMap, isPair, isScalar } from 'yaml'
import { GATEWAY_PROVIDERS, HARNESSES } from './types'
import type { GatewayProvider, Harness } from './types'

export interface SkillConfig {
  enabled: boolean
  schedule: string
  var: string
  model: string
  harness: string
}

interface GatewayConfig {
  provider: GatewayProvider
}

export interface AeonConfig {
  skills: Record<string, SkillConfig>
  model: string
  harness: Harness
  gateway: GatewayConfig
  jsonrenderEnabled: boolean
}

/**
 * Parse aeon.yml into a typed config object.
 */
export function parseConfig(raw: string): AeonConfig {
  const doc = parseDocument(raw)
  const skills: Record<string, SkillConfig> = {}

  const skillsNode = doc.get('skills')
  if (isMap(skillsNode)) {
    for (const item of skillsNode.items) {
      if (!isPair(item) || !isScalar(item.key)) continue
      const name = String(item.key.value)
      const val = item.value
      if (isMap(val)) {
        skills[name] = {
          enabled: getMapValue(val, 'enabled') === true,
          schedule: String(getMapValue(val, 'schedule') ?? ''),
          var: String(getMapValue(val, 'var') ?? ''),
          model: String(getMapValue(val, 'model') ?? ''),
          harness: String(getMapValue(val, 'harness') ?? ''),
        }
      }
    }
  }

  const model = String(doc.get('model') ?? 'claude-sonnet-5')
  const harnessRaw = String(doc.get('harness') ?? 'claude')
  const harness: Harness = HARNESSES.find(h => h === harnessRaw) ?? 'claude'

  let gateway: GatewayConfig = { provider: 'auto' }
  const gatewayNode = doc.get('gateway')
  if (isMap(gatewayNode)) {
    const provider = String(getMapValue(gatewayNode, 'provider') ?? 'auto')
    gateway = { provider: GATEWAY_PROVIDERS.find(p => p === provider) ?? 'auto' }
  }

  let jsonrenderEnabled = false
  const channels = doc.get('channels')
  if (isMap(channels)) {
    const jr = channels.get('jsonrender')
    if (isMap(jr)) {
      jsonrenderEnabled = getMapValue(jr, 'enabled') === true
    }
  }

  return { skills, model, harness, gateway, jsonrenderEnabled }
}

/**
 * Update a skill's config fields in aeon.yml. Preserves formatting and comments.
 */
export function updateSkillInConfig(
  raw: string,
  name: string,
  updates: Partial<SkillConfig>,
): string {
  const doc = parseDocument(raw)
  const skillsNode = doc.get('skills')
  if (!isMap(skillsNode)) return raw

  const skillNode = skillsNode.get(name)
  if (!isMap(skillNode)) return raw

  if (typeof updates.enabled === 'boolean') {
    skillNode.set('enabled', updates.enabled)
  }
  if (typeof updates.schedule === 'string' && updates.schedule) {
    skillNode.set('schedule', updates.schedule)
  }
  if (typeof updates.var === 'string') {
    if (updates.var) {
      skillNode.set('var', updates.var)
    } else {
      skillNode.delete('var')
    }
  }
  if (typeof updates.model === 'string') {
    if (updates.model) {
      skillNode.set('model', updates.model)
    } else {
      skillNode.delete('model')
    }
  }
  if (typeof updates.harness === 'string') {
    // Pin any non-default harness (grok/codex/pi/vibe/kimi) per-skill; `claude`
    // (the top-level default) clears the override so the skill inherits it. This
    // lets one skill run on a different harness than the repo default.
    if (updates.harness && updates.harness !== 'claude') {
      skillNode.set('harness', updates.harness)
    } else {
      skillNode.delete('harness')
    }
  }

  return doc.toString()
}

/**
 * Update top-level model field.
 */
export function updateModelInConfig(raw: string, model: string): string {
  const doc = parseDocument(raw)
  doc.set('model', model)
  return doc.toString()
}

/**
 * Update the top-level agent harness (claude | grok).
 */
export function updateHarnessInConfig(raw: string, harness: Harness): string {
  const doc = parseDocument(raw)
  doc.set('harness', harness)
  return doc.toString()
}

/**
 * Update the LLM gateway provider. Creates the gateway block if absent.
 */
export function updateGatewayInConfig(raw: string, provider: GatewayProvider): string {
  const doc = parseDocument(raw)
  doc.setIn(['gateway', 'provider'], provider)
  return doc.toString()
}

/**
 * Update jsonrender enabled flag.
 */
export function updateJsonrenderInConfig(raw: string, enabled: boolean): string {
  const doc = parseDocument(raw)
  const channels = doc.get('channels')
  if (isMap(channels)) {
    const jr = channels.get('jsonrender')
    if (isMap(jr)) {
      jr.set('enabled', enabled)
    }
  }
  return doc.toString()
}

/**
 * Remove a skill entry from aeon.yml.
 */
export function removeSkillFromConfig(raw: string, name: string): string {
  const doc = parseDocument(raw)
  const skillsNode = doc.get('skills')
  if (isMap(skillsNode)) {
    skillsNode.delete(name)
  }
  return doc.toString()
}

/**
 * Add a new skill entry to aeon.yml (before the fallback comment).
 */
export function addSkillToConfig(
  raw: string,
  name: string,
  config: Partial<SkillConfig> = {},
): string {
  const doc = parseDocument(raw)
  const skillsNode = doc.get('skills')
  if (!isMap(skillsNode)) return raw

  if (skillsNode.has(name)) return raw

  // Build the new skill entry as a flow mapping to match existing style
  const entry = doc.createNode({
    enabled: config.enabled ?? false,
    schedule: config.schedule ?? '0 12 * * *',
  })
  if (isMap(entry)) {
    entry.flow = true
    // Force the cron to a double-quoted scalar. `0 12 * * *` is a perfectly
    // valid plain YAML string, but the scheduler parses aeon.yml with a bash
    // regex that REQUIRES the quotes:
    //   [[ "$INLINE" =~ schedule:\ *\"([^\"]+)\" ]]   (.github/workflows/scheduler.yml)
    // An unquoted cron leaves SKILL_SCHEDULE empty, and the empty-schedule
    // guard then skips the skill — so it silently never fires. Every
    // hand-written entry is quoted; generated ones must match.
    const sched = entry.get('schedule', true)
    if (isScalar(sched)) sched.type = 'QUOTE_DOUBLE'
  }

  // Find the fallback skill (heartbeat, last entry) and insert before it
  const items = skillsNode.items
  const fallbackIdx = items.findIndex(
    (item) => isPair(item) && isScalar(item.key) && item.key.value === 'heartbeat',
  )

  if (fallbackIdx >= 0) {
    const pair = doc.createPair(name, entry)
    items.splice(fallbackIdx, 0, pair)
  } else {
    skillsNode.set(name, entry)
  }

  return doc.toString()
}

/**
 * Create the skill's entry if it's missing, then apply `updates` to it.
 *
 * `updateSkillInConfig` deliberately no-ops on an unknown skill (it returns
 * `raw` unchanged), which is right for a blind edit but wrong for the
 * enable/schedule/set path: skills are enumerated from disk, so a freshly
 * created `skills/<name>/SKILL.md` has no aeon.yml entry yet and every attempt
 * to turn it on silently did nothing — while the read path reported it as
 * merely "disabled", because a missing entry defaults to `enabled: false`.
 *
 * Callers must confirm the skill exists on disk first; this will happily
 * create an entry for a typo'd name.
 */
export function upsertSkillInConfig(
  raw: string,
  name: string,
  updates: Partial<SkillConfig>,
): string {
  // addSkillToConfig is a no-op when the entry already exists, so composing the
  // two is safe unconditionally. Seeding it with `updates` means a create lands
  // the right enabled/schedule immediately rather than writing the defaults and
  // overwriting them on the next line.
  return updateSkillInConfig(addSkillToConfig(raw, name, updates), name, updates)
}

// --- Helpers ---

function getMapValue(map: unknown, key: string): unknown {
  if (!isMap(map)) return undefined
  for (const item of map.items) {
    if (isPair(item) && isScalar(item.key) && item.key.value === key) {
      return isScalar(item.value) ? item.value.value : item.value
    }
  }
  return undefined
}
