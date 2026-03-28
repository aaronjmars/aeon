<p align="center">
  <img src="assets/aeon.jpg" alt="Aeon" width="120" />
</p>

<h1 align="center">AEON</h1>

<p align="center">
  <strong>Background intelligence that evolves with you.</strong><br>
  Autonomous agent on GitHub Actions, powered by Claude Code. 47 skills across research, dev tooling, crypto monitoring, and productivity — all off by default, enable what you need.
</p>

<p align="center">
  <img src="assets/aeon.gif" alt="Aeon Demo" />
</p>

---

## Why this over OpenClaw?

[OpenClaw](https://github.com/openclaw/openclaw) is great if you need real-time responses and have infra to run it on. Aeon is for everything else:

- **Cheaper** — runs on GitHub Actions, free for public repos, ~$2/mo otherwise. No server.
- **Built for background tasks** — digests, monitoring, research, writing. You don't need sub-second latency for any of that.
- **Doesn't break** — no daemon to crash, no process to restart. If GitHub Actions is up, Aeon is up. Failed skill? Next cron tick retries it.
- **5-minute setup** — fork, add secrets, flip skills on. No Docker, no self-hosting, no config files beyond one YAML.

![OpenClaw vs Aeon](./assets/openclaw.jpg)

---

## Quick start

```bash
git clone https://github.com/aaronjmars/aeon
cd aeon && ./aeon
```

Click on `http://localhost:5555` to open the dashboard in your browser. From there:

1. **Authenticate** — add your Claude API key or OAuth token
2. **Add a channel** — set up [Telegram, Discord, or Slack](#notifications) so Aeon can talk to you (and you can talk back)
3. **Pick skills** — toggle on what you want, set a schedule, and optionally set a `var` to focus each skill
4. **Push** — one click commits and pushes your config to GitHub, Actions takes it from there

You can also schedule and trigger skills by messaging Aeon directly on Telegram — just tell it what you want.

<p align="center">
  <img src="assets/tg.png" alt="Telegram" width="400" />
</p>

---

## Authentication

Set **one** of these — not both:

| Secret | What it is | Billing |
|--------|-----------|---------|
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token from your Claude Pro/Max subscription | Included in plan |
| `ANTHROPIC_API_KEY` | API key from console.anthropic.com | Pay per token |

**Getting an OAuth token:**
```bash
claude setup-token   # opens browser → prints sk-ant-oat01-... (valid 1 year)
```

---

## Skills

![Skills](./assets/skills.jpg)

### Research & Content
| Skill | Description |
|-------|-------------|
| `article` | Research trending topics and write a publication-ready article |
| `digest` | Generate and send a daily digest on a configurable topic |
| `rss-digest` | Fetch, summarize, and deliver RSS feed highlights |
| `hacker-news-digest` | Top HN stories filtered by keywords relevant to your interests |
| `hn-digest` | Top Hacker News stories filtered by interests |
| `paper-digest` | Find and summarize new papers matching tracked research interests |
| `paper-pick` | Find the one paper you should read today from Semantic Scholar and arXiv |
| `tweet-digest` | Aggregate and summarize tweets from tracked accounts |
| `list-digest` | Top tweets from tracked X lists in the past 24 hours |
| `research-brief` | Deep dive on a topic combining web search, papers, and synthesis |
| `fetch-tweets` | Search X/Twitter for tweets by keyword, username, or both |
| `search-papers` | Search for recent academic papers on topics of interest |
| `reddit-digest` | Fetch and summarize top Reddit posts from tracked subreddits |
| `security-digest` | Monitor recent security advisories from GitHub Advisory DB |

### Dev & Code
| Skill | Description |
|-------|-------------|
| `pr-review` | Auto-review open PRs on watched repos and post summary comments |
| `github-monitor` | Watch repos for stale PRs, new issues, and new releases |
| `github-issues` | Check all your repos for new open issues in the last 24 hours |
| `issue-triage` | Label and prioritize new GitHub issues on watched repos |
| `changelog` | Generate a changelog from recent commits across watched repos |
| `code-health` | Weekly report on TODOs, dead code, and test coverage gaps |
| `feature` | Build new features from GitHub issues or improve the agent |
| `build-skill` | Design and build a new reusable skill |
| `search-skill` | Search the open agent skills ecosystem for useful skills to install |

### Crypto / On-chain
| Skill | Description |
|-------|-------------|
| `token-alert` | Notify on price or volume anomalies for tracked tokens |
| `token-movers` | Top 10 token winners and losers by 24h price change from CoinGecko |
| `trending-coins` | Top trending and most searched coins on CoinGecko |
| `wallet-digest` | Summarize recent wallet activity across tracked addresses |
| `on-chain-monitor` | Monitor blockchain addresses and contracts for notable activity |
| `defi-monitor` | Check pool health, positions, and yield rates for tracked protocols |
| `defi-overview` | Daily overview of DeFi activity from DeFiLlama — TVL, top chains, top protocols |
| `polymarket` | Trending and top markets on Polymarket — volume, new markets, biggest movers |
| `polymarket-comments` | Top trending Polymarket markets and most interesting comments |

### Social & Writing
| Skill | Description |
|-------|-------------|
| `write-tweet` | Generate 10 tweet drafts across 5 size tiers on a topic from today's outputs |
| `reply-maker` | Generate two reply options for 5 tweets from tracked accounts or topics |
| `refresh-x` | Fetch a tracked X/Twitter account's latest tweets and save the gist to memory |

### Productivity
| Skill | Description |
|-------|-------------|
| `morning-brief` | Aggregated daily briefing — digests, priorities, and what's ahead |
| `daily-routine` | Morning briefing combining token movers, tweet roundup, paper pick, GitHub issues, and HN digest |
| `weekly-review` | Synthesize the week's logs into a structured retrospective |
| `goal-tracker` | Compare current progress against goals stored in `MEMORY.md` |
| `idea-capture` | Quick note capture triggered via Telegram — stores to memory |
| `action-converter` | 5 concrete real-life actions for today based on recent signals and memory |
| `startup-idea` | 2 startup ideas tailored to your skills, interests, and context |

### Meta / Agent
| Skill | Description |
|-------|-------------|
| `heartbeat` | Proactive ambient check — surface anything worth attention |
| `memory-flush` | Promote important recent log entries into `MEMORY.md` |
| `reflect` | Review recent activity, consolidate memory, and prune stale entries |
| `skill-health` | Check which scheduled skills haven't run recently |
| `self-review` | Weekly audit of what Aeon did, what failed, and what to improve |

---

## Heartbeat

The only skill enabled by default. Runs every 3 hours as a fallback catch-all.

Every run: reads recent memory and logs, checks for stalled PRs (>24h), flagged memory items, urgent issues, and skills that haven't run on schedule. Deduplicates against the last 48h of logs — it won't re-notify you about something it already flagged.

Nothing to report → logs `HEARTBEAT_OK`, exits, no commit. Something needs attention → sends a concise notification.

Heartbeat is listed last in `aeon.yml` so it only runs when no other skill claims the slot.

---

## Configuration

All scheduling lives in `aeon.yml`:

```yaml
skills:
  article:
    enabled: true               # flip to activate
    schedule: "0 8 * * *"       # daily at 8am UTC
  digest:
    enabled: true
    schedule: "0 14 * * *"
    var: "solana"               # topic for this skill
```

Standard cron format. All times UTC. Supports `*`, `*/N`, exact values, comma lists.

**Order matters** — the scheduler picks the first matching skill. Put day-specific skills (e.g. Monday-only) before daily ones. Heartbeat goes last.

### The `var` field

Every skill accepts a single `var` — a universal input that each skill interprets in its own way:

| Skill type | What `var` does | Example |
|-----------|----------------|---------|
| Research & content | Sets the topic | `var: "rust"` → digest about Rust |
| Dev & code | Narrows to a repo | `var: "owner/repo"` → only review that repo's PRs |
| Crypto | Focuses on a token/wallet | `var: "solana"` → only check SOL price |
| Productivity | Sets the focus area | `var: "shipping v2"` → morning brief emphasizes v2 |

If `var` is empty, each skill falls back to its default behavior (scan everything, auto-pick topics, etc.). Set it from the dashboard or pass it when triggering manually.

### Model selection

The default model for all skills is set in `aeon.yml`:

```yaml
model: claude-opus-4-6
```

You can change it from the dashboard header dropdown. Options: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`. Per-run overrides are also available via workflow dispatch.

### Changing check frequency

Edit `.github/workflows/messages.yml`:

```yaml
schedule:
  - cron: '*/5 * * * *'    # every 5 min (default)
  - cron: '*/15 * * * *'   # every 15 min (saves Actions minutes)
  - cron: '0 * * * *'      # hourly (most conservative)
```

Claude only installs and runs when a skill actually matches.

---

## GitHub Actions cost

| Scenario | Cost |
|----------|------|
| No skill matched (most ticks) | ~10s — checkout + bash + exit |
| Skill runs | 2–10 min depending on complexity |
| Heartbeat (nothing found) | ~2 min |
| **Public repo** | **Unlimited free minutes** |

To reduce usage: switch to `*/15` or hourly cron, disable unused skills, keep the repo public.

| Plan | Free minutes/mo | Overage |
|------|----------------|---------|
| Free | 2,000 | N/A (private only) |
| Pro / Team | 3,000 | $0.008/min |

---

## Notifications

Set the secret → channel activates. No code changes needed.

| Channel | Outbound | Inbound |
|---------|---------|---------|
| Telegram | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Same |
| Discord | `DISCORD_WEBHOOK_URL` | `DISCORD_BOT_TOKEN` + `DISCORD_CHANNEL_ID` |
| Slack | `SLACK_WEBHOOK_URL` | `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID` |

**Telegram:** Create a bot with @BotFather → get token + chat ID.  
**Discord:** Outbound: Channel → Integrations → Webhooks → Create. Inbound: discord.com/developers → bot → add `channels:history` scope → copy token + channel ID.  
**Slack:** api.slack.com → Create App → Incoming Webhooks → install → copy URL. Inbound: add `channels:history`, `reactions:write` scopes → copy bot token + channel ID.

### Telegram instant mode (optional)

Default polling has up to 5-min delay. Deploy this ~20-line Cloudflare Worker for ~1s response:

```js
export default {
  async fetch(request, env) {
    const { message } = await request.json();
    if (!message?.text || String(message.chat.id) !== env.TELEGRAM_CHAT_ID)
      return new Response("ignored");

    // Advance offset so polling doesn't reprocess
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${message.update_id + 1}`);

    // Trigger GitHub Actions immediately
    await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
      method: "POST",
      headers: { Authorization: `token ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
      body: JSON.stringify({ event_type: "telegram-message", client_payload: { message: message.text } }),
    });

    return new Response("ok");
  },
};
```

Set env vars (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GITHUB_REPO`, `GITHUB_TOKEN`) in Cloudflare dashboard, then point your bot's webhook at the worker URL.

