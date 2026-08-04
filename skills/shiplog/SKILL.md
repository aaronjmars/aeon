---
name: shiplog
description: Recap of everything shipped since the last run - cross-repo PRs, security fixes, star deltas, and X traction, synthesized into a digest article and a ready-to-post shiplog in your voice.
metadata:
  title: Shiplog
  category: core
  var: ""
  requires:
    - XAI_API_KEY?
    - GH_GLOBAL?
  tags:
    - content
    - social
---
> **${var}** — Optional, space-separated flags:
> - `since:YYYY-MM-DD` — override the window start (default: when this skill last ran).
> - `days:N` — window = last N days.
> - `dry-run` — render to stdout; write no article, no state, no notify.
> - `owner/repo` — narrow GitHub coverage to that one repo.
> - any other word — focus/theme filter (a product name or keyword).
>
> Empty = everything shipped since the last run, across all configured repos.

Produce two artifacts:
1. **Digest** — a themed, human-readable recap of everything that shipped + traction (the article).
2. **Shiplog post** — a tight, bulleted, ready-to-post version in the operator's voice, every project @-tagged (the notification).

This is **cadence-agnostic**: the window is always "since the last run" (`memory/state/shiplog-last.json`), so the `aeon.yml` schedule alone decides whether this is a daily, weekly, or on-demand recap. One skill, any frequency.

Read `STRATEGY.md`, `memory/MEMORY.md`, and the last 7 days of `memory/logs/` for context. Read `soul/SOUL.md` + `soul/STYLE.md` before writing any output — the shiplog post must sound like the operator, not a changelog bot. **If `soul/` is empty, use a clear, direct, neutral voice** (drop the signature flourishes below).

## Config — all derived, nothing hardcoded

```
operator        = gh api user --jq .login            # the authenticated operator (PR-author search)
product_handles = memory/products.md `handles:` lines (@x)        # product X accounts to read
flagship_repos  = memory/products.md `repos:` tagged (public)     # the star / north-star story
watched_repos   = memory/watched-repos.md, else products.md repos: # everything shipped across
ecosystem_scouts= memory/products.md `scouts:` line (optional)    # recap accounts to scan for features
star_state      = memory/state/shiplog-stars.json    # snapshot for week-over-week star deltas
```

If neither `watched-repos.md` nor `products.md` yields a repo, exit `SHIPLOG_NO_REPOS` (notify + log, no article). Sections whose config is absent (X handles, scouts) are **skipped gracefully**, not failed.

## Steps

### 1. Compute the window — "since last run"

```bash
STATE="memory/state/shiplog-last.json"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TODAY=$(date -u +%Y-%m-%d)
LAST=""
[ -f "$STATE" ] && LAST=$(jq -r '.last_run_at // empty' "$STATE" 2>/dev/null)
SINCE="${LAST:-$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)}"
SINCE_DATE="${SINCE%%T*}"
```

- `since:YYYY-MM-DD` in `${var}` → `SINCE` = that date at `T00:00:00Z`; `days:N` → N days ago. These override the state file.
- Use `$SINCE` for ALL time filtering — never substitute "since Monday" or other drift-prone shortcuts. The window is `[$SINCE, $NOW)`; state the span (`$SINCE_DATE → $TODAY`) in the output.
- **Idempotency is the state file** (step 8 advances it each run, so windows never overlap). No once-per-day lock — a back-to-back re-run just yields an empty window → `SHIPLOG_NOTHING_NEW`. Write the digest to `output/articles/shiplog-${TODAY}.md`; if that name exists and there's genuinely new activity since the last run, use `output/articles/shiplog-${TODAY}-2.md` rather than clobbering.

### 2. GitHub activity (the bytes)

Cross-repo PR/commit visibility needs the global token — the built-in `GITHUB_TOKEN` only sees this repo. Prefer `GH_GLOBAL` when set:

```bash
GHT="${GH_GLOBAL:-$GITHUB_TOKEN}"   # gh reads GH_TOKEN from env; falls back to the repo-scoped token
OPERATOR=$(GH_TOKEN="$GHT" gh api user --jq .login 2>/dev/null)
```

Track success/failure per source in a `sources` map; on a single endpoint failure log `fail` and continue — never abort the whole skill.

**a) Operator PRs across all repos in the window** (grouped by repo + totals):
```bash
GH_TOKEN="$GHT" gh search prs --author "$OPERATOR" --created ">=$SINCE_DATE" \
  --json number,title,repository,state,createdAt,url --limit 100 \
  --jq 'group_by(.repository.nameWithOwner)[] | {repo: .[0].repository.nameWithOwner, count: length,
         prs: [.[] | {date: .createdAt[0:10], state, number, title}]}'
```
If 100 rows come back, note the result may be truncated.

**b) Flagship headline numbers** — for each `flagship_repos` entry, count commits + merged PRs in the window (the numbers the audience cares about):
```bash
for REPO in $FLAGSHIP_REPOS; do
  GH_TOKEN="$GHT" gh api "repos/${REPO}/commits" -X GET -f since="$SINCE" \
    --jq "\"$REPO commits: \" + ([.[] | .sha] | length | tostring)" 2>/dev/null
  GH_TOKEN="$GHT" gh api "repos/${REPO}/pulls" -X GET -f state=closed -f sort=updated -f direction=desc \
    --jq "\"$REPO merged PRs: \" + ([.[] | select(.merged_at != null and .merged_at > \"$SINCE\")] | length | tostring)" 2>/dev/null
done
```

**c) The security flex** — PRs the operator landed in repos they do NOT own (the "a project merged a fix from us" candidates). Filter the Step-2a result to external repos whose title matches a security keyword (`security|ssrf|cve|credential|sandbox|escape|injection|vuln|redos|xss|toctou|path traversal|prototype pollution|deserial`). Merged ones are the marquee story — if it's a named org (not a random fork), that's a headline bullet.

