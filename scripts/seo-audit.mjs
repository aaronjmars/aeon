#!/usr/bin/env node
// SEO auditor — on-page and technical checks over raw HTML, one page or a whole site.
//
// Stdlib only, on purpose: every helper in scripts/ runs with zero third-party
// deps, and Bash(node:*) is in the read-only capability base (scripts/skill_mode.sh)
// while Bash(python3:*) is not. Keeping this dependency-free in Node is what lets
// skills/seo-audit run as `mode: read-only` with no install step.
//
// Usage:
//   node scripts/seo-audit.mjs https://example.com                 # one page, JSON
//   node scripts/seo-audit.mjs https://example.com --format text   # readable summary
//   node scripts/seo-audit.mjs https://example.com --check-links   # probe links (slow)
//   node scripts/seo-audit.mjs --site https://example.com          # every page
//   node scripts/seo-audit.mjs --site https://example.com --max 80 --concurrency 6
//
// Site mode discovers URLs from robots.txt + sitemap.xml (recursing into sitemap
// indexes), falls back to a one-hop crawl of the homepage's internal links when a
// site has no sitemap, honours the robots `*` Disallow rules, audits each page,
// and adds cross-page checks a single page cannot see (duplicate titles and
// descriptions, canonical collisions, links to pages missing from the sitemap).
//
// PAGESPEED_API_KEY in the environment adds Core Web Vitals. It is read from the
// env, never an argv — a secret on the agent's Bash line trips the workflow's
// permission analyzer. In site mode it is applied to the first page only: the
// PageSpeed API is slow and quota-limited, and one sample per site is the signal.
//
// Exit code 0 on success, 1 on a fetch failure (site mode: only if no page audited).

export const FAIL = 'fail', WARN = 'warn', PASS = 'pass', INFO = 'info'

// Bump on ANY change to how a check decides its status. Every report carries it,
// and the skill refuses to claim "fixed"/"regressed" across a version boundary.
//
// This exists because of a real miss: v1 reported a phantom broken link, v2 fixed
// the probe, and the next diff proudly announced the site had "resolved" it. The
// site never changed. A day-over-day diff is only meaningful when both sides were
// measured by the same ruler.
//
//   1 — initial release
//   2 — broken_links confirms a failed HEAD with a GET before reporting
//   3 — site mode: page checks decide exactly as in v2, but a run now covers every
//       discovered page and the headline score is a site average, so v2→v3 score
//       movement is the change in coverage, not the site getting better or worse
//   4 — adds the `indexable` check (robots `noindex`/`nofollow` via <meta robots>,
//       <meta googlebot>, or the X-Robots-Tag header). It is a scored finding, so
//       every page gains one denominator and v3→v4 score movement is the new ruler,
//       not the site changing — the skill's version-boundary guard handles that.
//   5 — several changes that all move scores, so they ship under one bump:
//       • core_web_vitals now reads real-user field data (CrUX p75) for LCP/INP/CLS
//         — INP replaced FID in Mar 2024 — and only falls back to the lab score
//       • new checks: mixed_content, img_dimensions, img_format (info)
//       • structured_data now validates Article-family field completeness
//       • the score is impact-weighted (WEIGHTS): a missing <title>/noindex costs
//         far more than a missing twitter:card
//       • robots.txt + sitemap.xml are fetched once per site, not once per page,
//         and reported as site findings (they no longer sit inside each page score)
//       • new cross-page check: sitemap_health (sitemap URLs that noindex/redirect)
//   6 — pagespeed() timeout 60s→150s so Core Web Vitals actually resolve for slow
//       real sites (aeon.fun's Lighthouse run measured ~97s). Combined with a
//       PAGESPEED_API_KEY now being configured, core_web_vitals moves from
//       absent/INFO to a scored field-data finding on the entry page — shifting
//       that page's and the site's score, so v5→v6 movement is the tool, not the
//       site. No decision-logic change; the boundary is here to guard the diff.
//   7 — three false-positive fixes. All of them only ever *removed* warns, so a
//       v6→v7 score rise is the ruler getting more accurate, not the site
//       improving — do not report these as "fixed":
//       • img_alt no longer counts `alt=""` as missing. An empty alt is the
//         explicit, correct way to mark an image decorative; the common case is
//         an icon sitting next to its own text label, where real alt text would
//         make a screen reader announce the name twice. Only a genuinely absent
//         alt attribute is a finding now.
//       • img_alt / img_dimensions skip images hidden from the page (inline
//         display:none / visibility:hidden, the `hidden` attribute, or
//         aria-hidden="true"). They carry no alt semantics and cannot shift
//         layout, and third-party SDKs inject them — a wallet provider
//         preloading its logo produced a site-wide "logo missing alt" finding
//         that stayed open for 7 runs against markup the operator cannot edit.
//       • structured_data understands the `{"@context":…,"@graph":[…]}` envelope.
//         The envelope carries no top-level @type, so reading only the top level
//         reported pages full of schema as having none — and that shape is what
//         Yoast, RankMath and hand-rolled Next.js helpers all emit.
export const AUDITOR_VERSION = 7

const UA = 'Mozilla/5.0 (compatible; SEOAuditBot/1.0; +https://github.com/aeonfun/aeon) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

export const finding = (check, status, message, detail = null) =>
  ({ check, status, message, detail })

