# Aeon

Background intelligence that evolves with you.

Autonomous agent running on GitHub Actions, powered by Claude Code. 33 skills across research, dev tooling, crypto monitoring, and productivity — all off by default, turn on what you need.

## Quick start

1. **Click "Use this template"** on GitHub to create your own copy
2. **Enable GitHub Actions** — go to the **Actions** tab in your fork and click "I understand my workflows, go ahead and enable them"
3. **Add secrets** — go to **Settings > Secrets and variables > Actions** and add:

| Secret | Required | Description |
|--------|----------|-------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | Yes | OAuth token for Claude (see below) |
| `TELEGRAM_BOT_TOKEN` | Optional | From @BotFather on Telegram |
| `TELEGRAM_CHAT_ID` | Optional | Your Telegram chat ID from @userinfobot |
| `XAI_API_KEY` | Optional | X.AI API key for searching X/Twitter |
| `TAVILY_API_KEY` | Optional | Tavily API key for web search fallback (free tier: 1000/mo) |
| `DISCORD_WEBHOOK_URL` | Optional | Discord channel webhook URL |
| `SLACK_WEBHOOK_URL` | Optional | Slack incoming webhook URL |

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

A GitHub Actions workflow runs every hour, checks `aeon.yml` to see if any skill is due and enabled, and if so, tells Claude Code to read and execute that skill's markdown file. After Claude finishes, the workflow commits all changes back to your repo.

```
Hourly cron fires
  → Checks aeon.yml — is any skill scheduled and enabled for this hour?
    → No  → exits immediately (costs ~10 seconds)
    → Yes → installs Claude Code
      → claude -p "Read and execute skills/article.md"
        → Claude reads the skill, searches the web, writes output
          → Workflow commits all changes back to main
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

The schedule format is standard cron (`minute hour day-of-month month day-of-week`). All times are UTC.

**Order matters** — the scheduler picks the first matching skill. Day-specific skills (e.g. Monday-only) are listed before daily skills so they get priority on their day. Heartbeat is always last as the fallback.

## Skills

### Research & Content

| Skill | Schedule | Description |
|-------|----------|-------------|
| `article` | Daily 8am | Research and write a 600-800 word article |
| `digest` | Daily 2pm | Generate and send a topic digest via notifications |
| `rss-digest` | Daily noon | Fetch and summarize RSS feed highlights |
| `hacker-news-digest` | Daily 11am | Top HN stories filtered by your interests |
| `paper-digest` | Sunday 8pm | Find and summarize new papers matching your research topics |
| `substack-draft` | Friday 4pm | Compose a polished long-form article draft |
| `tweet-digest` | Wednesday 1pm | Aggregate and summarize tweets from tracked accounts |
| `research-brief` | On-demand | Deep dive on a topic: web search + papers + synthesis |
| `fetch-url` | On-demand | Pull and summarize any URL |
| `fetch-tweets` | On-demand | Fetch tweets from a specific X user |
| `search-papers` | Reference | Academic paper search via Semantic Scholar API |

### Dev & Code

| Skill | Schedule | Description |
|-------|----------|-------------|
| `pr-review` | Daily 3pm | Auto-review open PRs and post summary comments |
| `github-monitor` | Daily 10am | Watch repos for stale PRs, new issues, and releases |
| `issue-triage` | Tuesday 5am | Label and prioritize new GitHub issues |
| `changelog` | Monday 1am | Generate a changelog from the week's commits |
| `dependency-check` | Tuesday 3am | Flag outdated or vulnerable deps |
| `code-health` | Friday 10pm | Report on TODOs, dead code, test coverage gaps |
| `feature` | Monday 2am | Build features from GitHub issues labeled `ai-build` |
| `build-tool` | Wednesday 4am | Design and create new skills |

### Crypto / On-chain

| Skill | Schedule | Description |
|-------|----------|-------------|
| `token-alert` | Daily midnight | Notify on price/volume anomalies for tracked tokens |
| `gas-report` | Daily 9am | Gas price trends on Ethereum/Base/Monad |
| `wallet-digest` | Daily 5pm | Summarize recent activity across tracked wallets |
| `on-chain-monitor` | Daily 6pm | Monitor contracts and addresses for notable events |
| `defi-monitor` | Daily 7pm | Check pool health, positions, and yield rates |

### Productivity

| Skill | Schedule | Description |
|-------|----------|-------------|
| `morning-brief` | Daily 7am | Aggregated daily briefing: priorities, headlines, schedule |
| `weekly-review` | Sunday 10pm | Synthesize the week's logs into a structured retrospective |
| `goal-tracker` | Sunday 5am | Compare progress against goals in MEMORY.md |
| `idea-capture` | On-demand | Quick note capture via Telegram → memory |

### Meta / Agent

| Skill | Schedule | Description |
|-------|----------|-------------|
| `heartbeat` | Hourly (fallback) | Ambient check — surface anything needing attention |
| `memory-flush` | Daily 11pm | Promote important log entries into MEMORY.md |
| `reflect` | Sunday 6am | Consolidate memory, prune stale entries |
| `skill-health` | Saturday 1am | Check which scheduled skills haven't run recently |
| `self-review` | Saturday 3am | Audit what Aeon did, what failed, what to improve |

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
  article.md             ← daily article
  digest.md              ← daily digest
  rss-digest.md          ← RSS feed digest
  hacker-news-digest.md  ← HN top stories
  paper-digest.md        ← academic paper digest
  tweet-digest.md        ← X/Twitter digest
  substack-draft.md      ← long-form article draft
  research-brief.md      ← deep research dive (on-demand)
  fetch-url.md           ← URL summarizer (on-demand)
  fetch-tweets.md        ← tweet fetcher (on-demand)
  search-papers.md       ← paper search reference
  pr-review.md           ← PR auto-review
  github-monitor.md      ← repo monitoring
  issue-triage.md        ← issue labeling
  changelog.md           ← weekly changelog
  dependency-check.md    ← dep vulnerability check
  code-health.md         ← code quality report
  feature.md             ← feature builder (from issues)
  build-tool.md          ← skill builder
  token-alert.md         ← token price alerts
  gas-report.md          ← gas price trends
  wallet-digest.md       ← wallet activity summary
  on-chain-monitor.md    ← contract event monitor
  defi-monitor.md        ← DeFi position monitor
  morning-brief.md       ← daily morning briefing
  weekly-review.md       ← weekly retrospective
  goal-tracker.md        ← goal progress tracker
  idea-capture.md        ← quick note capture (on-demand)
  heartbeat.md           ← ambient health check (fallback)
  memory-flush.md        ← log → memory promotion
  reflect.md             ← weekly memory consolidation
  skill-health.md        ← skill run audit
  self-review.md         ← agent self-audit
memory/
  MEMORY.md              ← long-term persistent memory
  feeds.yml              ← RSS feed URLs
  watched-repos.md       ← GitHub repos to monitor
  on-chain-watches.yml   ← blockchain addresses to watch
.github/
  workflows/
    run-skill.yml        ← scheduled skill runner
    telegram.yml         ← Telegram message polling + webhook
```
