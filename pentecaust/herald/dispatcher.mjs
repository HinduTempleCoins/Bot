// pentecaust/herald/dispatcher.mjs — Herald's multi-channel TRIGGER DISPATCHER: the execution rail that
// turns a PLANNED action (from ifttt-triggers.fire() / flows) into a real message on a real channel.
//
// Herald could already PLAN ("nothing is executed, notified, posted, or paid" — ifttt-triggers.mjs) but had
// no rail to actually DELIVER a notification. This is that rail — the "executed, not just tracked" thesis for
// the trigger side. It fans one action out to any of:
//   • email    — reuses campaign-sender's ESP send seam (Resend/Postmark; unconfigured → soft no-op). Email is
//                the ONLY outbound message channel MELEK ships (CLAUDE.md: email only, no SMS).
//   • telegram — Telegram Bot API sendMessage, via the injectable fetch. Token+chat from env → else no-op.
//   • discord  — a Discord incoming-webhook POST, via the injectable fetch. URL from env/target → else no-op.
//   • webhook  — a generic JSON POST to an allow-listed http(s) URL. safeUrl blocks javascript:/data:/file:.
//   • inapp    — appended to a durable in-app inbox in the store. Always works; no network, no config.
//
// HARD boundaries (BRIEF.md §7, HERALD.md, MEMORY feedback-*):
//   • NEVER signs, pays, transfers, or broadcasts. The ifttt `reward` and `post` THEN-types are NOT delivered
//     here — they require the Signer / a chain op and are returned as { skipped:'requires-signer' }.
//   • Every channel is unconfigured → soft no-op (never sends in tests). Nothing throws — soft-fail always.
//   • Outbound webhook/discord destinations are safeUrl-guarded (scheme allow-list) — no open dispatch to a
//     javascript:/data:/file: target, no interpolation without esc().
//
// House style: ESM .mjs, esc() all interpolation, injectable fetch/store/clock/email seam, offline, soft-fail,
// handler(req,res) exported, CLI guarded.
//
//   import { createDispatcher, fromTrigger } from './dispatcher.mjs';
//   const d = createDispatcher({ storage, fetch: injectedFetch, sendEmail: injectedSend });
//   await d.dispatch({ channel: 'inapp', to: '@hathor', text: 'A trigger fired' });
//   await d.dispatchTriggers(store.fire(event));   // fan out ifttt-triggers.fire() output
//   d.inbox('@hathor');                            // read the in-app inbox

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { defaultSend as senderDefaultSend } from './campaign-sender.mjs';

const env = (k, d) => { const v = typeof process !== 'undefined' && process.env ? process.env[k] : undefined; return v == null || v === '' ? d : v; };

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MAX = 4000;
const clean = (s) => String(s == null ? '' : s).trim();
const clamp = (s, n = MAX) => clean(s).slice(0, n);

// The five channels this rail can deliver on. `reward`/`post` are deliberately NOT here (Signer/chain-only).
export const CHANNELS = ['email', 'telegram', 'discord', 'webhook', 'inapp'];
const isChannel = (c) => CHANNELS.includes(clean(c).toLowerCase());

