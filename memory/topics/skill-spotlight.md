---
title: Skill Spotlight — Rotation State
description: Queue, coverage history, and blocklist config for the skill-spotlight rotation.
tags: [meta, config]
timestamp: 2026-07-03T00:00:00Z
---

# Skill Spotlight — Rotation State

Queue + history for `skills/skill-spotlight/`. The picker reads top-down, skips anything covered in the last 30 days or in the blocklist.

Edit freely — this file is operator-owned config, not auto-managed except for `## Covered (last 30 days)`, which the skill appends to and prunes each run.

## Queue

Ordered list of skills to feature next. The picker takes the first one not in `Covered (last 30 days)` and not in `Blocklist`. Append new entries at the bottom; the head moves down naturally as each is covered.

The starter pack below targets *observable* skills with clear single-purpose output — the format works best when the "Result ⤵️" screenshot is something a reader can grok in one glance. Edit to taste.

- priority-brief
- paper-pick
- repo-pulse
- reply-maker
- hn-digest
- self-improve
- narrative-tracker
- paper-digest
- shiplog
- fork-digest
- tweet-roundup

## Covered (last 30 days)

The skill appends here after each successful run. Entries older than 30 days are pruned automatically.

(empty)

## Blocklist

Never feature these — they are meta/internal/repair skills that don't read as user-facing features. Add or remove entries to taste.

- skill-spotlight
- skill-health
- skill-evals
- skill-graph
- skill-repair
- skill-freshness
- skill-analytics
- skill-leaderboard
- skill-scan
- skill-update
- heartbeat
- onboard
- fleet-control
- fleet-state
- fork-fleet
- fork-cohort
- fork-release
- contributor-leaderboard
- contributor-reward
- contributor-spotlight
- operator-scorecard
- spawn-instance
- auto-merge
- auto-workflow
- distribute-tokens
- workflow-audit
- v4-readiness
- update-gallery
- search-skill
- syndicate-article
- pr-review
- pr-triage
- skill-triage
- pr-tracker
- pr-merge
- issue-triage
- reg-monitor
- security-digest
- vuln-scanner
- vuln-tracker
- disclosure-tracker
- pvr-watchlist
- pvr-triage
- last30
- rss-feed
- rss-digest
- batch-health
- frequency-guard
- config-validator
- janitor
- memory-flush
- memory-dedupe
- self-review
- signal-verdict
- skill-enabler
- show-hn
- product-hunt
- create-campaign
- schedule-ads
- onchain-monitor
- price-alert
- monitor-runners
- monitor-kalshi
- polymarket-comments
- market-context
- unlock-monitor
- list-digest
- refresh-x
- fetch-tweets
- remix-tweets
- write-tweet
- repo-scanner
- repo-actions
- project-lens
- external-feature
- technical-explainer
- deploy-prototype
- autoresearch
- cost-report
- vercel-projects
- feature
- rug-scan
- investigation-report
- fund-flow
- linked-wallets
- lp-lock
- honeypot-check
- approval-audit
- contract-audit
- wallet-profile
- deployer-trace
- tx-explain
- holder-concentration

## Notes

- The starter queue is intentionally short (~12 skills). Extend it as the framework grows or as you discover skills that screenshot well.
- If the format ever drifts (a new post doesn't visually match the prior days), check the SKILL.md anti-patterns section — the cadence is the brand.
