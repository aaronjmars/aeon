/**
 * Aeon — Telegram instant-delivery webhook.
 *
 * A Cloudflare Worker that receives Telegram webhook updates and relays them to
 * your Aeon fork via a GitHub `repository_dispatch`. The "Messages" workflow
 * picks it up immediately, so an update is acted on in ~1s instead of
 * waiting up to 5 minutes for the next poll.
 *
 * It classifies each update the same way the poller does, so instant mode gets the
 * full inbound feature set — NOT just plain messages:
 *   • inline-button taps   -> event_type "telegram-callback" (snooze/mute/re-run…)
 *   • replies to a prompt   -> event_type "telegram-reply"    (force_reply follow-ups)
 *   • /slash + /start links -> event_type "telegram-command"  (dispatched, no LLM)
 *   • plain text            -> event_type "telegram-message"  (the agent interprets)
 * The repo-side `route` job runs scripts/telegram-route.sh for the first three.
 *
 * Each user deploys this into their OWN Cloudflare account — there is no shared
 * infrastructure and no credential custody. See README.md for deployment.
 * Redeploy after updating this file to pick up command/button routing.
 *
 * Required vars/secrets (the deploy wizard prompts for them; see .dev.vars.example):
 *   TELEGRAM_BOT_TOKEN        bot token from @BotFather
 *   TELEGRAM_CHAT_ID          the only chat allowed to command the agent
 *   TELEGRAM_ALLOWED_USER_ID  (optional) the only USER allowed to command the agent.
 *                             Defaults to TELEGRAM_CHAT_ID (correct for a 1:1 DM). Set
 *                             it to your numeric user id when TELEGRAM_CHAT_ID is a
 *                             group, so a non-owner member can't drive the bot by
 *                             tapping a posted button. Buttons fail closed until set.
 *   TELEGRAM_WEBHOOK_SECRET   shared secret for setWebhook(secret_token) — required
 *   GITHUB_REPO               "owner/repo" of your Aeon fork
 *   GITHUB_TOKEN              GitHub PAT — fine-grained with Contents: read/write
 *                             and Actions: read/write on your fork (or classic `repo`)
 */
import { instrument } from "@microlabs/otel-cf-workers";

