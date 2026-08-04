---
name: monitor-polymarket
description: Monitor Polymarket and/or Kalshi prediction markets for 24h price moves, volume changes, fresh comments, and high-conviction alerts
metadata:
  title: Monitor Prediction Markets
  mode: read-only
  category: crypto
  var: ""
  tags:
    - crypto
    - research
---
> **${var}** — Platform selector with an optional single-market override:
> - **empty** (`""`) — run **both** platforms from their watchlists.
> - `polymarket` — run Polymarket's whole watchlist (`skills/monitor-polymarket/watchlist-polymarket.md`).
> - `kalshi` — run Kalshi's whole watchlist (`skills/monitor-polymarket/watchlist-kalshi.md`).
> - `polymarket:<event-slug>` — one ad-hoc Polymarket event (e.g. `polymarket:us-x-iran-ceasefire-by`).
> - `kalshi:<event-ticker>` — one ad-hoc Kalshi event (e.g. `kalshi:KXGDP-26Q2`).

Read `memory/MEMORY.md` for context.
Read the last 2 days of `memory/logs/` to compare against previous readings and flag *new* movers (not repeats of yesterday's news).

## Why this skill exists

A table of prices isn't useful. An operator reading this notification wants to answer: **"is there a market worth forming a view on right now, and why?"** Every rule below exists to push output toward that question — suppress noise, rank by decision value, and demand one line of reasoning per alert. This skill covers two venues — **Polymarket** (crypto-native, CLOB + comments) and **Kalshi** (regulated, liquidity-weighted signals) — and dispatches to the branch(es) the selector asks for.

## Dispatch

Parse `${var}` into a platform choice and an optional single-market override, then run the matching branch(es).

```bash
PLATFORM="both"   # both | polymarket | kalshi
SINGLE=""         # optional single event slug (Polymarket) or ticker (Kalshi)

case "${var}" in
  "")            PLATFORM="both" ;;
  polymarket)   PLATFORM="polymarket" ;;
  kalshi)       PLATFORM="kalshi" ;;
  polymarket:*) PLATFORM="polymarket"; SINGLE="${var#polymarket:}" ;;
  kalshi:*)     PLATFORM="kalshi";     SINGLE="${var#kalshi:}" ;;
  *)            # unrecognised prefix — don't guess a venue; fall back to both watchlists
                PLATFORM="both"; SINGLE=""
                echo "unrecognised selector '${var}' — running both watchlists" ;;
esac
```

- `PLATFORM=both` → run the **Polymarket branch** and the **Kalshi branch**, each from its own watchlist, then emit a combined notification.
- `PLATFORM=polymarket` → run only the Polymarket branch (whole watchlist, or `SINGLE` if set).
- `PLATFORM=kalshi` → run only the Kalshi branch (whole watchlist, or `SINGLE` if set).

Each branch below is independently executable — skip the one(s) the selector didn't ask for.

---

# Polymarket branch

Data source: Polymarket **gamma-api** (events, comments) + **clob** (price history). All endpoints are **public — no auth**.

Watchlist: `skills/monitor-polymarket/watchlist-polymarket.md`. Each line is an event slug; add or remove slugs to change what's monitored.

## P1. Load watchlist

```bash
if [ -n "$SINGLE" ]; then
  SLUGS="$SINGLE"
else
  # One slug per line, skip comments and blanks
  SLUGS=$(grep -v '^#' skills/monitor-polymarket/watchlist-polymarket.md | grep -v '^$')
fi
```

If the watchlist is empty and no single slug was given, there's nothing to do on Polymarket — note it and move on (don't fabricate a report).

## P2. For each event, fetch markets and price history

For each event slug in `$SLUGS`:

**a) Get the event and its markets:**
```bash
curl -s "https://gamma-api.polymarket.com/events?slug=$SLUG&limit=1"
```

The response contains the event `id`, `title`, and a `markets` array. Each market has:
- `id`, `question`, `slug`, `closed`
- `outcomePrices` — JSON array, index 0 = YES price (0.0–1.0)
- `volume24hr`, `volumeNum`, `liquidityNum`
- `clobTokenIds` — JSON array, index 0 = YES token, index 1 = NO token

**Skip closed markets** — they've already resolved.

**b) Get 24h price history for each open market:**
```bash
# YES token is index 0 of clobTokenIds
TOKEN_ID=$(echo "$CLOB_TOKEN_IDS" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())[0])")
curl -s "https://clob.polymarket.com/prices-history?market=$TOKEN_ID&interval=1d&fidelity=60"
```

Response: `{ "history": [{ "t": unix_timestamp, "p": "price_string" }, ...] }`

