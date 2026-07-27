# Changelog

All notable changes to Aeon are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Aeon is a fork-and-configure template, so releases mark a stable point to fork
from or pin to; the template keeps serving the latest `main` to new forks.

## [Unreleased]

### Added

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

### Changed

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

- Patched two high-severity CVE classes in the dashboard — `sharp`/`libvips`,
  and Next.js `16.2.10 → 16.2.11`. (#758, #759)

### Maintenance

- Repo-wide cleanup pass across 8 dimensions (dead code, weak types,
  duplication, circular deps). (#757)

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