// safeUrl — the open-dispatch guard: only http/https destinations pass. Everything else (javascript:, data:,
// file:, mailto:, relative, junk) → '' so the caller soft-skips. Mirrors campaign-sender's safeHref intent.
export function safeUrl(u) {
  const s = clean(u);
  if (!/^https?:\/\//i.test(s)) return '';
  try { const parsed = new URL(s); return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? s : ''; }
  catch { return ''; }
}

// ── SSRF blocklist ───────────────────────────────────────────────────────────────────────────────────────
// isPrivateIp(ip) — true if a literal IPv4/IPv6 address falls in a loopback / private / link-local / metadata
// range that must never be a dispatch target. Covers the classic SSRF vectors:
//   127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 (incl. 169.254.169.254 metadata),
//   0.0.0.0, ::1, ::, fc00::/7 (ULA), fe80::/10 (link-local), and IPv4-mapped IPv6 (::ffff:a.b.c.d).
export function isPrivateIp(ip) {
  const s = clean(ip).toLowerCase();
  if (!s) return true; // unknown → treat as unsafe (fail closed)
  const fam = isIP(s);
  if (fam === 4) return isPrivateV4(s);
  if (fam === 6) {
    if (s === '::1' || s === '::' || s === '::0') return true;
    // IPv4-mapped / -compatible: pull the trailing dotted-quad and test it as v4.
    const mapped = s.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
    if (mapped && isIP(mapped[1]) === 4) return isPrivateV4(mapped[1]);
    // Expand the leading group enough to test fc00::/7 (fc,fd) and fe80::/10 (fe8..feb).
    const head = s.split('%')[0].split(':').filter(Boolean)[0] || '';
    const h = parseInt(head.padEnd(4, '0').slice(0, 4), 16);
    if (Number.isFinite(h)) {
      if ((h & 0xfe00) === 0xfc00) return true;              // fc00::/7
      if ((h & 0xffc0) === 0xfe80) return true;              // fe80::/10
    }
    return false;
  }
  return true; // not a literal IP handled here → caller resolves hostnames separately; fail closed on junk
}

function isPrivateV4(ip) {
  const p = ip.split('.').map((n) => parseInt(n, 10));
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true;                                  // 0.0.0.0/8 (incl. 0.0.0.0)
  if (a === 127) return true;                                // 127.0.0.0/8 loopback
  if (a === 10) return true;                                 // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;          // 172.16.0.0/12
  if (a === 192 && b === 168) return true;                   // 192.168.0.0/16
  if (a === 169 && b === 254) return true;                   // 169.254.0.0/16 (link-local incl. metadata)
  if (a >= 224) return true;                                 // 224.0.0.0/4 multicast + 240/4 reserved
  return false;
}

// A literal-IP URL is a hostname that is itself an IP — the most common SSRF payload. Block it synchronously.
function hostIsLiteralIp(host) { return isIP(clean(host).replace(/^\[|\]$/g, '')) !== 0; }

// The injectable DNS resolver seam. Default = node dns.lookup (real); tests inject a fake so they stay offline.
// Returns a promise of the resolved IP string, or '' on failure (→ treated as unsafe).
function defaultResolve(host) {
  return new Promise((resolve) => {
    try { dnsLookup(clean(host), { all: false }, (err, address) => resolve(err ? '' : String(address || ''))); }
    catch { resolve(''); }
  });
}

// ssrfSafe(url, resolver) — the full guard AFTER safeUrl(): reject any destination that is, or resolves to, a
// loopback/private/link-local/metadata IP. Literal-IP hosts are checked directly (no network); hostnames go
// through the injectable resolver so tests never hit the network. Returns { ok, ip?, reason? }. Never throws.
async function ssrfSafe(url, resolver) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    if (hostIsLiteralIp(host)) {
      return isPrivateIp(host) ? { ok: false, reason: 'ssrf-blocked-ip' } : { ok: true, ip: host };
    }
    const resolveFn = typeof resolver === 'function' ? resolver : defaultResolve;
    const ip = clean(await resolveFn(host));
    if (!ip) return { ok: false, reason: 'ssrf-unresolved' };
    if (isPrivateIp(ip)) return { ok: false, reason: 'ssrf-blocked-resolved' };
    return { ok: true, ip };
  } catch { return { ok: false, reason: 'ssrf-error' }; }
}

// Discord destinations are additionally restricted to the exact Discord webhook hosts (parsed-host equality).
const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com']);
function isDiscordHost(url) {
  try { return DISCORD_HOSTS.has(new URL(url).hostname.toLowerCase()); } catch { return false; }
}

// ── module-level injectable fetch (per-instance override wins) ──────────────────────────────────────────
let _fetch = null;
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : null; }

// ── in-memory store shape (durable to the caller when a storage object is passed) ───────────────────────
function normStore(storage) {
  const s = storage && typeof storage === 'object' ? storage : {};
  if (!Array.isArray(s.inbox)) s.inbox = [];
  if (!Array.isArray(s.log)) s.log = [];
  return s;
}

/**
 * fromTrigger(planned) — map ONE ifttt-triggers planned action to a dispatch spec. Pure; never throws.
 * ifttt THEN-types:
 *   notify  → in-app inbox (default) — a durable, no-network ping to the target (e.g. @hathor).
 *   webhook → the generic webhook channel, target = the URL.
 *   reward  → NOT dispatched (pays — Signer only) → { channel:'inapp', requiresSigner:true } record only.
 *   post    → NOT dispatched (broadcasts — Signer only) → same.
 * A recipe may name an explicit `channel` (email/telegram/discord) in its then.channel; honored when valid.
 */
