---
title: Configuration & advanced reference
description: Runtime and configuration reference for Aeon — scheduling, chaining, reactive triggers, capability modes, MCP, LLM gateways, strategy and soul, and the security/access controls. Moved out of the README to keep it readable.
---

# Configuration & advanced reference

Everything here is optional. Aeon runs fine without any of it. The [README](../.github/README.md) covers setup; this is the deeper reference it links to.

## Skill chaining

Chain skills so outputs flow between them. Chains run as separate GitHub Actions workflow steps via `chain-runner.yml`:

```yaml
chains:
  digest-pipeline:
    schedule: "0 7 * * *"
    on_error: fail-fast       # or: continue
    steps:
      - parallel: [token-movers, github-trending]   # run concurrently
      - skill: digest, consume: [token-movers, github-trending]   # runs after; outputs injected
```

Each step runs as a separate workflow dispatch; outputs are saved to `output/.chains/{skill}.md` and injected into downstream steps that `consume:` them. `fail-fast` aborts on any failure, `continue` keeps going.

## Reactive triggers

Skills with `schedule: "reactive"` fire on conditions, not cron. The scheduler evaluates triggers after processing cron skills:

```yaml
reactive:
  skill-repair:
    trigger:
      - { on: "*", when: "consecutive_failures >= 3" }
```

## Scheduler frequency

Edit `.github/workflows/scheduler.yml`:

```yaml
schedule:
  - cron: '*/5 * * * *'    # every 5 min (default)
  - cron: '*/15 * * * *'   # every 15 min (saves Actions minutes)
  - cron: '0 * * * *'      # hourly (most conservative)
```

Claude only installs and runs when a skill actually matches - non-matching ticks cost ~10s.

## Circuit breaker (outage protection)

The scheduler trips a per-skill circuit breaker once a skill logs **3 consecutive failures** (`consecutive_failures` in `memory/cron-state.json`). While tripped it stops dispatching that skill every tick - so a dead upstream API or a revoked key can't burn a run every `*/5` for hours - and instead lets **one probe run through every 6 hours** (half-open). A probe that succeeds resets the counter and the skill resumes its normal schedule automatically; a probe that fails re-arms the 6h cooldown. It is auto-recovering, not a kill switch, so an outage self-heals with no operator action. `skill-health` already reports CRITICAL at the same threshold, so a tripped breaker is visible.

Tune with repo variables (both optional):

```
BREAKER_THRESHOLD      failures in a row before tripping (default 3; 0 disables)
BREAKER_COOLDOWN_MIN   minutes between half-open probes while tripped (default 360)
```

The decision logic lives in `scripts/breaker.sh` (unit-tested in `scripts/tests/test_breaker.sh`); the scheduler calls it, no inline copy. To hard-disable a skill instead, set `enabled: false` in `aeon.yml`.

## Capability tiers (read-only skills)

A skill declares its write blast-radius in SKILL.md frontmatter:

```yaml
mode: read-only   # may read the repo, fetch the web, and ./notify — but cannot mutate the repo
mode: write       # full access (the default): adds Write / Edit / git / gh / python3
```

`read-only` strips the repo-mutation tools from Claude Code's `--allowedTools` (`Write`, `Edit`, `Bash(git:*)`, `Bash(gh:*)`) **and** the OS sandbox write-locks the whole workspace for the run (see [Capabilities → enforcement layers](CAPABILITIES.md)), so a research-and-notify skill **physically can't** commit, push, open a PR, or write anywhere in the checkout — `memory/` and `output/` included. Don't write those directly; route persistence through your **final message** (the run's captured output) and `./notify`. After the run, outside the sandbox, the workflow persists your captured output to `output/.chains/`, appends a `memory/logs/` run entry on your behalf, and reverts any stray write that slipped through. Use it for pure read-and-notify skills; `write` (the default, a strict superset) for anything that writes code. It's the runtime half of the install-time [`capabilities:`](../docs/CAPABILITIES.md) hint.

## MCP servers in skill runs

