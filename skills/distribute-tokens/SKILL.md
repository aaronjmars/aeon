---
name: distribute-tokens
description: Two-phase contributor rewards - plan builds a tier-priced payout from the repo's merged-PR ranking; send executes it on-chain via Bankr Wallet API with per-recipient idempotency and dry-run.
metadata:
  title: Distribute Tokens
  category: crypto
  var: ""
  tags:
    - community
    - crypto
  requires:
    - BANKR_API_KEY?
  capabilities:
    - external_api
    - writes_external_host
    - onchain_writes
    - sends_notifications
---
<!-- autoresearch: variation C — robustness via per-recipient idempotency state, two-phase resolve→execute, dry-run, retries, 403/429 handling, recovery. Merged: contributor-reward's tier-priced reward-computation folded in as the plan/input phase; the on-chain distribution stays the execute phase. -->

> **${var}** — Phase + target selector. Grammar: `[plan:|all:][dry-run:]<target>`
> - `` (empty) / `<label>` / `dry-run:<label>` → **send** phase: distribute a list from `memory/distributions.yml` (empty = first list). *[default — no prefix]*
> - `plan:` / `plan:<week>` / `plan:dry-run` / `plan:dry-run:<week>` → **plan** phase only: compute rewards from the repo's merged PRs and write the list into `memory/distributions.yml`.
> - `all:` / `all:<week>` / `all:dry-run` / `all:dry-run:<week>` → **plan then send** in one run.
>
> `<label>` is a distribution-list label (e.g. `contributors-2026-W17`). `<week>` is an ISO week (`2026-W17`); empty `<week>` = most recent completed ISO week. `dry-run:` previews without side effects (no yml/state writes in plan; no transfers in send).

## Why this design

This skill owns the whole contributor flywheel: **who deserves what** (plan) and **moving the money** (send). It is split into two phases that can run independently or chained.

**Plan phase — the wiring the project was missing.** Merged PRs already name the people moving the project, but shipped work had no path to a wallet credit. The plan phase is that wiring: it ranks contributors by the PRs they merged in the target week (straight from the GitHub API), prices each eligible contributor against a tier table, and writes a labelled list into `memory/distributions.yml` — the exact file the send phase reads. Keeping a human-visible diff on `memory/distributions.yml` between plan and execution is the cheapest possible audit trail when real money is involved: the plan lands in git, and the operator (or `all:` mode, or a chained step) runs the send next.

**Send phase — this moves real money.** The biggest failure mode is double-sending (re-runs, retries after partial failures, day-rollover bypass of "skip if today" logic) or sending into a black hole (no preflight balance, deprecated API path, missing handle resolution). The send phase therefore:

1. **Persists per-recipient idempotency state** in `memory/state/distributions.json` keyed on `(list, recipient, date_utc)` with the txHash. A successful transfer is *never* re-sent within the same UTC day, even across re-runs or workflow restarts.
2. **Two-phase execution**: RESOLVE (validate config, key, balance, resolve all handles → addresses, build plan) → EXECUTE (send each transfer, persist state after each one). RESOLVE failures abort before any send.
3. **Dry-run mode** outputs the full plan with no transfers.
4. **Wallet API only** for actual transfers — Bankr's docs deprecate the Agent API for transfers. Agent API is used only for handle→address resolution.

The two phases stay decoupled by design: the send phase is the only sanctioned transfer path and owns the idempotency state file, so the plan phase never touches transfer state. `all:` mode simply runs plan then send in sequence (plan writes the list, send reads it), so nothing is re-implemented.

## Config

Reads two independent config/state surfaces depending on phase:

- `memory/distributions.yml` — the distribution lists (read by **send**, written by **plan**).
- The **plan** phase computes its ranking live from the repo's merged PRs via the GitHub API — no input file (see Phase A).
- `memory/state/distributions.json` — per-recipient send idempotency (read/written by **send**).
- `memory/state/contributor-reward-state.json` — plan idempotency + first-PR-bonus history (read/written by **plan**).

If `memory/distributions.yml` is missing when the **send** phase needs it, bootstrap with a commented template (see Send Step 1) and exit cleanly with `DISTRIBUTE_TOKENS_OK — bootstrapped distributions.yml; edit and re-run`.

