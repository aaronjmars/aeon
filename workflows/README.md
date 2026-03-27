# Aeon Workflow Templates

Standalone Markdown workflow templates that work with [GitHub Agentic Workflows](https://github.blog/changelog/2026-02-13-github-agentic-workflows-are-now-in-technical-preview/).

Each template wraps one of Aeon's battle-tested skills as a portable `.md` workflow that any repo can use — no need to fork or install the full Aeon agent.

## Available templates

| Template | What it does | Suggested trigger |
|----------|-------------|-------------------|
| [issue-triage.md](issue-triage.md) | Labels and prioritizes new issues automatically | On issue opened |
| [pr-review.md](pr-review.md) | Reviews PR diffs for bugs, security issues, and quality | On PR opened/updated |
| [changelog.md](changelog.md) | Generates a categorized changelog from recent commits | Weekly (Monday 9am UTC) |
| [security-digest.md](security-digest.md) | Monitors GitHub Advisory DB for relevant vulnerabilities | Daily (8am UTC) |
| [code-health.md](code-health.md) | Audits TODOs, dead code, test gaps, and large files | Weekly (Friday 3pm UTC) |

## Usage

1. Copy any `.md` file into your repo's `.github/workflows/` directory:
   ```bash
   # Example: add PR review to your repo
   curl -O https://raw.githubusercontent.com/aaronjmars/aeon/main/workflows/pr-review.md
   mv pr-review.md .github/workflows/
   ```

2. Commit and push. GitHub Agentic Workflows picks up `.md` files in `.github/workflows/` automatically.

3. The workflow runs with whatever agent engine you have configured (Claude Code, Copilot CLI, Codex, etc.).

## Customization

Each template is plain Markdown — edit it like you'd edit any document. Common customizations:

- **Change triggers** — edit the `## Trigger` section to match your schedule or events
- **Adjust criteria** — modify the classification rules, review criteria, or scan patterns
- **Add project context** — add a section describing your project's conventions so the agent follows them

## From Aeon skills

These templates are adapted from Aeon's internal skills. The full skills include memory integration, multi-repo support, notification channels, and dashboard rendering. If you want the full experience, [set up Aeon](../README.md#quick-start) instead.
