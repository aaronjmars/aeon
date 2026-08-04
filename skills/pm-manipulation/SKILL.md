---
name: pm-manipulation
description: Detect suspected manipulation on prediction markets over the past 3 days by cross-referencing price/volume/comment anomalies with multilingual local-press coverage
metadata:
  title: PM Manipulation
  category: crypto
  tags:
    - crypto
    - research
    - security
---

Read `memory/MEMORY.md` for context.
Read the last 3 days of `memory/logs/` to avoid re-flagging markets you already covered, and to compare current readings against prior ones.

## Voice

If `soul/SOUL.md` and `soul/STYLE.md` are populated, match the operator's voice in the notification and write-up. If empty or absent, use a clear, direct, neutral tone. The methodology itself is the same either way.

## Why this skill exists

English-language coverage of any prediction market is dense for US politics, sparse for everything else. Election-, geopolitics-, and conflict-related markets are most often pushed by actors closer to the home country than to the English-speaking financial press. By the time a coordinated narrative lands in mainstream financial outlets, the trade is over. Local-language press, regional outlets, and country-specific Telegram / X channels move first — sometimes by 24–72h.

This skill looks at the **past 3 days** of activity on a configurable prediction-market platform and asks: where does the price action diverge from organic English-press coverage, and does a multilingual sweep reveal a narrative push that explains it?

## Configuration

Read `memory/topics/prediction-markets.md` if it exists for an optional `## Platform` line naming the target API root. Defaults to Polymarket's public Gamma + CLOB APIs (`gamma-api.polymarket.com`, `clob.polymarket.com`, `data-api.polymarket.com`). The candidate selection, scoring rubric, and multilingual sweep are platform-agnostic; only the endpoints differ.

The keyword filter and locale table below are starting points — the operator can edit `memory/topics/prediction-markets.md` to add `## Keywords` and `## Locales` sections that override the defaults.

## Network note

`curl` works — there is no network sandbox. For every curl call, if it fails or returns empty, use **WebFetch** as a fallback for a flaky public GET. The Polymarket APIs above are public (no auth). For news searches, prefer **WebSearch** with locale-specific queries — a built-in Claude tool that needs no curl.

## Steps

### 1. Build the candidate set (markets active in past 3 days)

Pull the most-active markets across the categories most prone to manipulation: politics, geopolitics, conflict, elections (national and regional), regulatory rulings, and resolution-disputed markets.

```bash
# Top markets by 24h volume — repeat for last 3 days using volume24hr / volume1wk fields
curl -s "https://gamma-api.polymarket.com/markets?closed=false&order=volume24hr&ascending=false&limit=30"

# Also fetch by 7d volume to catch slower-burn manipulation
curl -s "https://gamma-api.polymarket.com/markets?closed=false&order=volume1wk&ascending=false&limit=30"
```

From the union of those two lists, pick **6–10 candidates** that meet at least one of:
- Question references a non-US country, region, or conflict
- Question references a regulatory body, election, or coup/conflict event
- 7d volume > $500k AND 24h volume > $50k (real money, not just liquidity-mining)
- Slug contains keywords (default set; operator can override in `memory/topics/prediction-markets.md`): `russia`, `iran`, `israel`, `china`, `taiwan`, `ukraine`, `venezuela`, `argentina`, `mexico`, `brazil`, `india`, `pakistan`, `nigeria`, `france`, `germany`, `italy`, `spain`, `eu-`, `nato`, `cartel`, `coup`, `nuclear`, `assassination`, `ceasefire`, `election`, `vote`, `referendum`, `oracle`, `dispute`, `umip`

Skip anything sports, weather, or pure crypto-price (BTC > $X by Y) — those have different manipulation signatures and aren't this skill's job.

### 2. Pull 3-day price + trade data per candidate

For each candidate market, get the YES-token (`clobTokenIds[0]`) and pull 3-day price history at hourly fidelity:

```bash
curl -s "https://clob.polymarket.com/prices-history?market=$TOKEN_ID&interval=1w&fidelity=60"
```

Compute, from the past 72h window only:
- **3d open / close / high / low** (price 0.0–1.0)
- **Largest single-hour move** (absolute pp change)
- **Move concentration** — what % of the 3d net move happened in the single largest 6h block? If > 70%, flag `concentrated-move`.
- **Volume spike ratio** — (peak hour volume) / (median hour volume). If > 8x, flag `volume-spike`.
- **Direction inversion** — did price reverse > 5pp within the 72h window? Flag `reversal` — common when a manipulator unwinds.

Also pull the trades feed if available (some markets only) for whale concentration:
```bash
curl -s "https://data-api.polymarket.com/trades?market=$TOKEN_ID&limit=500"
```
Compute **whale share** — % of 3d volume from the top-3 wallet addresses. If > 40%, flag `whale-concentrated`.