// --- Tiny HTML scanner -----------------------------------------------------
// Not a parser: a tag scanner. The checks below only ever need "every <meta>
// and its attributes", never a DOM tree, so a scan is enough and keeps this
// dependency-free. Consequence: it sees the raw HTML response, exactly like
// the Python original did via bs4 — no JS-rendered content either way.

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g

export function parseAttrs(raw) {
  const out = {}
  for (const m of String(raw).matchAll(ATTR_RE)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}

// Is this <img> hidden from the rendered page? Covers the two forms a raw-HTML
// scanner can actually see: `aria-hidden="true"` and an inline display:none /
// visibility:hidden. Both are what third-party SDKs use for injected preload
// images, which is the case this guard exists for.
//
// Two deliberate blind spots, both fine because this is a false-positive guard
// and not a rendering engine — under-detecting merely leaves today's behaviour:
//   • a bare `hidden` attribute. ATTR_RE only captures attributes that carry a
//     value, so a valueless one never reaches this function. Teaching the shared
//     parser about boolean attributes would change what every other check sees,
//     which is far more risk than this rare case is worth.
//   • hiding via a stylesheet class rather than an inline style.
export function hiddenImg(img) {
  if (String(img['aria-hidden'] || '').toLowerCase() === 'true') return true
  return /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)\s*(;|$)/i.test(img.style || '')
}

// Every <name …> in source order, as attribute objects.
export function tags(html, name) {
  const re = new RegExp(`<${name}\\b([^>]*)>`, 'gi')
  return [...html.matchAll(re)].map((m) => parseAttrs(m[1]))
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'",
}

export function decode(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, ent) => {
    const key = ent.toLowerCase()
    if (key in ENTITIES) return ENTITIES[key]
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16))
    if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10))
    return whole
  })
}

