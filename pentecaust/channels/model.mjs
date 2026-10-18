// pentecaust/channels/model.mjs — PACT CHANNELS: IRC-style chat rooms anyone signed in can start.
//
// What IRC users expect, kept: a channel is a `#name`; whoever starts it is its founder and an operator (@);
// ops set the topic, kick, ban, invite, give and take op (@) and voice (+), and set modes:
//   +m moderated  — only ops and voiced people can talk
//   +i invite-only — only invited people (and ops) can join
// The founder is permanent (the ChanServ registration IRC needs a bot for): nobody can de-op, kick or ban them.
// Presence is "seen in the room recently" (rooms are polled), which is what the user list shows.
//
// Identity is whatever the caller's Pact session resolved — a MELEK account or a social-login '~handle'.
// Same persistence discipline as the rest of pentecaust: one JSON file, injectable fs, ring-buffered
// messages per channel, soft-fail-never-throw, offline-testable. Stores RAW text; the page escapes it.
//
//   import { createChannel, listChannels, getChannel, joinChannel, roster, postMessage, readMessages,
//            runCommand, normName } from './channels/model.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const CHANNELS_FILE = () => env('PACT_CHANNELS_DATA', join(process.cwd(), 'data', 'pact-channels.json'));
const KEEP = () => Number(env('PACT_CHANNELS_KEEP', '500')) || 500;
export const PRESENCE_MS = 5 * 60 * 1000;
const MAX_TEXT = 1000;
const MAX_TOPIC = 200;
const now = (o) => (o && o.now != null ? o.now : Date.now());

const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
function load(o = {}) {
  const raw = (o.fs || realFs).read(o.file || CHANNELS_FILE());
  try { const j = JSON.parse(raw || ''); if (j && j.channels) return { seq: j.seq || 0, channels: j.channels }; } catch {}
  return { seq: 0, channels: {} };
}
function save(store, o = {}) { (o.fs || realFs).write(o.file || CHANNELS_FILE(), JSON.stringify(store)); }

