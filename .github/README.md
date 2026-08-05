<p align="center">
  <img src="../docs/assets/aeon.jpg" alt="Aeon" width="120" />
</p>

<h1 align="center">AEON</h1>

<p align="center">
  <a href="https://www.aeon.fun/docs"><img src="https://img.shields.io/badge/Docs-aeon.fun-blue?style=flat-square&logo=gitbook&logoColor=white&labelColor=1a1a2e" alt="Documentation"></a>
  <a href="https://github.com/aeonfun/aeon/stargazers"><img src="https://img.shields.io/github/stars/aeonfun/aeon?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="https://github.com/aeonfun/aeon/network/members"><img src="https://img.shields.io/github/forks/aeonfun/aeon?style=flat-square&logo=github" alt="GitHub forks"></a>
  <a href="https://x.com/aeonframework"><img src="https://img.shields.io/badge/%40aeonframework-black?style=flat-square&logo=x&labelColor=000000" alt="@aeonframework on X"></a>
  <a href="https://bankr.bot/discover/0xbf8e8f0e8866a7052f948c16508644347c57aba3"><img src="https://img.shields.io/badge/%24aeon%20on-Bankr-orange?style=flat-square&labelColor=1a1a2e" alt="$aeon on Bankr"></a>
</p>

<p align="center">
  <strong>The most autonomous agent framework.</strong><br>
  Give it a direction and it gets the work done: ships features to your repos, finds and privately discloses real vulnerabilities, deploys live apps, runs deep research - and writes new skills for itself. No approval loops. No babysitting. Configure once, forget forever.
</p>

<p align="center">
  <img src="../docs/assets/aeon-demo.gif" alt="Aeon Demo" />
</p>

---

## Quick start

You need three things:

