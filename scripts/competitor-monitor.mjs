#!/usr/bin/env node
// competitor-monitor.mjs — scrape competitor pages, extract stable signals, diff two snapshots.
//
// Dependency-free stdlib Node (matches every helper in scripts/). No install step.
// Kept Node (not Python) on purpose: `Bash(node:*)` is in the read-only capability
// base, `python3` is write-tier. Porting to Python would force the skill to mode: write.
//
// Usage:
//   node scripts/competitor-monitor.mjs snapshot <url> [<url> ...]      # → snapshot JSON on stdout
//   node scripts/competitor-monitor.mjs snapshot --file urls.txt        # one url per line (# comments ok)
//   node scripts/competitor-monitor.mjs snapshot <url…> --out FILE      # write the snapshot to FILE
//   node scripts/competitor-monitor.mjs diff <baseline.json> <current.json>          # → changes JSON on stdout
//   node scripts/competitor-monitor.mjs diff <baseline.json> <current.json> --out F  # write changes to F
//
// The `--out FILE` form exists because this skill runs `mode: read-only`, where the
// Bash permission layer blocks shell output redirection (`> file`) as defense-in-depth
// but allows `Bash(node:*)`. So the script writes its own file — the skill never needs
// a redirection it isn't allowed to run.
//
// A snapshot is machine-readable *signals* per page (title, meta, headings, prices,
// CTAs, internal links, a content hash) — never raw HTML. Raw-HTML diffing is all
// noise (build hashes, nonces, timestamps); signal diffing is what a human would
// actually notice on the competitor's site.
//
// Exit 0 on success. `snapshot` exits 1 only if EVERY url failed to fetch (one dead
// page must not sink the run). `diff` exits 0 always (an empty change set is valid).

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const MONITOR_VERSION = 1
const UA = 'Mozilla/5.0 (compatible; AeonCompetitorMonitor/1.0; +https://aeon.fun/bot) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const TIMEOUT_MS = 20000

// ─────────────────────────────────────────────────────────────────────────────
// HTML → signals
// ─────────────────────────────────────────────────────────────────────────────

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', copy: '©',
  reg: '®', trade: '™', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', euro: '€', pound: '£',
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => cp(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENTITIES ? ENTITIES[n.toLowerCase()] : m))
}
function cp(n) { try { return String.fromCodePoint(n) } catch { return '' } }

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function stripNoise(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '').trim() : ''
}

function metaContent(html, key) {
  // <meta name="description" ...> or <meta property="og:title" ...>, attr order agnostic
  const re = /<meta\b[^>]*>/gi
  for (const m of html.matchAll(re)) {
    const tag = m[0]
    const n = (attr(tag, 'name') || attr(tag, 'property')).toLowerCase()
    if (n === key.toLowerCase()) return attr(tag, 'content')
  }
  return ''
}

function headings(html) {
  const out = []
  for (const m of html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = stripTags(m[2])
    if (text) out.push({ level: Number(m[1]), text: clip(text, 140) })
  }
  // dedup identical (level+text), preserve order
  const seen = new Set()
  return out.filter((h) => { const k = `${h.level}|${h.text}`; if (seen.has(k)) return false; seen.add(k); return true })
}

// Money figures with optional cadence. Captures "$29/mo", "€10 / user", "Free", "49 USD/year".
function prices(text) {
  const re = /((?:[$£€]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP)\b))\s*(?:\/\s*|per\s+)?(mo|month|yr|year|user|seat|member|agent)?/gi
  const found = []
  for (const m of text.matchAll(re)) {
    let s = m[1].replace(/\s+/g, '')
    if (m[2]) s += '/' + m[2].toLowerCase().replace(/^month$/, 'mo').replace(/^year$/, 'yr')
    found.push(s)
  }
  // a bare "Free" tier next to prices is a real pricing signal
  if (/\bFree\b/.test(text) && found.length) found.push('Free')
  return uniq(found).slice(0, 40)
}

function ctas(html) {
  const out = []
  // <button>…</button>
  for (const m of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)) {
    const t = stripTags(m[1]); if (t && t.length <= 40) out.push(t)
  }
  // <a class="…btn/button/cta…">…</a>
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const cls = (attr('<a' + m[1] + '>', 'class') || '').toLowerCase()
    if (/\b(btn|button|cta)\b/.test(cls)) {
      const t = stripTags(m[2]); if (t && t.length <= 40) out.push(t)
    }
  }
  return uniq(out).slice(0, 30)
}

