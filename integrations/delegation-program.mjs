// delegation-program.mjs — Hathor's delegation-mining program, in the Nutbox model.
//
// THE MODEL (how Nutbox made money on Steem): a user DELEGATES vesting shares to a project account; in
// return the project mints its TOKEN to the delegator, pro-rata to their share of the pool, continuously.
// The pooled stake earns curation for the project (funding it); the delegator earns the token for lending
// weight. Here the project account is `hathor` and the token is the program's own side-token.
//
// This module is the deterministic ACCOUNTING + the join/outreach links. It does NOT move funds: the
// delegation itself is the USER's own `delegate_vesting_shares`, performed through MELEK-Signer's explicit
// active-key approval screen (funds tier — never a scope handed to an app; see melek-permission-tiers).
// The join link sends them to that approval; nothing here can delegate on anyone's behalf.
//
// Reward math is pure and time-weighted: over any interval, each delegator earns
//   emission_per_day * (their_vests / total_vests) * (days_active_in_interval).
// Given the same ledger + timestamps it always produces the same numbers (prove-don't-claim: the payout
// is recomputable by anyone). Off-chain ledger; the actual token credit is a MELEK-Engine mint step the
// caller performs. Pure, injectable, offline-tested, holds no keys.
//
//   import * as dp from './delegation-program.mjs'

const DAY_MS = 86400000;
const lc = (s) => String(s || '').toLowerCase();
const num = (v) => (Number.isFinite(+v) ? +v : 0);

export const PROGRAM = Object.freeze({
  // The delegation + witness + mining account is @kula (operator: "make it like KULA-SOULAVA"): you delegate
  // MELEK to @kula, and earn SOULAVA — the KULA↔SOULAVA pair (KULA the account, SOULAVA the reward).
  pool: (process.env.DELEGATION_POOL || 'kula').toLowerCase(),
  token: process.env.DELEGATION_TOKEN || 'SOULA',            // SOULAVA — the delegation-mining reward (on PRANA)
  emissionPerDay: num(process.env.DELEGATION_EMISSION_PER_DAY) || 1000, // SOUL/day across the pool
  operatorCutBps: num(process.env.DELEGATION_OPERATOR_CUT_BPS) || 1000, // 10% of shared pool rewards to the operator
});

// A delegation's WEIGHT (the `vests` field) may come from either MELEK vesting shares OR a delegated MELEK
// SCOT-token stake — both are just weight in the pool. `source` records which (informational); the math is
// identical. So a delegator can lend MELEK power AND SCOT-token power and both mine SOUL + share rewards.

/**
 * Accrue rewards over an interval. `state` = { delegations: [{account, vests, since, earned, lastAccrued}],
 * }. Mutates a COPY and returns it — each delegation's `earned` grows by its time-weighted pro-rata share
 * of `emissionPerDay` between its lastAccrued (or `now` floor) and `now`. Deterministic.
 */
export function accrue(state, { now = Date.now(), emissionPerDay = PROGRAM.emissionPerDay } = {}) {
  const dels = (state && Array.isArray(state.delegations) ? state.delegations : []).map((d) => ({ ...d }));
  const active = dels.filter((d) => num(d.vests) > 0 && (d.since == null || d.since <= now));
  const totalVests = active.reduce((s, d) => s + num(d.vests), 0);
  if (totalVests <= 0) return { ...state, delegations: dels, lastAccrued: now, totalVests: 0 };
  const emissionPerMs = emissionPerDay / DAY_MS;
  for (const d of dels) {
    if (num(d.vests) <= 0) continue;
    const from = Math.max(num(d.lastAccrued) || num(d.since) || now, num(d.since) || 0);
    const elapsed = Math.max(0, now - Math.min(from, now));
    const share = num(d.vests) / totalVests;
    d.earned = round6(num(d.earned) + emissionPerMs * elapsed * share);
    d.lastAccrued = now;
  }
  return { ...state, delegations: dels, lastAccrued: now, totalVests };
}
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** A read-only projection: each delegator's current share and pending/earned tokens. */
export function ledger(state, { now = Date.now() } = {}) {
  const s = accrue(state, { now });
  const total = s.totalVests || 0;
  return {
    pool: PROGRAM.pool, token: PROGRAM.token, totalVests: total,
    delegators: s.delegations.map((d) => ({
      account: lc(d.account), vests: num(d.vests),
      share: total > 0 ? round6(num(d.vests) / total) : 0, earned: round6(num(d.earned)),
    })).sort((a, b) => b.vests - a.vests),
  };
}

