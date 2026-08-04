# Changelog — Week of 2026-03-19

## aeonfun/aeon

### Features
- Add local dashboard for managing skills, secrets, and runs — Next.js app with visual schedule picker, secret management, skill toggling, and workflow triggers (9b12614)
- Dashboard UX improvements — toast notifications, secrets UI, file/folder upload, local timezone support (3a46943)
- Add authenticate button to dashboard — runs `claude setup-token` and saves OAuth token as GitHub secret (b596846)
- Add aeon launcher script (`./aeon`) for starting the dashboard (bd7dbd6)
- Add `add-skill` command for importing skills from GitHub repos with `--list`, `--all`, `--branch` support (c56488b)
- Descriptive run names, auto-refresh runs, loading animation, and skill vars system (3c2c47c)
- Inline run log viewer in dashboard — view Claude run output without leaving the page (4001b1b)
- Add GH_GLOBAL secret for cross-repo access in skills like github-monitor and pr-review (3340e4f)
- Add delete skill button to dashboard with confirmation dialog (5fcfd8f)
- Standardize all 32 skills to single `var` variable and add model selector dropdown (9d73123)
- Support `.skill` file format in Add Skill upload (14af19f)
- Pass selected model to workflow when triggering runs from dashboard (ad7bd71)

### Fixes
- Upgrade actions to v5/node22, fix auth token parsing, bump Next.js to 16.1.7 (security fix) (2cbd5ea)
- Handle line-wrapped tokens from `claude setup-token` (0d568d8)
- Save OAuth tokens as CLAUDE_CODE_OAUTH_TOKEN, not ANTHROPIC_API_KEY (2fd317a)
- Poll runs after triggering a skill for faster UI feedback (680d2a1)
- Refresh secrets list after successful authentication (630ea50)
- Authenticate tries auto-setup first, falls back to paste modal (ef9dc9b)
- Auth flow — extract token properly, add API key paste modal (a6b6160)
- Show skill name in runs list instead of workflow name (020acce)
- Pipe prompts via stdin to avoid ByteString Unicode errors (7097c1f)
- Grey run button when unauthenticated, reorder secrets, always show push button (affac11)
- Dashboard UI polish — button colors, timezone label, vars placeholder, skill keys (a68c53e)
- Simplify skill upload — remove GitHub tab, fix path handling (20f7e8d)
- Update tsconfig.json to match Next.js 16 defaults (821f466)
- Switch messages to dispatch model for parallel execution (2688782)
- Poll for messages on cron schedule events (4d22929)
- Process all pending messages, one run per message via matrix strategy (73c9a41)
- Improve sync error handling: separate commit vs push failures (e3add27)

### Docs
- Update README: document var system, model selector, quickstart, and notification setup (eea7eae)
- Add soul.md integration guide to README (4236c60)
- Expand README with Heartbeat and Design Philosophy sections, fix Node.js 24 deprecation (523baf9)
- Clarify authentication options in README (0c3ef51)
- Improve README clarity, formatting, and layout (a4c1f62, 93811b1, 0720389)

### Chores
- Improve run log viewer: extract notify output and style GitHub link (7209e4e)
- Cap skill description width in dashboard (9001dd5)
- Add Telegram screenshot (9dc8212)
- Rename Upload button to Add Skill (a9d6fc7)
- Suppress punycode deprecation warning in workflow runs and dev server (7f9ebb8, ce47dde)
- Log model name before Claude runs (293c910)
- Update var placeholder and quickstart wording (f5c8742, 9a67042)
- Add images to README and center demo gif (bd1a795)
