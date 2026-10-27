// pentecaust/calls/model.mjs — the state behind live video on Pentecaust: presence, signalling,
// rooms, and the roulette pairing queue.
//
// ⭐ WHY THIS LIVES IN PENTECAUST AND NOT ON A HOST OF ITS OWN.
// A call is only worth anything between two people who are already signed in, and Pentecaust is
// where identity lives — MELEK account names, and the '~…' messenger handles a social login gets
// without any chain account. Putting calling anywhere else would mean a page nobody arrives at
// logged in to. Same reasoning as pentecaust/groups/server.mjs.
//
// ⭐ WHY SIGNALLING IS A MAILBOX AND NOT A SOCKET.
// WebRTC needs a side channel to trade SDP offers/answers and ICE candidates before the peer-to-peer
// connection exists. That channel can be anything. A mailbox polled over plain HTTP works behind the
// dispatcher, behind Caddy, behind the existing auth, with no new port, no websocket upgrade ordering
// to get wrong (see the Caddy websocket gotcha that cost a day on the notifications work), and it
// degrades to "slightly slower call setup" instead of "nothing connects". Media itself never touches
// this server — only the handshake does.
//
// WHAT THIS IS NOT: there is no SFU here, so one-to-many BROADCAST is out of scope for this module.
// Mesh WebRTC is fine to about four participants and falls over past that, because every peer uploads
// a separate stream to every other peer. Broadcast needs a selective forwarding unit (mediasoup,
// LiveKit, Janus) and that is a server with real bandwidth cost — a separate decision, not a flag.
//
// House style: ESM, pure where it can be, injectable clock + store for tests, soft-fail-never-throw.

const str = (s) => String(s == null ? '' : s).trim();
const now = (opts) => (opts && typeof opts.now === 'function' ? opts.now() : Date.now());

// Everything here is ephemeral by design — a call that is over leaves nothing behind.
const fresh = () => ({ presence: new Map(), mail: new Map(), queue: [], rooms: new Map(), blocks: new Map(), reports: [] });
let STORE = fresh();
export function __reset() { STORE = fresh(); }
const store = (opts) => (opts && opts.store) || STORE;

export const PRESENCE_TTL_MS = 45000;   // a tab that stops heartbeating is gone within a sweep
export const MAIL_TTL_MS = 120000;      // an undelivered signal is stale long before this
export const QUEUE_TTL_MS = 90000;
export const MAX_MAIL_PER_ACCOUNT = 200;
export const MESH_SOFT_LIMIT = 4;       // past this, mesh stops being honest — see the note above

/** Modes a member can make themselves available in. */
export const MODES = Object.freeze(['calls', 'roulette', 'invisible']);

// ── presence ────────────────────────────────────────────────────────────────────────────────────

export function heartbeat(account, mode = 'calls', opts = {}) {
  const a = str(account); if (!a) return { ok: false, reason: 'no account' };
  const m = MODES.includes(str(mode)) ? str(mode) : 'calls';
  store(opts).presence.set(a, { account: a, mode: m, at: now(opts) });
  return { ok: true, account: a, mode: m };
}

export function goOffline(account, opts = {}) {
  const a = str(account);
  store(opts).presence.delete(a);
  leaveQueue(a, opts);
  return { ok: true };
}

export function sweep(opts = {}) {
  const s = store(opts); const t = now(opts);
  for (const [k, v] of s.presence) if (t - v.at > PRESENCE_TTL_MS) s.presence.delete(k);
  for (const [k, list] of s.mail) {
    const keep = list.filter((m) => t - m.at <= MAIL_TTL_MS);
    if (keep.length) s.mail.set(k, keep); else s.mail.delete(k);
  }
  s.queue = s.queue.filter((q) => t - q.at <= QUEUE_TTL_MS && s.presence.has(q.account));
  for (const [id, r] of s.rooms) if (!r.members.length) s.rooms.delete(id);
  return { ok: true };
}