// Visible body text: drop non-rendered blocks first, then all markup.
export function visibleText(html) {
  return decode(
    html
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim()
}

const first = (arr, pred) => arr.find(pred)

// --- The checks ------------------------------------------------------------
// Pure: HTML in, findings out. No network, so the tests can drive it directly.

export function analyze(html, { url, statusCode, finalUrl, elapsedMs, robotsHeader = null }) {
  const findings = []
  const parsed = new URL(url)

  findings.push(finding('https', parsed.protocol === 'https:' ? PASS : FAIL,
    parsed.protocol === 'https:' ? 'Served over HTTPS' : 'Not served over HTTPS'))

  findings.push(finding('status_code', statusCode === 200 ? PASS : WARN,
    `HTTP ${statusCode}`,
    { final_url: finalUrl, redirected: finalUrl !== url }))

  findings.push(finding('response_time',
    elapsedMs < 800 ? PASS : (elapsedMs < 2500 ? WARN : FAIL),
    `HTML responded in ${elapsedMs} ms`, { ms: elapsedMs }))

  // Title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? decode(titleMatch[1]).trim() : ''
  if (!title) {
    findings.push(finding('title', FAIL, 'Missing <title> tag'))
  } else {
    const n = title.length
    const status = n >= 30 && n <= 60 ? PASS : WARN
    findings.push(finding('title', status,
      `Title is ${n} chars${status === PASS ? '' : ' (aim for 30–60 chars)'}`, { title }))
  }

  // Meta description
  const metas = tags(html, 'meta')
  const descTag = first(metas, (m) => (m.name || '').toLowerCase() === 'description')
  const desc = descTag ? decode(descTag.content || '').trim() : ''
  if (!desc) {
    findings.push(finding('meta_description', FAIL, 'Missing meta description'))
  } else {
    const n = desc.length
    const status = n >= 120 && n <= 160 ? PASS : WARN
    findings.push(finding('meta_description', status,
      `Meta description is ${n} chars${status === PASS ? '' : ' (aim for 120–160 chars)'}`,
      { description: desc }))
  }

  // Canonical
  const canonical = first(tags(html, 'link'),
    (l) => (l.rel || '').toLowerCase().includes('canonical') && l.href)
  findings.push(canonical
    ? finding('canonical', PASS, 'Canonical URL declared', { canonical: canonical.href })
    : finding('canonical', WARN, 'No canonical URL declared'))

  // Indexability — the single most catastrophic on-page issue, and the one most
  // often shipped by accident: a `noindex` left over from staging, applied to a
  // shared template, or emitted for the wrong route removes the page from search
  // entirely. Sources are a <meta name="robots">/<meta name="googlebot"> tag or
  // the X-Robots-Tag response header; `none` is shorthand for noindex,nofollow.
  const robotsMetas = metas.filter(
    (m) => ['robots', 'googlebot'].includes((m.name || '').toLowerCase()))
  const directives = [...robotsMetas.map((m) => m.content || ''), robotsHeader || '']
    .join(',').toLowerCase()
  const noindex = /\bnoindex\b|\bnone\b/.test(directives)
  const nofollow = /\bnofollow\b|\bnone\b/.test(directives)
  const robotsDetail = { robots: robotsMetas.map((m) => m.content), x_robots_tag: robotsHeader }
  if (noindex) {
    findings.push(finding('indexable', FAIL,
      'Page is set to noindex — search engines will drop it', robotsDetail))
  } else if (nofollow) {
    findings.push(finding('indexable', WARN,
      'Page is nofollow — no link equity is passed from here', robotsDetail))
  } else {
    findings.push(finding('indexable', PASS, 'Indexable (no robots noindex)'))
  }

  // Mixed content — subresources pulled over http on an https page. Browsers
  // block active mixed content and it undermines the "secure" signal. Only
  // subresources count: `src=` (img/script/iframe/media) and stylesheet-ish
  // <link href>. Plain <a href="http://…"> is navigation, not a subresource, so
  // it is deliberately excluded.
  if (parsed.protocol === 'https:') {
    const srcHttp = [...html.matchAll(/\bsrc\s*=\s*["'](http:\/\/[^"']+)/gi)].map((m) => m[1])
    const linkHttp = tags(html, 'link')
      .filter((l) => /^http:\/\//i.test(l.href || '')).map((l) => l.href)
    const mixed = [...new Set([...srcHttp, ...linkHttp])]
    findings.push(mixed.length
      ? finding('mixed_content', WARN,
        `${mixed.length} resource(s) loaded over http on an https page`,
        { examples: mixed.slice(0, 5) })
      : finding('mixed_content', PASS, 'No mixed (http) content'))
  }

  // Headings
  const h1Bodies = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)]
  if (h1Bodies.length === 0) {
    findings.push(finding('h1', FAIL, 'No <h1> on the page'))
  } else if (h1Bodies.length === 1) {
    findings.push(finding('h1', PASS, 'Exactly one <h1>',
      { text: visibleText(h1Bodies[0][1]).slice(0, 120) }))
  } else {
    findings.push(finding('h1', WARN, `${h1Bodies.length} <h1> tags (prefer one)`))
  }

  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]))
  const skips = []
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) skips.push(`h${levels[i - 1]}->h${levels[i]}`)
  }
  findings.push(skips.length
    ? finding('heading_order', WARN, 'Heading levels are skipped', { skips })
    : finding('heading_order', PASS, 'Heading hierarchy is sequential'))

  // Images — alt text (accessibility + image search), explicit dimensions
  // (reserve space → no layout shift, a CLS win), and modern formats.
  const imgs = tags(html, 'img')
  // Images hidden from the page are excluded from both image checks: they carry
  // no alt semantics and cannot shift layout. This matters because third-party
  // SDKs inject them — a wallet provider preloading its logo as a display:none
  // <img> is markup the operator cannot edit, and counting it produced a
  // "missing alt on every page" finding that stayed open for weeks.
  const shown = imgs.filter((i) => !hiddenImg(i))
  if (shown.length === 0) {
    findings.push(finding('img_alt', INFO,
      imgs.length ? `No visible <img> tags (${imgs.length} hidden)` : 'No <img> tags found'))
  } else {
    // Only a genuinely ABSENT alt attribute is a finding. `alt=""` is the
    // explicit, correct way to mark an image decorative — typically an icon
    // beside its own text label, where real alt text would make a screen reader
    // announce the same name twice.
    const missingAlt = shown.filter((i) => i.alt === undefined).map((i) => i.src || '?')
    findings.push(missingAlt.length
      ? finding('img_alt', WARN, `${missingAlt.length}/${shown.length} images missing alt text`,
        { examples: missingAlt.slice(0, 5) })
      : finding('img_alt', PASS, `All ${shown.length} images have alt text`))

    const noDim = shown
      .filter((i) => !((i.width || '').trim() && (i.height || '').trim()))
      .map((i) => i.src || '?')
    findings.push(noDim.length
      ? finding('img_dimensions', WARN,
        `${noDim.length}/${shown.length} images missing width/height (layout-shift risk)`,
        { examples: noDim.slice(0, 5) })
      : finding('img_dimensions', PASS, 'Every image sets width and height'))

    const legacy = [...new Set(shown.map((i) => i.src || '')
      .filter((s) => /\.(jpe?g|png|gif)(\?|#|$)/i.test(s)))]
    if (legacy.length) {
      findings.push(finding('img_format', INFO,
        `${legacy.length} image(s) in legacy formats — WebP/AVIF are smaller`,
        { examples: legacy.slice(0, 5) }))
    }
  }

  // Mobile / viewport / lang
  const viewport = first(metas, (m) => (m.name || '').toLowerCase() === 'viewport')
  findings.push(finding('viewport', viewport ? PASS : FAIL,
    viewport ? 'Viewport meta present' : 'Missing viewport meta (mobile rendering)'))

  const htmlTag = tags(html, 'html')[0] || {}
  findings.push(finding('lang', htmlTag.lang ? PASS : WARN,
    htmlTag.lang ? `lang="${htmlTag.lang}"` : 'No lang attribute on <html>'))

  // Social
  const og = {}
  for (const m of metas) {
    const prop = (m.property || '').toLowerCase()
    if (prop.startsWith('og:')) og[prop] = m.content ?? ''
  }
  const haveOg = Boolean(og['og:title'] && og['og:description'])
  findings.push(finding('open_graph', haveOg ? PASS : WARN,
    haveOg ? 'Open Graph title+description set' : 'Incomplete Open Graph tags', { og }))

  const tw = first(metas, (m) => (m.name || '').toLowerCase() === 'twitter:card')
  findings.push(finding('twitter_card', tw ? PASS : INFO,
    tw ? 'twitter:card set' : 'No twitter:card tag'))

  // Structured data (JSON-LD) — collect the objects, not just their @types, so
  // Article-family markup can be validated for the fields Google needs to grant
  // a rich result (headline, author, datePublished). Present-but-incomplete is a
  // warn: the schema is there but won't earn the rich result it was added for.
  const ldObjects = []
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = parseAttrs(m[1])
    if ((attrs.type || '').toLowerCase() !== 'application/ld+json') continue
    try {
      const data = JSON.parse(m[2].trim() || '{}')
      for (const it of (Array.isArray(data) ? data : [data])) {
        if (!it || typeof it !== 'object') continue
        // `{"@context":…, "@graph":[…]}` is a standard JSON-LD envelope, and the
        // shape Yoast, RankMath and hand-rolled Next.js helpers all emit. The
        // envelope itself has no @type, so reading only the top level reported
        // pages full of schema as having none.
        const nodes = Array.isArray(it['@graph']) ? it['@graph'] : [it]
        for (const n of nodes) {
          if (n && typeof n === 'object' && n['@type']) ldObjects.push(n)
        }
      }
    } catch { /* malformed JSON-LD is a non-event; the check just won't credit it */ }
  }
  const types = ldObjects.map((o) => o['@type'])
  const ARTICLE_TYPES = ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle']
  const incompleteArticles = []
  for (const o of ldObjects) {
    const t = [].concat(o['@type']).map(String)
    if (!t.some((x) => ARTICLE_TYPES.includes(x))) continue
    const missing = ['headline', 'author', 'datePublished'].filter((f) => !o[f])
    if (missing.length) incompleteArticles.push({ type: t.join('/'), missing })
  }
  if (!types.length) {
    findings.push(finding('structured_data', INFO, 'No JSON-LD structured data', { types: [] }))
  } else if (incompleteArticles.length) {
    const gaps = [...new Set(incompleteArticles.flatMap((a) => a.missing))]
    findings.push(finding('structured_data', WARN,
      `Article schema is missing ${gaps.join(', ')}`, { types, incomplete: incompleteArticles }))
  } else {
    findings.push(finding('structured_data', PASS,
      `Schema.org types: ${types.join(', ')}`, { types }))
  }

  // Content depth
  const words = visibleText(html).split(' ').filter(Boolean).length
  findings.push(finding('word_count', words >= 300 ? PASS : WARN,
    `~${words} words of body text`, { words }))

  // Links
  const internal = [], external = []
  for (const a of tags(html, 'a')) {
    const href = a.href
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue
    let full
    try { full = new URL(href, url) } catch { continue }
    ;(full.host === parsed.host ? internal : external).push(full.href)
  }
  findings.push(finding('links', INFO,
    `${internal.length} internal, ${external.length} external links`,
    { internal: internal.length, external: external.length }))

  return { findings, links: [...internal, ...external] }
}

// Per-check weight in the health score. Not every check is equally consequential:
// a missing <title> or a `noindex` can cost a page all its traffic, while a
// missing twitter:card costs a nicer preview card. Unlisted checks default to 1.
export const WEIGHTS = {
  indexable: 3, https: 3, title: 3,
  canonical: 2, status_code: 2, viewport: 2, core_web_vitals: 2,
  meta_description: 1.5, h1: 1.5, broken_links: 1.5,
  heading_order: 0.5, lang: 0.5, open_graph: 0.5, twitter_card: 0.5,
  structured_data: 0.5, response_time: 0.5, img_dimensions: 0.5,
}

export function score(findings) {
  const counts = { [FAIL]: 0, [WARN]: 0, [PASS]: 0, [INFO]: 0 }
  // Impact-weighted: full credit for pass, half for warn, none for fail, each
  // scaled by its check's weight. Info is not scored. Counts stay raw (unweighted)
  // for display.
  let credit = 0, total = 0
  for (const f of findings) {
    counts[f.status]++
    if (f.status === INFO) continue
    const w = WEIGHTS[f.check] ?? 1
    total += w
    if (f.status === PASS) credit += w
    else if (f.status === WARN) credit += 0.5 * w
  }
  const value = total ? Math.round(100 * credit / total) : 0
  return { score: value, summary: counts }
}

// --- Network ---------------------------------------------------------------

async function get(url, { method = 'GET', timeout = 20000 } = {}) {
  return fetch(url, {
    method,
    headers: { 'User-Agent': UA },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  })
}

// Probe one link: cheap HEAD first, then *confirm* any apparent failure with a
// GET before calling it broken.
//
// This second step is not belt-and-braces. A HEAD that 405s, gets throttled, or
// times out is routine on CDNs — the first live run reported aeon.fun's
// /transparency as "unreachable" when the page in fact answers HEAD 200. One
// transient blip became a `fail` finding that cost 6 points and would have sent
// a wrong alert every morning. False alarms are how a daily skill gets muted, so
// a link is only broken when a real GET also says so.
export async function probeLink(link, { fetchImpl = get } = {}) {
  try {
    const head = await fetchImpl(link, { method: 'HEAD', timeout: 10000 })
    if (head.status < 400) return null
  } catch { /* inconclusive — fall through to the GET */ }

  try {
    const res = await fetchImpl(link, { method: 'GET', timeout: 15000 })
    return res.status >= 400 ? { url: link, status: res.status } : null
  } catch {
    return { url: link, status: 'unreachable' }
  }
}

export async function checkLinks(links, opts = {}) {
  const broken = []
  for (const link of [...new Set(links)].slice(0, 40)) { // cap to stay fast
    const bad = await probeLink(link, opts)
    if (bad) broken.push(bad)
  }
  return broken
}

// --- Discovery -------------------------------------------------------------
// "Every page" means every page the site itself publishes: its sitemap. That is
// the same list Google works from, so auditing it is auditing what ranks.

// The `*` group's Disallow prefixes, plus any Sitemap: lines. Deliberately crude
// — no Allow re-inclusion, no wildcards, no crawl-delay. Consecutive User-Agent
// lines form one group, which is why the group is collected before rules apply.
export function parseRobots(txt) {
  const sitemaps = [], disallow = []
  let group = [], collecting = false
  for (const raw of String(txt).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (key === 'sitemap') { if (value) sitemaps.push(value); continue }
    if (key === 'user-agent') {
      if (!collecting) group = []
      group.push(value)
      collecting = true
      continue
    }
    collecting = false
    if (key === 'disallow' && value && group.includes('*')) disallow.push(value)
  }
  return { sitemaps, disallow }
}

// Prefix match, which is all the Disallow lines in the wild here need.
export const isAllowed = (pathname, disallow = []) =>
  !disallow.some((d) => pathname.startsWith(d))

// A <urlset> yields page URLs; a <sitemapindex> yields more sitemaps to follow.
export function parseSitemap(xml) {
  const locs = [...String(xml).matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)]
    .map((m) => decode(m[1]).trim())
    .filter(Boolean)
  return /<sitemapindex\b/i.test(xml) ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] }
}

