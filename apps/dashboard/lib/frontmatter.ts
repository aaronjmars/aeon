import { CATEGORIES } from './constants'
import type { SkillKeyRef, SkillMcpRef } from './types'

export interface Frontmatter {
  name: string
  category: string
  description: string
  tags: string[]
  requires: SkillKeyRef[]
  mcp: SkillMcpRef[]
}

// The categories a skill's frontmatter may declare. A skill's category IS its
// pack (one grouping), so this is CATEGORIES — derived rather than restated so
// the two can't drift. `lab` (category `other`) is the catch-all and isn't
// author-selectable, so it's absent from both.
export const SKILL_CATEGORIES: string[] = CATEGORIES.map(c => c.key)

// Insert or replace the frontmatter `category:` line. Returns content unchanged
// when there's no `--- ... ---` block. Mirrors the backfill: replace in place if
// present, else add right after `name:` (or at the top of the block).
export function setFrontmatterCategory(content: string, category: string): string {
  const m = content.match(/^(---\s*\n)([\s\S]*?)(\n---)/)
  if (!m) return content
  const [, open, body, close] = m
  const lines = body.split('\n')
  const ci = lines.findIndex(l => /^category:/.test(l))
  if (ci !== -1) {
    lines[ci] = `category: ${category}`
  } else {
    const ni = lines.findIndex(l => /^name:/.test(l))
    lines.splice(ni === -1 ? 0 : ni + 1, 0, `category: ${category}`)
  }
  return open + lines.join('\n') + close + content.slice(m[0].length)
}

// Parse a SKILL.md's leading `--- ... ---` block. When `description:` is absent,
// fall back to the first non-heading line (truncated to 120 chars).
export function parseFrontmatter(content: string): Frontmatter {
  const block = content.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? ''

  const name = unquote(block.match(/name:\s*(.+)/)?.[1] ?? '')
  const category = unquote(block.match(/^category:\s*(.+)/m)?.[1] ?? '')

  let description = unquote(block.match(/description:\s*(.+)/)?.[1] ?? '')
  if (!description) {
    for (const line of content.split('\n')) {
      const t = line.trim()
      if (t && !t.startsWith('#') && !t.startsWith('---')) {
        description = t.length > 120 ? t.slice(0, 117) + '...' : t
        break
      }
    }
  }

  const tags = parseList(block.match(/tags:\s*\[([^\]]*)\]/)?.[1])

  // `requires:` declares the third-party credentials a skill needs to function.
  // Format mirrors `tags:` - an inline list of env-var names. A trailing `?`
  // marks a key as optional (the skill still runs without it, just degraded /
  // rate-limited). Names reference the central credential registry surfaced in
  // the dashboard's Settings → Access Keys vault.
  //   requires: [XAI_API_KEY, COINGECKO_API_KEY?]
  const requires: SkillKeyRef[] = parseList(block.match(/requires:\s*\[([^\]]*)\]/)?.[1])
    .map(raw => {
      const optional = raw.endsWith('?')
      return { key: raw.replace(/\?$/, '').trim(), optional }
    })
    .filter(r => /^[A-Z][A-Z0-9_]+$/.test(r.key))

  // `mcp:` declares the MCP servers a skill needs. Same shape/semantics as
  // `requires:` (trailing `?` = "works better with"), but slugs reference the
  // MCP catalog (lib/mcp-catalog.ts) surfaced on the dashboard's MCP page.
  //   mcp: [base, glim?]
  const mcp: SkillMcpRef[] = parseList(block.match(/mcp:\s*\[([^\]]*)\]/)?.[1])
    .map(raw => {
      const optional = raw.endsWith('?')
      return { slug: raw.replace(/\?$/, '').trim().toLowerCase(), optional }
    })
    .filter(r => /^[a-z][a-z0-9-]+$/.test(r.slug))

  return { name, category, description, tags, requires, mcp }
}

function parseList(inner: string | undefined): string[] {
  return inner ? inner.split(',').map(t => t.trim()).filter(Boolean) : []
}

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '')
}