**c) Calculate 24h stats for each market:**
- **Open / Close** — first and last price in the history
- **Change** — close minus open, in percentage points (e.g. +4.0pp)
- **High / Low** — intraday range
- **Volume** — `volume24hr` from the market data
- **Direction** — classify as: surging (>+5pp), rising (+2 to +5pp), stable (−2 to +2pp), falling (−5 to −2pp), crashing (<−5pp)

## P3. Fetch comments

For each event, get top comments and latest comments:

```bash
EVENT_ID=... # from step P2a

# Top comments by reactions
curl -s "https://gamma-api.polymarket.com/comments?parent_entity_type=Event&parent_entity_id=$EVENT_ID&limit=10&order=reactionCount&ascending=false"

# Latest comments (last 24h chatter)
curl -s "https://gamma-api.polymarket.com/comments?parent_entity_type=Event&parent_entity_id=$EVENT_ID&limit=10&order=createdAt&ascending=false"
```

**Important:** `parent_entity_type` must be `Event` (capital E).

Each comment has: `body`, `profile.username` (often null → use "anon"), `reactionCount`, `createdAt`.

From the combined results, pick the **3 most interesting comments** per event:
- New comments from the last 24h get priority (they react to recent moves)
- High-reaction comments that are still relevant
- Contrarian takes, insider-sounding analysis, whale callouts, humor

## P4. Build the Polymarket report

For each event, produce a summary block:

```
**[Event Title]** (event_id: N)

| Market | YES | 24h Chg | High/Low | 24h Vol |
|--------|-----|---------|----------|---------|
| [question] | XX.X% | +X.Xpp ▲ | XX–XX% | $X.Xm |
| [question] | XX.X% | -X.Xpp ▼ | XX–XX% | $X.Xm |
...

Biggest mover: "[question]" — [direction] from X% to Y%

Comments:
- [user/anon]: "[comment excerpt]" (X upvotes)
- [user/anon]: "[comment excerpt]"
- [user/anon]: "[comment excerpt]"
```

Flag any market that moved more than **5 percentage points** in 24h — these are the ones worth paying attention to.

## P5. Polymarket Network note

`curl` works — there is no network sandbox. Use **WebFetch** as a fallback for a flaky public GET:
- `WebFetch("https://gamma-api.polymarket.com/events?slug=SLUG&limit=1")`
- `WebFetch("https://clob.polymarket.com/prices-history?market=TOKEN_ID&interval=1d&fidelity=60")`
- `WebFetch("https://gamma-api.polymarket.com/comments?parent_entity_type=Event&parent_entity_id=EVENT_ID&limit=10&order=reactionCount&ascending=false")`
- All Polymarket gamma-api / clob endpoints are public and need no auth headers.

---

# Kalshi branch

Data source: Kalshi **trade-api v2** at `https://api.elections.kalshi.com/trade-api/v2`. Despite the "elections" subdomain, this provides access to ALL Kalshi markets (economics, climate, tech, politics, etc.). All endpoints are **public — no auth required**.

Watchlist: `skills/monitor-polymarket/watchlist-kalshi.md`. Each line is an event ticker; add or remove tickers to change what's monitored.

## K1. Load watchlist

```bash
if [ -n "$SINGLE" ]; then
  TICKERS="$SINGLE"
else
  TICKERS=$(grep -v '^#' skills/monitor-polymarket/watchlist-kalshi.md | grep -v '^$')
fi
```

If the watchlist is empty and no single ticker was given, emit `MONITOR_KALSHI_NO_CONFIG`, notify with a one-line setup hint, and discover trending events for this run only:
```bash
curl -s "https://api.elections.kalshi.com/trade-api/v2/events?status=open&with_nested_markets=true&limit=10"
```
Pick the 5 highest-volume events and monitor those.

## K2. For each event, fetch markets, prices, and liquidity

For each event ticker:

**a) Event + markets:**
```bash
curl -s "https://api.elections.kalshi.com/trade-api/v2/events/$EVENT_TICKER?with_nested_markets=true"
```
Fields used: `event_ticker`, `title`, `category`, `mutually_exclusive`, `markets[]` with `ticker`, `title`, `subtitle`, `status`, `yes_bid`, `yes_ask`, `last_price`, `volume`, `volume_24h`, `open_interest`, `close_time`, `series_ticker`.

**Skip non-open markets** (closed/settled are historical).