const ASSET_RE =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|map|json|xml|txt|pdf|zip|gz|mp4|webm|woff2?|ttf|rss)$/i

// Same URL written two ways is one page: drop the fragment and the trailing
// slash so `/docs`, `/docs/`, and `/docs#intro` don't get audited three times.
export function normalizeUrl(href, base) {
  let u
  try { u = new URL(String(href), base) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  u.hash = ''
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '')
  return u.href
}

// Home first, then shallow pages, then alphabetical — so a `--max` cut keeps the
// pages that matter and drops the long tail of dated posts.
const byImportance = (a, b) => {
  const depth = (u) => new URL(u).pathname.split('/').filter(Boolean).length
  return depth(a) - depth(b) || a.localeCompare(b)
}

export async function discoverUrls(origin, { max = 50, fetchImpl = get } = {}) {
  const base = new URL(/^https?:\/\//i.test(origin) ? origin : `https://${origin}`)
  const text = async (url, timeout = 15000) => {
    try {
      const r = await fetchImpl(url, { timeout })
      return r.status === 200 ? await r.text() : null
    } catch { return null }
  }

  let sitemaps = [], disallow = []
  const robots = await text(new URL('/robots.txt', base).href, 10000)
  if (robots) ({ sitemaps, disallow } = parseRobots(robots))

  const queue = [...new Set([...sitemaps, new URL('/sitemap.xml', base).href])]
  const seenSitemaps = new Set()
  const found = new Set()
  let source = 'sitemap'

  while (queue.length && seenSitemaps.size < 20) {
    const sm = queue.shift()
    if (seenSitemaps.has(sm)) continue
    seenSitemaps.add(sm)
    const xml = await text(sm)
    if (!xml) continue
    const parsed = parseSitemap(xml)
    queue.push(...parsed.sitemaps)
    for (const loc of parsed.urls) {
      const n = normalizeUrl(loc, base)
      if (n) found.add(n)
    }
  }

  if (found.size === 0) {
    // No usable sitemap: one hop off the homepage. Enough to reach a small
    // site's real pages without becoming a general-purpose crawler.
    source = 'crawl'
    const html = await text(base.origin)
    for (const a of tags(html || '', 'a')) {
      const n = normalizeUrl(a.href || '', base)
      if (n) found.add(n)
    }
  }
  found.add(normalizeUrl(base.href, base))

  const eligible = [...found].filter((u) => {
    const { host, pathname } = new URL(u)
    return host === base.host && !ASSET_RE.test(pathname) && isAllowed(pathname, disallow)
  }).sort(byImportance)

  return {
    urls: eligible.slice(0, max),
    source,
    discovered: eligible.length,
    truncated: eligible.length > max,
    disallow,
  }
}

// Fixed-size worker pool. Concurrency is politeness as much as speed — a daily
// audit should not look like a burst of load to the site it is auditing.
export async function pool(items, worker, concurrency = 4) {
  const out = new Array(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await worker(items[i], i)
    }
  }
  const workers = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: workers }, run))
  return out
}

