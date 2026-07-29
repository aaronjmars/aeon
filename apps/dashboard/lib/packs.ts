import { getFileContent, getDirectory } from './github'
import { parseConfig } from './config'
import type { Pack, PackSkill, CommunityPack, PacksResponse } from './types'

interface PacksManifest {
  packs?: Array<{
    key: string
    name: string
    description: string
    color: string
    category: string | null
    default_enabled?: string[]
    skills?: Array<Omit<PackSkill, 'enabled'>>
  }>
}

interface CommunityManifest {
  packs?: Array<Omit<CommunityPack, 'installedCount'>>
}

// The first-party pack catalog (packs.json) joined with live enabled state from
// aeon.yml, plus the community registry (skill-packs.json) joined with on-disk
// installed state. Both manifests are optional; a missing file yields an empty
// list. aeon.yml is NOT optional — an unreadable config throws so the caller
// surfaces the failure instead of rendering every skill as disabled.
// Shared by GET /api/packs and `aeon packs ls`.
export async function getPacks(): Promise<PacksResponse> {
  const config = parseConfig((await getFileContent('aeon.yml')).content)
  // `?.` still needed: a pack skill may simply not be listed in aeon.yml.
  const enabledOf = (slug: string) => config.skills[slug]?.enabled ?? false

  let firstParty: Pack[] = []
  try {
    const { content } = await getFileContent('catalog/packs.json')
    const manifest = JSON.parse(content) as PacksManifest
    firstParty = (manifest.packs ?? []).map(p => {
      const skills: PackSkill[] = (p.skills ?? []).map(s => ({
        slug: s.slug,
        name: s.name,
        description: s.description,
        category: s.category,
        enabled: enabledOf(s.slug),
      }))
      return {
        key: p.key,
        name: p.name,
        description: p.description,
        color: p.color,
        category: p.category,
        default_enabled: p.default_enabled ?? [],
        skills,
        total: skills.length,
        enabled: skills.filter(s => s.enabled).length,
      }
    })
  } catch { /* packs.json optional */ }

  let community: CommunityPack[] = []
  try {
    const { content } = await getFileContent('catalog/skill-packs.json')
    const manifest = JSON.parse(content) as CommunityManifest
    const installed = new Set(
      (await getDirectory('skills')).filter(d => d.type === 'dir').map(d => d.name),
    )
    community = (manifest.packs ?? []).map(p => ({
      ...p,
      installedCount: (p.skills ?? []).filter(s => installed.has(s)).length,
    }))
  } catch { /* skill-packs.json optional */ }

  return { firstParty, community }
}
