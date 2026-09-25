// pentecaust-community.mjs — Pentecaust F3: Discord + Telegram group & bot management for the creator
// hub. From the hub a creator seeds a Discord server (channels/roles), sets a welcome/moderation flow,
// and posts to Discord/Telegram. It builds ON the existing live Discord surface (index.js, the
// one-Hathor-brain bot) conceptually — this module is the MULTI-TENANT, keyless-to-us layer: every
// creator connects THEIR OWN bot token.
//
// KEY CUSTODY (BRIEF.md §7, CLAUDE.md): we hardcode NO bot token. Each creator's Discord/Telegram bot
// token lives server-side in the operator vault and is passed into these functions at
// call time. Tokens are never logged, never returned in results, never committed. All network access
// goes through an injected fetch (__setFetch) so tests never touch the wire; every adapter
// SOFT-FAILS to { ok:false, ... } and never throws.
//
//   import { DEFAULT_SERVER_PLAN, DEFAULT_MODERATION, seedDiscord, sendDiscord, sendTelegram,
//            getDiscordBotUser, getTelegramBotUser, buildConnectors, __setFetch }
//     from './pentecaust-community.mjs'
//   node integrations/pentecaust-community.mjs           -> prints the default plan (no network)

let _fetch = (...a) => fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => fetch(...a)); }

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const str = (v) => (v == null ? '' : String(v)).trim();
const DISCORD_API = 'https://discord.com/api/v10';
const TELEGRAM_API = 'https://api.telegram.org';
const UA = process.env.PENTECAUST_UA || 'MELEK-Pentecaust/1.0 (creator-hub; contact: hathor@melek.salon)';

// Discord channel type ids (subset we seed): https://discord.com/developers/docs/resources/channel
export const DISCORD_CHANNEL_TYPES = Object.freeze({ text: 0, voice: 2, category: 4, announcement: 5, forum: 15 });

// ── DEFAULT SERVER / GROUP SEED ──────────────────────────────────────────────────────────────────
// A sensible starter community layout for a V-Tuber / creator: categories → channels, plus roles.
// A creator can override any of it; this is the default `plan` passed to seedDiscord().
export const DEFAULT_SERVER_PLAN = Object.freeze({
  roles: Object.freeze([
    { name: 'Moderator', color: 0x5865f2, hoist: true, mentionable: true, permissions: '0' },
    { name: 'Subscriber', color: 0xf1c40f, hoist: true, mentionable: true, permissions: '0' },
    { name: 'Member', color: 0x2ecc71, hoist: false, mentionable: false, permissions: '0' },
  ]),
  categories: Object.freeze([
    { name: 'WELCOME', channels: [
      { name: 'rules', type: 'text', topic: 'Community rules — read before posting.' },
      { name: 'announcements', type: 'announcement', topic: 'Show times, drops, and news.' },
      { name: 'introductions', type: 'text', topic: 'Say hi 👋' },
    ] },
    { name: 'SHOW', channels: [
      { name: 'live-chat', type: 'text', topic: 'Chat during the live show.' },
      { name: 'clips', type: 'text', topic: 'Best moments & clips.' },
      { name: 'stage', type: 'voice', topic: '' },
    ] },
    { name: 'COMMUNITY', channels: [
      { name: 'general', type: 'text', topic: 'Hang out.' },
      { name: 'art-and-oc', type: 'text', topic: 'Fan art & original characters.' },
      { name: 'support', type: 'text', topic: 'Questions and help.' },
    ] },
  ]),
});

// ── DEFAULT MODERATION + WELCOME FLOW ────────────────────────────────────────────────────────────
export const DEFAULT_MODERATION = Object.freeze({
  welcome: {
    channel: 'introductions',
    // {{member}} / {{server}} placeholders are filled by renderWelcome(); plain text (chat body).
    message: 'Welcome {{member}} to {{server}}! Check out the rules and say hi. The show goes live here — turn on announcements.',
    assignRole: 'Member',
  },
  autoMod: {
    blockInvites: true,        // strip discord.gg invite links from non-mods
    blockMassMention: true,    // >5 mentions in one message
    linkGuard: true,           // hold first-time links for review
    bannedWords: [],           // creator-populated
  },
  slowmodeSeconds: 0,
});

/** Fill {{member}} / {{server}} in a welcome template. Plain text; never throws. */
export function renderWelcome(template, { member = '', server = '' } = {}) {
  try {
    return String(template ?? '')
      .replace(/\{\{\s*member\s*\}\}/g, str(member))
      .replace(/\{\{\s*server\s*\}\}/g, str(server));
  } catch { return ''; }
}

