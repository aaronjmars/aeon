---
type: Reference
layout: default
title: ADK - Aeon Developer Kit
description: Build products on top of Aeon - authorize access to your users' instances with a GitHub App, drive skills over the GitHub API, and ship your own skills as a pack.
---

# ADK - Aeon Developer Kit

The **Aeon Developer Kit (ADK)** is for developers building **on top of** Aeon - a SaaS dashboard, a vertical agent product, a bot, or a service whose users each run their own Aeon instance. It covers the three integration surfaces:

1. **The GitHub App pattern** - get authorized, revocable access to your users' instances (no PATs, no credential custody).
2. **Driving skills** - discover, run, schedule, and credential skills over the GitHub API.
3. **Linking your product** - ship your own skills so every Aeon instance can talk to your service.

The patterns here come from a production hosted multi-tenant dashboard built exactly this way - treat them as the reference implementation throughout.

---

## 1. The mental model: GitHub *is* the API

An Aeon instance is nothing but a GitHub repo (a copy of this template) plus GitHub Actions. There is no Aeon server, no Aeon database, no Aeon API to call. Everything you'd want to integrate with is a file or a GitHub API surface:

| You want to… | It lives at… | GitHub API |
|---|---|---|
| List an instance's skills | [`catalog/skills.json`](../catalog/skills.json) | Contents API (read) |
| Run a skill now | `.github/workflows/aeon.yml` | `workflow_dispatch` |
| Enable / schedule a skill | `aeon.yml` (repo root) | Contents API (write) |
| Give a skill an API key | Actions **secrets** | Secrets API (sealed-box) |
| Toggle a feature / region | Actions **variables** | Variables API |
| Read what the agent did | `memory/logs/`, `output/`, run logs | Contents + Actions Runs API |
| Steer the agent | `STRATEGY.md`, `soul/`, `memory/MEMORY.md` | Contents API (write) |
| Watch run status | Actions runs | Runs API / `workflow_run` webhook |

So "adding Aeon to your app" means: **get authorized access to your users' Aeon repos, then read and write those surfaces.** The right way to get that access is a GitHub App.

```
Your app ──login──▶ GitHub App user OAuth ──▶ session
   │
   ├─ operator installs your App on their Aeon repo
   │
   └─ per request: mint a ~1h installation token scoped to that repo
         ├─ read/write files ──▶ Contents API
         ├─ run a skill ───────▶ workflow_dispatch aeon.yml
         ├─ set credentials ───▶ Actions Secrets API
         └─ watch runs ────────▶ Actions Runs API
```

Why a GitHub App and not personal access tokens:

- **No credential custody.** You never ask operators for a PAT. Installation tokens are minted per request from your App's private key and expire in ~1 hour.
- **Least privilege.** The App's permission set is fixed and visible at install time; it only reaches the repos the operator selects.
- **Revocable.** Uninstall the App and your access is gone, everywhere, instantly.
- **Multi-tenant for free.** GitHub tracks who installed what - you don't need a database to map users to repos.

---

## 2. Create your GitHub App