// --- Cross-page checks -----------------------------------------------------
// The whole reason to audit a site rather than three templates: duplicate titles,
// duplicate descriptions, and canonicals pointing away are invisible from inside
// a single page and are exactly what flattens a site in search.

const detailOf = (page, check) =>
  page.findings.find((f) => f.check === check)?.detail ?? null

const groupBy = (pages, value) => {
  const map = new Map()
  for (const p of pages) {
    const v = value(p)
    if (!v) continue
    map.set(v, [...(map.get(v) ?? []), p.url])
  }
  return [...map.entries()].filter(([, urls]) => urls.length > 1)
}

export function siteFindings(pages, {
  host = null, audited = [], complete = false, sitemap = false,
} = {}) {
  const findings = []
  const ok = pages.filter((p) => p.ok)
  const failed = pages.filter((p) => !p.ok)

  findings.push(failed.length
    ? finding('pages_fetched', FAIL, `${failed.length}/${pages.length} pages failed to fetch`,
      { failed: failed.map((p) => ({ url: p.url, error: p.error })) })
    : finding('pages_fetched', PASS, `All ${pages.length} pages fetched`))

  const dupTitles = groupBy(ok, (p) => detailOf(p, 'title')?.title)
  findings.push(dupTitles.length
    ? finding('duplicate_titles', WARN, `${dupTitles.length} title(s) reused across pages`,
      { groups: dupTitles.map(([title, urls]) => ({ title, urls })) })
    : finding('duplicate_titles', PASS, 'Every page has a distinct title'))

  const dupDescs = groupBy(ok, (p) => detailOf(p, 'meta_description')?.description)
  findings.push(dupDescs.length
    ? finding('duplicate_descriptions', WARN,
      `${dupDescs.length} meta description(s) reused across pages`,
      { groups: dupDescs.map(([description, urls]) => ({ description, urls })) })
    : finding('duplicate_descriptions', PASS, 'Every page has a distinct meta description'))

  // A canonical that points somewhere else tells Google to rank that other page
  // instead — a silent way for a page to disappear from results.
  const elsewhere = []
  for (const p of ok) {
    const href = detailOf(p, 'canonical')?.canonical
    if (!href) continue
    const target = normalizeUrl(href, p.url)
    if (target && target !== normalizeUrl(p.url, p.url)) {
      elsewhere.push({ url: p.url, canonical: target })
    }
  }
  findings.push(elsewhere.length
    ? finding('canonical_targets', WARN,
      `${elsewhere.length} page(s) canonicalise to a different URL`, { pages: elsewhere })
    : finding('canonical_targets', PASS, 'Every canonical points at its own page'))

  // Only trustworthy when the sitemap was followed in full; a truncated run would
  // report its own `--max` cut as missing pages.
  if (complete && host) {
    const known = new Set(audited)
    const missing = new Set()
    for (const p of ok) {
      for (const link of p.links ?? []) {
        const n = normalizeUrl(link, p.url)
        if (!n) continue
        const { host: h, pathname } = new URL(n)
        if (h !== host || ASSET_RE.test(pathname) || known.has(n)) continue
        missing.add(n)
      }
    }
    findings.push(missing.size
      ? finding('sitemap_coverage', WARN,
        `${missing.size} linked page(s) are not in the sitemap`,
        { pages: [...missing].slice(0, 20) })
      : finding('sitemap_coverage', PASS, 'Every linked page is in the sitemap'))
  }

  // Sitemap self-audit: the pages we fetched in sitemap mode ARE the sitemap's
  // URLs, so we already know which of them are broken. A sitemap should list
  // canonical, 200, indexable pages. One that redirects wastes crawl budget; one
  // that is `noindex` is a flat contradiction — the sitemap advertises it for
  // indexing while the page tells Google to drop it.
  if (sitemap) {
    const problems = []
    for (const p of ok) {
      const idx = p.findings.find((f) => f.check === 'indexable')
      const sc = p.findings.find((f) => f.check === 'status_code')
      if (idx?.status === FAIL) problems.push({ url: p.url, issue: 'noindex' })
      else if (sc?.detail?.redirected) {
        problems.push({ url: p.url, issue: `redirects to ${sc.detail.final_url}` })
      }
    }
    findings.push(problems.length
      ? finding('sitemap_health', WARN,
        `${problems.length} sitemap URL(s) are noindex or redirect — they shouldn't be listed`,
        { problems: problems.slice(0, 20) })
      : finding('sitemap_health', PASS, 'Every sitemap URL is a 200, indexable page'))
  }

  return findings
}