export function fromTrigger(planned) {
  const p = planned && typeof planned === 'object' ? planned : {};
  const action = clean(p.action || p.then?.type).toLowerCase();
  const target = clamp(p.target ?? p.then?.target, 500);
  const explicit = clean(p.channel || p.then?.channel).toLowerCase();
  const name = clamp(p.name || p.recipeId, 200);
  const text = clamp(p.text || (name ? `Trigger fired: ${name}` : 'A Herald trigger fired'), 1000);

  if (action === 'reward' || action === 'post') {
    // Money/broadcast — the dispatcher must never do these. Record as an in-app note flagged for the Signer.
    return { channel: 'inapp', to: target || '@hathor', subject: `Trigger (${action})`, text: `${text} — ${action}: ${target}`, requiresSigner: true, triggerAction: action };
  }
  if (action === 'webhook') {
    return { channel: 'webhook', url: target, to: target, subject: 'Herald trigger', text, triggerAction: action };
  }
  // notify (or anything else): honor an explicit valid channel, else fall to the always-safe in-app inbox.
  const channel = isChannel(explicit) ? explicit : 'inapp';
  return { channel, to: target || '@hathor', url: channel === 'discord' || channel === 'webhook' ? safeUrl(target) : undefined, subject: 'Herald notification', text, triggerAction: action || 'notify' };
}

