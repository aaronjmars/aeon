---
type: Reference
---

# Telegram commands, buttons & deep links

Beyond plain-text chat, Aeon's Telegram integration supports slash commands,
inline buttons, a `/` autocomplete menu, deep links, and stateless follow-up
questions. Everything works on **both** delivery paths:

- the default **5-minute poller** (`getUpdates` in `.github/workflows/messages.yml`), and
- **instant mode** (~1s) via the Cloudflare Worker in [`apps/webhook/`](../apps/webhook/).

The shared router **[`scripts/telegram-route.sh`](../scripts/telegram-route.sh)** is the
single source of truth for turning an inbound update into an action — no LLM in the
loop for commands, buttons, or replies.

> Prereq: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` are set. Aeon is scoped to that
> single chat. In a **1:1 DM** that's enough — the chat id *is* your user id, so only
> you can command the bot. In a **group/public chat** the chat id is shared by every
> member, so also set **`TELEGRAM_ALLOWED_USER_ID`** to your numeric user id (from
> [@userinfobot](https://t.me/userinfobot)); until you do, button taps and messages
> from anyone in the group are ignored (fail-closed). See [Owner gate](#owner-gate).

---

## 1. Slash commands & the `/` menu

Your enabled skills become Telegram slash commands so the `/` autocomplete menu
populates and the message-field menu button points at it. Registration is automatic:

1. **On first setup** — saving `TELEGRAM_BOT_TOKEN` in the dashboard dispatches the
   registration workflow for you (POST `/api/secrets` → `setup-commands.yml`). No manual step.
2. **Re-sync after toggling skills** — the dashboard's **Re-register commands** button
   (Credentials → Telegram) POSTs to `/api/telegram/commands`, which re-runs the same
   workflow. It reuses the stored token server-side — nothing to paste.
3. It also re-runs automatically on any push to `aeon.yml`, and can be run by hand from
   the Actions tab → **Setup Telegram Commands** → **Run workflow**
   (`.github/workflows/setup-commands.yml`).

Every path reads `TELEGRAM_BOT_TOKEN` server-side (where secrets are readable) and calls
`setMyCommands` + `setChatMenuButton` — identical result, no browser token handling.

Command names can only use `a-z`, `0-9`, `_` — so a skill dir `token-movers`
becomes `/token_movers`. The router inverts `_`→`-` when it dispatches.

- `/skillname [args]` dispatches the skill instantly (no Claude call). `args` become
  the skill's `var`, e.g. `/article quantum computing`.
- Reserved: `/start`, `/help`, `/settings`.
- Plain-English messages still fall through to Claude, exactly as before.

Telegram caps the list at 100 commands; the setup workflow truncates + warns beyond that.

## 2. Buttons on notifications

### Global quick actions (automatic — no skill wiring)

Every skill notification automatically carries two quick-action buttons — **🔁 Run
again** and **📅 Schedule weekly** — keyed to the running skill (`$SKILL_NAME`).
This is a global `notify` feature, not per-skill: `scripts/notify.sh` appends the
row to any Telegram send. Tapping **Run again** re-dispatches the skill
(`run:<skill>`); **Schedule weekly** enables it and sets a weekly cron in `aeon.yml`
(`schedule:<skill>:weekly`), which the caller (the Messages workflow) commits. The
row is skipped when there is no skill context, when the skill name is too long to
fit the 64-byte `callback_data` budget, or on a force-reply prompt (Telegram forbids
inline buttons and `force_reply` on the same message).

### Custom buttons (`--buttons`)

`./notify` (the canonical `scripts/notify.sh`) also takes `--buttons`, a JSON array
of rows appended *above* the global quick-action row. `callback_data` has a hard
**64-byte** limit — use the compact `action:skill:arg1:arg2` scheme:

```bash
./notify "PR #482 needs a look" --buttons '[[
  {"text":"Re-run","callback_data":"run:pr-review:482"},
  {"text":"Open PR","url":"https://github.com/you/repo/pull/482"}
]]'
```

Recognised callback actions: `run`, `schedule`, `snooze`, `mute`, `save`, `dismiss`.
A `url` button opens a link and skips the callback loop entirely.

### Making snooze & mute real

Button taps for `snooze`/`mute` append to `memory/snoozes.log`
(`skill:arg:until_epoch`) and `memory/mutes.log` (`skill:arg`). To honour them, a
skill passes **`--mute-key`** when it alerts — `notify` then suppresses the send if
the key is muted or snoozed into the future. No per-skill logic needed:

```bash
./notify "BTC dropped 12% in 1h" \
  --mute-key "token-movers:BTC" \
  --buttons '[[{"text":"Snooze 24h","callback_data":"snooze:token-movers:BTC:86400"},
               {"text":"Mute BTC","callback_data":"mute:token-movers:BTC"}]]'
