# Skill Templates

Six pre-built skill starters for the most common operator use cases. Each template is a complete, runnable `SKILL.md` with `[REPLACE: ...]` tokens for the parts you need to customise (topic, repo, channel, threshold, etc.).

## Available templates

| Template | What it does | Replace tokens |
|----------|--------------|----------------|
| [`crypto-tracker`](crypto-tracker/SKILL.md) | Price/volume report for one token, with anomaly alerts above a threshold. | `TOKEN_SYMBOL`, `COINGECKO_ID`, `ALERT_THRESHOLD_PCT` |
| [`research-digest`](research-digest/SKILL.md) | Digest of the most interesting new posts on a topic from RSS feeds and the open web. | `TOPIC`, `FEED_URLS`, `MAX_ITEMS` |
| [`code-reviewer`](code-reviewer/SKILL.md) | First-touch review of newly opened PRs on a watched repo (verdict + welcoming comment + label). | `WATCHED_REPO`, `REVIEW_FOCUS`, `MAX_PR_LINES` |
| [`social-monitor`](social-monitor/SKILL.md) | Mention/keyword sweep on X and Reddit, with sentiment summary and link list. | `KEYWORDS`, `LANGUAGE`, `MIN_LIKES` |
| [`deploy-watcher`](deploy-watcher/SKILL.md) | Watch Vercel project deploy status, alert on failures with last-success comparison. | `VERCEL_PROJECT`, `ALERT_ON`, `LOOKBACK_HOURS` |
| [`community-manager`](community-manager/SKILL.md) | Summary of activity in a Discord, Telegram, or Slack channel — top threads + open questions. | `CHANNEL_PLATFORM`, `CHANNEL_NAME`, `TOP_N_THREADS` |

## Install a template

Use `bin/new-from-template`:

```bash
bin/new-from-template crypto-tracker my-token-watcher \
  --var TOKEN_SYMBOL=ETH \
  --var COINGECKO_ID=ethereum \
  --var ALERT_THRESHOLD_PCT=10
```

That copies `templates/crypto-tracker/SKILL.md` → `skills/my-token-watcher/SKILL.md`, replaces every `[REPLACE: TOKEN_SYMBOL]` etc. with your value, and registers a disabled entry in `aeon.yml` so you can enable it from the dashboard or CLI when you're ready.

If you don't pass `--var` flags, the script copies the file verbatim and prints the list of tokens that still need replacement before the skill will run cleanly.

```bash
bin/new-from-template --list                    # print available templates
bin/new-from-template crypto-tracker --tokens   # print the tokens a template uses
```

## Template format

Every template is a single directory under `templates/` containing one `SKILL.md`. The SKILL.md follows the standard skill frontmatter contract:

```markdown
---
name: [REPLACE: SKILL_NAME]
description: One-line description of what this skill does
metadata:
  var: ""
  tags:
    - some-tag
  requires:
    - SOME_API_KEY
    - OTHER_API_KEY?
---
```

Only `name` (the lowercase slug) and `description` are top-level, per the
[Agent Skills spec](https://agentskills.io/specification). Everything else
(`category`, `var`, `tags`, `requires`, `mcp`, `mode`, …) lives under `metadata:`.

### Declaring API keys (`requires:`)

If a skill calls a third-party API, declare the credentials it reads in the
`requires:` frontmatter list. This is the single source of truth the dashboard
reads to show **which skill needs which API key** (a per-skill "API keys"
section, an inline "key missing" flag in the roster, and a reverse "used by"
index under each key in Settings → Access Keys).

```yaml
requires:
  - XAI_API_KEY
  - COINGECKO_API_KEY?
```

- Each entry is the exact env-var name the skill reads (e.g. `XAI_API_KEY`).
- A bare name is **required** — the skill can't do its core job without it.
- A trailing `?` means **works better with** — the skill still runs without the
  key (degraded, rate-limited, or one feature skipped), it's just better with it.
- Names should match the central credential registry (`apps/dashboard/app/api/secrets/route.ts`),
  so the dashboard can show the description and where to get the key. A name not
  in the registry still renders — it's treated as a custom credential.
- Omit `requires:` entirely (or use `[]`) for skills that only use the built-in
  Claude + GitHub tokens.

### Declaring MCP servers (`mcp:`)

If a skill calls an [MCP server](../.github/README.md#mcp-servers-in-skill-runs) during
its run, declare it in the `mcp:` frontmatter list. Same two-tier semantics as
`requires:` — a bare slug is **required**, a trailing `?` means **works better
with**. Slugs reference the MCP catalog (`apps/dashboard/lib/mcp-catalog.ts`).

```yaml
mcp:
  - base           # this skill needs the Base MCP server (mcp.base.org)
```

The dashboard shows a per-skill **MCP servers** panel (install state pulled from
`.mcp.json`, name/logo from the catalog) and a ⚠ banner with a one-click jump to
the MCP page when a required server isn't installed.

Replacement tokens use the form `[REPLACE: KEY]`. Keys are uppercase snake-case so they're easy to spot in a diff. The literal token `[REPLACE: SKILL_NAME]` is special — it's auto-set to the skill name passed to `bin/new-from-template` (the second positional argument).

## Adding a new template

1. Make a new directory under `templates/`.
2. Drop a `SKILL.md` inside, with `[REPLACE: KEY]` tokens for the operator-specific parts.
3. Add a row to the table at the top of this file.

That's it — `bin/new-from-template --list` discovers templates by scanning for `SKILL.md` files under `templates/`, so no registry update is required.
