---
type: Skill
mode: read-only
name: You.com Web Search
category: basics
description: Web search using You.com Search API with high-quality, cited results and optional real-time web crawling
var: ""
tags: [web, search, research]
requires: [YDC_API_KEY?]
---

> **${var}** — Search query or topic. When empty, uses a general search for current notable developments across tracked areas.

Today is ${today}. Perform web search using You.com's Search API to find current, high-quality information on **${var}**.

## Overview

This skill provides web search functionality via You.com's Search API, offering several advantages over basic WebSearch:

- **Higher quality results** with relevance ranking and citation extraction
- **Real-time web crawling** for fresh content when `livecrawl=web` is enabled  
- **Keyless operation** (100 free searches/day per IP) or enhanced features with `YDC_API_KEY`
- **Structured result format** with titles, URLs, snippets, and publication dates
- **Safe fallback** to built-in WebSearch if You.com API is unavailable

## Phase 1 — Execute Search

### Authentication Check

Check if YDC_API_KEY is available:
```bash
[ -n "$YDC_API_KEY" ] && echo "KEY_PRESENT" || echo "KEY_UNSET"
```

### API Call

**Primary path (with or without key):** Direct `curl` to You.com Search API:

```bash
QUERY="${var:-current notable developments in AI, crypto, and technology}"
COUNT="10"

# Build JSON payload
jq -n --arg q "$QUERY" --arg c "$COUNT" '{
  query: $q,
  count: ($c | tonumber),
  safesearch: "strict",
  freshness: "day"
}' > /tmp/youcom-search-payload.json

# Make API call
if [ -n "$YDC_API_KEY" ]; then
  # Authenticated request
  HTTP=$(./secretcurl -s -o /tmp/youcom-search.json -w '%{http_code}' \
    --max-time 30 -X GET \
    "https://api.you.com/v1/agents/search?query=$(echo "$QUERY" | jq -Rr @uri)&count=$COUNT&safesearch=strict&freshness=day" \
    -H "X-API-Key: {YDC_API_KEY}" \
    -H "User-Agent: youdotcom-integration/aeonfun-aeon")
else
  # Keyless request  
  HTTP=$(curl -s -o /tmp/youcom-search.json -w '%{http_code}' \
    --max-time 30 -X GET \
    "https://api.you.com/v1/agents/search?query=$(echo "$QUERY" | jq -Rr @uri)&count=$COUNT&safesearch=strict&freshness=day" \
    -H "User-Agent: youdotcom-integration/aeonfun-aeon")
fi

echo "youcom http=$HTTP bytes=$(wc -c </tmp/youcom-search.json)"
```

### Response Processing

On `HTTP=200` with non-empty body, parse the response:

```bash
if [ "$HTTP" = "200" ] && [ -s /tmp/youcom-search.json ]; then
  # Extract web results
  jq -r '.results.web[]? | "\(.title)|\(.url)|\(.snippet)|\(.date // "recent")"' /tmp/youcom-search.json > /tmp/youcom-results.txt
  
  # Count results
  RESULT_COUNT=$(wc -l < /tmp/youcom-results.txt)
  echo "Extracted $RESULT_COUNT web results"
else
  echo "API call failed: HTTP=$HTTP"
  RESULT_COUNT=0
fi
```

### Fallback Strategy

If You.com API fails or returns no results, fall back to built-in WebSearch:

```bash
if [ "$RESULT_COUNT" -eq 0 ]; then
  echo "Falling back to built-in WebSearch"
  # Use Aeon's built-in WebSearch as fallback
  # This maintains functionality even if You.com API is unavailable
fi
```

## Phase 2 — Format Results  

Process the results into a readable format:

### Result Structure

For each result from You.com API:
- **Title** — article/page title
- **URL** — direct link to source  
- **Snippet** — relevant excerpt highlighting query match
- **Date** — publication date when available

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
- Note authentication mode (keyless/authenticated)
- Include fallback info if WebSearch was used

### Memory Integration  

Log the search for future reference:

1. **Append to daily log** — `memory/logs/${today}.md` under `### you-web-search`:
   ```
   ### you-web-search
   - Query: "${var}"
   - Source: You.com API (keyless|authenticated) / WebSearch fallback
   - Results: N found, M delivered  
   - Status: HTTP ${code}
   - Quality score: X/5 (relevance, freshness, diversity)
   ```

2. **Update search memory** — Add successful searches to `memory/searches.md` for pattern tracking

## Error Handling

### API Failure Recovery

Handle common failure modes gracefully:

- **Rate limits (429)**: Log rate limit hit, suggest API key upgrade if keyless
- **Invalid key (401)**: Clear error about checking YDC_API_KEY variable  
- **Network failures**: Graceful fallback to WebSearch with context
- **Malformed responses**: Validate JSON structure, handle parsing errors
- **Empty results**: Suggest query refinement, try broader terms

### Logging Failures  

Record failure reasons for debugging:
- `youcom-api-unavailable` — API endpoint unreachable
- `youcom-rate-limited` — Hit daily quota (keyless) or plan limits  
- `youcom-auth-invalid` — API key rejected
- `youcom-parse-error` — Response format unexpected
- `websearch-fallback` — Fell back to built-in search (include reason)

## Environment Variables

- **`YDC_API_KEY`** (optional) — You.com API key for authenticated access and higher quotas. When unset, uses keyless endpoint with 100 free searches/day per IP.

## Constraints

- **Never expose credentials** in logs or notifications
- **Always attribute source** — clearly indicate You.com API vs WebSearch fallback  
- **Respect rate limits** — handle 429 responses gracefully
- **Validate all URLs** — ensure results contain real, accessible links
- **Keep results relevant** — filter low-quality or off-topic results
- **Maintain fallback path** — skill must function even if You.com API is unavailable

## Integration Notes  

### Relationship to Built-in WebSearch

This skill **supplements** rather than replaces Aeon's built-in WebSearch:

- **You.com advantages**: Higher quality results, real-time crawling, better relevance ranking  
- **WebSearch advantages**: No API dependency, always available, deeply integrated
- **Use You.com for**: Research tasks, fact-checking, current events, specific queries
- **Use WebSearch for**: Fallback scenarios, broad discovery, when API quotas are exhausted

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