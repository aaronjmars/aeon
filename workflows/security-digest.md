# Security Digest

Monitor recent security advisories and alert on critical vulnerabilities.

## Trigger

Daily at 8:00 AM UTC, or manually via workflow dispatch.

## Instructions

You are a security monitoring agent. Check the GitHub Advisory Database for recent critical and high-severity vulnerabilities relevant to this project's dependencies.

### Steps

1. Identify this project's ecosystems by reading package files:
   - `package.json` or `package-lock.json` → npm
   - `requirements.txt` or `pyproject.toml` → pip
   - `go.mod` → Go
   - `Cargo.toml` → crates.io
   - `Gemfile` → RubyGems

2. Fetch recent critical and high-severity advisories from the last 48 hours:
   ```bash
   SINCE=$(date -u -d '2 days ago' '+%Y-%m-%dT%H:%M:%SZ')
   curl -s "https://api.github.com/advisories?type=reviewed&severity=critical&published=${SINCE}.." \
     -H "Accept: application/vnd.github+json"
   curl -s "https://api.github.com/advisories?type=reviewed&severity=high&published=${SINCE}.." \
     -H "Accept: application/vnd.github+json"
   ```

3. Filter for relevance:
   - Keep advisories matching this project's ecosystems (from step 1).
   - Keep any advisory with CVSS score >= 9.0 regardless of ecosystem.
   - Check if any advisory directly affects a package listed in this project's dependencies.

4. For each relevant advisory, extract:
   - GHSA ID and CVE ID
   - Affected package name and versions
   - Severity and CVSS score
   - Whether a patch is available
   - Link to the advisory

5. Create an issue if critical advisories are found that affect this project's direct dependencies:
   ```bash
   gh issue create \
     --title "Security Alert: [N] advisories found — $(date +%Y-%m-%d)" \
     --label "security" \
     --body "advisory details"
   ```

### Output format

```markdown
## Security Digest — YYYY-MM-DD

### Critical
- **GHSA-xxxx** — package-name (ecosystem) — CVSS 9.8
  Summary. Affected: <1.2.3 | Fix: upgrade to 1.2.4
  [Advisory link](url)

### High
- **GHSA-yyyy** — package-name (ecosystem) — CVSS 7.5
  Summary. Affected: >=2.0.0 <2.1.1 | Fix: upgrade to 2.1.1
  [Advisory link](url)

### Action items
- [ ] Upgrade package-name to 1.2.4
- [ ] Review package-name usage for exposure to CVE-xxxx
```

### Notes

- If no relevant advisories are found, do nothing — no issue, no noise.
- Focus on actionable advisories — skip withdrawn or disputed ones.
- If a critical advisory affects a direct dependency, that's high priority. If it only affects a transitive dependency, note it but lower the urgency.
