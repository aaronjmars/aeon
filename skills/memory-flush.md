---
name: Memory Flush
description: Promote important recent log entries into MEMORY.md
---

Read memory/MEMORY.md for current memory state.
Read the last 3 days of memory/logs/ for recent activity.

Steps:
1. Scan recent logs for entries worth promoting to long-term memory:
   - New lessons learned (errors encountered, workarounds found)
   - Topics covered (articles, digests) — add to the recent articles/digests tables
   - Features built or tools created
   - Important findings from monitors (on-chain, GitHub, papers)
   - Ideas captured that are still relevant
   - Goals completed or progress milestones
2. Check each candidate against existing MEMORY.md content — skip if already recorded.
3. Update memory:
   - Add brief entries to MEMORY.md (keep it under ~50 lines as an index)
   - If a topic needs more detail, write to `memory/topics/<topic>.md` instead
   - Update tables (recent articles, recent digests) with new rows
4. Do NOT rewrite the whole file — make targeted additions and removals.
5. Log what you promoted to memory/logs/${today}.md.
If nothing worth promoting, log "MEMORY_FLUSH_OK" and end.