// ── low-level HTTP (soft-fail; injected fetch; token never logged) ────────────────────────────────
async function httpJson(url, { method = 'GET', headers = {}, body } = {}) {
  try {
    const opts = { method, headers: { 'user-agent': UA, ...headers } };
    if (body !== undefined) { opts.body = typeof body === 'string' ? body : JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
    const r = await _fetch(url, opts);
    if (!r) return { ok: false, status: 0, error: 'no response' };
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    return { ok: !!r.ok, status: r.status ?? (r.ok ? 200 : 0), data };
  } catch (e) {
    return { ok: false, status: 0, error: e && e.message ? e.message : 'fetch failed' };
  }
}

function discordHeaders(token) { return { authorization: `Bot ${str(token)}` }; }

// ── DISCORD adapters ─────────────────────────────────────────────────────────────────────────────

/** Verify a Discord bot token by reading the bot user. Returns { ok, user? } — token never echoed. */
export async function getDiscordBotUser(token) {
  if (!str(token)) return { ok: false, error: 'missing token' };
  const r = await httpJson(`${DISCORD_API}/users/@me`, { headers: discordHeaders(token) });
  if (!r.ok) return { ok: false, status: r.status, error: r.error || 'discord auth failed' };
  const u = r.data || {};
  return { ok: true, user: { id: u.id, username: u.username, bot: !!u.bot } };
}

/** Send a message to a Discord channel. Soft-fails. */
export async function sendDiscord(token, channelId, content, { embeds } = {}) {
  if (!str(token)) return { ok: false, error: 'missing token' };
  if (!str(channelId)) return { ok: false, error: 'missing channelId' };
  const body = {};
  if (str(content)) body.content = str(content).slice(0, 2000); // Discord message cap
  if (Array.isArray(embeds) && embeds.length) body.embeds = embeds;
  if (!body.content && !body.embeds) return { ok: false, error: 'empty message' };
  const r = await httpJson(`${DISCORD_API}/channels/${encodeURIComponent(str(channelId))}/messages`, {
    method: 'POST', headers: discordHeaders(token), body,
  });
  return r.ok ? { ok: true, messageId: r.data && r.data.id } : { ok: false, status: r.status, error: r.error || 'send failed' };
}

/** Create one Discord role. */
async function createDiscordRole(token, guildId, role) {
  const body = {
    name: str(role.name) || 'role',
    permissions: str(role.permissions) || '0',
    hoist: !!role.hoist,
    mentionable: !!role.mentionable,
  };
  if (Number.isFinite(role.color)) body.color = role.color;
  const r = await httpJson(`${DISCORD_API}/guilds/${encodeURIComponent(str(guildId))}/roles`, {
    method: 'POST', headers: discordHeaders(token), body,
  });
  return r.ok ? { ok: true, id: r.data && r.data.id, name: body.name } : { ok: false, name: body.name, status: r.status, error: r.error || 'role create failed' };
}

/** Create one Discord channel (optionally under a parent category). */
async function createDiscordChannel(token, guildId, channel, parentId) {
  const type = DISCORD_CHANNEL_TYPES[str(channel.type)] ?? DISCORD_CHANNEL_TYPES.text;
  const body = { name: str(channel.name) || 'channel', type };
  if (str(channel.topic)) body.topic = str(channel.topic);
  if (str(parentId)) body.parent_id = str(parentId);
  const r = await httpJson(`${DISCORD_API}/guilds/${encodeURIComponent(str(guildId))}/channels`, {
    method: 'POST', headers: discordHeaders(token), body,
  });
  return r.ok ? { ok: true, id: r.data && r.data.id, name: body.name, type } : { ok: false, name: body.name, status: r.status, error: r.error || 'channel create failed' };
}

/**
 * Seed a Discord guild from a plan (defaults to DEFAULT_SERVER_PLAN): create roles, then categories,
 * then each category's channels linked to its parent. Every step is isolated and soft-fails; the
 * report says what was created and what failed. Never throws. Token never logged/returned.
 */
export async function seedDiscord(token, guildId, plan = DEFAULT_SERVER_PLAN) {
  const report = { ok: false, roles: [], categories: [], channels: [] };
  if (!str(token)) { report.error = 'missing token'; return report; }
  if (!str(guildId)) { report.error = 'missing guildId'; return report; }
  const p = plan && typeof plan === 'object' ? plan : DEFAULT_SERVER_PLAN;

  for (const role of (Array.isArray(p.roles) ? p.roles : [])) {
    report.roles.push(await createDiscordRole(token, guildId, role));
  }
  for (const cat of (Array.isArray(p.categories) ? p.categories : [])) {
    const catRes = await createDiscordChannel(token, guildId, { name: cat.name, type: 'category' });
    report.categories.push(catRes);
    const parentId = catRes.ok ? catRes.id : '';
    for (const ch of (Array.isArray(cat.channels) ? cat.channels : [])) {
      report.channels.push(await createDiscordChannel(token, guildId, ch, parentId));
    }
  }
  // also allow top-level channels not under a category
  for (const ch of (Array.isArray(p.channels) ? p.channels : [])) {
    report.channels.push(await createDiscordChannel(token, guildId, ch, ''));
  }
  const all = [...report.roles, ...report.categories, ...report.channels];
  report.ok = all.length > 0 && all.every((x) => x.ok);
  report.created = all.filter((x) => x.ok).length;
  report.failed = all.filter((x) => !x.ok).length;
  return report;
}

// ── TELEGRAM adapters ────────────────────────────────────────────────────────────────────────────
// Telegram Bot API: https://api.telegram.org/bot<token>/<method>. Token is in the URL path — build it
// here, never log the built URL.

function telegramUrl(token, method) { return `${TELEGRAM_API}/bot${str(token)}/${method}`; }

/** Verify a Telegram bot token via getMe. Returns { ok, user? }. */
export async function getTelegramBotUser(token) {
  if (!str(token)) return { ok: false, error: 'missing token' };
  const r = await httpJson(telegramUrl(token, 'getMe'));
  if (!r.ok || !r.data || r.data.ok !== true) return { ok: false, status: r.status, error: r.error || 'telegram auth failed' };
  const u = r.data.result || {};
  return { ok: true, user: { id: u.id, username: u.username, isBot: !!u.is_bot } };
}

/** Send a Telegram message. Soft-fails. `parseMode` optional ('HTML' | 'MarkdownV2'). */
export async function sendTelegram(token, chatId, text, { parseMode, disablePreview } = {}) {
  if (!str(token)) return { ok: false, error: 'missing token' };
  if (!str(chatId)) return { ok: false, error: 'missing chatId' };
  if (!str(text)) return { ok: false, error: 'empty message' };
  const body = { chat_id: str(chatId), text: str(text).slice(0, 4096) }; // Telegram message cap
  if (str(parseMode)) body.parse_mode = str(parseMode);
  if (disablePreview) body.disable_web_page_preview = true;
  const r = await httpJson(telegramUrl(token, 'sendMessage'), { method: 'POST', body });
  if (!r.ok || !r.data || r.data.ok !== true) return { ok: false, status: r.status, error: r.error || (r.data && r.data.description) || 'send failed' };
  return { ok: true, messageId: r.data.result && r.data.result.message_id };
}

// ── bridge to the F2 recipe engine ────────────────────────────────────────────────────────────────
// buildConnectors returns the connector map runRecipe() (pentecaust-recipes.mjs) dispatches to. It
// resolves an action's tokenRef against the vault via the INJECTED resolveToken(ref) -> token (async
// or sync). The raw token stays inside this closure: it is used for the one request and never stored
// on, or returned in, the recipe report. `onAnimation` handles the show-page overlay side (injected).
export function buildConnectors({ resolveToken, onAnimation, crossPostTargets = {} } = {}) {
  const resolve = async (ref) => {
    if (typeof resolveToken !== 'function') return '';
    try { return str(await resolveToken(str(ref))); } catch { return ''; }
  };
  return {
    'post-to-discord': async ({ tokenRef, channelId, text }) => {
      const token = await resolve(tokenRef);
      if (!token) return { ok: false, error: `no token for ref "${str(tokenRef)}"` };
      return sendDiscord(token, channelId, text);
    },
    'post-to-telegram': async ({ tokenRef, chatId, text, parseMode }) => {
      const token = await resolve(tokenRef);
      if (!token) return { ok: false, error: `no token for ref "${str(tokenRef)}"` };
      return sendTelegram(token, chatId, text, { parseMode });
    },
    'play-animation': async ({ animation, durationMs }) => {
      if (typeof onAnimation !== 'function') return { ok: false, error: 'no animation sink' };
      try { const r = await onAnimation({ animation, durationMs }); return r == null ? { ok: true } : r; }
      catch (e) { return { ok: false, error: e && e.message ? e.message : 'animation failed' }; }
    },
    'cross-post': async ({ targets, text }) => {
      const results = [];
      for (const t of (Array.isArray(targets) ? targets : [])) {
        const target = crossPostTargets[str(t)];
        if (typeof target !== 'function') { results.push({ target: str(t), ok: false, error: 'unknown target' }); continue; }
        try { const r = await target({ text }); results.push({ target: str(t), ...(r || { ok: true }) }); }
        catch (e) { results.push({ target: str(t), ok: false, error: e && e.message ? e.message : 'target failed' }); }
      }
      return { ok: results.length > 0 && results.every((r) => r.ok), results };
    },
  };
}

// ── demo (no network) ───────────────────────────────────────────────────────────────────────────
const isMain = (() => { try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; } })();
if (isMain) {
  const roles = DEFAULT_SERVER_PLAN.roles.map((r) => r.name).join(', ');
  const chans = DEFAULT_SERVER_PLAN.categories.map((c) => `${c.name}: ${c.channels.map((x) => x.name).join('/')}`).join(' | ');
  process.stdout.write(`Default plan — roles: ${roles}\n  ${chans}\n`);
  process.stdout.write(`Welcome: ${renderWelcome(DEFAULT_MODERATION.welcome.message, { member: '@alice', server: 'Aurora VTuber' })}\n`);
  process.stdout.write('(no token provided — no network calls made)\n');
}
