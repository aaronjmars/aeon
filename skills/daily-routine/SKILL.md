---
name: Daily Routine
description: Morning briefing combining token movers, tweet roundup, paper pick, GitHub issues, and HN digest
var: ""
---
> **${var}** — Area to emphasize (e.g. "crypto", "AI", "security"). If empty, covers all areas equally.

Read memory/MEMORY.md for context.
Read the last 2 days of memory/logs/ to avoid repeating items.

Run all five sections below by executing the corresponding skill. If `${var}` is set, pass it through to each skill. Combine the results into a single notification at the end.

---

## 1. Token Movers

Read `skills/token-movers/SKILL.md` and execute its steps. Capture the top 10 winners and losers.

---

## 2. Tweet Roundup

Search X for the latest chatter across topics relevant to your interests. Use the X.AI API if `XAI_API_KEY` is set:

```bash
FROM_DATE=$(date -u -d "yesterday" +%Y-%m-%d 2>/dev/null || date -u -v-1d +%Y-%m-%d)
TO_DATE=$(date -u +%Y-%m-%d)

# Customize these topics to your interests
for TOPIC in "crypto OR bitcoin OR ethereum OR DeFi" "artificial intelligence OR AI agents OR LLM" "programming OR open source OR developer tools"; do
  curl -s -X POST "https://api.x.ai/v1/responses" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $XAI_API_KEY" \
    -d '{
      "model": "grok-4-1-fast",
      "input": [{"role": "user", "content": "Search X for the latest popular tweets about: '"$TOPIC"' from '"$FROM_DATE"' to '"$TO_DATE"'. Return the 3-5 most interesting or viral tweets. For each: @handle, a one-line summary of what they said, and the direct link (https://x.com/username/status/ID). Skip low-engagement noise."}],
      "tools": [{"type": "x_search", "from_date": "'"$FROM_DATE"'", "to_date": "'"$TO_DATE"'"}]
    }'
done
```

If `XAI_API_KEY` is not set, fall back to WebSearch for each topic and summarize the top 3-5 results per topic instead.

For each topic, write 2-3 bullet points capturing the gist. Include links.

---

## 3. Paper Pick

Read `skills/paper-pick/SKILL.md` and execute its steps. Capture the single best paper.

Note: paper-pick requires `var` to be set with research topics. If the daily-routine `${var}` maps to research topics, pass it through. Otherwise, check if paper-pick has a default `var` configured in aeon.yml and use that.

---

## 4. GitHub Issues

Read `skills/github-issues/SKILL.md` and execute its steps. Report any new issues from the last 24 hours.

---

## 5. HN Digest

Read `skills/hn-digest/SKILL.md` and execute its steps. Capture the top 5-7 stories.

---

## Format & Send

Combine everything into a single notification via `./notify` (keep under 4000 chars):

```
*Daily Routine — ${today}*

*Top 10 Winners (24h)*
1. SYMBOL: $price (+X%)
...

*Top 10 Losers (24h)*
1. SYMBOL: $price (-X%)
...

*Tweet Roundup*
*Crypto:* gist of what's happening
*AI:* gist
*Dev:* gist

*Paper of the Day*
"Title" — why you should read it [link]

*GitHub Issues*
- repo: #N title (or "No new issues")

*HN Digest*
1. [Title](url) (Xpts) — summary
   [Discuss](hn_link)
...
```

If the combined message exceeds 4000 chars, trim the HN and tweet sections first — token data and paper pick are highest priority.

## Log

Log everything to memory/logs/${today}.md.
