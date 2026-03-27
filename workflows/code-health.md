# Code Health

Weekly audit of code quality — TODOs, dead code, test gaps, and large files.

## Trigger

Weekly on Friday at 3:00 PM UTC, or manually via workflow dispatch.

## Instructions

You are a code health auditor. Scan the repository for common quality issues and produce an actionable report.

### Steps

1. Scan for TODO/FIXME markers across the codebase:
   ```bash
   grep -rn "TODO\|FIXME\|HACK\|XXX" --include="*.js" --include="*.ts" --include="*.py" --include="*.go" --include="*.rs" --include="*.rb" .
   ```

2. Identify potential dead code:
   - Look for exported functions/classes that are never imported elsewhere.
   - Find commented-out code blocks (3+ consecutive commented lines).
   - Check for unused dependencies in package manifests.

3. Check test coverage:
   - For each source directory, check if a corresponding test file exists.
   - List source files with no test coverage.
   - Note any test files that are empty or only contain skipped tests.

4. Find large files (over 500 lines) that may need splitting:
   ```bash
   find . -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.go" | xargs wc -l | sort -rn | head -20
   ```

5. Scan for hardcoded secrets:
   - Look for patterns like API keys, tokens, passwords in source files.
   - Check for `.env` files committed to the repo.
   - Flag any hardcoded URLs with credentials.

6. Create an issue with the report:
   ```bash
   gh issue create \
     --title "Code Health Report — $(date +%Y-%m-%d)" \
     --label "maintenance" \
     --body "report content"
   ```

### Report format

```markdown
## Code Health Report — YYYY-MM-DD

### TODOs & FIXMEs (N found)
| File | Line | Comment |
|------|------|---------|
| src/foo.ts | 42 | TODO: handle timeout |

### Large Files (>500 lines)
| File | Lines | Suggestion |
|------|-------|------------|
| src/bar.ts | 823 | Split into bar-core.ts and bar-utils.ts |

### Test Gaps
- `src/auth/` — no test files found
- `src/api/routes.ts` — 12 exported functions, 3 tested

### Potential Dead Code
- `utils/legacy.ts` — no imports found anywhere in the project
- `helpers/format.ts:deprecatedFormat()` — zero references

### Security
- No hardcoded secrets found (or list findings)

### Recommendations
1. Priority action items based on findings
```

### Notes

- Do not make any code changes — this is a read-only audit.
- Focus on actionable findings, not style preferences.
- If the codebase is clean, create a short positive report noting what's going well.
- Skip `node_modules/`, `vendor/`, `dist/`, and other build output directories.
