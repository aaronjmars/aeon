# Skill packs

Aeon ships **65 skills**, but most forks only ever run a handful. Packs make
that manageable: by default the dashboard shows **Core** (what makes Aeon
different) and **Basics** (simple skills you can run right now) — everything else
is grouped into **packs** that stay hidden until you enable them.
**Enabling a pack reveals its skills** across the sidebar and HQ. That's a
visibility switch (a per-browser preference), not a run switch — to actually put
a skill on duty you still flip its own on/off toggle. Enabling is always
per-skill.

There are two kinds:

- **First-party packs** — maintained in this repo. Defined as *data*, not
  separate repos: a skill's pack is derived from its category. Enabling a
  first-party pack just **reveals** its skills in the dashboard — nothing is
  downloaded, and nothing runs until you turn individual skills on.
- **Community packs** — maintained by others in external repos, listed in
  [`skill-packs.json`](../catalog/skill-packs.json) and installed with
  [`bin/install-skill-pack`](../bin/install-skill-pack).

---

## First-party packs

### How it works (the data layer)

```
packs.config.json   ──┐
                      ├─►  bin/generate-packs-json  ──►  packs.json  ──►  dashboard
skills.json         ──┘                                 (generated)      (/api/packs)
```

- **[`packs.config.json`](../catalog/packs.config.json)** — the hand-authored list of
  packs with their display metadata (name, description, color) and the `category`
  each one claims. Membership itself lives in each skill's frontmatter.
- **[`generate-packs-json`](../bin/generate-packs-json)** — derives `packs.json` from
  `packs.config.json` + `skills.json`. It asserts every skill lands in **exactly
  one** pack (no duplicate claims, no unknown slugs).
- **`packs.json`** — the generated catalog the dashboard reads. Membership only;
  live enabled/installed state is joined at request time by `/api/packs`.
- **[`ci-packs-json.yml`](../.github/workflows/ci-packs-json.yml)** — fails any
  PR that leaves `packs.json` stale, exactly like `ci-skills-json`.
- **[`ci-skill-category.yml`](../.github/workflows/ci-skill-category.yml)** — fails
  any PR where a `SKILL.md` is missing a valid `category:`
  (`bash scripts/check-skill-categories.sh` runs it locally).

Regenerate after any change to the config or to `skills.json`:

```bash
bin/generate-packs-json            # compact (committed form)
bin/generate-packs-json --pretty   # readable
```

### Membership — one grouping

**A skill's pack IS its `category`.** There's no separate axis: the `category:`
line in a skill's `SKILL.md` frontmatter is the single source of truth, read by
[`generate-skills-json`](../bin/generate-skills-json) into `skills.json`, and
each pack in `packs.config.json` claims the skills whose category equals its key.
To move a skill between packs, change that one line.

A skill with a missing or unknown `category` fails the `ci-skill-category` check
(`scripts/check-skill-categories.sh`), so every skill must declare one of the six
valid categories before it merges. (A pack may also hand-list `skills` explicitly,
but first-party packs are category-driven.)

### The packs

Pack key = category. Six packs, no empties; three are shown by default.

| Pack (`category`) | What's in it | count |
|---|---|---|
| **Core** (`core`) | Fleet coordination, self-configuration, liveness, memory + reporting. Shown by default; not removable. | 11 |
| **Evolution** (`evolution`) | The self-improvement loop — authors, evolves, installs, and heals its own skills. Shown by default. | 8 |
| **Basics** (`basics`) | Simple, immediately-runnable skills — one approachable entry per area. Shown by default. | 16 |
| **Dev & Code** (`dev`) | PR/issue triage, review, merges, changelogs, repo monitoring, security scanning, app deploys. | 10 |
| **Crypto & Markets** (`crypto`) | Token/DeFi/prediction-market monitoring, narrative tracking, on-chain forensics + automation, Uniswap v4 hook deploys. | 14 |
| **Productivity** (`productivity`) | Personal + social ops: routines, ideas, retrospectives, mentions, replies, ads, email. | 6 |

### Core + Evolution + Basics — what a fresh fork shows

Three packs are shown by default on the dashboard (locked always-on; every other
pack is revealed on demand):