Let skills **call** MCP servers (GitHub, a database, a paid API, your own) while they run in GitHub Actions. Opt-in and safe - with no `.mcp.json` at the repo root, runs are byte-identical to before.

```bash
cp docs/examples/mcp/.mcp.json.example .mcp.json   # then edit, commit, push
```

The example ships two working servers — `github` (uses the runner's built-in `GITHUB_TOKEN`) and `sequential-thinking` (no-auth stdio). On the next run the runner loads `.mcp.json` and auto-allows every server's tools, so a skill can just say *"use the github MCP server to …"*. Reference a server's secret with `${VAR}` (never commit the value) and set it in the dashboard — the runner resolves it from the repo's secrets with zero workflow editing, and skips a server (with a warning) when its secret is missing rather than breaking the skill.

Or skip the file entirely: the dashboard's **MCP** tab writes `.mcp.json` for you, lists **Featured** servers ([Base](https://mcp.base.org), [Robinhood Trading](https://agent.robinhood.com), [glim.sh](https://glim.sh), [Executor](https://executor.sh), [Finance District](https://wallet-mcp.fd.xyz), [PostHog](https://posthog.com)) for one-click install, and tells you which secret each server needs. The featured servers are OAuth-gated: **Connect** opens your browser to authorize, then keeps the tokens fresh across headless runs — including saving rotated refresh tokens, which needs a secrets-write PAT (`GH_SECRETS_PAT`). Flow, PAT setup, and limits: [`docs/mcp-oauth.md`](mcp-oauth.md). Each featured server has a matching skill (`base-mcp`, `robinhood-mcp`, `glim-mcp`, `executor-mcp`, `finance-district-mcp`, and the scheduled `posthog-errors` digest) — dispatch it with a `var` to use the server from a run.

## Cross-repo access

The built-in `GITHUB_TOKEN` is scoped to this repo only. For skills that reach other repos (`github-monitor`, `pr-review`, `feature`, `changelog` push-to, cross-repo reads) add **one classic** personal access token as the `GH_GLOBAL` secret: github.com/settings/tokens -> **Tokens (classic)** -> scopes **`repo`** + **`workflow`** -> add as `GH_GLOBAL`. Skills use it when available and fall back to `GITHUB_TOKEN` automatically, and it is auto-promoted to the run's `GITHUB_TOKEN`.

One classic PAT covers the whole instance - no separate read or secrets PAT is needed:

- **`repo`** - cross-repo and private-repo read/write, repository security advisories + private vulnerability reports (the disclosure/PVR skills), and writing Actions secrets back (the OAuth-MCP / Grok refresh path).
- **`workflow`** - required only for skills that push changes under `.github/workflows/` (`aeon-update`, `spawn-instance`, `auto-workflow`); without it those pushes 403.

`read:org` and `admin:org` are **not** needed - listing an org's repos (e.g. fleet KPIs) works on `repo` scope plus org membership, and nothing administers an org. If your org enforces SAML SSO, authorize the token for the org from the token page. **Classic** (not fine-grained) is recommended: the repository-advisories / PVR API is unreliable with fine-grained PATs.

## Durable state without the churn

Per-skill execution state (`memory/cron-state.json` — status, success rate, quality) is committed as a file by default. The repo variable **`STATE_BACKEND`** switches this: `file` (default) · `issues` (each run appends an immutable event to a closed, append-only GitHub Issue `aeon:cron-state`, so concurrent runs never race — no rewrite, force-push, or rebase-retry; zero file churn) · `dual` (both, for migrating to `issues` without a cutover). Chains record to the same ledger.

## LLM Gateways

<p align="center">
  <img src="../docs/assets/providers.png" alt="Eight AI providers supported: Claude subscription, Anthropic API, OpenRouter, Bankr, UsePod, Venice, Surplus, Grok" width="640" />
</p>

Aeon can power Claude Code **eight** ways. Two are **direct** to Anthropic; the other six route through a **gateway**. Add a credential in the dashboard's Authenticate modal and it's saved as the secret below. (Separately, the [Grok Build harness](harnesses.md) runs the `grok` CLI instead of Claude Code — that's a different axis from the gateways here.)

**Routing is automatic.** `aeon.yml` ships `gateway: { provider: auto }`, and each run resolves the live provider from *whichever secrets are set*, in priority order - so adding or removing a key changes routing with no re-config:

```
claude (CLAUDE_CODE_OAUTH_TOKEN) → anthropic (ANTHROPIC_API_KEY) →
openrouter → bankr → usepod → venice → surplus → grok → direct (fallback)
```

It runs as a **cascade**: the highest-priority provider whose key is set goes first, and on **any** failure (no credits, rate limit, outage, dud response) the run automatically falls over to the next provider whose key is set - so a dead provider degrades gracefully instead of failing the run, and it only errors out if *every* provider fails. The log prints `Routing attempt via '<provider>'` per hop (and `ran via fallback provider …` when it recovers).

Override the order with the repo variable **`GATEWAY_ORDER`** (space-separated names), or pin a single provider (which disables failover) by setting `gateway.provider` to `direct`/`bankr`/`openrouter`/`usepod`/`venice`/`surplus`/`grok` explicitly.

**Direct (`provider: direct`)** - the two Anthropic-native modes from [Authentication](../.github/README.md#authentication) in the README (Claude subscription via `CLAUDE_CODE_OAUTH_TOKEN`, Anthropic API via `ANTHROPIC_API_KEY`), no middleman. Point `ANTHROPIC_API_KEY` at any Anthropic-compatible endpoint with the `ANTHROPIC_BASE_URL` variable.

**Gateways** - route Claude through an alternative provider (cheaper Opus, crypto-settled, privacy-first…). Keys with a distinctive prefix are detected automatically; UsePod and Venice have no prefix, so pick them in the dropdown:

| Gateway | Secret | Notes |
|---------|--------|-------|
| <img src="https://icons.duckduckgo.com/ip3/bankr.bot.ico" width="16" valign="middle"> [Bankr](https://docs.bankr.bot/llm-gateway/overview) | `BANKR_LLM_KEY` | Discounted Opus access |
| <img src="https://icons.duckduckgo.com/ip3/openrouter.ai.ico" width="16" valign="middle"> [OpenRouter](https://openrouter.ai) | `OPENROUTER_API_KEY` | Anthropic-native passthrough; lowest-risk option |
| <img src="https://icons.duckduckgo.com/ip3/usepod.ai.ico" width="16" valign="middle"> [UsePod](https://usepod.ai) | `USEPOD_TOKEN` | Solana marketplace; token is embedded in the base URL, keep it secret |
| <img src="https://icons.duckduckgo.com/ip3/venice.ai.ico" width="16" valign="middle"> [Venice](https://venice.ai) | `VENICE_API_KEY` | Privacy-first; OpenAI-compatible, bridged via a per-run [claude-code-router](https://github.com/musistudio/claude-code-router) sidecar. Point it at any Venice-compatible endpoint with the `VENICE_BASE_URL` repo variable |
| <img src="https://icons.duckduckgo.com/ip3/surplusintelligence.ai.ico" width="16" valign="middle"> [Surplus](https://surplusintelligence.ai) | `SURPLUS_API_KEY` | Routed via The Bridge; settles in USDC on Base - fund the wallet + `approve()` once before use |
| <img src="https://icons.duckduckgo.com/ip3/x.ai.ico" width="16" valign="middle"> [Grok (xAI)](https://x.ai/api) | `XAI_API_KEY` | Anthropic-native passthrough to `api.x.ai`; the `xai-…` key is auto-detected. Set the model with the `GROK_MODEL` repo variable. Same key also powers the [grok harness](harnesses.md) |

#### Adding a gateway

Wiring a new provider through the dashboard registry, resolver, and workflow `env:` is a contributor task — the step-by-step (native vs sidecar tiers, the five files, how to verify the loop) lives in [`CONTRIBUTING.md`](../.github/CONTRIBUTING.md#contributing-an-llm-gateway).

## Strategy

`STRATEGY.md` is Aeon's north-star - your overarching goal, top priorities, audience, and hard constraints. It's imported into `CLAUDE.md`, so it rides along in the context of **every** skill run: when a choice isn't otherwise determined, the strategy breaks the tie ("showcase real output over new features", "depth over breadth"). Keep it tight (it costs tokens every run) and specific (a vague strategy can't break a tie).

Set it three ways from the dashboard's **Strategy** tab:

- **Write it** - edit `STRATEGY.md` inline; Save commits and pushes automatically.
- **Templates** - start from a blank scaffold or one of five archetypes (Indie SaaS, Open-source maintainer, Researcher/Writer, Crypto/Agent, Creator) and fill in the bracketed bits.
- **Build it** - give the `strategy-builder` skill a one-line goal (and optionally a repo or links). It reads your brief plus the repo README and `memory/MEMORY.md`, then drafts a tight north-star / priorities / audience / constraints strategy and commits it. No API key needed; runs as a GitHub Action, so hit **Pull** when it finishes.

## Soul

By default Aeon has no personality. The **Soul** tab gives it one - `soul/SOUL.md` (identity, worldview, opinions) and `soul/STYLE.md` (voice, vocabulary) are read on every run, so notifications and content sound like you. Four ways to set it:

- **Write it** - edit SOUL.md / STYLE.md inline; Save commits and pushes.
- **Templates** - start from a blank scaffold or an archetype (Founder, Researcher, Creator).
- **Install a real soul** - one click pulls a complete example (Karpathy, Garry Tan, Steipete, Vivian Balakrishnan) from the [soul.md](https://github.com/aeonfun/soul.md) gallery into your `soul/`.
- **Build from your handle** - give the `soul-builder` skill any of an X handle, your full name (web search), or links (LinkedIn, site, blog, GitHub). It reads them and drafts SOUL.md + STYLE.md + voice examples in your style. Set `XAI_API_KEY` for the richest read of your actual X timeline - it falls back to web search without it.

Prefer files? Fork [soul.md](https://github.com/aeonfun/soul.md), fill in `SOUL.md` / `STYLE.md` / `examples/good-outputs.md` (10–20 calibration samples), and drop them under `soul/` - same result. The `## Voice` section of `CLAUDE.md` reads them automatically, so identity propagates to every skill.

**Quality check:** soul files work when they're specific enough to be wrong. *"I think most AI safety discourse is galaxy-brained cope"* is useful; *"I have nuanced views on AI safety"* is not.

## Fleet Watcher (authorization layer)

Optional inline ALLOW/BLOCK authorization in front of every skill run: each workflow asks a self-hosted **Fleet Watcher** control plane *"is this allowed?"* before Claude starts (BLOCK = the run exits non-zero and Claude never runs, with an audit ref recorded). It's already wired into `aeon.yml` as two opt-in steps that no-op unless `FLEET_ENDPOINT` + `FLEET_TOKEN` are set — and fail **closed** (skill doesn't run) if Fleet is unreachable when they are. Define your red lines (per-skill caps, counterparty allowlists, dangerous-string patterns) in its dashboard; the postflight always runs so blocked skills are still recorded.

## Remote dashboard access

The dashboard's `/api/*` routes drive `gh workflow run` and read/write repo secrets, so they're gated to loopback callers by default - no remote callers, no DNS-rebinding from a malicious page. To reach the dashboard from another machine or over a tunnel (Tailscale, ngrok, reverse proxy):

| Env var | Behaviour |
|---|---|
| `AEON_DASHBOARD_ALLOWED_HOSTS=aeon.local,box.tail-xxx.ts.net` | Extends the loopback allowlist by hostnames (comma-separated, case- and port-insensitive) |
| `AEON_DASHBOARD_ALLOW_ANY_HOST=1` | Disables Host-header checking entirely. Only for a trusted reverse proxy that terminates `Host` upstream - loudly insecure otherwise |

The gate also rejects state-changing requests whose `Origin` isn't allowlisted, so a malicious page can't drive `/api/secrets` via a no-cors POST. Code: [`apps/dashboard/proxy.ts`](../apps/dashboard/proxy.ts) + [`apps/dashboard/lib/security/api-gate.ts`](../apps/dashboard/lib/security/api-gate.ts).

## Two-repo strategy

This repo is a public template. Run your own instance as a **private fork** so memory, articles, and API keys stay private:

```bash
git remote add upstream https://github.com/aeonfun/aeon.git
git fetch upstream
git merge upstream/main --no-edit
```

Your `memory/`, `output/`, and personal config won't conflict - they're in files that don't exist in the template.

## GitHub Actions cost

![Basically free - runs on your existing Claude subscription and a free GitHub account](../docs/assets/free-aeon.jpg)

| Scenario | Cost |
|----------|------|
| No skill matched (most ticks) | ~10s - checkout + bash + exit |
| Skill runs | 2–10 min depending on complexity |
| Heartbeat (nothing found) | ~2 min |
| **Public repo** | **Unlimited free minutes** |

Private repos: Free plan = 2,000 min/mo, Pro/Team = 3,000 + $0.008/min overage. To reduce usage: switch to `*/15` or hourly cron, disable unused skills, keep the repo public. Every run logs token usage to `memory/token-usage.csv` for a per-skill, per-model cost breakdown.

---

## Authentication

Aeon needs **at least one** way to reach a model. Add it in the dashboard's **Authenticate** modal, or from the terminal with `aeon auth`:

- **A Claude subscription** - one-click OAuth, or `claude setup-token` on the CLI (prints an `sk-ant-oat01-…` token, valid 1 year).
- **An API key** - Anthropic, Anthropic-compatible, or an [LLM gateway](#llm-gateways) key (Bankr, OpenRouter, Surplus, Venice, UsePod). Paste it and the provider is auto-detected from its prefix.
- **A harness's own login** - each harness signs in its own way (Grok with your X account, Codex with ChatGPT, Kimi with Moonshot, and so on), in the modal or with `aeon auth --harness <name>`.

Set several and each run resolves the highest-priority one whose key is present, so you don't have to pick just one.

## Models

The default model for all skills is set in `aeon.yml` (or from the dashboard header dropdown):

```yaml
model: claude-sonnet-5
```

Options: `claude-sonnet-5` (default), `claude-opus-4-8`, `claude-haiku-4-5-20251001`. Per-run overrides are available via workflow dispatch, and individual skills can override to optimize cost:

```yaml
skills:
  token-movers: { enabled: true, schedule: "30 12 * * *", model: "claude-haiku-4-5-20251001" }
```

> Model ids are for the **claude** harness; each other [harness](harnesses.md) carries its own list, which the dashboard picker swaps in when you select it.

## The `var` field

Every skill accepts a single `var` - a universal input each skill interprets its own way:

| Skill type | What `var` does | Example |
|-----------|----------------|---------|
| Research & content | Sets the topic | `var: "rust"` → digest about Rust |
| Dev & code | Narrows to a repo | `var: "owner/repo"` → only review that repo's PRs |
| Crypto | Focuses on a token/wallet | `var: "solana"` → only check SOL price |
| Productivity | Sets the focus area | `var: "shipping v2"` → priority brief emphasizes v2 |

Empty `var` = the skill's default behavior (scan everything, auto-pick topics). Set it from the dashboard or pass it when triggering manually.

## Notifications

Set the secret → channel activates. No code changes needed.

| Channel | Outbound | Inbound |
|---------|---------|---------|
| Telegram | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Same |
| Discord | `DISCORD_WEBHOOK_URL` | `DISCORD_BOT_TOKEN` + `DISCORD_CHANNEL_ID` |
| Slack | `SLACK_WEBHOOK_URL` | `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID` |
| Buzz | `BUZZ_PRIVATE_KEY` + `BUZZ_CHANNEL_ID` (+ `BUZZ_RELAY_URL`) | - |
| Email | `RESEND_API_KEY` + `NOTIFY_EMAIL_TO` | - |

**Set up each channel:**

- **Telegram** - create a bot with **[@BotFather](https://t.me/BotFather)**, then copy its token + your chat ID. Saving the token in the dashboard **auto-registers** the slash-command menu (`/skillname` dispatches instantly, no LLM); a **Re-register commands** button re-syncs it after you toggle skills. Every notification carries **Run again / Schedule weekly** buttons, deep links, and stateless follow-up questions. [Full guide →](telegram-commands.md)
- **Discord** - *outbound:* a channel webhook URL. *Inbound:* a bot token + channel ID, with the `channels:history` scope. ([discord.com/developers](https://discord.com/developers/applications))
- **Slack** - *outbound:* an Incoming Webhook URL. *Inbound:* a bot token + channel ID, with the `channels:history` + `reactions:write` scopes. ([api.slack.com/apps](https://api.slack.com/apps))
- **Email** - [resend.com/api-keys](https://resend.com/api-keys) → Create API Key → set it as `RESEND_API_KEY`, and `NOTIFY_EMAIL_TO` to your inbox. Optional: `NOTIFY_EMAIL_FROM` (default `aeon@notifications.aeon.bot` - **must be a sender/domain verified in Resend**) and `NOTIFY_EMAIL_SUBJECT_PREFIX` (default `[Aeon]`). Same key as security disclosures, so one Resend key powers all outbound email.
- **Buzz** - [Buzz](https://buzz.xyz) is Block's open, self-hostable workspace where humans and agents are first-class members ([github.com/block/buzz](https://github.com/block/buzz)). *Outbound:* set `BUZZ_PRIVATE_KEY` (the agent's `nsec` keypair), `BUZZ_CHANNEL_ID` (target channel UUID from `buzz channels list`), and `BUZZ_RELAY_URL` (your relay; defaults to `http://localhost:3000`). Aeon posts Markdown as itself via the [`buzz` CLI](https://github.com/block/buzz/tree/main/crates/buzz-cli), which signs (NIP-98) and publishes each message over the relay. The CLI must be staged in the run (no prebuilt binary yet - `cargo install --path crates/buzz-cli`); the channel skips silently until it is. Inbound (agent-as-participant) is a later phase.

**Restrict who can command the agent (inbound):** Telegram is scoped to a single `TELEGRAM_CHAT_ID`. That's enough for a **1:1 DM** (there the chat ID *is* your user ID). For a **group/public chat**, also set `TELEGRAM_ALLOWED_USER_ID` to your numeric user ID (from [@userinfobot](https://t.me/userinfobot)) - otherwise any group member can command the bot, including by tapping a **Run again / Schedule weekly** button on a posted notification (Telegram delivers those taps even with group-privacy mode on). Left unset in a group, taps and messages **fail closed**. For Discord and Slack, set the optional repo variables `DISCORD_ALLOWED_AUTHOR_ID` / `SLACK_ALLOWED_USER_ID` (or same-named secrets) to the authorized sender's user ID - inbound messages from anyone else in the channel are then ignored. **Leaving those unset processes commands from any non-bot member of the channel**, so set them whenever the channel isn't private to you.

Want ~1s Telegram replies instead of up-to-5-min polling? See [Telegram instant mode](../apps/webhook/README.md).

## API keys per skill

Skills that call third-party APIs declare their credentials in a `requires:` frontmatter list, so the dashboard shows **which skill needs which key**:

```yaml
requires: [XAI_API_KEY, COINGECKO_API_KEY?]   # bare = required · `?` = works better with
```

The dashboard surfaces this as an **API keys** panel on each skill (set/unset status, inline "Set" button), a ⚠ flag when an enabled skill is missing a required key, and a **"used by"** index under each key in Settings → Access Keys. Skills can likewise declare MCP servers with an `mcp:` list (`mcp: [base]`) - same two tiers, shown as a per-skill **MCP servers** panel with install state. Convention details: [`examples/skill-templates/TEMPLATE.md`](examples/skill-templates/TEMPLATE.md#declaring-api-keys-requires).
