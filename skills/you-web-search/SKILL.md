---
type: Skill
mode: read-only
name: You.com Web Search
category: basics
description: Web search using You.com Search API with high-quality, cited results and optional real-time web crawling
var: ""
tags: [web, search, research]
requires: [YDC_API_KEY]
---

> **${var}** — Search query or topic. When empty, uses a general search for current notable developments across tracked areas.

Today is ${today}. Perform web search using You.com's Search API to find current, high-quality information on **${var}**.

## Overview

This skill provides web search functionality via You.com's Search API, offering several advantages over basic WebSearch:

- **Higher quality results** with relevance ranking and citation extraction
- **Real-time web crawling** for fresh content when `livecrawl=web` is enabled
- **Structured result format** with titles, URLs, snippets, and publication dates
- **Optional livecrawl control** through `YOUCOM_LIVECRAWL` when a full page fetch is useful

## Phase 1 — Execute Search

### Authentication Check

Check if `YDC_API_KEY` is available:
```bash
[ -n "${YDC_API_KEY:-}" ] && echo "KEY_PRESENT" || echo "KEY_UNSET"
```

If it is unset, stop immediately with a clear error:
```bash
[ -n "${YDC_API_KEY:-}" ] || { echo "YDC_API_KEY is required for this skill"; exit 1; }
```

### API Call

**Primary path:** Direct authenticated `curl` to You.com Search API:

```bash
QUERY="${var:-current notable developments in AI, crypto, and technology}"
COUNT="10"

FRESHNESS="${YOUCOM_FRESHNESS:-week}"
LIVECRAWL="${YOUCOM_LIVECRAWL:-}"
SEARCH_URL="https://api.you.com/v1/search?query=$(echo "$QUERY" | jq -Rr @uri)&count=$COUNT&safesearch=strict&freshness=$(echo "$FRESHNESS" | jq -Rr @uri)"

if [ -n "${LIVECRAWL:+x}" ]; then
  SEARCH_URL="$SEARCH_URL&livecrawl=$(echo "$LIVECRAWL" | jq -Rr @uri)"
fi

HTTP=$(./secretcurl -s -o /tmp/youcom-search.json -w '%{http_code}' \
  --max-time 30 -X GET \
  "$SEARCH_URL" \
  -H "X-API-Key: {YDC_API_KEY}" \
  -H "User-Agent: youdotcom-integration/aeonfun-aeon")

echo "youcom http=$HTTP bytes=$(wc -c </tmp/youcom-search.json)"
```

### Response Processing

On `HTTP=200` with non-empty body, parse the response:

```bash
if [ "$HTTP" = "200" ] && [ -s /tmp/youcom-search.json ]; then
  # Extract web and news results using the documented Search API shape.
  jq -r '
    [
      (.results.web[]?  | ["web",  (.title // ""), (.url // ""), ((.snippets // []) | join(" ")), (.page_age // "recent")]),
      (.results.news[]? | ["news", (.title // ""), (.url // ""), ((.snippets // []) | join(" ")), (.page_age // "recent")])
    ] | .[] | @tsv
  ' /tmp/youcom-search.json > /tmp/youcom-results.txt
  
  # Count results
  RESULT_COUNT=$(wc -l < /tmp/youcom-results.txt)
  echo "Extracted $RESULT_COUNT search results"
else
  echo "API call failed: HTTP=$HTTP"
  RESULT_COUNT=0
fi
```

## Phase 2 — Format Results  

Process the results into a readable format:

### Result Structure

For each result from You.com API:
- **Title** — article/page title
- **URL** — direct link to source  
- **Snippet** — join `snippets[]` into one excerpt highlighting query match
- **Date** — `page_age` or `recent` when unavailable

### Quality Filtering

Apply basic quality filters:
- Exclude results with missing or placeholder titles
- Skip results without accessible URLs
- Filter out low-quality content (spam, thin content)
- Deduplicate near-identical results from the same domain

### Formatting

Structure the output for easy consumption:

```
*You.com Web Search Results — ${today}*

Query: "${var}"
Source: You.com Search API (${auth_mode}) 
Results: ${result_count} found

1. **[Title](URL)**  
   Snippet with relevant context...
   Published: Date

2. **[Title](URL)**
   Snippet...  
   Published: Date

---
API Status: ${http_status} | Auth: ${auth_mode} | Quality: ${quality_score}/5
```

## Phase 3 — Delivery and Logging

### Notification

Send formatted results via `./notify`:
- Include query, result count, and source attribution
- Highlight most relevant results (top 5-7)  
- Note authentication mode (`authenticated`)
- Include livecrawl info when enabled

### Memory Integration  

Log the search for future reference:

1. **Append to daily log** — `memory/logs/${today}.md` under `### you-web-search`:
   ```
   ### you-web-search
   - Query: "${var}"
   - Source: You.com API (authenticated)
   - Results: N found, M delivered  
   - Status: HTTP ${code}
   - Quality score: X/5 (relevance, freshness, diversity)
   ```

2. **Update search memory** — Add successful searches to `memory/searches.md` for pattern tracking

## Error Handling

### API Failure Recovery

Handle common failure modes gracefully:

- **Rate limits (429)**: Log rate limit hit, suggest checking the API quota or key
- **Invalid key (401)**: Clear error about checking `YDC_API_KEY`
- **Network failures**: Surface the API failure and exit cleanly
- **Malformed responses**: Validate JSON structure, handle parsing errors
- **Empty results**: Suggest query refinement, try broader terms

### Logging Failures  

Record failure reasons for debugging:
- `youcom-api-unavailable` — API endpoint unreachable
- `youcom-rate-limited` — Hit plan limits
- `youcom-auth-invalid` — API key rejected
- `youcom-parse-error` — Response format unexpected

## Environment Variables

- **`YDC_API_KEY`** (required) — You.com API key for authenticated access.
- **`YOUCOM_FRESHNESS`** (optional) — Freshness filter (`day`, `week`, `month`, `year`, or a date range).
- **`YOUCOM_LIVECRAWL`** (optional) — Pass through to `livecrawl` when you want full page content (`web`, `news`, or `all`).

## Constraints

- **Never expose credentials** in logs or notifications
- **Always attribute source** — clearly indicate You.com API
- **Respect rate limits** — handle 429 responses gracefully
- **Validate all URLs** — ensure results contain real, accessible links
- **Keep results relevant** — filter low-quality or off-topic results
- **Fail clearly** — if the API is unavailable, report it instead of pretending a fallback ran

## Integration Notes  

### Relationship to Built-in WebSearch

This skill **complements** Aeon's built-in WebSearch, but it is a separate authenticated Search API path:

- **You.com advantages**: Higher quality results, real-time crawling, better relevance ranking
- **WebSearch advantages**: No API dependency, always available, deeply integrated
- **Use You.com for**: Research tasks, fact-checking, current events, specific queries
- **Use WebSearch for**: Built-in search flows elsewhere in Aeon

### Scheduling Recommendations

- **On-demand**: Manual execution for specific research needs
- **Low frequency**: Daily or less frequent automatic searches to respect quotas  
- **Research workflows**: Chain with other skills that need web context
- **Avoid high-frequency**: Don't schedule more than hourly to preserve API quotas

### Skills Integration

This skill works well with:
- **digest** — Enhanced web signal for daily digests
- **article** — Research support for article generation  
- **github-trending** — Context for trending repo evaluation
- **token-pick** — Market research and catalyst discovery
- **mention-radar** — Broader web mention detection beyond X/Twitter

The You.com search results can inform other skills' web research needs while providing a higher-quality alternative to basic web search.