export function online(opts = {}) {
  sweep(opts);
  return [...store(opts).presence.values()].filter((p) => p.mode !== 'invisible').map((p) => ({ account: p.account, mode: p.mode }));
}

export const isOnline = (account, opts = {}) => {
  sweep(opts);
  return store(opts).presence.has(str(account));
};

// ── blocks: enforced, not advisory ──────────────────────────────────────────────────────────────

export function block(account, other, opts = {}) {
  const a = str(account); const b = str(other);
  if (!a || !b || a === b) return { ok: false, reason: 'bad block' };
  const s = store(opts);
  if (!s.blocks.has(a)) s.blocks.set(a, new Set());
  s.blocks.get(a).add(b);
  return { ok: true };
}
export function unblock(account, other, opts = {}) {
  const s = store(opts); const set = s.blocks.get(str(account));
  if (set) set.delete(str(other));
  return { ok: true };
}
/** Blocking is symmetric for PAIRING: either direction prevents a match. */
export function blocked(a, b, opts = {}) {
  const s = store(opts);
  return !!((s.blocks.get(str(a)) || new Set()).has(str(b)) || (s.blocks.get(str(b)) || new Set()).has(str(a)));
}
export function blocklist(account, opts = {}) {
  return [...(store(opts).blocks.get(str(account)) || new Set())];
}

export function report(from, about, reason = '', opts = {}) {
  const f = str(from); const a = str(about);
  if (!f || !a) return { ok: false, reason: 'bad report' };
  store(opts).reports.push({ from: f, about: a, reason: str(reason).slice(0, 500), at: now(opts) });
  block(f, a, opts); // a report always implies "never pair us again"
  return { ok: true };
}
export const reports = (opts = {}) => [...store(opts).reports];

// ── signalling mailbox ──────────────────────────────────────────────────────────────────────────

/**
 * Hand a signal to `to`. Payload is opaque here — SDP, an ICE candidate, a hangup, whatever the
 * client agreed on. The server never parses media descriptions; it only routes them.
 */
export function signal(from, to, payload, opts = {}) {
  const f = str(from); const t = str(to);
  if (!f || !t) return { ok: false, reason: 'bad address' };
  if (f === t) return { ok: false, reason: 'cannot signal yourself' };
  if (blocked(f, t, opts)) return { ok: false, reason: 'blocked' };
  const s = store(opts);
  const list = s.mail.get(t) || [];
  if (list.length >= MAX_MAIL_PER_ACCOUNT) return { ok: false, reason: 'mailbox full' };
  const msg = { id: `${now(opts)}-${Math.random().toString(36).slice(2, 8)}`, from: f, payload, at: now(opts) };
  list.push(msg);
  s.mail.set(t, list);
  return { ok: true, id: msg.id };
}

/** Take everything addressed to `account`. Draining is destructive — each signal is delivered once. */
export function drain(account, opts = {}) {
  const a = str(account);
  const s = store(opts);
  const list = s.mail.get(a) || [];
  s.mail.delete(a);
  return list.map(({ id, from, payload, at }) => ({ id, from, payload, at }));
}

export const pending = (account, opts = {}) => (store(opts).mail.get(str(account)) || []).length;

// ── rooms (named, invite-by-link) ───────────────────────────────────────────────────────────────

