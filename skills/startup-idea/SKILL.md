---
name: Startup Idea
description: 2 startup ideas tailored to the user's skills, interests, and context
var: ""
---
> **${var}** — Constraint or theme (e.g. "solo founder", "crypto infra", "B2B SaaS", "under $10k to launch"). If empty, generates freely.

Read memory/MEMORY.md for current goals and recent thinking.
Read the last 7 days of memory/logs/ for recent research, articles, and signals.
If soul files exist (`soul/SOUL.md`), read them for identity, expertise, and worldview.

## Steps

1. Build the founder profile from available context:
   - What domains does the user have expertise in? (from memory, soul, and recent logs)
   - What projects are they currently working on?
   - What topics have they been researching or tracking?
   - What's their professional background?
   - If none of this is available, generate broadly applicable ideas based on `${var}` or current tech trends

2. Gather fresh signals:
   - Use WebSearch to find 3-5 emerging trends, unmet needs, or market gaps relevant to the user's domains
   - Cross-reference with recent logs — what topics, papers, or market movements have been notable this week?
   - If `${var}` is set, constrain the search to that theme

3. Generate **2 startup ideas**. Each should:
   - Play to the user's actual strengths and knowledge (not generic "AI for X" slop)
   - Have a plausible path to revenue or traction
   - Be differentiated from obvious competitors
   - One should be more ambitious (bigger swing), one more executable (could launch in weeks)

4. For each idea, provide:
   - **Name** — a working title
   - **One-liner** — what it does in one sentence
   - **Thesis** — why this matters now, what shift makes it possible (2-3 sentences)
   - **How it works** — the core mechanic or product loop (3-4 sentences)
   - **Why you** — what about the user's specific background makes them the right builder (1-2 sentences)
   - **First move** — the smallest thing to build/test to validate the idea (1 sentence)
   - **Risk** — the biggest reason this fails (1 sentence, be honest)

5. Send via `./notify` (under 4000 chars):
   ```
   *Startup Ideas — ${today}*

   *1. [Name]* — [one-liner]
   Thesis: [why now]
   How: [core mechanic]
   Why you: [fit]
   First move: [MVP action]
   Risk: [honest downside]

   *2. [Name]* — [one-liner]
   Thesis: [why now]
   How: [core mechanic]
   Why you: [fit]
   First move: [MVP action]
   Risk: [honest downside]
   ```

6. Log to memory/logs/${today}.md:
   ```
   ## Startup Idea
   - **Idea 1:** [name] — [one-liner]
   - **Idea 2:** [name] — [one-liner]
   - **Constraint:** [var or "none"]
   - **Notification sent:** yes
   ```