```yaml
# memory/distributions.yml
defaults:
  token: USDC          # USDC | ETH (Base only)
  amount: "5"
  chain: base

lists:
  contributors:
    description: "Weekly contributor rewards"
    token: USDC
    amount: "10"
    recipients:
      - handle: "@alice_dev"      # Twitter/X — resolved via Bankr Agent API
        amount: "15"
      - handle: "@bob_builder"
      - address: "0x742d...5678"  # direct EVM address — preferred path
        label: "Charlie"
        amount: "20"
```

### Required secrets

| Secret | Phase | Purpose |
|--------|-------|---------|
| `BANKR_API_KEY` | send (and any dry-run send, which still preflights) | Bankr API key (`bk_...`). Must be **read-write** with **Wallet API** enabled. Read-only keys → 403. **Not needed for `plan:` (pure local file I/O).** |

### Token addresses on Base

- USDC: `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`
- ETH (native): `tokenAddress: "0x0000000000000000000000000000000000000000"`, `isNativeToken: true`

### Tier pricing (plan phase)

| Rank in leaderboard | Reward (USDC) |
|---------------------|---------------|
| 1                   | 25            |
| 2                   | 15            |
| 3                   | 10            |
| 4                   | 5             |
| 5                   | 5             |

**First-PR bonus:** +5 USDC, additive, applied once-ever per login (tracked in `memory/state/contributor-reward-state.json`). Rewards landing your first merged upstream PR — the highest-leverage signal in the leaderboard scoring.

**Eligibility floor:** score ≥ 10 AND the contributor must own a non-empty `@handle` (logins without `@` prefix in the table are skipped — bots and parsing artifacts). A single merged upstream PR (+10) qualifies — the goal is to reward shipped work, not gate on volume.

Default `token: USDC` on Base. Operator can override per-recipient amounts in `memory/distributions.yml` after the plan is written if a special bonus is warranted.

---

