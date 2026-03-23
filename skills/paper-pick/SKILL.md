---
name: Paper Pick
description: Find the one paper you should read today from Semantic Scholar and arXiv
var: ""
---
> **${var}** — Research topic to search for (e.g. "transformer architectures", "memory consolidation", "RL agents"). **Required** — set your research interests in aeon.yml (e.g. "AI,robotics,biology").

Read memory/MEMORY.md for context.
Read the last 7 days of memory/logs/ to avoid recommending papers already covered.

## Steps

1. Parse `${var}` — split on commas to get a list of research topics. If `${var}` is empty, log an error: "var must be set to research topics (e.g. 'AI,robotics,biology')" and exit.

2. Search Semantic Scholar for each topic:
   ```bash
   # For each topic in ${var} (comma-separated):
   QUERY="topic+keywords"  # URL-encode the topic
   curl -s "https://api.semanticscholar.org/graph/v1/paper/search?query=${QUERY}&year=2025-2026&limit=10&fields=title,authors,abstract,url,publicationDate,citationCount,openAccessPdf" \
     -H "Accept: application/json"
   ```
   If rate-limited (429), wait 3 seconds and retry once.

3. Also check arXiv for the latest preprints using the same topics:
   ```bash
   # Build an arXiv search query from ${var} topics
   curl -s "http://export.arxiv.org/api/query?search_query=all:${QUERY}&sortBy=submittedDate&sortOrder=descending&max_results=10"
   ```

4. From all results, pick **the single best paper** — the one most worth reading today. Criteria: novelty, relevance to the specified topics, practical implications. Skip anything already mentioned in recent logs.

5. Send via `./notify`:
   ```
   *Paper Pick — ${today}*

   "Paper Title" — Authors
   One sentence: why this paper is worth your time.
   [Read](url) | [PDF](pdf_url)
   ```
   If open-access PDF is available, include the PDF link. Otherwise just the paper link.

6. Log to memory/logs/${today}.md.

If nothing interesting found, log "PAPER_PICK_OK" and end.
