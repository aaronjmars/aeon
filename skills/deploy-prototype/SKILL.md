---
name: deploy-prototype
description: Generate a small app or tool and deploy it live to Vercel via API
metadata:
  title: Deploy Prototype
  category: dev
  var: ""
  tags:
    - dev
    - build
  requires:
    - VERCEL_TOKEN?
    - GH_GLOBAL?
---
<!-- autoresearch: variation B — sharper output via prototype quality bar + self-check + signal-anchored record -->

> **${var}** — What to build and deploy.
> - Empty → auto-select from recent signals (articles, logs, memory topics).
> - Plain text (e.g. `market heatmap`) → interpret as a build brief.
> - Typed form `type:slug description` (e.g. `tool:market-heatmap volume heatmap of top-20 tokens`, `viz:tx-graph`, `api:summarize`, `landing:startup-idea`) → use `type` to bias shape and `slug` as the deployment name.

Today is ${today}. Your task is to ship a small, self-contained prototype that someone could actually use in the browser today.

## Steps

1. **Read context.** Read `memory/MEMORY.md` and the most recent entries in `memory/logs/` for active topics.
   If running as part of a chain, scan injected upstream outputs for a concrete artifact worth making interactive.

2. **Pick what to build (if `${var}` is empty or vague).**

   Scan these sources, in order, for prototype-worthy signals:
   - `output/articles/` — last 7 entries by mtime: any claim, finding, or dataset that would be more useful as an interactive page?
   - `memory/topics/*.md` — running narratives; pick one with a live data source (prices, feeds, markets)
   - `memory/logs/${today}.md` and the two prior days — skill outputs flagged as interesting
   - `memory/MEMORY.md` → "Next Priorities" and "Recent Articles"

   Score each candidate 1-5 on:
   - **Leverage** — does an interactive version beat the static write-up?
   - **Concreteness** — is the spec obvious in one sentence? (if no, reject)
   - **Novelty** — haven't shipped this in the last 14 days (check `output/articles/prototype-*.md` by mtime and any `memory/topics/prototypes.md`)

   Pick the highest-total candidate. If no candidate reaches 9/15, skip building and exit as `DEPLOY_PROTOTYPE_EMPTY` (step 9).

   Record the chosen signal — its source file(s) and one-line rationale — you'll use it in steps 6 and 7.

3. **Commit to a shape before writing code.** Before touching `.pending-deploy/`, write out (in your reasoning, not a file):
   - **Slug**: `aeon-prototype-<descriptor>`, all lowercase, `[a-z0-9-]`, 3–50 chars after prefix (e.g. `aeon-prototype-market-heatmap`). If `${var}` supplied a typed slug, use it; otherwise derive one.
   - **Tagline** (≤90 chars) — the one-liner that appears in the page title and OG tags.
   - **Primary action** — what is the one thing a visitor does in the first 10 seconds? (read a number, click a filter, submit an input, compare two things). If you can't name it, go back to step 2.
   - **Shape**: static HTML+JS / static + `api/` function / Next.js. Default to static single-file HTML unless the idea genuinely needs a serverless function.

4. **Write the files.**
   ```bash
   rm -rf .pending-deploy        # clear stale state from prior runs
   mkdir -p .pending-deploy/files
   ```
   Write all project files into `.pending-deploy/files/`. This directory is the repo root — everything here is pushed to GitHub and deployed to Vercel.

   **Quality bar — every prototype must meet these:**
   - **Self-contained** — no external build step where avoidable. Prefer one `index.html` with inline `<style>` and `<script>`; fall back to a `main.css` / `main.js` only when size justifies it.
   - **Loads in <1s on a cold visit.** No jQuery, no CDN UI libraries for a single-page tool. Vanilla JS or a ~10KB util max. No `<link rel="stylesheet">` to a CDN font unless it's one font.
   - **Mobile-first, works on a phone.** Viewport meta set, tap targets ≥40px, no horizontal scroll at 360px wide.
   - **Share-friendly.** Include `<title>`, `<meta name="description">`, `<meta property="og:title">`, `<meta property="og:description">`, `<meta property="og:type" content="website">`. Skip OG image unless you generate one.
   - **Real content, not lorem.** If the prototype shows data, fetch it from a public no-auth endpoint at load time (CoinGecko, GitHub public API, public RSS, public JSON feeds) — or hardcode a recent, realistic snapshot with the timestamp visible. Never ship placeholder `[example data]`.
   - **One visible CTA or primary surface.** Clear hierarchy: what does the visitor look at first?
   - **Works with JS disabled to at least show the tagline** (progressive enhancement — not required for interactive tools, but the title and description must render server-free).
   - **Light + dark via `prefers-color-scheme`** — 4 CSS vars is enough.
   - **No secrets.** No API keys, tokens, or env vars embedded anywhere. If the idea requires auth, redesign around a public endpoint or drop the idea.
   - **Include a `README.md`** in `.pending-deploy/files/` with: what it is (1 line), how to run locally (1 line), signal source (1 line link to the article/log/topic from step 2).

   For **API endpoints**: place handlers in `api/` (e.g. `api/index.js` exporting `export default function handler(req, res) { ... }`).
   For **Next.js**: keep it one page — `package.json` + `pages/index.js`. Only if the idea genuinely needs SSR.