/** '#Botanica' / 'botanica' → 'botanica'; null if not a valid channel name (2–30 of a-z 0-9 -). */
export function normName(s) {
  const n = String(s || '').trim().replace(/^#+/, '').toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,29}$/.test(n) ? n : null;
}
const normWho = (s) => String(s || '').trim().toLowerCase();
const has = (arr, x) => Array.isArray(arr) && arr.includes(x);
const add = (arr, x) => (has(arr, x) ? arr : [...(arr || []), x]);
const drop = (arr, x) => (arr || []).filter((y) => y !== x);

export const isOp = (ch, who) => !!ch && (ch.founder === who || has(ch.ops, who));
export const isVoiced = (ch, who) => !!ch && has(ch.voiced, who);
export const canSpeak = (ch, who) => !!ch && !has(ch.banned, who) && (!ch.modes.m || isOp(ch, who) || isVoiced(ch, who));
export const canJoin = (ch, who) => !!ch && !has(ch.banned, who) && (!ch.modes.i || isOp(ch, who) || has(ch.invited, who));
// A club room: linked to a Pact group, open only to that group's members (checked by the caller-supplied
// memberOf, so this module never reads the groups store). Ops always get in.
const clubOk = (ch, who, o) => !ch.group || isOp(ch, who) || (o && typeof o.memberOf === 'function' && o.memberOf(ch.group, who));

function publicView(ch, t) {
  const here = Object.entries(ch.seen || {}).filter(([, ts]) => t - ts < PRESENCE_MS).map(([w]) => w);
  return { name: ch.name, topic: ch.topic, founder: ch.founder, modes: ch.modes, created: ch.created,
    lastActive: ch.lastActive, online: here.length, group: ch.group || null, membersOnly: !!ch.group };
}

/** Start a channel. The founder becomes its permanent operator. */
export function createChannel({ name, topic = '', founder, inviteOnly = false, moderated = false } = {}, o = {}) {
  const n = normName(name); const who = normWho(founder);
  if (!n) return { ok: false, reason: 'Channel names are 2–30 letters, numbers or dashes, like #botanica.' };
  if (!who) return { ok: false, reason: 'sign in to start a channel' };
  const store = load(o);
  if (store.channels[n]) return { ok: false, reason: `#${n} already exists — join it instead.` };
  const t = now(o);
  store.channels[n] = { name: n, topic: String(topic || '').slice(0, MAX_TOPIC), founder: who, ops: [who], voiced: [],
    banned: [], invited: [], modes: { i: !!inviteOnly, m: !!moderated }, created: t, lastActive: t,
    seen: { [who]: t }, messages: [] };
  save(store, o);
  return { ok: true, channel: publicView(store.channels[n], t) };
}

/** Public list: invite-only rooms are listed too (like IRC /list), busiest first. */
export function listChannels(o = {}) {
  const t = now(o);
  return Object.values(load(o).channels).map((c) => publicView(c, t))
    .sort((a, b) => (b.online - a.online) || (b.lastActive - a.lastActive));
}

export function getChannel(name, o = {}) {
  const n = normName(name); if (!n) return null;
  const c = load(o).channels[n];
  return c ? { ...publicView(c, now(o)), ops: c.ops, voiced: c.voiced } : null;
}

/** Enter (or stay in) a room — records presence. Refused if banned, or invite-only and not invited. */
export function joinChannel(name, who, o = {}) {
  const n = normName(name); const w = normWho(who);
  if (!n || !w) return { ok: false, reason: 'bad request' };
  const store = load(o); const ch = store.channels[n];
  if (!ch) return { ok: false, reason: `#${n} does not exist` };
  if (has(ch.banned, w)) return { ok: false, reason: `You are banned from #${n}.` };
  if (!canJoin(ch, w)) return { ok: false, reason: `#${n} is invite-only.` };
  if (!clubOk(ch, w, o)) return { ok: false, reason: `#${n} is the club room of ${ch.group} — members only.` };
  ch.seen = { ...(ch.seen || {}), [w]: now(o) };
  save(store, o);
  return { ok: true };
}

/** Who is in the room now, ops first (@), then voiced (+), then everyone else. */
export function roster(name, o = {}) {
  const n = normName(name); const ch = n && load(o).channels[n];
  if (!ch) return [];
  const t = now(o);
  const rank = (w) => (isOp(ch, w) ? 0 : isVoiced(ch, w) ? 1 : 2);
  return Object.entries(ch.seen || {}).filter(([, ts]) => t - ts < PRESENCE_MS).map(([w]) => w)
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))
    .map((w) => ({ who: w, mark: isOp(ch, w) ? '@' : isVoiced(ch, w) ? '+' : '' }));
}

function append(store, ch, msg, o) {
  store.seq += 1;
  const m = { seq: store.seq, ts: now(o), ...msg };
  ch.messages.push(m);
  if (ch.messages.length > KEEP()) ch.messages = ch.messages.slice(-KEEP());
  ch.lastActive = m.ts;
  return m;
}

export function readMessages(name, { since = 0, limit = 100 } = {}, o = {}) {
  const n = normName(name); const ch = n && load(o).channels[n];
  if (!ch) return [];
  const out = ch.messages.filter((m) => m.seq > Number(since || 0));
  return out.slice(-Math.max(1, Math.min(500, Number(limit) || 100)));
}

/** Plain message or /me action. */
export function postMessage(name, who, text, o = {}) {
  const n = normName(name); const w = normWho(who);
  const body = String(text == null ? '' : text).trim();
  if (!n || !w) return { ok: false, reason: 'bad request' };
  if (!body) return { ok: false, reason: 'empty message' };
  if (body.startsWith('/')) return runCommand(name, who, body, o);
  const store = load(o); const ch = store.channels[n];
  if (!ch) return { ok: false, reason: `#${n} does not exist` };
  if (!canJoin(ch, w) || !clubOk(ch, w, o)) return { ok: false, reason: 'join the channel first' };
  if (!canSpeak(ch, w)) return { ok: false, reason: `#${n} is moderated (+m): only ops and voiced people can talk.` };
  ch.seen = { ...(ch.seen || {}), [w]: now(o) };
  const m = append(store, ch, { kind: 'msg', from: w, text: body.slice(0, MAX_TEXT) }, o);
  save(store, o);
  return { ok: true, message: m };
}

export const COMMANDS = ['/me', '/topic', '/op', '/deop', '/voice', '/devoice', '/kick', '/ban', '/unban', '/invite', '/mode'];

