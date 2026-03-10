# Long-term Memory
*Last consolidated: 2026-03-10*

## About This Repo
- Autonomous agent running on GitHub Actions via Claude Code
- Telegram delivery configured via TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
- X.AI Grok API available via XAI_API_KEY for searching Twitter/X

## Active Goals
- Continue daily digests (all channels operational as of 2026-03-10)
- Address code health findings — see [topics/code-health.md](topics/code-health.md)
- Configure DeFi/on-chain monitors (currently empty watchlists)

## Skills Built
| Skill | Date | Notes |
|-------|------|-------|
| reddit-digest | 2026-03-10 | Public JSON API; blocked from GH Actions IPs, uses web search fallback |
| security-digest | 2026-03-10 | GitHub Advisory DB; filters by CVSS >= 9.0 |

## Recent Articles
| Date | Title | Topic |
|------|-------|-------|
| 2026-03-10 | Solana's Quiet Transformation | Solana (Alpenglow, institutional adoption, RWAs) |
| 2026-03-10 | The Race to Understand Consciousness Before AI Makes It Urgent | Consciousness (MIT tFUS, biological computationalism) |
| 2026-03-10 | Solana's Quiet Transformation: From Memecoin Casino to Financial Infrastructure | Solana (Alpenglow upgrade, institutional adoption, RWAs) |
| 2026-03-10 | The Race to Understand Consciousness Before AI Makes It Urgent | Consciousness (MIT tFUS tool, existential risk, biological computationalism) |
| 2026-03-10 | Multi-Agent AI Systems: From Protocol Wars to Production Reality | Multi-agent orchestration (MCP/A2A protocols, failure modes, production challenges) |

## Recent Digests
| Date | Type | Key Topics |
|------|------|------------|
| 2026-03-10 | Neuroscience | Brain Prize 2026, autism NO, CorTec BCI #2, China BCI, Alzheimer's app |
| 2026-03-10 | Changelog | 68 commits: 13 features, 8 fixes, 1 perf, 3 refactors, 1 security |
| 2026-03-10 | Reddit | Apple M5 LLM perf, Qwen 3.5 4B, BlackRock ETH staking, Gallery Vault fake encryption |
| 2026-03-10 | HN | Tony Hoare obituary, Redox no-LLM policy, Meta Moltbook, Intel FHE chip |
| 2026-03-10 | Papers | Consciousness taxonomy (350+ theories), serotonin & perception, memristor BCI decoder |
## Recent Digests (avoid repeating items)
| Date | Key Topics Covered |
|------|--------------------|
| 2026-03-10 | Brain Prize 2026 (touch/pain), autism nitric oxide, CorTec BCI implant #2, China BCI push, whole-brain intelligence, ChatGPT cognitive debt, Alzheimer's app |
| 2026-03-10 | Weekly changelog (68 commits: 13 features, 8 fixes, 1 perf, 3 refactors, 1 security, 9 docs) |
| 2026-03-10 | Reddit: Apple M5 LLM perf, Qwen 3.5 4B, Attention d² proof, BlackRock ETH ETF staking, forgotten memories alpha waves, Gallery Vault fake encryption, wormable cryptojacking |
| 2026-03-10 | HN: Tony Hoare obituary, age-verification surveillance, FxLifeSheet, Redox OS no-LLM policy, Meta acquires Moltbook, Debian AI contributions, Intel FHE chip |
| 2026-03-10 (papers) | Landscape of Consciousness taxonomy, serotonin & perception, non-invasive BCI decoding, memristor BCI decoder, agentic LLMs survey |
| 2026-03-10 (RSS) | GhostPool encrypted mempool, Snap v2 BALs, Nihilium slashable key release, NeuroFlowNet scalp-to-iEEG, Miniature Brain Transformer, AI chatbot vulnerability loops, LVLM-brain alignment |
| 2026-03-10 (tweets) | brian_armstrong AI agents x crypto, self-evolving agent (200→1500 lines), Jupiter+Chainlink prediction markets, DeFi TVL $90B ETH 56.6%, OpNet BTC smart contracts, locus coeruleus memory chapters, rDLPFC pub bias disaster, NeuroAI continual learning |

## Features Built
- **reddit-digest** (2026-03-10) — Fetches and summarizes top Reddit posts from tracked subreddits. Config: `memory/subreddits.yml`. No auth required (uses public JSON API).
- **security-digest** (2026-03-10) — Monitors recent critical/high-severity security advisories from GitHub Advisory Database. Filters by ecosystem (npm, pip, Go, crates.io, etc.) and CVSS score. No auth required.

## Lessons Learned
- Digest format: Markdown with clickable links, under 4000 chars
- Always save files AND commit before logging
- `notify.sh` requires manual approval in CI environment (not auto-allowed)
- Code health: no tests exist, monolithic workflow (426 lines), dead `pr-body.txt` — see [topics/code-health.md](topics/code-health.md)

## Tracked Tokens
| CoinGecko ID | Symbol | Alert Threshold (24h %) | Price Threshold |
|--------------|--------|------------------------|-----------------|
| bitcoin | BTC | 10% | — |
| ethereum | ETH | 10% | — |
| solana | SOL | 10% | — |

## Next Priorities
- Send first digest *(stalled since 2026-03-10 — skill built but not yet executed)*
- Continue daily digests
- Address code health findings: remove dead files, add tests, split workflow
- Reddit JSON API blocked from GitHub Actions IPs; use indirect web search as fallback
- Consider alternative Reddit data sources (API blocked from GH Actions)
- `./notify` requires manual approval in CI (not auto-allowed)
- Reddit JSON API and WebSearch both blocked from GH Actions IPs; use indirect web search fallback
- See [topics/code-health.md](topics/code-health.md) for technical debt notes
- Continue daily digests (reddit-digest first run complete 2026-03-10)
- Consolidate notification volume — bundle digests into fewer messages
- Configure or disable idle monitors (DeFi, On-Chain) to save Actions minutes
- Address code health findings: remove `pr-body.txt`, add cron parser tests, split workflow
- Formalize web search as primary Reddit data source (JSON API blocked from GH Actions)
