# Aeon

Background intelligence that evolves with you.

Autonomous agent running on GitHub Actions, powered by Claude Code. 33 skills across research, dev tooling, crypto monitoring, and productivity — all off by default, turn on what you need.

## Quick start

1. **Click "Use this template"** on GitHub to create your own copy
2. **Enable GitHub Actions** — go to the **Actions** tab in your fork and click "I understand my workflows, go ahead and enable them"
3. **Add secrets** — go to **Settings > Secrets and variables > Actions** and add:

| Secret | | Used by |
|--------|----------|---------|
| `CLAUDE_CODE_OAUTH_TOKEN` | **Required** | All skills (see auth setup below) |
| `TELEGRAM_BOT_TOKEN` | **Recommended** | Notifications + bidirectional messaging ([setup](#telegram-integration)) |
| `TELEGRAM_CHAT_ID` | **Recommended** | Notifications + bidirectional messaging |
| `DISCORD_WEBHOOK_URL` | Optional | Notifications |
| `SLACK_WEBHOOK_URL` | Optional | Notifications |
| `XAI_API_KEY` | Optional | `digest`, `tweet-digest`, `fetch-tweets` — X/Twitter search via Grok |
| `TAVILY_API_KEY` | Optional | Web search fallback for all research skills (free tier: 1000/mo) |
| `ETHERSCAN_API_KEY` | Optional | `gas-report` — free at [etherscan.io/apis](https://etherscan.io/apis) |
| `COINGECKO_API_KEY` | Optional | `token-alert` — works without, key improves rate limits |
| `ALCHEMY_API_KEY` | Optional | `on-chain-monitor`, `wallet-digest`, `defi-monitor`, `gas-report` — use in RPC URLs in `on-chain-watches.yml` |

4. **Edit `aeon.yml`** — set `enabled: true` on the skills you want
5. **Test** — go to **Actions > Run Skill > Run workflow** and enter a skill name (e.g. `article`)

### Getting your auth token

**Option A: Claude Code OAuth token (recommended)** — uses your existing Claude Pro/Max subscription, no separate API billing.

1. Install [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and run:
   ```bash
   claude setup-token
   ```
2. It opens a browser for OAuth login, then prints a long-lived token (`sk-ant-oat01-...`, valid for 1 year).
3. Add it as the `CLAUDE_CODE_OAUTH_TOKEN` secret in your repo.

**Option B: Standard API key** — usage-based billing through console.anthropic.com.

1. Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) and create a key.
2. Add it as `CLAUDE_CODE_OAUTH_TOKEN` in your repo secrets (it works in the same field).

## How it works

A GitHub Actions workflow runs every 5 minutes, checks `aeon.yml` to see if any skill is due and enabled, and if so, tells Claude Code to read and execute that skill's markdown file. After Claude finishes, the workflow commits all changes back to your repo.

The **heartbeat** is the core loop. The scheduler checks every 5 minutes, but heartbeat itself runs hourly as the fallback — whenever no other skill is scheduled for that hour, heartbeat takes over and scans for anything that needs attention: stalled PRs, flagged memory items, missed skill runs, urgent issues. If nothing needs attention, it exits silently. If something does, it notifies you and logs the finding.

```
Every 5 min, cron fires
  → Checks aeon.yml — is any skill scheduled and enabled right now?
    → Yes → runs that skill (article, digest, monitor, etc.)
    → No  → exits immediately (~10 seconds, no cost)
  → On the hour, if no other skill matched:
    → Heartbeat runs (ambient awareness)
      → Nothing to report → exits silently, no commit
      → Something found   → notifies you, logs it, commits
```

Monitor-type skills that find nothing log an ack (`HEARTBEAT_OK`, `TOKEN_ALERT_OK`, etc.) and the workflow skips the commit — zero noise when nothing needs attention.

## Configuration

All scheduling is done in `aeon.yml`. Skills default to `enabled: false` — turn on what you need:

```yaml
skills:
  article:
    enabled: true               # ← flip this to activate
    schedule: "0 8 * * *"       # Daily at 8am UTC
  digest:
    enabled: false              # ← off by default
    schedule: "0 14 * * *"
```

The schedule format is standard cron (`minute hour day-of-month month day-of-week`). All times are UTC. The parser supports `*`, `*/N`, exact values, and comma-separated lists (`1,15` for 1st and 15th of the month).

**Order matters** — the scheduler picks the first matching skill. Day-specific skills (e.g. Monday-only) are listed before daily skills so they get priority on their day. Heartbeat is always last as the fallback.

### Changing the check frequency

The workflow cron (`*/5 * * * *`) controls how often the scheduler checks. You can change this in `.github/workflows/run-skill.yml`:

```yaml
schedule:
  - cron: '*/5 * * * *'   # Check every 5 min (default)
  - cron: '*/15 * * * *'  # Check every 15 min (saves Actions minutes)
  - cron: '0 * * * *'     # Check hourly (most conservative)
```

The check itself is cheap (~10 seconds of bash) — it only installs Claude Code and calls the API when a skill actually matches.

### GitHub Actions billing

GitHub Actions bills by **minutes used per month**. Only the time a runner is active counts.

| Plan | Free minutes/month | Cost after |
|------|-------------------|------------|
| Free | 2,000 | Not available on free plan for private repos |
| Pro | 3,000 | $0.008/min |
| Team | 3,000 | $0.008/min |

**What costs what:**
- **No skill matched** (most 5-min ticks): ~10 seconds. Checkout + bash parse + exit. At `*/5`, that's ~288 checks/day = ~48 minutes/day.
- **Skill runs**: 2-10 minutes each depending on complexity (Claude thinking + web search + file writes).
- **Heartbeat (hourly)**: ~2 minutes if nothing found, more if it investigates something.

**To reduce usage:**
- Change the cron to `*/15` or `0 *` (hourly) — fewer empty checks
- Disable skills you don't need (`enabled: false`)
- Keep the repo **public** — public repos get unlimited free Actions minutes

## Skills

### Research & Content

| Skill | Description |
|-------|-------------|
| `article` | Research and write a 600-800 word article |
| `digest` | Generate and send a topic digest via notifications |
| `rss-digest` | Fetch and summarize RSS feed highlights |
| `hacker-news-digest` | Top HN stories filtered by your interests |
| `paper-digest` | Find and summarize new papers matching your research topics |
| `substack-draft` | Compose a polished long-form article draft |
| `tweet-digest` | Aggregate and summarize tweets from tracked accounts |
| `research-brief` | Deep dive on a topic: web search + papers + synthesis |
| `fetch-url` | Pull and summarize any URL |
| `fetch-tweets` | Fetch tweets from a specific X user |
| `search-papers` | Academic paper search via Semantic Scholar API |

### Dev & Code

| Skill | Description |
|-------|-------------|
| `pr-review` | Auto-review open PRs and post summary comments |
| `github-monitor` | Watch repos for stale PRs, new issues, and releases |
| `issue-triage` | Label and prioritize new GitHub issues |
| `changelog` | Generate a changelog from recent commits |
| `dependency-check` | Flag outdated or vulnerable deps |
| `code-health` | Report on TODOs, dead code, test coverage gaps |
| `feature` | Build features from GitHub issues labeled `ai-build` |
| `build-tool` | Design and create new skills |

### Crypto / On-chain

| Skill | Description |
|-------|-------------|
| `token-alert` | Notify on price/volume anomalies for tracked tokens |
| `gas-report` | Gas price trends on Ethereum/Base/Monad |
| `wallet-digest` | Summarize recent activity across tracked wallets |
| `on-chain-monitor` | Monitor contracts and addresses for notable events |
| `defi-monitor` | Check pool health, positions, and yield rates |

### Productivity

| Skill | Description |
|-------|-------------|
| `morning-brief` | Aggregated daily briefing: priorities, headlines, schedule |
| `weekly-review` | Synthesize the week's logs into a structured retrospective |
| `goal-tracker` | Compare progress against goals in MEMORY.md |
| `idea-capture` | Quick note capture via Telegram → memory |

### Meta / Agent

| Skill | Description |
|-------|-------------|
| `heartbeat` | Core loop — hourly ambient check, surfaces anything needing attention |
| `memory-flush` | Promote important log entries into MEMORY.md |
| `reflect` | Consolidate memory, prune stale entries |
| `skill-health` | Check which scheduled skills haven't run recently |
| `self-review` | Audit what Aeon did, what failed, what to improve |

## Tools

Reusable scripts in `tools/` available to all skills:

| Tool | Description | Requires |
|------|-------------|----------|
| `tools/notify.sh "msg"` | Send to all configured channels (Telegram, Discord, Slack) | Secrets for each channel |
| `tools/web-search.sh "query"` | Tavily API search (fallback — skills try WebSearch first) | `TAVILY_API_KEY` |
| `tools/fetch-url.sh "url"` | Fetch URL as clean markdown via Jina Reader (fallback) | Nothing (free) |

Skills prefer Claude Code's built-in WebSearch and WebFetch. The shell tools are fallbacks for when built-in tools are unavailable or return insufficient results.

## Notifications

Aeon fans out notifications to every configured channel. Set the secret and it activates — no code changes needed.

| Channel | Secret(s) |
|---------|-----------|
| Telegram | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` |
| Discord | `DISCORD_WEBHOOK_URL` |
| Slack | `SLACK_WEBHOOK_URL` |

**Discord setup:** Channel settings → Integrations → Webhooks → Create Webhook → copy URL.

**Slack setup:** api.slack.com → Create App → Incoming Webhooks → activate → pick channel → copy URL.

## Config files

| File | Purpose |
|------|---------|
| `memory/feeds.yml` | RSS/Atom feed URLs for `rss-digest` |
| `memory/watched-repos.md` | GitHub repos monitored by `github-monitor`, `pr-review`, etc. |
| `memory/on-chain-watches.yml` | Blockchain addresses/contracts for `on-chain-monitor`, `wallet-digest`, `defi-monitor` |

## Telegram integration

Send messages to your Telegram bot and Aeon will interpret them — run skills, answer questions, or update memory. Polls every 5 minutes.

**Setup:**
1. Create a bot with [@BotFather](https://t.me/BotFather) on Telegram
2. Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to your repo secrets
3. Send your bot a message like "write an article about quantum computing"

Only messages from your `TELEGRAM_CHAT_ID` are accepted — anyone else is ignored.

By default, Aeon polls Telegram every 5 minutes. This means up to a 5-minute delay before your message is picked up. If that's fine, you're done — no extra setup needed.

### Instant mode (optional)

To get near-instant responses, you can deploy a tiny webhook that triggers Aeon immediately when you send a message. This replaces the 5-minute polling delay with a ~1 second trigger. You still need the polling workflow as a fallback.

The webhook receives messages from Telegram and calls GitHub's `repository_dispatch` API to trigger the workflow instantly. It's ~20 lines of code.

**Option A: Cloudflare Worker (free tier: 100k requests/day)**

1. Create a worker at [workers.cloudflare.com](https://workers.cloudflare.com) with this code:

```js
export default {
  async fetch(request, env) {
    const { message } = await request.json();
    if (!message?.text || String(message.chat.id) !== env.TELEGRAM_CHAT_ID) {
      return new Response("ignored");
    }

    // Confirm receipt so polling doesn't reprocess
    await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${message.update_id + 1}`
    );

    // Trigger GitHub Actions
    await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({
          event_type: "telegram-message",
          client_payload: { message: message.text },
        }),
      }
    );

    return new Response("ok");
  },
};
```

2. Add these environment variables in the Cloudflare dashboard:

| Variable | Value |
|----------|-------|
| `TELEGRAM_BOT_TOKEN` | Your bot token |
| `TELEGRAM_CHAT_ID` | Your chat ID |
| `GITHUB_REPO` | `your-name/aeon` |
| `GITHUB_TOKEN` | A [personal access token](https://github.com/settings/tokens) with `repo` scope |

3. Set your Telegram bot webhook to point to the worker:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-worker.workers.dev"
```

**Option B: Railway / Vercel / any serverless platform**

Same code, different host. Deploy the webhook handler above as a serverless function on whichever platform you prefer. The logic is identical — receive Telegram webhook, call GitHub `repository_dispatch`.

## Trigger feature builds from issues

Add the label `ai-build` to any GitHub issue. The workflow fires automatically and Claude will read the issue, implement it, and open a PR.

## Adding a new skill

1. Create `skills/your-skill.md` with instructions for Claude:

```markdown
---
name: My Skill
description: What this skill does
---

Your task is to...
```

2. Add it to `aeon.yml` with a schedule and enable it:

```yaml
skills:
  your-skill:
    enabled: true
    schedule: "0 12 * * *"   # Daily at noon UTC
```

That's it — no workflow changes needed. On-demand skills don't need a schedule entry — trigger them via Telegram or `workflow_dispatch`.

## Running locally

```bash
# Run any skill locally (requires Claude Code CLI)
claude -p "Today is $(date +%Y-%m-%d). Read and execute the skill defined in skills/article.md" --dangerously-skip-permissions
```

## Two-repo strategy

This repo is a **public template**. For your own instance, we recommend creating a private copy so your memory, articles, and API keys stay private.

### Setup

1. **Click "Use this template"** → **Create a new repository** → make it **private** (e.g. `your-name/aeon`).
2. Add your secrets to the **private** fork (not the public template).
3. Customize `CLAUDE.md`, `aeon.yml`, `memory/MEMORY.md`, and skill prompts in your private fork.
4. All generated content (articles, digests, memory) stays in your private fork.

### Pulling updates from the template

When the public template gets new skills or workflow improvements:

```bash
# In your private fork
git remote add upstream https://github.com/aaronjmars/aeon.git
git fetch upstream
git merge upstream/main --no-edit
```

This merges template changes without overwriting your personal content, since your articles/memory are in files that don't exist in the template.

## Project structure

```
CLAUDE.md                ← agent identity (auto-loaded by Claude Code)
aeon.yml                 ← skill schedules + enabled flags (edit this to configure)
tools/
  notify.sh              ← multi-channel notification (Telegram/Discord/Slack)
  web-search.sh          ← Tavily API search (fallback)
  fetch-url.sh           ← Jina Reader URL fetch (fallback)
skills/
  article.md             ← research trending topics, write a 600-800 word article
  digest.md              ← search web + X/Twitter, send a topic digest via notifications
  rss-digest.md          ← fetch RSS/Atom feeds, summarize new entries
  hacker-news-digest.md  ← pull top HN stories, filter by your interests
  paper-digest.md        ← query arXiv + Semantic Scholar, summarize new papers
  tweet-digest.md        ← aggregate tweets from tracked accounts, group by theme
  substack-draft.md      ← write a polished 800-1200 word draft with sources
  research-brief.md      ← deep dive: web + papers + synthesis into a briefing
  fetch-url.md           ← pull any URL, summarize key points (on-demand)
  fetch-tweets.md        ← fetch 10 tweets from a specific X user (on-demand)
  search-papers.md       ← Semantic Scholar API wrapper (reference tool)
  pr-review.md           ← review open PR diffs, post actionable comments
  github-monitor.md      ← watch repos for stale PRs, new issues, releases
  issue-triage.md        ← auto-label and prioritize new GitHub issues
  changelog.md           ← generate changelog from recent commits by type
  dependency-check.md    ← scan for vulnerable or outdated dependencies
  code-health.md         ← report TODOs, dead code, missing tests, large files
  feature.md             ← read a GitHub issue, implement it, open a PR
  build-tool.md          ← design and create new skills from ideas
  token-alert.md         ← check CoinGecko for price/volume anomalies
  gas-report.md          ← query RPCs for gas prices, track 7-day trends
  wallet-digest.md       ← summarize balances and transactions across wallets
  on-chain-monitor.md    ← poll contracts for events, alert on notable activity
  defi-monitor.md        ← check pool TVL, APR, position health, IL
  morning-brief.md       ← aggregate priorities, headlines, schedule into one message
  weekly-review.md       ← synthesize the week's logs into a retrospective
  goal-tracker.md        ← compare progress against goals in MEMORY.md
  idea-capture.md        ← capture a quick note from Telegram into memory
  heartbeat.md           ← core loop: scan for anything needing attention
  memory-flush.md        ← promote important log entries into MEMORY.md
  reflect.md             ← consolidate memory, prune stale entries
  skill-health.md        ← audit which skills ran, missed, or errored
  self-review.md         ← review output quality, reliability, suggest improvements
memory/
  MEMORY.md              ← index: goals, active topics, pointers to topic files
  topics/                ← detailed notes by topic (crypto.md, research.md, etc.)
  logs/                  ← daily activity logs (YYYY-MM-DD.md)
  feeds.yml              ← RSS feed URLs
  watched-repos.md       ← GitHub repos to monitor
  on-chain-watches.yml   ← blockchain addresses to watch
.github/
  workflows/
    run-skill.yml        ← scheduled skill runner
    telegram.yml         ← Telegram message polling + webhook
```