export function createRoom(host, { name = '', locked = false } = {}, opts = {}) {
  const h = str(host); if (!h) return { ok: false, reason: 'no account' };
  const id = `r-${now(opts).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  store(opts).rooms.set(id, { id, host: h, name: str(name).slice(0, 80), locked: !!locked, members: [h], at: now(opts) });
  return { ok: true, id, room: getRoom(id, opts) };
}

export const getRoom = (id, opts = {}) => {
  const r = store(opts).rooms.get(str(id));
  return r ? { ...r, members: [...r.members] } : null;
};

export function joinRoom(id, account, opts = {}) {
  const a = str(account);
  const r = store(opts).rooms.get(str(id));
  if (!r) return { ok: false, reason: 'no such room' };
  if (r.locked && !r.members.includes(a)) return { ok: false, reason: 'room is locked' };
  if (r.members.some((m) => blocked(m, a, opts))) return { ok: false, reason: 'blocked' };
  if (!r.members.includes(a)) {
    if (r.members.length >= MESH_SOFT_LIMIT) return { ok: false, reason: `mesh limit is ${MESH_SOFT_LIMIT} — broadcast needs an SFU` };
    r.members.push(a);
  }
  return { ok: true, room: getRoom(id, opts), peers: r.members.filter((m) => m !== a) };
}

export function leaveRoom(id, account, opts = {}) {
  const r = store(opts).rooms.get(str(id));
  if (!r) return { ok: true };
  r.members = r.members.filter((m) => m !== str(account));
  if (!r.members.length) store(opts).rooms.delete(r.id);
  return { ok: true };
}

export const roomsFor = (account, opts = {}) => [...store(opts).rooms.values()]
  .filter((r) => r.members.includes(str(account))).map((r) => getRoom(r.id, opts));

// ── roulette ────────────────────────────────────────────────────────────────────────────────────

export function joinQueue(account, opts = {}) {
  const a = str(account); if (!a) return { ok: false, reason: 'no account' };
  const s = store(opts);
  if (!s.presence.has(a)) heartbeat(a, 'roulette', opts);
  if (!s.queue.some((q) => q.account === a)) s.queue.push({ account: a, at: now(opts) });
  return { ok: true, position: s.queue.findIndex((q) => q.account === a) + 1, waiting: s.queue.length };
}

export function leaveQueue(account, opts = {}) {
  const s = store(opts);
  s.queue = s.queue.filter((q) => q.account !== str(account));
  return { ok: true };
}

export const queueLength = (opts = {}) => { sweep(opts); return store(opts).queue.length; };

/**
 * Pair the longest-waiting member with the longest-waiting member they are not blocked from.
 * Returns the pair, or null when nobody can be matched. The caller signals both sides.
 * Deterministic given the queue order, which is what makes it testable.
 */
export function pair(opts = {}) {
  sweep(opts);
  const s = store(opts);
  for (let i = 0; i < s.queue.length; i += 1) {
    for (let j = i + 1; j < s.queue.length; j += 1) {
      const a = s.queue[i].account; const b = s.queue[j].account;
      if (blocked(a, b, opts)) continue;
      s.queue.splice(j, 1); s.queue.splice(i, 1);
      const room = createRoom(a, { name: 'roulette' }, opts);
      joinRoom(room.id, b, opts);
      return { a, b, roomId: room.id };
    }
  }
  return null;
}

// ── ICE configuration ───────────────────────────────────────────────────────────────────────────

/**
 * What the browser needs to traverse NAT.
 *
 * STUN alone gets most consumer connections through. It does NOT get through symmetric NAT or
 * restrictive corporate firewalls — in practice a double-digit percentage of pairs — and those need
 * a TURN relay, which carries the media and therefore costs real bandwidth. Without TURN configured
 * this returns STUN only and `relay:false`, so the UI can say "some connections will fail" honestly
 * instead of the call simply never connecting.
 */
export function iceConfig(env = process.env) {
  const stun = String(env.PENTECAUST_STUN || 'stun:stun.l.google.com:19302')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const servers = stun.map((urls) => ({ urls }));
  const turnUrl = String(env.PENTECAUST_TURN_URL || '').trim();
  const turnUser = String(env.PENTECAUST_TURN_USER || '').trim();
  const turnPass = String(env.PENTECAUST_TURN_PASS || '').trim();
  const relay = !!(turnUrl && turnUser && turnPass);
  if (relay) servers.push({ urls: turnUrl.split(',').map((s) => s.trim()).filter(Boolean), username: turnUser, credential: turnPass });
  return { iceServers: servers, relay, note: relay ? 'TURN relay configured' : 'STUN only — connections behind symmetric NAT will fail until TURN is configured' };
}
