---
type: Reference
title: Harnesses — advanced behavior
description: Deep reference for Aeon's harness axis (Claude Code, Grok Build, and the four run-harness harnesses) — token accounting, capability-mode mapping, MCP and grok's folder-trust gate, per-skill grok knobs, and per-surface harness selection.
---

# Harnesses — advanced behavior

The **harness** is the coding-agent CLI that runs your skills. The README's
[Harnesses](../.github/README.md#harnesses) section covers the basics — the two
first-class harnesses (`claude` default, `grok`), how to select one, and
one-click X-account login. This page collects the deeper behavior for anyone
running the `grok` harness in anger.

## Additional harnesses via run-harness (`codex`, `pi`, `vibe`, `kimi`)

Four more harnesses are selectable in the dashboard's harness dropdown and the
`harness:` config: **codex** (OpenAI Codex CLI), **pi** (Pi Coding Agent),
**vibe** (Mistral Vibe) and **kimi** (Moonshot Kimi). Unlike `claude`/`grok`
they don't have a bespoke branch in the workflow — they run through
[`harness-adapter`](../harness-adapter/)'s `run-harness`, which wraps each CLI in
the same Claude-Code-shaped `{result, usage, session_id}` contract that
`scripts/run-grok.sh` provides, so everything downstream (scoring, token
accounting, memory, notifications) is unchanged.

All four authenticate with a single **`OPENROUTER_API_KEY`** — set it in
Settings and every one of them works. Their model picker offers OpenRouter ids
rather than the `claude-*`/`grok-*` ids, and the model you pick is what actually
runs. Each of these harnesses carries its own curated list (`CODEX_MODELS` /
`VIBE_MODELS` / `PI_MODELS` / `KIMI_MODELS`): **codex**
defaults to `openai/gpt-5-mini` (it fails on `gpt-5-nano`) and also offers the
codex-tuned line (`gpt-5.1-codex-mini`, `gpt-5.3-codex`) and the general
`gpt-5.6` family (`luna`, `terra`); **vibe**'s generic `ProviderConfig` drives any
OpenRouter model, so it defaults to `mistralai/mistral-medium-3-5` and offers
`deepseek/deepseek-v4-flash`; **pi** (litellm `openrouter/<slug>` routing) runs the
DeepSeek V4 pair — `deepseek-v4-flash` (default) and `deepseek-v4-pro`; **kimi** is
Moonshot, so it runs Moonshot's own Kimi family through OpenRouter —
`moonshotai/kimi-k2.5` (default), `kimi-k3` (strongest, ~2× slower), and
`kimi-k2.7-code`. The scorer
routes through the same harness the skill
ran on, so a repo with **no** Claude credentials still gets every run scored.

### Native auth — run on your own provider account

OpenRouter is the shared fallback; each harness can also run on its **own**
provider, the same way `grok` runs on your X-account session. Two have real
login flows captured for CI (the exact `GROK_CREDENTIALS` pattern — drive the
login locally, store the session as a repo secret, restore it on the runner):

| harness | native auth | how to set it |
|---------|-------------|---------------|
| `codex` | **ChatGPT** OAuth | `aeon auth --harness codex` (or dashboard **Connect ChatGPT**) → `CODEX_AUTH`. Or an OpenAI key: `--key sk-…` → `OPENAI_API_KEY` |
| `kimi`  | **Moonshot** device login | `aeon auth --harness kimi` (or **Connect Kimi**) → `KIMI_AUTH`. Or `--key` → `MOONSHOT_API_KEY` |
| `pi`    | provider API key | `aeon auth --harness pi --key <sk-ant-…\|sk-…>` → the matching `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (auto-detected) |
| `vibe`  | Mistral key | `aeon auth --harness vibe --key <key>` → `MISTRAL_API_KEY` (vibe's default provider) |

Which one runs is decided at dispatch by **which secret is set**, native first,
OpenRouter last (`authSecretsForHarness` / the `HARNESS_AUTH` registry in
`apps/dashboard/lib/harness-auth.ts`). On native auth the harness uses its **own
default model** — the OpenRouter model picker only applies when the run falls
back to `OPENROUTER_API_KEY` (an `openai/*` id would be the wrong provider
otherwise). The workflow's *Install harness CLI* step restores/configures the
selected provider; the CLI + dashboard flows share `lib/harness-auth-server.ts`.

The full deployment runbook — the added/modified workflow steps, per-harness
install and config, runner gotchas (AppArmor, the codex pin), and the measured
reasons `opencode`/`copilot`/`agy` are excluded — is
[`harness-adapter/docs/aeon-integration.md`](../harness-adapter/docs/aeon-integration.md).

## Verification status

All six harnesses were verified end-to-end through `run-harness` on **2026-07-22**
— each dispatched live on GitHub Actions, exercising auth, read-only enforcement,
token accounting, and the post-run health scorer:

| harness | auth as-tested | read-only enforcement | token usage | live result |
|---------|----------------|-----------------------|-------------|-------------|
| `claude` | `CLAUDE_CODE_OAUTH_TOKEN` | allowlist-strip + post-run revert (`--no-sandbox`) | real | green, both modes |
| `grok` | `GROK_CREDENTIALS` (X-OAuth) | allowlist-strip + post-run revert (`--no-sandbox`) | real | scored 4/5 |
| `codex` | OpenRouter (`OPENROUTER_API_KEY`) | wrapper OS sandbox (codex's own sandbox off in read-only to avoid nesting) | real | 5/5 on `gpt-5-mini`, real fetch verified |
| `pi` | OpenRouter | wrapper OS sandbox | real | 5/5 on `gpt-5-mini` |
| `vibe` | OpenRouter | wrapper sandbox + `--disabled-tools write_file,edit` | char/4 estimate | 4/5 on `gpt-5-mini` |
| `kimi` | OpenRouter | wrapper OS sandbox (its only read-only guard) | char/4 estimate | Kimi K3 5/5, K2.5 & K2.7-code 4/5 — slates verified real |

Notes from the sweep:

- **Model matters for the score.** `pi`/`vibe` scored 2/5 on `gpt-5-nano` (the model
  punted / truncated) but 5/5 and 4/5 on `gpt-5-mini` — the harness scoring path is
  sound; nano was just too weak for the task.
- **Auth precedence is a trap.** codex resolves `CODEX_AUTH` → `OPENAI_API_KEY` →
  OpenRouter and grok resolves `GROK_CREDENTIALS` → `XAI_API_KEY`, **native-first** —
  so a stale or quota-dead native secret keeps failing even when a working fallback
  is present. Delete the native secret to fall through. Deleting `CODEX_AUTH` is also
  how you pin a cheap model: the OpenRouter path forwards `-f model=openai/gpt-5-*`,
  while native auth uses the harness's own (pricier) default.
- **The scorer grades stdout, not `./notify`.** A run that routes its deliverable
  into a channel and leaves a thin final message is under-graded even though the
  work was real (observed on codex/`gpt-5-mini`, which narrated pessimistically in
  stdout while its full slate went to notify). Keep the substance in the run's final
  message.

Fixes shipped during the sweep: harness unification through `run-harness` (#2),
codex read-only inline notify (#4), keep-substance-in-stdout guidance (#5),
kimi/vibe token estimate (#6), grok scorer fallback to `grok-4.5` (#7), and
codex read-only under the wrapper sandbox so fetches work (#14 — its native
`--sandbox read-only` was also blocking the network).

## Token accounting

Every harness runs through `run-harness`, which normalizes usage into the
Claude-Code `{input, output, cache_read, cache_creation}` shape. What each CLI
exposes differs:

- **claude, grok, codex, pi** report **real** usage. grok's adapter uses
  `--output-format streaming-json`, whose terminal `{"type":"end"}` event carries
  input/output/cache tokens + cost (`harness-adapter/adapters/grok.sh`) — the older
  `scripts/run-grok.sh` plain-`json` path reported 0, but the unified adapter does
  not.
- **kimi and vibe** expose **no** usage field (kimi's `stream-json` and vibe's
  `--output json` carry none — verified live), so their adapters fall back to a
  transparent `char/4` **estimate** of the assembled input + result rather than a
  misleading `0/0/0`; real counts always win if a future build emits them.

The captured OAuth sessions (grok's `GROK_CREDENTIALS`, codex's `CODEX_AUTH`) rotate
their refresh tokens. **grok's session is kept durable automatically** (mirroring the
[MCP OAuth](mcp-oauth.md#limits-read-before-relying-on-it) contract): the access token
in `GROK_CREDENTIALS` lasts only 6h, and xAI **rotates + revokes the refresh token on
every refresh** (confirmed live - `auth.x.ai` returns `invalid_grant` "Refresh token
has been revoked"), so a *static* capture self-destructs ~6h after Connect. To fix
that, `scripts/run-grok.sh` (§2b) refreshes the access token from the refresh token
before each run and **persists the rotated `auth.json` back to the `GROK_CREDENTIALS`
secret**. Persisting a secret needs a secrets-write credential - the default
`GITHUB_TOKEN` cannot - so set a fine-grained PAT with **Secrets: read/write** as
`GH_SECRETS_PAT` (or `GH_GLOBAL`). Without the PAT, grok
warns loudly and auth breaks one run after the first post-expiry refresh. **After
adding the PAT, re-connect the X account once** to seed a valid refresh token (a token
already consumed by a prior run can't be revived by the PAT alone). Concurrent grok
runs that each hit an expired token still race - each refresh revokes the other's
token - so for high parallelism refresh centrally on a schedule so exactly one run
mints and persists per interval. codex's `CODEX_AUTH` just expires (no auto-persist
yet) - re-capture via **Connect ChatGPT** or use the OpenAI key.

## Capability mode carries over unchanged

A `mode: read-only` skill maps to grok's `--sandbox read-only` with a read-only
allowlist; `write` adds `Edit` + `git`/`gh`/`python` — the same drops as on
Claude Code (`scripts/skill_mode.sh grok-args`). Enforcement is the explicit
allowlist plus the read-only sandbox: a headless run has no prompt path, so any
tool not on the allowlist and not a read-class fast-path is refused. Grok Build
has no free tier — it needs a SuperGrok / X Premium+ subscription (OAuth) or xAI
API credits (`XAI_API_KEY`).

## Standing instructions

Grok loads `CLAUDE.md` natively (it reads Claude Code's memory files), so the
operating manual is **not** duplicated. `AGENTS.md` is generated by
`scripts/gen-agents-md.js` and carries only `STRATEGY.md` — the one thing
`CLAUDE.md` delivers via the Claude-only `@STRATEGY.md` import, which grok doesn't
expand. That trims ~2.5k tokens of duplicate context per grok run vs. mirroring
the whole manual.

## MCP on grok — and the `--trust` gate

Grok discovers the project `.mcp.json` natively (walking cwd→git-root) and
expands `${VAR}` from the environment **itself** — the same secrets the
workflow's MCP preflight resolves — so no `--mcp-config` flag and no schema
translation is needed. (Verified directly: a `Bearer ${TOKEN}` header arrives at
the server fully expanded.) `harness-adapter/adapters/grok.sh` adds two things:

- one `--allow 'MCPTool(<server>__*)'` per server, so the model can actually call
  the tools — MCP tools aren't auto-approved under a headless run;
- **`--trust`**, without which none of the above ever happens.

**Folder trust is the whole ballgame on CI.** Grok gates every repo-local
(project-scoped) MCP server behind its folder-trust store
(`~/.grok/trusted_folders.toml`, the same gate that governs project hooks and
LSP). A runner checks the repo out into a path that has never been trusted — on
every single run — so without `--trust` the server is silently never started and
no `mcp__<server>__*` tool exists.

The failure gives you almost nothing to go on: the run does **not** fail. The
agent reports the server "not connected", falls back to plain HTTP, and finishes
green with a plausible answer. `grok mcp doctor` is the one place that names it:

```
glim (http: https://glim.sh/mcp)
  ✗ folder untrusted (repo-local (project-scoped) server not started for an untrusted folder)
  → re-run with --trust to allow repo-local servers
```

`--trust` is passed only when an MCP config is in play, so a non-MCP run keeps the
default untrusted posture. The flag is hidden on `grok --help` but accepted.
(`GROK_FOLDER_TRUST=0` disables the gate wholesale, but it ungates project hooks
along with MCP — prefer the scoped flag.)

Both grok run paths do this: `harness-adapter/adapters/grok.sh` for skill runs,
and `scripts/run-grok.sh` for inbound messages and the local MCP server (see
[the two run paths](#newer-grok-knobs-opt-in-per-skill) below).

Trusting is sound here: the folder is the operator's own checked-out repo, which
the harness is already executing as the agent's workspace.

(On a dev machine grok additionally sees your user-global MCP servers from
`~/.claude.json`/`~/.cursor/mcp.json`; CI runners are clean, so only the repo's
`.mcp.json` applies.)

**Other harnesses.** MCP is not grok-only: `claude`, `codex`, `vibe` and `kimi`
all call live MCP tools too (codex and kimi needed their own dispatcher fixes —
see the [harness-adapter README](../harness-adapter/README.md#the-six-harnesses)).
`pi` is the one harness that cannot: it rejects MCP by design, so its adapter
warns and skips every configured server, and the dashboard's MCP panel disables
itself when `pi` is the selected harness.

## Newer grok knobs (opt-in per skill)

A skill's `SKILL.md` frontmatter can shape the grok run — ignored by the Claude
harness:

```yaml
max_turns: 120     # agentic-turn cap (default 60; a runaway/cost guard) → --max-turns
best_of_n: 3       # run the task 3 ways in parallel, keep the best      → --best-of-n
verify: true       # append a self-verification loop before finishing    → --check
effort: high       # low|medium|high|xhigh|max → --effort  (reasoning models only)
```

`effort`/`reasoning_effort` map to the API's `reasoningEffort`, honoured by
`grok-4.5` — a reasoning model, and the only model the X-account login exposes to
the CLI (see [Verification status](#verification-status); other xAI model ids are
api.x.ai strings the CLI rejects as "unknown model id"). `best_of_n`/`verify` build
on grok's subagents (so the harness drops `--no-subagents` for those runs);
`verify` can't combine with structured output.

These knobs are read by `harness-adapter/adapters/grok.sh` (ported from
`run-grok.sh` §3c), which is what runs a skill on the `aeon.yml` path. There are
**two grok run paths**, and knowing which one you're on matters:

| Path | Runs grok via | Used by |
|------|---------------|---------|
| adapter | `run-harness grok` → `adapters/grok.sh` | scheduled/manual skill runs + the scorer (`aeon.yml`) |
| script | `scripts/run-grok.sh` (stdin prompt) | inbound messages (`messages.yml`), local MCP server (`apps/mcp-server`) |

`aeon.yml` additionally calls `run-grok.sh setup` — install the pinned CLI, stage
and refresh auth — on both paths. Both paths honour folder trust and the MCPTool
allows; the run-shaping knobs above are adapter-side, so a `messages.yml` reply
uses `run-grok.sh`'s own defaults.

`GROK_JSON_SCHEMA` is script-side only: `run-grok.sh` maps it to `--json-schema`,
but nothing in the repo sets it (the scorer it was reserved for now goes
schema-less, so one parse path covers all six harnesses). On the adapter path,
structured output comes from `run-harness --json-schema` instead.

## Every entry point runs on either harness

The harness split isn't just the scheduled skill run — it's wired through every
surface that launches the agent, so a grok-only fork (no Claude credentials)
behaves identically everywhere:

| Surface | How grok is selected | Notes |
|---------|---------------------|-------|
| Scheduled / manual skill run (`aeon.yml`) | dispatch **Harness** input → per-skill `harness:` → global `harness:` → `claude` | full flags + MCP + scorer |
| Skill chains (`chain-runner.yml`) | inherits — each step dispatches `aeon.yml`, which resolves per-skill/global | |
| Inbound messages (`messages.yml`, Telegram/Discord/Slack) | global `harness:` in `aeon.yml` | conversational reply in write mode |
| Local MCP server (`apps/mcp-server`) | `AEON_HARNESS` env → global `harness:` | `resolveHarness()` in `skill-executor.ts` |
| Webhook (`apps/webhook`) | relay only → dispatches `messages.yml` | harness-agnostic |
| Post-run quality scorer (`aeon.yml`) | scores through the same harness the skill ran on | |

Two surfaces stay Claude-only **by design**: the **AI gateway**
(`scripts/llm-gateway.sh`) only reshapes the model behind Claude Code — grok has
its own auth and bypasses it — and the **json-render feed** (`notify-jsonrender`)
renders via `claude -p` and is skipped on grok (the feed is a display nicety;
skill output, memory, and notifications are unaffected).
