---
name: memory-flush
description: Promote important recent log entries into MEMORY.md and prune stale ones
metadata:
  title: Memory Flush
  category: core
  var: ""
  tags:
    - meta
---
> **${var}** — Topic to focus on. If empty, flushes all recent activity.

If `${var}` is set, only promote entries related to that topic. Pruning (step 3) and the timestamp/index/rotation upkeep (steps 4, 7) still run globally — a focused flush must never leave the rest of the store stale.

Read `memory/MEMORY.md` for current memory state.

**Scan window — read logs since the last consolidation, not a fixed 3 days.** Look at the `*Last consolidated: <date>*` line near the top of `MEMORY.md`:
- A real date → read every `memory/logs/` file dated *on or after* that date (re-reading the last consolidated day is fine; the dedup check in step 2 makes it idempotent).
- `never`, missing, or unparseable → read the last 3 days.
- A gap longer than 14 days (agent was dark) → read the last 14 days only and note the gap in your step 6 log. Older un-promoted entries are unrecoverable; don't pretend otherwise.

This closes two holes in the old fixed 3-day window: entries older than 3 days were lost whenever the agent skipped runs, and a daily schedule re-scanned the same 3 days every time.

## Steps

### 1. Scan the in-window logs for entries worth promoting to long-term memory

- New lessons learned (errors encountered, workarounds found)
- Topics covered (articles, digests) — add to the recent output/articles/digests tables
- Features built or tools created
- Important findings from monitors (on-chain, GitHub, papers)
- Ideas captured that are still relevant
- Goals completed or progress milestones

### 2. Check each candidate against existing MEMORY.md content — dedup precisely

Skip if already recorded. Dedup by the fact's **subject**, not by string match:
- Identify what each candidate is *about* (a skill, a token, a repo, a lesson, a priority).
- If MEMORY.md already carries that subject, **edit the existing line in place** (merge the new detail, bump any date). Never append a second bullet that paraphrases an existing one — that near-duplicate drift is what a memory flush exists to prevent.
- Only add a new bullet when the subject is genuinely absent.

### 3. Remove stale entries — this is as important as adding new ones

a. **Open Improvement PRs section**: Run `gh pr list --state open --search "improve:" --json number,title,url` and compare against any "Open Improvement PRs" section in MEMORY.md.
   - If all listed PRs are now merged/closed, remove the section entirely.
   - If some PRs are merged, update the list to reflect only current open ones.
b. **Next Priorities section**: Cross-check each listed priority against recent logs and current repo state. Remove priorities that are already done (e.g., "Merge open PRs" if 0 open PRs exist). Add any newly urgent priorities surfaced by recent logs.
c. **Lessons Learned**: Remove lessons that are now outdated or resolved (e.g., a workaround for a bug that was later fixed).
d. **Overflow any section that outgrows its budget** (keeps MEMORY.md an index, not a ledger): if a section has grown past the last ~10–15 rows — the Skills Built table is the usual first offender, but the rule is general — archive the oldest rows to `memory/topics/<section>-history.md` (e.g. `skills-history.md`) and leave a one-line pointer to that file. Trim newest-kept, oldest-archived.

### 4. Update memory

- Add brief entries to MEMORY.md (keep it under ~50 lines as an index).
- If a topic needs more detail, write to `memory/topics/<topic>.md` instead (see step 7 — register it in the index).
- Update tables (recent articles, recent digests) with new rows.
- Before adding a section, check whether its `## Heading` already exists anywhere in MEMORY.md — if it does, update that section in place. Never prepend a duplicate heading.
- **Stamp the consolidation date.** Update the `*Last consolidated: <date>*` line near the top to today's date (`${today}`). If the line is missing, add it directly under the title. This drives the step-scan window above and is how other skills (e.g. `action-converter`) tell a live, consolidated store from an untouched template — leaving it at `never` after a real flush is a bug.

### 5. Make targeted edits only

Do NOT rewrite the whole file — make targeted additions and removals.

### 6. Register any new topic files in the index

If step 4 created a new `memory/topics/<topic>.md` (or a `*-history.md` archive in step 3d), add a one-line pointer to it under the `# Reference` section of `memory/topics/index.md`, matching the existing row format. New topic notes that aren't linked from the index become orphans no other run can find.

### 7. Rotate the log journal so `memory/logs/` stays bounded

`memory/logs/` is append-only and grows one file per day forever. Once its durable content has been promoted, roll old dailies up so the directory doesn't grow without limit — **content-preserving, never a bare delete** (`rm` isn't granted; use `git rm`):
- Only act when there are more than ~45 daily files.
- Pick whole calendar months that are entirely **older than the current 14-day scan window** (so nothing still in scope is touched). For each such month, append its dailies in date order into `memory/logs/archive/YYYY-MM.md` (create the dir if needed), then `git rm` the dailies you just rolled up.
- The archive preserves every line — this respects the append-only contract while bounding the file count. Never touch a log inside the scan window, and never edit a daily's existing content.

### 8. Log to `memory/logs/${today}.md`

Log what you promoted, pruned, archived, and the scan window you used (start date → today). If a >14-day gap was clamped, say so.

If nothing worth promoting or removing and no rotation was due, log `MEMORY_FLUSH_OK` and end (still stamp the `Last consolidated` date in step 4 — a clean flush is still a consolidation).

## Network note

`gh pr list` uses the `gh` CLI's built-in auth — no curl env-var expansion. All other work is local file I/O against `memory/` (plus `git rm` for log rotation).

## Constraints

- Keep MEMORY.md an index (~50 lines). Detail lives in `memory/topics/`.
- Never duplicate an existing `## Heading` or an existing fact — update in place.
- Pruning stale entries is as important as adding new ones.
- **This skill owns MEMORY.md consolidation.** Other skills (e.g. `self-improve`) may *flag* memory-hygiene problems, but structural pruning and archiving of MEMORY.md should land here to avoid two skills thrashing the same file. If `self-improve` prunes in an audit, treat it as a stopgap, not a reason to skip the next flush.