export function createDispatcher(opts = {}) {
  const store = normStore(opts.storage);
  const clock = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const ts = () => { try { const n = Number(clock()); return Number.isFinite(n) ? n : 0; } catch { return 0; } };
  const fetchFn = () => (typeof opts.fetch === 'function' ? opts.fetch : (typeof _fetch === 'function' ? _fetch : (typeof globalThis !== 'undefined' && globalThis.fetch)));
  // email seam — default reuses campaign-sender's env-driven ESP (unconfigured → soft no-op). Injectable.
  const sendEmail = typeof opts.sendEmail === 'function' ? opts.sendEmail : senderDefaultSend;
  // DNS resolver seam for the SSRF guard — default node dns.lookup; tests inject a fake so they stay offline.
  const resolver = typeof opts.resolve === 'function' ? opts.resolve : null;
  // /api/dispatch auth — a constant-time shared secret. Unset → the HTTP dispatch endpoint FAILS CLOSED
  // (401 for every caller), so an untrusted caller can never invoke webhook/discord dispatch. Lib calls
  // (dispatch/dispatchTriggers) are trusted in-process and are not gated here.
  const dispatchSecret = typeof opts.dispatchSecret === 'string' ? opts.dispatchSecret : (env('HERALD_DISPATCH_SECRET', '') || '');
  function dispatchAuthOk(req) {
    if (!dispatchSecret) return false; // fail closed when unconfigured
    const got = String((req && req.headers && (req.headers['x-herald-dispatch-secret'] || req.headers['x-dispatch-secret'])) || '');
    const a = Buffer.from(got); const b = Buffer.from(String(dispatchSecret));
    if (a.length !== b.length) return false;
    try { return timingSafeEqual(a, b); } catch { return false; }
  }

  // guardedPost(url, discordOnly) — the shared SSRF gate for the two outbound POST channels. After safeUrl()
  // it (a) optionally enforces the Discord host allow-list, (b) blocks literal/resolved private IPs, and
  // (c) returns a fetch that uses redirect:'manual' so a 30x can't bounce past the check to an internal IP.
  async function guardedFetch(url, init, { discordOnly = false } = {}) {
    const safe = safeUrl(url);
    if (!safe) return { ok: false, skipped: 'no-url' };
    if (discordOnly && !isDiscordHost(safe)) return { ok: false, skipped: 'discord-host-refused' };
    const ssrf = await ssrfSafe(safe, resolver);
    if (!ssrf.ok) return { ok: false, skipped: ssrf.reason };
    const f = fetchFn();
    if (typeof f !== 'function') return { ok: false, skipped: 'no-fetch' };
    // redirect:'manual' — never auto-follow a 30x to an unvalidated (possibly internal) hop.
    const r = await f(safe, { ...init, redirect: 'manual' });
    const status = (r && r.status) || 0;
    // A redirect response is refused rather than followed (defense against post-check bounce to internal IP).
    if (status >= 300 && status < 400) return { ok: false, skipped: 'redirect-refused' };
    return { ok: true, status };
  }

  const record = (r) => { try { store.log.push({ ...r, at: ts() }); if (store.log.length > 5000) store.log.splice(0, store.log.length - 5000); } catch {} return r; };

  // ── per-channel delivery (each async, soft-fail-never-throw, unconfigured → { sent:false, skipped }) ────
  async function deliverInapp(msg) {
    const rec = { to: clamp(msg.to || '@hathor', 200), subject: clamp(msg.subject, 300), text: clamp(msg.text, 2000), at: ts(), read: false };
    try { store.inbox.push(rec); if (store.inbox.length > 10000) store.inbox.splice(0, store.inbox.length - 10000); } catch {}
    return { ok: true, sent: true, channel: 'inapp', requiresSigner: msg.requiresSigner === true };
  }

  async function deliverEmail(msg) {
    const to = clean(msg.to);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: true, sent: false, channel: 'email', skipped: 'no-recipient' };
    try {
      const r = await sendEmail({ to, subject: clamp(msg.subject, 300) || 'Herald', text: clamp(msg.text, 4000), html: msg.html ? clamp(msg.html, 8000) : undefined, unsubUrl: msg.unsubUrl });
      const res = r && typeof r === 'object' ? r : {};
      return { ok: res.ok !== false, sent: res.sent === true, channel: 'email', skipped: res.skipped, error: res.error };
    } catch (e) { return { ok: false, sent: false, channel: 'email', error: clamp((e && e.message) || 'email error', 200) }; }
  }

  async function deliverTelegram(msg) {
    const token = clean(env('HERALD_TELEGRAM_BOT_TOKEN', ''));
    const chat = clean(msg.to) || clean(env('HERALD_TELEGRAM_CHAT_ID', ''));
    if (!token || !chat) return { ok: true, sent: false, channel: 'telegram', skipped: 'telegram-unconfigured' };
    const f = fetchFn();
    if (typeof f !== 'function') return { ok: true, sent: false, channel: 'telegram', skipped: 'no-fetch' };
    try {
      const r = await f(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: clamp(msg.text, 4000) || '(no text)', disable_web_page_preview: true }),
      });
      const status = (r && r.status) || 0;
      if (status >= 400) return { ok: false, sent: false, channel: 'telegram', error: `telegram ${status}` };
      return { ok: true, sent: true, channel: 'telegram' };
    } catch (e) { return { ok: false, sent: false, channel: 'telegram', error: clamp((e && e.message) || 'telegram error', 200) }; }
  }

  async function deliverDiscord(msg) {
    const raw = clean(msg.url || env('HERALD_DISCORD_WEBHOOK_URL', ''));
    if (!raw) return { ok: true, sent: false, channel: 'discord', skipped: 'discord-unconfigured' };
    try {
      const g = await guardedFetch(raw, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: clamp(msg.text, 2000) || '(no text)' }),
      }, { discordOnly: true });
      // A refused destination (bad url / non-discord host / private-IP / redirect) is a soft no-op, never a send.
      if (!g.ok) return { ok: true, sent: false, channel: 'discord', skipped: g.skipped === 'no-url' ? 'discord-unconfigured' : g.skipped };
      if (g.status >= 400) return { ok: false, sent: false, channel: 'discord', error: `discord ${g.status}` };
      return { ok: true, sent: true, channel: 'discord' };
    } catch (e) { return { ok: false, sent: false, channel: 'discord', error: clamp((e && e.message) || 'discord error', 200) }; }
  }

  async function deliverWebhook(msg) {
    const raw = clean(msg.url || msg.to);
    if (!raw) return { ok: true, sent: false, channel: 'webhook', skipped: 'webhook-no-url' };
    try {
      const g = await guardedFetch(raw, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: clamp(msg.subject, 300), text: clamp(msg.text, 4000), source: 'herald', at: ts() }),
      });
      // A refused destination (bad url / private-IP / redirect) is a soft no-op, never a send.
      if (!g.ok) return { ok: true, sent: false, channel: 'webhook', skipped: g.skipped === 'no-url' ? 'webhook-no-url' : g.skipped };
      if (g.status >= 400) return { ok: false, sent: false, channel: 'webhook', error: `webhook ${g.status}` };
      return { ok: true, sent: true, channel: 'webhook' };
    } catch (e) { return { ok: false, sent: false, channel: 'webhook', error: clamp((e && e.message) || 'webhook error', 200) }; }
  }

  const DELIVER = { email: deliverEmail, telegram: deliverTelegram, discord: deliverDiscord, webhook: deliverWebhook, inapp: deliverInapp };

  /**
   * dispatch(msg) — deliver ONE message on its channel. msg = { channel, to, subject, text, html?, url? }.
   * Returns { ok, channel, sent, skipped?, error? }. Never throws. Unknown channel → soft error (no send).
   */
  async function dispatch(msg) {
    const m = msg && typeof msg === 'object' ? msg : {};
    const channel = clean(m.channel).toLowerCase();
    if (!isChannel(channel)) return record({ ok: false, sent: false, channel: channel || '(none)', error: 'unknown-channel' });
    const out = await DELIVER[channel](m);
    return record(out);
  }

  async function dispatchAll(msgs) {
    if (!Array.isArray(msgs)) return [];
    const out = [];
    for (const m of msgs) out.push(await dispatch(m)); // sequential — deterministic ordering for tests
    return out;
  }

  // dispatchTriggers(plannedActions) — the ifttt bridge: map each fired action via fromTrigger, then deliver.
  async function dispatchTriggers(plannedActions) {
    if (!Array.isArray(plannedActions)) return [];
    return dispatchAll(plannedActions.map(fromTrigger));
  }

  // inbox(target?) — read the in-app inbox (copies), newest last. Filter by target when given.
  function inbox(target) {
    const t = clean(target);
    return store.inbox.filter((r) => !t || r.to === t).map((r) => ({ ...r }));
  }

  function configured() {
    return {
      email: !!(env('HERALD_SEND_FROM', '') && (env('RESEND_API_KEY', '') || env('POSTMARK_SERVER_TOKEN', ''))),
      telegram: !!(env('HERALD_TELEGRAM_BOT_TOKEN', '') && env('HERALD_TELEGRAM_CHAT_ID', '')),
      discord: !!safeUrl(env('HERALD_DISCORD_WEBHOOK_URL', '')),
      webhook: true, // always available (per-message URL)
      inapp: true,   // always available (no config)
    };
  }

  // ── HTTP surface ───────────────────────────────────────────────────────────────────────────────────────
  const sendJson = (res, sc, obj) => {
    try { res.writeHead(sc, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); } catch {}
    try { res.end(JSON.stringify(obj)); } catch {}
  };

  async function handler(req, res) {
    try {
      const method = ((req && req.method) || 'GET').toUpperCase();
      const rawUrl = String((req && req.url) || '/');
      const qi = rawUrl.indexOf('?');
      const path = (qi >= 0 ? rawUrl.slice(0, qi) : rawUrl).replace(/\/+$/, '') || '/';
      const query = new URLSearchParams(qi >= 0 ? rawUrl.slice(qi + 1) : '');

      if (path === '/health' && method === 'GET') {
        return sendJson(res, 200, { ok: true, service: 'herald-dispatcher', channels: CHANNELS, configured: configured() });
      }
      if (path === '/api/inbox' && method === 'GET') {
        return sendJson(res, 200, { ok: true, messages: inbox(query.get('target') || '') });
      }
      if (path === '/api/dispatch' && method === 'POST') {
        // Auth REQUIRED + fail-closed: an untrusted caller must never be able to invoke webhook/discord
        // dispatch. Unset secret → 401 for everyone (same pattern as campaign-sender's /api/webhook).
        if (!dispatchAuthOk(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
        const body = await readJsonBody(req);
        if (Array.isArray(body && body.actions)) {
          const results = await dispatchTriggers(body.actions);
          return sendJson(res, 200, { ok: true, results });
        }
        if (Array.isArray(body && body.messages)) {
          const results = await dispatchAll(body.messages);
          return sendJson(res, 200, { ok: true, results });
        }
        const result = await dispatch(body || {});
        return sendJson(res, result.ok ? 200 : 400, { ok: result.ok, result });
      }
      return sendJson(res, 404, { ok: false, reason: 'not-found' });
    } catch { return sendJson(res, 500, { ok: false, reason: 'error' }); }
  }

  return { dispatch, dispatchAll, dispatchTriggers, fromTrigger, inbox, configured, handler, store };
}

function readJsonBody(req, max = 262144) {
  if (req && req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    try {
      let data = ''; let over = false;
      if (!req || typeof req.on !== 'function') return resolve({});
      req.on('data', (c) => { data += c; if (data.length > max) { over = true; try { req.destroy(); } catch {} } });
      req.on('end', () => { if (over) return resolve({}); try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    } catch { resolve({}); }
  });
}

// A shared singleton so a mounted handler is stateful (in-app inbox persists across requests), like ifttt/ad.
let _singleton = null;
function shared() { if (!_singleton) _singleton = createDispatcher(); return _singleton; }
export const handler = (req, res) => shared().handler(req, res);
export { readJsonBody };

// ── CLI (guarded) — demo a fan-out against an in-memory store, no network, no config (all soft no-ops) ──────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  (async () => {
    const d = createDispatcher();
    const planned = [
      { action: 'notify', target: '@hathor', name: 'Ping me on #melek' },
      { action: 'webhook', target: 'https://example.invalid/hook', name: 'Tag trended' },
      { action: 'reward', target: '10 MELEK', name: 'Reward the launch' }, // requires-signer → not sent
      { action: 'notify', target: 'ops@example.com', channel: 'email', name: 'Email ops' },
    ];
    const results = await d.dispatchTriggers(planned);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ results, inbox: d.inbox(), configured: d.configured() }, null, 2));
  })();
}
