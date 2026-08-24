# Wiring the harness swap into an aeon instance

A deployment runbook for putting `run-harness` into [aeonfun/aeon](https://github.com/aeonfun/aeon)
so a skill can run on **codex, pi, vibe, kimi, or fx** instead of only claude/grok.

Every change below was applied to a full aeon fork and verified on a real GitHub
runner (6-harness × 3-scenario matrix, Tier 4). This document is how to reproduce
it on a fresh aeon instance, and what each change is for so you can review rather
than copy blind.

---

## 1. The shape

aeon already defines the seam. `scripts/run-grok.sh` documents its own contract —
prompt on stdin, a normalized `{result, usage, session_id}` envelope on stdout,
diagnostics on stderr — and that is exactly `run-harness`'s contract. So the swap
is one added branch, nothing existing changed:

```
claude -> untouched gateway cascade   (keeps multi-provider fallover + Langfuse)
grok   -> untouched run-grok.sh        (keeps GROK_* knobs from skill_mode.sh)
else   -> run-harness "$HARNESS"        (codex, pi, vibe, kimi)
```

claude and grok keep their own branches on purpose: claude would otherwise lose
the multi-provider gateway cascade and Langfuse tracing, grok its `GROK_*` run
knobs.

> **Superseded in aeon itself.** The three-branch shape above is how the swap
> *lands* on an untouched instance, and it is still the smallest correct first
> step. aeon has since collapsed it: **every** harness including grok goes
> through `run-harness`, `scripts/run-grok.sh` is setup-only (CLI pin + OAuth
> refresh), and the gateway cascade wraps the `run-harness claude` call rather
> than replacing it — grok's `GROK_*` knobs moved into `adapters/grok.sh`. Keeping
> grok on its own branch is what let an adapter-level MCP fix ship while
> `messages.yml` and `apps/mcp-server` stayed broken. If you are wiring this up
> fresh, prefer routing everything through `run-harness` from the start.

**In scope:** codex, pi, vibe, kimi. **Deliberately excluded**, each for a
measured reason:

| harness | why not |
|---|---|
| `opencode` | `.result` carried the agent's narration, not the deliverable — fixed in the adapter, but it still loops to the wall-clock guard on research skills |
| `copilot` | no credential path without a Copilot-subscribed PAT |
| `agy` | print mode runs tools in `~/.gemini/antigravity-cli/scratch/`, not `$PWD`, so it reports success having written nothing to the workspace |

---

## 2. Prerequisites

| what | where | needed for |
|---|---|---|
| `OPENROUTER_API_KEY` | repo secret | **required** — one key covers all four harnesses |
| `CLAUDE_CODE_OAUTH_TOKEN` | repo secret | only if you also run the **claude** control path; a codex/pi/vibe/kimi-only instance does **not** need it (the scorer routes through run-harness — see §5) |
| `HARNESS_MODEL` | repo variable | **optional** override; per-harness defaults are built in (§6). Leave unset unless you want to force one model for all four |
| everything aeon already requires | — | unchanged |

The runner must be Linux (`ubuntu-latest` is fine). bubblewrap + an AppArmor
sysctl are installed by the added step (§7).

---

## 3. Wiring steps

### 3.1 Vendor `harness-adapter`

The workflow calls `${GITHUB_WORKSPACE}/harness-adapter/run-harness`, so the
adapter tree must be present at the repo root. Options, cheapest first:

- **Vendor a pinned copy** at `harness-adapter/` (what the reference fork does).
  Simplest for a private/public split; re-sync on a tag bump.
- **git submodule** — clean history, but every downstream fork must
  `git submodule update --init`, which aeon forks generally don't.

Whichever you pick, the tree must contain `run-harness`, `adapters/`, and `lib/`.

### 3.2 Apply the `aeon.yml` changes

Two steps **added**, five **modified**. Diff against upstream to review; the list
is exhaustive.

**Added — `Resolve harness` (id: `harness`)**, placed after *Install Claude Code*,
before the new install step. aeon resolves the harness inline inside *Run*; the
added harnesses need a CLI installed first, and an install step cannot read a
value resolved later. So resolution moves up here (logic is upstream's, verbatim),
emitting three outputs: `HARNESS`, `HARNESS_MODEL`, `MODEL_ARG`.

> **Do not gate the install on `inputs.harness` instead.** A cron carries no
> dispatch input, so a repo with `harness: codex` in `aeon.yml` would install
> nothing and fail inside *Run*. Resolving from the same 3-tier precedence
> (dispatch input → per-skill → top-level → default) is what makes crons work.
> Both resolution `grep`s must carry `|| true` — under the runner's `bash -e -o
> pipefail`, a repo with no top-level `harness:` key or a skill missing from the
> skills map otherwise kills the step with no message.

**Added — `Install harness CLI`**, gated on
`steps.harness.outputs.HARNESS != '' && != 'claude' && != 'grok'`. Installs the
selected CLI, stages its OpenRouter config (§6), and installs bubblewrap + the
AppArmor sysctl (§7).

**Modified — `Run`.** New leading branch
`if [ "$HARNESS" != "claude" ] && [ "$HARNESS" != "grok" ]` that pipes the prompt
to `run-harness "$HARNESS" --mode "$SKILL_MODE" --allowed-tools "$ALLOWED"
--timeout 900 [--model $RH_MODEL_ARG] [--mcp-config .mcp.json]`. It re-emits
`SKILL_MODEL` with the model that **actually ran** (aeon's `BASE_MODEL` is a
claude-*/grok-* id these CLIs can't resolve — leaving it would file the run's
tokens and the signed manifest under a model that never executed). The claude
cascade and grok branch below it are untouched.

**Modified — three gates flip from `!= 'grok'` to `== 'claude'`:**

| step | change | why |
|---|---|---|
| `Analyze skill output` (scorer) | route non-claude through run-harness; gateway-source + empty-retry gated `== 'claude'` | §5 |
| `Under the hood` | add `&& HARNESS == 'claude'` | `run-actions-summary.sh` falls back to the newest `~/.claude/projects` transcript when a session id doesn't resolve — the added harnesses emit their own session id, so without this gate a run gets *another* run's tool calls committed to `memory/logs/` |
| `Convert feed outputs` | `!= 'grok'` → `== 'claude'` | `notify-jsonrender` renders via `claude -p`; skip on a no-Claude-auth repo |

> Upstream has only claude and grok, so `!= 'grok'` and `== 'claude'` are
> **identical there** — every flip is a no-op for aeon as it stands and correct
> for the added harnesses.

**Modified — dispatch inputs.** Add `codex, pi, vibe, kimi` to the
`workflow_dispatch` `harness` choice list and the `workflow_call` description.

`OPENROUTER_API_KEY` is added to the env of *Install harness CLI*, *Run*, and
*Analyze skill output*.

### 3.3 Choose the harness

Same 3-tier precedence as the model, no new mechanism:

```yaml
# aeon.yml, top-level — every skill in this repo
harness: codex

# or per-skill
skills:
  github-trending: { harness: "pi" }

# or one-off
gh workflow run aeon.yml -f skill=github-trending -f harness=vibe
```

---

## 4. read-only semantics (read this before trusting a research skill)

`read-only` means **the workspace cannot be mutated** — *not* "cannot act". The
network stays available; the write lock is the wrapper OS sandbox
(`lib/sandbox.sh`, bubblewrap on Linux). This matters because aeon's read-only
toolset explicitly grants `WebFetch, WebSearch, Bash(curl:*)` and its read-only
skills are overwhelmingly **research** skills.

Getting this wrong is silent: three harnesses each lost the network a different
way, and every failed run was **green** — valid envelope, exit 0, scorer 3–4/5 —
while committing fabricated or empty output. The fixes are in the adapters
(pi/vibe/codex) and one compat clause.
The takeaway for operating an instance: **a green run is not proof the skill did
its job.** Spot-check committed `output/` content, especially for research skills.

codex has a native kernel sandbox, but its `--sandbox read-only` also blocks the
**network** (codex has no "read-only + network" mode), which silently broke
read-only research skills. So read-only codex now runs under the **wrapper** like
the others, with codex's own sandbox disabled (`danger-full-access`) so the two
don't nest — an earlier attempt left codex's landlock on *inside* bwrap and the
two fought, breaking codex's file access. Write mode stays unwrapped and keeps
codex's native `workspace-write` + `network_access`.

---

## 5. Scoring on a no-Claude-auth repo

The post-run scorer (`Analyze skill output`) grades every run 1–5 and writes
`memory/skill-health/<skill>.json`. Upstream it calls `claude -p`. On a repo
running only the added harnesses there are no Claude credentials, so that call
would just print "Not logged in" and **every run would go unscored** —
skill-health, skill-analytics and the cron-state quality signals all silently
empty while the workflow stays green.

grok already solved this: score through the same harness the skill ran on. The
swap does the same for any non-claude harness —
`run-harness "$HARNESS" --mode read-only --no-sandbox --timeout 300`.

> **Known limitation:** a self-scoring harness can grade its own fabricated
> output highly (measured: 3–4/5 on invented data before the read-only fix). If
> your instance *does* have Claude credentials, preferring `claude -p` for
> scoring and falling back to run-harness only when creds are absent gives more
> trustworthy, comparable scores. The reference fork routes everything through
> run-harness; refine per instance.

---

## 6. Per-harness reference

One `OPENROUTER_API_KEY` covers codex/pi/vibe/kimi. Each of those CLIs'
provider block is generic enough to point at OpenRouter; the *Install harness
CLI* step stages the config. **fx is the exception** — no OpenRouter path
exists for it (see §2/§3 below), so it needs its own `AI_GATEWAY_API_KEY`.

| harness | install | model default | `--model` passed | config notes |
|---|---|---|---|---|
| **codex** | `npm i -g @openai/codex@0.144.6` | `openai/gpt-5-mini` | bare id | `~/.codex/config.toml`: `wire_api = "responses"` (0.144.6 removed `"chat"`), `model_reasoning_effort = "medium"` (OpenRouter 400s on reasoning-disabled) |
| **pi** | `npm i -g --ignore-scripts @earendil-works/pi-coding-agent` | `deepseek/deepseek-v4-flash` | `openrouter/<model>` | reads `OPENROUTER_API_KEY` from env |
| **vibe** | `pipx install mistral-vibe` | `mistralai/mistral-medium-3-5` | none (config alias) | `~/.vibe/config.toml`: provider `api_style=openai`, `api_key_env_var` |
| **kimi** | `npm i -g @moonshot-ai/kimi-code` | `moonshotai/kimi-k2.5` | none (config alias) | `~/.kimi-code/config.toml`: key **inline** (no env indirection), `default_model` set |
| **fx** | `curl -fsSL https://fx.sh/setup.sh \| bash` | fx's own default (no `--model` forwarded on native auth) | env only (`FX_MODEL`) — no `--model` flag on `fx ask` | no config file; `AI_GATEWAY_API_KEY`/`VERCEL_OIDC_TOKEN` read straight from env. `install-harness.sh` fails closed if neither is set — no fallback to stage |

**codex needs `≥ gpt-5-mini`.** On `gpt-5-nano` it fails *deterministically* on
code-generation skills — the model emits a shell tool call with a duplicated
`cmd` field, codex's strict parser rejects it, and codex (no `--max-turns`) spins
to the 900s guard. It passes on `gpt-5-mini` in ~2m40s. This is why the default
is per-harness, not one repo-wide value. A repo-wide `HARNESS_MODEL` override
**wins over these defaults** — don't set it to nano if you run codex on code
skills.

**Pin the version.** `@openai/codex` unpinned tracked latest and drifted
mid-session into an OpenRouter 400 with no repo change. Pin it, as aeon pins
claude-code.

---

## 7. Runner gotchas (all handled by the added steps, listed so you know why)

- **AppArmor blocks bubblewrap on Ubuntu 24.04** (including `ubuntu-latest`).
  Unprivileged user namespaces are restricted, so bwrap dies with `setting up uid
  map: Permission denied` and run-harness fails *closed* on every read-only skill
  — correct, but fatal. The install step runs
  `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`. **Any aeon PR
  must include this.**
- **The concurrency group cancels queued runs.** `concurrency: {group:
  aeon-<skill>, cancel-in-progress: false}` protects the *running* job, but GitHub
  keeps only **one** pending run per group — a third dispatch of the same skill
  silently cancels the one already queued (reports `cancelled`, not `failed`).
  When testing a matrix, dispatch at most one run per *skill* at a time; different
  skills are different groups and do run in parallel.
- **`OPENROUTER_API_KEY` may already be in aeon's Run env.** Re-adding it is a
  duplicate-key YAML error that makes the whole workflow unparseable — check
  before adding.

---

## 8. Verify a fresh instance

Deterministic, no tokens:

```sh
cd harness-adapter && bash test/contract.sh      # 56/0 expected
```

On the instance itself, one run per scenario (dispatch one skill at a time):

```sh
gh workflow run aeon.yml -f skill=github-trending  -f harness=pi     # read-only
gh workflow run aeon.yml -f skill=strategy-builder -f harness=codex  # write + code-gen
gh workflow run aeon.yml -f skill=memory-flush     -f harness=kimi   # write + commit-back
```

Green is necessary, not sufficient. Confirm each by **reading the committed
output**:

- `output/.chains/<skill>.md` — is it the real deliverable, or narration / invented data?
- `memory/token-usage.csv` — non-zero tokens, and the model that actually ran
- `memory/skill-health/<skill>.json` — a real score, not an empty no-op

The reference fork's final grid covered all four harnesses × three scenarios, each
verified by committed output rather than by exit code.

---

## 9. Open decisions (not blockers)

- **Packaging.** `harness-adapter` is private; aeon is public. A submodule breaks
  for every downstream fork; a vendored copy drifts. Likely resolution: publish
  the adapter, then vendor at a pinned tag.
- **Scorer calibration.** See §5 — prefer `claude -p` when Anthropic creds exist.