/**
 * The JOIN link — where an invite sends someone to actually delegate. It points at the MELEK-Signer
 * delegation-approval flow (the user's own explicit active-key consent — funds tier), pre-filled with the
 * pool + amount + a referrer tag so Hathor's outreach can be attributed. It CANNOT delegate on its own.
 */
export function joinLink({ vests, referrer, signerUrl } = {}) {
  const base = String(signerUrl || process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/+$/, '');
  const u = new URL(`${base}/delegate`);
  u.searchParams.set('to', PROGRAM.pool);
  if (vests != null) u.searchParams.set('vests', String(num(vests)));
  if (referrer) u.searchParams.set('ref', lc(referrer));
  return u.toString();
}

/**
 * A short, Hathor-voiced invitation the Automation System distributes to bring delegators in. Plain text;
 * includes the join link. Honest: it says what delegation is and that it can be undone.
 */
export function inviteMessage({ vests = 1000, referrer, signerUrl } = {}) {
  const link = joinLink({ vests, referrer, signerUrl });
  return `Lend your weight, and share in what it earns. Delegate ${num(vests).toLocaleString()} vests to `
    + `@${PROGRAM.pool} and you begin mining ${PROGRAM.token} — minted to you continuously, in proportion to `
    + `your share of the pool. It is a loan of standing, not a gift: you can undelegate whenever you wish.\n`
    + `Join: ${link}`;
}

/**
 * The UPVU/NutBox payout: split the pool's earnings among delegators pro-rata to weight, minus the operator
 * cut. This is the "they get some of the MELEK and other tokens" half (the SOUL mining is the other half).
 * @param {object} state    the ledger
 * @param {object} earnings the pool's earnings this period, per token: { MELEK: 100, KULA: 5, SBD: 2 }
 * @returns { operator, operatorCut:{token:amt}, payouts:[{account, byToken}], transfers:[{token,to,amount,tx}], totalVests }
 */
export function distributeRewards(state, earnings = {}, { operatorCutBps = PROGRAM.operatorCutBps, operator = PROGRAM.pool, now = Date.now() } = {}) {
  const s = accrue(state || { delegations: [] }, { now });         // settle SOUL mining to `now` too
  const active = (s.delegations || []).filter((d) => num(d.vests) > 0);
  const total = active.reduce((sum, d) => sum + num(d.vests), 0);
  const cut = Math.max(0, Math.min(10000, num(operatorCutBps))) / 10000;
  const operatorCut = {}; const perAccount = {}; const transfers = [];
  for (const [tokRaw, amtRaw] of Object.entries(earnings || {})) {
    const token = String(tokRaw).toUpperCase();
    const gross = num(amtRaw);
    if (gross <= 0) continue;
    const opShare = round6(gross * cut);
    const pool = round6(gross - opShare);
    if (total <= 0) { operatorCut[token] = gross; continue; }       // no delegators → whole earning to operator
    if (opShare > 0) operatorCut[token] = opShare;
    for (const d of active) {
      const a = lc(d.account);
      const amt = round6(pool * (num(d.vests) / total));
      if (amt <= 0) continue;
      (perAccount[a] = perAccount[a] || {})[token] = round6((perAccount[a][token] || 0) + amt);
    }
  }
  const payouts = Object.entries(perAccount).map(([account, byToken]) => ({ account, byToken }));
  for (const p of payouts) for (const [token, amount] of Object.entries(p.byToken)) {
    transfers.push({ token, to: p.account, amount, tx: { action: 'transfer', token, to: p.account, amount } });
  }
  return { operator: lc(operator), operatorCut, payouts, transfers, totalVests: total };
}

/**
 * Add/replace a delegation in the ledger (call after the on-chain delegation confirms). It SETTLES accrual
 * up to `now` first, so every delegator is credited under the OLD pool composition before the pool changes
 * — this is what keeps the time-weighted math exact across membership changes. `source` is informational
 * (MELEK vests vs a delegated SCOT-token stake); both are weight. Returns new state.
 */
export function upsertDelegation(state, { account, vests, source = 'melek-vests', now = Date.now(), emissionPerDay = PROGRAM.emissionPerDay } = {}) {
  const settled = accrue(state || { delegations: [] }, { now, emissionPerDay });   // credit everyone up to now
  const dels = settled.delegations.map((d) => ({ ...d }));
  const a = lc(account);
  const existing = dels.find((d) => lc(d.account) === a);
  if (existing) { existing.vests = num(vests); existing.source = source; if (existing.since == null) existing.since = now; existing.lastAccrued = now; }
  else dels.push({ account: a, vests: num(vests), source, since: now, earned: 0, lastAccrued: now });
  return { ...settled, delegations: dels };
}
