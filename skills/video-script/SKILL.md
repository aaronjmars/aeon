---
name: video-script
description: Turn a repo, product page, or update into a recording-ready video script in a receipts-first format - verifies every claim against live sources, then writes timestamped VO + on-screen direction with a plain-language glossary, assets checklist, anti-tells, and a verify-before-recording list
metadata:
  title: Video Script
  category: basics
  var: ""
  tags:
    - content
---

> **${var}** — Selector: `<source> [--minutes N]`.
>
> - **`repo:<owner/repo>`** → script about that repo's latest update wave (README + recent releases/commits decide what "the update" is).
> - **`<url>`** → script about that product page / doc / announcement.
> - **`<topic>`** (anything else non-empty) → script about that topic; research it first.
> - **empty** → pick the most script-worthy update from the last 7 days of `memory/logs/` (a shipped feature, a release, a milestone with receipts). If nothing qualifies, log `VIDEO_SCRIPT_NO_SOURCE`, send no notification, and exit clean.
> - **`--minutes N`** anywhere → runtime target (default 4; ~150 spoken words per minute).
>
> Examples: `"repo:aeonfun/aeon --minutes 6"`, `"https://example.com/launch"`, `"our new payments integration --minutes 3"`.

Today is ${today}. Write a recording-ready video script. No placeholders — every number, address, and date in it must be verified this run.

## Shared preamble

1. Read `memory/MEMORY.md` and the last 7 days of `memory/logs/` — know what has already been covered, and don't script the same story twice.
2. If a `soul/` directory exists, read `soul/SOUL.md` and `soul/STYLE.md` for voice calibration. The script is *the operator talking to a smart friend* — if `soul/` is empty, default to terse, direct, first-person.
3. Parse `${var}` per the selector above into `source` + `minutes`.

## Step 1 — Research and verify (never skip)

The format is called receipts-first because the receipts are real:

- Fetch the live source **now** (WebFetch / `gh api` for repos — README **and** recent releases/commits). Do not write numbers, counts, addresses, or dates from memory.
- Collect concrete verifiable artifacts: contract addresses, live dashboards, version numbers, dollar figures, dates. These become the cold open and the Receipts section.
- Every claim you could NOT verify either gets cut or becomes a checkbox in "Verify before recording".

## Step 2 — Find the angle

The cold open is never the pitch. It is the single most concrete, verifiable, surprising fact — shown, not claimed (a live dashboard, a list of on-chain addresses, a terminal). Test: could a skeptic check it in 30 seconds? The flex is usually the *credibility mechanism* (immutability, safety gates, audit trail, reproducible tests), not the feature list.

## Step 3 — Write the script

Header block:

```markdown
# <project> — "<Working Title>" — Video Script

**Runtime target:** ~M:SS
**Framing:** receipts-first (open on <the artifact>)
**Byline:** <the project's public handle>
**One-line pitch:** <one sentence, no hype>
**Rev:** v1, ${today} — plain-language pass baked in; every technical term explained in one line or cut.
```

Chapters, each with a time range:

```markdown
## <Chapter name> — 0:00 – 0:25

**VO:**
> Spoken text as blockquote. Short sentences. Operator voice.

**On screen:**
- Concrete shot list: screencaps, terminals, motion graphics, captions in `backticks`.
```

Canonical arc (adapt, don't force): **cold open** (the receipt, no greeting) → **context/problem** (one plain-language line for the underlying tech) → **how it works** (the mechanism, credibility story first) → **what's new** or **the demo** → **straight talk** (limits, flat delivery — every script has this section; it is a feature, not a concession) → **close + CTA** (one action).

After the chapters, ALWAYS:

- **Plain-language glossary** — jargon → the phrasing used on screen, plus terms deliberately cut.
- **Assets checklist** — everything to capture or build; mark what must be captured day-of.
- **Anti-tells checklist** — the voice rules below plus per-video specifics (what not to oversell, whose failures not to dunk on).
- **Verify before recording** — dated checkboxes for every volatile fact, each with where to re-check it.
- **Receipts** — the verified facts with sources and the date verified (mandatory when the video makes on-chain or factual claims).

## Voice rules (the anti-tells)

- Banned: "In this video", "Let's dive in", "game-changer", "insane", "mind-blowing", "revolutionary", "trustless" (name what enforces it instead).
- Short declaratives; read VO lines aloud mentally before keeping them.
- Numbers stay conservative — round down; "tens of millions" beats a precise figure that might drift.
- Incidents and competitors are stakes, not villains — flat delivery, no dunking.
- The safety/verification story outranks the feature list.
- Every technical term gets one plain-language line or gets cut.
- On-screen text must NOT mirror the VO verbatim — reword it so the viewer isn't reading what they're hearing.
- Never reference private forks or internal accounts — point at the upstream/public repo.

## Step 4 — Deliver

1. Write the script to `output/video-scripts/${today}-<slug>.md` (shell redirection; `mkdir -p` first).
2. Notify with `./notify -f /tmp/video-script-notify.md` (write the body under `/tmp/`, never `memory/` or `output/`): the working title, runtime, the chosen angle in one line, one thing deliberately left out, and a **clickable** link to the script built from the run's environment:

   ```bash
   SCRIPT_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/blob/main/output/video-scripts/<file>.md"
   ```

3. Log to `memory/logs/${today}.md` under a `### video-script` heading: source, angle, runtime, output path, and any claims deferred to day-of verification. Status codes: `VIDEO_SCRIPT_OK` on success, `VIDEO_SCRIPT_NO_SOURCE` when `${var}` was empty and the logs offered nothing script-worthy.

## Limits

- This writes the script; it does not record, edit, or generate footage. The assets checklist is a to-do list for a human (or other skills).
- Verification is only as fresh as this run — volatile facts must still be re-checked day-of; that is what the "Verify before recording" section is for.
- If the source is private or unreachable, say so and stop — a script built on unverifiable claims defeats the format.
