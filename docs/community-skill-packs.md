---
layout: default
title: Community Skill Packs
---

# Community Skill Packs

A **skill pack** is a third-party collection of Aeon skills that lives in its own GitHub repo. Packs let domain experts ship curated bundles (financial intelligence, on-chain analysis, devops, niche research workflows) without fighting Aeon's core release cadence.

This page documents the **install protocol** — the `skills-pack.json` manifest format and the `bin/install-skill-pack` CLI that consumes it.

---

## Browse the registry

```bash
bin/install-skill-pack --list
```

Prints every pack declared in `catalog/skill-packs.json` — repo, skill count, trust badge, one-line description. Trusted-source packs are marked with `*` (security scan skipped, format check still runs). The script reads the local `catalog/skill-packs.json` when present and falls back to fetching the file from `https://raw.githubusercontent.com/aeonfun/aeon/main/catalog/skill-packs.json` when it isn't.

Trusted AntFleet packs currently expose both `pr-review-antfleet` for
installed repos with channel drawdown and `pr-review-antfleet-x402` for
public repos with x402 pay-per-call USDC.

## One-command install

```bash
bin/install-skill-pack AntFleet/aeon-skills
```

That single command:

1. Downloads the pack tarball from GitHub
2. Parses `skills-pack.json` from the pack root
3. Runs the security scanner against each declared `SKILL.md`
4. Prompts on any HIGH-severity findings (or fails closed when `--yes` / `--force` aren't passed in non-interactive contexts)
5. Copies skills into `skills/`
6. Records provenance in `skills.lock`
7. Adds catalog rows to `skills.json`
8. Inserts entries into `aeon.yml` (disabled by default — operator must enable explicitly)

Run `bin/install-skill-pack --help` for the full flag list.

---

## skills-pack.json schema

The manifest lives at the pack root (or under `--path <subdir>` if the pack is nested):

```json
{
  "name": "Pack Name",
  "version": "1.0",
  "description": "One-line summary of what the pack offers",
  "author": "github-handle-or-name",
  "license": "MIT",
  "homepage": "https://example.com/pack-home",
  "skills": [
    {
      "slug": "skill-name",
      "path": "skills/skill-name",
      "description": "What this skill does",
      "category": "research",
      "schedule": "0 12 * * *",
      "default_enabled": false,
      "secrets_required": ["VENICE_API_KEY"],
      "secrets_optional": ["VENICE_MODEL"],
      "capabilities": ["external_api", "writes_external_host"]
    }
  ]
}
```

### Field reference

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | recommended | Human-readable pack name. Falls back to repo name. |
| `version` | string | recommended | Pack release version (semver-flavored is fine; not enforced). |
| `description` | string | recommended | One-line summary shown by `--list`. |
| `author` | string | recommended | Maintainer handle, surfaced in `skills.lock` and pack listings. |
| `license` | string | optional | SPDX identifier (e.g. `MIT`, `Apache-2.0`). |
| `homepage` | string | optional | Project page, docs, or Twitter handle. |
| `skills[]` | array | **required** | At least one entry. |
| `skills[].slug` | string | **required** | Aeon skill slug. Must match `[A-Za-z0-9_-]+`. Used as the directory name under `skills/`. |
| `skills[].path` | string | optional | Path to the skill's **directory** inside the pack repo (relative). Defaults to `skills/<slug>`. May not contain `..`. A path ending in `/SKILL.md` is accepted and its parent directory used, but write the directory. |
| `skills[].description` | string | optional | Falls back to the SKILL.md frontmatter `description:`. |
| `skills[].category` | string | optional | One of `research`, `dev`, `crypto`, `social`, `productivity`. Defaults to `research` in `skills.json`. |
| `skills[].schedule` | string | optional | Cron string written into `aeon.yml`. Default `0 12 * * *`. |
| `skills[].default_enabled` | boolean | optional | If `true`, the skill is added to `aeon.yml` with `enabled: true`. Default `false` (operator opts in explicitly). |
| `skills[].secrets_required` | string[] | optional | Env vars the skill **cannot run without** (e.g. API keys). `install-skill-pack` warns loudly when any are unset before the first scheduled run, but does **not** gate the install — an operator may install dry-run or wire the secret afterward. |
| `skills[].secrets_optional` | string[] | optional | Env vars that tune behaviour but aren't required (e.g. a model override). Surfaced at install for visibility; informational only. |
| `skills[].capabilities` | string[] | optional | Self-declared blast-radius hints. **Locked taxonomy** — one or more of `read_only`, `external_api`, `writes_external_host`, `onchain_writes`, `agent_messaging`, `sends_notifications`. Surfaced in `install-skill-pack` listings; unknown values are rejected with an error pointing at [docs/CAPABILITIES.md](CAPABILITIES.md). |

### What's enforced

- `slug` must look like a slug — no `/`, `..`, or whitespace. Invalid slugs abort the install before any file is written.
- `path` may not contain `..`. Pack maintainers can't reach outside their own repo tarball.
- The manifest must be valid JSON. Parse failures abort cleanly.

### Fallback when no manifest exists

If the pack repo has no `skills-pack.json`, `install-skill-pack` falls back to scanning `skills/*/SKILL.md` and installs each discovered skill with the defaults above (`schedule = "0 12 * * *"`, `default_enabled = false`, `category = "research"`). This means existing repos that follow the `skills/<name>/SKILL.md` convention work out of the box — adding a manifest is an optional upgrade that lets the pack maintainer name and version the bundle.

---

## Worked example

A minimal pack repo `acme/aeon-research-pack` might look like:

```
.
├── README.md
├── skills-pack.json
└── skills/
    ├── arxiv-watcher/
    │   └── SKILL.md
    └── citation-graph/
        └── SKILL.md
```

With this manifest:

```json
{
  "name": "Acme Research Pack",
  "version": "0.2.0",
  "description": "arXiv watch + citation-graph traversal",
  "author": "acme-research",
  "license": "MIT",
  "skills": [
    {
      "slug": "arxiv-watcher",
      "description": "arXiv digest filtered by interest profile",
      "category": "research",
      "schedule": "0 8 * * *"
    },
    {
      "slug": "citation-graph",
      "description": "Walks BFS over citations from a seed paper",
      "category": "research",
      "schedule": "0 9 * * 1"
    }
  ]
}
```

An operator installs the pack with:

```bash
bin/install-skill-pack acme/aeon-research-pack
```

The two skills land in `skills/arxiv-watcher` and `skills/citation-graph`, with rows added to `skills.json`, entries appended to `aeon.yml` (disabled), and provenance recorded in `skills.lock`. The operator then sets `enabled: true` on whichever skills they want scheduled.

---

## Trust model

`install-skill-pack` runs the same security scanner as `bin/add-skill` (`scripts/skill-scan.sh`). Behavior:

- **Trusted source** (listed in `skills/security/trusted-sources.txt` as either `owner` or `owner/repo`) — the deep content scan is skipped. Format validation still applies.
- **Untrusted source, clean scan** — install proceeds.
- **Untrusted source, HIGH findings** — install pauses. Interactive runs prompt `y/N`. Non-interactive runs require `--yes` (accept anyway) or `--force` (skip the check entirely). Without either, the skill is blocked.

The operator is always the trust boundary. The install script does not auto-trust packs based on manifest claims.

---

## Pack maintainers: publishing checklist

1. Repo is public with a clear license file.
2. Each skill has a `SKILL.md` in `skills/<slug>/SKILL.md`.
3. Skills follow Aeon's `SKILL.md` conventions (frontmatter `name:`, `description:`, etc.).
   Include a **`category:`** from Aeon's vocabulary - `core`, `evolution`,
   `basics`, `dev`, `crypto`, `productivity`. Installed skills are grouped under
   the dashboard's **Installed** pack regardless, but the category is what the
   catalog records and what the operator sees; a missing or invented one shows
   up as `other`. The pack's own `skills[].category` is metadata for the
   installer - the `SKILL.md` frontmatter is what `skills.json` reads.
4. `skills-pack.json` declares every skill the pack intends to install. Skills present in `skills/` but missing from the manifest are not installed.
5. Optional but encouraged: a `README.md` that names each skill, explains scheduling assumptions, and lists any required environment variables.
6. Run `./scripts/validate-pack.sh /path/to/your-pack-dir` (from an Aeon checkout) to pre-flight the pack locally — it runs the same structural invariants `install-skill-pack` enforces (valid `skills-pack.json`, clean slugs, no `..` in paths, present per-skill `SKILL.md`, locked-taxonomy capabilities) and exits non-zero on any blocking error. Add `--path <subdir>` if `skills-pack.json` is nested.
7. Open a PR against `aeonfun/aeon` that does **two** things in one diff: adds a row to the **Community Skill Packs** table in the project README, AND adds a matching entry to `catalog/skill-packs.json` (the machine-readable registry — see schema below).

---

## skill-packs.json (community registry)

`catalog/skill-packs.json` is the machine-readable mirror of the README's Community Skill Packs table. `bin/install-skill-pack --list` reads it; future tooling (dashboards, third-party indexers) can read it without scraping the README.

### Registry schema

```json
{
  "version": "1.0",
  "updated": "2026-05-23",
  "description": "Machine-readable registry of community skill packs ...",
  "packs": [
    {
      "repo": "owner/repo",
      "name": "Pack Name",
      "description": "One-line summary",
      "author": "github-handle-or-name",
      "license": "MIT",
      "homepage": "https://...",
      "category": "research|dev|crypto|social|productivity",
      "trust_level": "trusted|community",
      "skills": ["slug-1", "slug-2"],
      "secrets_required": ["VENICE_API_KEY"],
      "capabilities": ["external_api", "writes_external_host"]
    }
  ]
}
```

### Field reference

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `repo` | string | **required** | `owner/repo` — the GitHub repo holding the pack. |
| `name` | string | recommended | Human-readable display name. Falls back to repo name. |
| `description` | string | recommended | One-line summary shown by `--list`. |
| `author` | string | recommended | Maintainer handle or org. |
| `license` | string | optional | SPDX identifier. |
| `homepage` | string | optional | Project page or docs link. |
| `category` | string | optional | Same vocabulary as per-skill category. |
| `trust_level` | string | optional | `trusted` (also requires the source in `skills/security/trusted-sources.txt`) or `community`. Default `community`. Listing here is a discovery hint — the actual scan-bypass behaviour is decided by the trusted-sources file. |
| `skills[]` | array | **required** | Slugs the pack ships. Mirror the pack's own `skills-pack.json`. |
| `secrets_required` | string[] | optional | Aggregated list of env vars the pack's skills declare as required. Drives the `bin/install-skill-pack --list --no-secrets` filter, which hides any pack with a non-empty `secrets_required`. Keep this in sync with the union of `skills[].secrets_required` in the pack's own `skills-pack.json`. |
| `capabilities` | string[] | optional | Aggregated blast-radius hints across the pack's skills. **Locked taxonomy** — see [docs/CAPABILITIES.md](CAPABILITIES.md) for the six allowed values and how to choose. List-only metadata: surfaces as `[caps: ...]` on `bin/install-skill-pack --list` and is taxonomy-validated at print time; not read by install (per-skill `skills[].capabilities` in the pack's own `skills-pack.json` is the source of truth at install time). Keep this in sync with the union of `skills[].capabilities`. |