**b) 24h candlesticks (batch where possible):**
Prefer the batch endpoint — one call per event, not per market:
```bash
END_TS=$(date -u +%s)
START_TS=$((END_TS - 86400))
# Batch: up to 10,000 candlesticks total across requested tickers
curl -s "https://api.elections.kalshi.com/trade-api/v2/markets/candlesticks?tickers=$COMMA_SEP_MARKET_TICKERS&start_ts=$START_TS&end_ts=$END_TS&period_interval=60"
```
If the batch endpoint errors, fall back to the per-market endpoint:
```bash
curl -s "https://api.elections.kalshi.com/trade-api/v2/series/$SERIES_TICKER/markets/$MARKET_TICKER/candlesticks?start_ts=$START_TS&end_ts=$END_TS&period_interval=60"
```
If both fail for a market, mark its source as `SRC=price_only` and use `last_price` vs yesterday's log entry.

**c) Orderbook depth (liquidity / conviction signal):**
```bash
curl -s "https://api.elections.kalshi.com/trade-api/v2/markets/$MARKET_TICKER/orderbook?depth=10"
```
From the orderbook, compute:
- `spread_pp` = `yes_ask − yes_bid` in percentage points. Wide spread = low conviction, thin book.
- `depth_usd` = sum over top-10 bid levels of `price × size` (approximation, both sides). This scales how much weight to give a price.

If orderbook fails, mark `SRC=no_book` and skip the conviction column for that market.

## K3. Compute per-market signals

For each open market:

- **implied_prob** = `last_price` as a percentage (0.62 → 62%). Report this, not cents.
- **chg_pp** = `close − open` from candlesticks, in percentage points.
- **high / low** = intraday range.
- **vol_24h_usd** ≈ `volume_24h × avg(open, close)` (Kalshi reports contract count — convert so readers can compare across markets).
- **spread_pp** and **depth_usd** from step K2c.
- **move_score** = `|chg_pp| × log10(max(vol_24h_usd, 100))`. This is the key ranking signal — a 3pp move on a $200k market outranks a 5pp move on a $5k market. It prevents thin-book noise from dominating.

**Direction label** (from chg_pp): surging (>+5pp), rising (+2 to +5), stable (−2 to +2), falling (−5 to −2), crashing (<−5).

**Conviction label** (from spread_pp): tight (<2pp), loose (2–5pp), thin (>5pp, treat price skeptically).

## K4. Decide what's worth saying — suppression rules