// Turn a PageSpeed Insights v5 response into a core_web_vitals finding. Pure —
// no network — so the tests can drive it with recorded payloads.
//
// Real-user field data (Chrome UX Report, 75th percentile) is what Google's page
// experience signal actually uses, so it wins over the lab Lighthouse score.
// INP replaced FID as the responsiveness metric in March 2024. Field data is
// preferred page-level, then origin-level (low-traffic URLs often have no page
// sample), and only if there is no field data at all does it fall back to lab.
export function cwvFinding(data) {
  const field = data?.loadingExperience?.metrics ? data.loadingExperience
    : (data?.originLoadingExperience?.metrics ? data.originLoadingExperience : null)
  const scope = data?.loadingExperience?.metrics ? 'page'
    : (data?.originLoadingExperience?.metrics ? 'origin' : null)

  const lh = data?.lighthouseResult ?? {}
  const perf = lh.categories?.performance?.score ?? null
  const audits = lh.audits ?? {}
  const lab = {}
  for (const [k, key] of [['lcp', 'largest-contentful-paint'], ['cls', 'cumulative-layout-shift'],
    ['tbt', 'total-blocking-time'], ['inp', 'interaction-to-next-paint']]) {
    if (audits[key]?.displayValue) lab[k] = audits[key].displayValue
  }

  if (field) {
    const m = field.metrics
    const lcp = m.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null
    const inp = m.INTERACTION_TO_NEXT_PAINT?.percentile ?? null
    const clsP = m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile
    const cls = clsP != null ? clsP / 100 : null  // CrUX reports CLS×100
    // Official 2024+ thresholds, p75: good ≤ / poor >.
    const rank = { [PASS]: 0, [WARN]: 1, [FAIL]: 2 }
    const rate = (v, good, poor) => v == null ? PASS : (v <= good ? PASS : (v > poor ? FAIL : WARN))
    const status = [rate(lcp, 2500, 4000), rate(inp, 200, 500), rate(cls, 0.1, 0.25)]
      .reduce((a, b) => (rank[b] > rank[a] ? b : a), PASS)
    const parts = []
    if (lcp != null) parts.push(`LCP ${(lcp / 1000).toFixed(1)}s`)
    if (inp != null) parts.push(`INP ${inp}ms`)
    if (cls != null) parts.push(`CLS ${cls.toFixed(2)}`)
    return finding('core_web_vitals', status,
      `Core Web Vitals (${scope} field, p75): ${parts.join(' · ') || 'no metrics'}`,
      { scope, lcp_ms: lcp, inp_ms: inp, cls, lab_performance: perf, lab })
  }

  if (perf != null) {
    return finding('core_web_vitals', perf >= 0.9 ? PASS : (perf >= 0.5 ? WARN : FAIL),
      `Lighthouse lab performance ${Math.round(perf * 100)}/100 (no field data yet)`,
      { scope: 'lab', lab_performance: perf, lab })
  }
  return finding('core_web_vitals', INFO, 'No Core Web Vitals data available', { scope: null })
}

