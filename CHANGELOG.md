# Changelog

All notable changes to Aeon are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Aeon is a fork-and-configure template, so releases mark a stable point to fork
from or pin to; the template keeps serving the latest `main` to new forks.

## [Unreleased]

### Changed

- **GLM Coding Plan is a Claude AI Gateway hop, not a harness.** `GLM_API_KEY` (alias `ZAI_API_KEY`) now routes `claude -p` at `api.z.ai/api/anthropic` through `scripts/llm-gateway.sh`, last in the auto cascade (override with `gateway.provider: glm` or `GLM_MODEL`). `harness: glm` is a dead name and falls back to `claude`. The `glm` adapter is gone.

### Added

- **Three more run-harnesses: Cursor, Hermes, and GLM.** Cursor CLI (`agent -p`,
  `CURSOR_API_KEY`), Hermes via the Nous Portal (`hermes -z`, `HERMES_AUTH`), and
  the GLM Coding Plan on Z.AI's Anthropic endpoint (`GLM_API_KEY` / `ZAI_API_KEY`)
  join the `run-harness` contract, wired through the resolver, installer, both
  workflows, the local MCP dispatch path, the capability manifest, and regression
  tests. Aeon now dispatches to ten coding-agent CLIs. Their credentials are
  permanent first-class rows in the dashboard Access Keys panel, with Hermes on the
  captured-login Connect/Reconnect flow. (#967, #975)
- **New `rightstack` skill (Dev & Code).** A read-only Web3 stack advisor
  (recommend / workflow / compare / explain / migrate) that maps a build goal to a
  coherent stack before implementation; disabled and manual-only, it cannot install
  packages, edit an app, or touch a wallet or contract. Catalog is now 77 skills.
  (#961)
- **Read-only harness comparison (`scripts/skill-health-routing.mjs`).** Phase 2 of
  measured harness routing: it groups harness-tagged skill-health scores (five
  required per harness) and joins per-run token / cache usage, so an operator can
  weigh quality against cost before changing `aeon.yml`. It never writes repo
  state. (#969)
- **Machine-readable vuln-scanner execution evidence.** Staged scanner binaries
  (Semgrep, TruffleHog, OSV-Scanner, Slither, cargo-fuzz) are wrapped with an
  invocation logger, and a post-run step prints the staged manifest plus the actual
  invocation log, so a report can no longer claim a scan that never ran. An absent
  optional scanner still does not fail the run. (#968)
- **Three community skill packs listed:** CultOS exact-commit PR review (#974), the
  Farcaster pack with a Neynar-backed `cast` publish skill (#977), and the Spoolis
  Outcome Gate acceptance-criteria gate (#978).
- **Operator-console plugin prepped for more marketplaces.** The `plugin/` operator
  skill gained manifests and privacy / support metadata for OpenAI's plugin
  directory (host-neutral wording, a Codex-runnable history-mining script), the
  Kiro Powers registry, and MiniMax. (#959, #964, #965)

- **`./notify` moves behind a post-run delivery dispatcher (#912 Phase 2).** A
  skill call now writes one structured JSON payload to the notify queue instead of
  ever touching the wire; a new post-run `scripts/notify-deliver.sh` is the only
  place a channel token is consumed, rendering per channel (Telegram HTML +
  reply_markup, Discord embeds, Slack Block Kit, Buzz) and writing a per-send audit
  line. The Telegram / Discord / Slack / Buzz / email channel tokens are removed
  from every skill's run env and the `ALL_SECRETS` allowlist; `RESEND_*` (per-skill
  `requires:` for send-email / vuln-scanner) and `GITHUB_TOKEN` / `GH_GLOBAL` stay
  in-run. (#955)
- **`fx` (Vercel) added as a 7th run-harness.** Vercel's native Zig coding-agent
  CLI joins claude/grok/codex/pi/vibe/kimi behind the same `run-harness` contract,
  verified against a locally-built binary (missing-credential path, `mcpServers` to
  `mcp.json` translation, second-call usage reporting via `fx session`). It is the
  one harness with no OpenRouter fallback: it needs a Vercel AI Gateway key
  (`AI_GATEWAY_API_KEY`) or `VERCEL_OIDC_TOKEN`. See `docs/harnesses.md`. (#941)
- **New `skill-article` skill (Basics).** Turns any skill in the instance into a
  publish-ready launch article: proof-stat headline, one contrarian thesis,
  mechanics, war stories mined from real `memory/logs/` run history, a mental-model
  reframe, and the full `SKILL.md` embedded verbatim. Optional `--banner` renders a
  16:9 title card through the Higgsfield MCP. Catalog is now 76 skills. (#945)
- **Dashboard auto-allowlists MCP secret names into the run workflows.** A connected
  key-based MCP server's secret is now injected into the generated workflow env, so
  headless runs can actually see it instead of silently missing the credential.
  (#931)
- **Opt-in egress-audit hardening (`iron-proxy`).** A new composite action captures
  and reports a run's outbound network calls behind an audit proxy, off by default.
  (#947)
- **Codex plugin parity + a repo-root `llms.txt`.** The `/aeon` operator skill now
  installs on Codex too (`plugin/.codex-plugin/plugin.json` +
  `.agents/plugins/marketplace.json`: `codex plugin marketplace add aeonfun/aeon`
  then `codex plugin add aeon@aeon`), and a new repo-root `llms.txt` gives any
  coding agent a doc map of the core entry points, setup/config docs, catalog, and
  harness docs. (#919)
- **Generated harness capability manifest (`harness-adapter/harnesses.json`).** A
  queryable, CI-validated file of capability facts for the six adapters (claude,
  grok, codex, pi, vibe, kimi) - token-cost reporting, read-only enforcement, MCP
  flavor, auth - sourced from an `rh-meta` block in each `adapters/<h>.sh`. The CLI
  analog of a UHP `GET /v1/harnesses` discovery response. (#916)
- **Chain steps can route on Haiku quality scores (`when:` on chain steps).** The
  1-5 score Aeon already writes to `memory/skill-health/<skill>.json` becomes a
  control-flow edge: a chain step runs only when a condition holds for the score of
  the skill it consumes (e.g. `when: "score > 3"`). A `when:` whose key is missing
  skips the step rather than failing it. Chassis INTEGRATION.md item 2. (#911)
- **Dry-run gate for self-authored skills before auto-merge.** `create-skill` and
  `self-improve` now run a candidate with synthetic `DRYRUN`-marked secrets and a
  structural pass check (exit 0, output present, no write outside declared mode, no
  secret used outside `requires:`) before its PR opens - the live model credential
  is the only real secret allowed near the run. Chassis INTEGRATION.md item 4.
  (#914)
- **Structured audit log of privileged actions.** An append-only JSONL record (one
  line per action that reaches outside the run: notify, secretcurl) uploaded as the
  `audit-log-<run_id>` artifact. `secrets_used` is names only - values are scrubbed
  in raw, base64, and url-encoded forms before writing, failing toward
  over-redaction. Chassis INTEGRATION.md item 5. (#908)
- **Reactive failure handlers learn which skill tripped them.** A handler fired by
  `on: "*"` now receives the matched source skill as its `var` (unless it declares
  its own), so `skill-repair` no longer re-derives the failed skill. Reactive is
  documented as the blessed per-skill failure edge in `docs/CONFIGURATION.md`.
  Chassis INTEGRATION.md item 3. (#910)
- **`validate-config` checks reactive triggers.** Every reactive target and
  non-wildcard `on:` source must resolve to a real skill, and every `when:` must
  parse to a condition the runtime evaluator understands - a dangling reference or
  mistyped condition now fails CI instead of being a silent no-op. (#907)
- **`aeon-update` 3-way merges OWNED conflicts.** An operator-customized file that
  upstream also changed (commonly a hand-narrowed `aeon.yml`) now attempts a real
  `git merge-file --diff3`: disjoint hunks merge cleanly and keep the customization,
  genuine overlaps still surface as CONFLICT. Adds an eyebrow-lock fail-safe. (#903)
- **`vuln-scanner` A3.6 agentic logic audit.** A new source-to-sink reasoning pass
  over a repo's real entrypoints (threat model, ranked entrypoint inventory,
  deep-review of the top N by a size budget) that catches authorization,
  business-logic, and trust-boundary bugs the syntactic (A3) and fuzz (A3.5) passes
  miss. Candidates go through the same A4 triage. (#894)
- **`vuln-scanner` deliverability gate before autonomous disclosure email.** A new
  fail-closed DoH MX/A check (dns.google, then Cloudflare) confirms a resolved
  maintainer domain can actually receive mail before Arm C spends its one daily send
  slot; an unreachable domain flips the draft to `contact-unverified` and surfaces
  to the operator without burning the budget. (#895)
- **The `/aeon` operator skill is now installable as a Claude Code plugin.**
  Packages the existing `.claude/skills/aeon` setup skill as a distributable
  plugin under a self-contained `plugin/` subdirectory (`plugin/.claude-plugin/`
  manifest + `plugin/skills/aeon/`), published through a repo-root
  `.claude-plugin/marketplace.json`, so operators can install it from any folder
  with `/plugin marketplace add aeonfun/aeon` then `/plugin install aeon@aeon`
  (versioned, `/plugin update`-able) instead of copying files. Rooting the plugin
  under `plugin/` keeps its `skills/` isolated to the one operator skill and never
  drags the framework catalog into an installer's Claude Code; the copy is
  byte-for-byte identical to the source except the five `mine-history.mjs` path
  lines that resolve via `${CLAUDE_PLUGIN_ROOT}`. `docs/aeon-setup.md` gains
  install Option B and the README notes the plugin path. (#884, #885)
- **Five ecosystem partners listed in `docs/ECOSYSTEM.md`** - AgentLink, AI2Human,
  Mneme, Skim, and TaskMarket, each one alphabetized row, mirrored to
  aeon.fun/ecosystem automatically via hourly ISR. (#880)
- **New skill: `taskmarket-delegate`** - delegates work to the TaskMarket
  agent-worker market (`tasks.taskmarket.dev` / `api.taskmarket.dev`) instead of
  burning inference on low-confidence work. `browse` ranks open tasks
  winnable-first with no key; `create`/`submit` sit behind an explicit operator
  authorization gate and degrade cleanly to read-only when `TASKMARKET_API_KEY` is
  unset. Ships a zero-dependency node client and a 6-test suite (live read-only
  browse, no spend). `crypto` pack, disabled by default; brings the catalog to
  **75 skills** (74 -> 75; Crypto 14 -> 15). (#865)
- **New skill: `hunter-22`** - calls ClawHunter's free bounty-discovery API,
  matches candidates against the agent's real demonstrated capabilities (code,
  security research, research, writing, dependency analysis), and triages honestly
  - dropping content/social-growth work wearing a bounty costume, keeping
  deliverable work. Discovery only: no wallet, never claims or submits. When a kept
  candidate is audit-shaped (a `code`/`onchain` bounty linking a GitHub repo), the
  notification carries a one-tap "Audit owner/repo" button that dispatches
  `vuln-scanner` straight at that repo, closing discovery to audit in one motion.
  `productivity` pack, disabled by default; catalog 73 -> 74. (#864)
- **New skill: `you-web-search`** - an optional You.com-backed web search against
  the documented `https://api.you.com/v1/search` contract, giving operators a
  structured, current web source without changing default behavior. Parses
  `snippets[]` and `page_age` from the response shape You.com documents today;
  `YDC_API_KEY` required, with optional `YOUCOM_FRESHNESS` and `YOUCOM_LIVECRAWL`
  tuning. `basics` pack, disabled by default. (#795)
- **Finance District listed in `docs/ECOSYSTEM.md`** - its Agent Wallet is in the
  core catalog (`skills/finance-district-mcp`, #791) and launched as a supported
  wallet on aeon; one alphabetized row, mirrored to aeon.fun/ecosystem
  automatically via hourly ISR. (#869)
- **Five new skills, ported from the `aeon-dev` instance and generalized for any
  operator** (frontmatter converted to Agent Skills spec-form, OKF references
  removed, private product/instance references genericized): **`spend-watch`** (dev
  pack) - autonomous cloud-cost analyst across Neon / Vercel / Railway / GitHub
  Actions, attributing spend to the biggest drivers and ranking dollar-figured
  recommendations by real signal (`arm:` applies safe cost levers, disabled by
  default); **`competitor-monitor`** (productivity, `read-only`) - snapshots
  competitor pages (pricing, headings, CTAs, new/removed pages, title/meta) and
  reports only what changed; **`higgsfield`** (productivity) - generative
  image/video via the Higgsfield MCP, credit- and prompt-gated to <=2 outputs/run;
  **`remotion`** (productivity) - renders a short (<=10s) MP4 from an agent-authored
  storyboard via a bundled Remotion project, delivered by URL; **`weekly-aeoncard`**
  (productivity) - weekly token-consumption recap rendered as a shareable SVG card
  from `memory/token-usage.csv`. Brings the catalog to **73 skills** (68 -> 73; Dev
  pack 10 -> 11, Productivity 6 -> 10). (#860)
- **New skill: `video-script`** - turns a repo, product page, or topic into a
  recording-ready video script. Receipts-first: every number, address, and date is
  verified against the live source in-run, and anything unverifiable is cut or
  deferred to a dated "verify before recording" checklist. Standard conventions
  throughout (`${var}` selector, `--minutes N` runtime, `soul/` voice, output to
  `output/video-scripts/`). `basics` pack, disabled by default; brings the catalog
  to **68 skills** (67 -> 68). (#835)
- **New skill: `aeon-update`** - the downstream counterpart to `fork-fleet`. Runs
  inside an instance and pulls the parent's shipped framework changes *down* (new
  skills, script/harness fixes, workflow and doc updates), landing them as one
  reviewable PR - replacing the hand-run rsync-overlay rebase every managed
  instance did to stay current with canon. `core` pack, `write` mode, weekly and
  disabled by default; catalog **67** (66 -> 67). (#832)
- **New skill: `pack-submit`** - the inverse of `install-skill`. Takes one of the
  agent's own local skills and publishes it as a community pack: packages it into a
  standalone pack repo, creates and pushes a public GitHub repo to host it, and
  opens the registry PR (a README **Community Packs** row plus a matching
  `catalog/skill-packs.json` entry in one diff, gated on
  `validate-skill-packs.mjs`). `evolution` pack, disabled by default; catalog
  **66** (65 -> 66). (#831)
- **Community skill pack registered: Skim Clean Reads** (`skim-read`) - reads any
  URL as clean markdown via Skim's x402 endpoint, roughly 4x smaller than the raw
  HTML so downstream model steps burn far fewer tokens ($0.002 USDC on Base per
  read, no API key). Listed in the Community Packs table and
  `bin/install-skill-pack --list`. (#829)
- **New notification channel: Buzz.** `./notify` can now post to a
  [Buzz](https://buzz.xyz) channel (Block's self-hostable Nostr-relay workspace)
  alongside Telegram / Discord / Slack / email. Unlike the bearer-URL webhooks,
  delivery goes through the `buzz` CLI, which signs each message (NIP-98) with the
  agent's own keypair and publishes it as a room member rather than a webhook
  poster. Gated on `BUZZ_PRIVATE_KEY` + `BUZZ_CHANNEL_ID` and the presence of the
  CLI; outbound only for now (Phase 1). (#822)
- **OpenTelemetry on the Node entry points and non-claude harnesses.** The opt-in
  Langfuse tracing that previously covered only the `claude -p` path now extends to
  the dashboard, MCP server, and webhook (request/routing spans) and emits one
  coarse `gen_ai` span per run for the grok/codex/pi/vibe/kimi harnesses (numeric
  usage only, never prompt or result text). No-op unless
  `OTEL_EXPORTER_OTLP_ENDPOINT` (or the Langfuse keys) is set, and it never fails
  the caller. (#821, #823)
- **`aeon` skill Mode 8 - mine Claude Code history for skills to automate.** A new
  mode that reads the operator's own past Claude Code transcripts, ranks recurring
  work by distinct sessions x distinct days, and surfaces the strongest candidates
  to turn into scheduled skills (then hands the chosen one to Mode 4). Local-only;
  it never runs inside an Aeon run. (#820)
- **Per-skill icons across the dashboard, docs, and catalog.** Every skill now has
  its own monochrome glyph from one canonical source (`catalog/skill-icons.json`),
  driving the dashboard roster/detail/packs surfaces and the README + docs tables
  through a new `bin/generate-skill-icons` generator (`--check` fails on drift).
  (#808)
- **Community skill pack registered: AI2Human Create Task** (`ai2human-handoff`),
  now listed in `bin/install-skill-pack --list`. (#812)
- **New skill: `deploy-uni-hook`** - turns a one-line brief into a live Uniswap
  v4 hook + test pool on any v4 chain. Generates from a pre-audited template
  (`dynamic`/`noop`/`skim`) or a from-scratch freeform hook, auto-derives the
  hook-address flag bits (CREATE2-mined), and gates every deploy behind a static
  audit, a dangerous-pattern scan, a behavioral `forge` test, and a fork
  simulation. Dry-run by default; an explicit `arm:` broadcasts. Testnet-only
  unless `arm:` + an explicit `chain:` + a `HOOK_MAINNET_OK=1` lock all line up
  (a mainnet triple-lock). Foundry + a built v4 project are staged in a workflow
  step; the deploy receipt and best-effort explorer verification round it out.
  `crypto` pack, Opus-pinned, disabled by default; brings the catalog to
  **66 skills** (65 -> 66). (#805)
- **New skills: `seo-audit` + `posthog-errors`** - a daily on-page and technical
  SEO audit of every page on a site (sitemap-first discovery, per-page scoring,
  cross-page checks for duplicate titles/canonicals/sitemap gaps, day-over-day
  diff, and a standing `FIXES.md` work list), and a weekly cross-project PostHog
  error digest over the PostHog MCP server (ranks issues by impact across every
  project the OAuth grant covers, flags new vs ongoing, links a full committed
  report). PostHog joins the featured MCP servers with one-click dashboard
  Connect (a sixth `MCP_CATALOG` entry). Both `dev` pack, disabled by default;
  brings the catalog to **65 skills** (63 -> 65). (#802)
- **Auto-recovering circuit breaker for failing skills** - the scheduler now
  trips a breaker on a skill that fails repeatedly, pausing it and auto-recovering
  once it succeeds again, so one broken skill cannot burn every run. (#801)
- **New skill: `finance-district-mcp`** — a multichain non-custodial agent
  wallet over MCP (contributed by @raul1stdigital). Checks balances and prices,
  discovers the best DeFi yields, swaps, moves funds, and makes x402 paid API
  calls across EVM, Solana, Bitcoin, and Sui. Private keys never leave a secure
  enclave (TEE); per-transfer limits, an auto-approve threshold, and a
  destination denylist are enforced server-side, not in the prompt. One-click
  Connect from the dashboard MCP panel (a fifth `MCP_CATALOG` entry). Joins the
  `crypto` pack via its `category`; brings the catalog to **63 skills** (62 →
  63). Opt-in per deployment. (#791)
- **Multi-harness support** — skills now run on any of six agent CLIs (Claude
  Code, Grok, Codex, Pi, Vibe, Kimi) behind one `{result, usage, session_id}`
  contract via the new `harness-adapter`'s `run-harness`. The four
  OpenRouter-backed harnesses (`codex`/`pi`/`vibe`/`kimi`) share a single
  `OPENROUTER_API_KEY` or run on their own native login; scoring, token
  accounting, memory, and notifications are unchanged. All six were verified
  end-to-end on GitHub Actions. Selectable from the dashboard top bar, the
  workflow-dispatch **Harness** input, or `harness:` in `aeon.yml` (global or
  per-skill). (#765, #767)
- **`aeon-doctor` skill** — a static config-correctness linter that catches the
  silent-failure class (unquoted schedules, duplicate keys, unconfigured skills,
  mode typos, broken `requires`/MCP refs) no run-based health skill can see.
  Read-only; notifies only on problems. (#761)
- **`/aeon` setup skill shipped in-repo** — the operator-assistant skill that
  configures an instance now lives at `.claude/skills/aeon/` (with references)
  and is documented in `docs/aeon-setup.md`, which also names the coding agents
  that can drive an install (Claude Code, Codex, Hermes, OpenClaw). (#762, #763)
- **Dashboard: MCP credentials get their own Access Keys group.** A connected
  server's `MCP_<SLUG>_TOKEN` / `MCP_<SLUG>_OAUTH` used to fall into the
  "Skill Keys" catch-all as an undescribed `Custom secret` with a grey
  two-letter badge. They now render in a dedicated **MCP** section, each row
  carrying its server's logo from `MCP_CATALOG` (the same mark the MCP page's
  Featured card shows) and a description that distinguishes an OAuth-minted,
  refreshed-every-run access token from a pasted static bearer. Custom servers
  that aren't in the catalog get a server glyph instead of the badge. The
  section only renders once a server is connected. (#790)

### Changed

- **Stale harness and MCP catalog counts corrected.** `llms.txt` moved from six to
  seven coding-agent CLIs (the harness work above then takes the count to ten), and
  the MCP OAuth catalog in `docs/mcp-oauth.md` gained the missing Higgsfield row
  (`mcp.higgsfield.ai/mcp`), so "every catalog provider rotates" replaces "all
  four". (#960)
- **Ecosystem list churn:** added Eyebrow (#976) and removed Amper (#979).

- **Harness inventory counts normalized to seven.** With fx as the 7th adapter,
  `docs/harnesses.md`, `harness-adapter/README.md`, and the workflow comments now
  say seven (not six / five / four) and present the harnesses evenly, and the
  harness banner art is replaced with the seven-engine version. (#952, #950)
- **`memory-flush` mechanical bookkeeping moved out of the LLM.** The prep work is
  now a deterministic, watermark-tracked script (`memory_prep.py` +
  `memory-flush-state.json`) so the model only does the judgment part. (#938)
- **README notes the operator console installs as a Codex plugin too.** (#927)
- **Ecosystem: added AgentOS** to `docs/ECOSYSTEM.md`. (#946)
- **GitHub token model corrected to a single classic PAT.** `GH_GLOBAL` is now
  documented as one classic PAT with `repo` + `workflow` scopes (was fine-grained
  Contents/PRs/Issues); `GH_READ_PAT` / `GH_SECRETS_PAT` are reframed as legacy and
  optional, both folding into `GH_GLOBAL`. `read:org` / `admin:org` are not needed,
  and classic is preferred because the advisories / PVR API is unreliable with
  fine-grained tokens. Updated in `docs/CONFIGURATION.md`, the README, and the aeon
  setup skill's `references/secrets.md` (plus its plugin copy and the hosted
  mirror). (#905)
- **README agent-onboarding callout + harness section.** A top-of-README line
  points any coding agent at `read https://www.aeon.fun/skills/aeon.md and follow
  the instructions` (Claude Code, Codex, Hermes, OpenClaw), and a new "Six engines,
  one socket" section illustrates the `run-harness` contract across the six CLIs;
  plus an image-optimization pass trimming ~2.6M of oversized banner assets. (#922)
- **Security and dependency hardening.** All GitHub Actions are SHA-pinned to
  immutable commit refs, codex install scripts are blocked and the eyebrow download
  is SHA256-pinned, and the `messages.yml` `ALL_SECRETS` dump was narrowed to a
  named allowlist. (#904, #917, #918)
- **Maintenance.** Model pins refreshed to the current generation (Opus 5 to
  opus-4-8, fable-5 dropped from the Venice passthrough), the skill-run harness
  timeout raised to 30m (job cap 50m), cron-state commit given a jittered backoff,
  `skill_mode` grants `./scripts/skill-runs` in the base tier, `./notify` and
  `./secretcurl` cleanup plus a usage-probe guard, bounded apt installs, a dashboard
  feed-card layout fix, a main-CI unbreak, and README harness-section iterations.
  (#891, #892, #893, #896, #897, #898, #899, #900, #901, #902, #915, #920, #923,
  #924, #925)
- **OpenRouter gateway traffic is now attributed to Aeon.** The `openrouter` case
  of `scripts/llm-gateway.sh` sets `ANTHROPIC_CUSTOM_HEADERS` so every Claude Code
  request routed through `openrouter.ai` carries `HTTP-Referer: https://aeon.fun`
  and `X-Title: Aeon`, ranking the usage on OpenRouter's public app leaderboard
  instead of counting as anonymous volume. Overridable per fork via the
  `OPENROUTER_SITE_URL` / `OPENROUTER_APP_TITLE` repo vars; base URL, auth, and
  model are untouched. (#881)
- **Documented Langfuse v4 compatibility** in `docs/langfuse.md`: the OTLP
  ingestion contract is identical across v3 and v4, existing `pk-lf-`/`sk-lf-` keys
  keep working across the Nov 2026 Cloud cutover, and the shim already sends
  `x-langfuse-ingestion-version=4` for real-time direct ingestion. No config or
  behavior change. (#883)
- **`vuln-scanner` now runs a repo's own `cargo-fuzz` harnesses** during scan arm A
  (new step A3.5). The static tools (semgrep, trufflehog, osv-scanner) only ever
  read files; if the scanned repo ships its own `fuzz/fuzz_targets`, the scanner
  now seeds the corpus from its `tests/fixtures`, runs each target ~90s (capped at
  8 targets), and triages a crash with the same rigor as any scanner hit before it
  counts as a finding. A `command -v cargo-fuzz` + `fuzz/fuzz_targets` guard keeps
  it a clean no-op on repos without a harness. The runtime half stages a nightly
  Rust toolchain + `cargo-fuzz` in `stage-vuln-scanner.sh` (the sandbox denies
  toolchain installs in-run) and widens the write-tier allowlist with
  `Bash(cargo:*)` - a deliberate step up from read-only static scanning to
  compiling and running the target's own code inside the sandboxed run. (#863,
  #868)
- **Dashboard catalog wiring for the five new skills** (#860): the Higgsfield hosted
  OAuth MCP is registered in `mcp-catalog.ts` (one-click Connect, secrets + OAuth
  refresh derived generically from the slug); `secrets-catalog.ts` adds
  `NEON_API_KEY` and `RAILWAY_TOKEN` and notes `spend-watch` on the shared
  `VERCEL_TOKEN`; `aeon.yml` stages the Remotion toolchain (node deps + headless
  Chrome behind an `actions/cache`, via new `scripts/stage-remotion.sh`) and the
  `weekly-aeoncard` rasterizer (`librsvg2-bin`), both gated to the running skill.
- **README brand refresh.** The `.github/README.md` was rebuilt around an animated
  hero and section-banner art with a pill navigation, trimmed to MiroShark prose
  density, and the longer-form detail was relocated into `docs/` (Configuration,
  Skill packs, Showcase). Adds a "compare vs Claude Code, Hermes, and OpenClaw"
  pointer and a Community section. Presentation only - no capability change. (#833,
  #834, #836-#838, #840-#842, #844-#857)
- **`memory-flush` hardened.** The memory GC pass now stamps the consolidation date
  on every flush (so a live, repeatedly-flushed store no longer reads as an
  untouched template), scans an adaptive window instead of a fixed three days,
  de-duplicates before writing, and rotates its logs. Body-only skill edit. (#828)
- **Adopted the Agent Skills open standard; removed OKF globally.** All 65 skills
  now use spec-form frontmatter (only `name` + `description` top-level, everything
  else nested under `metadata:`, block-style lists) and pass the official
  `skills-ref` validator. OKF is gone entirely - the validator/index/backfill
  scripts, the `ci-okf` workflow, the MCP `okf://` resources, `docs/OKF.md`, and the
  `okf-export` / `okf-ingest` skills - and the `type:` frontmatter it mandated is
  stripped from every bundle file. The readers that parse skill metadata
  (`skill_requires`, `generate-skills-json`, the dashboard frontmatter parser, the
  scheduler `depends_on` parser) were rewritten for block-style lists, and the
  eyebrow lockfile was re-baselined. (#824)
- **Ecosystem logos refreshed; NoelClaw and SyntheticsAI removed** from
  `docs/ECOSYSTEM.md`. (#814)
- **Dashboard catalogs the `PAGESPEED_API_KEY` secret** - seo-audit's optional
  Core Web Vitals key now appears in the Skill Keys group with its brand icon and
  where-to-get-it copy, instead of a bare initials-badge catch-all row. (#803)
- **Docs: MCP catalog drift fixed and harness framing flattened** - plus a README
  catalog drift-guard and a `finance-district` row added to the mcp-oauth catalog
  table. (#794, #796)
- **Secret rename** — `BASESCAN_KEY` → `BASESCAN_API_KEY`, to follow the
  `<PROVIDER>_API_KEY` convention every sibling explorer/provider key uses.
  Operators who set the old secret should re-add it under the new name (or rely
  on `ETHERSCAN_API_KEY`, the same Etherscan v2 key). (#760)
- **Dashboard: per-skill model picker tracks the active harness** — a skill's
  detail panel now offers the selected harness's model ids. (#766)
- **Secret rename: `MCP_SECRETS_PAT` -> `GH_SECRETS_PAT`.** One standardized
  secrets-write PAT now serves both the OAuth MCP refresh and the Grok X-account
  refresh (still falling back to `GH_GLOBAL`). Operators using the old name
  should re-add the PAT as `GH_SECRETS_PAT`; `GH_GLOBAL` users are unaffected.

### Fixed

- **Local MCP server runs skills without blocking.** `apps/mcp-server` replaced the
  event-loop-freezing `spawnSync` with an async `spawn`, so a long `tools/call` no
  longer stalls `tools/list`, ping, or a second call; a new in-process single-flight
  queue serializes runs to protect the shared working tree from `.git/index.lock`
  and interleaved `memory/` writes. Same 600s timeout and 10MB output cap. (#973)
- **Telegram notification chunks stay under the size limit.** Markdown is now
  rendered to HTML before the final size split, and active tags are closed and
  reopened at chunk boundaries, so a skill with many links can no longer produce an
  unsendable oversized payload. (#970)
- **`bin/add-skill` records the real source commit in `skills.lock`.** The
  provenance lookup passed a `gh api` field that forced a `POST` to the GET-only
  commits collection, 404ed, and fell back to `commit_sha: "unknown"`; it now reads
  the commit correctly. (#972)
- **macOS portability:** the cron scheduler test detects GNU vs BSD `date` and uses
  native syntax (#957), and the issue-backed cron-state / health helpers no longer
  abort under Bash 3.2 `set -u` on an empty `REPO_ARGS` in their default
  current-repo mode (#971). Both were local-dev-only; Linux Actions scheduling was
  never affected.

- **Post-run scorer grades the sent notify card, not the harness `.result`
  recap.** For a notify-first skill the scorer now reads the captured chain
  artifact (`output/.chains/<skill>.md`) - the card that was actually sent - and
  falls back to `/tmp/skill-result.txt`, so real, verifiably-sent figures stop
  being capped as `unverifiable_claim`. Non-notify skills are unaffected (their
  chain file is a byte copy of the same `.result`). (#949)
- **Local MCP server dispatches the `fx` harness.** `skill-executor.ts` omitted
  `fx` from its `HARNESSES` tuple, so `resolveHarness()` silently rewrote any fx
  skill (or `AEON_HARNESS=fx`) to `claude`; adding `fx` makes the local MCP server
  honor it like the hosted workflows already do. (#953)
- **Dashboard captures Kimi's auth config correctly.** It now grabs the full
  `credentials/` directory plus `config.toml` when building `KIMI_AUTH`, instead of
  a single fixed credential filename - a non-mainland `kimi.ai` login writes a
  hash-suffixed credential file and stores its model selection in
  `~/.kimi-code/config.toml`, so the old capture left the CLI authenticated but
  stuck at `No model configured`. (#956)
- **`fx` now shows up in the dashboard harness picker.** (#943)
- **Dashboard locks `aeon.yml` read-modify-write.** Concurrent config edits no
  longer race and clobber each other. (#944)
- **secretcurl no longer leaks its substituted secret into curl's own argv**, where
  another process could read it via `ps` or `/proc`. (#935)
- **Telegram webhook dedupes redelivered updates by `update_id`** before dispatch,
  so a slow response no longer re-dispatches the same update. (#937)
- **Racing `state_store` / `health_issue` "ensure" calls converge** instead of
  creating duplicate GitHub issues for the same title. (#936)
- **Skill-runner concurrency group scoped by target too**, so dispatching the same
  skill at two different vars no longer collides. (#934)
- **`Bash(cd:*)` granted again in skill-mode**, restoring the documented
  one-cd-per-call workaround for the sandbox's compound-command denial. (#933)
- **Failed-dispatch diagnostics no longer truncated to the front of the output**, so
  the actual error fields survive logging. (#932)
- **Windows Connect/OAuth fix batch:** OAuth truncation, a setup-token timeout,
  config line-folding, Foundry install, and mainnet-flag masking. (#930)
- **Reactive `success_rate` conditions now actually fire.** The scheduler's inline
  evaluator only handled `consecutive_failures` and `last_status`; a trigger written
  as `when: "success_rate < 0.5"` matched no branch and was silently dropped.
  Single-condition evaluation moved to a tested `scripts/reactive_when.sh` covering
  all three documented conditions, with a `total_runs > 0` guard so a never-run
  skill does not false-fire. (#906)
- **`bd-radar` / `fleet-control` read private forks on the single-key setup.** With
  `GH_READ_PAT` optional and unset fleet-wide, `bd-radar` logged a false source-miss
  every run and read zero forks/issues; it now falls back to the run's `GH_GLOBAL`
  (which reads the same private data) and treats an unset `GH_READ_PAT` as the
  normal one-key config instead of a 401 / rotation follow-up. (#909)
- **Post-run quality scorer grades the full output, aligned to STRATEGY.** The judge
  previously saw only the first 3000 bytes (grading the intro, never the payoff); it
  now samples head 10KB + tail 4KB of large output, injects `STRATEGY.md` so
  correctness and verifiability outrank looks-finished polish, and adds a
  fabrication flag for invented IDs / URLs / figures. (#921)
- **`vuln-tracker` / `vuln-scanner` correctness ports from `aeon-vuln`.** The tracker
  now reads a flat-array `vuln-scanned.json` (not just the legacy `{scans:[...]}`
  shape, which silently yielded zero rows) and matches `fix(deps)` / `fix(security)`
  / bare `security:` PR titles on the `security/` branch (was `fix(security):`-only,
  dropping most in-flight PRs); the scanner installs osv-scanner v2 and scans
  gitignored lockfiles. (#890)
- **`aeon-update` no longer silently deletes a currently-enabled skill retired
  upstream.** The 3-way classifier CLEAN-DELETEd any `skills/<name>/` path removed
  upstream and unmodified locally without checking whether `<name>` is still
  `enabled: true` in the operator's `aeon.yml` - so a sync PR could drop an
  actively-scheduled skill's directory with nothing in the review flagging it, the
  break only surfacing later at `validate-config.js` or the skill's next run. That
  case is now downgraded to a CONFLICT (`enabled-skill-removed-upstream`): the
  directory stays and the PR body surfaces it in a loud dedicated section so the
  operator can't merge past it unnoticed. (#874)
- **`pi` + OpenRouter onboarding fixed.** `aeon auth --harness pi --key sk-or-...`
  crashed at the launcher's `exec "$TSX"` because `tsx` was a `devDependency` and
  the container bootstrap's `npm install --omit=dev` skipped it; `tsx` is now a
  runtime `dependency`. Separately, the dashboard "Run now" gate reported "No
  provider key set" whenever a flaky `/api/secrets` read (GitHub `503`) threw:
  a just-saved secret is now optimistically registered, and a failed vault read
  shows an accurate "couldn't read repo secrets" message instead of blaming a
  missing key. (#882)
- **`bin/add-skill` could not install from the standard `skills/<slug>/SKILL.md`
  layout** - the one this repo's own catalog uses. Discovery globbed at
  `-maxdepth 2` (never matching the depth-3 `SKILL.md`) so every repo reported "No
  skills found", and install resolved `$REPO_DIR/$skill` without the `skills/`
  subdir. Discovery now searches `-maxdepth 3` and install resolves `skills/<slug>`
  first, falling back to the flatter legacy layout. Verified end-to-end installing
  `tx-explain` from `aeonfun/aeon`. (#866)
- **Stale "Proof of work" numbers corrected** on the README to match
  aeon.fun/security and `ECOSYSTEM.md`: ~2M stars secured, 69 repos, 68 ecosystem
  products (community packs stay 12). (#843)
- **Read-only persistence contract corrected.** Docs told read-only skills they
  could persist to `memory/` during a run, but the OS sandbox write-locks the whole
  workspace on all six harnesses, so those writes silently fail. `CLAUDE.md` and
  `docs/CONFIGURATION.md` now state the real contract: persistence routes through
  the final captured output and `./notify`, and the post-run guard commits it to
  `output/.chains/` plus a `memory/logs/` entry outside the sandbox. (#817)
- **Read-only MCP skills route persistence through their output**, not direct
  `memory/` writes. `finance-district-mcp`, `glim-mcp`, and `robinhood-mcp` no
  longer instruct the agent to append to `memory/logs/` under read-only (those
  writes are refused by the sandbox), and the bare `./notify -f` is corrected to
  `./notify -f <file>` in each. (#818)
- **`finance-district-mcp` declares `onchain_writes`** (it signs and broadcasts
  transfers, swaps, and x402 payments) and its `./notify -f` usage is corrected to
  require a file path. (#816)
- **`finance-district-mcp` registered in `aeon.yml`.** The skill shipped in #791
  but had no schedule entry, so it never ran; it is now present (disabled by
  default). (#800)
- **Read-only skills ran in write mode on the MCP-server path.**
  `apps/mcp-server`'s `skill-executor.ts` hardcoded `--mode write` and never
  consulted `scripts/skill_mode.sh`, so all twelve `mode: read-only` skills ran
  unsandboxed with the full write toolset when invoked locally through the MCP
  server (`--mode` is what gates the OS sandbox). `resolveHarness()` had the same
  drift, ignoring per-skill `harness:` overrides. Both now agree with
  `resolve-harness.sh`, proven by a differential test over all 64 skills plus
  synthetic cases. (#792)
- **`wrap_raw_output` could fabricate a green run.**
  `harness-adapter/lib/envelope.sh` wraps output an adapter couldn't parse in a
  schema-valid SUCCESS envelope, so a failed parse published a blob to
  `output/.chains/<skill>.md` as the skill's deliverable and logged 0/0/0/0 usage
  indistinguishable from a real cheap run. The path is now countable via an
  `rh-wrap-fallback:` marker that `aeon.yml` promotes to a `::warning::` (behaviour
  deliberately unchanged pending blast-radius data), and `envelope.sh` gets its
  first test suite (`test_harness_envelope.sh`, 22 assertions). (#792)
- **Inbound messages now run on all six harnesses.** `messages.yml` staged only
  the claude and grok CLIs, so a repo configured for codex/pi/vibe/kimi had every
  inbound message answered on **claude** — loudly (`::warning::`), but still not
  the harness the operator chose, and on Anthropic credentials a
  single-provider fork may not even have. The cause was structural: both the
  ~100-line harness/provider/model resolution and the ~150-line install recipes
  lived *inside* `aeon.yml` steps, so no other workflow could reach them.
  Extracted to **`scripts/resolve-harness.sh`** (prints `HARNESS`/`AUTH_MODE`/
  `HARNESS_MODEL`/`MODEL_ARG` as `KEY=VALUE` lines) and
  **`scripts/install-harness.sh`**; both workflows now call them. Each still
  declares its own `env:` block, since `secrets.*` only resolves per workflow —
  but the logic, the half that drifted, is shared. This is the same class of bug
  as the two-path grok trap (#784), and the last surface where "aeon supports six
  harnesses" wasn't true. Verified by a differential test: 832 resolution cases
  and every config-generating install case produce byte-identical output to the
  inline versions they replace.
  - The extraction also made two latent bugs reachable and fixed both. A missing
    provider credential used to die *mid-heredoc* under `set -u` — the config
    file was already created, so the harness was left holding a **0-byte
    `config.toml`** and an error naming a shell variable instead of the secret.
    (It never fired inside a workflow, where the `env:` block always binds the
    name; it appears the moment the script is callable standalone.) It now fails
    closed and names the missing secret. Separately, `messages.yml` gated the
    Anthropic gateway on `!= grok`, correct only while claude and grok were the
    sole options — with the other four reachable it would have pointed their env
    at a gateway they never call. Now gated on `= claude`.
  - Both scripts get real test suites — `test_resolve_harness.sh` (28 cases) and
    `test_install_harness.sh` (21 cases). This logic had **never** been tested:
    inside a workflow step the only way to exercise it was to dispatch a live
    run. The install tests stub `npm`/`pipx` and assert what actually breaks —
    the generated codex/kimi/vibe provider config and the supply-chain version
    pins.
- **The docs described a read-only guard that does not exist, and the code it
  cited is deleted.** `docs/CAPABILITIES.md` and `docs/harnesses.md` both stated
  that a `mode: read-only` skill is confined on grok by an explicit tool allowlist
  under grok's own `--sandbox read-only`, generated by `skill_mode.sh grok-args`.
  Every part of that was wrong: `adapters/grok.sh` carries **no** allowlist by
  design (grok aborts the whole turn on a denied tool, so it runs
  `--permission-mode bypassPermissions`), grok's `--sandbox read-only` is silently
  ignored on 0.2.101, and `grok-args` had no callers at all once `run-grok.sh`
  became setup-only. An operator reading either doc would have concluded a
  read-only grok skill was tool-confined when nothing was confining it. `grok-args`
  is **removed** rather than rewired — what actually enforces read-only (the
  dispatcher's OS sandbox in `harness-adapter/lib/sandbox.sh`) is not expressible
  in that file. `CAPABILITIES.md` now names the three enforcement layers and which
  one is load-bearing, and a test asserts the subcommand stays gone.
- **Read-only skills are now sandboxed on every harness, and notify's queues moved
  out of the repo.** Three linked defects:
  - **`.pending-<skill>.md` was being committed.** `.gitignore` ignores
    `.pending-*/` (directories), not the file, so the json-render staging file was
    tracked. A sandboxed harness that could not overwrite it left the previous
    run's copy in place and "Capture skill output" published *that* as the new
    run's output — a green run reporting another run's work, and feeding it to the
    health scorer. Measured on a live instance: four consecutive runs captured a
    byte-identical artifact from a fifth.
  - **notify's queues lived in the workspace**, so under the OS sandbox they could
    not be written at all — costing dedup state, the re-delivery queue and the feed
    entry. They now live in `$AEON_PENDING_DIR` (outside the repo, exported by the
    workflow), which is also what removed the reason `claude`/`grok` ran with
    `--no-sandbox`.
  - **`claude` and `grok` therefore ran read-only skills with no runtime
    enforcement.** It mattered most on grok, whose adapter uses
    `--permission-mode bypassPermissions` and never applied an allowlist: a
    read-only grok skill could write anywhere in the repo (verified — it created a
    file on request), with only the post-run guard reverting it afterwards. Both
    now run under the wrapper sandbox. Bubblewrap installation was hoisted out of
    "Install harness CLI" — which skips claude and skipped grok by name — into its
    own step, or the sandbox would have silently degraded to advisory.
- **The read-only guard now cleans what it reverts.** `git checkout` only undoes
  edits to *tracked* files; the `git clean` list covered 6 of the ~15 `CODE_PATHS`,
  so a file a read-only skill *created* outside those 6 (e.g. under
  `apps/dashboard/lib/`, or a new top-level directory) survived and was committed
  by `git add -A`. Both lists are now the same set.
- **Connecting a harness account no longer opens two browser tabs.** The
  dashboard's "Connect X account" (grok) and "Connect ChatGPT"/"Connect Kimi"
  (codex/kimi) routes each parsed the verification URL out of the CLI's live
  output and opened it, on the premise that the CLI printed the URL and waited.
  All three CLIs open it themselves, so every Connect landed the operator on two
  identical auth tabs (verified on grok 0.2.106, codex, and kimi). The routes now
  wait on the tab the CLI opened. They still parse the URL, but only to quote
  back in the timeout error so an operator whose browser never opened can finish
  by hand. `openBrowser` remains in use for MCP OAuth, where the dashboard builds
  the authorize URL itself and no CLI is involved.
- **Every credential in Settings shows its brand mark again.** `CODEX_AUTH`,
  `KIMI_AUTH`, `OPENAI_API_KEY`, `MOONSHOT_API_KEY`, `MISTRAL_API_KEY`,
  `GH_READ_PAT` and `GH_SECRETS_PAT` were added to the secrets catalog without a
  matching row in the service-icon map, so all seven rendered as grey two-letter
  initials badges. The icon map and `lib/secrets-catalog.ts` are separate lists,
  so a new `resolveServiceMark` export plus `lib/service-icon.test.ts` now fail
  the build when a catalogued secret has no logo or glyph, naming the offender.

- **`scripts/run-grok.sh` is now setup-only.** With every surface dispatching
  through `run-harness`, the script's ~260-line run path (model/permission flags,
  MCP allows, run-shaping knobs, grok invocation, envelope normalization) had no
  callers — a second, drifting copy of `adapters/grok.sh`. Removed. What remains
  is the CLI version pin and the `GROK_CREDENTIALS` restore + rotating-refresh
  persistence (§2b). A stale caller using the old contract (prompt on stdin) now
  **exits 2 with a pointer to `run-harness`** rather than staging grok and
  returning empty stdout, which would read as "the model returned nothing".
  Its flag/envelope/MCP test coverage was **moved, not deleted**, into a new
  `scripts/tests/test_harness_adapter_grok.sh` — the first test suite for
  `harness-adapter` — which guards the `--trust` regression, the thought
  firewall, the per-server `MCPTool` allows, model-id forwarding, and
  abnormal-stop handling against the code that now implements them.
- **One run path: `messages.yml` and `apps/mcp-server` now dispatch through
  `run-harness`.** They were the last two surfaces calling `scripts/run-grok.sh`
  (and, on the claude side, `claude -p -`) directly, bypassing the harness
  adapter. That is a fix-delivery bug, not a style one: grok's MCP folder-trust
  gate was fixed for skill runs and stayed broken on these two for two releases,
  because the fix lived in the adapter they didn't use. With one path, an
  adapter-level fix reaches every surface by construction. `run-grok.sh` is now
  genuinely **setup-only** (CLI pin + `GROK_CREDENTIALS` restore/refresh), which
  `messages.yml` invokes explicitly since the run no longer installs grok on
  demand. Verified live on a real instance: an inbound message answered on grok
  called a live MCP tool (`glim__glim_web_fetch`) and reported real token usage.
  `apps/mcp-server` also now resolves **all six** harnesses — it previously
  recognised only `claude`/`grok` and silently ran anything else on claude.
  `messages.yml` stages only `claude`/`grok`, so the other four are answered on
  claude with a `::warning::` instead of a silent swap.
- **Removed the dead `GROK_JSON_SCHEMA` knob.** `scripts/run-grok.sh` mapped it
  to grok's `--json-schema`, but **nothing in the repo has ever set it** (checked
  the full history) - it was introduced as part of grok's run-shaping surface and
  reserved for the scorer, which never used it and now goes schema-less on
  purpose so one parse path covers all six harnesses. Structured output lives
  where it is uniform: `run-harness --json-schema` (native on claude/grok/codex,
  prompt-shim on pi/vibe/kimi); keeping a grok-only env var alongside it would
  recreate the per-harness divergence `harness-adapter` exists to remove. The
  `--check` precedence rule it required goes with it. Structured output is
  therefore adapter-path only - `messages.yml` and `apps/mcp-server` return plain
  text, as they already did in practice. Two tests now guard against the knob
  coming back.
- **grok's MCP `--trust` fix extended to the other two run paths.** #779 fixed
  only `harness-adapter/adapters/grok.sh`, which covers scheduled and manual
  skill runs. grok is *also* run directly through `scripts/run-grok.sh` by
  **inbound messages** (`messages.yml`) and the **local MCP server**
  (`apps/mcp-server`) - both of which do a full MCP preflight and then hit the
  same untrusted-checkout gate, so MCP stayed silently dead there. `run-grok.sh`
  now passes `--trust` alongside its `MCPTool` allows, scoped to runs with a
  `.mcp.json`. Covered by two new cases in `scripts/tests/test_run_grok.sh`.
- **MCP now actually works on codex, grok and kimi.** A live sweep of all six
  harnesses against a remote MCP server (glim.sh over streamable HTTP, run on
  GitHub Actions) found three broken. Each failed *silently*: the agent reported
  the server "not connected", fell back to plain HTTP, and the run still went
  green with a plausible-looking answer - so the run log was not evidence the
  tools had been used. Only `vibe` worked untouched; `pi` rejects MCP by design.
  - **codex could not load its config at all** when a server carried `headers`
    or `env`. `lib/mcp-translate.sh` emitted those as JSON objects, but codex
    parses `-c` values as TOML, where an object must be an inline table
    (`{ "K" = "V" }`, not `{"K":"V"}`). Every remote MCP server carries an auth
    header, so codex exited 1 before the model started: `Error loading
    config.toml: invalid type: string "{\"Authorization\":...}", expected a map`.
    Now emitted as inline tables with quoted keys, so header names that are not
    TOML bare keys (`X-Api-Key`) stay valid.
  - **grok never started the server.** It gates repo-local (project-scoped) MCP
    servers behind its folder-trust store (`~/.grok/trusted_folders.toml`), and
    a CI runner checks the repo out into a never-trusted path on every run - so
    no `mcp__<srv>__*` tool existed, on every run, forever. The adapter now
    passes `--trust`, and only when an MCP config is in play.
  - **kimi sent unexpanded `${VAR}` placeholders.** It auto-discovers
    `<cwd>/.mcp.json`, and that wins over the expanded copy staged in
    `$KIMI_CODE_HOME`, so a `Bearer ${MCP_GLIM_TOKEN}` header went to the server
    verbatim and 401'd. `lib/sandbox.sh` now overlays the expanded config onto
    the workspace file inside the bwrap sandbox - process-private, so no secret
    is written into the working tree. Linux only; macOS `sandbox-exec` has no
    bind-mounts.
- **Dashboard: the MCP panel warned about the wrong harness.** It disabled its
  controls on `codex`, citing `openai/codex#24135` (tool approvals auto-denied
  under `codex exec`). Re-measured on codex-cli 0.144.6: codex calls MCP tools
  fine, and the real fault was the config-load crash above. `pi` is the harness
  that genuinely cannot use MCP - its adapter warns and skips every server by
  design - so the banner, disabled controls and tooltips now point at `pi`, and
  codex is no longer blocked from a feature that works.
- **Community skill packs install cleanly.** Five defects, each of which broke
  `bin/install-skill-pack` for real packs in `catalog/skill-packs.json`; a sweep
  of all 10 registry packs now installs 52/52 skills with no skips or warnings
  (was 8/52).
  - `bin/generate-packs-json` assigned `skills.lock` skills to the synthetic
    `installed` pack *after* the catch-all check that aborts on an unassigned
    skill. A community `SKILL.md` is written to its author's conventions and
    usually has no `category:`, so the catalog build died on exactly the skills
    the `installed` pack exists to hold - taking out **6 of 10** registry packs
    (44 skills). The lock pass now runs before the check.
  - `bin/install-skill-pack` treated a manifest `path` ending in `SKILL.md` as a
    directory and looked for `SKILL.md/SKILL.md`, skipping every skill in the
    pack with a "missing" line that reads like the file isn't there. The file
    form is now accepted as its parent directory.
  - `record_provenance` called `gh api` with `-f`, which switches the request to
    POST; `POST /repos/{o}/{r}/commits` 404s and gh prints the error body on
    stdout, so `skills.lock` recorded `{"message":"Not Found",...}unknown` as the
    `commit_sha` of every installed skill. Now `-X GET`, pinned to the fetched
    branch, path-prefixed for `--path` packs, and validated as a 40-char hex.
  - `skill_fetch_repo` hardcoded `main` with no fallback, making any pack on
    `master` uninstallable by the documented one-command form (it failed as if
    the repo didn't exist). It now resolves the repo's real default branch and
    reports the ref it used, which callers record in `skills.lock`.
  - `bin/generate-skills-json` read only the first line of a frontmatter field,
    so a YAML block-scalar `description: >-` was catalogued as the literal `>-`
    and shown that way in the dashboard. Block scalars are now folded.
- **Grok OAuth (`GROK_CREDENTIALS`) now survives past 6h.** The captured
  X-account session holds a 6h access token plus a refresh token that xAI
  **rotates and revokes on every refresh**, so a static secret used to break
  ~6h after Connect (headless runs failed `Not signed in`). `scripts/run-grok.sh`
  (§2b) now refreshes the access token before each run and **persists the rotated
  `auth.json` back to the `GROK_CREDENTIALS` secret** - the same durable-refresh
  contract as MCP OAuth. Persisting reuses the secrets-write PAT
  (`GH_SECRETS_PAT` / `GH_GLOBAL`); without it grok warns loudly. Also adds a
  `grok)` case to the harness AUTH_MODE detection so a Connected X account is
  labelled `native-oauth` instead of defaulting to `openrouter`. See
  [docs/harnesses.md](docs/harnesses.md) and [docs/mcp-oauth.md](docs/mcp-oauth.md).

### Security

- **Dead channel credentials dropped from the in-run skill env (#912 item 2).**
  Six infrastructure creds with no in-run consumer - `DISCORD_BOT_TOKEN` /
  `DISCORD_CHANNEL_ID`, `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID`, and
  `BEAMR_GATEWAY_URL` / `BEAMR_PAYER_KEY` (+ the `BEAMR_NETWORK` / `BEAMR_MAX_PAY_USDC`
  vars) - are removed from every skill's run env and the `ALL_SECRETS` allowlist;
  the `*_WEBHOOK_URL` variants notify actually delivers through are kept. (#951)
- **Bumped `nanoid` to 3.3.18** (GHSA-2v37-7h3g-55p8) in the `remotion` skill's
  bundled project lockfile - transitive, lockfile-only. (#879)
- **`ALL_SECRETS` built from an explicit allowlist, not `toJSON(secrets)`.**
  Serializing the entire secret store into a workflow env var is the canonical
  credential-exfiltration primitive, and on 2026-07-28 GitHub began holding
  public-repo runs that match it for per-run, web-session-only approval - silently
  taking the public instances `aeon-agent` and `miroshark-aeon` dark from
  2026-07-30 (the `Aeon · Scheduler` workflow kept running green on `schedule`
  events, so they looked alive while doing nothing). `ALL_SECRETS` now serializes
  only the named secrets the workflow already references. Private forks were
  unaffected - the GitHub feature is public-repo-only. (#819)
- **Skill-scan recalibrated to fire on operations, not syntax.** The HIGH tier now
  matches dangerous sinks (code execution, secret exfiltration, destruction) and
  prompt injection rather than ordinary shell syntax, adds a `curl | sh` RCE
  pattern, and locks the boundary with a fixture test in CI - fixing a state where
  the gate failed 65 of 67 first-party skills and pushed operators toward `--force`
  (which skips the deep scan). (#811)
- **Skill-scan hardening follow-up:** closed an injection-suppression evasion
  (attacker-appended rejection keywords could silence a HIGH finding), extended the
  RCE process-substitution detection to `source <(curl ...)`, and caught quoted
  destructive-`rm` targets. (#813)
- **Telegram inbound gated on the owner's user ID.** In a group or public chat
  any member could command the bot by tapping a button; inbound is now restricted
  to `TELEGRAM_ALLOWED_USER_ID` (defaults to the chat ID for a 1:1 DM), failing
  closed otherwise. (#797)
- Patched two high-severity CVE classes in the dashboard — `sharp`/`libvips`,
  and Next.js `16.2.10 → 16.2.11`. (#758, #759)
- Bumped the dashboard `postcss` override past `GHSA-r28c-9q8g-f849`. (#783)

### Maintenance

- First repo lint gates: eslint (per app) and shellcheck (whole shell surface),
  both green on the current tree, with two shellcheck false positives suppressed
  with rationale (#962, #963); plus a 400x400 MCP logo for the Cline marketplace
  (#966).

- CI/test/asset noise: HOL AI Plugin Scanner workflow added then dropped same-day
  (#928, #929); unused `docs/assets` images removed and provider/free-aeon docs
  images refreshed (#939, #940); state-store/health-issue test hardening (#942);
  prior in-repo docs-sync of PRs #890-#925 (#926).
- Dead-code sweep from a `ponytail-audit` pass: verified cuts across the CLI,
  dashboard, mcp-server tracing, and scripts, net -444 lines, no behavior change.
  (#886)
- CI: added PR-scoped concurrency to the lint/check workflows so superseded runs
  cancel instead of piling up. (#887)
- Dashboard Dependabot security fix: patched `nanoid` advisories (lockfile-only
  transitive bump, no `package.json` change). (#871)
- Webhook Dependabot batch (undici, `@opentelemetry/core`) plus two CI changes:
  dropped the daily cron from Setup Telegram Commands, and stated the egress-parser
  scope with a lockfile-coverage gate. (#826, #827, #839)
- 2 dependency bumps (wrangler in the webhook; the dashboard group) plus a new CI
  eyebrow capability-integrity gate for skills. (#809, #810, #815)
- CI green-up after the Telegram owner-gate, plus a dashboard PacksPanel
  unique-key fix. (#798, #799)
- Repo-wide cleanup pass across 8 dimensions (dead code, weak types,
  duplication, circular deps). (#757)
- Second code-quality sweep across the dashboard, CLI, mcp-server, and
  harness-adapter — removed dead `opencode`/`GATEWAY` paths and five duplicate
  helpers, tightened weak types (`Record` → miss-aware value types), wired two
  orphaned test suites into CI, and fixed a `bin/install-from-atrium` file mode.
  Circular deps, dead code, and duplication all measured near-zero. (#792)

## [0.1.0] - 2026-07-09

First tagged snapshot — a stable, fully documented point to fork from or pin to.
Pre-1.0: the architecture is settled and the core skill set is production-ready,
but interfaces may still shift before 1.0.

### Added

- **Skill system** — 60 core skills across 6 packs. Each is a self-contained
  `SKILL.md` prompt file with YAML frontmatter (schedule, capability mode,
  required keys, MCP servers); scheduled, chained, or fired by reactive triggers
  through `aeon.yml`.
- **Self-healing loop** — a health skill scores every run 1–5 and files issues on
  degradations; repair skills fix them by PR.
- **Capability modes** — `read-only` skills physically cannot mutate the repo;
  irreversible actions (email, deploy, on-chain transfer) run in-run and fail
  closed.
- **Multi-provider LLM gateway** — an 8-provider cascade
  (`claude → anthropic → openrouter → bankr → usepod → venice → surplus → grok`)
  resolved by priority, plus an optional Grok build harness.
- **Memory & knowledge** — a native OKF knowledge bundle in-place, with
  `memory/topics/` living knowledge, daily logs, and a structured issue tracker.
- **Interfaces** — a local dashboard (config → GitHub secrets/vars), a headless
  CLI, an MCP server exposing skills as Claude tools, a Telegram webhook for ~1s
  interactive control, and multi-channel `notify` (Telegram/Discord/Slack/email/feed).
- **Security** — external content treated as untrusted; secrets kept off the
  command line via `secretcurl` with `{ENV}` placeholders; every skill install is
  security-scanned.
- **Community** — a public template repo with 10 community skill packs listed in
  the registry, installable in one click.

[Unreleased]: https://github.com/aeonfun/aeon/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aeonfun/aeon/releases/tag/v0.1.0
