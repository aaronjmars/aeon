---
type: Reference
---

# Skill-execution attestation

Aeon can produce **verifiable provenance for skill runs** using
[GitHub Artifact Attestations](https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds).

When enabled, an attested run emits a Sigstore-signed, tamper-evident statement
binding the run's **output bytes** to the exact workflow identity that produced
them — repo, commit SHA, workflow file, runner, trigger event, time — signed
through Sigstore and logged to the public
[Rekor transparency log](https://docs.sigstore.dev/logging/overview/). Anyone can
later confirm a piece of Aeon output was really produced by an unmodified skill
at a known commit, **without trusting the repo or its operator**.

It's off by default and lives entirely in the trusted workflow layer — it touches
**zero skills** and adds no git churn to the attestation itself (attestations are
stored in GitHub's store keyed by the output's digest, not committed).

## What it proves — and what it doesn't

- ✅ **Proves:** *these exact output bytes* came from *skill X*, in workflow
  `aeon.yml`, at *commit C*, on a GitHub runner, at *time T*, triggered by
  *event E* — non-repudiable, tamper-evident, third-party-verifiable.
- ❌ **Does not prove:** that the output is *correct*, truthful, or that the model
  reasoned faithfully. Attestation is provenance of *bytes*, not a guarantee of
  *behavior*.

It answers *"was this really produced by an unmodified skill at a known commit,
or tampered with after the fact?"* — not *"is the output any good?"*

## Prerequisites

- **A GitHub-hosted runner** — Aeon already uses `ubuntu-latest`. ✔
- **Attestation availability for your repo:**
  - **Public repo** → works out of the box on every plan.
  - **Private repo** → the attestation store requires a plan that includes
    Artifact Attestations (**GitHub Team or Enterprise**). On a Free/Pro private
    repo the *Attest skill execution* step will fail. **Check your plan, or make
    the repo public, before enabling.**
- **`gh` CLI ≥ 2.49** locally *only if you want to verify* attestations yourself
  (`gh attestation verify`). Not needed to *produce* them.

> `aeon.yml` runs on `push` / `schedule` / `workflow_dispatch` on your own repo,
> so it always has a full workflow token — the fork-PR restrictions that limit
> `id-token` on `pull_request` events from forks do **not** apply.

## How it plugs into the run lifecycle

Nothing about a skill run changes. Aeon already captures every successful run's
output to `output/.chains/${SKILL}.md` (the **Capture skill output** step in
[`.github/workflows/aeon.yml`](../.github/workflows/aeon.yml)). Two steps run
right after it — see [`docs/CORE.md`](CORE.md) for the full run loop:

```
  Skill runs (claude -p)                     ← unchanged, in sandbox
        │
  Capture skill output  → output/.chains/X.md   ← already exists
        │
  Resolve attestation gate  → attest=true|false ← is THIS run attested?
        │
  Build run manifest        → output/.attest/X-<run_id>.{md,json} ← immutable snapshot + metadata
        │
  Attest skill execution    → Sigstore + Rekor  ← signs the run-scoped snapshot + manifest
        │
  Analyze / notify-jsonrender / commit …        ← unchanged
```

Two workflow permissions make this possible (already in `aeon.yml`):

```yaml
permissions:
  id-token: write        # mint the OIDC token that signs the attestation
  attestations: write    # write the attestation to the repo's attestation store
```

The attest step reuses the capture guard (`steps.run.outcome == 'success'`), so
**failed runs are never attested** — there's no meaningful output to bind.

## Turning it on

Attestation is **off by default**. There are three switches, in precedence order,
all gated behind one global kill switch.

### 1. Global — enable the feature (required)

Set the repo variable (dashboard → Variables, or CLI):

```bash
gh variable set ATTEST_ENABLED --body true --repo <owner>/<repo>
```

With this on and **no** per-skill config, the **default policy** applies: only
runs that **published output to the json-render feed** get attested (see
[What actually gets attested](#what-actually-gets-attested) below).

### 2. Per-skill — operator opt-in (no skill file changes)

Add `attest: true` to a skill's inline map in `aeon.yml`:

```yaml
  # before
  crypto-scan: { enabled: true, schedule: "0 12 * * *" }
  # after
  crypto-scan: { enabled: true, schedule: "0 12 * * *", attest: true }
```

Use `attest: false` to **force-exclude** a skill even when everything else says
yes (e.g. a noisy `price-alert` you never want in the public transparency log).

### 3. Author-declared — portable intent (one frontmatter line)

To make a skill *demand* provenance wherever it's installed, add to its
`skills/<name>/SKILL.md` frontmatter (same shape as `mode:`):

```yaml
---
name: vuln-scanner
category: security
mode: write
attest: true          # always attest this skill's output
---
```

This travels with the skill through `bin/export-skill` and the catalog.

### Precedence

```
aeon.yml attest:false (opt-out)  →  aeon.yml attest:true  →  SKILL.md attest:true  →  feed-published default
```

…all gated behind the global `ATTEST_ENABLED` switch. An explicit `attest: false`
in `aeon.yml` always wins.

## What actually gets attested

With the global switch on but no per-skill override, the **default policy attests
only runs whose output crossed the trust boundary** — i.e. runs that
**published to the json-render feed**. Concretely, the gate checks for
`apps/dashboard/outputs/.pending-${SKILL}.md`, which is written **only when a
skill actually calls `./notify`** (with `JSONRENDER_ENABLED` on, its default).

**This is deliberate.** Each attestation is a Sigstore signing plus a permanent,
public Rekor entry — a real cost and a public record. Attesting *what you publish*
rather than *every run of every skill* keeps the transparency log meaningful and
cheap.

Practical consequence worth remembering:

- A skill that finds nothing and stays silent (`heartbeat` on a clean run) sends
  no notification, writes no `.pending` file, and is **not** auto-attested. That's
  correct — nothing crossed the boundary.
- A skill that *describes* its notification instead of invoking `./notify` also
  won't publish, so the default policy won't fire for it. If you want such a run
  attested regardless, use the per-skill opt-in (switch 2) — that fires on the
  captured `output/.chains/${SKILL}.md` bytes independent of the feed.

## Verifying an attestation

Attestation targets an **immutable, run-scoped snapshot** of the output at
`output/.attest/<skill>-<run_id>.{md,json}` — *not* the shared
`output/.chains/<skill>.md` (see [Why a run-scoped snapshot](#why-a-run-scoped-snapshot)).
Verify that snapshot (or its manifest) against the repo:

```bash
gh attestation verify output/.attest/<skill>-<run_id>.md --repo <owner>/<repo>
# don't know the run_id? list them:  ls output/.attest/<skill>-*.md
```

`gh attestation verify` exits `0` on success. Inspect the bound provenance with
`--format json`; the fields that matter:

| Field | Meaning |
|---|---|
| `buildSignerURI` | the signing workflow, e.g. `https://github.com/<owner>/<repo>/.github/workflows/aeon.yml@refs/heads/main` |
| `sourceRepositoryURI` | the repo that produced it |
| `sourceRepositoryDigest` | the exact commit SHA the run executed at |
| `runInvocationURI` | the specific Actions run |

You can also scope verification to an owner or require a specific workflow:

```bash
gh attestation verify <file> \
  --owner <owner> \
  --signer-workflow <owner>/<repo>/.github/workflows/aeon.yml
```

Browse all attestations under **Actions → Attestations**, list them with
`gh attestation list --repo <owner>/<repo>`, or find the entry in the public
Rekor log.

### The run manifest

Alongside the output snapshot, each attested run writes a small JSON **run
manifest** (`output/.attest/<skill>-<run_id>.json`) that binds the Aeon-specific
facts the raw provenance doesn't carry — **model, capability mode, trigger** —
plus a `sha256` of the snapshot. It's signed in the *same* attestation as the
snapshot (a multi-subject attestation), so it costs no extra Rekor entry.

To read the richer metadata, verify the manifest and inspect its bytes:

```bash
gh attestation verify output/.attest/<skill>-<run_id>.json --repo <owner>/<repo>
cat output/.attest/<skill>-<run_id>.json
# { "skill": "...", "model": "claude-opus-5", "mode": "read-only",
#   "trigger": "schedule", "commit": "<sha>", "run_id": "<id>",
#   "output": { "path": "output/.attest/<skill>-<run_id>.md", "sha256": "<digest>" } }
```

### Why a run-scoped snapshot

The attested subject is a snapshot keyed by `${GITHUB_RUN_ID}`, not the shared
`output/.chains/<skill>.md`. That shared path is rewritten every run and, when
two runs push to `main` concurrently, the commit step's rebase-conflict resolver
**marker-strips** `output/*` files — concatenating both sides into bytes that
match *neither* run's attestation. Attesting a run-unique path sidesteps that
entirely: no other run writes it, so the committed bytes are always exactly what
was signed. (The shared `output/.chains/<skill>.md` is still produced as before
for chain consumption — it's just not the attestation subject.)

Because both are subjects of the one attestation, the manifest's `output.sha256`
also lets you cross-check the output bytes without a second verify.

### Worked example (validated)

A real `github-trending` run on a public test instance, attested via the
per-skill opt-in:

```
Attest step signed:   github-trending.md@sha256:11137951…f2a24f
Bytes pulled from repo:                  sha256:11137951…f2a24f   ← exact match
gh attestation verify … → exit 0

buildSignerURI:         .../aeon-attest/.github/workflows/aeon.yml@refs/heads/main
sourceRepositoryDigest: 26b6715034d4dafd723d3a724c6d7980bd198abd
runInvocationURI:       .../actions/runs/28832559487
```

The signer + commit are the guarantee: those exact bytes came from the unmodified
`aeon.yml` at that commit, on a GitHub runner.

## Optional enhancements

None are required for correctness — add them if the extra rigor or presentation
is worth it to you. (The **run manifest** — binding model/mode/trigger into the
signed statement — is *not* on this list: it ships by default, see
[The run manifest](#the-run-manifest) above.)

### Attest inbound & chained runs too

[`messages.yml`](../.github/workflows/messages.yml) (inbound Telegram/Discord/
Slack) and [`chain-runner.yml`](../.github/workflows/chain-runner.yml) run the
same skill prompt and capture output the same way. To attest those, apply the
same two permission lines and the same two steps to each. (`scheduler.yml` is a
pure dispatcher — it captures no skill output, so there's nothing to attest
there.)

### Provenance badge in the feed

Since attested feed items now have verifiable provenance, `apps/dashboard` could
surface a "✓ verified" badge that runs `gh attestation verify` (or the Sigstore
JS verifier) against the item's bytes and links to the Rekor entry. Purely
presentational; no workflow change.

## Rollback

Fully reversible, zero skill impact:

- **Pause instantly:** `gh variable set ATTEST_ENABLED --body false` (or delete
  the variable). The gate closes; runs proceed exactly as before.
- **Remove entirely:** delete the *Resolve attestation gate* + *Attest skill
  execution* steps and the `id-token` / `attestations` permission lines from
  `aeon.yml`. No skill, memory, or catalog change is involved.

## Gotchas

- **Off by default.** Nothing attests until `ATTEST_ENABLED=true`.
- **Success only.** Failed runs are never attested (no meaningful output to bind).
- **Private repos need a plan.** See [Prerequisites](#prerequisites) — Free/Pro
  private repos can't write to the attestation store; make the repo public or use
  Team/Enterprise.
- **Read-only skills are fine.** The attested snapshot in `output/.attest/` is
  written by the *workflow*, not the skill, so it survives the read-only post-run
  revert (which only reverts code/config the skill touched, not `output/`).
- **The store outlives the file.** Attestations are keyed by digest in GitHub's
  store + Rekor and persist even if `output/` is later overwritten — but to
  *verify* you need the original bytes.
- **Cost is a public record.** Each attestation is a Sigstore signing + a
  permanent public Rekor entry. That's the argument for the selective default:
  attest what crosses a trust boundary, not every run of every skill.
- **Pin the action.** The attest step pins `actions/attest-build-provenance@v4`
  per Aeon's supply-chain convention (`checkout@v7`, `setup-node@v6`). Confirm the
  [current major](https://github.com/actions/attest-build-provenance/releases)
  before bumping.
