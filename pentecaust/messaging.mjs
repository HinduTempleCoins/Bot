// pentecaust/messaging.mjs — Pentecaust Messaging chat: cross-game team channels + 1:1 PM/DM.
//
// The chat half of the team system. Two channel kinds, both keyed to MELEK account names (the one
// cross-game identity), so a member talks to their team or to a friend from ANY surface — in a PRANA
// game, in Minecraft, in the walking app, on the website, in Discord — and it all lands in the same
// thread. Every message carries WHERE it came from (game + surface), which is what makes "chat from
// different games" legible: the team channel shows "steve (from Minecraft): …" next to "alex (web): …".
//
//   • team channel  id = team:<teamId>     — gated to team members (model.isMember)
//   • DM / PM        id = dm:<a>__<b>       — 1:1, accounts sorted so either party resolves the same id
//
// Same persistence discipline as model.mjs / move-ledger.mjs: one JSON file, injectable fs, ring-buffered
// per channel so it can't grow forever, soft-fail-never-throw, offline-testable. Stores RAW text — the
// rendering surface escapes (teams/server.mjs + any game client). No keys, no chain writes.
//
//   import { postTeamMessage, postDM, readTeam, readDM, inboxFor, dmChannelId } from './messaging.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validAccountName } from '../signup/welcome-grant.mjs';
import { isMember as modelIsMember } from './model.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const CHAT_FILE = () => env('TEAMS_CHAT_DATA', join(process.cwd(), 'data', 'teams-chat.json'));
export const KEEP_PER_CHANNEL = () => Number(env('TEAMS_CHAT_KEEP', '500')) || 500;
const MAX_TEXT = 1000;
const now = (opts) => (opts && opts.now != null ? opts.now : Date.now());

const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { seq: 0, channels: {} };
  try { const o = JSON.parse(raw); return o && o.channels ? { seq: o.seq || 0, channels: o.channels } : { seq: 0, channels: {} }; }
  catch { return { seq: 0, channels: {} }; }
}
function saveStore(fs, file, store) { (fs.write || realFs.write)(file, JSON.stringify(store)); }
const ctx = (opts = {}) => ({ fs: opts.fs || realFs, file: opts.file || CHAT_FILE() });

// ── channel ids ───────────────────────────────────────────────────────────────────────────────────
export function teamChannelId(teamId) { return `team:${String(teamId || '')}`; }
/** DM channel id for a pair — sorted so (a,b) and (b,a) map to the SAME channel. */
export function dmChannelId(a, b) {
  const x = String(a || '').toLowerCase(); const y = String(b || '').toLowerCase();
  return `dm:${[x, y].sort().join('__')}`;
}
const slugTag = (s, max = 24) => String(s || '').toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);

// ── post ──────────────────────────────────────────────────────────────────────────────────────────
function append(store, channelId, msg) {
  const ch = store.channels[channelId] || (store.channels[channelId] = { messages: [] });
  ch.messages.push(msg);
  const keep = KEEP_PER_CHANNEL();
  if (ch.messages.length > keep) ch.messages = ch.messages.slice(-keep);   // ring buffer
}
function makeMessage(store, channel, from, text, opts) {
  store.seq += 1;
  return {
    seq: store.seq, channel, from: String(from).toLowerCase(), text: String(text).slice(0, MAX_TEXT),
    game: opts.game ? slugTag(opts.game) : null,        // e.g. 'minecraft', 'move', 'prana:tower-defense'
    surface: opts.surface ? slugTag(opts.surface, 16) : null,  // e.g. 'game', 'website', 'discord'
    ts: now(opts),
  };
}

/**
 * Post to a team channel. The sender MUST be a member (checked via the model store, overridable for tests).
 * @param {{teamId, from, text, game?, surface?}} m
 */
export function postTeamMessage(m = {}, opts = {}) {
  const from = String(m.from || '').toLowerCase();
  if (!validAccountName(from)) return { ok: false, reason: 'from must be a valid MELEK account name' };
  const text = String(m.text == null ? '' : m.text).trim();
  if (!text) return { ok: false, reason: 'empty message' };
  if (!m.teamId) return { ok: false, reason: 'teamId required' };
  // Membership is checked against the MODEL store (its own env file by default), NOT the chat-file opts —
  // pass opts.teamOpts to point the lookup at a specific roster file, or opts.isMember to inject it (tests).
  const member = (opts.isMember || modelIsMember)(m.teamId, from, opts.teamOpts || {});
  if (!member) return { ok: false, reason: 'only team members can post here' };
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const channel = teamChannelId(m.teamId);
  const msg = makeMessage(store, channel, from, text, m);
  append(store, channel, msg);
  saveStore(fs, file, store);
  return { ok: true, message: msg };
}

/**
 * Send a PM/DM. Both ends are MELEK accounts; you can't DM yourself. (Block-lists are a future layer.)
 * @param {{from, to, text, game?, surface?}} m
 */