- **Core — "what makes Aeon different from a cron job."** It coordinates a fleet
  of instances, self-configures its workflows, and keeps itself alive:
  `fleet-control`, `spawn-instance`, `fork-fleet`, `auto-workflow`, `auto-merge`,
  `heartbeat`, `memory-flush`, `narrative-convergence`, `shiplog`, `soul-builder`,
  `strategy-builder`.
- **Evolution — "an agent that improves itself."** It authors new skills, evolves
  and evaluates them, searches for and installs community skills, and heals its
  own fleet: `create-skill`, `autoresearch`, `self-improve`, `install-skill`,
  `search-skill`, `skill-health`, `skill-repair`.
- **Basics — "something simple you can run right now."** One approachable entry
  per area, little or no setup: `digest`, `article`, `token-movers`, `tx-explain`,
  `write-tweet`, `pr-review`, `github-trending`, `last30`, `price-alert`, and more.

`heartbeat` (Core) and `digest` (Basics) are enabled by default; the rest ship
present but on-demand. To move a skill into any pack, set its `category:` to that
pack's key. Change `DEFAULT_VISIBLE_PACKS` in `apps/dashboard/lib/constants.ts`
to change which packs show by default.

---

## Adding a skill to a pack

A skill's pack is one frontmatter line. Set `category:` in its `SKILL.md` to one
of — `core`, `evolution`, `basics`, `dev`, `crypto`, `productivity` (the pack key
is the category, verbatim):

```yaml
---
name: My Skill
category: dev
description: ...
---
```

The authoring tools set it for you:

- **`bin/new-from-template <tmpl> <name> --category dev`** — stamps the category
  (templates also ship a sensible default).
- **`create-skill`** — chooses a category as part of its design step.
- **Dashboard → Hire (import)** — a Pack dropdown writes the category onto the
  uploaded `SKILL.md`.

Then **regenerate**: `bin/generate-skills-json && bin/generate-packs-json`, and commit
both manifests (CI enforces they're fresh).

> **Core**, **Evolution**, and **Basics** are ordinary categories — set
> `category: core` / `evolution` / `basics` to file a skill there (they're just
> the three packs shown by default). Every skill must declare one of the six valid
> categories; a missing or unknown one fails the `ci-skill-category` check.

---

## In the dashboard

By default the dashboard shows **Core**, **Evolution**, and **Basics** — their
skills appear in the sidebar and HQ, and nothing else does. Enable packs to reveal
more.

The **Packs** view (`/api/packs`):

- **Your packs** — a card per first-party pack. Hit **Enable pack** to reveal
  that pack's skills across the sidebar and HQ (**Core**, **Evolution**, and
  **Basics** are always on). It's a
  visibility toggle, stored per-browser, that never changes what runs. **View
  skills** expands the card to list the pack's skills, each with its own on/off
  toggle to actually put it on duty.
- The **left sidebar** and **HQ** only show skills from enabled packs, grouped by
  pack. The sidebar's **Enabled** chip is an optional filter (off by default)
  that narrows the roster to skills on duty.
- **Community packs** — browse the registry with author, trust level, required
  secrets/capabilities, and a copy-paste `bin/install-skill-pack <repo>` command.

---

## Community packs

Unchanged from before — see
[community-skill-packs.md](./community-skill-packs.md). To list a pack: open a PR
adding an entry to [`skill-packs.json`](../catalog/skill-packs.json) and the README
table. To install one into your fork: `bin/install-skill-pack <owner>/<repo>`, then
enable its skills from the dashboard's Packs view.

---

## Full catalog (all 67 skills by pack)

Three packs are shown by default (**Core**, **Evolution**, **Basics**); the rest are revealed on demand.