**d) Star delta** (north-star metric — flagships only, they're public):
```bash
mkdir -p memory/state
for REPO in $FLAGSHIP_REPOS; do
  GH_TOKEN="$GHT" gh api "repos/${REPO}" --jq '.stargazers_count'   # current total for $REPO
done
```
Read the prior snapshot `memory/state/shiplog-stars.json` (if present): `delta = current_total − last_total` per repo. After computing, overwrite the snapshot with `{ "<repo>": {"count": N, "date": "${TODAY}"}, ... }`. If no prior snapshot exists, report totals only and note "no baseline yet — deltas start next run." Do NOT fabricate a delta.

### 3. X activity (direct X.AI curl — primary)

`XAI_API_KEY` is **injected into this skill's environment** (declared in `requires:`) and is the primary way to read X. **For each X source below the primary fetch is a direct `curl` to `https://api.x.ai/v1/responses` with `Authorization: Bearer {XAI_API_KEY}`**, using Grok's `x_search` tool. There is no network sandbox blocking this — just make the calls.

**Check the key and give the call room first:**
```bash
[ -n "$XAI_API_KEY" ] && echo KEY_PRESENT || echo KEY_UNSET
```
`x_search` runs a live X search and typically takes 30–120s. When you invoke the Bash tool for any curl below, **set the tool's `timeout` to at least 180000 (180s)**; each curl carries `--max-time 150` so it fails cleanly instead of hanging. **A slow curl is not a missing key — never treat a timeout as key-unavailable.** If `KEY_PRESENT` (it will be), Path A is required for every X source.

There are two X sources here — the **operator** handle (`$OPERATOR_HANDLE`, the operator's own X account from `memory/products.md`) and the **product/project** accounts (`$PRODUCT_HANDLES`). Fetch each independently into its own tmp file so one failing source can't clobber or sink another.

**Path A — X.AI API (primary).**

*Operator posts* (`SRC=operator`):
```bash
jq -n --arg h "$OPERATOR_HANDLE" --arg sd "$SINCE_DATE" --arg td "$TODAY" '{model:"grok-4.3", input:[{role:"user", content:("Search X for posts by @" + $h + " between " + $sd + " and " + $td + ". Return each post with full text, date, type (original|reply|RT — an RT text starts with \"RT @\"), exact engagement counts (likes, retweets, replies; 0 if unknown), and the direct link https://x.com/" + $h + "/status/ID. Return chronological.")}], tools:[{type:"x_search"}]}' > /tmp/xai-shiplog-operator-payload.json
HTTP=$(./secretcurl -s -o /tmp/xai-shiplog-operator.json -w '%{http_code}' --max-time 150 -X POST "https://api.x.ai/v1/responses" \
  -H "Content-Type: application/json" -H "Authorization: Bearer {XAI_API_KEY}" -d @/tmp/xai-shiplog-operator-payload.json)
echo "xai http=$HTTP bytes=$(wc -c </tmp/xai-shiplog-operator.json)"
```

*Product/project accounts* (`SRC=projects`):
```bash
jq -n --arg sd "$SINCE_DATE" --arg td "$TODAY" --arg ph "$PRODUCT_HANDLES" '{model:"grok-4.3", input:[{role:"user", content:("Search X for posts between " + $sd + " and " + $td + " from these accounts: " + $ph + ". Focus on launches, announcements, and any brag about a security fix merged into another project. For each: @handle, full text, date, exact engagement counts (likes, retweets, replies; 0 if unknown), and the direct link https://x.com/handle/status/ID. Skip retweets of others.")}], tools:[{type:"x_search"}]}' > /tmp/xai-shiplog-projects-payload.json
HTTP=$(./secretcurl -s -o /tmp/xai-shiplog-projects.json -w '%{http_code}' --max-time 150 -X POST "https://api.x.ai/v1/responses" \
  -H "Content-Type: application/json" -H "Authorization: Bearer {XAI_API_KEY}" -d @/tmp/xai-shiplog-projects-payload.json)
echo "xai http=$HTTP bytes=$(wc -c </tmp/xai-shiplog-projects.json)"
```

For each source, on `HTTP=200` with a non-empty body, parse that source's file with the standard extractor and mark `x_source=api`:
```bash
jq -r '.output[] | select(.type == "message") | .content[] | select(.type == "output_text") | .text' /tmp/xai-shiplog-<SRC>.json
```
From the **operator** text, separate **original posts** from **RTs** (RT text starts with `RT @`) — RTs are amplification, not ships. From the **projects** text, note the bangers (sort by likes/views) — one or two feed the digest's narrative section.

**On a real failure, skip that source — never fabricate posts.** If a source's curl returns non-200, an empty/unparseable body, or times out, record the **true reason** for that source and continue with whatever other sources succeeded. Reason codes: `key-unset` (only if the check above printed `KEY_UNSET`), `http-<code>` (non-2xx), `empty` (200 but no posts parsed), `timeout` (exceeded `--max-time`). Never write "XAI_API_KEY unavailable" when the key was set.

**Path B — WebFetch last resort (per source, optional).** Only if a source's Path A failed for one of the real reasons above: WebFetch that source's public `https://x.com/<handle>` profile(s) — no auth — and mark that source `x_source=webfetch` (lower quality; prefer posts inside the window). If every X source fails both paths, set `x_source=none` and write the GitHub-only shiplog (note the gap) — **never abort**.

### 4. Ecosystem + traction sweep (best-effort — skip gracefully)

- **Ecosystem mentions** — only if `ecosystem_scouts` (`scouts:`) is configured. Fetch with the same **Path A** X.AI curl as Step 3, into its own tmp file (`SRC=ecosystem`):
  ```bash
  jq -n --arg sd "$SINCE_DATE" --arg td "$TODAY" --arg es "$ECOSYSTEM_SCOUTS" --arg ph "$PRODUCT_HANDLES" '{model:"grok-4.3", input:[{role:"user", content:("Search X between " + $sd + " and " + $td + " for posts from these recap/scout accounts: " + $es + " that mention any of these products: " + $ph + ". Return each mention with @handle, follower_count, full text, date, and the direct link https://x.com/handle/status/ID — recaps, rankings, partner shares.")}], tools:[{type:"x_search"}]}' > /tmp/xai-shiplog-ecosystem-payload.json
  HTTP=$(./secretcurl -s -o /tmp/xai-shiplog-ecosystem.json -w '%{http_code}' --max-time 150 -X POST "https://api.x.ai/v1/responses" \
    -H "Content-Type: application/json" -H "Authorization: Bearer {XAI_API_KEY}" -d @/tmp/xai-shiplog-ecosystem-payload.json)
  echo "xai http=$HTTP bytes=$(wc -c </tmp/xai-shiplog-ecosystem.json)"
  ```
  On `HTTP=200` + non-empty, parse `/tmp/xai-shiplog-ecosystem.json` with the standard extractor. On a real curl failure (`http-<code>` / `empty` / `timeout`, or `key-unset`) skip this source with the true reason — **never fabricate a mention**. Confirm any handle is real before @-mentioning (a wrong tag in a public post is worse than none). Capture follower counts for the flex ("featured by @X (Nk)"). Skip entirely if no `scouts:` configured.
- **Product traction** (OpenRouter / x402 / analytics) — only if a source is configured for the product. If you have an app/server id, WebFetch its page; otherwise say "no product-traction sources wired yet" and move on. Keep any number exactly as measured — don't round 79 → ~80.

### 5. Classify the window

| Condition | Status | Action |
|-----------|--------|--------|
| 0 PRs AND 0 flagship commits AND no notable X | `SHIPLOG_NOTHING_NEW` | Notify-optional — no article. Skip to Step 8, **still advance state.** |
| < 3 substantive ships total | `SHIPLOG_LIGHT` | Short post (3-bullet form). |
| Otherwise | `SHIPLOG_OK` | Full digest + post. |

If `${var}` narrows to one repo/project and nothing matched, status `SHIPLOG_NO_MATCH` — notify and exit (still advance state).

### 6. Synthesize + write the article

**Output handling — no PR.** This is a content skill: write the article straight to `output/articles/` and let the workflow's commit step push it to `main` (same as the `article` skill). Do **not** create a branch or open a pull request — `CLAUDE.md`'s "branch + PR, never push to main" rule is for source-code changes, not generated articles.

Write the **digest** to `output/articles/shiplog-${TODAY}.md`: themed "what shipped" sections, a **By-the-numbers** line (PRs · commits · star deltas), traction/ecosystem, and the gaps you hit. Then append the **ready-to-post shiplog** using this template — load `soul/STYLE.md` first so the register matches (if `soul/` is empty, write a plain, direct post and drop the `⭐` sign-off):

```
<product(s)> shiplog ⭐ <span: month day → day>

shipped ~<N> PRs + <M> commits this window. the bytes:

- <punchy ship 1>: <one-line what+why>. <@handles of projects involved>
- <punchy ship 2>: ...
- <punchy ship 3>: ...
- security: fixes into other people's repos (<types>) — even got one merged into <@MarqueeOrg>'s <repo>

traction:
- <product> <total> ⭐ (+<delta> this window)
- featured by <@scout> (<followers>) "<quote>" + ranked #<rank> <list>

⭐
```

- **Tag every project** with a handle you verified. If you couldn't confidently resolve one, leave it untagged and say which is missing.
- Keep numbers exactly as measured. If a flex (a security merge, a milestone) landed just outside the window, keep it but flag the date.
- Also draft two variants below the post: a tight thread (hook + one tweet per ship) and a 3-bullet short version.

### 7. (folded into 6)

### 8. Advance the state file

Unless `dry-run`, record this run so the next one starts where this ended:
```bash
mkdir -p memory/state
HEAD_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
jq -n --arg at "$NOW" --arg sha "$HEAD_SHA" --arg win "$SINCE" \
  '{last_run_at:$at, last_commit_sha:$sha, window_start:$win}' > memory/state/shiplog-last.json
```
Advance on **every** completed run — including `SHIPLOG_NOTHING_NEW` / `SHIPLOG_LIGHT` / `SHIPLOG_NO_MATCH` — so the window always moves forward. The workflow auto-commits it (no `git` here). On `dry-run`, do NOT write it.

### 9. Notify

```bash
REPO_URL=$(gh repo view --json url -q .url)
ARTICLE_URL="${REPO_URL}/blob/main/output/articles/shiplog-${TODAY}.md"
```

Write the ready-to-post shiplog to a temp file — `/tmp/shiplog-notify.md` — and send it with `./notify -f /tmp/shiplog-notify.md` (use `-f` rather than `./notify "$(cat …)"` so a long multi-line post is passed as a file instead of a giant argv). Append `${ARTICLE_URL}` as the last line. For `SHIPLOG_NOTHING_NEW` / `SHIPLOG_NO_MATCH`, send a one-line status instead of the post (or stay silent on sub-daily cadences).

### 10. Log

Append to `memory/logs/${TODAY}.md`:
```
### shiplog
- Status: SHIPLOG_OK | SHIPLOG_LIGHT | SHIPLOG_NOTHING_NEW | SHIPLOG_NO_MATCH | SHIPLOG_NO_REPOS
- Window: ${SINCE_DATE} → ${TODAY}  (var: ${var:-none})
- PRs / flagship commits: N / M   ·   external-security PRs: K
- Stars: <repo> <total> (+d) … [or: no baseline yet]
- X source: api | webfetch | none (+ per-source skip reasons if any: operator=http-<code> | projects=timeout | ecosystem=empty …)
- Article: output/articles/shiplog-${TODAY}.md (if written)
- State advanced to: ${NOW} (unless dry-run)
- Sources: prs=ok|fail · commits=ok|fail · stars=ok|fail · x=ok|fail · ecosystem=ok|fail
```

## Fetching & sources

- **GitHub**: every call uses `gh` (auth handled internally) — never curl the GitHub API. For cross-repo reach, prefer `GH_TOKEN="${GH_GLOBAL:-$GITHUB_TOKEN}"`; with only the built-in token you'll see this repo plus public repos, which still covers public flagships.
- **X**: `XAI_API_KEY` is injected into this skill's env (it's in `requires:`), and the primary path for every X source is a direct `curl https://api.x.ai/v1/responses` with `Authorization: Bearer {XAI_API_KEY}` (Step 3). There is no network sandbox blocking this. Attempt the curl (`--max-time 150`, Bash tool `timeout` ≥180000) before any fallback, and on a real failure skip that source with the true reason (`key-unset` / `http-<code>` / `empty` / `timeout`) — WebFetch of the public `x.com/<handle>` profile is a lower-quality last resort only.
- **Never abort on a single source failure** — note the gap in the digest and still write + notify.

## Constraints

- The window is **always** "since last run" (state file) unless `${var}` overrides it — never hardcode 7 days except as the first-run default. Always advance `memory/state/shiplog-last.json` on a real run, even a quiet one.
- Content, not code: write the article to `output/articles/` and let the workflow commit it to `main`. Never open a per-run PR for the shiplog.
- Every concrete claim traces to real data — a PR `(#N)`, a commit, a measured number, or a fetched tweet (with its permalink). No invented activity, no fabricated star deltas.
- RTs are amplification, not ships — narrative/ecosystem only, never "the bytes".
- Verify a handle before @-mentioning it; an unverified tag stays untagged.
- Voice from `soul/`; neutral and direct if `soul/` is empty. No hype adjectives, no hashtags.
- The notify URL is the GitHub web URL via `gh repo view --json url`, not the SSH remote.
