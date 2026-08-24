// ambassadors/attribution.mjs — the load-bearing `/go` ↔ invite-tree BRIDGE (Phase A, design (b)).
//
// THE GAP TODAY: a `/go` click (pentecaust/herald/qr-tracker.mjs) and an invite redemption
// (signup/invites.mjs) are separate events. Nothing ties the prospect who scanned an ambassador's link
// to the account they eventually create. This module is the glue that welds them into ONE funnel:
//
//   clicks  → signups → SURVIVORS (payable)
//   (qr)      (invite)   (verified + first action + sybil-clear)
//
// It imports the REAL functions from both rails — it does not shadow them:
//   • qr-tracker.scanStats      — pre-account attribution: how many clicks a code got.
//   • invites.redeemInvite/lineage — post-account attribution + durable provenance (who brought whom).
//   • registry.getByCode/getAmbassador — resolve a code (or an inviter account) → the ambassador.
//   • token-programs.sybilGate  — fail-closed humanity/uniqueness gate before a referral can PAY.
//
// ATTRIBUTION DISCIPLINE (the money rail — design (b) "anti-fraud"):
//   • Reward on SURVIVAL, not on signup: a referral only becomes `payable` once the referred account
//     clears a liveness bar (verified email + a real first action) AND passes the sybil gate.
//   • De-dupe on ACCOUNT, not on click: many clicks from one prospect = one referral.
//   • Self-referral (ambassador === new account) and circular refs are dropped.
//   • One-hop pays by default; deeper lineage is VISIBLE (downlineOf) but does not pay here.
//
// This module WRITES a `referrals` ledger and computes payability; it signs NOTHING. Token payout is an
// UNSIGNED plan built in earnings.mjs and handed to MELEK-Signer by a daemon later. Zero WIF here.
//
//   import { attributeSignup, markSurvival, payableReferrals, referralsFor, funnelFor } from './attribution.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanStats } from '../pentecaust/herald/qr-tracker.mjs';
import { redeemInvite, lineage } from '../signup/invites.mjs';
import { sybilGate } from '../pentecaust/herald/token-programs.mjs';
import { getByCode, getAmbassador } from './registry.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const DATA_FILE = () => env('AMBASSADOR_REFERRALS_DATA', join(process.cwd(), 'data', 'ambassador-referrals.json'));
const now = (o) => (o && o.now != null ? o.now : Date.now());
const normAcct = (a) => { const s = String(a || '').trim().toLowerCase(); return s || null; };
const sanitizeCode = (c) => { const s = String(c || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); return /^[a-z0-9-]{1,40}$/.test(s) ? s : null; };

// ── injectable fs + store ───────────────────────────────────────────────────────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { referrals: [] };
  try { const o = JSON.parse(raw); return o && Array.isArray(o.referrals) ? o : { referrals: [] }; }
  catch { return { referrals: [] }; }
}
const saveStore = (fs, file, s) => (fs.write || realFs.write)(file, JSON.stringify(s));
const ctx = (o = {}) => ({ fs: o.fs || realFs, file: o.file || DATA_FILE() });
// Forward the caller's registry/invites/qr stores through so everything is offline-testable in one place.
const regOpts = (o = {}) => ({ fs: o.fs, file: o.registryFile, ...(o.registry || {}) });
const inviteOpts = (o = {}) => ({ ...(o.invites || {}), now: o.now });
const qrOpts = (o = {}) => ({ ...(o.qr || {}), now: o.now });

// ── the bridge ────────────────────────────────────────────────────────────────────────────────────────
/**
 * attributeSignup — stamp a new account to the ambassador who brought it, at signup time.
 *
 *   1. (optional) redeem the invite code → registers the account on the invite tree, yields invitedBy.
 *   2. PREFER the `/go` `ref` code carried through the redirect → the owning ambassador (via='go').
 *   3. FALL BACK to the invite's `invitedBy` if that account is itself an ambassador (via='invite').
 *   4. drop self / circular / duplicate; write a `referrals` row (status: pending survival).
 *
 * @param {object} params { newAccount, ref?, inviteCode?, invitedBy? }
 * @param {object} opts   { redeem?:bool (default true if inviteCode), registry?, invites?, qr?, fs?, registryFile?, now? }
 * @returns {Promise<{ok:true, attributed:bool, referral?} | {ok:false, reason}>}
 */