| Pack | Skills |
|------|--------|
| **Core** (`core`, 12) | <img src="assets/skill-icons/aeon-update.svg" width="14" height="14" align="top" alt=""> `aeon-update`, <img src="assets/skill-icons/auto-merge.svg" width="14" height="14" align="top" alt=""> `auto-merge`, <img src="assets/skill-icons/auto-workflow.svg" width="14" height="14" align="top" alt=""> `auto-workflow`, <img src="assets/skill-icons/fleet-control.svg" width="14" height="14" align="top" alt=""> `fleet-control`, <img src="assets/skill-icons/fork-fleet.svg" width="14" height="14" align="top" alt=""> `fork-fleet`, <img src="assets/skill-icons/heartbeat.svg" width="14" height="14" align="top" alt=""> `heartbeat`, <img src="assets/skill-icons/memory-flush.svg" width="14" height="14" align="top" alt=""> `memory-flush`, <img src="assets/skill-icons/narrative-convergence.svg" width="14" height="14" align="top" alt=""> `narrative-convergence`, <img src="assets/skill-icons/shiplog.svg" width="14" height="14" align="top" alt=""> `shiplog`, <img src="assets/skill-icons/soul-builder.svg" width="14" height="14" align="top" alt=""> `soul-builder`, <img src="assets/skill-icons/spawn-instance.svg" width="14" height="14" align="top" alt=""> `spawn-instance`, <img src="assets/skill-icons/strategy-builder.svg" width="14" height="14" align="top" alt=""> `strategy-builder` |
| **Evolution** (`evolution`, 9) | <img src="assets/skill-icons/aeon-doctor.svg" width="14" height="14" align="top" alt=""> `aeon-doctor`, <img src="assets/skill-icons/autoresearch.svg" width="14" height="14" align="top" alt=""> `autoresearch`, <img src="assets/skill-icons/create-skill.svg" width="14" height="14" align="top" alt=""> `create-skill`, <img src="assets/skill-icons/install-skill.svg" width="14" height="14" align="top" alt=""> `install-skill`, <img src="assets/skill-icons/pack-submit.svg" width="14" height="14" align="top" alt=""> `pack-submit`, <img src="assets/skill-icons/search-skill.svg" width="14" height="14" align="top" alt=""> `search-skill`, <img src="assets/skill-icons/self-improve.svg" width="14" height="14" align="top" alt=""> `self-improve`, <img src="assets/skill-icons/skill-health.svg" width="14" height="14" align="top" alt=""> `skill-health`, <img src="assets/skill-icons/skill-repair.svg" width="14" height="14" align="top" alt=""> `skill-repair` |
| **Basics** (`basics`, 16) | <img src="assets/skill-icons/action-converter.svg" width="14" height="14" align="top" alt=""> `action-converter`, <img src="assets/skill-icons/article.svg" width="14" height="14" align="top" alt=""> `article`, <img src="assets/skill-icons/bd-radar.svg" width="14" height="14" align="top" alt=""> `bd-radar`, <img src="assets/skill-icons/digest.svg" width="14" height="14" align="top" alt=""> `digest`, <img src="assets/skill-icons/executor-mcp.svg" width="14" height="14" align="top" alt=""> `executor-mcp`, <img src="assets/skill-icons/fetch-tweets.svg" width="14" height="14" align="top" alt=""> `fetch-tweets`, <img src="assets/skill-icons/github-trending.svg" width="14" height="14" align="top" alt=""> `github-trending`, <img src="assets/skill-icons/glim-mcp.svg" width="14" height="14" align="top" alt=""> `glim-mcp`, <img src="assets/skill-icons/idea-forge.svg" width="14" height="14" align="top" alt=""> `idea-forge`, <img src="assets/skill-icons/last30.svg" width="14" height="14" align="top" alt=""> `last30`, <img src="assets/skill-icons/pr-review.svg" width="14" height="14" align="top" alt=""> `pr-review`, <img src="assets/skill-icons/price-alert.svg" width="14" height="14" align="top" alt=""> `price-alert`, <img src="assets/skill-icons/token-movers.svg" width="14" height="14" align="top" alt=""> `token-movers`, <img src="assets/skill-icons/tx-explain.svg" width="14" height="14" align="top" alt=""> `tx-explain`, <img src="assets/skill-icons/write-tweet.svg" width="14" height="14" align="top" alt=""> `write-tweet`, <img src="assets/skill-icons/you-web-search.svg" width="14" height="14" align="top" alt=""> `you-web-search` |
| **Dev & Code** (`dev`, 10) | <img src="assets/skill-icons/changelog.svg" width="14" height="14" align="top" alt=""> `changelog`, <img src="assets/skill-icons/deploy-prototype.svg" width="14" height="14" align="top" alt=""> `deploy-prototype`, <img src="assets/skill-icons/feature.svg" width="14" height="14" align="top" alt=""> `feature`, <img src="assets/skill-icons/github-monitor.svg" width="14" height="14" align="top" alt=""> `github-monitor`, <img src="assets/skill-icons/inbox-triage.svg" width="14" height="14" align="top" alt=""> `inbox-triage`, <img src="assets/skill-icons/posthog-errors.svg" width="14" height="14" align="top" alt=""> `posthog-errors`, <img src="assets/skill-icons/pr-triage.svg" width="14" height="14" align="top" alt=""> `pr-triage`, <img src="assets/skill-icons/seo-audit.svg" width="14" height="14" align="top" alt=""> `seo-audit`, <img src="assets/skill-icons/vuln-scanner.svg" width="14" height="14" align="top" alt=""> `vuln-scanner`, <img src="assets/skill-icons/vuln-tracker.svg" width="14" height="14" align="top" alt=""> `vuln-tracker` |
| **Crypto & Markets** (`crypto`, 14) | <img src="assets/skill-icons/base-mcp.svg" width="14" height="14" align="top" alt=""> `base-mcp`, <img src="assets/skill-icons/defi-overview.svg" width="14" height="14" align="top" alt=""> `defi-overview`, <img src="assets/skill-icons/deploy-uni-hook.svg" width="14" height="14" align="top" alt=""> `deploy-uni-hook`, <img src="assets/skill-icons/distribute-tokens.svg" width="14" height="14" align="top" alt=""> `distribute-tokens`, <img src="assets/skill-icons/finance-district-mcp.svg" width="14" height="14" align="top" alt=""> `finance-district-mcp`, <img src="assets/skill-icons/investigation-report.svg" width="14" height="14" align="top" alt=""> `investigation-report`, <img src="assets/skill-icons/monitor-polymarket.svg" width="14" height="14" align="top" alt=""> `monitor-polymarket`, <img src="assets/skill-icons/narrative-tracker.svg" width="14" height="14" align="top" alt=""> `narrative-tracker`, <img src="assets/skill-icons/onchain-monitor.svg" width="14" height="14" align="top" alt=""> `onchain-monitor`, <img src="assets/skill-icons/picks-tracker.svg" width="14" height="14" align="top" alt=""> `picks-tracker`, <img src="assets/skill-icons/pm-manipulation.svg" width="14" height="14" align="top" alt=""> `pm-manipulation`, <img src="assets/skill-icons/robinhood-mcp.svg" width="14" height="14" align="top" alt=""> `robinhood-mcp`, <img src="assets/skill-icons/token-pick.svg" width="14" height="14" align="top" alt=""> `token-pick`, <img src="assets/skill-icons/unlock-monitor.svg" width="14" height="14" align="top" alt=""> `unlock-monitor` |
| **Productivity** (`productivity`, 6) | <img src="assets/skill-icons/idea-pipeline.svg" width="14" height="14" align="top" alt=""> `idea-pipeline`, <img src="assets/skill-icons/mention-radar.svg" width="14" height="14" align="top" alt=""> `mention-radar`, <img src="assets/skill-icons/operator-scorecard.svg" width="14" height="14" align="top" alt=""> `operator-scorecard`, <img src="assets/skill-icons/reply-maker.svg" width="14" height="14" align="top" alt=""> `reply-maker`, <img src="assets/skill-icons/schedule-ads.svg" width="14" height="14" align="top" alt=""> `schedule-ads`, <img src="assets/skill-icons/send-email.svg" width="14" height="14" align="top" alt=""> `send-email` |

Authoritative source: [`skills.json`](../catalog/skills.json) + [`packs.json`](../catalog/packs.json), the dashboard **Packs** view, or `bin/add-skill aeonfun/aeon --list`. A skill's pack comes from its `category:` frontmatter.

---

## Status

The pack system is fully shipped: the data layer + three CI gates
(`ci-skills-json`, `ci-packs-json`, `ci-skill-category`), the dashboard **Packs**
view, frontmatter-driven categories, and `--category` authoring. README and
CONTRIBUTING document it. New skills declare `category:` (or use `--category`);
the `ci-skill-category` check rejects any skill with a missing or unknown one.
