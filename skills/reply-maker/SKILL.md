---
name: reply-maker
description: Draft copy-paste-ready X replies - two options per reply-worthy tweet from tracked accounts, topics, or lists (default), or ready-to-post responses to engagement opps in recent logs (from-logs)
metadata:
  title: Reply Maker
  category: productivity
  var: "empty = auto-discover reply-worthy tweets and draft two options each; @handle / numeric X list ID / topic = scope the drafting to that; from-logs (or --from-logs [@handle|project]) = turn flagged engagement opps from recent logs into ready-to-post replies"
  commits: false
  tags:
    - social
    - meta
  requires:
    - XAI_API_KEY?
---
<!-- autoresearch: variation B — sharper output via specificity gates, anti-sycophancy lint, post-write self-edit, and skip-gate for low-leverage tweets -->

> **${var}** — selects the mode and scope:
> - **empty** → **Mode A (Reply Drafting):** auto-discover reply-worthy tweets across your areas of interest (from recent logs + memory) and draft two reply options for each.
> - **`@handle` / numeric X list ID / topic** → **Mode A (Reply Drafting)** scoped to that handle, list, or topic.
> - **`from-logs`** (or **`--from-logs`**, optionally followed by an `@handle` or project name to narrow the scan) → **Mode B (From-Logs Engagement):** scan recent logs for flagged engagement opportunities and turn them into copy-paste-ready responses.
> - **`revise:<instruction>`** → **Revise branch:** reload the last drafted replies and refine them per the instruction (the Telegram force-reply shape, e.g. `revise:make them shorter`).

## Preamble (both modes)

Read `memory/MEMORY.md` for context on active projects and open engagement follow-ups.

Then read `memory/logs/` — the window depends on the mode:
- **Mode A:** the last 2 days of `memory/logs/` for recent `list-digest`, `tweet-roundup`, and prior `reply-maker` outputs (used as a candidate pool and for reply de-duplication).
- **Mode B:** the last 7 days of `memory/logs/` for engagement opportunities flagged by other skills (`project-pulse`, `refresh-x`, `reply-maker`, `channel-recap`) or noted in MEMORY.md "Known Follow-ups".

**Parse `${var}` to pick the branch** (trim whitespace, compare case-insensitively):
- If `${var}` starts with `revise:` — run the **Revise branch** (below) and stop. This is the shape `scripts/telegram-route.sh` sends when the operator replies to a "refine these replies?" force-reply prompt; catch it before mode parsing.
- If `${var}` is `from-logs` or `--from-logs` — optionally followed by a whitespace-separated `@handle` or project name — run **Mode B (From-Logs Engagement)**. Treat any trailing token as an optional filter that narrows the opportunity scan to that handle/project.
- Otherwise run **Mode A (Reply Drafting)**, treating `${var}` as the scope: empty, `@handle`, numeric X list ID, or a topic string.

## Voice

If soul files exist (`soul/SOUL.md`, `soul/STYLE.md`, `soul/examples/`), read them and **mirror that voice in every reply**. Match sentence length, vocabulary choices, punctuation habits, and the kinds of things the operator would never say.

If no soul files exist (or the bodies are empty placeholders), write replies that are:
- Direct and substantive — no fluff, no sycophancy
- Under 280 characters each (X replies; DMs and GitHub comments may run longer — see Mode B)
- Opinionated but grounded in specifics
- The kind of reply that adds to the conversation, not noise

Either way, when responding to someone who cosigned/mentioned/attributed the operator (Mode B): **acknowledge without groveling** — no "thanks so much for the kind words!", just the actual response.

---

# Revise branch (`revise:…` — Telegram force-reply)

The operator tapped the "refine these replies?" prompt and sent a free-text revision instruction. Handle it before Mode A/B:

