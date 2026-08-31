---
layout: default
title: Skill capability integrity (eyebrow)
---

# Skill capability integrity

Aeon already scans skills two ways:

- **`scripts/skill-scan.sh`** — a regex scanner that answers *"does this skill's
  text contain a dangerous pattern?"* It runs once, on the text in front of it.
- **`skills.lock`** — records *where* each skill came from (`source_repo`,
  `commit_sha`) for provenance.

Neither answers *"has this skill quietly gained reach it wasn't approved for?"*
`skills.lock` pins a commit but never hashes content or egress, so a skill edited
**after** admission — an added exfiltration endpoint, a new credentialed call —
passes every existing check silently. That post-admission edit is the classic
supply-chain **rug pull**.

`ci-skill-integrity` closes that gap with [eyebrow](https://github.com/alexverify/eyebrow),
a content-addressed integrity engine — and does it **without** becoming a gate
that fires on every edit.

## What it gates on (and what it deliberately doesn't)

`eyebrowlock.json` fingerprints every `skills/<slug>/SKILL.md`: its content hash
**and** its declared egress — the set of hosts the skill reaches from a
network-call line (`./secretcurl`, `curl`, `wget`, `WebFetch`). On every PR that
touches a skill, the [`ci-skill-integrity`](../.github/workflows/ci-skill-integrity.yml)
workflow re-derives that fingerprint and, per [`eyebrow.policy.json`](../eyebrow.policy.json),
fails the build **only** when a skill:

- **gains a new egress host** vs the lockfile (`failOnCapabilityExpansion`), or
- introduces a **new critical finding** (`failOnSeverity: critical`).

It **does not** fail on a skill's wording changing (`allowContentDrift: true`).
Prose edits, refactors, and secret-plumbing changes that keep the same hosts are
*reported* but pass. This is deliberate: this repo modifies existing skills
constantly, and a gate that fired on every byte would be forced off within a week
— the exact failure mode of an over-broad scanner. eyebrow gates on *reach*, not
wording, so the signal stays meaningful.

**Scope, honestly:** the egress parser is line-based and host-granular. It
catches the common rug-pull shape — a new endpoint appearing on a call line. It
does **not** catch a URL split across lines, one assembled from shell variables,
or a new *path* on an already-listed host; those remain `skill-scan.sh` and
reviewer territory. Treat this gate as defense-in-depth, not a bash parser.

This **complements** `skill-scan.sh` — it does not replace it. Scan catches
dangerous *content*; eyebrow catches a skill *expanding what it can reach*.

## Refreshing the lockfile

When a skill legitimately gains a new endpoint, regenerate the fingerprint in the
**same PR**:

```bash
# one-time: install eyebrow (see github.com/alexverify/eyebrow/releases)
eyebrow scan --path . --lockfile eyebrowlock.json
git add eyebrowlock.json
```

The diff on `eyebrowlock.json` shows exactly which skill's reach changed,
reviewed alongside the skill change itself. A skill that adds a new egress host
with no matching lockfile update is what the gate rejects.

## Runtime hardening (optional, operator-side)

The `ci-skill-integrity` gate protects the skills **in this repo**. It runs at PR
time and says nothing about the operator's own machine after
[`bin/add-mcp`](../bin/add-mcp) registers the Aeon MCP server
(`apps/mcp-server/dist/index.js`) with Claude Code. Once that stdio server is
live, every Aeon skill is a callable `aeon-*` tool, and a server binary swapped
outside the build — or a dependency pulled at install — is beyond the reach of a
repo-side gate.

The same engine covers that surface at call time. For an Aeon server declared in
a project `.mcp.json`, `eyebrow wrap` routes it through `eyebrow mcp-shim`, a
local relay that:

- relays JSON-RPC **byte for byte**, so the server behaves identically;
- enforces a **per-tool policy** you set at the client boundary — a denied tool
  returns a JSON-RPC error and never reaches the server, above and beyond Claude's
  own approval prompt;
- writes an **audit log** of every tool call with argument values redacted
  (`~/.eyebrow/audit/<date>.jsonl`, queryable with `eyebrow audit`);
- captures the **exported tool surface** so a server that grows a new tool after
  approval shows up; and
- confines the process with the **OS sandbox** (macOS Seatbelt, Linux bwrap; it
  warns and runs unconfined on Windows).

This is defense-in-depth for the operator, not a repo gate — it complements the
CI check and Claude's approval flow, and it is entirely opt-in. See
[eyebrow's `wrap` / `audit` docs](https://github.com/alexverify/eyebrow) for
setup.

## Scope

v1 fingerprints the first-party `skills/<slug>/SKILL.md` set: content hash +
network egress. Exec and filesystem capabilities, lockfile signing, and a
findings threshold below critical can be layered on later purely in
`eyebrow.policy.json`, without changing this workflow. Runtime confinement of the
installed MCP server (above) is a separate, operator-side layer.
