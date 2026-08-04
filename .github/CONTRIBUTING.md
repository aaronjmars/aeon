# Contributing to Aeon

Thanks for helping make Aeon the default way people run autonomous agents. This
guide collects the conventions already used across the repo so you don't have to
reverse-engineer them from existing PRs.

## Ways to contribute

Most contributions fall into one of three buckets, each with its own checklist below:

- **A new skill** — published as your own **community skill pack** (your repo), then listed here. New skills don't go into the core catalog.
- **A new LLM gateway** — wiring a provider through the five files that resolve it.
- **A core fix** — dashboard, scripts, workflows, docs, or an improvement to an existing core skill.

## Before you start

- **Fork or use the template.** This repo is a public template — click **Use this
  template** (or `gh repo fork aeonfun/aeon --clone`). Run your own instance as
  a fork; open PRs back here for changes that benefit everyone.
- **Branch from `main`.** Never push to `main`. Use a descriptive branch name
  (`feat/…`, `fix/…`, `docs/…`).
- **One change per PR.** A focused 20-line fix lands faster than a 500-line bundle.
- **PRs are squash-merged.** Write a clear PR title — it becomes the commit
  subject on `main`.

## Development setup

You need **Node.js 20+** and an authenticated **[GitHub CLI](https://cli.github.com/)
(`gh`)**. Then:

```bash
git clone https://github.com/<you>/aeon && cd aeon
./aeon                 # launches the dashboard on http://localhost:5555
```

The dashboard manages config (skills, schedules, secrets) and pushes it to GitHub
as repo secrets/vars. Run `bin/onboard` anytime to verify your setup. Local dev
for the dashboard app itself is documented in
[`apps/dashboard/README.md`](../apps/dashboard/README.md).

### Contributing a skill

**New skills ship as your own community skill pack, not as a PR into the core catalog.** The core `skills/` set is curated by the maintainers to keep the default install lean — anyone extends Aeon by publishing a **community skill pack**: a small public repo of skills that users install in one click from the dashboard's **Packs** view. You keep ownership, licensing, and release cadence. (PRs that *fix or improve an existing core skill* are welcome as a normal PR — that's a core fix, not a new skill.)

**1. Build the skill.** Scaffold from a template, then write its `SKILL.md`:

```bash
bin/new-from-template <template> <skill-name> --category <pack>
```

Every `SKILL.md` opens with YAML frontmatter — the full contract is in
[`docs/examples/skill-templates/TEMPLATE.md`](../docs/examples/skill-templates/TEMPLATE.md). Essentials:

```yaml
---
name: my-skill
category: dev                                  # the pack it belongs to
description: One-line description
requires: [XAI_API_KEY, COINGECKO_API_KEY?]    # bare = required · `?` = optional
mcp: [base]
---
```

