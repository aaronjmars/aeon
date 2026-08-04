import { CATEGORIES } from './constants'
import type { SkillKeyRef, SkillMcpRef } from './types'

export interface Frontmatter {
  name: string
  category: string
  description: string
  varHint: string
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
  // Match `category:` whether top-level (legacy) or indented under `metadata:`
  // (spec form); preserve its existing indentation on replace.
  const ci = lines.findIndex(l => /^[ \t]*category:/.test(l))
  if (ci !== -1) {
    const indent = lines[ci].match(/^[ \t]*/)?.[0] ?? ''
    lines[ci] = `${indent}category: ${category}`
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

  // Display name: the Agent Skills spec form puts the human title under
  // `metadata: title:` (top-level `name:` is the lowercase slug identifier).
  // Prefer the title; fall back to the legacy top-level `name:`.
  const title = unquote(block.match(/^[ \t]*title:\s*(.+)/m)?.[1] ?? '')
  const name = title || unquote(block.match(/^name:\s*(.+)/m)?.[1] ?? '')
  // `category:` / `var:` may be top-level (legacy) or nested under `metadata:`
  // (spec form). `^[ \t]*` matches either. tags/requires/mcp below use
  // `extractList`, which handles both inline `[...]` and block `- item` lists at
  // any indentation.
  const category = unquote(block.match(/^[ \t]*category:\s*(.+)/m)?.[1] ?? '')

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

  // `var:` is an optional per-skill hint for the run input - a one-line grammar /
  // example of what to type (e.g. deploy-uni-hook's "arm:/template:/chain:" prefixes).
  // Surfaced under the Skill-settings input as help text; empty for most skills.
  const varHint = unquote(block.match(/^var:\s*(.+)/m)?.[1] ?? '')

  const tags = extractList(block, 'tags')

  // `requires:` declares the third-party credentials a skill needs to function.
  // A list of env-var names; a trailing `?` marks a key as optional (the skill
  // still runs without it, just degraded / rate-limited). Names reference the
  // central credential registry surfaced in the dashboard's Settings → Access
  // Keys vault. Inline or block form:
  //   requires: [XAI_API_KEY, COINGECKO_API_KEY?]
  //   requires:
  //     - XAI_API_KEY
  //     - COINGECKO_API_KEY?
  const requires: SkillKeyRef[] = extractList(block, 'requires')
    .map(raw => {
      const optional = raw.endsWith('?')
      return { key: raw.replace(/\?$/, '').trim(), optional }
    })
    .filter(r => /^[A-Z][A-Z0-9_]+$/.test(r.key))

  // `mcp:` declares the MCP servers a skill needs. Same shape/semantics as
  // `requires:` (trailing `?` = "works better with"), but slugs reference the
  // MCP catalog (lib/mcp-catalog.ts) surfaced on the dashboard's MCP page.
  //   mcp: [base, glim?]
  const mcp: SkillMcpRef[] = extractList(block, 'mcp')
    .map(raw => {
      const optional = raw.endsWith('?')
      return { slug: raw.replace(/\?$/, '').trim().toLowerCase(), optional }
    })
    .filter(r => /^[a-z][a-z0-9-]+$/.test(r.slug))

  return { name, category, description, varHint, tags, requires, mcp }
}

// Extract a frontmatter list value (`key:`) as trimmed string items. Handles
// both the inline flow form `key: [a, b]` and the block form (`key:` on its own
// line followed by `- item` lines), at any indentation - so the Agent Skills
// spec form (lists nested under `metadata:` in block style) parses correctly.
function extractList(block: string, key: string): string[] {
  const inline = block.match(new RegExp(`^[ \\t]*${key}:\\s*\\[([^\\]]*)\\]`, 'm'))
  if (inline) return inline[1].split(',').map(t => t.trim()).filter(Boolean)
  const lines = block.split('\n')
  const keyRe = new RegExp(`^[ \\t]*${key}:\\s*(#.*)?$`)
  const idx = lines.findIndex(l => keyRe.test(l))
  if (idx === -1) return []
  const out: string[] = []
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^[ \t]*-\s*(.+?)\s*(?:#.*)?$/)
    if (!m) break
    const v = m[1].trim()
    if (v) out.push(v)
  }
  return out
}

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '')
}
