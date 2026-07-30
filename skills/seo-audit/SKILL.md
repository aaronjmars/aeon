---
type: Skill
mode: read-only
name: SEO Audit
category: dev
description: Daily on-page and technical SEO audit of every page on a site - discovers URLs from the sitemap, scores each page, adds cross-page checks (duplicate titles, canonicals, sitemap gaps), diffs against yesterday, and sends the score line plus any regressions
var: ""
tags: [monitoring, web]
requires: [PAGESPEED_API_KEY?]
capabilities: [external_api, read_only, sends_notifications]
---

Today is ${today}.

> **${var}** — the target **sites**, comma-separated (an origin, not a page:
> `https://www.example.com`). Each site is audited whole and independently. A
> bare host gets `https://` prepended. A path in `${var}` (`…/docs`) still works
> — its origin is what gets crawled.
>
> **Empty `${var}` → there is nothing to audit.** This skill has no built-in
> default site (it ships general-purpose). Log `SEO_NO_TARGET`, send **no**
> notification, and exit clean — a daily "set a target" ping would just get
> muted. Set the target once in the dashboard (the skill's `var`) and it runs
> from the next tick.

## What this does

Discovers every page a site publishes, audits all of them, compares the result
against the previous run, and reports. The heavy lifting (discovery, fetching,
parsing, checking) happens in `scripts/seo-audit.mjs`, which returns
machine-readable findings so you reason over facts instead of eyeballing HTML.

Discovery is sitemap-first: `robots.txt` → `sitemap.xml` (following sitemap
indexes), honouring the robots `*` `Disallow` rules, falling back to a one-hop
crawl of the homepage's internal links when a site has no sitemap. That is the
same list Google works from, so auditing it is auditing what actually ranks.

Auditing the whole site — not three sample templates — is what makes the
cross-page checks possible: duplicate titles, duplicate meta descriptions,
canonicals pointing away from their own page, and pages linked but missing from
the sitemap. None of those are visible from inside a single page, and all of
them are ways a site quietly loses search traffic.

This is on-page and technical SEO only — no keyword research, rank tracking, or
backlink analysis. If a finding would need those, say so rather than guessing.

## Capability notes (read before editing this skill)

This skill is `mode: read-only`, and that is load-bearing:

- The auditor is **Node, not Python**, because `Bash(node:*)` is in the read-only
  capability base while `Bash(python3:*)` is write-tier only
  (`scripts/skill_mode.sh`). Porting it back to Python would force `mode: write`.
- It is **dependency-free stdlib Node**, matching every other helper in
  `scripts/`. There is no install step. If you find yourself wanting a package,
  you are about to break the thing that makes this skill cheap and safe.
- **You have no Write or Edit tool.** Every file this skill produces is written
  with a shell redirection (`>`/`>>`) from an allowed command. The workflow's
  read-only guard reverts writes to code/config paths but **preserves `memory/`
  and `output/`**, which is exactly where this skill writes.
- The guard also appends its own `## seo-audit (read-only)` run-log line, so the
  log entry below is the detail under it, not a duplicate.

`PAGESPEED_API_KEY` is optional. When set, the script folds in Core Web Vitals —
it reads the env var itself, so **never pass the key as a command-line argument**;
the workflow's permission analyzer blocks `$SECRET` expansions on the Bash line.
It prefers **real-user field data** (Chrome UX Report p75 — LCP, **INP** since it
replaced FID in 2024, and CLS — the metrics Google's page-experience signal
actually uses), preferring page-level then origin-level, and falls back to the lab
Lighthouse score only when a URL has too little traffic for field data (the
finding says which). In site mode it samples the entry page only (PageSpeed is
slow and quota-limited; per-page Lighthouse runs would dominate the runtime). When
unset, Core Web Vitals are simply absent. That is a degraded run, not a failed one
— don't mention the missing key in the notification.

## Workflow

1. **Resolve the targets.** Split `${var}` on commas and trim. No confirmation
   step — this runs unattended, so treat `${var}` as final. **If `${var}` is
   empty, there is no site to audit:** log `SEO_NO_TARGET` (Step 8), send no
   notification, and exit. Do not invent a default origin.

2. **Audit each site:**

   ```bash
   node scripts/seo-audit.mjs --site <origin> --format json
   ```

   Useful flags: `--max N` (page cap, default 50) and `--concurrency N`
   (default 4 — politeness as much as speed). Add `--check-links` on the
   **first** site only; it probes up to 40 links and is the slow part. In site
   mode links are deduped across every page first, so a footer link is checked
   once for the whole site rather than once per page.

   A site where no page could be fetched returns `"ok": false` and exits 1.
   Record it and keep going — one dead site must not abort the others. Individual
   pages that fail are reported inside the run as the `pages_fetched` finding.

3. **Read the findings, don't re-derive them.** The report has two levels:
   - `pages[]` — one per URL, each with its own `score`, `summary`, and
     `findings` (same `check` / `status` / `message` / `detail` shape as before).
   - `site_findings[]` — the cross-page checks: `pages_fetched`,
     `duplicate_titles`, `duplicate_descriptions`, `canonical_targets`,
     `sitemap_coverage`.

   The headline `score` is the **mean page score**, and `discovery` records how
   the URLs were found (`sitemap` or `crawl`), how many existed, how many were
   audited, and whether the `--max` cap truncated the run.

4. **Diff against the previous run.** Every run writes its own timestamped
   snapshot (step 5), so the baseline is the **newest snapshot that already
   exists** — i.e. the previous run's, since this run hasn't written its own yet.
   Filenames sort chronologically, so:

   ```bash
   PREV=$(ls -1 memory/seo-audit/*.json 2>/dev/null | sort | tail -1)
   ```

   `$PREV` is the baseline (empty on the very first run). Match pages **by URL**,
   per site, and compare:
   - **New fails** — a check that was `pass`/`warn` yesterday and is `fail` today.
   - **Site score movement** — any change of 3+ points, either direction.
   - **New / removed pages** — URLs in today's sitemap that weren't in
     yesterday's, and vice versa. A page vanishing from the sitemap is a real
     finding; so is a new page shipping with no meta description.
   - **New cross-page problems** — a title or description that became a
     duplicate, a canonical that started pointing elsewhere.
   - **Newly broken links** — URLs in `broken_links` that were not there before.
   - **Fixed** — a check that was `fail`/`warn` yesterday and is `pass` today.
     Report these too; a skill that only ever delivers bad news gets muted.

   Compare **like with like**: a page-level score change is only meaningful
   against the same URL, and the site score is only meaningful when
   `discovery.audited` is roughly the same on both sides. If the page count moved
   a lot, say so instead of attributing the score change to the site's quality.

   If there is no previous file (first run), skip the diff and say so once.

   **Three rules that stop the diff from lying.** Each is here because the diff
   already got it wrong once:

   - **Never claim a fix across an auditor version boundary.** Compare
     `auditor_version` in both files. If they differ, the two runs used
     different rulers: report the movement but label it
     `(auditor v1→v2 — may be the tool, not the site)` and do **not** put it
     under "Fixed". A previous run announced a site had "resolved" a broken
     link that was only ever a bug in this script.
   - **`response_time` never counts as fixed or regressed.** It is a single
     sample over a network and swings hundreds of ms run to run. `866ms → 147ms`
     is weather, not work. Still report it as a finding; just keep it out of the
     movement section unless it stays over threshold for 3+ consecutive runs.
   - **Attribute a fix only to something a human could have changed.** Markup,
     copy, links, headers. If you cannot name the edit that caused it, it is
     noise — leave it out.

5. **Write this run's state** *before* notifying, so the next diff has a baseline
   even if the notification step fails. **One new file per run**, named by a UTC
   timestamp — never overwrite a date-named file. This is what makes a manual
   re-run (or a second scheduled run) safe: it can't clobber or fail to update an
   earlier run's snapshot, and the diff in step 4 always picks up the newest one.
   Shell redirection, not the Write tool. Loop the script over every origin in
   `${var}` and fold the per-site JSON into one snapshot — **redirect the
   script's own output, never retype it:**

   ```bash
   mkdir -p memory/seo-audit
   export STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)   # e.g. 2026-07-24T13-00-07Z
   i=0; files=""
   for site in <each trimmed origin from ${var}>; do
     i=$((i+1))
     node scripts/seo-audit.mjs --site "$site" > "/tmp/seo-$i.json"
     files="$files /tmp/seo-$i.json"
   done
   node -e 'const fs=require("fs"); const sites=process.argv.slice(1).map(f=>JSON.parse(fs.readFileSync(f)));
     console.log(JSON.stringify({date:"${today}",run:process.env.STAMP,sites},null,2))' $files \
     > "memory/seo-audit/${STAMP}.json"
   ```

   **Redirect the script's own JSON; never retype it.** A hand-copied 20-page
   report is where transcription errors and invented numbers come from — and it
   is the file the next diff trusts.

   Snapshots accumulate one per run (older date-named files stay valid — they
   still sort before any timestamped one). This skill is `read-only` and has no
   `rm`, so it cannot prune them itself; if the directory ever grows unwieldy,
   clear out old snapshots out-of-band (a write-mode maintenance step or a manual
   sweep). The newest file is all the diff ever needs.

6. **Update the remediation doc, `memory/seo-audit/FIXES.md`.** This is the
   durable half of the skill: the notification is a daily nudge that scrolls
   away, this is the standing work list someone can open and act on. Rewrite it
   in full each run (shell redirection — no Write tool), preserving history from
   the previous copy.

   It carries `type: Reference` frontmatter — `memory/` is an OKF root and CI
   fails on any `.md` there without it.

   Structure, highest-impact first (site names below are placeholders — use the
   real hosts from `${var}`):

   ```markdown
   ---
   type: Reference
   title: "SEO Fixes"
   description: "Standing list of open SEO fixes, refreshed by seo-audit each run."
   ---

   # SEO fixes
   _Updated ${today} · auditor v<n> · example.com 94 (18 pages)_

   ## example.com — open

   ### 1. /docs — meta description is 512 chars (impact: high)
   - **Page:** https://www.example.com/docs → `<head>`
   - **Now:** `"How the product works: ..."` (512 chars)
   - **Target:** 120–160 chars
   - **Fix:**
     ```html
     <meta name="description" content="…the drafted replacement…">
     ```
   - **Why:** Google truncates around 160; the rest is wasted and the snippet
     reads as cut off.
   - **First seen:** 2026-07-21 · **Open for:** 3 runs

   ### 2. site-wide — 18 pages have an image with no alt text (impact: medium)
   - **Pages:** all 18 (`/`, `/docs`, `/blog/*`, …) — one shared component
   - **Fix:** …

   ## example.com — recently fixed
   - 2026-07-24 — /blog: alt text added to all 4 images (was open 3 runs)
   ```

   Rules that keep it useful rather than decorative:
   - **One section per site**, sites ordered by how much work is open.
   - **Group by cause, not by page.** With 18 pages audited, the same warning on
     every one of them is *one* fix in a shared layout component, not 18
     entries — write it once, list the affected pages, and say where the shared
     markup lives if you can tell. Per-page entries are for per-page copy
     (a specific title, a specific meta description).
   - **Draft the actual replacement text**, don't describe it. A title or meta
     description the operator can paste is worth ten "consider shortening".
     Write it in the site's voice and state its character count. For a
     grouped finding, draft the one-line component change instead.
   - **Carry `First seen` and `Open for` forward** from the previous copy. Aging
     is the signal — a finding open for 20 runs is either important or should be
     consciously dropped.
   - **Write clean UTF-8; never carry mojibake forward.** If the previous copy
     shows `Â·` where a `·` belongs, or `â`/`â€"` where a `—`/`→` belongs, that is
     corruption from an earlier run — **fix it, don't reproduce it.** When in
     doubt, use plain ASCII separators (` - `, ` | `) rather than a middot. The
     file is rewritten in full each run, so one clean rewrite ends the cycle.
   - **Move resolved items to `Recently fixed` with the date**, and keep the last
     ~10. Delete older ones; this is a work list, not an archive.
   - **Only genuine, actionable findings.** Same bar as the diff: if a human
     can't act on it, it doesn't belong here.
   - If everything is clear, say so in one line and keep the `Recently fixed`
     section. Don't invent work.

7. **Notify — every day, even when nothing changed** (as long as a target was
   set). This skill is deliberately *not* silent-on-no-signal; the daily score
   line is the point. Keep the unchanged case to a few lines and expand only when
   something moved:

   ```
   SEO — example.com 94 (18 pages) · blog.example.com 92 (11 pages)

   Regressed
   · example.com /docs — meta description removed (was 148 chars, now absent)
     <meta name="description" content="How the product works: architecture,
     the self-healing loop, persistent memory.">  (118 chars)

   Weakest pages
   · example.com /pricing 84 · /contact 88 — both short on body copy

   Top open fix
   · example.com /docs title 63 chars → trim to ≤60:
     "Docs: Skills, Memory, Self-Healing, Chains"  (42 chars)

   11 other open fixes · full list in [FIXES.md](…)
   ```

   With two sites and ~30 pages the score line is the headline, not a list of
   pages: one line per site, then only what moved. Name the site on every page
   reference (`example.com /docs`) — a bare `/docs` is ambiguous once more than
   one site is audited. Include the "weakest pages" line only when a page sits
   clearly below its site's average.

   Send it with `./notify -f <file>.md` (multi-line always goes through `-f`).

   **Write that body under `/tmp/`, never `memory/` or `output/`.** Those two are
   preserved by the read-only guard and committed by the post-run step, so a
   scratch notify body written there ships as junk — and an untyped `.md` under
   `memory/` (an OKF root) **fails the `ci-okf` check**, which is a red build on
   `main`, not a cosmetic slip. This skill has no `rm`, so it cannot clean up
   after itself; the fix is to never write it there:

   ```bash
   cat > /tmp/seo-notify.md <<'NOTIFY'
   <the digest markdown>
   NOTIFY
   ./notify -f /tmp/seo-notify.md
   ```

   The only files this skill is meant to persist are the Step 5 snapshot
   (`memory/seo-audit/<STAMP>.json`) and the Step 6 `memory/seo-audit/FIXES.md`.

   **Any file you point at must be a clickable link, never a bare path.**
   Telegram delivery runs `parse_mode=HTML` and `scripts/notify_format.py`
   converts `[text](url)` into `<a href="url">text</a>` — but a bare
   `memory/seo-audit/FIXES.md` passes through as dead plain text that nobody can
   open from their phone. Build the URL from the run's own environment so it
   stays correct in any fork:

   ```bash
   FIXES_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/blob/main/memory/seo-audit/FIXES.md"
   ```

   then write the pointer as `[FIXES.md]($FIXES_URL)`. Same rule for the audited
   pages — `[docs](https://www.example.com/docs)` rather than a naked path.

   Detail rules — the difference between a message that gets acted on and one
   that gets skimmed:
   - **Show the current value and the replacement**, both with character counts.
     Never write "consider shortening" when you can write the shorter string.
   - **One concrete fix in the message**, the highest-impact open item. The rest
     lives in `FIXES.md`; the notification points there with a count. A wall of
     five findings every morning gets muted.
   - **Name the page and the element**, not just the check
     (`docs → <head> meta description`, not `meta_description`).
   - **Say what the reader loses**, in plain terms — "Google cuts the snippet at
     ~160 chars" beats "suboptimal length".
   - `references/checklist.md` has the target and a copy-paste pattern for
     every check.

8. **Log it.** Append to `memory/logs/${today}.md` under a `### seo-audit`
   heading — again by redirection — recording the per-URL scores, what
   regressed, what was fixed, and any URL that failed to fetch. If `${var}` was
   empty, log a single `SEO_NO_TARGET` line and nothing else.

## Prioritizing what to report

Order fixes by impact, not by the order they appear in the findings:

- **Fix first (fail):** a page that failed to fetch, a page set to **`noindex`**
  that should rank (the `indexable` check — a page in the sitemap that is also
  `noindex` is a self-contradiction and a silent, total loss of that page),
  missing title, missing meta description, no H1, no viewport, not HTTPS, broken
  links, failing Core Web Vitals.
- **Then (warn):** duplicate titles or descriptions, canonicals pointing
  elsewhere, sitemap URLs that noindex/redirect (`sitemap_health`), pages linked
  but missing from the sitemap, mixed (http) content on an https page, images
  missing width/height, incomplete Article schema, length tuning, multiple H1s,
  missing alt text, no canonical, thin content, incomplete Open Graph.
- **Nice to have (info):** legacy image formats (WebP/AVIF), structured-data
  opportunities, social cards.

A cross-page finding usually outranks a single page's warning: one duplicate
title costs two pages at once, and a canonical pointing away can remove a page
from search entirely. Likewise **weight by reach** — the same warning on 18 of
18 pages is a bigger deal than a worse warning on one blog post.

Cap the notification at the top 5 items. Everything else lives in the JSON and
the log — a daily message nobody finishes reading is a muted message.

## Interpreting the score

The score is a rough health signal (pass = full credit, warn = half, fail = none;
info is not scored), **impact-weighted** — a missing `<title>`, a `noindex`, or
no HTTPS costs far more than a missing `twitter:card` (weights live in `WEIGHTS`
in the auditor). It is not a Google ranking. Treat it as a before/after
yardstick, not a promise about SERP position. Never claim a change guarantees
higher rankings — outcomes depend on competition, content quality, and off-page
factors this skill doesn't measure.

## Limits

- One site per script run. The workflow above loops over `${var}`.
- **Discovery is only as good as the sitemap.** A page absent from `sitemap.xml`
  and unlinked from the pages that are in it will not be audited. The
  `sitemap_coverage` finding catches the linked-but-unlisted case; nothing
  catches a page that is both unlisted and unlinked.
- **`--max` truncates the tail.** The cap keeps the homepage and shallow pages
  and drops the deepest paths (usually dated posts). When
  `discovery.truncated` is true, say so — a score over 50 of 200 pages is not
  the site's score.
- `sitemap_coverage` is skipped entirely on a truncated or crawl-discovered run;
  it would otherwise report the skill's own cap as missing pages.
- Sees the initial HTML response, not JavaScript-rendered content — the scanner
  reads raw markup. For heavy SPAs, findings reflect the pre-hydration DOM and
  Google may render more; flag server-side rendering or prerendering if key
  content is missing from the raw HTML. Worth stating the first time a target
  looks SPA-shaped, then not repeating it daily.
- On-page and technical only. No keyword research, rank tracking, or backlinks.
- Never edit the audited site. This skill reports; a human decides what ships.
