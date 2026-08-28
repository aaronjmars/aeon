---
layout: default
title: Skill Capabilities Taxonomy
---

# Skill Capabilities Taxonomy

A **capability** is a self-declared blast-radius hint that a skill carries in its pack manifest. Capabilities surface at install time (`bin/install-skill-pack` and `bin/install-skill-pack --list`) so an operator can glance at what a pack can do — read-only? touches the chain? sends Slack? — before approving a `community` pack on a live agent.

Capabilities are **not** a gate. The trust boundary is still the operator + the security scanner + `trusted-sources.txt`. A skill that omits `capabilities` installs as before. A skill that declares them gets the listing surface for free.

---

## The taxonomy

The set is **locked** to the six values below. Unknown values are rejected by `install-skill-pack` with a clear error pointing back at this file. Adding a new capability requires a separate PR with rationale — this keeps the vocabulary stable so operators learn it once.

| Value | Meaning |
|-------|---------|
| `read_only` | No network writes, no on-chain calls, no notifications. The skill only reads (local files, public HTTP GETs to non-auth'd endpoints, on-chain reads). |
| `external_api` | Reads or writes to non-Aeon HTTP APIs — any auth'd third-party call (OpenAI, Twitter/X API, Discord webhook, Slack bot token, Postgres-as-a-service, etc.). Use this for any call that uses a secret. |
| `writes_external_host` | Modifies state on a non-Aeon host (POST/PUT/DELETE/PATCH against external services). Subset of `external_api` — declare both when the skill writes; declare only `external_api` when the calls are read-only. |
| `onchain_writes` | Signs and broadcasts blockchain transactions. The skill holds or proxies a wallet key and can move funds. |
| `agent_messaging` | Sends DMs, replies, or posts via X / Farcaster / Discord / Slack / Telegram or similar. Subset of `external_api` for the auth call, but called out separately because it speaks for the operator in public. |
| `sends_notifications` | Calls `./notify` (or the equivalent operator-alert path) — pings the operator's own channel, not an external audience. Lower blast radius than `agent_messaging`. |

### How to choose

Pick the **narrowest set** that's still complete. Examples:

- A skill that reads on-chain TVL and writes to `./notify` → `read_only`, `sends_notifications`.
- A skill that posts to X via the v2 API → `external_api`, `writes_external_host`, `agent_messaging`.
- A skill that fetches Coingecko prices and prints them in an article → `external_api` (Coingecko needs an API key for many endpoints; even free ones count as a third-party call).
- A skill that signs a Base txn rebalancing an LP position → `external_api` (RPC), `writes_external_host` (RPC POST), `onchain_writes`.

When in doubt, declare more than less. The listing surface only widens the operator's awareness — it never blocks.

---

## Schema placement

### Per-skill in `skills-pack.json`

```json
"skills": [
  {
    "slug": "vvvkernel-onchain",
    "capabilities": ["external_api", "writes_external_host", "onchain_writes"]
  }
]
```

### Pack-level in `skill-packs.json` (registry)

```json
{
  "repo": "baseddevoloper/aeon-skill-pack-vvvkernel",
  "capabilities": ["external_api", "writes_external_host", "onchain_writes", "agent_messaging", "sends_notifications"]
}
```

The pack-level field is the **union** of every skill's capabilities — kept in sync with the per-skill declarations so `bin/install-skill-pack --list` can summarise without fetching every pack tarball.

See [community-skill-packs.md](community-skill-packs.md) for the full schema reference for both files.

---

## Validation

`bin/install-skill-pack` runs strict allow-list validation when a manifest declares `capabilities`:

- Each value must match one of the six listed above (case-sensitive, exact match).
- Unknown values abort the install with an error message naming the invalid value and pointing at this file.
- An empty array (`"capabilities": []`) is treated as "not declared" — equivalent to omitting the field. A skill that genuinely does nothing externally should declare `["read_only"]` so the surface shows the intent.

No runtime gating — the install proceeds for any allow-listed combination. Capabilities are documentation, not a sandbox.

---

## Runtime enforcement: the `mode:` write tier

`capabilities` (above) is a documentation surface — it never blocks a run. The one capability axis Aeon **does** enforce at runtime is *write* access, declared per skill in SKILL.md frontmatter:

```yaml
mode: read-only   # read repo + fetch web + ./notify; no repo mutation
mode: write       # default — full Write / Edit / git / gh / python3
```

[`scripts/skill_mode.sh`](../scripts/skill_mode.sh) resolves the tier from frontmatter. `write` is the default and a strict superset (it adds `Write`/`Edit`/`git`/`gh`/`python3`). The tier is then enforced in **three layers**, and it is worth knowing which one is actually load-bearing:

| Layer | What it does | Where |
|---|---|---|
| 1. Tool allowlist | Drops `Write`, `Edit`, `Bash(git:*)`, `Bash(gh:*)`, `python3` from the model's tool set | `skill_mode.sh allowed-tools` → `run-harness --allowed-tools` |
| 2. **OS sandbox** | Write-locks the workspace for the whole run — the repo is mounted read-only, network stays open | `run-harness --mode read-only` → [`harness-adapter/lib/sandbox.sh`](../harness-adapter/lib/sandbox.sh) |
| 3. Post-run guard | Reverts and cleans anything that still landed under `CODE_PATHS`, preserving the skill's real output (memory, `output/`) and writing its run-log on its behalf | `.github/workflows/aeon.yml` |

**Layer 2 is the guarantee.** Layer 1 is a real narrowing but not a boundary: a shell redirection routes around it, and only the claude and pi adapters consume the allowlist at all. Layer 3 is after-the-fact repair. So the sentence "a read-only skill physically cannot mutate the repo" is true because of the sandbox — `bwrap --ro-bind` on Linux, `sandbox-exec` with a `deny file-write*` profile on macOS — which applies uniformly on **all ten harnesses**, claude included.

### Why the sandbox is the dispatcher's, not each harness's

Native harness sandboxes were tried and are deliberately not relied on:

- **grok** — its `--sandbox read-only` is silently ignored on grok 0.2.101 (writes still land) and nest-conflicts with the wrapper. grok also cannot carry an allowlist at all: it aborts the entire turn on a denied tool (`stopReason=Cancelled`) rather than degrading, so `adapters/grok.sh` runs `--permission-mode bypassPermissions` with **no** `--allow`/`--deny` rules. Until the wrapper sandbox was extended to grok, a read-only grok skill had *no* runtime enforcement — measured: it created a file on request, and only layer 3 took it back.
- **codex** — its `--sandbox read-only` works but also kills the network, which a skill needs. `adapters/codex.sh` disables it (`danger-full-access`) and lets the wrapper be the sole enforcer; only one FS sandbox may be active.
- **pi**, **vibe**, **kimi** — ship no filesystem sandbox.

If no OS sandbox is available on the machine, `run-harness` says so on stderr (`read-only is advisory`) and layers 1 and 3 still apply. On CI that path should never be taken — `aeon.yml` installs bubblewrap in its own step, before the harness CLIs, precisely so that a missing `bwrap` can't silently downgrade enforcement while still *looking* enforced.

Rule of thumb: a skill that declares `capabilities: [read_only, sends_notifications]` should also carry `mode: read-only` — the documentation surface and the runtime gate should agree.

---

## Adding a new capability

The taxonomy is intentionally narrow. New values must:

1. Cover a **distinct** blast radius — something an operator would weigh differently from the existing six.
2. Apply to **multiple** skills, current or planned. One-off cases stay inside `external_api`.
3. Land in **one PR** that updates: this file, the `skills-pack.json` schema reference, and the `install-skill-pack` allow-list constant (both the `ALLOWED_CAPABILITIES` array and the header comment that cites the same values). PRs that add a capability without one of those three pieces will be sent back.

The `ci-capabilities-parity` workflow (`.github/workflows/ci-capabilities-parity.yml`) runs on every PR that touches either file and fails the check when the three places disagree — so a half-PR can't merge silently. Run the same check locally with `bash scripts/check-capabilities-parity.sh`.

Closing a capability (deprecating a value) follows the same protocol in reverse — open a PR that migrates every existing pack first, then removes the value from the allow-list and this file in a follow-up.

---

## What this isn't

- **Not a sandbox.** A skill declaring `capabilities: [read_only]` is *trusted* to be read-only; nothing enforces that declaration. The operator-plus-scanner remains the trust boundary. Don't confuse it with the `mode: read-only` frontmatter above, which **is** enforced (by an OS sandbox) — the two are separate fields and a skill can declare one without the other.
- **Not a substitute for `trusted-sources.txt`.** Pack-level `trust_level: trusted` still requires the explicit trusted-sources listing — capabilities don't shortcut that.
- **Not an exhaustive permission model.** It's a coarse-grained hint so the install surface is informative. If you need fine-grained policy, that's a different feature.
