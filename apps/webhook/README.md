# Aeon Telegram webhook — instant mode

Default polling checks Telegram every 5 minutes. Deploy this Cloudflare Worker as
a Telegram webhook to drop that to **~1 second**: the Worker classifies each update
and relays it to your Aeon fork via a GitHub `repository_dispatch`, which fires the
**Messages** workflow immediately.

It routes the full inbound feature set — slash commands, inline-button taps, and
reply follow-ups — not just plain messages (see
[`docs/telegram-commands.md`](../../docs/telegram-commands.md)). **Redeploy the
Worker** (`npx wrangler deploy`) after updating `src/worker.js` to pick up changes.

Each user deploys it into **their own** Cloudflare account. There's no shared
relay and no credential custody — your bot token and GitHub PAT live only in your
Worker's secrets.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/aeonfun/aeon/tree/main/apps/webhook)

> Forked Aeon? Change `aeonfun/aeon` in the button URL above to
> `your-username/your-fork` so it deploys from your repo. (The button requires a
> **public** source repo.)

Or from a clone:

```bash
cd apps/webhook
npm install
npx wrangler deploy
```

## Configure

The deploy button prompts for all five values during the wizard (declared in
[`.dev.vars.example`](.dev.vars.example)) and stores them as encrypted Worker
secrets — the Worker comes out configured. Deploying from a clone instead? Set
them via the CLI:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN        # bot token from @BotFather
npx wrangler secret put TELEGRAM_CHAT_ID          # your chat id (only this chat is allowed)
npx wrangler secret put TELEGRAM_ALLOWED_USER_ID  # optional; your user id (required for group chats — see table)
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # shared secret for webhook verification (required)
npx wrangler secret put GITHUB_REPO               # owner/repo of your Aeon fork
npx wrangler secret put GITHUB_TOKEN              # GitHub PAT (see scopes below)
```

| Secret | Required | Notes |
|--------|----------|-------|
| `TELEGRAM_BOT_TOKEN` | yes | From [@BotFather](https://t.me/BotFather). |
| `TELEGRAM_CHAT_ID` | yes | Only messages from this chat are relayed; everything else is dropped. |
| `TELEGRAM_ALLOWED_USER_ID` | for groups | The only **user** allowed to command the bot. Defaults to `TELEGRAM_CHAT_ID`, which is correct for a 1:1 DM (there `chat.id == user.id`). If `TELEGRAM_CHAT_ID` is a **group**, set this to your numeric user id — otherwise any group member can drive the bot by tapping a posted button. Left unset in a group, buttons fail closed. Get your id from [@userinfobot](https://t.me/userinfobot). |
| `TELEGRAM_WEBHOOK_SECRET` | yes | Random string; pass the **same** value to `setWebhook` as `secret_token`. The Worker rejects every update with `403` until it's set. |
| `GITHUB_REPO` | yes | `owner/repo` of your Aeon fork, e.g. `aeonfun/aeon` — not the worker repo the deploy button creates. |
| `GITHUB_TOKEN` | yes | Fine-grained PAT scoped to your fork with **Contents: read/write** and **Actions: read/write**, or a classic token with `repo`. |

To edit values later: Cloudflare dashboard → Workers & Pages → your worker →
Settings → Variables and secrets.

## Point Telegram at the Worker

Register your Worker URL as the bot's webhook:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://aeon-telegram-webhook.<your-subdomain>.workers.dev&secret_token=<YOUR_WEBHOOK_SECRET>"
```

Verify it took:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

Messages now arrive in ~1s. To go back to polling, clear the webhook:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/deleteWebhook"
```

## How it coexists with polling

A webhook and `getUpdates` polling are **mutually exclusive** — once a webhook is
set, `getUpdates` returns `409 Conflict`. The Messages workflow's
poller calls `getWebhookInfo` first and **skips the Telegram branch when a webhook
is active**, so the two never fight. Delivery then runs entirely through this
Worker → `repository_dispatch`.

Dedupe in webhook mode is by the `update_id` carried in the dispatch payload:
the Worker returns `200` once GitHub accepts the dispatch (so Telegram never
redelivers) and a non-2xx only when the dispatch genuinely failed (so Telegram
retries).

## What it does

```
Telegram → POST update → Worker
  ├─ verify method + secret token
  ├─ callback_query (button tap) → answerCallbackQuery → dispatch telegram-callback
  ├─ ignore (200) anything not from the owner chat AND owner user (a stranger's private DM gets "This bot is private.")
  ├─ reply to a [skill::intent] prompt   → dispatch telegram-reply
  ├─ /slash command or /start deep link  → dispatch telegram-command
  └─ plain text                          → dispatch telegram-message
       → GitHub Actions: `route` job (commands/callbacks/replies, no LLM) or
         `run` job (plain text → Claude) acts on it (~1s)
```

The Worker source is [`src/worker.js`](src/worker.js) — small, no build step.