const handler = {
  async fetch(request, env) {
    // Telegram only ever POSTs updates. Treat anything else as a health probe.
    if (request.method !== "POST") {
      return new Response("aeon telegram webhook: ok", { status: 200 });
    }

    // Reject forged requests — require a shared secret on every call. Telegram
    // echoes the secret passed to setWebhook(secret_token) in this header.
    if (
      !env.TELEGRAM_WEBHOOK_SECRET ||
      request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET
    ) {
      return new Response("forbidden", { status: 403 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }

    const owner = String(env.TELEGRAM_CHAT_ID);
    // Owner *user* id. `owner` above gates the chat; this gates the tapping/sending
    // user. Defaults to the chat id, which is exactly the owner's id in a 1:1 DM
    // (chat.id == user.id there), so DM setups need no extra config. In a group the
    // negative chat id never equals a positive user id, so buttons fail closed until
    // TELEGRAM_ALLOWED_USER_ID is set — stopping any group member from commanding
    // the bot just by tapping a posted button.
    const ownerUid = String(env.TELEGRAM_ALLOWED_USER_ID || env.TELEGRAM_CHAT_ID);

    // --- Inline button tap -------------------------------------------------
    const cb = update?.callback_query;
    if (cb) {
      // Stop the client's spinner regardless of who sent it.
      await answerCallback(env, cb.id);
      if (String(cb.message?.chat?.id) !== owner || String(cb.from?.id) !== ownerUid) {
        return new Response("ignored", { status: 200 });
      }
      return dispatch(env, "telegram-callback", {
        data: cb.data,
        from_id: cb.from?.id,
        chat_id: cb.message?.chat?.id,
        message_id: cb.message?.message_id,
      });
    }

    // --- Messages ----------------------------------------------------------
    const message = update?.message;
    if (!message?.text) {
      return new Response("ignored", { status: 200 });
    }
    if (String(message.chat?.id) !== owner || String(message.from?.id) !== ownerUid) {
      // Keep the bot's reply rate high (BotFather flags "too few replies") without
      // acting on strangers. Private chats only, to avoid replying into groups.
      // The reply only goes out when the whole chat is a non-owner private DM — never
      // to a non-owner member inside the owner's own group (that would be chat noise).
      if (message.chat?.type === "private" && String(message.chat?.id) !== owner) {
        await sendMessage(env, message.chat.id, "This bot is private.");
      }
      return new Response("ignored", { status: 200 });
    }

    const replyTo = message.reply_to_message?.text;
    const base = { from_id: message.from?.id, chat_id: message.chat.id };

    // Answer to a force_reply prompt (marker embedded as [skill::intent]).
    if (replyTo && /\[[A-Za-z0-9_-]+::[A-Za-z0-9_-]+\]/.test(replyTo)) {
      return dispatch(env, "telegram-reply", { ...base, reply_to_text: replyTo, text: message.text });
    }
    // Slash command or /start deep link — routed with no LLM in the loop.
    if (message.text.startsWith("/")) {
      return dispatch(env, "telegram-command", { ...base, text: message.text });
    }
    // Plain text — the agent interprets it (messages.yml runs the configured
    // harness: claude or grok).
    return dispatch(env, "telegram-message", {
      ...base,
      message: message.text,
      update_id: update.update_id,
    });
  },
};

// --- OpenTelemetry (opt-in + no-op) ----------------------------------------
// Mirrors scripts/langfuse-otel.sh: traces are exported only when the operator
// sets OTEL_EXPORTER_OTLP_ENDPOINT (a Worker var/secret). The Node OTEL SDK does
// not run on the Workers runtime, so this uses @microlabs/otel-cf-workers, which
// wraps the fetch handler and also traces the outbound GitHub/Telegram calls as
// child spans. Requires `nodejs_compat` (AsyncLocalStorage) — set in wrangler.toml.
//
// Worker env is per-request (not module scope), so the wrapped handler is built
// lazily on the first request that has telemetry configured and cached in the
// warm isolate; with no endpoint set, the raw handler runs untouched.
function otelConfig(env) {
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/+$/, "");
  const url = base.endsWith("/v1/traces") ? base : `${base}/v1/traces`;
  const headers = {};
  for (const pair of (env.OTEL_EXPORTER_OTLP_HEADERS || "").split(",")) {
    const eq = pair.indexOf("=");
    if (eq > 0) headers[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return {
    exporter: { url, headers },
    service: { name: env.OTEL_SERVICE_NAME || "aeon-webhook" },
  };
}

let instrumented;
export default {
  fetch(request, env, ctx) {
    if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      instrumented ||= instrument(handler, otelConfig);
      return instrumented.fetch(request, env, ctx);
    }
    return handler.fetch(request, env, ctx);
  },
};

// Relay a classified update to the Aeon fork via repository_dispatch.
async function dispatch(env, eventType, clientPayload) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "aeon-telegram-webhook",
    },
    body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
  });
  // On failure return non-2xx so Telegram retries later (dedupe is by update_id /
  // callback id). On success return 200 so the update is never redelivered.
  if (!res.ok) {
    return new Response(`dispatch failed: ${res.status}`, { status: 502 });
  }
  return new Response("ok", { status: 200 });
}

// Stop the spinning loader on a tapped inline button. Best-effort; never throws.
async function answerCallback(env, callbackQueryId) {
  if (!callbackQueryId) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  } catch {
    /* ignore */
  }
}

// Send a short plain message. Best-effort; never throws.
async function sendMessage(env, chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    /* ignore */
  }
}
