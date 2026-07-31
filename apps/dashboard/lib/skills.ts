import { execSync } from 'child_process'
import { REPO_ROOT } from './gh'
import { getFileContent, getDirectory } from './github'
import { parseConfig } from './config'
import { parseFrontmatter } from './frontmatter'
import type { Skill, Harness, GatewayProvider } from './types'

export interface SkillsData {
  skills: Skill[]
  model: string
  harness: Harness
  gateway: { provider: GatewayProvider }
  repo: string
  jsonrenderEnabled: boolean
}

// Resolve the managed repo's owner/name, preferring the explicit GITHUB_REPO
// (hosted mode) and falling back to the origin remote (local mode).
export function getRepoSlug(): string {
  if (process.env.GITHUB_REPO) return process.env.GITHUB_REPO
  try {
    const url = execSync('git remote get-url origin', { stdio: 'pipe', cwd: REPO_ROOT }).toString().trim()
    const m = url.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)
    return m ? m[1] : ''
  } catch {
    return ''
  }
}

// The full skill roster: every skill dir joined with its live config from
// aeon.yml, its catalog category, and its pack. Shared by GET /api/skills and
// the `aeon skills` CLI command so both present identical data.
export async function getSkills(): Promise<SkillsData> {
  const [configResult, skillDirs] = await Promise.all([
    getFileContent('aeon.yml'),
    getDirectory('skills'),
  ])
  const config = parseConfig(configResult.content)
  const dirNames = skillDirs.filter(d => d.type === 'dir').map(d => d.name)

  // Canonical slug → category map from the generated catalog (skills.json).
  // Falls back to 'meta' for any skill not yet in the catalog.
  const categoryBySlug: Record<string, string> = {}
  try {
    const { content: catalogRaw } = await getFileContent('catalog/skills.json')
    const catalog = JSON.parse(catalogRaw) as { skills?: Array<{ slug: string; category: string }> }
    for (const s of catalog.skills ?? []) categoryBySlug[s.slug] = s.category
  } catch { /* catalog optional - categories default to meta */ }

  // Canonical slug → pack (key + display name) map from packs.json. The name
  // lets the roster label community packs by their real name. Falls back to 'lab'.
  const packBySlug: Record<string, string> = {}
  const packNameBySlug: Record<string, string> = {}
  try {
    const { content: packsRaw } = await getFileContent('catalog/packs.json')
    const packs = JSON.parse(packsRaw) as { packs?: Array<{ key: string; name?: string; skills?: Array<{ slug: string }> }> }
    for (const p of packs.packs ?? []) for (const s of p.skills ?? []) {
      packBySlug[s.slug] = p.key
      packNameBySlug[s.slug] = p.name ?? p.key
    }
  } catch { /* packs.json optional - packs default to lab */ }

  const meta = await Promise.all(
    dirNames.map(async (name) => {
      try {
        const { content } = await getFileContent(`skills/${name}/SKILL.md`)
        const { description, varHint, tags, requires, mcp } = parseFrontmatter(content)
        return { name, description, varHint, tags, requires, mcp, found: true }
      } catch {
        // No SKILL.md → this is a support/data dir (e.g. skills/security/), not a skill.
        return { name, description: '', varHint: '', tags: [] as string[], requires: [], mcp: [], found: false }
      }
    }),
  )

  const skills: Skill[] = meta
    .filter(m => m.found)
    .map(m => ({
      name: m.name,
      description: m.description,
      varHint: m.varHint,
      tags: m.tags,
      requires: m.requires,
      mcp: m.mcp,
      category: categoryBySlug[m.name] || 'meta',
      pack: packBySlug[m.name] || 'lab',
      packName: packNameBySlug[m.name] || '',
      enabled: config.skills[m.name]?.enabled ?? false,
      schedule: config.skills[m.name]?.schedule || '0 12 * * *',
      var: config.skills[m.name]?.var || '',
      model: config.skills[m.name]?.model || '',
      harness: config.skills[m.name]?.harness || '',
    }))

  return {
    skills,
    model: config.model,
    harness: config.harness,
    gateway: config.gateway,
    repo: getRepoSlug(),
    jsonrenderEnabled: config.jsonrenderEnabled,
  }
}