1. **Node.js 20+** - grab the LTS installer from [nodejs.org](https://nodejs.org/en/download), or use a package manager: `brew install node` (macOS), `winget install OpenJS.NodeJS.LTS` (Windows), [nvm](https://github.com/nvm-sh/nvm) or your distro's package manager (Linux). Already have it? `node -v` should print 20 or higher.
2. **[GitHub CLI](https://cli.github.com/) (`gh`), authenticated** - the dashboard uses it for everything (secrets, workflows), and `./aeon` checks it before starting. Install: `brew install gh` (macOS), `winget install --id GitHub.cli` (Windows), [per-distro instructions](https://github.com/cli/cli/blob/trunk/docs/install_linux.md) (Linux). Then run `gh auth login` and follow the prompts.
3. **Your own copy of this repo** - click **Use this template** at the top of [the repo page](https://github.com/aeonfun/aeon) - keep it public, Actions minutes are free on public repos. CLI version: `gh repo fork aeonfun/aeon --clone`.

   <img src="../docs/assets/use-template.png" alt="The Use this template button at the top of the repo page" width="240" />

```bash
git clone https://github.com/<you>/aeon   # skip if you used `gh repo fork --clone`
cd aeon && ./aeon
```

Open [http://localhost:5555](http://localhost:5555) and follow the four steps:

1. **Authenticate** - Aeon runs on any of six agent [harnesses](../docs/harnesses.md): Claude Code, Grok, Codex, Pi, Vibe, and Kimi. Connect at least one way to reach a model - a subscription, an API key (Anthropic, Anthropic-compatible, or an [LLM gateway](../docs/CONFIGURATION.md#llm-gateways) key, routed automatically by prefix), or a harness's own native login. More on auth: [Authentication](#authentication).
2. **Add a channel** - [Telegram, Discord, Slack, or email](#notifications) so Aeon can talk to you.
3. **Pick skills** - toggle what you want, set schedules. Each skill shows the API keys and MCP servers it needs, with one-click setup.
4. **Run** - hit **Run now** on any skill to try it immediately; API keys and `var` values apply directly, no push needed. When you change config (schedules, toggles), **Push** commits it to GitHub in one click so Actions runs it on cron.

That's it - Aeon now runs unattended.

Dashboard views, local dev, env vars, and remote access are documented in [`apps/dashboard/README.md`](../apps/dashboard/README.md).

**Prefer the terminal?** Everything the dashboard does is also a command - `./aeon skills ls`, `./aeon skills enable <name>`, `./aeon secrets set …`, `./aeon runs logs <id>`. Same logic, no browser, scriptable with `--json`. See [Command line](../apps/cli/README.md).

**Drive it from a chat?** This repo ships an **[Aeon setup skill](../docs/aeon-setup.md)** - an agent skill that sets up, schedules, edits, and debugs your instance in plain language. It's a standard [Agent Skill](https://code.claude.com/docs/en/skills), so it works with **Claude Code, Codex, Hermes, or OpenClaw** - open the repo folder in your agent and type `/aeon` (it's already there, zero-install).

<details>
<summary><strong>No admin rights / can't install <code>gh</code>?</strong></summary>

Grab the `gh_*_macOS_arm64.zip` (or your platform's binary) from [github.com/cli/cli/releases](https://github.com/cli/cli/releases) and drop it on your `PATH` (e.g. `~/.local/bin`). Then `gh auth login`.

</details>

---

## What Aeon can do

**A skill is a Markdown file: some frontmatter, then a prompt.** No plugin API, nothing to compile. Here's a real one, trimmed:

```yaml
# skills/digest/SKILL.md
---
name: digest
category: basics                 # which pack it belongs to
description: Generate and send a digest on a configurable topic
requires: [XAI_API_KEY?]         # ? = optional key, bare = required
var: ""                          # per-run input - "solana", "rust", "AI agents"…
mode: write
---
```
> Today is ${today}. Generate and send a daily **${var}** digest.
>
> The whole point of a digest is **signal, not volume**. A reader skimming for 60 seconds should walk away with three things they didn't know that morning and one of them should change a decision they'd make this week. Anything that doesn't clear that bar gets cut.

The prompt *is* the skill, judgment and all. You schedule it, hand it a `var`, chain it into others, and Haiku rates every run. **Six packs ship in the box** - Core, Evolution, and Basics are on by default; enable the rest in the dashboard's **Packs** view (a visibility switch, it runs nothing). Full catalog below; how packs work: [`docs/skill-packs.md`](../docs/skill-packs.md).

| Pack | Key | Skills | Examples |
| --- | --- | --- | --- |
| **Core** - fleet coordination, self-config, liveness; shown by default | `core` | 12 | <img src="../docs/assets/skill-icons/fleet-control.svg" width="14" height="14" align="top" alt=""> `fleet-control`, <img src="../docs/assets/skill-icons/spawn-instance.svg" width="14" height="14" align="top" alt=""> `spawn-instance`, <img src="../docs/assets/skill-icons/auto-workflow.svg" width="14" height="14" align="top" alt=""> `auto-workflow` |
| **Evolution** - authors, evolves, installs & heals its own skills; shown by default | `evolution` | 8 | <img src="../docs/assets/skill-icons/create-skill.svg" width="14" height="14" align="top" alt=""> `create-skill`, <img src="../docs/assets/skill-icons/autoresearch.svg" width="14" height="14" align="top" alt=""> `autoresearch`, <img src="../docs/assets/skill-icons/aeon-doctor.svg" width="14" height="14" align="top" alt=""> `aeon-doctor` |
| **Basics** - simple, immediately-runnable skills; shown by default | `basics` | 16 | <img src="../docs/assets/skill-icons/digest.svg" width="14" height="14" align="top" alt=""> `digest`, <img src="../docs/assets/skill-icons/token-movers.svg" width="14" height="14" align="top" alt=""> `token-movers`, <img src="../docs/assets/skill-icons/pr-review.svg" width="14" height="14" align="top" alt=""> `pr-review` |
| **Dev & Code** | `dev` | 10 | <img src="../docs/assets/skill-icons/github-monitor.svg" width="14" height="14" align="top" alt=""> `github-monitor`, <img src="../docs/assets/skill-icons/feature.svg" width="14" height="14" align="top" alt=""> `feature`, <img src="../docs/assets/skill-icons/seo-audit.svg" width="14" height="14" align="top" alt=""> `seo-audit` |
| **Crypto & Markets** | `crypto` | 14 | <img src="../docs/assets/skill-icons/token-pick.svg" width="14" height="14" align="top" alt=""> `token-pick`, <img src="../docs/assets/skill-icons/defi-overview.svg" width="14" height="14" align="top" alt=""> `defi-overview`, <img src="../docs/assets/skill-icons/deploy-uni-hook.svg" width="14" height="14" align="top" alt=""> `deploy-uni-hook` |
| **Productivity** | `productivity` | 6 | <img src="../docs/assets/skill-icons/mention-radar.svg" width="14" height="14" align="top" alt=""> `mention-radar`, <img src="../docs/assets/skill-icons/send-email.svg" width="14" height="14" align="top" alt=""> `send-email`, <img src="../docs/assets/skill-icons/operator-scorecard.svg" width="14" height="14" align="top" alt=""> `operator-scorecard` |

<details>
<summary><strong>Full catalog (all 66 skills by pack)</strong></summary>

Three packs are shown by default (**Core**, **Evolution**, **Basics**); the rest are revealed on demand.

| Pack | Skills |
|------|--------|
| **Core** (`core`, 12) | <img src="../docs/assets/skill-icons/aeon-update.svg" width="14" height="14" align="top" alt=""> `aeon-update`, <img src="../docs/assets/skill-icons/auto-merge.svg" width="14" height="14" align="top" alt=""> `auto-merge`, <img src="../docs/assets/skill-icons/auto-workflow.svg" width="14" height="14" align="top" alt=""> `auto-workflow`, <img src="../docs/assets/skill-icons/fleet-control.svg" width="14" height="14" align="top" alt=""> `fleet-control`, <img src="../docs/assets/skill-icons/fork-fleet.svg" width="14" height="14" align="top" alt=""> `fork-fleet`, <img src="../docs/assets/skill-icons/heartbeat.svg" width="14" height="14" align="top" alt=""> `heartbeat`, <img src="../docs/assets/skill-icons/memory-flush.svg" width="14" height="14" align="top" alt=""> `memory-flush`, <img src="../docs/assets/skill-icons/narrative-convergence.svg" width="14" height="14" align="top" alt=""> `narrative-convergence`, <img src="../docs/assets/skill-icons/shiplog.svg" width="14" height="14" align="top" alt=""> `shiplog`, <img src="../docs/assets/skill-icons/soul-builder.svg" width="14" height="14" align="top" alt=""> `soul-builder`, <img src="../docs/assets/skill-icons/spawn-instance.svg" width="14" height="14" align="top" alt=""> `spawn-instance`, <img src="../docs/assets/skill-icons/strategy-builder.svg" width="14" height="14" align="top" alt=""> `strategy-builder` |
| **Evolution** (`evolution`, 8) | <img src="../docs/assets/skill-icons/aeon-doctor.svg" width="14" height="14" align="top" alt=""> `aeon-doctor`, <img src="../docs/assets/skill-icons/autoresearch.svg" width="14" height="14" align="top" alt=""> `autoresearch`, <img src="../docs/assets/skill-icons/create-skill.svg" width="14" height="14" align="top" alt=""> `create-skill`, <img src="../docs/assets/skill-icons/install-skill.svg" width="14" height="14" align="top" alt=""> `install-skill`, <img src="../docs/assets/skill-icons/search-skill.svg" width="14" height="14" align="top" alt=""> `search-skill`, <img src="../docs/assets/skill-icons/self-improve.svg" width="14" height="14" align="top" alt=""> `self-improve`, <img src="../docs/assets/skill-icons/skill-health.svg" width="14" height="14" align="top" alt=""> `skill-health`, <img src="../docs/assets/skill-icons/skill-repair.svg" width="14" height="14" align="top" alt=""> `skill-repair` |
| **Basics** (`basics`, 16) | <img src="../docs/assets/skill-icons/action-converter.svg" width="14" height="14" align="top" alt=""> `action-converter`, <img src="../docs/assets/skill-icons/article.svg" width="14" height="14" align="top" alt=""> `article`, <img src="../docs/assets/skill-icons/bd-radar.svg" width="14" height="14" align="top" alt=""> `bd-radar`, <img src="../docs/assets/skill-icons/digest.svg" width="14" height="14" align="top" alt=""> `digest`, <img src="../docs/assets/skill-icons/executor-mcp.svg" width="14" height="14" align="top" alt=""> `executor-mcp`, <img src="../docs/assets/skill-icons/fetch-tweets.svg" width="14" height="14" align="top" alt=""> `fetch-tweets`, <img src="../docs/assets/skill-icons/github-trending.svg" width="14" height="14" align="top" alt=""> `github-trending`, <img src="../docs/assets/skill-icons/glim-mcp.svg" width="14" height="14" align="top" alt=""> `glim-mcp`, <img src="../docs/assets/skill-icons/idea-forge.svg" width="14" height="14" align="top" alt=""> `idea-forge`, <img src="../docs/assets/skill-icons/last30.svg" width="14" height="14" align="top" alt=""> `last30`, <img src="../docs/assets/skill-icons/pr-review.svg" width="14" height="14" align="top" alt=""> `pr-review`, <img src="../docs/assets/skill-icons/price-alert.svg" width="14" height="14" align="top" alt=""> `price-alert`, <img src="../docs/assets/skill-icons/token-movers.svg" width="14" height="14" align="top" alt=""> `token-movers`, <img src="../docs/assets/skill-icons/tx-explain.svg" width="14" height="14" align="top" alt=""> `tx-explain`, <img src="../docs/assets/skill-icons/write-tweet.svg" width="14" height="14" align="top" alt=""> `write-tweet`, <img src="../docs/assets/skill-icons/you-web-search.svg" width="14" height="14" align="top" alt=""> `you-web-search` |
| **Dev & Code** (`dev`, 10) | <img src="../docs/assets/skill-icons/changelog.svg" width="14" height="14" align="top" alt=""> `changelog`, <img src="../docs/assets/skill-icons/deploy-prototype.svg" width="14" height="14" align="top" alt=""> `deploy-prototype`, <img src="../docs/assets/skill-icons/feature.svg" width="14" height="14" align="top" alt=""> `feature`, <img src="../docs/assets/skill-icons/github-monitor.svg" width="14" height="14" align="top" alt=""> `github-monitor`, <img src="../docs/assets/skill-icons/inbox-triage.svg" width="14" height="14" align="top" alt=""> `inbox-triage`, <img src="../docs/assets/skill-icons/posthog-errors.svg" width="14" height="14" align="top" alt=""> `posthog-errors`, <img src="../docs/assets/skill-icons/pr-triage.svg" width="14" height="14" align="top" alt=""> `pr-triage`, <img src="../docs/assets/skill-icons/seo-audit.svg" width="14" height="14" align="top" alt=""> `seo-audit`, <img src="../docs/assets/skill-icons/vuln-scanner.svg" width="14" height="14" align="top" alt=""> `vuln-scanner`, <img src="../docs/assets/skill-icons/vuln-tracker.svg" width="14" height="14" align="top" alt=""> `vuln-tracker` |
| **Crypto & Markets** (`crypto`, 14) | <img src="../docs/assets/skill-icons/base-mcp.svg" width="14" height="14" align="top" alt=""> `base-mcp`, <img src="../docs/assets/skill-icons/defi-overview.svg" width="14" height="14" align="top" alt=""> `defi-overview`, <img src="../docs/assets/skill-icons/deploy-uni-hook.svg" width="14" height="14" align="top" alt=""> `deploy-uni-hook`, <img src="../docs/assets/skill-icons/distribute-tokens.svg" width="14" height="14" align="top" alt=""> `distribute-tokens`, <img src="../docs/assets/skill-icons/finance-district-mcp.svg" width="14" height="14" align="top" alt=""> `finance-district-mcp`, <img src="../docs/assets/skill-icons/investigation-report.svg" width="14" height="14" align="top" alt=""> `investigation-report`, <img src="../docs/assets/skill-icons/monitor-polymarket.svg" width="14" height="14" align="top" alt=""> `monitor-polymarket`, <img src="../docs/assets/skill-icons/narrative-tracker.svg" width="14" height="14" align="top" alt=""> `narrative-tracker`, <img src="../docs/assets/skill-icons/onchain-monitor.svg" width="14" height="14" align="top" alt=""> `onchain-monitor`, <img src="../docs/assets/skill-icons/picks-tracker.svg" width="14" height="14" align="top" alt=""> `picks-tracker`, <img src="../docs/assets/skill-icons/pm-manipulation.svg" width="14" height="14" align="top" alt=""> `pm-manipulation`, <img src="../docs/assets/skill-icons/robinhood-mcp.svg" width="14" height="14" align="top" alt=""> `robinhood-mcp`, <img src="../docs/assets/skill-icons/token-pick.svg" width="14" height="14" align="top" alt=""> `token-pick`, <img src="../docs/assets/skill-icons/unlock-monitor.svg" width="14" height="14" align="top" alt=""> `unlock-monitor` |
| **Productivity** (`productivity`, 6) | <img src="../docs/assets/skill-icons/idea-pipeline.svg" width="14" height="14" align="top" alt=""> `idea-pipeline`, <img src="../docs/assets/skill-icons/mention-radar.svg" width="14" height="14" align="top" alt=""> `mention-radar`, <img src="../docs/assets/skill-icons/operator-scorecard.svg" width="14" height="14" align="top" alt=""> `operator-scorecard`, <img src="../docs/assets/skill-icons/reply-maker.svg" width="14" height="14" align="top" alt=""> `reply-maker`, <img src="../docs/assets/skill-icons/schedule-ads.svg" width="14" height="14" align="top" alt=""> `schedule-ads`, <img src="../docs/assets/skill-icons/send-email.svg" width="14" height="14" align="top" alt=""> `send-email` |

Authoritative source: [`skills.json`](../catalog/skills.json) + [`packs.json`](../catalog/packs.json), the dashboard **Packs** view, or `bin/add-skill aeonfun/aeon --list`. A skill's pack comes from its `category:` frontmatter - see [`docs/skill-packs.md`](../docs/skill-packs.md).

</details>

### It heals itself

![Anatomy of a skill run](../docs/assets/skill-run-aeon.jpg)

Every skill output is automatically scored 1–5 by Haiku after each run. Scores and failure flags (`api_error`, `stale_data`, `rate_limited`) are tracked per skill in `memory/skill-health/` with a rolling 30-run history. When something breaks, the loop fixes it without you:

1. **`heartbeat`** (daily) - detects failed, stuck, or chronically broken skills
2. **`skill-health`** - audits quality scores and flags API degradation patterns
3. **`skill-repair`** - diagnoses and patches failing skills automatically
4. **`self-improve`** - evolves prompts, config, and workflows based on performance

Alongside this run-quality loop, **`aeon-doctor`** (opt-in, weekly) lints the *config itself* for the silent-misconfig class that never produces a failed run to detect - an unquoted `schedule:` that never fires, a duplicate key, a `mode:` typo. It's read-only: it surfaces findings and points the fix at `skill-repair`, never mutating config itself.

Health skills file issues, repair skills close them. `heartbeat` is the only skill enabled by default: nothing to report → silent; something needs attention → one notification. Deep dive: [`docs/CORE.md`](../docs/CORE.md).

**Votable health** (on by default - set the repo variable `HEALTH_ISSUES=0` to turn it off): when a skill regresses (a Haiku score of 1–2 or a failure flag), the loop opens or comments on a per-skill GitHub Issue titled `health: <skill>`; clean runs stay silent, so there's no issue spam. 👍/👎 the issue and `self-improve` / `skill-repair` triage the most-voted, worst-scoring skills first - a visible, conflict-free repair queue you can steer.

### It replicates

Aeon can spawn and manage copies of itself. `spawn-instance` forks the repo into a new specialized instance (`var: "crypto-tracker: monitor DeFi protocols"`), selects relevant skills, and registers it in `memory/instances.json` - no secrets propagated, billing stays isolated. `fleet-control` health-checks and dispatches across instances; its `scorecard` mode tracks fleet economics.

### It ships real work

- **`feature`** - ships code unprompted, to your watched repos or any repo with `var: external:<owner/repo>`.
- **`deploy-prototype`** - generates and deploys live web apps to Vercel.
- **`vuln-scanner`** - finds real code vulnerabilities and reports them only through the maintainer's private channel (GitHub's advisory system or a private email, never a public issue), with drafts waiting for your review by default and any project that declines AI-authored reports skipped.
- **`autoresearch`** - evolves existing skills through scored variations.
- **`create-skill`** - generates new ones from a sentence.

### Add more skills

```bash
bin/add-skill aeonfun/aeon --list        # browse the built-in catalog
bin/add-skill BankrBot/skills bankr hydrex  # install from any GitHub repo
bin/add-skill BankrBot/skills --all         # install everything from a repo
bin/export-skill token-movers               # package one for standalone use
```

Installed skills land in `skills/` and are added to `aeon.yml` disabled - flip `enabled: true` to activate. You can also:

- **Build your own** from [`docs/examples/skill-templates/`](../docs/examples/skill-templates/TEMPLATE.md): `bin/new-from-template <template> <skill-name> --category <pack>` - the `--category` slots it into a pack (or set `category:` in the SKILL.md frontmatter). See [`docs/skill-packs.md`](../docs/skill-packs.md).
- **Use one skill elsewhere** without forking: drop a portable workflow from [`docs/examples/workflow-templates/`](../docs/examples/workflow-templates) into any repo's `.github/workflows/`.
- **Label any GitHub issue `ai-build`** - Claude reads the issue, implements it, and opens a PR
- **Install community packs** - see [Community Packs](#community-packs)

---

## Proof of work

Aeon's skills ship to production. These numbers are live at **[aeon.fun](https://www.aeon.fun)**.

| Skill | In production |
|-------|---------------|
| **`vuln-scanner`** | **~1.6M GitHub stars secured** - real vulnerabilities found, patched, and responsibly disclosed across 54 open-source projects (31 rated High/Critical). [Every disclosure →](https://www.aeon.fun/security) |
| **ecosystem** | **72 products & agents** built on Aeon. [`ECOSYSTEM.md`](../docs/ECOSYSTEM.md) |
| **community** | **11 community skill packs** published to the registry. [`community-skill-packs.md`](../docs/community-skill-packs.md) |

**One skill, end to end.** `vuln-scanner` clones a repo from your watchlist, runs Semgrep, OSV, and TruffleHog, then triages the hits hard - a finding ships only if it's exploitable, not theoretical, and you'd defend it to the maintainer's face. Most are discarded. What survives becomes a maintainer-ready report, sent through the repo's private advisory channel with a proposed patch pushed to your fork for the maintainer to cherry-pick. That loop, run across the open-source wild, is what the numbers above are made of.

---

## Guardrails

Autonomy needs brakes. Aeon ships several, on by default or one flag away.

- **Read-only skills can't touch the repo.** A skill marked `mode: read-only` runs with no write, git, or `gh` tools. It cannot commit, push, or open a PR, and a post-run guard reverts any stray write.
- **Irreversible actions fail closed.** Money transfers preflight the balance and dedupe per recipient. Disclosure emails sit behind a daily cap and a kill-switch. Ad spend trips a circuit-breaker. A failed send stays failed; nothing retries blindly.
- **An optional authorization layer gates every run.** Point `FLEET_ENDPOINT` + `FLEET_TOKEN` at a self-hosted Fleet Watcher and each run asks "is this allowed?" before Claude starts. It fails closed when the control plane is unreachable.
- **Secrets stay off the command line.** Auth'd calls go through `./secretcurl` with `{PLACEHOLDER}` tokens. The dashboard answers only to loopback until you allowlist a host.

Details for each are in the [configuration reference](../docs/CONFIGURATION.md).

---

## Why "the most autonomous"

Most agent tools keep you in the loop. Approve this call, review this diff, confirm this action. Aeon is built for the work you want done while you're away: briefings, market monitoring, PR reviews, research digests, security scans. It runs on a schedule, remembers across runs, reacts to conditions, and repairs its own broken skills. No other framework does all four unattended.

You still reach for Claude Code to write code by hand. For the recurring work that doesn't need you watching, the most autonomous agent is the one that never asks.

See [`SHOWCASE.md`](../docs/SHOWCASE.md) for how Aeon stacks up against AutoGen, CrewAI, n8n, and LangGraph, and [`ECOSYSTEM.md`](../docs/ECOSYSTEM.md) for products built on it.

![Autonomy spectrum](../docs/assets/autonomy-aeon.jpg)

---

## Configure

![Aeon never sleeps - a full day of autonomous runs](../docs/assets/never-sleeps-aeon.jpg)

### Schedules

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

Standard cron format, all times UTC (`*`, `*/N`, exact values, comma lists). Every enabled skill whose cron is due dispatches on each tick, in parallel; `depends_on:` is the only thing that orders them. Scheduler cadence, reactive triggers, and skill chaining: [Configuration](../docs/CONFIGURATION.md#scheduler-frequency).

### The `var` field

Every skill accepts a single `var` - a universal input each skill interprets its own way:

| Skill type | What `var` does | Example |
|-----------|----------------|---------|
| Research & content | Sets the topic | `var: "rust"` → digest about Rust |
| Dev & code | Narrows to a repo | `var: "owner/repo"` → only review that repo's PRs |
| Crypto | Focuses on a token/wallet | `var: "solana"` → only check SOL price |
| Productivity | Sets the focus area | `var: "shipping v2"` → priority brief emphasizes v2 |

Empty `var` = the skill's default behavior (scan everything, auto-pick topics). Set it from the dashboard or pass it when triggering manually.

### Models

The default model for all skills is set in `aeon.yml` (or from the dashboard header dropdown):

```yaml
model: claude-sonnet-5
```

Options: `claude-sonnet-5` (default), `claude-opus-5`, `claude-haiku-4-5-20251001`. Per-run overrides are available via workflow dispatch, and individual skills can override to optimize cost:

```yaml
skills:
  token-movers: { enabled: true, schedule: "30 12 * * *", model: "claude-haiku-4-5-20251001" }
```

> Model ids are for the **claude** harness; each other [harness](../docs/harnesses.md) carries its own list, which the dashboard picker swaps in when you select it.

### Authentication

Aeon needs **at least one** way to reach a model. Add it in the dashboard's **Authenticate** modal, or from the terminal with `aeon auth`:

- **A Claude subscription** - one-click OAuth, or `claude setup-token` on the CLI (prints an `sk-ant-oat01-…` token, valid 1 year).
- **An API key** - Anthropic, Anthropic-compatible, or an [LLM gateway](../docs/CONFIGURATION.md#llm-gateways) key (Bankr, OpenRouter, Surplus, Venice, UsePod). Paste it and the provider is auto-detected from its prefix.
- **A harness's own login** - each harness signs in its own way (Grok with your X account, Codex with ChatGPT, Kimi with Moonshot, and so on), in the modal or with `aeon auth --harness <name>`.

Set several and each run resolves the highest-priority one whose key is present, so you don't have to pick just one.

### Notifications

Set the secret → channel activates. No code changes needed.

| Channel | Outbound | Inbound |
|---------|---------|---------|
| Telegram | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Same |
| Discord | `DISCORD_WEBHOOK_URL` | `DISCORD_BOT_TOKEN` + `DISCORD_CHANNEL_ID` |
| Slack | `SLACK_WEBHOOK_URL` | `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID` |
| Buzz | `BUZZ_PRIVATE_KEY` + `BUZZ_CHANNEL_ID` (+ `BUZZ_RELAY_URL`) | - |
| Email | `RESEND_API_KEY` + `NOTIFY_EMAIL_TO` | - |

**Set up each channel:**

- **Telegram** - create a bot with **[@BotFather](https://t.me/BotFather)**, then copy its token + your chat ID. Saving the token in the dashboard **auto-registers** the slash-command menu (`/skillname` dispatches instantly, no LLM); a **Re-register commands** button re-syncs it after you toggle skills. Every notification carries **Run again / Schedule weekly** buttons, deep links, and stateless follow-up questions. [Full guide →](../docs/telegram-commands.md)
- **Discord** - *outbound:* a channel webhook URL. *Inbound:* a bot token + channel ID, with the `channels:history` scope. ([discord.com/developers](https://discord.com/developers/applications))
- **Slack** - *outbound:* an Incoming Webhook URL. *Inbound:* a bot token + channel ID, with the `channels:history` + `reactions:write` scopes. ([api.slack.com/apps](https://api.slack.com/apps))
- **Email** - [resend.com/api-keys](https://resend.com/api-keys) → Create API Key → set it as `RESEND_API_KEY`, and `NOTIFY_EMAIL_TO` to your inbox. Optional: `NOTIFY_EMAIL_FROM` (default `aeon@notifications.aeon.bot` - **must be a sender/domain verified in Resend**) and `NOTIFY_EMAIL_SUBJECT_PREFIX` (default `[Aeon]`). Same key as security disclosures, so one Resend key powers all outbound email.
- **Buzz** - [Buzz](https://buzz.xyz) is Block's open, self-hostable workspace where humans and agents are first-class members ([github.com/block/buzz](https://github.com/block/buzz)). *Outbound:* set `BUZZ_PRIVATE_KEY` (the agent's `nsec` keypair), `BUZZ_CHANNEL_ID` (target channel UUID from `buzz channels list`), and `BUZZ_RELAY_URL` (your relay; defaults to `http://localhost:3000`). Aeon posts Markdown as itself via the [`buzz` CLI](https://github.com/block/buzz/tree/main/crates/buzz-cli), which signs (NIP-98) and publishes each message over the relay. The CLI must be staged in the run (no prebuilt binary yet - `cargo install --path crates/buzz-cli`); the channel skips silently until it is. Inbound (agent-as-participant) is a later phase.

**Restrict who can command the agent (inbound):** Telegram is scoped to a single `TELEGRAM_CHAT_ID`. That's enough for a **1:1 DM** (there the chat ID *is* your user ID). For a **group/public chat**, also set `TELEGRAM_ALLOWED_USER_ID` to your numeric user ID (from [@userinfobot](https://t.me/userinfobot)) - otherwise any group member can command the bot, including by tapping a **Run again / Schedule weekly** button on a posted notification (Telegram delivers those taps even with group-privacy mode on). Left unset in a group, taps and messages **fail closed**. For Discord and Slack, set the optional repo variables `DISCORD_ALLOWED_AUTHOR_ID` / `SLACK_ALLOWED_USER_ID` (or same-named secrets) to the authorized sender's user ID - inbound messages from anyone else in the channel are then ignored. **Leaving those unset processes commands from any non-bot member of the channel**, so set them whenever the channel isn't private to you.

Want ~1s Telegram replies instead of up-to-5-min polling? See [Telegram instant mode](../apps/webhook/README.md).

### API keys per skill

Skills that call third-party APIs declare their credentials in a `requires:` frontmatter list, so the dashboard shows **which skill needs which key**:

```yaml
requires: [XAI_API_KEY, COINGECKO_API_KEY?]   # bare = required · `?` = works better with
```

The dashboard surfaces this as an **API keys** panel on each skill (set/unset status, inline "Set" button), a ⚠ flag when an enabled skill is missing a required key, and a **"used by"** index under each key in Settings → Access Keys. Skills can likewise declare MCP servers with an `mcp:` list (`mcp: [base]`) - same two tiers, shown as a per-skill **MCP servers** panel with install state. Convention details: [`docs/examples/skill-templates/TEMPLATE.md`](../docs/examples/skill-templates/TEMPLATE.md#declaring-api-keys-requires).

---

## Community Packs

![Aeon Framework ecosystem map](../docs/assets/ecosystem-aeon.jpg)

> Aeon's **built-in (first-party) packs** - Core, Evolution, Basics, Dev, Crypto, Productivity - live in this repo and are enabled from the dashboard's **Packs** view; see [`docs/skill-packs.md`](../docs/skill-packs.md). The packs below are **community** collections in their own repos.

Third-party skill collections in their own repos, installable as one bundle - two ways:

**One-click (dashboard).** Open the **Packs** view, scroll to **Community packs**, and hit **Install pack** on any card. That runs the security-scanned installer in the background and ships an **auto-merging PR**, so the skills land on `main` (and show up across the dashboard) with no manual step. Want to merge it yourself instead? The card's copy button hands you the exact CLI command below.

**CLI.**

```bash
bin/install-skill-pack AntFleet/aeon-skills
bin/install-skill-pack --list      # browse the registry (skill-packs.json)
```

Either way the installer reads the pack's `skills-pack.json` manifest, runs the security scanner on each `SKILL.md`, and copies approved skills into `skills/` - **disabled** in `aeon.yml` (nothing runs until you set the pack's secrets and flip `enabled: true`), with provenance recorded in `skills.lock`. Full schema and trust model: [`docs/community-skill-packs.md`](../docs/community-skill-packs.md).

| Pack | Skills | Description |
|------|--------|-------------|
| [aeon-skills](https://github.com/AntFleet/aeon-skills) | 2 | Two-model-consensus PR review (Opus 4.7 + GPT-5), x402 pay-per-call for public repos. |
| [aeon-skill-pack-liquidpad](https://github.com/liquidpadbot/aeon-skill-pack-liquidpad) | 4 | Track LiquidPad on Base: burn alerts, launches, digest, fee accrual. |
| [aeon-skill-pack-mythosforge](https://github.com/ryjin111/aeon-skill-pack-mythosforge) | 5 | Read-only MythosForge monitoring: ops/jury/payout health and proof-of-creation integrity on Base. |
| [signa](https://github.com/codexvritra/signa) (`--path aeon-skills`) | 20 | Wallet-signed cross-platform agent messaging, encrypted rooms, and x402 bounded-spend mandates. |
| [Atrium Skills](https://github.com/Atrium-Hermes/aeon-atrium-skills) | 3 | Publish, rent, and earn from agent skills on Atrium, the onchain skill marketplace on Base. |
| [aeon-skill-pack-mneme](https://github.com/mnemedb/aeon-skill-pack-mneme) | 8 | Persistent memory layer: vector recall, entity graph, and Base chain streams. One key, zero infra. |
| [clawhunter-skills](https://github.com/clawhunter/clawhunter-skills) | 2 | Aggregates and AI-triages crypto bounties across venues; paid research/create tools settle via x402. |
| [Polymarket Trader by Simmer](https://github.com/SpartanLabsXyz/aeon-skill-pack-polymarket/tree/main/aeon-skill-pack) (`--path aeon-skill-pack`) | 3 | Signal, discovery, and real order-placing on Polymarket (simulate-by-default, live opt-in). |
| [Charon for AEON](https://github.com/CharonAI-code/charon/tree/main/skills/aeon) (`--path skills/aeon`) | 2 | Repo-local policy enforcement for AEON runs, with natural-language policy management. |
| [aeon-skill-pack-agentlink](https://github.com/techdigger/aeon-skill-pack-agentlink) | 1 | Verified, human-backed on-chain identity on Base via AgentLink. Read-only, on-demand. |
| [AI2Human Create Task](https://github.com/richard7463/ai2human-aeon-skill-pack) | 1 | Route a blocked human step to AI2Human: dispatch human execution, then follow the proof, verify, settle loop before USDC payout. |

**To list a pack here**, open a PR that adds a table row **and** a matching [`catalog/skill-packs.json`](../catalog/skill-packs.json) entry. The full checklist - public repo + license, a per-skill `SKILL.md`, a `skills-pack.json` manifest, the registry schema, and the trust model - is in [`docs/community-skill-packs.md`](../docs/community-skill-packs.md#pack-maintainers-publishing-checklist).

---

## Integrate Aeon

Building a product on top of Aeon - a dashboard, a vertical agent, a service your users connect? An Aeon instance is just a GitHub repo + Actions, so **GitHub's API is Aeon's API**: one GitHub App gives your app authorized, revocable access to your users' instances - no PATs, no credential custody, no agent runtime or LLM billing on your side.

<div align="center">
  <img src="../docs/assets/integrate-aeon.png" alt="Integrate Aeon" width="256" />
</div>

- **Drive instances** - log users in with GitHub, mint short-lived installation tokens, dispatch skills (`workflow_dispatch`), edit `aeon.yml`, write sealed Actions secrets.
- **Ship your product as skills** - publish a [community skill pack](../docs/community-skill-packs.md) so every Aeon agent can call your API or MCP server.
- **Close the loop** - your onboarding installs your pack, injects your API key into the user's repo secrets, and enables the skills; the agent reports into channels the user already uses.

The full walkthrough - App permissions, the tenant-isolation check, dispatch gotchas, pack publishing - is the **[ADK (Aeon Developer Kit)](../docs/ADK.md)**.

---

## Reference & advanced

Everything above gets you running. The deeper reference lives in [`docs/`](../docs) so this page stays short.

- **[Configuration & advanced](../docs/CONFIGURATION.md)** - skill chaining, reactive triggers, scheduler frequency, capability modes, MCP in runs, cross-repo tokens, `STRATEGY.md` / soul, Fleet Watcher, remote dashboard, two-repo setup, Actions cost.
- **[ADK (Aeon Developer Kit)](../docs/ADK.md)** - build products on top of Aeon: authorize access to your users' instances with a GitHub App, drive skills over the GitHub API, and ship your own skills as a pack.
- **[LLM gateways](../docs/CONFIGURATION.md#llm-gateways)** - eight ways to power Claude Code, resolved by an automatic fail-over cascade.
- **[Harnesses](../docs/harnesses.md)** - run skills on any of six agent CLIs (Claude Code, Grok, Codex, Pi, Vibe, Kimi) behind one contract via [`harness-adapter`](../harness-adapter/); auth, token accounting, per-skill knobs, and the live verification matrix.
- **[Use Aeon's skills from Claude](../apps/mcp-server/README.md)** - every skill as an `aeon-<name>` MCP tool in Claude Desktop and Code.
- **[Command line](../apps/cli/README.md)** - the whole dashboard as scriptable `./aeon` commands.
- **[Telegram instant mode](../apps/webhook/README.md)** - ~1s replies via a self-hosted Cloudflare Worker.
- **[Observability](../docs/langfuse.md)** and **[provenance](../docs/attestation.md)** - optional Langfuse tracing and Sigstore attestation.
- **[Project layout](CONTRIBUTING.md#project-layout)** - an annotated tour of the repo.

---

## Support the project

`0xbf8e8f0e8866a7052f948c16508644347c57aba3`