/**
 * IRC commands. /me works for anyone who may speak; the rest need op. The founder can never be de-opped,
 * kicked or banned. /join and /list are handled by the page (they navigate), not here.
 */
export function runCommand(name, who, line, o = {}) {
  const n = normName(name); const w = normWho(who);
  const store = load(o); const ch = n && store.channels[n];
  if (!ch) return { ok: false, reason: `#${n || name} does not exist` };
  const [cmd0, ...rest] = String(line).trim().split(/\s+/);
  const cmd = cmd0.toLowerCase();
  const arg = rest.join(' ');
  const target = normWho((rest[0] || '').replace(/^[@+]/, ''));
  const notice = (text) => { const m = append(store, ch, { kind: 'notice', from: w, text }, o); save(store, o); return { ok: true, message: m }; };

  if (cmd === '/me') {
    if (!canSpeak(ch, w)) return { ok: false, reason: 'you cannot talk here right now' };
    if (!arg) return { ok: false, reason: 'usage: /me <action>' };
    const m = append(store, ch, { kind: 'action', from: w, text: arg.slice(0, MAX_TEXT) }, o); save(store, o);
    return { ok: true, message: m };
  }
  if (!COMMANDS.includes(cmd)) return { ok: false, reason: `Unknown command ${cmd}. Try: ${COMMANDS.join(' ')}` };
  if (!isOp(ch, w)) return { ok: false, reason: `Only channel operators (@) can use ${cmd}.` };

  if (cmd === '/topic') { ch.topic = arg.slice(0, MAX_TOPIC); return notice(`${w} set the topic: ${ch.topic || '(none)'}`); }
  if (cmd === '/mode') {
    const m = /^([+-])([mi])$/.exec(arg.trim());
    if (!m) return { ok: false, reason: 'usage: /mode +m | -m | +i | -i' };
    ch.modes = { ...ch.modes, [m[2]]: m[1] === '+' };
    return notice(`${w} set mode ${arg.trim()} (${m[2] === 'm' ? 'moderated' : 'invite-only'} ${m[1] === '+' ? 'on' : 'off'})`);
  }
  if (!target) return { ok: false, reason: `usage: ${cmd} <name>` };
  const founderGuard = target === ch.founder && ['/deop', '/kick', '/ban'].includes(cmd);
  if (founderGuard) return { ok: false, reason: `${target} founded #${n} and cannot be ${cmd.slice(1)}${cmd === '/ban' ? 'ned' : cmd === '/kick' ? 'ed' : 'ped'}.` };
  switch (cmd) {
    case '/op': ch.ops = add(ch.ops, target); return notice(`${w} gave op (@) to ${target}`);
    case '/deop': ch.ops = drop(ch.ops, target); return notice(`${w} removed op from ${target}`);
    case '/voice': ch.voiced = add(ch.voiced, target); return notice(`${w} gave voice (+) to ${target}`);
    case '/devoice': ch.voiced = drop(ch.voiced, target); return notice(`${w} removed voice from ${target}`);
    case '/invite': ch.invited = add(ch.invited, target); return notice(`${w} invited ${target}`);
    case '/kick': { const s = { ...(ch.seen || {}) }; delete s[target]; ch.seen = s; return notice(`${w} kicked ${target}${rest[1] ? ` (${rest.slice(1).join(' ')})` : ''}`); }
    case '/ban': { ch.banned = add(ch.banned, target); ch.ops = drop(ch.ops, target); const s = { ...(ch.seen || {}) }; delete s[target]; ch.seen = s; return notice(`${w} banned ${target}`); }
    case '/unban': ch.banned = drop(ch.banned, target); return notice(`${w} unbanned ${target}`);
    default: return { ok: false, reason: 'unknown command' };
  }
}

/** Founder links a room to a Pact group (club room: members only), or unlinks it with ''. */
export function linkGroup(name, actor, groupId, o = {}) {
  const n = normName(name); const store = load(o); const ch = n && store.channels[n];
  if (!ch) return { ok: false, reason: 'no such channel' };
  if (normWho(actor) !== ch.founder) return { ok: false, reason: 'only the founder can link a room to a club' };
  ch.group = String(groupId || '').trim() || undefined;
  save(store, o);
  return { ok: true, channel: publicView(ch, now(o)) };
}
