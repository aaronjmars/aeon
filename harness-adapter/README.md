# harness-adapter

**One Claude Code-shaped contract, six coding-agent harnesses.**

This directory is exactly what the workflow runs: the `run-harness` dispatcher and
the six adapters aeon can dispatch to — **claude, grok, codex, pi, vibe, kimi**.
It is self-contained, so fixes land here directly. Three further harnesses
(`opencode`, `copilot`, `agy`) were evaluated and deliberately left out; the
per-harness reasons are recorded in the allowlist comment in
`.github/workflows/aeon.yml`.

`run-harness` wraps each CLI behind one headless interface — Claude Code's: prompt
on stdin, flags mirroring `claude -p`, one JSON envelope on stdout. Swap the first
argument, keep everything else. `.github/workflows/aeon.yml` invokes it in the same
slot as `scripts/run-grok.sh`, so everything downstream (scoring, token accounting,
memory, notifications) is unchanged. The pattern generalizes
[aeonfun/aeon](https://github.com/aeonfun/aeon)'s `run-grok.sh`, which proved it for
one harness.

```sh
echo "Summarize the TODOs in this repo" | ./run-harness codex --mode read-only
echo "Draft release notes"              | ./run-harness grok  --max-turns 20
echo "Reply with OK"                    | ./run-harness kimi  --mode read-only
```

## The contract

```
stdin   the prompt
stdout  { "result": "<text>",
          "usage": { "input_tokens": N, "output_tokens": N,
                     "cache_read_input_tokens": N, "cache_creation_input_tokens": N },
          "session_id": "<optional>", "total_cost_usd": <optional> }
stderr  diagnostics only
exit    0 ok · 3 abnormal model stop with no output · 124 timeout · other = error
```

An abnormal stop (grok `stopReason=Cancelled`, codex `turn.failed`, …) with no
output **fails the run** — partial or empty results are never emitted as success.

## The six harnesses

| | claude | grok | codex | pi | vibe | kimi |
|---|---|---|---|---|---|---|
| Round-trip envelope | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Token usage | ✅ + cost | ✅ + cost¹ | ✅ | ✅ + cost | 0² | 0² |
| Read-only enforcement | ✅ sandbox | ✅ sandbox³ | ✅ native | ✅ sandbox | ✅ sandbox⁴ | ✅ sandbox⁴ |
| Structured output | native | native | native | shim⁵ | shim⁵ | shim⁵ |
| MCP tool call (live) | ✅ | ✅ | ⚠️ wired, headless-denied⁶ | n/a — warn+skip | ✅ | ✅ |
| Native provider auth | Claude Pro/Max OAuth | X account · `XAI_API_KEY` | ChatGPT OAuth · `OPENAI_API_KEY` | provider env key | Mistral key | Moonshot OAuth · key |

All six round-trip the contract on real CLIs (claude ≥2.1, grok 0.2.101,
codex-cli 0.144.6, pi 0.80.9, vibe 2.20.0, kimi 0.28.0). aeon reaches claude and
grok through its own native paths (the AI gateway / `run-grok.sh`); codex, pi, vibe
and kimi run only through this adapter.

¹ grok reports usage **only** on `--output-format streaming-json`, whose terminal
`{"type":"end"}` event carries usage, `total_cost_usd` and `sessionId`; the adapter
builds `.result` from `type=="text"` chunks only — never the interleaved
`type=="thought"` chain-of-thought.
² vibe and kimi expose no token counts in their `-p`/json modes → usage normalizes
to 0 (vibe meters cost server-side; kimi's stream carries none).
³ grok's own `--sandbox read-only` is a silent no-op on 0.2.101 (writes still land),
so grok is write-locked by the dispatcher's wrapper sandbox instead.
⁴ vibe and kimi `-p` modes have no permission-layer gate of their own; read-only
holds entirely via the dispatcher's OS sandbox (`sandbox-exec` on macOS, `bwrap` on
Linux) mounting the workspace read-only.
⁵ prompt-shim (`lib/schema-retry.sh`): the schema is appended to the prompt, the
result validated, and one corrective retry runs. No native `--json-schema` flag
exists on these.
⁶ codex registers the MCP server and the model *does* invoke the tool, but
`approval_policy="never"` resolves each call's approval as `Cancel` under
`codex exec` (stdin closed → EOF → decline), so the tool never runs headlessly
([openai/codex#24135](https://github.com/openai/codex/issues/24135)). The only
override also drops codex's native sandbox, so MCP stays effectively unavailable on
codex headlessly until upstream lands.

## Flags

| Flag | Notes |
|---|---|
| `--model <id>` | per-harness mapping; a wrong-family id (e.g. `claude-*` on codex) falls back to that harness's default |
| `--allowed-tools "<list>"` | Claude's grammar (`Read,Bash(git:*),...`), translated per harness |
| `--mode read-only\|write` | capability tier; derived from `--allowed-tools` if omitted (default `write`) |
| `--mcp-config <.mcp.json>` | Claude-style config; `${VAR}`s expanded from env, translated per harness |
| `--max-turns <n>` | native on claude/grok; codex/pi/vibe/kimi rely on `--timeout` |
| `--json-schema '<schema>'` | native on claude/grok/codex; prompt+validate+one-retry on pi/vibe/kimi |
| `--append-system-prompt <t>` | extra standing instructions |
| `--timeout <s>` | wall-clock guard (default 600) |
| `--no-sandbox` | skip the wrapper OS sandbox on read-only runs |
| `--no-compat-rules` | skip the Claude-idiom preamble on non-claude harnesses |

## How each layer is translated

| Layer | claude | grok | codex | pi | vibe | kimi |
|---|---|---|---|---|---|---|
| Invoke | `claude -p -` | `grok -p --output-format streaming-json` | `codex exec --json -` | `pi -p --mode json` | `vibe -p --output json` | `kimi -p --output-format stream-json` |
| Result | envelope passthrough | `type=="text"` chunks (never `thought`) | last `agent_message` | last assistant `message_end` | last assistant `content` (never `reasoning_content`) | last assistant `content` |
| Usage | native + cost | streaming `end` event → cost | sum of `turn.completed.usage` | per-message usage + cost | none → 0 | none → 0 |
| Read-only | `--allowedTools` + wrapper sandbox | `bypassPermissions` + wrapper sandbox | `--sandbox read-only` (native) | `--tools` subset + wrapper sandbox | wrapper sandbox only | wrapper sandbox only |
| MCP | `--mcp-config` | native `.mcp.json` + `MCPTool(...)` allows | `-c mcp_servers.*` (auto-denied headless⁶) | unsupported by design → warn+skip | `config.toml [[mcp_servers]]` in temp `VIBE_HOME` | `{mcpServers}` in temp `KIMI_CODE_HOME` |
| CLAUDE.md | native + `@imports` | native (no imports) | via `project_doc_fallback_filenames` | native | native | native |

### Design notes

**Read-only enforcement is hoisted into the dispatcher.** Only codex has a native
kernel sandbox that actually holds; every other harness — claude, grok, pi, vibe,
kimi — runs read-only under `sandbox-exec` (macOS) or `bwrap` (Linux) with the
workspace mounted read-only, so `--mode read-only` means the same thing on all six:
*the repo physically cannot be mutated*, regardless of the model or its permission
config. (vibe and kimi lean on this entirely — their `-p` modes have no
permission-layer gate of their own.)

**Denied-tool semantics** are normalized to *deny-and-continue*: claude and codex
already behave that way headlessly; grok would abort the whole turn on a denied
tool, so its adapter runs `bypassPermissions` + OS sandbox; pi never denies.

**`@imports` are Claude-only.** The dispatcher detects them in `CLAUDE.md` and
pre-expands a merged copy (`lib/imports.sh`); the leaner long-term pattern is
carrying just the delta in `AGENTS.md`, which every other harness reads.

## Field notes from live testing

- **Codex strict-mode schemas** — OpenAI's response_format 400s on any object
  schema missing `additionalProperties: false`. Claude-style schemas don't carry
  it; the codex adapter patches schemas recursively, so one `--json-schema` string
  works identically everywhere.
- **grok's `--sandbox read-only` is a silent no-op** (0.2.101): a read-only run
  ordered to write a file created it anyway. grok is now write-locked by the wrapper
  sandbox like the others, and a `read-only holds` live test guards it.
- **Read-only really holds**: codex answered *"this workspace is read-only"*; pi
  lost write/edit/bash to `--tools` subsetting; vibe/kimi are held by the wrapper
  sandbox — no stray files, on any harness.
- **Codex MCP tools are wired but auto-denied headlessly** (footnote ⁶) — an open
  upstream limitation; claude/grok call live MCP tools cleanly, vibe/kimi via their
  temp-home configs, pi warns-and-skips by design.
- **Pi's minimalism is measurable**: the same one-line prompt consumed ~2.4k input
  tokens on pi vs ~12k on codex — its sub-1k system prompt holds up.

## Installing the harnesses

Only the harnesses you actually dispatch need to be installed.

| Harness | Install | Auth |
|---|---|---|
| Claude Code | `npm i -g @anthropic-ai/claude-code` | `claude login` (Pro/Max or API key) |
| Grok Build | `npm i -g @xai-official/grok@0.2.101` | `grok login` (SuperGrok / X Premium+) or `XAI_API_KEY` |
| Codex CLI | `brew install codex` or `npm i -g @openai/codex@0.144.6` | `codex login` (any ChatGPT plan) or `OPENAI_API_KEY` |
| Pi | `npm i -g --ignore-scripts @earendil-works/pi-coding-agent` | provider env keys or `/login` OAuth in the TUI |
| Mistral Vibe | Vibe installer → `~/.local/bin/vibe` | `vibe --setup` (Mistral API key) |
| Kimi Code | `brew install kimi-code` | `kimi login` (Moonshot) or a provider in `~/.config/kimi` |

For aeon, these installs + auth are automated by `aeon.yml`'s *Install harness CLI*
step and the native-auth secrets (`CODEX_AUTH`, `KIMI_AUTH`, `MISTRAL_API_KEY`,
`OPENROUTER_API_KEY`, …). See [docs/aeon-integration.md](docs/aeon-integration.md).

## Layout

```
run-harness            dispatcher: args → RH_* env → sandbox/timeout → adapter → validate
adapters/<h>.sh        one per harness: invoke, translate, normalize (claude grok codex pi vibe kimi)
lib/envelope.sh        emit/validate the contract envelope
lib/tools-grammar.sh   --allowedTools → per-harness permissions
lib/mcp-translate.sh   .mcp.json → codex -c flags / vibe TOML / kimi home; ${VAR} expansion
lib/imports.sh         CLAUDE.md @import pre-expansion
lib/schema-retry.sh    structured output for harnesses without --json-schema (pi/vibe/kimi)
lib/sandbox.sh         wrapper OS sandbox (workspace read-only)
lib/compat-rules.md    Claude-idiom translation preamble
docs/aeon-integration.md  deployment runbook: wiring the swap into a live aeon
```

## Credits

The normalize-to-Claude's-envelope pattern, the grok permission stance, and the
thought-firewall come from [aeonfun/aeon](https://github.com/aeonfun/aeon)'s
`run-grok.sh`.

MIT — see [LICENSE](LICENSE).