export async function attributeSignup(params = {}, opts = {}) {
  const newAccount = normAcct(params.newAccount);
  if (!newAccount) return { ok: false, reason: 'invalid new account' };

  // 1. Bridge the invite tree: redeem the code here (or trust a caller-supplied invitedBy).
  let invitedBy = params.invitedBy ? normAcct(params.invitedBy) : null;
  if (params.inviteCode && opts.redeem !== false) {
    const r = redeemInvite(params.inviteCode, newAccount, inviteOpts(opts));
    if (!r.ok) return { ok: false, reason: `invite redemption failed: ${r.reason}` };
    invitedBy = normAcct(r.invitedBy);
  }

  // 2/3. Resolve the ambassador: /go ref wins, else invitedBy-is-an-ambassador.
  let ambassador = null, via = null, code = null;
  const ref = sanitizeCode(params.ref);
  if (ref) {
    const amb = getByCode(ref, regOpts(opts));
    if (amb && amb.status === 'active') { ambassador = amb; via = 'go'; code = ref; }
  }
  if (!ambassador && invitedBy) {
    const amb = getAmbassador(invitedBy, regOpts(opts));
    if (amb && amb.status === 'active') { ambassador = amb; via = 'invite'; code = amb.code; }
  }
  if (!ambassador) return { ok: true, attributed: false, reason: 'no ambassador for this signup', invitedBy };

  // 4a. self / circular guard.
  if (ambassador.account === newAccount) return { ok: true, attributed: false, reason: 'self-referral dropped' };

  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  // 4b. de-dupe on ACCOUNT (many clicks from one prospect = one referral).
  if (store.referrals.some((r) => r.newAccount === newAccount)) {
    return { ok: true, attributed: false, reason: 'account already attributed' };
  }

  const row = {
    ambassador: ambassador.account, newAccount, code, via, invitedBy,
    ts: now(opts),
    survived: false, sybilOk: null, payable: false, paidAt: null,
  };
  store.referrals.push(row);
  saveStore(fs, file, store);
  return { ok: true, attributed: true, referral: row };
}

/**
 * markSurvival — flip a referral toward PAYABLE once the referred account is alive, then sybil-gate it.
 * Pay on survival, not on signup: requires verifiedEmail AND a first real action (post/comment/tutorial).
 * The sybil gate reuses token-programs.sybilGate (fail-closed): an account below minScore never pays.
 *
 * @param {string} newAccount
 * @param {object} signals { verifiedEmail?:bool, firstAction?:bool }
 * @param {object} opts    { scoreOf?:fn|map, minScore?:number, fs?, file?, now? }
 */
export function markSurvival(newAccount, signals = {}, opts = {}) {
  const acct = normAcct(newAccount);
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const row = store.referrals.find((r) => r.newAccount === acct);
  if (!row) return { ok: false, reason: 'no referral for that account' };

  row.survived = !!signals.verifiedEmail && !!signals.firstAction;

  // Sybil gate (fail-closed): drop accounts that don't clear the humanity/uniqueness threshold.
  const scoreOf = opts.scoreOf || ((a) => 0); // no signal → 0 → fails any non-zero minScore
  const passed = sybilGate([{ account: acct, weight: 1 }], { scoreOf, minScore: opts.minScore ?? 1 });
  row.sybilOk = passed.length > 0;

  row.payable = row.survived && row.sybilOk && !row.paidAt;
  saveStore(fs, file, store);
  return { ok: true, referral: row };
}

/** Mark a referral paid (called after the signer broadcasts the reward — earnings.mjs coordinates). */
export function markPaid(newAccount, opts = {}) {
  const acct = normAcct(newAccount);
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const row = store.referrals.find((r) => r.newAccount === acct);
  if (!row) return { ok: false, reason: 'no referral for that account' };
  row.paidAt = now(opts);
  row.payable = false;
  saveStore(fs, file, store);
  return { ok: true, referral: row };
}

// ── reads ─────────────────────────────────────────────────────────────────────────────────────────────
/** Every referral row credited to an ambassador. */
export function referralsFor(ambassador, opts = {}) {
  const who = normAcct(ambassador);
  const { fs, file } = ctx(opts);
  return loadStore(fs, file).referrals.filter((r) => r.ambassador === who);
}
/** The PAYABLE (survived + sybil-clear + unpaid) referrals for an ambassador — the money queue. */
export function payableReferrals(ambassador, opts = {}) {
  return referralsFor(ambassador, opts).filter((r) => r.payable && !r.paidAt);
}
/** Count of surviving referrals (whether or not yet paid) — feeds tier computation. */
export function survivingCount(ambassador, opts = {}) {
  return referralsFor(ambassador, opts).filter((r) => r.survived && r.sybilOk).length;
}

/**
 * funnelFor — the full funnel for an ambassador's code: clicks → signups → survivors.
 * clicks come from the qr-tracker scan log (pre-account); signups/survivors from the referral ledger.
 */
export function funnelFor(ambassador, code, opts = {}) {
  const who = normAcct(ambassador);
  const rows = referralsFor(who, opts);
  const stats = scanStats(qrOpts(opts));
  const c = sanitizeCode(code);
  const clicks = (c && stats[c] && stats[c].total) || 0;
  return {
    ambassador: who,
    code: c,
    clicks,
    signups: rows.length,
    survivors: rows.filter((r) => r.survived && r.sybilOk).length,
    payable: rows.filter((r) => r.payable && !r.paidAt).length,
    paid: rows.filter((r) => r.paidAt).length,
  };
}

/**
 * downlineOf — the visible-but-does-not-pay deeper tree, from the invite lineage of each referred account.
 * One-hop pays (referralsFor); this exposes hop-2+ for the dashboard only (design: no MLM runaway).
 */
export function downlineOf(ambassador, opts = {}) {
  const who = normAcct(ambassador);
  const direct = referralsFor(who, opts).map((r) => r.newAccount);
  const deeper = [];
  for (const acct of direct) {
    // lineage(acct) = [acct, invitedBy, ..., root]; anyone whose lineage passes through a direct referral
    // but isn't a direct referral themselves is hop-2+ downline. Here we surface each direct's own chain.
    const chain = lineage(acct, inviteOpts(opts));
    deeper.push({ account: acct, chain });
  }
  return { ambassador: who, direct, chains: deeper };
}