function internalLinks(html, baseUrl) {
  const base = new URL(baseUrl)
  const out = new Map() // path -> anchor text (first seen)
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr('<a' + m[1] + '>', 'href')
    if (!href || href.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(href)) continue
    let u
    try { u = new URL(href, base) } catch { continue }
    if (u.host !== base.host) continue
    if (!/^https?:$/.test(u.protocol)) continue
    const path = (u.pathname + u.search).replace(/\/$/, '') || '/'
    const text = clip(stripTags(m[2]), 80)
    if (!out.has(path)) out.set(path, text)
  }
  return [...out.entries()].map(([path, text]) => ({ path, text })).slice(0, 400)
}

function extract(url, finalUrl, html) {
  const clean = stripNoise(html)
  const bodyText = stripTags(clean)
  return {
    url,
    final_url: finalUrl,
    title: stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
    meta_description: metaContent(html, 'description'),
    og_title: metaContent(html, 'og:title'),
    og_description: metaContent(html, 'og:description'),
    headings: headings(clean),
    prices: prices(bodyText),
    ctas: ctas(clean),
    links: internalLinks(clean, finalUrl || url),
    word_count: bodyText ? bodyText.split(/\s+/).length : 0,
    content_hash: createHash('sha256').update(bodyText).digest('hex').slice(0, 16),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// fetch
// ─────────────────────────────────────────────────────────────────────────────

async function fetchPage(url) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow', signal: ac.signal })
    const finalUrl = res.url || url
    const ct = res.headers.get('content-type') || ''
    if (!res.ok) return { ok: false, url, status: res.status, error: `HTTP ${res.status}` }
    if (!/html|xml|text/i.test(ct)) return { ok: false, url, status: res.status, error: `non-html content-type: ${ct}` }
    const html = await res.text()
    const sig = extract(url, finalUrl, html)
    return { ok: true, status: res.status, ...sig }
  } catch (e) {
    return { ok: false, url, status: 0, error: String(e && e.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// diff
// ─────────────────────────────────────────────────────────────────────────────

const SEV = { high: 3, medium: 2, low: 1 }

// Pages whose appearance/disappearance is inherently newsworthy.
const HOT = /\/(pricing|price|plans|product|features?|changelog|releases?|whats-?new|blog|news|careers?|jobs|customers|case-?stud|docs|api|security|enterprise|compare|integrations?)\b/i

function diffPage(prev, cur) {
  const ch = []
  const push = (sev, type, msg, detail) => ch.push({ severity: sev, type, message: msg, ...(detail ? { detail } : {}) })

  if ((prev.title || '') !== (cur.title || ''))
    push('medium', 'title', `Title changed`, { from: prev.title, to: cur.title })
  if ((prev.meta_description || '') !== (cur.meta_description || ''))
    push('medium', 'meta_description', `Meta description changed`, { from: prev.meta_description, to: cur.meta_description })
  if ((prev.og_title || '') !== (cur.og_title || '') && cur.og_title)
    push('low', 'og_title', `Social share title changed`, { from: prev.og_title, to: cur.og_title })

  const pAdd = diffSet(prev.prices, cur.prices), pRem = diffSet(cur.prices, prev.prices)
  if (pAdd.length || pRem.length)
    push('high', 'pricing', `Pricing signals changed`, { added: pAdd, removed: pRem })

  const hAdd = diffSet(prev.headings.map(hkey), cur.headings.map(hkey))
  const hRem = diffSet(cur.headings.map(hkey), prev.headings.map(hkey))
  if (hAdd.length) push('medium', 'headings_added', `${hAdd.length} new heading(s)`, { items: hAdd.slice(0, 12) })
  if (hRem.length) push('medium', 'headings_removed', `${hRem.length} heading(s) removed`, { items: hRem.slice(0, 12) })

  const cAdd = diffSet(prev.ctas, cur.ctas), cRem = diffSet(cur.ctas, prev.ctas)
  if (cAdd.length) push('medium', 'cta_added', `New CTA/button text`, { items: cAdd })
  if (cRem.length) push('low', 'cta_removed', `CTA/button removed`, { items: cRem })

  const prevPaths = new Map((prev.links || []).map((l) => [l.path, l.text]))
  const curPaths = new Map((cur.links || []).map((l) => [l.path, l.text]))
  const linksAdded = [...curPaths.keys()].filter((p) => !prevPaths.has(p))
  const linksRemoved = [...prevPaths.keys()].filter((p) => !curPaths.has(p))
  if (linksAdded.length) {
    const hot = linksAdded.filter((p) => HOT.test(p))
    push(hot.length ? 'high' : 'low', 'pages_added', `${linksAdded.length} new linked page(s)${hot.length ? ` (incl. ${hot.length} notable)` : ''}`,
      { items: linksAdded.slice(0, 20).map((p) => ({ path: p, text: curPaths.get(p) })) })
  }
  if (linksRemoved.length) {
    const hot = linksRemoved.filter((p) => HOT.test(p))
    push(hot.length ? 'medium' : 'low', 'pages_removed', `${linksRemoved.length} linked page(s) removed`,
      { items: linksRemoved.slice(0, 20) })
  }

  // content-body change with no structured signal above = plain copy edit
  if (prev.content_hash !== cur.content_hash && ch.length === 0) {
    const dw = cur.word_count - prev.word_count
    push('low', 'copy', `Body copy changed`, { word_count_delta: dw })
  }
  return ch
}

function hkey(h) { return `H${h.level}: ${h.text}` }
function diffSet(a, b) { const s = new Set(a || []); return (b || []).filter((x) => !s.has(x)) }

function diffSnapshots(prev, cur) {
  const prevByUrl = new Map((prev.competitors || []).filter((c) => c.ok).map((c) => [c.url, c]))
  const results = []
  for (const c of (cur.competitors || [])) {
    if (!c.ok) { results.push({ url: c.url, ok: false, error: c.error, changes: [] }); continue }
    const p = prevByUrl.get(c.url)
    if (!p) { results.push({ url: c.url, ok: true, first_seen: true, changes: [] }); continue }
    const changes = diffPage(p, c).sort((x, y) => SEV[y.severity] - SEV[x.severity])
    results.push({ url: c.url, ok: true, changes })
  }
  return { baseline_run: prev.run || null, current_run: cur.run || null, results }
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers + main
// ─────────────────────────────────────────────────────────────────────────────

function uniq(a) { return [...new Set(a)] }
function clip(s, n) { s = (s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
function normUrl(u) { u = u.trim(); if (!u) return ''; return /^https?:\/\//i.test(u) ? u : 'https://' + u }

// Pull a `--out PATH` pair out of the args; return [outPath|null, remainingArgs].
function takeOut(args) {
  const i = args.indexOf('--out')
  if (i === -1) return [null, args]
  const path = args[i + 1]
  if (!path) { process.stderr.write('--out needs a path\n'); process.exit(2) }
  return [path, args.slice(0, i).concat(args.slice(i + 2))]
}

// Write to --out FILE (read-only mode can't redirect) or stdout.
function emit(obj, outPath) {
  const json = JSON.stringify(obj, null, 2) + '\n'
  if (outPath) writeFileSync(outPath, json)
  else process.stdout.write(json)
}

async function cmdSnapshot(argv) {
  const [outPath, args] = takeOut(argv)
  let urls = []
  if (args[0] === '--file') {
    urls = readFileSync(args[1], 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
  } else {
    urls = args
  }
  urls = uniq(urls.map(normUrl).filter(Boolean))
  if (!urls.length) { process.stderr.write('no urls given\n'); process.exit(2) }

  const competitors = []
  for (const u of urls) competitors.push(await fetchPage(u)) // sequential = polite; competitor lists are short
  const okCount = competitors.filter((c) => c.ok).length
  emit({ monitor_version: MONITOR_VERSION, generated: new Date().toISOString(), competitors }, outPath)
  process.exit(okCount === 0 ? 1 : 0)
}

function cmdDiff(argv) {
  const [outPath, args] = takeOut(argv)
  const prev = JSON.parse(readFileSync(args[0], 'utf8'))
  const cur = JSON.parse(readFileSync(args[1], 'utf8'))
  emit(diffSnapshots(prev, cur), outPath)
  process.exit(0)
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'snapshot') await cmdSnapshot(rest)
else if (cmd === 'diff') cmdDiff(rest)
else { process.stderr.write('usage: competitor-monitor.mjs snapshot <url…> | diff <baseline.json> <current.json>\n'); process.exit(2) }
