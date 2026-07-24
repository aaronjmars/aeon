#!/usr/bin/env node
// gen-agents-md.js — generate AGENTS.md as a FULL, self-contained mirror of
// CLAUDE.md for every non-claude harness (grok / codex / pi / vibe / kimi).
//
// Why a full mirror (it used to carry ONLY STRATEGY.md):
//
// The non-claude harnesses load instruction files VERBATIM — they do not expand
// Claude Code's `@import` directives. Claude reads `CLAUDE.md` and expands its
// `@STRATEGY.md` import itself; the others cannot, so a strategy-only AGENTS.md
// left them with the north-star but WITHOUT the operating manual. Worse, codex's
// native project doc IS `AGENTS.md`, and its `project_doc_fallback_filenames`
// only fires when AGENTS.md is ABSENT — so with a committed AGENTS.md, codex read
// the strategy-only file and never fell back to CLAUDE.md, running under-briefed.
//
// So AGENTS.md is now `CLAUDE.md` with every whole-line `@import` (e.g.
// `@STRATEGY.md`) expanded inline — the same EFFECTIVE instructions Claude Code
// sees after expansion. A harness reading ONLY AGENTS.md now gets the entire
// manual AND the strategy.
//
// Each skill run loads EXACTLY ONE of the two files: `claude` reads CLAUDE.md
// natively; every other harness reads AGENTS.md. `.github/workflows/aeon.yml`
// hides the other file for the run ("Single-source standing instructions"), so a
// harness that natively discovers both (grok) never double-loads them.
//
// AGENTS.md is committed (harnesses read it from the checkout), so regenerate it
// whenever CLAUDE.md or any file it imports (STRATEGY.md) changes:
//
//   node scripts/gen-agents-md.js          # write AGENTS.md
//   node scripts/gen-agents-md.js --check  # verify it's up to date (CI/parity)
//
// Exit 1 in --check mode if AGENTS.md is stale or missing.

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const claudePath = path.join(root, 'CLAUDE.md')
const outPath = path.join(root, 'AGENTS.md')

const BANNER = `<!-- AUTO-GENERATED from CLAUDE.md by scripts/gen-agents-md.js. Do not edit by hand.
     This is the non-claude harnesses' copy of the operating manual: CLAUDE.md with
     its @imports (e.g. @STRATEGY.md) expanded inline, because those harnesses load
     instruction files verbatim and do NOT expand Claude Code @imports. Claude reads
     CLAUDE.md directly; every other harness reads THIS file (aeon.yml hides the
     other one per run so exactly one is loaded). Regenerate after editing CLAUDE.md
     or any file it imports: node scripts/gen-agents-md.js -->
`

// Expand whole-line @imports, mirroring harness-adapter/lib/imports.sh:
// whole-line `@path` only, skip fenced code blocks, resolve ~ / absolute /
// relative paths, fall back to `<path>.md`, up to 4 hops (then inline verbatim).
function expandImports(file, depth) {
  const text = fs.readFileSync(file, 'utf8')
  if (depth >= 4) return text
  const dir = path.dirname(file)
  const out = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) inFence = !inFence
    const m = inFence ? null : line.match(/^@([^\s]+)\s*$/)
    if (m) {
      let target = m[1]
      if (target.startsWith('~/')) target = path.join(process.env.HOME || '', target.slice(2))
      else if (!path.isAbsolute(target)) target = path.join(dir, target)
      let resolved = null
      if (fs.existsSync(target) && fs.statSync(target).isFile()) resolved = target
      else if (fs.existsSync(`${target}.md`)) resolved = `${target}.md`
      if (resolved) {
        out.push(expandImports(resolved, depth + 1).replace(/\n+$/, ''))
        continue
      }
    }
    out.push(line) // non-import line, or an unresolvable @import (kept literal)
  }
  return out.join('\n')
}

function build() {
  const expanded = expandImports(claudePath, 0).replace(/\s+$/, '')
  return `${BANNER}\n${expanded}\n`
}

const generated = build()

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = fs.readFileSync(outPath, 'utf8')
  } catch {
    console.error('AGENTS.md is missing — run: node scripts/gen-agents-md.js')
    process.exit(1)
  }
  if (current !== generated) {
    console.error('AGENTS.md is out of date — run: node scripts/gen-agents-md.js')
    process.exit(1)
  }
  console.log('AGENTS.md is up to date')
  process.exit(0)
}

fs.writeFileSync(outPath, generated)
console.log(`Wrote ${path.relative(root, outPath)} (${generated.length} bytes)`)