### Why two files (README table + skill-packs.json)?

- The README table is for humans browsing GitHub.
- `skill-packs.json` is for tooling: `bin/install-skill-pack --list`, dashboard widgets, third-party crawlers, future package-resolver tooling.

Pack maintainers update both in the same PR so the two surfaces stay in lockstep.

### CI validates both (run it before you open the PR)

`ci-skill-packs` gates every PR that touches the registry or the README:

```bash
node scripts/validate-skill-packs.mjs
```

It fails the PR on registry shape (unparseable JSON, a `repo` that isn't
`owner/repo`, an empty or duplicated `skills[]`, a `trust_level` outside
`trusted|community`, a capability outside the [locked taxonomy](CAPABILITIES.md),
a `secrets_required` entry that isn't an env var name) and on README parity (an
entry with no table row or a row with no entry, a skill count that disagrees with
`skills[]`, a `--path` flag that disagrees with the registry's `path`, and the
`N community skill packs` counter in the README's Proof of work section).

Two things to know:

- **`trust_level: trusted` must be earned.** `--list` prints its trust badge from
  this registry, but the installer decides the real scan bypass from
  `skills/security/trusted-sources.txt`. A `trusted` entry that isn't in that
  file advertises "security scan skipped" without ever getting it, so the gate
  rejects it. Community packs use `trust_level: community`.
- **A subdirectory pack needs its `--path` in the README row.** If your registry
  entry sets `path`, the table row has to show the matching
  (`` `--path <dir>` ``) flag — otherwise the command a reader copies out of the
  README installs the wrong subtree.

Missing recommended fields (`name`, `description`, `author`) and unrecognised
fields warn rather than fail.

---

## Listed packs

See the [Community Skill Packs section](https://github.com/aeonfun/aeon#community-skill-packs) in the main README for the current registry.