1. **Strip the prefix.** The instruction is `${var#revise:}` (keep any inner colons). Trim whitespace — e.g. `make them shorter`, `less formal`, `drop reply B on #2`.
2. **Load the last draft.** Read `memory/drafts/reply-maker-latest.md` — the stable path every normal run saves to (see the save steps in A4 / B6). If it's missing or empty, there's nothing to refine: send `./notify "Nothing to revise yet — run reply-maker first, then reply here to refine the drafts."` and **end the run**.
3. **Apply the instruction.** Read `soul/` for voice, then regenerate the saved replies applying the operator's instruction. Keep the same set of target tweets and the same **A/B two-option** structure (Mode A) or ready-to-post list (Mode B) — you're refining wording, not re-discovering candidates. Re-enforce the hard reply rules: ≤280 chars for X replies, no sycophancy (see **Banned sycophancy phrases**), specifics not gestures.
4. **Re-save** the revised drafts to `memory/drafts/reply-maker-latest.md` (overwrite), so a further `revise:` refines the newest version.
5. **Re-send** via `./notify` in the same format the originating mode uses, with a first line flagging it as a revision, e.g. `revised (${var#revise:}):`. Use `./notify -f <file>` for multi-line output.
6. **Re-offer** a further revision (the operator is actively iterating, so this is expected, not a nag — skip the daily dedup guard here):
   ```bash
   ./notify "Want another pass? Reply with a change and I'll revise again." \
     --force-reply --placeholder "e.g. make them shorter" \
     --context "reply-maker::revise"
   ```
7. **Log** under `### reply-maker` with `- **Mode:** revise` and the instruction (see **Log**), then **end the run** — do NOT run Mode A or B.

---

# Mode A — Reply Drafting

Generate **two reply options** for **5 reply-worthy tweets** from tracked X accounts, a list, or a topic.

### A1. Gather candidate tweets

Goal: assemble **10–15 candidates** posted in the **last 6 hours** (the high-leverage reply window — the algorithm rewards early replies, and the OP is still likely to engage back). **Recency fallback:** if the 6h window yields fewer than 3 candidates after the skip gate, widen to **12h** and retry before failing the run.

For every candidate, capture: `@handle`, full tweet text, tweet URL, `posted_at` (ISO), engagement counts (likes, replies, retweets if available), and a one-line **why-this-tweet** note.

**Path A — X.AI API (primary).** `XAI_API_KEY` is injected into this skill's environment (declared in `requires:`), so the direct `curl` to `https://api.x.ai/v1/responses` is the primary fetch path (full contract in **Fetching** at the bottom). Preflight the key, then call Grok's `x_search`, capturing the HTTP status so any fallback decision is fact-based. `x_search` searches X live and takes 30–120s — **set the Bash tool `timeout` to ≥180000 when you run this** (a slow curl is not a missing key).

```bash
[ -n "$XAI_API_KEY" ] && echo KEY_PRESENT || echo KEY_UNSET
TO_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
FROM_DATE=$(date -u -d "6 hours ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-6H +%Y-%m-%dT%H:%M:%SZ)
```

If `KEY_PRESENT` (it will be), Path A is required. Build the payload **file** `/tmp/xai-rm-payload.json` per `${var}` (three shapes below — each branch writes the same fixed file), then:

```bash
HTTP=$(./secretcurl -s -o /tmp/xai-rm.json -w '%{http_code}' --max-time 150 -X POST "https://api.x.ai/v1/responses" \
  -H "Content-Type: application/json" -H "Authorization: Bearer {XAI_API_KEY}" -d @/tmp/xai-rm-payload.json)
echo "xai http=$HTTP bytes=$(wc -c </tmp/xai-rm.json)"
```

On `HTTP=200` with a non-empty body, parse `/tmp/xai-rm.json` and mark `xai=ok`:
```bash
jq -r '.output[] | select(.type == "message") | .content[] | select(.type == "output_text") | .text' /tmp/xai-rm.json
```

**The payload file `/tmp/xai-rm-payload.json` depends on `${var}`.** Whichever branch matches, build it with `jq -n --arg` (never a shell-interpolated string) and write it to that one fixed path — the `./secretcurl` call above then sends it with `-d @/tmp/xai-rm-payload.json`:

**If `${var}` looks like an X list ID** (numeric):
```bash
LIST_ID="${var}"
jq -n --arg list_id "$LIST_ID" --arg from "$FROM_DATE" --arg to "$TO_DATE" '{
  model: "grok-4.6",
  input: [{role: "user", content: ("Look at X list https://x.com/i/lists/" + $list_id + ". Return the 12 most reply-worthy original posts (not retweets, not replies) by members of this list between " + $from + " and " + $to + ". Reply-worthy = has a take, claim, question, or framing worth engaging — NOT pure self-promo, breaking news without analysis, or threads already past 500 replies. For each: @handle, full tweet text, tweet URL, posted_at ISO timestamp, like/reply/retweet counts.")}],
  tools: [{type: "x_search", from_date: $from, to_date: $to}]
}' > /tmp/xai-rm-payload.json
```

**If `${var}` looks like a `@handle`** — same query intent, scoped to that handle's recent original posts:
```bash
HANDLE="${var}"
jq -n --arg handle "$HANDLE" --arg from "$FROM_DATE" --arg to "$TO_DATE" '{
  model: "grok-4.6",
  input: [{role: "user", content: ("Look at recent original posts (not retweets, not replies) by " + $handle + " on X between " + $from + " and " + $to + ". Return the 12 most reply-worthy. Reply-worthy = has a take, claim, question, or framing worth engaging — NOT pure self-promo, breaking news without analysis, or threads already past 500 replies. For each: @handle, full tweet text, tweet URL, posted_at ISO timestamp, like/reply/retweet counts.")}],
  tools: [{type: "x_search", from_date: $from, to_date: $to}]
}' > /tmp/xai-rm-payload.json
```

**If `${var}` is a topic** (or empty) — same query intent with `${var}` (or the top 2–3 topics from `memory/MEMORY.md` when empty) as the search query. When empty, also pull tweet candidates surfaced in the last 2 days of `tweet-roundup` and `list-digest` logs as a backup pool.
```bash
TOPIC="${var}"   # when empty, substitute the top 2–3 topics from memory/MEMORY.md
jq -n --arg topic "$TOPIC" --arg from "$FROM_DATE" --arg to "$TO_DATE" '{
  model: "grok-4.6",
  input: [{role: "user", content: ("Search X for the 12 most reply-worthy original posts (not retweets, not replies) about " + $topic + " between " + $from + " and " + $to + ". Reply-worthy = has a take, claim, question, or framing worth engaging — NOT pure self-promo, breaking news without analysis, or threads already past 500 replies. For each: @handle, full tweet text, tweet URL, posted_at ISO timestamp, like/reply/retweet counts.")}],
  tools: [{type: "x_search", from_date: $from, to_date: $to}]
}' > /tmp/xai-rm-payload.json
```

**Path B — memory logs + WebSearch (last-resort fallback only).** Reach here **only** on a real Path A failure, and record the **true reason** — `key-unset` | `http-<code>` | `empty` | `timeout` — never "XAI_API_KEY unavailable" when the key was set. Use in order until you have ≥3 candidates:
1. Recent `list-digest` + `tweet-roundup` outputs in `memory/logs/` — already have URLs and handles.
2. WebSearch for very recent posts on memory topics (filter: posted within last 6h, original post not reply). Lower quality — WebSearch favours older high-engagement tweets, so prioritise results dated within the last 6h.

### A2. Filter and select 5 tweets

