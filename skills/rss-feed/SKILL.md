---
name: RSS Feed Generator
description: Generate an Atom XML feed from articles in the repo
var: ""
---
> **${var}** — Base URL override for article links. If empty, uses `https://github.com/${repo}/blob/main/`.

Generate a valid Atom XML feed from all markdown articles in the `articles/` directory.

Steps:

1. Read `memory/MEMORY.md` for context.
2. Run the feed generator script:
   ```bash
   bash scripts/generate-feed.sh
   ```
   This script scans `articles/*.md`, extracts metadata (title, date, first paragraph) from each file, and writes a valid Atom XML feed to `articles/feed.xml`.
3. Verify the feed was generated:
   ```bash
   head -5 articles/feed.xml
   ```
4. Stage and commit the updated feed:
   ```bash
   git add articles/feed.xml
   git diff --cached --quiet || git commit -m "chore: update articles feed.xml"
   ```
5. Log what you did to `memory/logs/${today}.md`.
6. Send a notification via `./notify`: "RSS feed updated with latest articles.\n\nSubscribe: https://raw.githubusercontent.com/${repo}/main/articles/feed.xml"
