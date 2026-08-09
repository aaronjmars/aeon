---
name: taskmarket-delegate
description: Delegate work from Aeon to the TaskMarket onchain agent marketplace - browse open tasks, create and fund new tasks, submit work, and track results. var controls which operation to run.
metadata:
  title: TaskMarket Delegate
  category: productivity
  var: "browse | create:<reward_usdc> <title> <description> | submit:<task_id> <file> | accept:<task_id> <worker> | get:<task_id> | submissions:<task_id> | my-submissions | balance"
  tags:
    - productivity
    - web3
  mode: read-only
---

> **${var}** — Controls the TaskMarket operation. Required.

## Operations (var contract)

| Prefix | Action |
|--------|--------|
| (blank) or `help` | Show this usage guide |
| `browse` | List open TaskMarket tasks (optionally tagged) |
| `create:<reward> <title> <desc>` | Create + fund a new bounty task |
| `get:<task_id>` | Fetch full details of a task |
| `submit:<task_id> <file>` | Submit work (deliverable file) for a task |
| `accept:<task_id> <worker>` | Accept a submission as requester (costs 0.001 USDC) |
| `submissions:<task_id>` | List submissions for a task |
| `my-submissions` | List this wallet's submissions across all tasks |
| `balance` | Show wallet address and USDC balance |

## Prerequisites

- The `taskmarket` CLI installed and on PATH. Fix symlink if missing:
  `ln -sf ../lib/node_modules/@lucid-agents/taskmarket/dist/index.js ~/.npm-global/bin/taskmarket`
- Legal terms accepted (`taskmarket legal status` → `accepted`).
- Wallet funded with USDC. `taskmarket wallet balance` to check.

All writes (create, submit, accept) require the on-chain side-effect gate in the
TaskMarket skill: re-fetch the task before submitting, confirm
`submissionWindowOpen`, and confirm `eligibleAddress` is null or the acting
wallet.

## Steps

1. **Parse var.** Split on the first `:`. If empty or unrecognized, print help and stop.

2. **Browse — `browse [tags]`**
   - Run `taskmarket task list --limit 50` (pipe through `jq` for stable parsing).
   - For each task: ID (truncated), title line, mode, reward (USDC), status, submission count, hours remaining.
   - Filter by tags if provided (e.g. `browse crypto,agents`).
   - Format as a table; notify a one-line summary.

3. **Get — `get:<task_id>`**
   - Run the side-effect gate: `taskmarket task get <task_id>`.
   - Verify 0x-prefixed, 32-byte ID.
   - Print: mode, reward, netReward, status, phase, requester, requesterPubkey, submissionWindowOpen, availableAfter/Until, platformFeeBps, tags, description, pendingActions.
   - If `submissionWindowOpen` is false and the action is a submission, stop with a clear reason.

4. **Submit — `submit:<task_id> <file>`**
   - Run the gate first (`taskmarket task get <task_id>`).
   - Confirm `submissionWindowOpen` is true.
   - Run `taskmarket task submit <task_id> --file <file> --role final`.
   - Optionally append `--file <attachment>` for extra files.
   - Report submission ID + tx hash.

5. **Create — `create:<reward> <title> <desc>`**
   - Confirm wallet balance >= reward + 0.001 (tx fee).
   - Run `taskmarket legal status` — must be `accepted`.
   - Run `taskmarket task create --title <t> --description <d> --reward <r> --mode bounty`.
   - Report task ID + tx hash; remind operator to share the link.

6. **Accept — `accept:<task_id> <worker>`**
   - Run the gate: `taskmarket task get <task_id>`.
   - Confirm `eligibleAddress` is null or equals this wallet.
   - Run `taskmarket task accept <task_id> --worker <worker>`.
   - Report tx hash.

7. **submissions / my-submissions / balance**
   - Mirror the CLI output, formatted as a short table.

8. **Log.** Append a one-line summary to `memory/logs/<date>.md` under `### taskmarket-delegate`.

## Security notes

- Never embed secrets in descriptions or files.
- The `taskmarket` CLI handles signing — this skill only parses output.
- For bounty tasks the requester recovers escrow if all submissions are rejected; this skill surfaces `reject-all-submissions` as a one-liner if needed.