async function pagespeed(url, key) {
  const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed')
  api.searchParams.set('url', url)
  api.searchParams.set('key', key)
  api.searchParams.set('strategy', 'mobile')
  api.searchParams.append('category', 'performance')
  // PageSpeed runs a full Lighthouse pass server-side and is genuinely slow for
  // real sites — aeon.fun's entry page measured ~97s. 60s timed out and dropped
  // core_web_vitals to INFO every run, so a set PAGESPEED_API_KEY bought nothing.
  const res = await get(api.href, { timeout: 150000 })
  return cwvFinding(await res.json())
}

// robots.txt + sitemap.xml are origin-level, not page-level: in site mode these
// were re-fetched for every one of N pages (2N redundant requests, and N copies
// of the same finding). Fetched once here; auditPage does it in single-page mode,
// auditSite does it once and reports it as a site finding.
export async function originFiles(origin) {
  const findings = []
  for (const [path, name] of [['/robots.txt', 'robots_txt'], ['/sitemap.xml', 'sitemap']]) {
    try {
      const r = await get(origin + path, { timeout: 10000 })
      const ok = r.status === 200
      findings.push(finding(name, ok ? PASS : WARN,
        `${path} ${ok ? 'found' : 'not found'} (HTTP ${r.status})`))
    } catch {
      findings.push(finding(name, WARN, `${path} unreachable`))
    }
  }
  return findings
}

export async function auditPage(url, {
  checkLinks: probeLinks = false, pagespeedKey = null, collectLinks = false,
  originChecks = true,
} = {}) {
  let res, html, elapsedMs
  const started = performance.now()
  try {
    res = await get(url)
    html = await res.text()
    elapsedMs = Math.round(performance.now() - started)
  } catch (e) {
    return { url, ok: false, error: String(e?.message || e), findings: [] }
  }

  const { findings, links } = analyze(html, {
    url, statusCode: res.status, finalUrl: res.url, elapsedMs,
    robotsHeader: res.headers.get('x-robots-tag'),
  })

  if (probeLinks) {
    const broken = await checkLinks(links)
    findings.push(finding('broken_links', broken.length ? FAIL : PASS,
      broken.length ? `${broken.length} broken links` : 'No broken links in sample',
      { broken }))
  }

  // Site mode hoists this to one call per origin (originChecks: false).
  if (originChecks) findings.push(...await originFiles(new URL(url).origin))

  if (pagespeedKey) {
    try {
      findings.push(await pagespeed(url, pagespeedKey))
    } catch (e) {
      // A PageSpeed outage degrades the run; it must not fail it.
      findings.push(finding('core_web_vitals', INFO,
        `PageSpeed lookup failed: ${String(e?.message || e)}`))
    }
  }

  return {
    url, ok: true, auditor_version: AUDITOR_VERSION, ...score(findings), findings,
    ...(collectLinks ? { links } : {}),
  }
}

// --- Site audit ------------------------------------------------------------

