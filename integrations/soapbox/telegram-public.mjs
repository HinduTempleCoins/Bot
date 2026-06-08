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

import { runCommand, COMMANDS } from './steemd.mjs';
import { guardPublicReply, isInternalTopic, deflection } from '../public-guard.mjs';

// Token is read at call time (not frozen at import) so the service can be INSTALLED and started
// before the operator drops the token — it just idles. `hasToken()` is the single gate.
const tokenOf = () => (process.env.TELEGRAM_PUBLIC_BOT_TOKEN || '').trim();
export const hasToken = () => /\S/.test(tokenOf());
const API = (m) => `https://api.telegram.org/bot${tokenOf()}/${m}`;
const SITE = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';

// simple per-chat rate limit: max ~1 msg / 2s, burst 5.
const buckets = new Map();
function allowed(chatId) {
  const now = Date.now(); const b = buckets.get(chatId) || { tokens: 5, ts: now };
  b.tokens = Math.min(5, b.tokens + (now - b.ts) / 2000); b.ts = now;
  if (b.tokens < 1) { buckets.set(chatId, b); return false; }
  b.tokens -= 1; buckets.set(chatId, b); return true;
}

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function tg(method, body) {
  const r = await _fetch(API(method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}

const WELCOME = [
  '👋 I am Hathor, the MELEK AI Witness — the public face of SoapBox.',
  'Ask me about the markets (read-only, one source of truth):',
  '`/price <sym>` · `/clarity <sym>` · `/markets` · `/gainers` · `/chains` · `/trending` · `/ecosystem`',
  'The MELEK chain [TestNet not MELEK]: `/status` · `/hathor` · `/block` · `/witness` · `/account <name>` · `/feed`',
  'Or just ask a question — `/ask <anything>` reads the Resource Center for a cited answer.',
  `Full site: ${SITE}`,
].join('\n');

// Resource-Center Q&A — lazy, defensive: a missing module degrades to the steemd help, never throws.
let _rcP = null;
function loadResourceChat() {
  if (!_rcP) _rcP = import('../resource-center-chat.mjs').catch(() => null);
  return _rcP;
}

async function send(chatId, text) {
  const out = guardPublicReply(String(text || ''), { seed: Date.now() }).text;
  await tg('sendMessage', { chat_id: chatId, text: out.slice(0, 3900), parse_mode: 'Markdown', disable_web_page_preview: true });
}

async function handle(msg) {
  const chatId = msg.chat?.id; const text = (msg.text || '').trim();
  if (!chatId || !text) return;
  if (!allowed(chatId)) return; // silently drop floods
  if (/^\/start\b/i.test(text)) return void tg('sendMessage', { chat_id: chatId, text: WELCOME, parse_mode: 'Markdown', disable_web_page_preview: true });

  const q = text.replace(/^\/+/, '').replace(/@\w+bot/i, '').trim() || 'help';

  // The internal layers (briefs/annals/resident AI — the soapy.blog side of the line) are not a
  // public topic; deflect in-voice before any lookup.
  if (isInternalTopic(q)) return void send(chatId, deflection(Date.now()));

  // /ask <question> — or any plain text that isn't a known steemd verb → Resource Center Q&A.
  const verb = (q.split(/\s+/)[0] || '').toLowerCase();
  const isAsk = /^ask\b/i.test(q);
  if (isAsk || (!COMMANDS[verb] && /\s/.test(q))) {
    const rc = await loadResourceChat();
    if (rc?.handleChat) {
      const out = await rc.handleChat({ user: String(chatId), text: isAsk ? q.replace(/^ask\b\s*/i, '') : q }, {}).catch(() => null);
      if (out?.reply) return void send(chatId, out.reply);
    }
    // fall through to steemd (its unknown-verb guidance) if the resource layer is unavailable
  }

  const r = await runCommand(isAsk ? 'help' : q).catch((e) => ({ ok: false, text: 'error: ' + e.message }));
  await send(chatId, r.text);
}

// long-polling loop. Returns 'idle' (no token) or never (loops forever). NEVER throws, NEVER
// crashes on a missing token — the service unit can be installed/enabled before the token exists.
async function run() {
  if (!hasToken()) {
    // The one explicit, deploy-friendly idle path: log + exit 0 so systemd does NOT mark a failure.
    console.log('TELEGRAM_PUBLIC_BOT_TOKEN not set, public bot idle. ' +
      '(Create the public bot via @BotFather, drop the token in the vault/env, then restart.)');
    return 'idle';
  }
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

if (process.argv[1] && process.argv[1].endsWith('telegram-public.mjs')) {
  run().then((r) => { if (r === 'idle') process.exit(0); }).catch((e) => {
    // Last-resort guard: log and idle-exit rather than crash-loop.
    console.log('telegram-public: startup error, idling — ' + (e?.message || e)); process.exit(0);
  });
}
export { handle, WELCOME, run };
