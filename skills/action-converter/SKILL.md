---
name: Action Converter
description: 5 concrete real-life actions for today based on recent signals and memory
var: ""
---
> **${var}** — Focus area (e.g. "health", "networking", "learning", "shipping"). If empty, covers all areas.

Read memory/MEMORY.md for current goals, priorities, and tracked items.
Read the last 7 days of memory/logs/ for recent activity, patterns, and what's been happening.
If soul files exist (`soul/SOUL.md`), read them for identity and focus areas.

## Steps

1. Build context on the current state:
   - What has been worked on this week? (from logs)
   - What are the stated priorities? (from MEMORY.md)
   - What topics and projects are being tracked?
   - If `${var}` is set, weight actions toward that area

2. Generate **5 specific, actionable things** to do TODAY. Not vague advice — real actions with clear outcomes. Each action should:
   - Be completable in a single day (most in under 2 hours)
   - Have a concrete deliverable or outcome
   - Connect to something already being worked on or tracked
   - Be the kind of thing that compounds over time

3. Mix the categories:
   - **Build** — something to ship, write, or create
   - **Connect** — a specific person to reach out to, a community to engage with, a conversation to start
   - **Learn** — a paper to read, a protocol to study, a concept to explore that's relevant to current work
   - **Health/Energy** — something physical or mental that makes the rest work better
   - **Wild card** — something unexpected, creative, or lateral that could open a new door

4. For each action, include:
   - The action itself (one sentence, imperative)
   - Why now (one sentence — what makes this relevant today, based on recent context)
   - Expected outcome (one sentence — what's different after you do this)

5. Send via `./notify`:
   ```
   *5 Actions — ${today}*

   1. [action]
      why: [context]
      outcome: [result]

   2. [action]
      why: [context]
      outcome: [result]

   ... (5 total)
   ```

6. Log to memory/logs/${today}.md:
   ```
   ## Action Converter
   - **Actions generated:** 5
   - **Focus:** [area or "general"]
   - **Notification sent:** yes
   ```