---

## Cross-repo access

The built-in `GITHUB_TOKEN` is scoped to this repo only. For `github-monitor`, `pr-review`, `issue-triage`, and `feature` to work on your other repos, add a `GH_GLOBAL` personal access token.

| | `GITHUB_TOKEN` | `GH_GLOBAL` |
|--|--------------|------------|
| Scope | This repo | Any repo you grant |
| Created by | GitHub (automatic) | You (manual) |
| Lifetime | Job duration | Up to 1 year |

**Setup:** github.com/settings/tokens → Fine-grained → set repo access → grant Contents, Pull requests, Issues (all read/write) → add as `GH_GLOBAL` secret.

Skills use `GH_GLOBAL` when available, fall back to `GITHUB_TOKEN` automatically.

---

## Adding skills

### Install external skills

```bash
./add-skill BankrBot/skills --list          # browse a repo's skills
./add-skill BankrBot/skills bankr hydrex   # install specific skills
./add-skill BankrBot/skills --all           # install everything
```

Or discover programmatically:
```bash
npx skills find "crypto trading"
```

Installed skills land in `skills/` and are added to `aeon.yml` disabled. Flip `enabled: true` to activate.

### Install individual skills from Aeon

Every skill in this repo is independently installable. Browse the full catalog in [`skills.json`](skills.json) or use the CLI:

```bash
# Install a single skill
./add-skill aaronjmars/aeon token-alert

# Install multiple skills
./add-skill aaronjmars/aeon token-alert polymarket hn-digest

# Install everything
./add-skill aaronjmars/aeon --all

# Browse available skills
./add-skill aaronjmars/aeon --list
```

### Export a skill for distribution

Package any skill as a standalone directory (with a generated README) for sharing:

```bash
./export-skill token-alert              # exports to ./exports/token-alert/
./export-skill token-alert --tar        # also creates a .tar.gz archive
./export-skill --list                   # list all exportable skills
```

### Trigger feature builds from issues

Label any GitHub issue `ai-build` → workflow fires → Claude reads the issue, implements it, opens a PR.

---

## Soul (optional)

By default Aeon has no personality. To make it write and respond like you, add a soul:

1. Fork [soul.md](https://github.com/aaronjmars/soul.md) and fill in your files:
   - `SOUL.md` — identity, worldview, opinions, interests
   - `STYLE.md` — voice, sentence patterns, vocabulary, tone
   - `examples/good-outputs.md` — 10–20 calibration samples
2. Copy into your Aeon repo under `soul/`
3. Add to the top of `CLAUDE.md`:

```markdown
## Identity

Read and internalize before every task:
- `soul/SOUL.md` — identity and worldview
- `soul/STYLE.md` — voice and communication patterns
- `soul/examples.md` — calibration examples

Embody this identity in all output. Never hedge with "as an AI."
```

Every skill reads `CLAUDE.md`, so identity propagates automatically.

**Quality check:** soul files work when they're specific enough to be wrong. *"I think most AI safety discourse is galaxy-brained cope"* is useful. *"I have nuanced views on AI safety"* is not.

---

## Project structure

```
CLAUDE.md                ← agent identity (auto-loaded by Claude Code)
aeon.yml                 ← skill schedules + enabled flags
skills.json              ← machine-readable skill catalog (50 skills)
./notify                 ← multi-channel notifications
./add-skill              ← import skills from GitHub repos
./export-skill           ← package skills for standalone distribution
./generate-skills-json   ← regenerate skills.json from SKILL.md files
soul/                    ← optional identity files
skills/                  ← each skill is SKILL.md (Agent Skills format)
  article/
  digest/
  heartbeat/
  ...                    ← 50 skills total
memory/
  MEMORY.md              ← goals, active topics, pointers
  topics/                ← detailed notes by topic
  logs/                  ← daily activity logs (YYYY-MM-DD.md)
dashboard/               ← local web UI
.github/workflows/
  aeon.yml               ← skill runner (workflow_dispatch, issues)
  messages.yml           ← message polling + scheduler (cron)
```

---

## Two-repo strategy

This repo is a public template. Run your own instance as a **private fork** so memory, articles, and API keys stay private.

```bash
# Pull template updates into your private fork
git remote add upstream https://github.com/aaronjmars/aeon.git
git fetch upstream
git merge upstream/main --no-edit
```

Your `memory/`, `articles/`, and personal config won't conflict — they're in files that don't exist in the template.

---

## Troubleshooting

**Messages not being picked up?**

GitHub has two requirements for scheduled workflows:
1. The workflow file must be on the **default branch** — crons on feature branches don't fire.
2. The repo must have **recent activity** — GitHub disables crons on repos with no commits in 60 days. New template forks need one manual trigger to activate.

**Fix:** Actions → Messages → Run workflow (manual trigger). After that, the cron activates automatically.

---

Support the project : 0xbf8e8f0e8866a7052f948c16508644347c57aba3
