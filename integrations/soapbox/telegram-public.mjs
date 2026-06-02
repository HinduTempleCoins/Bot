// telegram-public.mjs — Hathor's PUBLIC Telegram bot. A separate, public-facing bot (its own
// @username + token) that anyone can DM — distinct from the private operator bridge. It runs the
// shared steemd query layer (price/clarity/markets/holders/chains/…/library), read-only, rate-limited.
// Dependency-free: long-polling via fetch (no framework vendored — cleaner for a focused command bot;
// grammY/Telegraf remain options if a richer framework is ever needed).
//
//   TELEGRAM_PUBLIC_BOT_TOKEN=<from @BotFather, stored in the vault> node integrations/soapbox/telegram-public.mjs
//
// Commands: /start /help, and /<steemd verb> (e.g. /price VKBT, /clarity vkbt, /markets, /library oilahuasca).
// Plain text is treated as a steemd query too. No keys beyond the bot token; never broadcasts, only replies.

import { runCommand } from './steemd.mjs';

const TOKEN = process.env.TELEGRAM_PUBLIC_BOT_TOKEN || '';
const API = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;
const SITE = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';

// simple per-chat rate limit: max ~1 msg / 2s, burst 5.
const buckets = new Map();
function allowed(chatId) {
  const now = Date.now(); const b = buckets.get(chatId) || { tokens: 5, ts: now };
  b.tokens = Math.min(5, b.tokens + (now - b.ts) / 2000); b.ts = now;
  if (b.tokens < 1) { buckets.set(chatId, b); return false; }
  b.tokens -= 1; buckets.set(chatId, b); return true;
}

async function tg(method, body) {
  const r = await fetch(API(method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}

const WELCOME = [
  '👋 I am Hathor, the MELEK AI Witness — the public face of SoapBox.',
  'Ask me about the markets (read-only, one source of truth):',
  '`/price <sym>` · `/clarity <sym>` · `/markets` · `/gainers` · `/chains` · `/trending` · `/ecosystem`',
  `Full site: ${SITE}`,
].join('\n');

async function handle(msg) {
  const chatId = msg.chat?.id; const text = (msg.text || '').trim();
  if (!chatId || !text) return;
  if (!allowed(chatId)) return; // silently drop floods
  if (/^\/start\b/i.test(text)) return void tg('sendMessage', { chat_id: chatId, text: WELCOME, parse_mode: 'Markdown', disable_web_page_preview: true });
  // /command args  OR  plain text → steemd query
  const q = text.replace(/^\/+/, '').replace(/@\w+bot/i, '').trim() || 'help';
  const r = await runCommand(q).catch((e) => ({ ok: false, text: 'error: ' + e.message }));
  await tg('sendMessage', { chat_id: chatId, text: r.text.slice(0, 3900), parse_mode: 'Markdown', disable_web_page_preview: true });
}

// long-polling loop
async function run() {
  if (!TOKEN) { console.error('TELEGRAM_PUBLIC_BOT_TOKEN not set (create the public bot via @BotFather, store the token in the vault).'); process.exit(2); }
  const me = await tg('getMe', {});
  console.log(`Hathor public Telegram bot live: @${me.result?.username || '?'}`);
  let offset = 0;
  for (;;) {
    try {
      const d = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
      for (const u of (d.result || [])) { offset = u.update_id + 1; if (u.message) await handle(u.message).catch(() => {}); }
    } catch (e) { await new Promise((r) => setTimeout(r, 3000)); }
  }
}

if (process.argv[1] && process.argv[1].endsWith('telegram-public.mjs')) run();
export { handle, WELCOME };