5. **Write deploy metadata.** Create `.pending-deploy/meta.json`:
   ```json
   {
     "name": "aeon-prototype-<slug-from-step-3>",
     "description": "One-sentence description, matches the OG description on the page",
     "framework": null,
     "tagline": "≤90 chars — matches <title> on the page",
     "signal_source": "path or URL of the article/log/topic that triggered this prototype",
     "primary_action": "what the visitor does in the first 10 seconds"
   }
   ```
   - `framework`: `null` for static; `"nextjs"`, `"svelte"`, etc. when used.
   - The extra fields (`tagline`, `signal_source`, `primary_action`) are for the prototype record and downstream dashboards; the deploy step may ignore them.

6. **Build the Vercel deploy payload.** Write `.pending-deploy/payload.json`:
   ```json
   {
     "name": "aeon-prototype-<slug>",
     "files": [
       { "file": "index.html", "data": "<!DOCTYPE html>...", "encoding": "utf-8" }
     ],
     "projectSettings": {
       "framework": null,
       "buildCommand": null,
       "outputDirectory": null
     },
     "target": "production"
   }
   ```
   Use `"encoding": "base64"` for any binary file.

   **Pre-flight checks** (run before writing the notify):
   - File count ≤ 20. Reject if above.
   - Total payload JSON ≤ 4MB. Reject if above (Vercel inline deploy practical limit).
   - Slug matches `^aeon-prototype-[a-z0-9][a-z0-9-]{2,49}$`.
   - Grep every file for: `VERCEL_TOKEN`, `GH_GLOBAL`, `ANTHROPIC_API_KEY`, `sk-ant-`, `sk-`, `ghp_`, `xoxb-`, `xai-`. Any hit → abort and rewrite the offending file without the value.
   - Grep every file for literal `TODO`, `FIXME`, `lorem ipsum`, `placeholder`. Any hit → fix in place before proceeding.
   - If `VERCEL_TOKEN` is unset, the build still completes but the live deploy in step 8 is skipped (you'll exit `DEPLOY_PROTOTYPE_NO_TOKEN` there) — the pre-flight itself doesn't fail on a missing token.

7. **Save the prototype record.** Write to `output/articles/prototype-${today}.md`. If a file with that name already exists (second run in the same day), append `-02`, `-03`, etc.
   ```markdown
   # Prototype: <Name>

   **Built:** ${today}
   **Tagline:** <tagline from meta.json>
   **Status:** Pending deploy
   **Live URL:** _(filled in-run in step 8 once the Vercel deploy returns its URL)_

   ## Signal
   What triggered this: one paragraph. Link the source article/log/topic (`signal_source` from meta.json).

   ## What it does
   One paragraph, plain language. Include the primary action a visitor takes.

   ## How it works
   Brief technical notes — stack, data source, anything non-obvious. No code dumps.

   ## Files
   - `index.html` — brief description
   - …

   ## Extend
   Three bullets on what would make this a real product (not placeholder — concrete next steps).
   ```

   Append a one-line row to `memory/topics/prototypes.md` (create the file with a header row if missing):
   ```
   | date | slug | tagline | signal_source | live_url |
   |------|------|---------|---------------|----------|
   | 2026-04-20 | aeon-prototype-foo | ... | output/articles/... | _pending_ |
   ```

8. **Deploy live (in-run).** The deploy is the skill's irreversible action, so it runs **in-run** as the final step — behind the step-6 pre-flight — not deferred to any post-run script.

   If `VERCEL_TOKEN` is unset → skip the deploy, leave `.pending-deploy/` in place, and exit `DEPLOY_PROTOTYPE_NO_TOKEN` (step 10). The build still succeeded; the operator just needs to add the token and re-run.

   Otherwise POST the inline deployment built in step 6. Write the key as the literal `{VERCEL_TOKEN}` placeholder so `./secretcurl` substitutes it internally — a bare `$VERCEL_TOKEN` on the command line is refused by the Bash permission layer, and plain `curl` must not carry the token:
   ```bash
   HTTP=$(./secretcurl -sS -o .pending-deploy/deploy-resp.json -w '%{http_code}' \
     -X POST "https://api.vercel.com/v13/deployments" \
     -H "Authorization: Bearer {VERCEL_TOKEN}" \
     -H "Content-Type: application/json" \
     --data @.pending-deploy/payload.json)
   echo "http=$HTTP"
   ```
   - **`http` 200/201:** read the deployment host from the response (`.url` in `deploy-resp.json`) and form the live URL `https://<url>`. Backfill it into the step-7 record (`**Status:** Live`, `**Live URL:** https://…`) and the `memory/topics/prototypes.md` row (replace `_pending_`). Exit `DEPLOY_PROTOTYPE_OK` (step 10).
   - **Any non-2xx / `--max-time` timeout / 200 with empty body:** print the real reason (`http=<code>` / `timeout` / `empty`), keep `.pending-deploy/` for a retry, and exit `DEPLOY_PROTOTYPE_DEPLOY_FAILED` (step 10). Never mark the record Live on a failed deploy.

   **Optional source mirror (best-effort, non-fatal).** If `GH_GLOBAL` is set, also publish the source to GitHub. `gh` already authenticates as `GH_GLOBAL` in-run (it's the ambient `GH_TOKEN`), so no secret goes on the command line:
   ```bash
   if [ -n "${GH_GLOBAL:-}" ]; then
     ( cd .pending-deploy/files && git init -q && git add -A \
       && git -c user.name=aeon -c user.email=aeon@users.noreply.github.com commit -qm "prototype: <slug>" \
       && gh repo create "<slug>" --public --source=. --push ) \
       || echo "::notice::source mirror skipped (non-fatal)"
   fi
   ```
   A mirror failure never fails the run — the live Vercel URL is the deliverable.

9. **Notify.** Send via `./notify` (one of these, depending on outcome):
   - Deployed: `shipped: <slug> — <tagline>. live: <url>`
   - Built, token missing: `built: <slug> — <tagline>. ⚠ VERCEL_TOKEN unset — not deployed. add it and re-run.`
   - Deploy failed: `built: <slug> — <tagline>. ✗ vercel deploy failed (<reason>) — .pending-deploy kept for retry.`
   - No signal worth shipping: handled in step 10.

10. **Exit modes.** End the run with one of these, logged in `memory/logs/${today}.md` under `### deploy-prototype`:
    - `DEPLOY_PROTOTYPE_OK` — prototype built, validated, and deployed live.
    - `DEPLOY_PROTOTYPE_NO_TOKEN` — built and valid, but `VERCEL_TOKEN` unset; deploy skipped, operator action needed.
    - `DEPLOY_PROTOTYPE_DEPLOY_FAILED` — built and valid, but the Vercel API call failed; `.pending-deploy/` kept for retry.
    - `DEPLOY_PROTOTYPE_EMPTY` — no candidate cleared the quality threshold in step 2. Log the top candidate and its score so the next run can reconsider. `./notify "deploy-prototype: no candidate cleared threshold today — top was <slug> (<score>/15)"`.
    - `DEPLOY_PROTOTYPE_VALIDATION_FAILED` — a pre-flight check in step 6 failed and couldn't be fixed automatically. Leave `.pending-deploy/` in place, log the failure reason, notify the operator.

11. **Log.** Append to `memory/logs/${today}.md`:
    ```
    ### deploy-prototype
    - Exit: DEPLOY_PROTOTYPE_<MODE>
    - Slug: aeon-prototype-<slug> (or — if empty)
    - Live URL: <url or —>
    - Signal: <signal_source>
    - Notes: <anything the next run should know>
    ```

## Environment Variables

- `VERCEL_TOKEN` — the live Vercel deploy in step 8. Used **in-run** via `./secretcurl` (the `{VERCEL_TOKEN}` placeholder). Without it, the build succeeds but the deploy is skipped (`DEPLOY_PROTOTYPE_NO_TOKEN`).
- `GH_GLOBAL` — the optional GitHub source mirror in step 8. Used ambiently by `gh` (it's the run's `GH_TOKEN`); a missing token just skips the mirror.

Both are declared optional (`?`) so the skill degrades gracefully: no `VERCEL_TOKEN` → build-only; no `GH_GLOBAL` → deploy without the source mirror. Never read the token values directly and never embed them in any deployed file (step 6 greps for them).

## Guidelines

- A prototype is not a PoC. It's a page someone with zero context can load, understand in 10 seconds, and get value from. Hold that bar.
- Single `index.html` is almost always the right answer. Resist the urge to add tooling.
- Max ~5 files (enforced at 20 in pre-flight).
- Descriptive slugs. `aeon-prototype-market-heatmap`, not `aeon-prototype-1`.
- Never hardcode secrets. If a public-auth endpoint isn't enough for the idea, drop the idea.
- The Vercel deploy (and the optional GitHub source mirror) happen **in-run** in step 8 via `./secretcurl` / `gh` — an irreversible side-effect run as the skill's final, fail-closed action. Build the files, metadata, and payload correctly in steps 4–6 so that final call goes clean.

## Network note

Steps 1–7 are local — file writes and notify only. Step 8's deploy is the one outbound side-effect and it runs **in-run**: the Vercel deployment via `./secretcurl` with the `{VERCEL_TOKEN}` placeholder (a bare `$VERCEL_TOKEN` on the command line is refused by the Bash permission layer, so never use plain `curl` for it), and the optional GitHub mirror via `gh` (authenticated ambiently as `GH_GLOBAL`). There is no deferred/postprocess step — the deploy is the skill's final, fail-closed action: on any non-2xx it exits `DEPLOY_PROTOTYPE_DEPLOY_FAILED` and keeps `.pending-deploy/` for a retry.
