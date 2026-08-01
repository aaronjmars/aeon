---
type: Reference
title: "SEO Audit — Fix Reference"
description: "Target values and copy-paste markup patterns for every check the SEO auditor runs."
---

# SEO fix reference

Targets and copy-paste patterns for each check the auditor runs. Use this to
turn a finding into a specific recommendation.

## title
Target: 30–60 characters, unique per page, primary keyword near the front.
```html
<title>Primary Keyword — Secondary Context | Brand</title>
```

## meta_description
Target: 120–160 characters. Not a ranking factor directly, but drives click-through.
Write it like ad copy with a clear value proposition.
```html
<meta name="description" content="One or two sentences that sell the click, 120–160 chars.">
```

## canonical
Every indexable page should point to its own canonical (or the preferred
version if duplicates exist). Prevents duplicate-content dilution.
```html
<link rel="canonical" href="https://example.com/the-page">
```

## indexable
The most catastrophic on-page issue and the easiest to ship by accident: a
`noindex` removes the page from Google entirely. It comes from a `<meta name="robots">`
(or `googlebot`) tag or the `X-Robots-Tag` response header; `none` = `noindex,nofollow`.
A page in your sitemap that also says `noindex` is a silent, total loss of that page —
the sitemap advertises it while the tag tells Google to drop it. Fix: remove the
directive from any page that should rank (it's usually leftover from staging).
```html
<!-- indexable, links followed — the default an ordinary page wants -->
<meta name="robots" content="index, follow">
<!-- deliberately hidden pages (thank-you, staging) — intentional only -->
<meta name="robots" content="noindex, nofollow">
```

## h1 / heading_order
Exactly one H1 describing the page; H2/H3 nest under it without skipping levels
(no H2 → H4). Headings are a content outline for both users and crawlers.

## img_alt
Every meaningful image needs descriptive alt text; decorative images get `alt=""`.
Helps image search and accessibility.
```html
<img src="chart.png" alt="Q3 revenue rose 40% over Q2">
```

## viewport
Required for mobile rendering and mobile-first indexing.
```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

## lang
Declare the page language for correct indexing and accessibility.
```html
<html lang="en">
```

## open_graph / twitter_card
Controls how the page looks when shared. Set title, description, image, url.
```html
<meta property="og:title" content="Page title">
<meta property="og:description" content="Short description">
<meta property="og:image" content="https://example.com/share.jpg">
<meta property="og:url" content="https://example.com/the-page">
<meta name="twitter:card" content="summary_large_image">
```

## structured_data
Add JSON-LD matching the page type (Article, Product, FAQPage, Organization,
BreadcrumbList). Enables rich results. Validate at search.google.com/test/rich-results.
The auditor also checks Article-family markup (Article/BlogPosting/NewsArticle/
TechArticle) for the fields Google needs — `headline`, `author`, `datePublished`
— and warns when they're missing: present-but-incomplete schema earns no rich
result. Add `dateModified` and `image` too for the best result.
```html
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":"...","author":{"@type":"Person","name":"..."},"datePublished":"2026-01-01","dateModified":"2026-01-02","image":"https://example.com/hero.jpg"}
</script>
```

## mixed_content
On an HTTPS page, every subresource (`<img src>`, `<script src>`, `<link href>`
stylesheet, media) must also be HTTPS. Browsers block active mixed content and it
breaks the padlock. Fix by making the URL protocol-relative or explicitly https.
```html
<!-- bad on an https page -->  <img src="http://cdn.example/logo.png">
<!-- good -->                  <img src="https://cdn.example/logo.png">
```

## img_dimensions / img_format
Set explicit `width` and `height` on every `<img>` so the browser reserves space
before the image loads — the main cause of layout shift (CLS). Serve WebP/AVIF
instead of JPEG/PNG/GIF for smaller files and faster LCP.
```html
<img src="hero.webp" alt="…" width="1200" height="630">
```

## word_count
Thin pages (<300 words) often struggle to rank. Depth should match intent —
don't pad; add genuinely useful content.

## response_time / core_web_vitals
Targets (75th percentile of real users): LCP < 2.5s, INP < 200ms, CLS < 0.1.
INP replaced FID in March 2024. The auditor reads **field data** (Chrome UX
Report p75 — the metric Google's page-experience signal actually uses), preferring
page-level, then origin-level; if a URL has too little traffic for field data it
falls back to the lab Lighthouse score and says so. Common wins: compress and
lazy-load images, serve modern formats (WebP/AVIF), defer non-critical JS, use a
CDN, set explicit width/height on media to avoid layout shift.

## robots_txt / sitemap
`/robots.txt` should allow crawling of indexable content and reference the
sitemap. `/sitemap.xml` should list canonical URLs and be submitted in
Search Console.
```
# robots.txt
User-agent: *
Allow: /
Sitemap: https://example.com/sitemap.xml
```

## broken_links
4xx/5xx links waste crawl budget and hurt UX. Fix the target or update/remove
the link.

## Cross-page checks (site mode)

These come from `site_findings[]`, not from any single page.

### duplicate_titles / duplicate_descriptions
Two pages with the same title or description compete for the same query and
split their own signal; Google often drops one from results. Every page needs a
title that names *that* page.
```html
<!-- /docs and /docs/skills must not both say this -->
<title>aeon — Documentation</title>
```

### canonical_targets
A canonical pointing at a different URL tells Google to rank that other page
instead. Legitimate for genuine duplicates (print views, tracked variants);
a mistake anywhere else, and a silent one — the page simply stops appearing.
```html
<!-- on /docs -->
<link rel="canonical" href="https://example.com/docs">
```

### sitemap_coverage
Pages linked from the site but absent from `sitemap.xml`. They can still be
crawled, but they are not being offered for indexing, and their `lastmod` never
reaches Search Console. Add them to the sitemap generator, or remove the link if
the page is deliberately unlisted.

### pages_fetched
A page in the sitemap that will not load is worse than one that is missing: the
sitemap is advertising it to crawlers. Fix the page or drop it from the sitemap.

### sitemap_health
The sitemap should list only canonical, 200, indexable URLs. This flags sitemap
entries that **redirect** (they waste crawl budget — list the destination instead)
or are **`noindex`** (a flat contradiction: the sitemap offers the page for
indexing while the page tells Google to drop it). Fix the page's directive, or
remove the URL from the sitemap generator.