If the trades endpoint doesn't return per-market data, skip whale-share for that candidate — note it in the report rather than failing.

### 3. Pull comments and detect coordination patterns

For each candidate, fetch comments from the past 3 days:

```bash
# Get the event id first (comments live on Event, not Market)
curl -s "https://gamma-api.polymarket.com/events?slug=$EVENT_SLUG&limit=1"

# Top comments by reactions
curl -s "https://gamma-api.polymarket.com/comments?parent_entity_type=Event&parent_entity_id=$EVENT_ID&limit=50&order=reactionCount&ascending=false"

# Most recent
curl -s "https://gamma-api.polymarket.com/comments?parent_entity_type=Event&parent_entity_id=$EVENT_ID&limit=50&order=createdAt&ascending=false"
```

Filter to comments from the last 72h (`createdAt` within window). Then look for:
- **Burst posting** — > 10 comments from accounts with usernames matching the same regex pattern (e.g. `user\d{4,}`, common spam-bot signature) within a 6h window. Flag `bot-burst`.
- **Narrative concentration** — > 40% of top-reacted comments push the same one-sided talking point with near-identical phrasing. Flag `narrative-push`.
- **Cross-market spam** — same usernames repeating identical text across multiple unrelated markets (compare against any logged comments from prior `pm-manipulation` runs). Flag `cross-market-spam`.

Apply a `reactionCount > 1` pre-filter before counting "real" reactions, but **do** count low-reaction comments toward bot-burst and narrative-concentration signals — that's exactly where the spam shows up.

### 4. Multilingual press sweep — the actual differentiator