Apply the **skip gate** first. **Discard** any candidate that is:
- Pure self-promo (launching a product, "buy my course", subscribe links)
- Breaking-news repost without an angle of its own
- A thread already past ~500 replies (your reply will not be seen)
- Older than 6 hours (reply window has closed; don't waste a reply slot)
- A handle/URL already replied to in the last 7 days of reply-maker logs (no duplicates)

From the survivors, **rank by leverage** = `recency × take-strength × room-to-add`:
- **Recency**: minutes-ago > hours-ago. Tweets <60min old are top priority.
- **Take-strength**: a clear claim/question/framing you can either reinforce with evidence or challenge with a flipped premise.
- **Room-to-add**: not already swarmed; thread isn't full of stronger replies; you have actual context to contribute.
- Bias toward authors whose audience overlaps your interests (from `memory/MEMORY.md`) — replies on those accounts get seen by people who care about the same things.

Pick the **top 5**. If fewer than 5 survive the gate, output what you have and add `REPLY_MAKER_DEGRADED` to the notification subject line.

### A3. Generate two replies per tweet

For each of the 5 selected tweets, draft **two reply options** with distinct angles:

**Option A — "Evidence add"**
- Builds on their point with a **specific** datum, named project, named person, concrete number, link, or counterexample they didn't include
- Tone: collaborative, substantive, calmly confident
- Must contain at least one named entity, number, or specific reference — vague "great insight, here's another angle" is banned

**Option B — "Frame challenge"**
- States the premise you're pushing back on **explicitly** (one short clause), then offers the contrarian angle, flipped framing, or sharper read
- Tone: direct, opinionated, not contrarian-for-its-own-sake
- Must contain the actual disagreement, not a hedge — vague "interesting, but have you considered..." is banned

#### Hard reply rules (apply to both A and B)

- **≤ 280 characters** including any handle prefix
- **No sycophancy** — see the `## Banned sycophancy phrases` section below. Any draft containing a banned phrase must be rewritten.
- **No hedging stacks** — "It could be argued that…", "Just my two cents but…", "Maybe I'm wrong but…" — pick a position
- **Specifics, not gestures** — names, projects, numbers, links. If you can't cite one, don't write the reply
- **Stand alone** — readers may not see the original tweet; reply must make sense on its own
- **Match soul voice** if soul files are populated

#### Self-edit pass (do this for every reply before finalizing)

For each draft reply, score 1–5 on each:
- **Specific**: cites a name/number/project/claim?
- **Standalone**: makes sense without reading the parent?
- **Non-sycophantic**: passes the banned-phrase list?
- **Voice-matched**: sounds like the soul files (or neutral-direct if no soul)?

If any score is < 4, **rewrite that reply once** before moving on. If the rewrite still scores < 4, drop that tweet from the list and pull the next-ranked candidate from step A2.

### A4. Notify

Send via `./notify` with this format (link first so the operator can open the source quickly):

```
*Reply Maker — ${today}*

*1.* https://x.com/handle/status/123  (@handle, 42m ago, 18💬)
> [first ~80 chars of tweet]…
why: [one-line reason this is reply-worthy]
A: [evidence-add reply]
B: [frame-challenge reply]

*2.* …
… (5 total, or fewer with REPLY_MAKER_DEGRADED if skip gate trimmed below 5)

source-status: xai=ok|fail|skip, memory=N, websearch=ok|fail|skip
```

If zero candidates survive the skip gate from any source, send a single `REPLY_MAKER_EMPTY — [one-line reason]` notification and stop.

Otherwise, after notifying, **save the drafts and offer a revision** (see *Save drafts + offer revision*).

### A5. Log

Append to `memory/logs/${today}.md` under the shared `### reply-maker` heading (see **Log** below), using the **Mode A** template.

---

# Mode B — From-Logs Engagement

Turn flagged engagement opportunities from recent logs into ready-to-post replies — read the last 7 days of logs, draft specific responses, send as copy-paste-ready output. **This mode makes no outbound API calls** — no X.AI curl, no WebSearch — it works purely from local `memory/` files.

**Projects-of-interest list:** if `memory/topics/projects-of-interest.md` exists, treat the project names listed there as the things to watch for mentions, cosigns, attributions, and fork moments. If the file is missing or empty, fall back to any project names that appear in recent logs or in MEMORY.md. If a filter token was passed (`from-logs @handle` or `from-logs <project>`), narrow the scan to opportunities involving that handle/project.

### B1. Collect unactioned engagement opportunities

Read `memory/logs/` for the last 7 days. Look for:
- Log entries flagging engagement opps (e.g. "Engagement opps: N flagged" with N > 0) — extract the named handles/accounts
- Any person who cosigned, mentioned, or attributed one of the operator's projects-of-interest
- GitHub attribution or fork moments not yet acknowledged
- Entries in MEMORY.md "Known Follow-ups" explicitly flagging engagement opps
- Cosigns or mentions surfaced in `refresh-x`, `reply-maker`, or `channel-recap` runs

Build a list: `{ person/account, context, what_they_did, link_if_known, days_ago }`

### B2. Filter and prioritize

Apply these rules:
- Drop any opp older than 14 days — window is likely closed
- De-dupe: skip opps where recent logs already show "replied to @X" or "acknowledged" for that handle
- Rank by: recency (fresher first) × leverage (high-follower or influential account first)
- Cap at 5 opportunities

### B3. Draft ready-to-post responses

For each opportunity:
- **Type**: X reply / X DM / GitHub comment / X post
- **Target**: @handle or URL
- **Draft text**: exact text, ready to copy-paste
- Keep under 280 chars for X replies; longer is fine for DMs or GitHub comments
- Voice: if `soul/SOUL.md` and `soul/STYLE.md` are populated, match that voice; otherwise use a clear, direct, neutral tone. Either way: acknowledge without groveling, no "thanks so much for the kind words!" — just the actual response.

### B4. Check for staleness

If any opportunity is 5+ days old, prepend `aging` to that entry in the output.

### B5. Skip if empty

If after filtering there are zero unactioned opps, log `ENGAGEMENT_ACT_SKIP: no unactioned opps` (under the `### reply-maker` heading) and exit **without sending a notification**.

### B6. Write output to a temp file, then send via `./notify -f`

```
*Reply Maker (from-logs) — ${today}*

*1. @handle* (N days ago) — [one-line summary of what they did]
link: [URL or "no link found"]
type: [X reply / X post / DM / GitHub comment]
draft: "[ready-to-post text]"

*2. @handle* ...

[if any opps are 5+ days old:]
some opps aging — act or drop
```

Write this to `/tmp/reply-maker-from-logs.md` then run `./notify -f /tmp/reply-maker-from-logs.md`.

After notifying, **save the drafts and offer a revision** (see *Save drafts + offer revision*).

### B7. Log

Append to `memory/logs/${today}.md` under the shared `### reply-maker` heading (see **Log** below), using the **Mode B** template.

---

## Save drafts + offer revision (both modes)

After a normal run (Mode A or B) has drafted and notified replies, do two things so the operator can refine them from Telegram. **Skip both** when the run sent nothing (`REPLY_MAKER_EMPTY`, or Mode B's `ENGAGEMENT_ACT_SKIP`).

1. **Persist the drafts** to a stable path a later `revise:` run can reload:
   ```bash
   mkdir -p memory/drafts
   ```
   Write the full draft body you just sent — all selected tweets with their A/B options (Mode A), or the ready-to-post list (Mode B) — to `memory/drafts/reply-maker-latest.md`, overwriting any previous file. Only the newest draft is revisable.
2. **Offer a revision** — a **separate** `./notify` (force_reply can't share a message with inline buttons):
   ```bash
   ./notify "Want to refine these replies? Reply with a change and I'll revise them." \
     --force-reply --placeholder "e.g. make them shorter" \
     --context "reply-maker::revise"
   ```
   The reply routes back as `var="revise:<instruction>"` and re-dispatches this skill into the **Revise branch**.

   **Dedup — once per produced draft.** Before offering, scan the last ~2 days of `memory/logs/` for a `FORCE_REPLY_OFFERED: revise` line dated `${today}`; if present, skip the offer. When you send it, append the marker under the run's `### reply-maker` entry:
   ```
   - FORCE_REPLY_OFFERED: revise
   ```

## Banned sycophancy phrases

Edit this list as tastes change — any draft reply (either mode) containing one of these (openings or closings) must be rewritten:

- Openings: "Great point", "Love this", "100%", "This 👆", "Couldn't agree more", "So well said", "💯"
- Closings: "Curious to hear your thoughts!" (engagement-hook noise)

## Log

Append one entry to `memory/logs/${today}.md` under a single `### reply-maker` heading, with a `**Mode:**` discriminator line naming which branch ran.

**Mode A (reply drafting):**
```
### reply-maker
- **Mode:** A (reply drafting)
- **Var:** ${var:-<empty>}
- **Candidates collected:** N
- **Survived skip gate:** N
- **Replies generated:** N×2
- **Handles:** @h1, @h2, …
- **Source status:** xai=ok|fail|skip, memory=N, websearch=ok|fail|skip
- **Notification:** sent | degraded | empty
- **Tweet URLs:** [list, for future-day dedup]
```
The `Tweet URLs` line is what tomorrow's run reads to avoid duplicate replies — keep it consistent.

**Mode B (from-logs engagement):**
```
### reply-maker
- **Mode:** B (from-logs engagement)
- **Opps found:** N unactioned (scanned last 7 days of logs)
- **Drafted:** N responses
- **Handles:** @handle1, @handle2, …
- **Notification sent:** yes
- ENGAGEMENT_ACT_OK
```
If skipped: `ENGAGEMENT_ACT_SKIP: <reason>` (still under `### reply-maker`).

**Revise (Telegram force-reply):**
```
### reply-maker
- **Mode:** revise
- **Instruction:** [the operator's revision instruction]
- **Base draft:** memory/drafts/reply-maker-latest.md (reloaded + re-saved)  (or: none — nothing to revise)
- **Notification:** sent
```

## Fetching

`XAI_API_KEY` is **injected into this skill's environment** (declared in `requires:`). It is present and valid. **Mode A's primary fetch path is a direct `curl` to `https://api.x.ai/v1/responses` with `Authorization: Bearer {XAI_API_KEY}`.** There is no network sandbox blocking this; earlier versions of this skill claimed there was — that is stale and wrong. Just make the call.

**You MUST attempt the direct curl before any fallback.** The rules:

1. **Check, don't assume.** Run `[ -n "$XAI_API_KEY" ] && echo KEY_PRESENT || echo KEY_UNSET`. If `KEY_PRESENT` (it will be), you are required to try Path A.
2. **Allow enough time.** The `x_search` call typically takes 30–120s (it searches X live). When you invoke the Bash tool for the curl, **set the tool's `timeout` to at least 180000 (180s)**, and add **`--max-time 150`** to the curl itself so it fails cleanly rather than hanging. A curl that is slow is **not** a missing key — do not treat a timeout as "key unavailable".
3. **Capture the HTTP status** so the fallback decision is based on fact, not assumption. Build the payload to the fixed file `/tmp/xai-rm-payload.json` first (see the three `jq -n --arg` shapes in A1), then send it with `-d @/tmp/xai-rm-payload.json`:
   ```bash
   HTTP=$(./secretcurl -s -o /tmp/xai-rm.json -w '%{http_code}' --max-time 150 -X POST "https://api.x.ai/v1/responses" \
     -H "Content-Type: application/json" -H "Authorization: Bearer {XAI_API_KEY}" -d @/tmp/xai-rm-payload.json)
   echo "xai http=$HTTP bytes=$(wc -c </tmp/xai-rm.json)"
   ```
   Then parse `/tmp/xai-rm.json` with the standard `jq` extractor. `HTTP=200` with a non-empty body → use it (`xai=ok`).
4. **Fall back only on a real failure**, and **record the true reason** — never write "XAI_API_KEY unavailable" when the key was set. Use one of: `key-unset` (only if step 1 said `KEY_UNSET`), `http-<code>` (non-2xx), `empty` (200 but no tweets parsed), `timeout` (curl exceeded `--max-time`).

**WebSearch and the memory-log candidate pool are last-resort fallbacks only** — lower quality (WebSearch favours old high-engagement tweets). Never reach for them while the key works. **Mode B** is fetch-free by design: it reads only local `memory/` files, so it makes no curl and no API call; `./notify -f` still handles delivery via `.pending-notify/` if needed.

## Environment Variables Required

- `XAI_API_KEY` — X.AI API key for Grok's `x_search` tool. Declared in `requires:`, so it is **injected into this skill's environment** and is **Mode A's primary fetch path**. If it is ever unset, Mode A degrades to the memory-log pool + WebSearch at lower quality. **Mode B requires no environment variables** and uses only local memory files and `./notify`.
