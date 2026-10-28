// pentecaust/notifications.mjs — Pentecaust Notifications: the unread-message badge behind the
// ✉ letter icon in the nav bar, and the feed the Notifications page renders.
//
// There is no second message store. Messages live in messaging.mjs; this module only keeps a
// per-account READ MARKER per channel (`seen[account][channel] = lastSeenSeq`) and derives the
// unread set from the chat store through messaging's own `inboxFor` / `readChannel`. That means
// nothing here can disagree with what the messenger shows, and there is no way to inject a
// notification that is not a real message someone actually sent.
//
// Scope is DMs, deliberately: a notification's whole job is to deep-link into the thread, and the
// messenger's deep link is `pentecaust.com/?dm=<account>`. Team channels have no such link yet.
//
// Same persistence discipline as messaging.mjs / model.mjs: one JSON file, injectable fs,
// soft-fail-never-throw, offline-testable, no keys, no chain writes.
//
//   import { notificationsFor, unreadCountFor, markRead, markAllRead } from './notifications.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validAccountName } from '../signup/welcome-grant.mjs';
import { inboxFor, readChannel, dmChannelId } from './messaging.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export const NOTIFY_FILE = () => env('PENTECAUST_NOTIFY_DATA', join(process.cwd(), 'data', 'pentecaust-notify.json'));
/** Hard ceiling on items returned, so a flooded inbox can't produce an unbounded page. */
export const MAX_ITEMS = 100;
/** Per-thread scan ceiling — matches messaging's own per-channel ring buffer. */
const SCAN_LIMIT = 500;

const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};

function loadSeen(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { seen: {} };
  try {
    const o = JSON.parse(raw);
    return o && o.seen && typeof o.seen === 'object' ? { seen: o.seen } : { seen: {} };
  } catch { return { seen: {} }; }
}
function saveSeen(fs, file, store) {
  try { (fs.write || realFs.write)(file, JSON.stringify(store)); return true; } catch { return false; }
}

const ctx = (opts = {}) => ({
  fs: opts.fs || realFs,
  file: opts.file || NOTIFY_FILE(),
  chat: opts.chat || {},
});

const norm = (a) => String(a == null ? '' : a).toLowerCase();

/** The read marker for one channel. 0 means "never opened it". */
export function lastSeen(account, channel, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = norm(account);
  const per = loadSeen(fs, file).seen[who];
  const n = per && per[String(channel || '')];
  return Number(n) || 0;
}

/**
 * Unread notifications for `account`, newest thread first — one item per DM thread, carrying the
 * unread count and the latest unread line. `url` is the messenger deep link for that thread.
 * @returns {{ok:boolean, account:string, unread:number, threads:number, items:Array, reason?:string}}
 */
export function notificationsFor(account, { limit = MAX_ITEMS } = {}, opts = {}) {
  const who = norm(account);
  if (!validAccountName(who)) return { ok: false, reason: 'invalid account name', account: who, unread: 0, threads: 0, items: [] };
  const { chat } = ctx(opts);

  let threads = [];
  try { threads = inboxFor(who, chat) || []; } catch { threads = []; }

  const items = [];
  let unread = 0;
  for (const t of threads) {
    const channel = t && t.channel;
    if (!channel) continue;
    const since = lastSeen(who, channel, opts);
    let messages = [];
    try { messages = (readChannel(channel, { since, limit: SCAN_LIMIT }, chat) || {}).messages || []; } catch { messages = []; }
    // Only the other side's lines are notifications — your own sent messages never ping you.
    const incoming = messages.filter((m) => m && norm(m.from) !== who);
    if (!incoming.length) continue;
    const last = incoming[incoming.length - 1];
    unread += incoming.length;
    items.push({
      channel,
      with: t.with,
      count: incoming.length,
      from: last.from,
      text: last.text,
      seq: last.seq,
      ts: last.ts,
      game: last.game || null,
      surface: last.surface || null,
      // Deep link the messenger already understands (server.mjs line ~774: `?dm=<account>`).
      url: `/?dm=${encodeURIComponent(t.with)}`,
    });
  }

  items.sort((a, b) => (b.seq || 0) - (a.seq || 0));
  const cap = Math.max(1, Math.min(MAX_ITEMS, Number(limit) || MAX_ITEMS));
  return { ok: true, account: who, unread, threads: items.length, items: items.slice(0, cap) };
}