For each candidate that hit any anomaly flag in steps 2 or 3, run a localized press sweep targeting the country/region most relevant to the question. The goal is to find coverage that explains (or **doesn't** explain) the price action, in the language of the place where the news would actually break first.

Pick 2–3 languages per market based on the topic. Suggested locale targets:

| Topic / region | Languages | Press domains (use as `site:` filters) |
|---|---|---|
| Russia / Ukraine | ru, uk | `site:rbc.ru`, `site:tass.com`, `site:meduza.io`, `site:pravda.com.ua`, `site:kyivindependent.com` |
| Iran / Middle East | ar, fa, he | `site:aljazeera.net`, `site:alarabiya.net`, `site:irna.ir`, `site:ynet.co.il`, `site:haaretz.co.il` |
| China / Taiwan / HK | zh-cn, zh-tw | `site:scmp.com`, `site:caixin.com`, `site:ltn.com.tw`, `site:cna.com.tw`, `site:rfa.org` |
| Latin America | es, pt | `site:elpais.com`, `site:eltiempo.com`, `site:clarin.com`, `site:folha.uol.com.br`, `site:estadao.com.br`, `site:eluniversal.com.mx` |
| Europe | fr, de, it, es | `site:lemonde.fr`, `site:lefigaro.fr`, `site:spiegel.de`, `site:zeit.de`, `site:repubblica.it`, `site:elmundo.es` |
| India / Pakistan | hi, ur, en-IN | `site:thehindu.com`, `site:timesofindia.indiatimes.com`, `site:dawn.com`, `site:tribune.com.pk` |
| Africa | en-ZA, fr, ar | `site:dailymaverick.co.za`, `site:premiumtimesng.com`, `site:nation.africa`, `site:jeuneafrique.com` |

For each market × language pair:
```
WebSearch: <market keywords in target language> <site filters from table> [past 7 days]
```

Translate keywords into the target language before searching. If you're not confident in a translation, ask via WebFetch a translation tool URL or skip that language with a note.

Also check **non-press** signals where coverage tends to break first:
- Telegram channels (use WebSearch `t.me/<channel>`-style queries, plus general queries like `"<topic in language>" telegram`)
- Local-language X/Twitter via WebSearch `"<topic in language>" twitter.com`
- Country-specific Reddit (`site:reddit.com/r/<country>`)

For each candidate market record:
- **Local-press timeline** — when did the first regional-language story drop? Was it before, during, or after the price move?
- **Narrative direction** — does local press support the price move's direction, contradict it, or stay silent?
- **Coverage asymmetry** — is the story dominant in one language and absent in English? That's the strongest manipulation tell — local actors trading their information advantage.

### 5. Score each candidate (0–5 manipulation suspicion)

Sum the flags. Each is worth 1 point:
- `concentrated-move` (>70% of 3d move in 6h)
- `volume-spike` (peak/median > 8x)
- `whale-concentrated` (top-3 wallets > 40% volume)
- `bot-burst` OR `narrative-push` OR `cross-market-spam` (any one of these — comments only count once)
- `reversal` (>5pp price reversal within 72h)
- **Coverage asymmetry** — local press strongly supports OR contradicts the move while English press is silent (worth 1 point; if asymmetry is *strong* AND timing matches the price move within ±12h, worth 2 points and cap the total at 5)

Classify:
- **0–1 — clean.** No write-up, just log the slug and stop.
- **2 — watch.** Brief note in the report, no notification.
- **3 — suspicious.** Full write-up + notification.
- **4–5 — high-confidence manipulation pattern.** Full write-up + urgent notification, file an issue under `memory/issues/` with severity `medium`, category `unknown`, detected_by `pm-manipulation`.

Be honest about uncertainty. "Suspicious" is not "proof". The skill's value is putting a watchlist in front of a human, not adjudicating fraud.

### 6. Format the briefing

Build the body in a temp file (multi-line content; never argv-pipe long strings):

```bash
TEMP=$(mktemp -t pm-manipulation.XXXXXX.md)
cat > "$TEMP" <<'MSG'
PM Manipulation Watch — ${today} (past 3d)

scanned: N markets · flagged: M · suspicious: K · high-conf: J

--- SUSPICIOUS / HIGH-CONFIDENCE ---

1. "[market question]"  — score X/5
   slug: <event-slug>
   3d: $opens → $closes ($change pp), peak vol $X
   flags: <comma-separated flag names>
   local press: <one-line summary of what foreign-language coverage said and when>
   asymmetry: <english-silent | english-contradicts | english-confirms | n/a>
   take: <one-sentence opinion — coordinated push? insider? unclear?>

2. ...

--- WATCH (score 2) ---
- "[question]" — <one-line note>

--- CLEAN (scanned but no flags) ---
N markets, no anomalies above threshold.

read it: output/articles/pm-manipulation-${today}.md
MSG
```

Keep the notification under 3500 chars. If it exceeds, drop the CLEAN section and the WATCH bullets first; never truncate the SUSPICIOUS section mid-entry.

### 7. Save the full report

Write the unabridged report to `output/articles/pm-manipulation-${today}.md`:

```markdown
# PM Manipulation Watch — ${today}

**Window:** past 3 days · **Scanned:** N markets · **Suspicious (≥3):** K · **High-confidence (≥4):** J

## Methodology
3-day price/volume/comment scan + multilingual press sweep. Each candidate scored 0–5 across 6 anomaly classes. See `skills/pm-manipulation/SKILL.md` for the full scoring rubric.

## Suspicious Markets

### 1. [Market question] — score X/5
- **Slug:** <event-slug>
- **3d action:** $open → $close (change pp), peak hour vol $X, whale share Y%
- **Flags triggered:** <list>
- **Comments:** <coordinated patterns observed>
- **Local press:**
  - <language>: <outlet> — <one-line summary, date, link>
  - <language>: <outlet> — ...
- **English press:** <outlet — date — link, or "silent">
- **Asymmetry:** <english-silent | english-contradicts | english-confirms | n/a>
- **Take:** <2–3 sentences>

[repeat per suspicious market]

## Watchlist (score 2)
- ...

## Clean
[brief table: market, 3d change, why scanned]
```

Cite every source with a URL. No untranslated quotes longer than ~10 words — render the original AND a short English gloss.

### 8. Notify

```bash
./notify -f "$TEMP"
```

If status is **high-confidence (≥4)**, prepend `[URGENT] ` to the notification subject so it surfaces in chat.

### 9. Log

Append to `memory/logs/${today}.md`:
```
### pm-manipulation
- **Scanned:** N markets (past 3d)
- **Suspicious (≥3):** K
- **High-confidence (≥4):** J
- **Top flag:** "[market]" — score X/5
- **Languages searched:** <list>
- **Issues filed:** [ISS-NNN list or "none"]
- **Notification sent:** yes / no
- PM_MANIPULATION_OK
```

## Guidelines

- **Past 3 days only.** Older windows belong to one-off audits. Recency matters — manipulation is a near-term phenomenon, and stale signal turns this skill into noise.
- **Multilingual is the differentiator.** A pure English scan is just a worse `monitor-polymarket`. The signal lives in coverage gaps between languages.
- **No accusations.** Use words like "suspected", "consistent with", "anomalous", "asymmetric coverage". Never name actors as manipulators without direct evidence.
- **Translate inline.** When quoting non-English press, give the original phrase + English gloss. Never paraphrase a foreign source as if it were English.
- **No double-counting.** If a market was flagged in the last 3 days of `pm-manipulation` logs and the situation hasn't escalated, mention it as "ongoing" rather than re-running the full write-up.
- **Quiet weeks are useful.** "Scanned 8 markets, all clean" is a valid output — flagging this skill as silent has signal of its own.

## Environment Variables Required

- None — uses public Polymarket APIs + WebSearch/WebFetch
- Notification channels configured via repo secrets (see CLAUDE.md)
