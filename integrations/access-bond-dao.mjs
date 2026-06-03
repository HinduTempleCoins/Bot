// access-bond-dao.mjs — PURE access-economics logic for the MELEK / SoapBox tooling tier.
// No network, no chain calls, no keys. Two decoupled subsystems:
//
//   BOND — burn-for-access subscription (Unlock-Protocol model).
//     A BOND is a tradeable token. You REDEEM it (an irreversible BURN) to mint a
//     time-bound membership term that unlocks the higher EARNING tier. Decouples
//     who-pays from who-uses: anyone can buy/transfer a bond, and whoever redeems it
//     gets the term. redeemBond / isMember.
//
//   DAO — stake-for-governance (veToken model).
//     You LOCK stake until a future time to earn voting weight (longer lock = more
//     weight) plus a modest earning boost. lockStake / votingPower / earningMultiplier.
//
// ★ SECURITIES FRAMING (load-bearing, read before changing numbers):
//   This is ACCESS to tools (a subscription you spend) + EARNING tied to your own
//   ACTIVITY, NOT passive yield on a deposit. A bond is consumed (burned) for a
//   service term — it is not an interest-bearing instrument. The DAO earningMultiplier
//   is a participation boost on activity you actually perform, never a return paid for
//   merely holding/locking. Do NOT reframe either as yield, dividend, or guaranteed
//   return. The burn is IRREVERSIBLE and must be disclosed to the user before redeem.
//
//   import { redeemBond, isMember, lockStake, votingPower, earningMultiplier } from './access-bond-dao.mjs'
//   node integrations/access-bond-dao.mjs            # print a worked example

const DAY = 24 * 60 * 60 * 1000;

// ---- in-memory membership ledger (pure; tests reset via clearState) ----
// user -> membershipUntil (epoch ms)
const _members = new Map();
// user -> { amount, lockUntil, lockedAt } stake position
const _stakes = new Map();

export function clearState() { _members.clear(); _stakes.clear(); }

const now_ = (opts) => (opts && Number.isFinite(opts.now)) ? opts.now : Date.now();

// ---------------------------------------------------------------------------
// BOND — burn-for-access subscription
// ---------------------------------------------------------------------------

// A bond carries a term length (days). Default 30-day membership per bond.
export const DEFAULT_TERM_DAYS = 30;

// redeemBond(bond, user, {now}) → { membershipUntil, burned:true }
// IRREVERSIBLE: the bond is burned. If the user already has an active term, the new
// term EXTENDS from the later of (now, existing expiry) — subscription stacking, not
// reset. A bond can only be redeemed once (subsequent reads see burned===true).
export function redeemBond(bond, user, opts = {}) {
  if (!bond || typeof bond !== 'object') throw new TypeError('bond must be an object');
  if (!user) throw new TypeError('user required');
  if (bond.burned) throw new Error('bond already burned (irreversible)');

  const t = now_(opts);
  const termDays = Number.isFinite(bond.termDays) && bond.termDays > 0 ? bond.termDays : DEFAULT_TERM_DAYS;
  const existing = _members.get(user) || 0;
  const base = Math.max(t, existing);            // stack onto remaining time, don't reset
  const membershipUntil = base + termDays * DAY;

  _members.set(user, membershipUntil);
  bond.burned = true;                            // irreversible burn (mutates the token)

  return { membershipUntil, burned: true };
}

// isMember(user, {now}) → boolean — true while the membership term is active.
export function isMember(user, opts = {}) {
  const until = _members.get(user) || 0;
  return until > now_(opts);
}

// ---------------------------------------------------------------------------
// DAO — stake-for-governance (veToken)
// ---------------------------------------------------------------------------

// veToken weighting: voting power = amount * timeMultiplier, where the multiplier
// scales with how long the stake is locked (max ~4x at MAX_LOCK_DAYS), and decays
// toward 1x as the unlock date approaches (you can't keep max weight at expiry).
export const MAX_LOCK_DAYS = 365 * 4;            // 4 years, classic ve cap
export const MAX_TIME_MULT = 4;                  // longest lock = 4x weight

// remaining lock (days) → time multiplier in [0, MAX_TIME_MULT]
export function timeMultiplier(remainingDays) {
  if (!(remainingDays > 0)) return 0;            // expired locks carry no weight
  const frac = Math.min(remainingDays, MAX_LOCK_DAYS) / MAX_LOCK_DAYS;
  return Math.round(frac * MAX_TIME_MULT * 1000) / 1000;
}

// lockStake(user, amount, lockUntil, {now}) → { amount, lockUntil } — records a lock.
// lockUntil is an epoch ms in the future. Re-locking replaces the prior position.
export function lockStake(user, amount, lockUntil, opts = {}) {
  if (!user) throw new TypeError('user required');
  if (!(amount > 0)) throw new TypeError('amount must be > 0');
  const t = now_(opts);
  if (!(lockUntil > t)) throw new Error('lockUntil must be in the future');

  const pos = { amount, lockUntil, lockedAt: t };
  _stakes.set(user, pos);
  return { amount, lockUntil };
}

// votingPower(user, {now}) → number — amount weighted by remaining lock time.
export function votingPower(user, opts = {}) {
  const pos = _stakes.get(user);
  if (!pos) return 0;
  const t = now_(opts);
  const remainingDays = (pos.lockUntil - t) / DAY;
  return Math.round(pos.amount * timeMultiplier(remainingDays) * 1000) / 1000;
}

// earningMultiplier(user, {now}) → number ≥ 1 — a participation BOOST on activity-based
// earning (NOT passive yield). Scales gently with the size of the staked position and
// its remaining lock. Capped so it stays a boost, never a dominant payout.
export const MAX_EARN_BOOST = 2;                 // up to +100% on top of activity earning
export function earningMultiplier(user, opts = {}) {
  const pos = _stakes.get(user);
  if (!pos) return 1;                            // no stake → no boost, plain 1x on activity
  const t = now_(opts);
  const remainingDays = (pos.lockUntil - t) / DAY;
  const tm = timeMultiplier(remainingDays);      // 0..4
  // normalize the ve-multiplier into a 1..MAX_EARN_BOOST boost band
  const boost = 1 + (tm / MAX_TIME_MULT) * (MAX_EARN_BOOST - 1);
  return Math.round(boost * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// CLI — worked example (no network)
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('access-bond-dao.mjs')) {
  const now = Date.now();
  const bond = { id: 'BOND-1', termDays: 30 };
  console.log('Disclosure: redeeming a bond BURNS it irreversibly for a membership term.');
  console.log('redeemBond ->', redeemBond(bond, 'alice', { now }));
  console.log('isMember(alice now) ->', isMember('alice', { now }));
  console.log('isMember(alice +40d) ->', isMember('alice', { now: now + 40 * DAY }));

  lockStake('alice', 1000, now + MAX_LOCK_DAYS * DAY, { now });
  lockStake('bob', 1000, now + 30 * DAY, { now });
  console.log('votingPower(alice 4y lock) ->', votingPower('alice', { now }));
  console.log('votingPower(bob 30d lock)  ->', votingPower('bob', { now }));
  console.log('earningMultiplier(alice)   ->', earningMultiplier('alice', { now }));
  console.log('Note: earning boost applies to ACTIVITY, not passive holding.');
}