/** Just the badge number. */
export function unreadCountFor(account, opts = {}) {
  const r = notificationsFor(account, { limit: MAX_ITEMS }, opts);
  return r.ok ? r.unread : 0;
}

/**
 * Mark one thread read up to `seq` (default: everything currently in it). Markers only move
 * forward, so an out-of-order or replayed call can never un-read something.
 */
export function markRead(account, channel, seq = null, opts = {}) {
  const who = norm(account);
  if (!validAccountName(who)) return { ok: false, reason: 'invalid account name' };
  const ch = String(channel || '');
  if (!ch) return { ok: false, reason: 'channel required' };
  const { fs, file, chat } = ctx(opts);

  let upto = Number(seq) || 0;
  if (!upto) {
    let messages = [];
    try { messages = (readChannel(ch, { since: 0, limit: SCAN_LIMIT, tail: true }, chat) || {}).messages || []; } catch { messages = []; }
    upto = messages.length ? messages[messages.length - 1].seq : 0;
  }

  const store = loadSeen(fs, file);
  const per = store.seen[who] || (store.seen[who] = {});
  if (upto > (Number(per[ch]) || 0)) per[ch] = upto;
  saveSeen(fs, file, store);
  return { ok: true, account: who, channel: ch, lastSeen: per[ch] || 0 };
}

/** Mark the thread with one other account read — the common case when a notification is clicked. */
export function markReadWith(account, other, opts = {}) {
  const who = norm(account); const them = norm(other);
  if (!validAccountName(who) || !validAccountName(them)) return { ok: false, reason: 'invalid account name' };
  return markRead(who, dmChannelId(who, them), null, opts);
}

/** Clear the whole badge. */
export function markAllRead(account, opts = {}) {
  const who = norm(account);
  if (!validAccountName(who)) return { ok: false, reason: 'invalid account name' };
  const r = notificationsFor(who, { limit: MAX_ITEMS }, opts);
  let cleared = 0;
  for (const it of r.items) { if (markRead(who, it.channel, it.seq, opts).ok) cleared += 1; }
  return { ok: true, account: who, cleared };
}

// ── CLI (guarded) — offline demo on a temp store ──────────────────────────────────────────────────
if (process.argv[1] && /pentecaust\/notifications\.mjs$/.test(process.argv[1])) {
  const { postDM } = await import('./messaging.mjs');
  const dir = env('TMPDIR', '.');
  const chatFile = join(dir, `pentecaust-notif-chat-${process.pid}.json`);
  const seenFile = join(dir, `pentecaust-notif-seen-${process.pid}.json`);
  const C = { file: chatFile };
  const O = { file: seenFile, chat: C };

  console.log('Pentecaust Notifications — offline demo:\n');
  postDM({ from: 'hathor', to: 'ryan', text: 'The KULA bridge guide is up — want the walkthrough?', surface: 'website' }, C);
  postDM({ from: 'hathor', to: 'ryan', text: 'Also your witness feed published.', surface: 'website' }, C);
  postDM({ from: 'steve', to: 'ryan', text: 'raid at 8?', game: 'minecraft', surface: 'game' }, C);
  postDM({ from: 'ryan', to: 'steve', text: 'in', surface: 'website' }, C);

  let n = notificationsFor('ryan', {}, O);
  console.log(`  badge: ${n.unread} unread across ${n.threads} thread(s)`);
  for (const it of n.items) console.log(`   • @${it.from} (${it.count}): ${it.text}  -> ${it.url}`);

  console.log('\n  -- ryan opens the hathor thread --');
  markReadWith('ryan', 'hathor', O);
  n = notificationsFor('ryan', {}, O);
  console.log(`  badge: ${n.unread} unread across ${n.threads} thread(s)`);
  for (const it of n.items) console.log(`   • @${it.from} (${it.count}): ${it.text}  -> ${it.url}`);

  console.log('\n  -- mark all read --');
  markAllRead('ryan', O);
  console.log(`  badge: ${notificationsFor('ryan', {}, O).unread} unread`);
}
