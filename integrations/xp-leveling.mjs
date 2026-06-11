// xp-leveling.mjs — PURE XP / leveling-curve engine (Discord MEE6-style).
// Backlog item e150fd639d; serves items 298/299 ("Leveling & moderation", "XP system").
//
// Math + state only. NO Discord client, NO network, NO secrets. Soft-fail, never throws.
// The caller owns persistence: state is a plain JSON-able object the caller stores/loads.
//
// The curve is the well-known MEE6 model: to GO FROM level L to L+1 you must earn
//   xpToReachNext(L) = 5*L^2 + 50*L + 100
// xp points within the level. xpForLevel(L) is the CUMULATIVE total XP required to BE level L
// (i.e. the sum of xpToReachNext(0..L-1)). levelForXp is its inverse.
//
// awardMessageXp() grants a random 15..25 XP per message with a per-user cooldown (default 60s),
// mirroring MEE6. Both `now` (ms epoch) and `rng` (()=>[0,1)) are injectable for deterministic tests.
//
//   import { xpForLevel, levelForXp, awardMessageXp, leaderboard, progress } from './xp-leveling.mjs'
//   node integrations/xp-leveling.mjs 5      # prints curve facts for level 5

// --- HTML escape (used only by the optional render helper) -----------------

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- numeric coercion (soft) -----------------------------------------------

function toInt(n, fallback = 0) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? v : fallback;
}

function toNum(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

// --- the MEE6 curve --------------------------------------------------------

// XP needed to advance FROM `level` to `level+1`. Soft-clamps negative levels to 0.
export function xpToReachNext(level) {
  const L = Math.max(0, toInt(level, 0));
  return 5 * L * L + 50 * L + 100;
}

// CUMULATIVE total XP required to BE exactly `level` (level 0 == 0 XP).
export function xpForLevel(level) {
  const L = Math.max(0, toInt(level, 0));
  let total = 0;
  for (let i = 0; i < L; i++) total += xpToReachNext(i);
  return total;
}

// Inverse: the highest level whose cumulative cost is <= xp. Soft-clamps negatives to 0.
export function levelForXp(xp) {
  const x = Math.max(0, toNum(xp, 0));
  let level = 0;
  // xpForLevel is strictly increasing, so we can walk up incrementally.
  let total = 0;
  while (true) {
    const next = total + xpToReachNext(level);
    if (next > x) break;
    total = next;
    level += 1;
  }
  return level;
}

// --- progress within the current level -------------------------------------

// { level, intoLevel, neededForNext, pct } for an absolute xp total.
// pct is 0..1 fraction of the way to the next level.
export function progress(xp) {
  const x = Math.max(0, toNum(xp, 0));
  const level = levelForXp(x);
  const base = xpForLevel(level);
  const neededForNext = xpToReachNext(level);
  const intoLevel = x - base;
  const pct = neededForNext > 0 ? Math.min(1, Math.max(0, intoLevel / neededForNext)) : 0;
  return { level, intoLevel, neededForNext, pct };
}

// --- state shape -----------------------------------------------------------
// state = { users: { [userId]: { xp, level, lastAwardMs, messages } } }
// We never mutate the input object's nested user records in place beyond a clone;
// callers may persist the returned `state` directly.

function ensureState(state) {
  const s = (state && typeof state === 'object') ? state : {};
  const users = (s.users && typeof s.users === 'object') ? s.users : {};
  return { ...s, users };
}

function ensureUser(rec) {
  const r = (rec && typeof rec === 'object') ? rec : {};
  return {
    xp: Math.max(0, toNum(r.xp, 0)),
    level: Math.max(0, toInt(r.level, 0)),
    lastAwardMs: toInt(r.lastAwardMs, 0),
    messages: Math.max(0, toInt(r.messages, 0)),
  };
}

// --- award XP for a message ------------------------------------------------

// Returns { state, awarded, amount, leveledUp, newLevel, oldLevel, onCooldown }.
// Never throws. `now` ms-epoch and `rng` ()=>[0,1) are injectable.
export function awardMessageXp(state, opts = {}) {
  const {
    userId,
    now = Date.now(),
    cooldownSec = 60,
    min = 15,
    max = 25,
    rng = Math.random,
  } = (opts && typeof opts === 'object') ? opts : {};

  const s = ensureState(state);

  // Bad userId: soft no-op.
  if (userId === undefined || userId === null || userId === '') {
    return { state: s, awarded: false, amount: 0, leveledUp: false, newLevel: 0, oldLevel: 0, onCooldown: false };
  }
  const key = String(userId);
  const user = ensureUser(s.users[key]);
  const nowMs = toInt(now, 0);
  const cdMs = Math.max(0, toNum(cooldownSec, 60)) * 1000;

  // Cooldown: if last award was within the window, suppress.
  if (user.lastAwardMs > 0 && nowMs - user.lastAwardMs < cdMs) {
    return {
      state: s, awarded: false, amount: 0, leveledUp: false,
      newLevel: user.level, oldLevel: user.level, onCooldown: true,
    };
  }

  // Roll the XP amount in [min, max] inclusive using injected rng.
  let lo = Math.max(0, toInt(min, 15));
  let hi = Math.max(lo, toInt(max, 25));
  let r = toNum(typeof rng === 'function' ? rng() : 0, 0);
  if (!(r >= 0 && r < 1)) r = 0; // soft-clamp out-of-range rng
  const amount = lo + Math.floor(r * (hi - lo + 1));

  const oldLevel = user.level;
  const newXp = user.xp + amount;
  const newLevel = levelForXp(newXp);
  const leveledUp = newLevel > oldLevel;

  const updatedUser = {
    xp: newXp,
    level: newLevel,
    lastAwardMs: nowMs,
    messages: user.messages + 1,
  };

  const nextState = { ...s, users: { ...s.users, [key]: updatedUser } };
  return { state: nextState, awarded: true, amount, leveledUp, newLevel, oldLevel, onCooldown: false };
}

// --- leaderboard -----------------------------------------------------------

// Sorted descending by xp (tie-break: more messages, then userId asc for stability).
// Returns array of { userId, xp, level, messages, rank }.
export function leaderboard(state, opts = {}) {
  const s = ensureState(state);
  const { limit } = (opts && typeof opts === 'object') ? opts : {};
  const rows = Object.entries(s.users).map(([userId, rec]) => {
    const u = ensureUser(rec);
    return { userId, xp: u.xp, level: u.level, messages: u.messages };
  });
  rows.sort((a, b) => {
    if (b.xp !== a.xp) return b.xp - a.xp;
    if (b.messages !== a.messages) return b.messages - a.messages;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  const ranked = rows.map((row, i) => ({ ...row, rank: i + 1 }));
  const lim = toInt(limit, 0);
  return lim > 0 ? ranked.slice(0, lim) : ranked;
}

// --- optional plain-text render (no HTML by default) -----------------------

export function renderProgress(userId, xp) {
  const p = progress(xp);
  return `${esc(userId)} — level ${p.level} (${p.intoLevel}/${p.neededForNext} XP, ${Math.round(p.pct * 100)}%)`;
}

// --- CLI (guarded) ---------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('xp-leveling.mjs')) {
  const lvl = toInt(process.argv[2], 5);
  const cum = xpForLevel(lvl);
  const next = xpToReachNext(lvl);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    level: lvl,
    cumulativeXpToBeThisLevel: cum,
    xpToReachNextLevel: next,
    levelForCumulative: levelForXp(cum),
    roundTripOk: levelForXp(cum) === lvl,
  }, null, 2));
}