export function postDM(m = {}, opts = {}) {
  const from = String(m.from || '').toLowerCase(); const to = String(m.to || '').toLowerCase();
  if (!validAccountName(from)) return { ok: false, reason: 'from must be a valid MELEK account name' };
  if (!validAccountName(to)) return { ok: false, reason: 'to must be a valid MELEK account name' };
  if (from === to) return { ok: false, reason: 'cannot DM yourself' };
  const text = String(m.text == null ? '' : m.text).trim();
  if (!text) return { ok: false, reason: 'empty message' };
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const channel = dmChannelId(from, to);
  const msg = makeMessage(store, channel, from, text, m);
  msg.to = to;
  append(store, channel, msg);
  saveStore(fs, file, store);
  return { ok: true, message: msg, channel };
}

// ── read ──────────────────────────────────────────────────────────────────────────────────────────
/**
 * Read a channel. Always returns oldest→newest with a `cursor` (the newest seq returned) for live polling.
 *   • forward catch-up (default): messages with seq > `since`, the FIRST `limit` of them.
 *   • latest-N on open (`tail:true`): the most recent `limit` messages (history view).
 */
export function readChannel(channelId, { since = 0, limit = 100, tail = false } = {}, opts = {}) {
  const { fs, file } = ctx(opts);
  const ch = loadStore(fs, file).channels[channelId];
  const cur = Number(since) || 0;
  if (!ch) return { ok: true, channel: channelId, messages: [], cursor: cur };
  const cap = Math.max(1, Math.min(500, limit));
  const after = ch.messages.filter((x) => x.seq > cur);
  const out = tail ? after.slice(-cap) : after.slice(0, cap);
  return { ok: true, channel: channelId, messages: out, cursor: out.length ? out[out.length - 1].seq : cur };
}
export function readTeam(teamId, page = {}, opts = {}) { return readChannel(teamChannelId(teamId), page, opts); }
export function readDM(a, b, page = {}, opts = {}) { return readChannel(dmChannelId(a, b), page, opts); }

/** A PM inbox: every DM thread `account` is part of, with the latest line + unread-since cursor. */
export function inboxFor(account, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = String(account || '').toLowerCase();
  const store = loadStore(fs, file);
  const prefix = `dm:`;
  const threads = [];
  for (const [id, ch] of Object.entries(store.channels)) {
    if (!id.startsWith(prefix)) continue;
    const pair = id.slice(prefix.length).split('__');
    if (!pair.includes(who)) continue;
    const other = pair.find((p) => p !== who) || pair[0];
    const last = ch.messages[ch.messages.length - 1] || null;
    threads.push({ with: other, channel: id, last, messages: ch.messages.length });
  }
  return threads.sort((a, b) => ((b.last && b.last.seq) || 0) - ((a.last && a.last.seq) || 0));
}

// ── CLI (guarded) — offline demo on temp stores (its own team + chat files) ────────────────────────
if (process.argv[1] && /teams\/messaging\.mjs$/.test(process.argv[1])) {
  const { createTeam, joinTeam } = await import('./model.mjs');
  const teamFile = `/tmp/teams-msg-team-${process.pid}.json`;
  const chatFile = `/tmp/teams-msg-chat-${process.pid}.json`;
  const T = { file: teamFile }; const C = { file: chatFile };
  const P = { file: chatFile, teamOpts: T };          // post to the chat store, check membership in the team store
  const team = createTeam({ name: 'Raiders', owner: 'ryan', kind: 'clan' }, T).team;
  joinTeam(team.id, 'steve', T); joinTeam(team.id, 'alex', T);
  console.log('MELEK Teams chat — offline demo:\n');
  postTeamMessage({ teamId: team.id, from: 'ryan', text: 'raid at 8, who is in?', surface: 'website' }, P);
  postTeamMessage({ teamId: team.id, from: 'steve', text: 'in — mining diamonds rn', game: 'minecraft', surface: 'game' }, P);
  postTeamMessage({ teamId: team.id, from: 'alex', text: 'walking over, brb', game: 'move', surface: 'game' }, P);
  for (const m of readTeam(team.id, {}, C).messages) console.log(`  [${team.tag || team.kind}] ${m.from}${m.game ? ` (from ${m.game})` : ''}: ${m.text}`);
  console.log('\n  -- PM --');
  postDM({ from: 'steve', to: 'alex', text: 'meet at the portal?', game: 'minecraft' }, C);
  postDM({ from: 'alex', to: 'steve', text: 'omw', surface: 'website' }, C);
  for (const m of readDM('steve', 'alex', {}, C).messages) console.log(`  ${m.from} → ${m.to}: ${m.text}`);
  console.log('\n  inbox(steve):', inboxFor('steve', C).map((t) => `${t.with} (${t.messages} msgs)`).join(', '));
  const fsmod = await import('node:fs');
  for (const f of [teamFile, chatFile]) { try { fsmod.unlinkSync(f); } catch {} }
}