Before building the report, drop markets that fail ALL of these gates:
- `|chg_pp| >= 2` AND `vol_24h_usd >= $1,000`, OR
- `vol_24h_usd >= $25,000` (large volume alone is signal even if price didn't move much), OR
- `open_interest` grew >30% vs yesterday's log, if yesterday's log has the data.

If a market appeared in yesterday's log with the same direction and a chg_pp within ±1pp of today's, treat it as "continued from yesterday" and demote it — mention once at the event level, don't re-alert.

**Hard alert threshold:** `|chg_pp| >= 5` AND `conviction != thin`. These go to the ALERTS block and require a "why it matters" line.

## K5. Global ranking

Rank events by the max `move_score` of any market within them. Cap the report at the **top 5 events**. Markets within an event are listed in descending `move_score` order, capped at 3 per event (mention "+N more" if truncated).

## K6. Build the Kalshi report

```
*Kalshi monitor — ${today}*
verdict: [1 sentence — dominant theme or "all quiet"]

**[Event Title]** (EVENT_TICKER) — category
| Market | prob | Δ24h | range | vol | spread |
|--------|------|------|-------|-----|--------|
| [title] | 62% | +4.1pp ▲ | 56–65% | $82k | 1pp |
| [title] | 23% | −2.8pp ▼ | 22–28% | $14k | 3pp |
mover: [title] — rising on $82k vol, tight book

[next event ...]

**ALERTS** (moved >5pp on non-thin book)
- [event/market]: 34% → 51% — *why it matters:* [one sentence grounded in the move's volume, spread, or news context if obvious from titles]
- ...

**Trending (not tracked)**
- [event] — $Xk 24h vol, consider adding
- ...

sources: events=ok candlesticks=ok|degraded|fail orderbook=ok|degraded|fail
```

Rules for the verdict line:
- If no alerts AND no market moved >2pp: say "all quiet — [N] events, [M] markets tracked, no moves worth flagging".
- If one theme dominates (most big moves in one category): name it. E.g. "GDP markets repriced down after Q1 print; inflation markets unchanged".
- Never hedge. If you're not sure, say "mixed signals" and stop.

Rules for "why it matters":
- Must reference at least one of: volume (is this real money?), spread (is this consensus?), prior log state (is this new?), or a plausible news trigger inferable from the market title.
- Max 15 words. No filler like "interesting move" or "worth watching".

## K7. Discover notable trends

```bash
curl -s "https://api.elections.kalshi.com/trade-api/v2/events?status=open&with_nested_markets=true&limit=50"
```
Scan for events with high `volume_24h` (top 10) whose tickers are **not** in the watchlist. Mention 1–2 in the "Trending (not tracked)" block, only if their 24h volume exceeds the median volume of tracked events.

## K8. Kalshi status codes (end-of-run)

- `MONITOR_KALSHI_OK` — ran fully, had data, at least one event processed.
- `MONITOR_KALSHI_DEGRADED` — partial data (some markets fell back to `price_only` or `no_book`); report still sent.
- `MONITOR_KALSHI_NO_CONFIG` — empty watchlist and no single ticker; discovered trending events and notified with setup hint.
- `MONITOR_KALSHI_ERROR` — events endpoint failed entirely or zero markets resolved; notify with the failure, don't fake a report.

## K9. Kalshi Network note

`curl` works — there is no network sandbox. Use **WebFetch** as a fallback for a flaky public GET:
- `WebFetch("https://api.elections.kalshi.com/trade-api/v2/events/EVENT_TICKER?with_nested_markets=true")`
- `WebFetch("https://api.elections.kalshi.com/trade-api/v2/markets/candlesticks?tickers=...&start_ts=...&end_ts=...&period_interval=60")`
- `WebFetch("https://api.elections.kalshi.com/trade-api/v2/markets/MARKET_TICKER/orderbook?depth=10")`
- `WebFetch("https://api.elections.kalshi.com/trade-api/v2/events?status=open&with_nested_markets=true&limit=50")`
- All Kalshi endpoints are public and need no auth headers.

---

# Notify

Send via `./notify` (under 4000 chars). Emit only the section(s) for the branch(es) that ran.

- **Polymarket only** — send the Polymarket report from P4.
- **Kalshi only** — send the Kalshi report from K6.
- **Both** — send one combined message: the Kalshi report (K6) first (it's the ranked, decision-oriented view), then a `— — —` divider, then the Polymarket report (P4). Lead with a one-line cross-venue verdict, e.g. `prediction markets — ${today}: [dominant theme across both, or "all quiet both venues"]`.

If the combined report exceeds the budget, trim in this order: (1) drop Kalshi's "Trending (not tracked)" block, (2) truncate Kalshi events from the bottom of the ranked list, (3) drop Polymarket comment lines, (4) truncate Polymarket events from the bottom.

**Notify only on signal.** If neither branch found anything worth flagging (no >5pp Polymarket moves, no Kalshi alerts, no themes), a one-line "all quiet" is acceptable signal — but a fully empty/no-change run should send nothing. An explicit `all quiet — N events tracked, no moves` is useful; an empty template is not.

# Log

Append to `memory/logs/${today}.md` under a single `### monitor-polymarket` heading, with a bullet group for **each platform that ran**:

```
### monitor-polymarket
- **Platform(s):** both | polymarket | kalshi   (selector: `${var}`)

#### Polymarket        (only if the Polymarket branch ran)
- **Events monitored:** N
- **Markets tracked:** N (M open, K closed)
- **Biggest mover:** "[question]" — X% → Y% (+/-Zpp)
- **Alert markets (>5pp move):** [list or "none"]
- **Top comment:** "[excerpt]"

#### Kalshi            (only if the Kalshi branch ran)
- **Events monitored:** N (watchlist=W, discovered=D)
- **Markets tracked:** N (M open, K skipped)
- **Top mover:** "[title]" — X% → Y% (Δpp, move_score=S, vol=$V, spread=Sp)
- **Alerts (>5pp, non-thin):** [count; list titles or "none"]
- **Continued-from-yesterday (demoted):** [count]
- **Trending untracked:** [1–2 tickers or "none"]
- **Sources:** events=[status] candlesticks=[status] orderbook=[status]
- **Status:** MONITOR_KALSHI_OK | MONITOR_KALSHI_DEGRADED | MONITOR_KALSHI_NO_CONFIG | MONITOR_KALSHI_ERROR

- **Notification sent:** yes | no
```

If a market moved dramatically — Polymarket >5pp, or Kalshi >10pp on a non-thin book — or a new category/trend is heating up across multiple events, add a one-line note in `memory/MEMORY.md` (under a "Prediction market signals" section) for future reference.

## Network note

Both branches only fetch **public** APIs (`mode: read-only`), so there are no secret-bearing calls. `curl` works — there is no network sandbox; use **WebFetch** as a fallback for a flaky public GET (per-platform endpoint lists are in the Polymarket Network note P5 and the Kalshi Network note K9). Never write to the repo beyond `memory/logs/` (and an optional `memory/MEMORY.md` note); produce all output via `./notify` and `memory/`.