- **Be explicit and self-contained** — a skill runs unattended.
- **Add a "Network note"** with the right path (`./secretcurl` with `{ENV_NAME}`
  placeholders for auth'd APIs, `gh api` for GitHub, `curl` + **WebFetch** fallback
  for keyless public APIs). See [`CLAUDE.md`](../CLAUDE.md#network--secrets).
- **Notify through `./notify`** — never call a channel API directly.
- **Don't monkey-patch Aeon internals** — a skill is a prompt, not a patch.

**2. Package it as a pack.** In your own public repo, put each skill at `skills/<slug>/SKILL.md` and add a `skills-pack.json` manifest at the root declaring what installs:

```json
{
  "name": "My Pack",
  "version": "1.0",
  "author": "your-github-handle",
  "skills": [
    { "slug": "my-skill", "path": "skills/my-skill" }
  ]
}
```

Give it a clear license, then validate before publishing:

```bash
./scripts/validate-pack.sh /path/to/your-pack-repo
```

The full manifest schema, field reference, trust model, and a worked example are in [`docs/community-skill-packs.md`](../docs/community-skill-packs.md).

**3. List it in the registry.** With your pack repo public, open a PR here that adds **both**: a row to the **Community Packs** table in the [README](README.md#community-packs) **and** a matching entry in [`catalog/skill-packs.json`](../catalog/skill-packs.json). Full steps: the [publishing checklist](../docs/community-skill-packs.md#pack-maintainers-publishing-checklist).

### Contributing an LLM gateway

A gateway is wired through a handful of files, all following the existing
pattern — so copy an entry of the same **tier**. There are two: **native** (the
provider already speaks the Anthropic API — just point `ANTHROPIC_BASE_URL` at it,
like Bankr/OpenRouter/UsePod/Grok) and **sidecar** (OpenAI-compatible — bridged
per run by a [claude-code-router](https://github.com/musistudio/claude-code-router)
sidecar, like Venice/Surplus).

1. **`apps/dashboard/lib/gateway-registry.ts`** — add `slug: { label, secretName, prefixes, domain }` (empty `prefixes: []` = dropdown-only, no auto-detect). This is the **single source of truth**: it auto-flows to the `GatewayProvider` union (`lib/types.ts`), `CLAUDE_AUTH_SECRETS` (`lib/constants.ts`), the secrets route's gateway-key detection, the auth key-prefix detection (`lib/auth-provider.ts`), and the service-icon domain.
2. **`apps/dashboard/components/AuthModal.tsx`** — add the slug to `PROVIDER_OPTIONS` (this dropdown list is **not** registry-derived).
3. **`apps/dashboard/lib/secrets-catalog.ts`** — add a `BUILTIN_SECRETS` row (description only) so the secret shows in Settings (and in `aeon secrets ls`).
4. **`scripts/llm-gateway.sh`** — add an `aeon_present()` case, add the slug to the auto-resolver's default `GATEWAY_ORDER`, and add a `case` branch (a **native** provider exports `ANTHROPIC_BASE_URL` + the auth token; a **sidecar** provider calls `start_ccr_sidecar <slug> <openai-url> <key> <model>`).
5. **`.github/workflows/aeon.yml`** — pass the new secret (and any `*_MODEL` override **variables**) into the run's `env:` (also `messages.yml`), so the resolver can see it.

Then add a row to the gateway table in [`docs/CONFIGURATION.md`](../docs/CONFIGURATION.md#llm-gateways). To
verify the full loop: paste a key in the dashboard (prefix should auto-detect, or
pick it from the dropdown) and run any skill — the workflow log prints
`::notice:: gateway=auto resolved to <slug>` followed by `::notice:: Routing through …`.

## Project layout

```
CLAUDE.md                ← agent identity (auto-loaded by Claude Code)
STRATEGY.md              ← north-star: goal, priorities, audience, constraints (rides along every run)
aeon.yml                 ← skill schedules, chains, reactive triggers, enabled flags
aeon                     ← ./aeon launches the dashboard; ./aeon <command> runs the headless CLI
notify                   ← multi-channel notify command (generated per-run from scripts/notify.sh)
catalog/                 ← registries the dashboard reads (generated + hand-authored)
  skills.json            ← machine-readable skill catalog (category per skill)
  packs.config.json      ← first-party pack definitions (core allowlist + pack list)
  packs.json             ← generated pack catalog
  skill-packs.json       ← community skill-pack registry
bin/                     ← operator + maintainer CLI (run from repo root, e.g. bin/add-skill)
  onboard                ← validate the fork's setup (secrets, workflows, channels)
  add-skill              ← import skills from GitHub repos (with security scanning)
  add-mcp                ← register Aeon as an MCP server for Claude Desktop/Code
  install-skill-pack     ← install a curated community skill pack
  export-skill           ← package skills for standalone distribution
  new-from-template      ← scaffold a skill from a template (--category sets its pack)
  generate-skills-json   ← regenerate catalog/skills.json from SKILL.md files
  generate-packs-json    ← regenerate catalog/packs.json from the two configs above
docs/                    ← reference docs, community registries, adopter examples
  CORE.md · CAPABILITIES.md · harnesses.md · skill-packs.md · telegram-* · help/status
  ECOSYSTEM.md           ← products & agents built on Aeon (community-curated)
  SHOWCASE.md            ← leaderboard of active forks
  examples/              ← MCP quickstart, portable workflow templates, skill templates
    workflow-templates/  ← GitHub Agentic Workflow .md (adopt a skill without forking)
    skill-templates/     ← templates for building your own skills
    mcp/                 ← MCP quickstart config + .mcp.json.example
soul/                    ← optional identity files (SOUL.md, STYLE.md, examples/, data/)
skills/                  ← each skill is a SKILL.md prompt file (`category:` = its pack)
apps/                    ← standalone sub-projects, each with its own package.json
  dashboard/             ← local web UI (Next.js + json-render feed)
  cli/                   ← headless CLI (`./aeon <command>`) — the dashboard's features as commands
  mcp-server/            ← MCP server — exposes skills as Claude tools
  webhook/               ← Telegram instant-mode Cloudflare Worker (~1s delivery)
memory/                  ← durable memory the agent reads/writes across runs
  MEMORY.md              ← goals, active topics, pointers
  cron-state.json        ← per-skill execution metrics (status, success rate, quality)
  skill-health/          ← rolling quality scores per skill (last 30 runs)
  token-usage.csv        ← token cost tracking per run
  issues/                ← structured issue tracker for skill failures
  topics/                ← durable knowledge notes by topic - tokens, protocols, narratives, repos
  logs/                  ← daily activity logs (YYYY-MM-DD.md)
output/                  ← everything skills produce, committed to the repo
  articles/ · images/    ← published deliverables
  .chains/               ← transient chain-step handoff (consumed by downstream steps)
scripts/
  notify.sh              ← source for the ./notify command (multi-channel notifications)
  notify-jsonrender.sh   ← source for ./notify-jsonrender (feed cards via Haiku)
  secretcurl.sh          ← source for ./secretcurl (auth'd curl; {ENV} placeholders keep secrets off the command line)
  skill-runs             ← audit recent GitHub Actions skill runs
.github/workflows/
  aeon.yml               ← skill runner (workflow_dispatch, issues, quality scoring)
  chain-runner.yml       ← skill chain executor (parallel + sequential pipelines)
  scheduler.yml          ← cron scheduler (dispatches due skills + chains */5)
  messages.yml           ← message polling + routing (Telegram/Discord/Slack)
```

## Testing & CI

Locking gates run on every PR; all are fast and only trigger on the paths they
protect:

| Gate | Enforces |
|------|----------|
| `ci-skills-json` | `skills.json` matches a fresh `bin/generate-skills-json` |
| `ci-packs-json` | `packs.json` matches a fresh `bin/generate-packs-json` |
| `ci-skill-category` | every `SKILL.md` declares a valid `category:` |
| `ci-capabilities-parity` | the capabilities taxonomy stays in sync |
| `ci-skill-packs` | `catalog/skill-packs.json` is well-formed **and** matches the README's Community Packs table |
| `ci-apps` | each app in `apps/**` typechecks, tests, and builds |
| `ci-tests` | the `scripts/tests/` suites pass |
| `ci-agents-md` | `AGENTS.md` is regenerated from `STRATEGY.md` |

Run the checks locally before pushing:

```bash
bash scripts/check-skill-categories.sh
bash scripts/check-capabilities-parity.sh
node scripts/validate-skill-packs.mjs          # listing a community pack
```

Touching `apps/**`? Run that app's own checks — for the dashboard:

```bash
cd apps/dashboard && npm ci && npm run typecheck && npm test && npm run build
```

If `ci-skills-json`/`ci-packs-json` fails, you changed a generator input without
committing the regen — run both `generate-*` scripts and commit the result.

## Submitting a pull request

- Keep the diff focused and the title conventional; it becomes the squash commit.
- Explain **what** changed and **why**; link the issue (`Fixes #123`).
- Fill in the matching checklist from the PR template.
- Ran the relevant local checks and they pass.

## Reporting bugs & requesting features

Open an issue. For a bug, include the skill name, the relevant (redacted)
`memory/logs/` entry, whether the failure was an API or permission/secret issue, and whether
notifications came through. For a feature you'd like Aeon to build itself, label
the issue `ai-build`.

**Found a security problem?** Don't open an issue — follow
[`SECURITY.md`](SECURITY.md) and report it privately.

## License

By contributing, you agree that your contributions are licensed under the
repository's [LICENSE](../LICENSE).
