import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { resolve } from 'path'
import { getFileContent, getDirectory, updateFile, deleteDirectory } from '@/lib/github'

function getRepoSlug(): string {
  if (process.env.GITHUB_REPO) return process.env.GITHUB_REPO
  try {
    const url = execSync('git remote get-url origin', { stdio: 'pipe', cwd: resolve(process.cwd(), '..') }).toString().trim()
    // https://github.com/owner/repo.git or git@github.com:owner/repo.git
    const m = url.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)
    return m ? m[1] : ''
  } catch {
    return ''
  }
}

function parseModel(yaml: string): string {
  const match = yaml.match(/^model:\s*(\S+)/m)
  return match?.[1] || 'claude-sonnet-4-6'
}

function parseConfig(yaml: string): Record<string, { enabled: boolean; schedule: string; var: string; model: string }> {
  const skills: Record<string, { enabled: boolean; schedule: string; var: string; model: string }> = {}
  const regex = / {2}([a-z][a-z0-9-]*):\s*\n((?:\s{4}\S.*\n)*)/g
  let match
  while ((match = regex.exec(yaml)) !== null) {
    const name = match[1]
    const block = match[2]
    skills[name] = {
      enabled: /enabled:\s*true/.test(block),
      schedule: block.match(/schedule:\s*"([^"]*)"/)?.[ 1] || '',
      var: block.match(/var:\s*"([^"]*)"/)?.[ 1] || '',
      model: block.match(/model:\s*"([^"]*)"/)?.[ 1] || '',
    }
  }
  return skills
}

function extractDescription(content: string): string {
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (fm) {
    const desc = fm[1].match(/description:\s*(.+)/)
    if (desc) return desc[1].trim().replace(/^['"]|['"]$/g, '')
  }
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (t && !t.startsWith('#') && !t.startsWith('---')) {
      return t.length > 120 ? t.slice(0, 117) + '...' : t
    }
  }
  return ''
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function GET() {
  try {
    const [configResult, skillDirs] = await Promise.all([
      getFileContent('aeon.yml'),
      getDirectory('skills'),
    ])
    const config = parseConfig(configResult.content)
    const dirNames = skillDirs.filter(d => d.type === 'dir').map(d => d.name)

    const descs = await Promise.all(
      dirNames.map(async (name) => {
        try {
          const { content } = await getFileContent(`skills/${name}/SKILL.md`)
          return { name, description: extractDescription(content) }
        } catch {
          return { name, description: '' }
        }
      }),
    )

    const skills = dirNames.map(name => ({
      name,
      description: descs.find(d => d.name === name)?.description || '',
      enabled: config[name]?.enabled ?? false,
      schedule: config[name]?.schedule || '0 12 * * *',
      var: config[name]?.var || '',
      model: config[name]?.model || '',
    }))

    const model = parseModel(configResult.content)
    const repo = getRepoSlug()
    return NextResponse.json({ skills, model, repo })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const { name, enabled, schedule, var: skillVar, model, skillModel } = await request.json()
    const { content, sha } = await getFileContent('aeon.yml')
    let updated = content

    // Update top-level model field
    if (typeof model === 'string' && model) {
      updated = updated.replace(/^model:\s*\S+/m, `model: ${model}`)
    }

    if (typeof enabled === 'boolean') {
      const re = new RegExp(`(  ${escapeRe(name)}:\\n    enabled: )(true|false)`)
      updated = updated.replace(re, `$1${enabled}`)
    }

    if (typeof schedule === 'string' && schedule) {
      const re = new RegExp(
        `(  ${escapeRe(name)}:\\n    enabled: (?:true|false)\\n    schedule: ")[^"]*"`,
      )
      updated = updated.replace(re, `$1${schedule}"`)
    }

    if (typeof skillVar === 'string') {
      const escaped = escapeRe(name)
      const hasVar = new RegExp(`  ${escaped}:[\\s\\S]*?var: "`)
      if (hasVar.test(updated)) {
        // Update existing var line
        const re = new RegExp(
          `(  ${escaped}:\\n    enabled: (?:true|false)\\n    schedule: "[^"]*"\\n    var: ")[^"]*"`,
        )
        updated = updated.replace(re, `$1${skillVar}"`)
      } else if (skillVar) {
        // Add var line after schedule
        const re = new RegExp(
          `(  ${escaped}:\\n    enabled: (?:true|false)\\n    schedule: "[^"]*")`,
        )
        updated = updated.replace(re, `$1\n    var: "${skillVar}"`)
      }
    }

    // Per-skill model override
    if (typeof skillModel === 'string') {
      const escaped = escapeRe(name)
      const hasModel = new RegExp(`  ${escaped}:[\\s\\S]*?model: "`)
      if (hasModel.test(updated)) {
        if (skillModel) {
          // Update existing model line
          const re = new RegExp(
            `(  ${escaped}:\\n(?:    \\S.*\\n)*?    model: ")[^"]*"`,
          )
          updated = updated.replace(re, `$1${skillModel}"`)
        } else {
          // Remove model line (reset to global default)
          const re = new RegExp(
            `(  ${escaped}:\\n(?:    \\S.*\\n)*?)    model: "[^"]*"\\n`,
          )
          updated = updated.replace(re, '$1')
        }
      } else if (skillModel) {
        // Add model line after schedule (or after var if present)
        const hasVar = new RegExp(`  ${escaped}:[\\s\\S]*?var: "`)
        if (hasVar.test(updated)) {
          const re = new RegExp(
            `(  ${escaped}:\\n    enabled: (?:true|false)\\n    schedule: "[^"]*"\\n    var: "[^"]*")`,
          )
          updated = updated.replace(re, `$1\n    model: "${skillModel}"`)
        } else {
          const re = new RegExp(
            `(  ${escaped}:\\n    enabled: (?:true|false)\\n    schedule: "[^"]*")`,
          )
          updated = updated.replace(re, `$1\n    model: "${skillModel}"`)
        }
      }
    }

    if (updated !== content) {
      const msg = model ? `chore: set model to ${model}` : `chore: update ${name} config`
      await updateFile('aeon.yml', updated, sha, msg)
    }

    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { name } = await request.json()
    if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
      return NextResponse.json({ error: 'Invalid skill name' }, { status: 400 })
    }

    // Delete skill directory
    await deleteDirectory(`skills/${name}`, `chore: delete ${name} skill`)

    // Remove from aeon.yml
    try {
      const { content, sha } = await getFileContent('aeon.yml')
      const re = new RegExp(`  ${escapeRe(name)}:\\n(?:    \\S.*\\n)*(?:\\n(?=  [a-z]|  #|\\n|[a-z]|$))?`)
      const updated = content.replace(re, '')
      if (updated !== content) {
        await updateFile('aeon.yml', updated, sha, `chore: remove ${name} from config`)
      }
    } catch { /* config cleanup is best-effort */ }

    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