export async function auditSite(origin, {
  max = 50, concurrency = 4, checkLinks: probeLinks = false, pagespeedKey = null,
} = {}) {
  const base = new URL(/^https?:\/\//i.test(origin) ? origin : `https://${origin}`)
  const discovery = await discoverUrls(base.href, { max })

  const pages = await pool(discovery.urls, (url, i) => auditPage(url, {
    collectLinks: true,
    // robots.txt + sitemap.xml are origin-level — fetched once below, not per page.
    originChecks: false,
    // PageSpeed is slow and quota-limited, and per-page Lighthouse runs would
    // dominate the runtime; one sample on the entry page is the site's signal.
    pagespeedKey: i === 0 ? pagespeedKey : null,
  }), concurrency)

  // Broken links are a property of the site, not of each page that links to
  // them: probed once against the union, so a footer link is checked once and
  // not once per page.
  if (probeLinks) {
    const all = [...new Set(pages.flatMap((p) => p.links ?? []))]
    const broken = await checkLinks(all)
    for (const p of pages) {
      if (!p.ok) continue
      const bad = broken.filter((b) => (p.links ?? []).includes(b.url))
      p.findings.push(finding('broken_links', bad.length ? FAIL : PASS,
        bad.length ? `${bad.length} broken links` : 'No broken links in sample',
        { broken: bad }))
      Object.assign(p, score(p.findings))
    }
  }

  const site = [
    ...await originFiles(base.origin),
    ...siteFindings(pages, {
      host: base.host,
      audited: discovery.urls,
      complete: !discovery.truncated && discovery.source === 'sitemap',
      sitemap: discovery.source === 'sitemap',
    }),
  ]

  const ok = pages.filter((p) => p.ok)
  const summary = { [FAIL]: 0, [WARN]: 0, [PASS]: 0, [INFO]: 0 }
  for (const p of pages) for (const f of p.findings) summary[f.status]++
  for (const f of site) summary[f.status]++

  return {
    site: base.origin,
    ok: ok.length > 0,
    mode: 'site',
    auditor_version: AUDITOR_VERSION,
    discovery: {
      source: discovery.source,
      discovered: discovery.discovered,
      audited: discovery.urls.length,
      truncated: discovery.truncated,
    },
    // The site score is the mean page score: one bad page among twenty should
    // move it a little, not tank it, and it stays comparable as pages are added.
    score: ok.length ? Math.round(ok.reduce((s, p) => s + p.score, 0) / ok.length) : 0,
    summary,
    site_findings: site,
    // Links were working data for the cross-page checks; they would triple the
    // size of the stored report for no reader.
    pages: pages.map(({ links, ...p }) => p),
  }
}

// --- CLI -------------------------------------------------------------------

function printText(report) {
  if (!report.ok) {
    console.log(`FAILED to audit ${report.url}: ${report.error}`)
    return
  }
  const icon = { [FAIL]: '✗', [WARN]: '!', [PASS]: '✓', [INFO]: '·' }
  const order = { [FAIL]: 0, [WARN]: 1, [INFO]: 2, [PASS]: 3 }
  console.log(`\nSEO audit — ${report.url}`)
  console.log(`Health score: ${report.score}/100   (${report.summary[FAIL]} fail, ` +
    `${report.summary[WARN]} warn, ${report.summary[PASS]} pass)\n`)
  for (const f of [...report.findings].sort((a, b) => order[a.status] - order[b.status])) {
    console.log(`  ${icon[f.status]} [${f.check}] ${f.message}`)
  }
  console.log()
}

function printSiteText(report) {
  const icon = { [FAIL]: '✗', [WARN]: '!', [PASS]: '✓', [INFO]: '·' }
  const d = report.discovery
  console.log(`\nSEO audit — ${report.site}`)
  console.log(`Site score: ${report.score}/100   ${d.audited}/${d.discovered} pages ` +
    `(via ${d.source}${d.truncated ? ', truncated' : ''})\n`)
  for (const f of report.site_findings) {
    if (f.status === PASS) continue
    console.log(`  ${icon[f.status]} [${f.check}] ${f.message}`)
  }
  console.log('\n  page                                     score  fail warn')
  for (const p of [...report.pages].sort((a, b) => (a.score ?? 0) - (b.score ?? 0))) {
    if (!p.ok) { console.log(`  ${new URL(p.url).pathname.padEnd(40)}  FETCH FAILED`); continue }
    console.log(`  ${new URL(p.url).pathname.padEnd(40)} ${String(p.score).padStart(5)} ` +
      `${String(p.summary[FAIL]).padStart(5)}${String(p.summary[WARN]).padStart(5)}`)
  }
  console.log()
}

const numArg = (args, name, fallback) => {
  const i = args.indexOf(name)
  const n = i === -1 ? NaN : Number(args[i + 1])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

async function main(argv) {
  const args = argv.slice(2)
  const flags = new Set(args.filter((a) => a.startsWith('--')))
  const valued = new Set(['--format', '--max', '--concurrency', '--site'])
  const positional = args.filter((a, i) =>
    !a.startsWith('--') && !valued.has(args[i - 1]))

  const siteIdx = args.indexOf('--site')
  let target = siteIdx !== -1 ? (args[siteIdx + 1] ?? positional[0]) : positional[0]
  const siteMode = siteIdx !== -1

  if (!target || target.startsWith('--')) {
    console.error('usage: node scripts/seo-audit.mjs <url> [--format text] [--check-links]\n' +
      '       node scripts/seo-audit.mjs --site <origin> [--max 50] [--concurrency 4]')
    process.exit(1)
  }
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`

  const fmtIdx = args.indexOf('--format')
  const format = fmtIdx !== -1 ? args[fmtIdx + 1] : 'json'
  const pagespeedKey = process.env.PAGESPEED_API_KEY || null

  const report = siteMode
    ? await auditSite(target, {
      max: numArg(args, '--max', 50),
      concurrency: numArg(args, '--concurrency', 4),
      checkLinks: flags.has('--check-links'),
      pagespeedKey,
    })
    : await auditPage(target, { checkLinks: flags.has('--check-links'), pagespeedKey })

  if (format === 'text') (siteMode ? printSiteText : printText)(report)
  else console.log(JSON.stringify(report, null, 2))

  process.exit(report.ok ? 0 : 1)
}

// Only run the CLI when invoked directly, so the test can import this module.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv)
}
