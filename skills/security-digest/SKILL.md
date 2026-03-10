---
name: Security Digest
description: Monitor recent security advisories from the GitHub Advisory Database for tracked ecosystems
---

Read memory/MEMORY.md for tracked topics and interests.
Read the last 2 days of memory/logs/ to avoid repeating advisories.

## Steps

1. **Fetch recent critical and high-severity advisories.** Query the GitHub Advisory Database REST API for advisories published in the last 48 hours:
   ```bash
   # Fetch critical advisories from the last 48h
   SINCE=$(date -u -d '2 days ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-2d '+%Y-%m-%dT%H:%M:%SZ')
   curl -s "https://api.github.com/advisories?type=reviewed&severity=critical&published=${SINCE}.." \
     -H "Accept: application/vnd.github+json" | jq '.[].ghsa_id'

   # Fetch high-severity advisories
   curl -s "https://api.github.com/advisories?type=reviewed&severity=high&published=${SINCE}.." \
     -H "Accept: application/vnd.github+json" | jq '.[].ghsa_id'
   ```
   For each advisory, extract:
   - `ghsa_id` (unique identifier)
   - `cve_id`
   - `summary`
   - `severity` (critical / high)
   - `cvss.score`
   - `vulnerabilities[].package.ecosystem` (npm, pip, Go, crates.io, etc.)
   - `vulnerabilities[].package.name`
   - `vulnerabilities[].vulnerable_version_range`
   - `html_url` (link to advisory)
   - `published_at`

2. **Filter for relevance.** From all fetched advisories:
   - Keep advisories in these ecosystems: `npm`, `pip`, `Go`, `crates.io`, `RubyGems`, `GitHub Actions`
   - Also keep any advisory with CVSS score >= 9.0 regardless of ecosystem
   - Deduplicate against recent logs — skip any GHSA ID already mentioned in the last 2 days of logs
   - Prioritize advisories affecting widely-used packages (look at `vulnerabilities[].package.name`)

3. **Enrich top advisories.** For the top 5-8 most relevant advisories:
   - Use WebFetch on the `html_url` to get more detail on the vulnerability
   - Identify affected versions and whether patches are available
   - Note if the advisory has known exploits or is being actively exploited (check the `description` field)

4. **Format and send via `./notify`** (keep under 4000 chars):
   ```
   *Security Digest — ${today}*

   *CRITICAL*
   - [GHSA-xxxx-xxxx-xxxx](url) — package-name (ecosystem)
     Summary of the vulnerability. CVSS: 9.8
     Affected: versions | Fix: patched version

   *HIGH*
   - [GHSA-yyyy-yyyy-yyyy](url) — package-name (ecosystem)
     Summary of the vulnerability. CVSS: 7.5
     Affected: versions | Fix: patched version
   ```

5. **Log to memory/logs/${today}.md.** Record which GHSA IDs were included and a count summary (e.g. "3 critical, 5 high").

If no relevant advisories are found, log "SECURITY_DIGEST_OK" and end.

## Environment Variables

No environment variables required — uses GitHub's public Advisory Database REST API (no authentication needed).
Rate limits: 60 requests/hour unauthenticated. If `GITHUB_TOKEN` is available in the environment, it will be used automatically by `gh` and `curl` for higher rate limits.