```

## 3. Menu button

`setMyCommands` (step 1) already populates the menu button next to the message
field. The setup workflow also calls `setChatMenuButton({type:"commands"})`
explicitly. (Swap in a Mini App later by changing that payload.)

## 4. Deep links

`t.me/<yourbot>?start=<payload>` sends `/start <payload>`. The router reads the
payload as `<skill>__<arg>` (double underscore separates skill from arg; charset is
`A-Za-z0-9_-`, max 64):

- `…?start=digest` → runs `/digest` with defaults
- `…?start=article__quantum` → runs `/article` with `var=quantum`
- `…?start=token-movers__daily` → runs `/token-movers` with `var=daily`

Drop `url` buttons pointing at `t.me/<bot>?start=…` into any notification for
tap-to-run shortcuts.

## 5. Follow-up questions (stateless force-reply)

A skill asks a question with `--force-reply` and a `--context "skill::intent"`
marker; Telegram makes the user's next message a reply carrying that marker back, so
no state file is needed:

```bash
./notify "Which repo?" \
  --force-reply \
  --placeholder "owner/repo" \
  --context "github-monitor::add-repo"
```

The visible text is `[github-monitor::add-repo] Which repo?`. When you reply
`owner/repo`, the router dispatches `github-monitor` with `var=add-repo:owner/repo`.
The skill parses `var` as `intent:value`.

---

## Owner gate

`TELEGRAM_CHAT_ID` gates the **chat**; `TELEGRAM_ALLOWED_USER_ID` gates the **user**.
Both the poller and the webhook Worker now require an inbound update to satisfy *both*:
the chat must be `TELEGRAM_CHAT_ID` **and** the sender/tapper (`from.id`) must be the
owner user.

- **Why both.** A button posted into a group is tappable by every member, and Telegram
  delivers `callback_query` updates even when BotFather group-privacy mode is on (which
  otherwise hides plain group messages from the bot). Gating on chat alone let any member
  dispatch skills or schedule crons by tapping. Gating on user closes that.
- **Default.** `TELEGRAM_ALLOWED_USER_ID` defaults to `TELEGRAM_CHAT_ID`. In a 1:1 DM
  `chat.id == user.id`, so the default *is* the owner and nothing new is needed. In a
  group the negative chat id never equals a positive user id, so the gate **fails closed**
  — every tap/message is ignored until you set `TELEGRAM_ALLOWED_USER_ID`.
- **Set it.** Repo var/secret `TELEGRAM_ALLOWED_USER_ID` (poller + `route` job) and the
  Worker env of the same name (instant mode). Find your id via
  [@userinfobot](https://t.me/userinfobot).

## Operational notes

- **Offset.** The poller now requests `allowed_updates=["message","callback_query"]`
  and advances the offset past both, so button presses don't reprocess every tick.
- **Command drift.** `setMyCommands` shows whatever you last pushed. The setup
  workflow re-runs on any `aeon.yml` push; or trigger it by hand after toggling skills.
- **Callback data length.** 64 bytes is hard. Keep args short (tickers, PR numbers,
  ISO/second durations); if you need more, store the payload in a small file and put a
  short reference key in `callback_data`.
- **Instant mode.** After editing `apps/webhook/src/worker.js`, **redeploy the
  Worker** to pick up command/button/reply routing (`npx wrangler deploy`).
- **Non-owner messages.** The Worker replies "This bot is private." to strangers who
  DM the bot in a *private* chat (keeps the bot's reply rate high) and never acts on
  them. A non-owner tapping/messaging inside the owner's own group is dropped silently
  (no reply, to avoid group noise) — see [Owner gate](#owner-gate).

## Testing on a scratch bot

Create a second bot via @BotFather, point a private test fork's `TELEGRAM_BOT_TOKEN`
at it, then: run **Setup Telegram Commands** → `/` menu populates → `/article`
dispatches with no Claude call → tap a button → a row lands in
`memory/snoozes.log`/`mutes.log` → open a `?start=` deep link → reply to a
force-reply prompt and confirm the input reaches the skill. Ship to the live fork
once all pass.
