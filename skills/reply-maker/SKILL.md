---
name: Reply Maker
description: Generate two reply options for 5 tweets from tracked X accounts or topics
var: ""
---
> **${var}** — Focus on a specific topic, @handle, or X list ID. If empty, searches for reply-worthy tweets across your areas of interest using recent logs and memory.

Read memory/MEMORY.md for context.
Read the last 2 days of memory/logs/ for recent list-digest and tweet-roundup outputs — use these as a starting pool of tweets.

## Voice

If soul files exist (`soul/SOUL.md`, `soul/STYLE.md`, `soul/examples/`), read them and match the owner's voice.

If no soul files exist, write replies that are:
- Direct and substantive — no fluff or sycophancy
- Under 280 characters each
- Opinionated but grounded in specifics
- The kind of reply that adds to the conversation, not noise

## Steps

1. Get fresh tweets to reply to. Strategy depends on what's available:

   **If `${var}` contains an X list ID** (numeric string):
   ```bash
   FROM_DATE=$(date -u -d "yesterday" +%Y-%m-%d 2>/dev/null || date -u -v-1d +%Y-%m-%d)
   TO_DATE=$(date -u +%Y-%m-%d)
   LIST_ID="${var}"

   curl -s -X POST "https://api.x.ai/v1/responses" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $XAI_API_KEY" \
     -d '{
       "model": "grok-4-1-fast",
       "input": [{"role": "user", "content": "Look at X list https://x.com/i/lists/'"$LIST_ID"'. Find the most interesting and reply-worthy tweets posted by members of this list from '"$FROM_DATE"' to '"$TO_DATE"'. I want tweets that invite conversation — hot takes, questions, claims worth engaging with. Return the top 10 tweets. For each: @handle, the full tweet text, engagement stats, and the direct link."}],
       "tools": [{"type": "x_search", "from_date": "'"$FROM_DATE"'", "to_date": "'"$TO_DATE"'"}]
     }'
   ```

   **If `${var}` contains a @handle**:
   Search for recent tweets by that account using the same API pattern.

   **If `${var}` contains a topic** (or is empty):
   Use recent tweet-roundup and list-digest outputs from memory/logs/ as the tweet pool. If those don't exist, search X for tweets on the topic (or on topics from memory/MEMORY.md).

   If `XAI_API_KEY` is not set, fall back to WebSearch for recent tweets on the topic.

2. Select the **5 most reply-worthy tweets**. Prioritize:
   - Tweets with a take you can build on, challenge, or add signal to
   - Tweets from accounts where a reply would be visible (not shouting into the void)
   - Tweets on topics covered in memory (where you have context to add value)
   - If `${var}` is set, filter to tweets matching that topic or handle

3. For each of the 5 tweets, generate **2 reply options**:

   **Option A** — the "add signal" reply:
   - Builds on their point with a specific insight, data point, or connection they missed
   - Or shares a relevant observation
   - Tone: collaborative, substantive

   **Option B** — the "sharp take" reply:
   - Challenges their framing, flips the premise, or offers a contrarian angle
   - Or a punchy one-liner that reframes the conversation
   - Tone: direct, opinionated

   ### Reply rules
   - Under 280 characters each
   - No sycophancy — never "great point!" or "love this" as a lead-in
   - No hedging — state the position directly
   - Reference specifics — names, projects, numbers — not vague gestures
   - Each reply must stand alone (reader might not see original context)

4. Send via `./notify`:
   ```
   Reply Maker — ${today}

   1. @handle — [first ~60 chars of their tweet]...
   link: [tweet URL]
   A: [reply option a]
   B: [reply option b]

   2. @handle — [first ~60 chars]...
   link: [tweet URL]
   A: [reply option a]
   B: [reply option b]

   ... (5 total)
   ```

5. Log to memory/logs/${today}.md:
   ```
   ## Reply Maker
   - **Tweets selected:** 5
   - **Replies generated:** 10 (2 per tweet)
   - **Handles:** @handle1, @handle2, @handle3, @handle4, @handle5
   - **Notification sent:** yes
   ```

## Environment Variables Required
- `XAI_API_KEY` — X.AI API key for Grok x_search (optional — falls back to WebSearch)