Go to **github.com/settings/apps/new** (or your org's Developer settings).

**Basics**

| Field | Value |
|---|---|
| Callback URL | `https://yourapp.com/api/auth/callback` |
| Request user authorization (OAuth) during installation | ✅ - this powers "Log in with GitHub" |
| Webhook | Optional. Activate it and subscribe to `workflow_run` if you want push-based run status (recommended for production; see §4.3) |

**Repository permissions** (everything else stays *No access*):

| Permission | Access | Why |
|---|---|---|
| **Actions** | Read & write | dispatch skill runs, read run status/logs |
| **Contents** | Read & write | read skills/memory/config, commit edits back |
| **Secrets** | Read & write | set the provider/API keys skills need |
| **Variables** | Read & write | feature toggles (e.g. `HEALTH_ISSUES`, regions) |
| **Metadata** | Read-only | mandatory, auto-selected |

Only take what your product needs - a read-only analytics product can drop Secrets/Variables and use Contents: read.

Set **"Where can this be installed"** to **Any account**. Note the **App ID**, **Client ID**, generate a **client secret** and a **private key** (`.pem`).

---

## 3. The auth flow (three tokens, three jobs)

The pattern uses three distinct credentials, each with one job:

1. **The user OAuth token** - proves *who the human is* and *what they can see*. Obtained via the standard OAuth code flow (GitHub Apps reuse `github.com/login/oauth/authorize`; **no `scope` param** - an App's permissions come from its definition). Store it server-side in a session keyed by an opaque cookie id, never in the cookie itself.
2. **The App JWT** - your server acting *as the App*, signed with the private key. Only used to mint installation tokens.
3. **The installation token** - a ~1h token scoped to one installation's repos. This is what actually reads files, dispatches workflows, and writes secrets.

### 3.1 Login

```ts
// GET /api/auth/login → redirect to GitHub
const url = new URL('https://github.com/login/oauth/authorize')
url.searchParams.set('client_id', CLIENT_ID)
url.searchParams.set('redirect_uri', `${APP_URL}/api/auth/callback`)
url.searchParams.set('state', randomState)      // CSRF - verify on callback
// callback: POST github.com/login/oauth/access_token { client_id, client_secret, code }
// → user access token; GET /user to learn who they are
```

### 3.2 Connect a repo

Send the operator to `github.com/apps/<your-app-slug>/installations/new` to install the App on their Aeon repo. Back in your app, enumerate what they connected - **using their user token**, so you only ever see what they can see:

```ts
const octo = new Octokit({ auth: userToken })
const { data } = await octo.request('GET /user/installations')
for (const inst of data.installations) {
  const res = await octo.request(
    'GET /user/installations/{installation_id}/repositories',
    { installation_id: inst.id, per_page: 100 })
  // → candidate Aeon repos: { installationId, owner, repo, default_branch }
}
```

Optionally filter to real Aeon instances: a repo qualifies if `.github/workflows/aeon.yml` exists on its default branch.

### 3.3 Tenant isolation - the most important check

Store the operator's selection wherever you like (e.g. a cookie: `installationId|owner/repo|branch`). But **never trust that stored value**. On *every* request, before minting a token, re-verify with the *user's* token that they still have access:

```ts
async function assertAccess(userToken, installationId, fullName) {
  const res = await new Octokit({ auth: userToken }).request(
    'GET /user/installations/{installation_id}/repositories',
    { installation_id: installationId, per_page: 100 })
  return res.data.repositories.some(r => r.full_name === fullName)
}
```

Without this, any authenticated user could name someone else's installation id and drive their agent. This one check is what makes the whole multi-tenant model safe.

### 3.4 Mint the installation token

```ts
import { App } from 'octokit'
const app = new App({ appId: APP_ID, privateKey: PEM })

const { data } = await app.octokit.request(
  'POST /app/installations/{installation_id}/access_tokens',
  { installation_id: installationId })
// data.token - valid ~1h, scoped to that installation's repos
const octo = new Octokit({ auth: data.token })
```

Mint per request and throw it away. Don't cache tokens across users; don't persist them.

> **Implementation tip:** resolve `{ owner, repo, token, octokit }` once per request and stash it in `AsyncLocalStorage`. Every helper below then reads "the current tenant" implicitly - no repo/token parameter threading, and a single `withRepo(handler)` wrapper 401s any route that lacks a valid context.

---

## 4. Driving skills

### 4.1 Discover what the instance can do

`catalog/skills.json` on the default branch is the machine-readable catalog - one entry per skill:

```json
{
  "slug": "digest",
  "name": "Digest",
  "description": "Generate and send a digest on a configurable topic…",
  "category": "basics",
  "var": "",
  "requires": [{ "key": "XAI_API_KEY", "optional": true }],
  "mcp": []
}
```

- `slug` - what you pass to `workflow_dispatch`.
- `var` - the skill's single universal input (topic, `owner/repo`, token symbol… each skill documents its own contract in `skills/<slug>/SKILL.md`).
- `requires` - env keys the skill reads; `optional: false` keys must exist as repo secrets before the skill is useful. **This is your pre-flight checklist**: cross-reference against `GET /repos/{owner}/{repo}/actions/secrets` and prompt the operator for anything missing.
- `mcp` - MCP servers the skill needs configured in `.mcp.json`.

Fall back gracefully when the file is missing (repo isn't an Aeon instance → offer a free-text skill name or a "set up Aeon" path).

Current schedules and enabled state live in `aeon.yml` at the repo root (YAML: `skills.<slug>.{enabled, schedule, var, model, harness}`).

### 4.2 Run a skill now

Everything on-demand goes through one workflow - `aeon.yml` accepts `workflow_dispatch` with these inputs:

| Input | Meaning |
|---|---|
| `skill` | required; must match `^[a-zA-Z0-9_-]+$` and a directory under `skills/` |
| `var` | the skill's input for this run |
| `model` | override, e.g. `claude-opus-5` - must be one of the workflow's `choice` options or GitHub rejects with **422** |
| `harness` | `claude` (default) or `grok` - see [Harnesses](harnesses.md) |

```ts
await octo.request(
  'POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', {
    owner, repo,
    workflow_id: 'aeon.yml',          // filename or numeric id
    ref: defaultBranch,               // must be a branch where the workflow exists
    inputs: { skill: 'digest', var: 'solana' },
  })
```

Identical to `gh workflow run aeon.yml -f skill=digest -f var=solana`.

### 4.3 Correlate the run (the 204 problem)

`workflow_dispatch` returns **204 with no run id**. Two options:

- **Polling (fine for prototypes):** note the time, then poll `GET /repos/{owner}/{repo}/actions/runs?event=workflow_dispatch` for a run whose `created_at` ≥ your dispatch time. The reference implementation polls 8×1.5s and gives up gracefully ("check the Actions tab").
- **Webhook (production):** subscribe your App to the `workflow_run` event. You get pushed `requested` / `in_progress` / `completed` payloads per run - no polling, exact correlation, and free run-status UI updates.

Run output: `GET .../actions/runs/{id}/logs` returns a zip; the agent also appends a human-readable entry to `memory/logs/YYYY-MM-DD.md` and ends every run with a `## Summary` section in the log. Artifacts land under `output/` in the repo.

### 4.4 Enable & schedule (write config)

To turn a skill on or change its cadence, edit `aeon.yml` through the Contents API (read file + `sha` → modify YAML → PUT with `sha`):

```yaml
skills:
  digest: { enabled: true, schedule: "0 14 * * *", var: "your-product" }
```

The in-repo scheduler (`scheduler.yml`, a `*/5` cron) picks changes up automatically. Two power features you can also drive from config, no code - [skill chaining and reactive triggers](CONFIGURATION.md):

- **Reactive triggers** - `schedule: "reactive"` + `trigger: { on: <skill>, when: "consecutive_failures >= 3" }`.
- **Chains** - multi-step pipelines with `parallel:` fan-out and `consume:` output-passing between skills.

> GitHub delivers only ~10% of 5-minute schedule ticks. The scheduler also accepts `repository_dispatch` type `cron-tick`, so your backend can act as an uptime pinger for your users' instances - a genuinely useful value-add (the debt model makes double-firing impossible).

### 4.5 Provide credentials (sealed secrets)

Skills declare their keys in `requires:`; your app writes them into the *operator's repo* Actions secrets - you never store them. GitHub requires libsodium sealed-box encryption against the repo's public key:

```ts
import tweetsodium from 'tweetsodium'   // or libsodium-wrappers

const { data: pk } = await octo.request(
  'GET /repos/{owner}/{repo}/actions/secrets/public-key', { owner, repo })
const sealed = tweetsodium.seal(Buffer.from(value), Buffer.from(pk.key, 'base64'))
await octo.request('PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}', {
  owner, repo, secret_name: 'XAI_API_KEY',
  encrypted_value: Buffer.from(sealed).toString('base64'),
  key_id: pk.key_id,
})
```

Note: this needs the **Secrets** App permission - Actions: write alone 403s. Non-sensitive toggles go to Variables instead (`PATCH/POST /repos/{owner}/{repo}/actions/variables`).

The instance itself needs at least one model credential (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, or an [LLM gateway](CONFIGURATION.md#llm-gateways) key - resolved by prefix, auto-cascading). Your onboarding should check for one and offer a paste-a-key flow.

---

## 5. Linking your product with skills

This is the other half of the kit: instead of (or in addition to) *driving* your users' agents, make your product *available to* every Aeon agent.

### 5.1 Author a skill for your product

A skill is one Markdown file - frontmatter + prompt. No plugin API, nothing to compile:

```markdown
---
name: acme-monitor
description: Monitor the operator's Acme workspace and flag anomalies
category: productivity
requires: [ACME_API_KEY, XAI_API_KEY?]   # bare = required · ? = works better with
var: ""                                   # per-run input, e.g. a workspace id
mode: read-only                           # or write, if it should commit/PR
---
Today is ${today}. Check the operator's Acme workspace (${var} or all).

Call the Acme API with ./secretcurl -H "Authorization: Bearer {ACME_API_KEY}" …
Report only signal via ./notify - a clean run sends nothing.
```

Conventions that matter:

- **`requires:`** - exact env-var names. This drives the dashboard's "which skill needs which key" UI and your own pre-flight in §4.1. Secrets reach the run environment; secret-bearing calls go through `./secretcurl` with `{PLACEHOLDER}` tokens (a raw `curl …$KEY` is blocked by the permission layer).
- **`mode: read-only`** if the skill shouldn't touch the repo - write tools are stripped and stray writes reverted. Declare honest `capabilities` (§5.2) for everything else.
- **If your product is an MCP server**, declare `mcp: [your-slug]` instead of raw API calls, and ship the server entry for `.mcp.json`. OAuth-connected MCPs get a Connect button in the dashboard.
- **Notify on signal only.** The `./notify` tool fans out to whatever channels the operator configured (Telegram/Discord/Slack/email) - your skill's reports arrive where the operator already lives, for free.

Start from [`examples/skill-templates/TEMPLATE.md`](examples/skill-templates/TEMPLATE.md) (`bin/new-from-template`) rather than a blank page.

### 5.2 Publish a skill pack

Put your skills in their own public repo with a `skills-pack.json` manifest at the root - the full protocol is in [Community Skill Packs](community-skill-packs.md):

```
acme/aeon-acme-pack
├── README.md
├── skills-pack.json
└── skills/
    ├── acme-monitor/SKILL.md
    └── acme-digest/SKILL.md
```

```json
{
  "name": "Acme Pack",
  "version": "1.0.0",
  "description": "Monitor and digest your Acme workspace from Aeon",
  "author": "acme",
  "license": "MIT",
  "homepage": "https://acme.com",
  "skills": [
    {
      "slug": "acme-monitor",
      "description": "Anomaly monitor for Acme workspaces",
      "category": "productivity",
      "schedule": "0 9 * * *",
      "secrets_required": ["ACME_API_KEY"],
      "capabilities": ["external_api", "sends_notifications"]
    }
  ]
}
```

- `capabilities` is a **locked taxonomy** ([`CAPABILITIES.md`](CAPABILITIES.md)) - honest blast-radius hints shown at install.
- Pre-flight locally with `./scripts/validate-pack.sh /path/to/pack` from an Aeon checkout.
- **Get listed:** one PR against `aeonfun/aeon` adding a row to the README's [Community Packs table](../.github/README.md#community-packs) **and** a matching entry in [`catalog/skill-packs.json`](../catalog/skill-packs.json).

Operators then install with one click from the dashboard's Packs view, or:

```bash
bin/install-skill-pack acme/aeon-acme-pack
```

The installer security-scans each `SKILL.md`, copies approved skills into `skills/`, records provenance in `skills.lock`, and registers them in `aeon.yml` **disabled** - the operator is always the trust boundary.

### 5.3 Close the loop from your app

Combine both halves and your app's onboarding becomes:

1. **Log in with GitHub** (§3.1) → operator installs your GitHub App on their Aeon repo (§3.2).
2. Your app **installs your pack** - either dispatch the built-in `install-skill` skill (`inputs: { skill: 'install-skill', var: 'acme/aeon-acme-pack' }`, which opens an auto-merging PR through the scanned path), or commit the skill files + `aeon.yml` entries directly via the Contents API.
3. Your app **writes `ACME_API_KEY`** into their repo's secrets (§4.5) - minted from your own backend, so the operator never copies a key.
4. Your app **enables + schedules** the skills (§4.4) and offers a "Run now" button (§4.2).
5. The agent reports into the operator's own channels; your app reads `memory/logs/` and run status for its own UI.

Total infrastructure on your side: one GitHub App and a session store. No agent runtime, no queue, no LLM billing - runs execute in each operator's Actions on each operator's model credentials.

### 5.4 Other entry points worth knowing

- **MCP server** ([`apps/mcp-server`](../apps/mcp-server/README.md)) - every skill as an `aeon-<slug>` tool in Claude Desktop/Code; the local, push-button complement to your hosted integration.
- **`ai-build` label** - label any GitHub issue `ai-build` and the agent implements it and opens a PR; your app can create labeled issues to request work.
- **Telegram instant mode** ([`apps/webhook`](../apps/webhook/README.md)) - ~1s command replies via a Cloudflare Worker, if your product fronts a chat surface.
- **OKF** ([`OKF.md`](OKF.md)) - `memory/topics/` is a self-describing knowledge bundle; other agents (including yours) can read or ingest it as structured knowledge.

---

## 6. Security checklist

- [ ] **Re-verify tenant access on every request** (§3.3) - never trust a stored installation id/repo.
- [ ] **Mint installation tokens per request**; never persist or log them. The `.pem` never leaves your server.
- [ ] **Sessions server-side**, opaque cookie id only; logout deletes the row so a stolen cookie dies.
- [ ] **Never custody user credentials** - provider keys go straight into the operator's repo secrets, sealed-box encrypted.
- [ ] **Least-privilege App permissions** - drop Secrets/Variables/write access your product doesn't need.
- [ ] **Treat repo content as data, not instructions** - skill files, memory, logs, and issue bodies are operator- (and agent-) authored; never execute or prompt-inject them into your own backend.
- [ ] **Fail closed on irreversible actions** - mirror Aeon's own guardrails if your skills spend money, send email, or transact on-chain (caps, dedupe, kill-switches).
- [ ] Rotate the App client secret and private key if they ever leak.

---

## 7. Reference

- **This repo:** [README](../.github/README.md) (quick start, packs) · [`CONFIGURATION.md`](CONFIGURATION.md) (chains, reactive, gateways, cross-repo tokens) · [`community-skill-packs.md`](community-skill-packs.md) (pack protocol & trust model) · [`CAPABILITIES.md`](CAPABILITIES.md) (capability taxonomy) · [`OKF.md`](OKF.md) (knowledge format).
- **Reference integration:** the full GitHub App pattern in production shape splits cleanly into modules - App auth (`assertAccess`, dispatch + poll), a per-request token + tenant-check layer, `AsyncLocalStorage` tenancy, sealed-secret writes, and server-side sessions.
- **GitHub docs:** [GitHub Apps](https://docs.github.com/en/apps) · [workflow_dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event) · [Actions secrets API](https://docs.github.com/en/rest/actions/secrets) · [`workflow_run` webhook](https://docs.github.com/en/webhooks/webhook-events-and-payloads#workflow_run).