Read `memory/MEMORY.md` and scan the last ~3 days of `memory/logs/` for anything already reported (don't re-report the same signal).

## Step 0 — Parse the selector and dispatch

Resolve time anchors up front: `today=$(date -u +%F)` and `today_utc="$today"`.

Parse `${var}`:

1. **Phase prefix.** If `${var}` starts with `plan:` → `PHASE=plan`, strip `plan:`. Else if it starts with `all:` → `PHASE=all`, strip `all:`. Else → `PHASE=send` and **do not strip anything** (the remaining legacy grammar is parsed by the send phase itself).
2. **Dry-run.** For `PHASE=plan`/`all`: if the remainder starts with `dry-run` (optionally `dry-run:`), set `MODE=dry-run` and strip that token; else `MODE=execute`. (For `PHASE=send`, the send phase parses `dry-run:` itself — see Send Step 1.)
3. **Target.**
   - `PHASE=send`: the (unstripped) var is the send target — `dry-run:<label>` or `<label>` or empty.
   - `PHASE=plan`/`all`: the remainder is an optional `<week>`. If it matches `^\d{4}-W\d{2}$`, set `TARGET_WEEK=<week>`; else compute `TARGET_WEEK=$(date -u +%G-W%V)` (ISO-8601 week-numbering year + week — `%G/%V` not `%Y/%U`, so Monday-anchored weeks roll over correctly across years).

Dispatch:
- `PHASE=plan` → run **Phase A** only.
- `PHASE=send` → run **Phase B** only.
- `PHASE=all` → run **Phase C** (A then B).

Selector examples: `` → send first list · `contributors-2026-W17` → send that list · `dry-run:contributors-2026-W17` → dry-run send · `plan:` → plan most recent leaderboard · `plan:2026-W17` → plan that week · `plan:dry-run` → plan preview · `all:` → plan + send most recent · `all:dry-run:2026-W17` → full end-to-end preview for that week.

---

## Phase A — Plan (reward computation)

Ranks the target week's merged-PR authors (GitHub API) and turns that ranking into a tier-priced list in `memory/distributions.yml`.

### A1. Determine the target week and repo

- `REPO="${GITHUB_REPOSITORY:-$(git config --get remote.origin.url | sed -E 's#.*[:/]([^/]+/[^/]+?)(\.git)?$#\1#')}"` — the running instance's repo.
- `TARGET_WEEK` comes from the selector; empty = the most recent **completed** ISO week (the last full Mon–Sun). Compute its UTC bounds `WEEK_START`..`WEEK_END` as ISO datetimes (`YYYY-MM-DDT00:00:00Z`).

### A2. Rank contributors by merged PRs in the week

Compute the ranking directly from GitHub — no upstream skill or article required.

- Fetch every PR **merged inside the window**, by author:
  `gh api -X GET search/issues -f q="repo:${REPO} is:pr is:merged merged:${WEEK_START}..${WEEK_END}" --paginate --jq '.items[].user.login'`
- Drop bot authors (`*[bot]`, `dependabot*`, `github-actions*`). Count each remaining login's merged PRs → `score`. Rank by `score` descending; tie-break by earliest merge time, then login ascending.
- **First-PR ✨** per ranked login — did they have any *prior* merged PR to the repo?
  `gh api -X GET search/issues -f q="repo:${REPO} is:pr is:merged author:${login} merged:<${WEEK_START}" --jq '.total_count'` → `0` means this is their first-ever merged PR (set `first_pr_marker = ✨`).
- If zero merged PRs in the window → log `CONTRIBUTOR_REWARD_NO_MERGED_PRS — week ${TARGET_WEEK}` to `memory/logs/${today}.md`, exit silently (no notify). Nothing shipped, nothing to reward.
- If the GitHub API is unreachable (see Network note for the `gh api` → WebFetch fallback) → log `CONTRIBUTOR_REWARD_API_FAIL`, notify the operator, exit.

### A3. Load plan idempotency state

```json
// memory/state/contributor-reward-state.json
{
  "weeks": {
    "2026-W17": {
      "written_at": "2026-04-26T09:00:00Z",
      "label": "contributors-2026-W17",
      "source": "github:merged-prs",
      "rewards": [
        { "login": "alice_dev", "rank": 1, "score": 47, "amount": "25", "first_pr_bonus": false },
        { "login": "bob_builder", "rank": 2, "score": 31, "amount": "20", "first_pr_bonus": true }
      ]
    }
  },
  "first_pr_bonus_paid": ["bob_builder", "carol_eng"]
}
```

Bootstrap with `{"weeks": {}, "first_pr_bonus_paid": []}` if the file doesn't exist.

### A4. Compute the plan

For each ranked login with `rank ≤ 5` AND `score ≥ 1` (at least one merged PR):

- Look up `base_amount` from the tier table (rank 1→25, 2→15, 3→10, 4-5→5).
- If `first_pr_marker == "✨"` AND `login ∉ first_pr_bonus_paid` → set `first_pr_bonus = true`, `amount = base_amount + 5`. Otherwise `first_pr_bonus = false`, `amount = base_amount`.
- Build row: `{ rank, login, score, base_amount, first_pr_bonus, amount }`.

If `weeks[TARGET_WEEK]` already exists in state → this week was already processed. Diff the current plan against `state.weeks[TARGET_WEEK].rewards` keyed on `login`:

- If diffs are empty (same logins, same amounts) → log `CONTRIBUTOR_REWARD_ALREADY_PROCESSED — week ${TARGET_WEEK}`, exit silently (no notify). Idempotent re-run.
- If diffs exist (leaderboard re-ran after first reward write — late tweet bumped a score, etc.) → flag `RE_PROCESS`. Continue but don't re-pay anyone already in `state.weeks[TARGET_WEEK].rewards`; add only the deltas. New entries get full reward; existing entries with bumped amounts get the **delta** (e.g. moved from rank 3→2 = additional 5 USDC top-up). Demoted entries are not clawed back.

If the plan is empty (zero eligible contributors after threshold + dedup) → log `CONTRIBUTOR_REWARD_NO_ELIGIBLE` and exit silently.

### A5. Render the plan

```
Contributor Reward Plan — ${TARGET_WEEK} (${MODE})

Source: ${LEADERBOARD_FILE}
Tier: rank 1=25, 2=15, 3=10, 4-5=5 USDC; first-PR bonus +5 once per login.

  ✓ #1 @alice_dev      score 47  →  25 USDC                  [NEW]
  ✓ #2 @bob_builder    score 31  →  20 USDC (15 + 5 first-PR)[NEW + BONUS]
  ✓ #3 @carol_eng      score 24  →  10 USDC                  [NEW]
  ✓ #4 @dave_ops       score 18  →   5 USDC                  [NEW]
  ↻ #5 @eve_hax        score 14  →   5 USDC                  [DEDUP — already in state]

Total to write: 60 USDC across 4 new entries.
Total in state for ${TARGET_WEEK} after write: 5 entries, 65 USDC.

Next: distribute-tokens "dry-run:contributors-${TARGET_WEEK}" (preview)
      distribute-tokens "contributors-${TARGET_WEEK}"          (execute)
```

If `MODE=dry-run` (plan-only dry-run, i.e. `plan:dry-run...`): notify this plan with header `*Contributor Reward Plan — ${TARGET_WEEK}* — DRY RUN`, log to `memory/logs/${today}.md`, exit `CONTRIBUTOR_REWARD_DRY_RUN`. **Do not** touch `memory/distributions.yml` or the state file.

> **`all:` mode note:** when this phase runs as part of `all:` with `MODE=dry-run`, do **not** notify here and do **not** exit — hand the computed plan rows straight to Phase B (see Phase C). When `all:` runs with `MODE=execute`, continue through A6–A8 normally but replace the trailing `Next:` line in the A9 notification with `Distributing now (phase=all)…`.

### A6. Update memory/distributions.yml  *(skipped when MODE=dry-run)*

Read `memory/distributions.yml`. If missing → bootstrap with the standard header (matching the send-phase bootstrap style):

```yaml
# memory/distributions.yml
defaults:
  token: USDC
  amount: "5"
  chain: base

lists:
```

Compute the new list block:

```yaml
  contributors-${TARGET_WEEK}:
    description: "Weekly contributor rewards for ${TARGET_WEEK} (auto-generated from merged-PR ranking)"
    token: USDC
    amount: "5"
    recipients:
      - handle: "@alice_dev"
        amount: "25"        # rank 1
      - handle: "@bob_builder"
        amount: "20"        # rank 2 + first-PR bonus
      - handle: "@carol_eng"
        amount: "10"        # rank 3
      - handle: "@dave_ops"
        amount: "5"         # rank 4
```

Recipient ordering matches plan order (rank ascending). Per-recipient `amount` is required so the send phase picks up the tier-priced value rather than falling back to the list default.

**Update strategy:**
- If a list named `contributors-${TARGET_WEEK}` already exists in the YAML, **replace** it wholesale (the plan is the authoritative current state).
- Otherwise append the block under `lists:` (preserving existing lists — never rewrite them).
- Use a YAML-aware update (e.g. `python -c "import yaml; ..."` if available, otherwise a careful text-based block replacement keyed on the `^  contributors-${TARGET_WEEK}:$` line). If YAML parse fails on the existing file → log error, do not write, notify the operator (file is hand-edited; auto-edit would clobber).

Verify the write by re-reading the file and confirming the list is present and has `len(recipients) == len(plan)`.

### A7. Update plan state file  *(skipped when MODE=dry-run)*

Atomically write the updated state JSON to `memory/state/contributor-reward-state.json`:
- Set `weeks[TARGET_WEEK]` = `{ written_at: now_utc, label, source: "github:merged-prs", rewards: [{login, rank, score, amount, first_pr_bonus}, ...] }` (full replacement on RE_PROCESS, otherwise additive).
- Append any logins where `first_pr_bonus == true` to `first_pr_bonus_paid` (deduplicated).

Write to a tempfile and `mv` over the target so partial writes can't corrupt state.

### A8. Notify  *(plan-only execute)*

```
*Contributor Reward Plan — ${TARGET_WEEK}*

Wrote ${N_NEW} new entries (${TOTAL_USDC} USDC) to memory/distributions.yml as `contributors-${TARGET_WEEK}`.

Top of plan:
  #1 @alice_dev   — 25 USDC
  #2 @bob_builder — 20 USDC (✨ first-PR bonus)
  #3 @carol_eng   — 10 USDC
  #4 @dave_ops    —  5 USDC
${IF_DEDUP}

Source: ${LEADERBOARD_FILE}
First-PR bonuses awarded: ${LIST_OR_NONE}

Next: run `distribute-tokens dry-run:contributors-${TARGET_WEEK}` to preview, then drop the `dry-run:` prefix to execute.

Plan: https://github.com/${GITHUB_REPOSITORY}/blob/main/memory/distributions.yml
```

Suppress the `${IF_DEDUP}` line when no entries were deduped. Use `$GITHUB_REPOSITORY` env var for the link target. Send via `./notify`.

**Significance gate:** notify only when `N_NEW ≥ 1`. Re-process runs that produced zero new entries (RE_PROCESS with all rewards already paid) → silent log only. (In `all:` execute, skip this notify per the A5 note; the send-phase summary carries the report.)

Then log (see **Log**) and exit `CONTRIBUTOR_REWARD_OK`.

---

## Phase B — Send (on-chain distribution)

Reads a list from `memory/distributions.yml` and executes transfers via Bankr Wallet API. This phase moves real money — idempotency and preflight are non-negotiable.

Read `memory/state/distributions.json` (if present) for send idempotency state before doing anything.

### B1. Parse the send target and load config

- If the send target starts with `dry-run:`, set `MODE=dry-run` and `LABEL=${target#dry-run:}`. Otherwise `MODE=execute` and `LABEL=${target}`. (When entered from Phase C, `LABEL` and `MODE` are set by Phase C instead — see Phase C.)
- If `memory/distributions.yml` missing → **Bootstrap**: write the example config from the **Config** section (commented out so it's inert), notify `DISTRIBUTE_TOKENS_OK — bootstrapped distributions.yml; edit and re-run`, log, exit.
- Parse YAML. If `LABEL` empty, use the first list. Else find the matching list. If not found → notify `DISTRIBUTE_TOKENS_ERROR — list '${LABEL}' not found`, log, exit.
- (`today_utc` was resolved in Step 0.)

### B2. Pre-flight: key, write access, balance

If `BANKR_API_KEY` not set → `DISTRIBUTE_TOKENS_ERROR — BANKR_API_KEY not configured`, log, exit.

```bash
ME=$(./secretcurl -fsS "https://api.bankr.bot/wallet/me" -H "X-API-Key: {BANKR_API_KEY}")
```

- HTTP 403 → `DISTRIBUTE_TOKENS_ERROR — API key is read-only; needs wallet write scope`, exit.
- HTTP 429 → `DISTRIBUTE_TOKENS_ERROR — rate-limited at /wallet/me; aborting`, exit.
- Network failure → use **WebFetch** fallback. If still failing → `DISTRIBUTE_TOKENS_ERROR — Bankr /wallet/me unreachable`, exit.

```bash
PORTFOLIO=$(./secretcurl -fsS "https://api.bankr.bot/wallet/portfolio?chain=base" -H "X-API-Key: {BANKR_API_KEY}")
```

Extract sender's balance for the target token. Compute `total_required` from the recipient list (sum of per-recipient amounts, applying overrides). If `balance < total_required * 1.05` (5% headroom for any failed retries) → `DISTRIBUTE_TOKENS_ERROR — insufficient balance: have X, need Y ${TOKEN}`, exit. Do not start a partial run.

### B3. RESOLVE phase — build the plan

For each recipient, build a row: `{key, type, amount, token, target_address, label, status}` where `key = sha256("${LABEL}|${recipient_id}|${today_utc}")` and `recipient_id` is the handle (lowercase) or address (lowercase).

**Idempotency check** (before resolving): if `memory/state/distributions.json` contains `key` with `status=completed` → mark row `SKIPPED_DEDUP`, carry forward the prior `txHash`.

**Handle resolution** (`@username`): use Bankr Agent API to look up the linked wallet:
```bash
JOB=$(./secretcurl -fsS -X POST "https://api.bankr.bot/agent/prompt" \
  -H "X-API-Key: {BANKR_API_KEY}" -H "Content-Type: application/json" \
  -d "{\"prompt\":\"What is the EVM address linked to ${HANDLE} on Base? Respond with only the address.\"}" | jq -r '.jobId')
# Poll every 2s, max 30s
for i in $(seq 1 15); do
  R=$(./secretcurl -fsS "https://api.bankr.bot/agent/job/${JOB}" -H "X-API-Key: {BANKR_API_KEY}")
  S=$(echo "$R" | jq -r '.status')
  [ "$S" = "completed" ] || [ "$S" = "failed" ] && break
  sleep 2
done
```
Extract the address from the response (regex `0x[a-fA-F0-9]{40}`). If extraction fails → mark row `RESOLVE_FAILED` with reason `NO_LINKED_WALLET`. Do **not** abort the whole plan; let the executor skip this row.

**Address resolution** (`0x...`): validate format `^0x[a-fA-F0-9]{40}$`. If invalid → `RESOLVE_FAILED` reason `BAD_ADDRESS`.

After RESOLVE, print the plan to the console (and to the dry-run notification if `MODE=dry-run`):

```
Plan for list '${LABEL}' (${today_utc}):
  ✓ @alice_dev → 0x1234... — 15 USDC          [READY]
  ✓ Charlie    → 0x742d... — 20 USDC          [READY]
  ↻ @bob_builder → 0xabcd... — 10 USDC        [SKIPPED_DEDUP] (tx 0xprev...)
  ✗ @inactive → ?                             [RESOLVE_FAILED: NO_LINKED_WALLET]

Summary: 2 to send (35 USDC), 1 deduped, 1 unresolvable. Sender balance: 100 USDC.
```

If `MODE=dry-run`: notify the plan, log, exit `DISTRIBUTE_TOKENS_DRY_RUN`. Do not proceed.

If 0 rows are `READY` (everything deduped/failed) → notify the plan, log, exit `DISTRIBUTE_TOKENS_OK — nothing to send`.

### B4. EXECUTE phase

For each `READY` row, send via `/wallet/transfer` (the only sanctioned transfer endpoint per Bankr docs):

```bash
RESP=$(./secretcurl -fsS -X POST "https://api.bankr.bot/wallet/transfer" \
  -H "X-API-Key: {BANKR_API_KEY}" -H "Content-Type: application/json" \
  -d "{\"recipientAddress\":\"${ADDR}\",\"tokenAddress\":\"${TOKEN_ADDR}\",\"amount\":\"${AMT}\",\"isNativeToken\":${IS_NATIVE}}")
```

Outcome handling:
- HTTP 200 + `success: true` → status `COMPLETED`, store `txHash`. **Persist the state file immediately** (write after every recipient, not at the end — survives mid-run crashes).
- HTTP 200 + `success: false` → status `FAILED`, store `error` field as reason.
- HTTP 403 → status `FAILED` reason `READ_ONLY_KEY`. Abort remaining rows (key won't suddenly gain write access). Persist state.
- HTTP 429 → status `FAILED` reason `RATE_LIMIT`. Sleep 60s, retry once. If still 429, abort remaining (rolling-window quota exhausted). Persist state.
- HTTP 5xx or network error → retry once after 10s. If still failing, status `FAILED` reason `API_ERROR`.
- Any other → status `FAILED` reason `HTTP_${code}`.

State file shape (`memory/state/distributions.json`, append/upsert):
```json
{
  "contributors|@alice_dev|2026-04-20": {
    "list": "contributors",
    "recipient": "@alice_dev",
    "address": "0x1234...",
    "amount": "15",
    "token": "USDC",
    "status": "completed",
    "txHash": "0xabc...",
    "timestamp": "2026-04-20T12:34:56Z"
  }
}
```

### B5. Build summary notification

Top line is a verdict: `COMPLETE` (all READY succeeded) / `PARTIAL` (some failed) / `FAILED` (none succeeded) / `DRY_RUN` / `NOTHING_TO_SEND`.

```
*Token Distribution — ${today_utc}* — VERDICT

List: ${LABEL} (${description})
Token: ${TOKEN} on Base
Sent: ${total_sent} ${TOKEN} to ${n_success}/${n_attempted} recipients
Skipped (already sent today): ${n_dedup}
Unresolvable: ${n_unresolved}

✓ @alice_dev — 15 USDC ([tx](https://basescan.org/tx/0xabc...))
✓ Charlie (0x742d...) — 20 USDC ([tx](https://basescan.org/tx/0x123...))
↻ @bob_builder — 10 USDC (already sent: [tx](https://basescan.org/tx/0xprev...))
✗ @inactive_user — RESOLVE_FAILED: NO_LINKED_WALLET

Sender balance after: ${remaining} ${TOKEN}
```

Suppress empty sections (no `Skipped:` line if `n_dedup=0`, etc.). Send via `./notify`. Then log (see **Log**) and exit with the send verdict code (`DISTRIBUTE_TOKENS_COMPLETE` / `DISTRIBUTE_TOKENS_PARTIAL` / `DISTRIBUTE_TOKENS_OK` for nothing-to-send).

---

## Phase C — All (plan then send)

Runs Phase A, then feeds it into Phase B in one invocation. `TARGET_WEEK` and `MODE` come from Step 0.

**`all:` execute (`MODE=execute`):**
1. Run **Phase A** in execute mode (A1–A8). It writes `contributors-${TARGET_WEEK}` into `memory/distributions.yml` + state and posts the plan notification (with the A5-note tweak: trailing line becomes `Distributing now (phase=all)…`).
2. If Phase A took a terminal early exit — `CONTRIBUTOR_REWARD_NO_LEADERBOARD`, `_STALE_LEADERBOARD`, `_PARSE_FAIL`, `_NO_ELIGIBLE`, or `_ALREADY_PROCESSED` with zero new entries — **stop**: there is nothing to send. Log and exit with that Phase A code.
3. Otherwise set `LABEL="contributors-${TARGET_WEEK}"`, `MODE=execute`, and run **Phase B** (B1 reads the just-written list from `memory/distributions.yml`; B2–B5 as normal). The send-phase summary is the final notification.

**`all:` dry-run (`MODE=dry-run`):** full end-to-end preview, **no writes, no transfers.**
1. Run **Phase A** in dry-run mode (A1–A5) to compute the plan — but per the A5 note, do **not** notify or exit here; hold the computed plan rows in memory.
2. Enter **Phase B** with an in-memory recipient list built from the plan rows (`handle="@${login}"`, `amount=<tier amount>`) instead of reading `memory/distributions.yml`; set `LABEL="contributors-${TARGET_WEEK}"`, `MODE=dry-run`. Run B2 (preflight — this still calls Bankr `/wallet/me` + `/portfolio`, so `BANKR_API_KEY` is required for this preview; if absent, report `DISTRIBUTE_TOKENS_ERROR — BANKR_API_KEY not configured` for the send preview but keep the rendered plan) and B3 (RESOLVE + print). B3's `MODE=dry-run` branch notifies the combined preview and exits `DISTRIBUTE_TOKENS_DRY_RUN`. No state or yml is written by either phase.

---

## Log

Append to `memory/logs/${today}.md` under **one** heading (the health loop parses this shape). Always use `### distribute-tokens`; the `Phase`/`Mode` discriminator lines say which branch ran.

```
### distribute-tokens
- Phase: plan | send | all
- Mode: execute | dry-run
# --- plan phase (present when Phase A ran) ---
- Plan mode: execute | dry-run | already-processed | no-merged-prs | api-fail | no-eligible
- Week: ${TARGET_WEEK}
- Source: GitHub merged PRs for ${TARGET_WEEK}
- List label: contributors-${TARGET_WEEK}
- Entries written (new): ${N_NEW} | deduped: ${N_DEDUP} | total USDC planned: ${TOTAL_USDC}
- First-PR bonuses: [list or "none"]
# --- send phase (present when Phase B ran) ---
- List: ${LABEL} | Token: ${TOKEN}
- Verdict: ${VERDICT}
- Sent: ${total_sent} ${TOKEN} to ${n_success}/${n_attempted}; deduped: ${n_dedup}; unresolved: ${n_unresolved}
- Failures (if any): @x — REASON, @y — REASON
- State file: memory/state/distributions.json (${total_keys} entries)
- Notification sent: yes/no
```

Omit the block for whichever phase did not run.

## Exit codes (for downstream automation)

**Plan phase (Phase A):**
- `CONTRIBUTOR_REWARD_OK` — plan written, notification sent
- `CONTRIBUTOR_REWARD_DRY_RUN` — plan rendered, no writes, notification sent
- `CONTRIBUTOR_REWARD_ALREADY_PROCESSED` — week already in state with identical plan, silent exit
- `CONTRIBUTOR_REWARD_NO_MERGED_PRS` — no PRs merged in the target week, silent exit
- `CONTRIBUTOR_REWARD_API_FAIL` — GitHub API unreachable (`gh api` + WebFetch both failed), notified
- `CONTRIBUTOR_REWARD_NO_ELIGIBLE` — zero contributors above threshold, silent exit
- `CONTRIBUTOR_REWARD_ERROR` — file I/O or YAML write failure, notified

**Send phase (Phase B):**
- `DISTRIBUTE_TOKENS_OK` — nothing to send (everything deduped or list empty), or bootstrap
- `DISTRIBUTE_TOKENS_COMPLETE` — all READY rows succeeded
- `DISTRIBUTE_TOKENS_PARTIAL` — some succeeded, some failed
- `DISTRIBUTE_TOKENS_DRY_RUN` — dry-run completed, no sends
- `DISTRIBUTE_TOKENS_ERROR` — preflight or config failure, no sends attempted

For `all:`, the terminal exit code is the send phase's code (or the Phase A early-exit code when the plan produced nothing to send).

## Network note

- **Plan phase (A):** ranks contributors via `gh api search/issues` (`gh` handles GitHub auth internally, so no secret ever lands on the command line). If `gh api` fails, fall back to **WebFetch** on the public `https://api.github.com/search/issues?q=…` URL. Also reads/writes `memory/state/contributor-reward-state.json`, `memory/distributions.yml`, `memory/logs/${today}.md`. No postprocess scripts required.
- **Send phase (B):** every Bankr call is auth'd, so make it with `./secretcurl` using the `{BANKR_API_KEY}` placeholder — never a bare `$BANKR_API_KEY` (the Bash permission layer refuses a secret on the command line) and never plain `curl`. `/wallet/transfer` is an irreversible money-movement write; it runs **in-run** as the executor's final action (Phase B4), behind the B2 balance preflight and the per-recipient idempotency in `memory/state/distributions.json` (persisted after every send, so re-runs never double-pay). There is **no** deferred/postprocess step — a failed transfer is recorded (`FAILED` with its reason) and the run continues to the next row. **Never silently drop a transfer.**

## Constraints

**Send (money movement):**
- **Idempotency is non-negotiable.** Always read `memory/state/distributions.json` before sending; always persist after every transfer. Never batch state writes to end-of-run.
- Treat the 24h Bankr rate limit (100/day standard) as a hard cap. Lists >50 recipients should be split.
- Never send if preflight balance is < `total_required * 1.05`.
- Never use the Agent API for transfers (deprecated). Agent API only for handle→address resolution.
- Never abort the RESOLVE phase on a single bad recipient — collect all errors, present them, then let the executor skip.

**Plan (reward computation):**
- **Idempotency is per-(week, login).** Re-runs in the same week add only deltas; demotions never claw back already-paid amounts.
- **First-PR bonus is once-ever per login.** Track in `first_pr_bonus_paid`; never re-award even if the same person appears as ✨ in a later week (which they shouldn't, since ✨ means *first ever* merged PR — but defend against API drift).
- **No silent overwrites of distributions.yml.** If the file exists and is malformed, fail loudly rather than rewriting.
- **Eligibility floor stays low (≥ 1 merged PR) by design.** A single PR merged in the week qualifies — reward shipped work, not volume.

## Future iterations

- Schedule `all:` directly (weekly, after the week closes) for full hands-off payout — the plan computes its own ranking from merged PRs, so no upstream skill or chain wiring is needed.
- Add a Bankr Agent API "wallet-linked?" pre-filter in the plan phase so contributors without linked wallets are flagged in the notification (prevents the send phase from logging RESOLVE_FAILED rows on every run).
- Tier table should become operator-configurable via `memory/contributor-reward-config.yml` once the first month of runs reveals the right curve. Hardcoded for v1.
