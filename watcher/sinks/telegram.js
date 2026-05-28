/**
 * watcher/sinks/telegram.js — Telegram Bot API sink.
 *
 * Enabled when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set. Posts via
 * the public Bot API:
 *   https://api.telegram.org/bot<TOKEN>/sendMessage
 *
 * Operator setup (one-time):
 *   1. Talk to @BotFather on Telegram, /newbot, save the token.
 *   2. Start a chat with your new bot. (Or add it to a group.)
 *   3. Get the chat_id: GET https://api.telegram.org/bot<TOKEN>/getUpdates
 *      after sending a message — chat_id is in the response.
 *   4. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.
 *
 * Failure modes are not exceptions — we return { ok: false, error } so the
 * orchestrator can log them without breaking other sinks. The file sink
 * always succeeds, so an operator who never set Telegram up still has a
 * record of every alert.
 *
 * Message format: subject + body, Markdown disabled (chain data contains
 * underscores and brackets that Telegram's parser mangles).
 */

export const name = 'telegram';

export function enabled(config) {
  return Boolean(config?.sinks?.telegram?.botToken && config?.sinks?.telegram?.chatId);
}

export async function send(event, alert, config, { fetchImpl } = {}) {
  const { botToken, chatId } = config.sinks.telegram;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const text = `${alert.subject}\n\n${alert.body}`;
  const doFetch = fetchImpl || globalThis.fetch;
  if (!doFetch) {
    return { ok: false, error: 'no fetch available (Node 18+ or pass fetchImpl)' };
  }
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      // Don't include the body in the error — Telegram echoes the request,
      // which would re-log the alert content but truncated; keep it terse.
      return { ok: false, error: `telegram HTTP ${res.status}` };
    }
    return { ok: true, info: { status: res.status } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
