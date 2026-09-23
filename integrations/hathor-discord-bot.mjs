#!/usr/bin/env node
// hathor-discord-bot.mjs — Hathor on Discord: a THIN LIMB of the ONE brain, NO LLM / NO GPU needed now.
//
// Architecture (already built): there is ONE Hathor — integrations/hathor-agency-server.mjs holds her
// self, memory, and voice (which drops to the Decades Brain when no GPU is present). Every surface is a
// thin limb that POSTs what it hears to /perceive and speaks back her reply. This is the Discord limb:
// it connects to the Discord gateway (OUTBOUND WebSocket only — no inbound port, safe on the vault box),
// forwards conversation to the brain, and answers deterministic !commands locally via the commands engine.
//
//   HATHOR_BRAIN_URL=http://127.0.0.1:8175 DISCORD_BOT_TOKEN=... node integrations/hathor-discord-bot.mjs
//
// The token is read from env, never logged. handleMessage() is exported and pure (perceive + send + a
// command runner are all injectable) so `node --test` runs fully offline.

import { dispatch } from '../commands/index.js';

const API = 'https://discord.com/api/v10';
const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
// GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT | DIRECT_MESSAGES
export const INTENTS = (1 << 0) | (1 << 9) | (1 << 15) | (1 << 12);

const TOKEN = () => (process.env.DISCORD_BOT_TOKEN || '').trim();
const BRAIN_URL = () => (process.env.HATHOR_BRAIN_URL || 'http://127.0.0.1:8175').replace(/\/$/, '');
const log = (...a) => console.log('[hathor-discord]', ...a);

// ── the ONE brain: POST what we heard to /perceive, get her reply back (surface = 'discord') ─────────
export async function perceive(text, { from = 'someone', fetchImpl = fetch, brainUrl = BRAIN_URL() } = {}) {
  try {
    const r = await fetchImpl(`${brainUrl}/perceive`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ surface: 'discord', from, text }),
    });
    const j = await r.json().catch(() => null);
    return (j && (j.reply || (j.result && j.result.reply))) || '';
  } catch { return ''; }
}

// ── REST: post a message (chunked to Discord's 2000-char limit; suppress mention pings) ──────────────
export async function sendMessage(channelId, content, { fetchImpl = fetch, token = TOKEN() } = {}) {
  const body = String(content || '').slice(0, 1990);
  if (!body) return { ok: false, skipped: 'empty' };
  const r = await fetchImpl(`${API}/channels/${encodeURIComponent(channelId)}/messages`, {
    method: 'POST',
    headers: { authorization: `Bot ${token}`, 'content-type': 'application/json', 'user-agent': 'Hathor (melek, 1.0)' },
    body: JSON.stringify({ content: body, allowed_mentions: { parse: [] } }),
  }).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
  return { ok: !!(r && r.ok), status: r && r.status };
}

// Was Hathor addressed? mention, her name, or a leading ! command.
export function addressed(text, botUserId = '') {
  const t = String(text || '');
  return (botUserId && t.includes(`<@${botUserId}>`)) || (botUserId && t.includes(`<@!${botUserId}>`))
    || /^\s*!/.test(t) || /\bhathor\b/i.test(t);
}
const cleanQuery = (t, id) => String(t || '').replace(new RegExp(`<@!?${id}>`, 'g'), '').replace(/^\s*hathor[,:\s]*/i, '').trim();

// ── pure message handler: decide + send Hathor's reply. `send`, `runCommand`, `ask` all injectable. ──
export async function handleMessage(msg, {
  botUserId = '', send = sendMessage, runCommand = dispatch, ask = perceive, ctx = {},
} = {}) {
  if (!msg || !msg.author || msg.author.bot) return null;                 // never answer bots or ourselves
  if (msg.author.id && msg.author.id === botUserId) return null;
  const content = String(msg.content || '');
  if (!addressed(content, botUserId)) return null;                        // stay quiet unless spoken to
  const from = (msg.author && (msg.author.username || msg.author.id)) || 'someone';

  let reply = '', kind = '';
  if (/^\s*!/.test(content)) {                                            // deterministic !commands (chain/utility)
    const d = await runCommand(content.trim(), ctx);
    if (d && d.handled) { reply = d.reply || (d.error ? `⚠ ${d.error}` : ''); kind = 'command'; }
  }
  if (!reply) {                                                           // conversation → the one brain
    reply = await ask(cleanQuery(content, botUserId) || content, { from }); kind = kind || 'brain';
  }
  if (!reply) return { reply: null, kind: 'silent' };
  await send(msg.channel_id, reply, ctx.sendOpts || {});
  return { reply, kind };
}

// ── live gateway client (heartbeat + identify + reconnect). Runs only as a CLI, with a token. ────────
function run() {
  if (!TOKEN()) { console.error('FATAL: set DISCORD_BOT_TOKEN to run the bot.'); process.exit(1); }
  let ws, hb, seq = null, botUserId = '', alive = true;
  function connect() {
    ws = new WebSocket(GATEWAY);
    ws.addEventListener('open', () => log('gateway open'));
    ws.addEventListener('message', async (ev) => {
      let p; try { p = JSON.parse(ev.data); } catch { return; }
      if (p.s != null) seq = p.s;
      if (p.op === 10) {
        const iv = p.d.heartbeat_interval;
        clearInterval(hb); hb = setInterval(() => { try { ws.send(JSON.stringify({ op: 1, d: seq })); } catch {} }, iv);
        ws.send(JSON.stringify({ op: 2, d: {
          token: TOKEN(), intents: INTENTS,
          properties: { os: 'linux', browser: 'hathor', device: 'hathor' },
          presence: { status: 'online', activities: [{ name: '!help · the Temple Library', type: 0 }] },
        } }));
      } else if (p.op === 0) {
        if (p.t === 'READY') { botUserId = p.d.user && p.d.user.id; log('ready as', p.d.user && p.d.user.username, botUserId); }
        else if (p.t === 'MESSAGE_CREATE') {
          try { const r = await handleMessage(p.d, { botUserId }); if (r && r.reply) log('replied', r.kind, 'in', p.d.channel_id); }
          catch (e) { log('handle error', e && e.message); }
        }
      } else if (p.op === 7 || p.op === 9) { log('reconnect requested'); try { ws.close(); } catch {} }
    });
    ws.addEventListener('close', (e) => { clearInterval(hb); log('gateway closed', e && e.code, '→ reconnecting in 5s'); if (alive) setTimeout(connect, 5000); });
    ws.addEventListener('error', (e) => log('gateway error', e && (e.message || 'ws')));
  }
  process.on('SIGTERM', () => { alive = false; try { ws.close(); } catch {} process.exit(0); });
  connect();
  log('starting — brain at', BRAIN_URL());
}

if (import.meta.url === `file://${process.argv[1]}`) run();

export default { handleMessage, sendMessage, perceive, addressed, INTENTS };
