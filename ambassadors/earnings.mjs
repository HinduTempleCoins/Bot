// ambassadors/earnings.mjs — the unified, append-only EARNINGS LEDGER (Phase A, design (a) + (e)).
//
// One running total per ambassador across the three earning legs — REFERRAL, CURATION, OUTREACH — with
// every line traceable to its source event. The ledger is APPEND-ONLY (the karma/index.mjs idiom):
// nothing is mutated or removed; a total is the sum of the lines. Read-only for the dashboard; payout is
// by the reward daemon, never a button here.
//
// CRITICAL BOUNDARY: this module computes PLANS and records ledger lines. It NEVER signs and never
// broadcasts. Every reward is an UNSIGNED intent (standard MELEK-Engine `tokens.transfer` custom_json,
// same call shape as pentecaust/herald/token-programs.mjs) handed to MELEK-Signer by a daemon later.
// Zero WIF in this repo. Rewards pay on SURVIVAL/MERIT (from attribution.mjs), never on raw signups.
//
//   • recordEarning(line)      — append one immutable earned/paid line.
//   • totalsFor(ambassador)    — sum by leg + grand total.
//   • ledgerFor(ambassador)    — the raw lines.
//   • planReferralReward(amb)  — UNSIGNED plan over the ambassador's payable referrals (referral leg).
//   • planCurationReward / recordOutreachConversion — Phase-B/C stubs (clearly marked).
//
//   import { recordEarning, totalsFor, ledgerFor, planReferralReward } from './earnings.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { payableReferrals, survivingCount } from './attribution.mjs';
import { getAmbassador } from './registry.mjs';
import { tierFor } from './registry.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const DATA_FILE = () => env('AMBASSADOR_EARNINGS_DATA', join(process.cwd(), 'data', 'ambassador-earnings.json'));
export const REFERRAL_BOUNTY_UNITS = () => Number(env('AMBASSADOR_REFERRAL_BOUNTY', '10')) || 0; // token units per surviving referral
export const REWARD_TOKEN = () => String(env('AMBASSADOR_REWARD_TOKEN', 'MELEK'));
const now = (o) => (o && o.now != null ? o.now : Date.now());
const normAcct = (a) => { const s = String(a || '').trim().toLowerCase(); return s || null; };
const num = (x) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const LEGS = new Set(['referral', 'curation', 'outreach']);

// ── injectable fs + store (append-only lines) ─────────────────────────────────────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { lines: [] };
  try { const o = JSON.parse(raw); return o && Array.isArray(o.lines) ? o : { lines: [] }; }
  catch { return { lines: [] }; }
}
const saveStore = (fs, file, s) => (fs.write || realFs.write)(file, JSON.stringify(s));
const ctx = (o = {}) => ({ fs: o.fs || realFs, file: o.file || DATA_FILE() });
const attrOpts = (o = {}) => ({ ...(o.attribution || {}), fs: o.fs, now: o.now });
const regOpts = (o = {}) => ({ fs: o.fs, file: o.registryFile, ...(o.registry || {}) });

// ── append + read ─────────────────────────────────────────────────────────────────────────────────────
/**
 * recordEarning — append one immutable ledger line.
 * @param {object} line { ambassador, leg:'referral|curation|outreach', amount, token?, source?, kind? }
 *   kind: 'earned' (accrued) | 'paid' (broadcast by the signer). Default 'earned'.
 */
export function recordEarning(line = {}, opts = {}) {
  const ambassador = normAcct(line.ambassador);
  if (!ambassador) return { ok: false, reason: 'invalid ambassador' };
  if (!LEGS.has(line.leg)) return { ok: false, reason: `leg must be one of ${[...LEGS].join('/')}` };
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const entry = {
    ambassador, leg: line.leg,
    amount: num(line.amount),
    token: String(line.token || REWARD_TOKEN()),
    kind: line.kind === 'paid' ? 'paid' : 'earned',
    source: line.source == null ? '' : String(line.source),
    ts: now(opts),
    seq: store.lines.length,
  };
  store.lines.push(entry);
  saveStore(fs, file, store);
  return { ok: true, entry };
}

/** Every ledger line for an ambassador, in append order. */
export function ledgerFor(ambassador, opts = {}) {
  const who = normAcct(ambassador);
  const { fs, file } = ctx(opts);
  return loadStore(fs, file).lines.filter((l) => l.ambassador === who);
}

/** Sum by leg + grand total (earned) and a paid subtotal, for the dashboard. */
export function totalsFor(ambassador, opts = {}) {
  const lines = ledgerFor(ambassador, opts);
  const byLeg = { referral: 0, curation: 0, outreach: 0 };
  let total = 0, paid = 0;
  for (const l of lines) {
    byLeg[l.leg] = (byLeg[l.leg] || 0) + l.amount;
    total += l.amount;
    if (l.kind === 'paid') paid += l.amount;
  }
  return { ambassador: normAcct(ambassador), token: REWARD_TOKEN(), byLeg, total, paid, lines: lines.length };
}

// ── referral leg: UNSIGNED plan over payable referrals ───────────────────────────────────────────────
/**
 * planReferralReward — build an UNSIGNED token-transfer plan for an ambassador's payable referrals.
 * amount = bounty × (#payable referrals) × tier multiplier. Emits the same custom_json shape
 * token-programs.mjs uses; `unsigned:true` — a daemon hands it to MELEK-Signer. SIGNS NOTHING.
 *
 * @param {string} ambassador
 * @param {object} opts { bountyUnits?, token?, attribution?, registryFile?, registry?, fs?, now? }
 * @returns {{ok:true, ambassador, leg:'referral', count, units, calls, signed:false} | {ok:false,reason}}
 */
export function planReferralReward(ambassador, opts = {}) {
  const who = normAcct(ambassador);
  if (!who) return { ok: false, reason: 'invalid ambassador' };
  const amb = getAmbassador(who, regOpts(opts));
  if (!amb) return { ok: false, reason: 'unknown ambassador' };

  const payable = payableReferrals(who, attrOpts(opts));
  const count = payable.length;
  const bounty = num(opts.bountyUnits ?? REFERRAL_BOUNTY_UNITS());
  const token = String(opts.token || REWARD_TOKEN());
  const tier = tierFor({ survivingReferrals: survivingCount(who, attrOpts(opts)) });
  const units = Math.floor(bounty * count * (tier.referralMultiplier || 1));

  if (count === 0 || units <= 0) {
    return { ok: true, ambassador: who, leg: 'referral', count, units: '0', calls: [], signed: false, note: 'nothing payable' };
  }
  const calls = [{
    chain: 'melek', op: 'custom_json', id: 'ssc-mainnet-melek',
    json: {
      contractName: 'tokens', contractAction: 'transfer',
      contractPayload: { symbol: token, to: who, quantity: String(units), memo: 'ambassador referral reward' },
    },
    unsigned: true,
  }];
  return {
    ok: true, ambassador: who, leg: 'referral', tier: tier.tier,
    count, token, units: String(units),
    referrals: payable.map((r) => r.newAccount),
    calls, signed: false,
  };
}

// ── Phase-B / Phase-C stubs (clearly marked; rails exist, wiring deferred) ────────────────────────────
/**
 * planCurationReward — PHASE B STUB. The curation leg pays karma-weighted, capped, merit-targeted token
 * rewards. In Phase B this delegates to voting_rules/karma-curation-bridge.mjs (budget) +
 * token-programs.planAirdrop (fromKarma + sybilGate → unsigned plan). Returns a no-op plan for now.
 */
export function planCurationReward(ambassador, opts = {}) { // eslint-disable-line no-unused-vars
  return { ok: true, ambassador: normAcct(ambassador), leg: 'curation', calls: [], signed: false, stub: 'phase-b', note: 'curation leg wired in Phase B (karma-curation-bridge + token-programs.planAirdrop)' };
}

/**
 * recordOutreachConversion — PHASE C STUB. When an ambassador's Herald campaign (own-mailbox, consent-
 * gated) converts a lead, that conversion is a referral event on this same ledger. Wired with the
 * per-tenant Herald leg (tenant-grants + llm-gateway). No-op record for now.
 */
export function recordOutreachConversion(ambassador, lead = {}, opts = {}) { // eslint-disable-line no-unused-vars
  return { ok: true, ambassador: normAcct(ambassador), leg: 'outreach', recorded: false, stub: 'phase-c', note: 'outreach conversions recorded in Phase C (Herald tenant + warmed sender)' };
}

// ── CLI (guarded) — offline demo on a temp store ──────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = `/tmp/ambassador-earnings-demo-${process.pid}.json`;
  const o = { file };
  console.log('MELEK Ambassador earnings ledger — offline demo:\n');
  console.log('record:', JSON.stringify(recordEarning({ ambassador: 'alice', leg: 'referral', amount: 10, source: 'ref:bob' }, o)));
  console.log('totals:', JSON.stringify(totalsFor('alice', o)));
  (async () => { try { const { unlinkSync } = await import('node:fs'); unlinkSync(file); } catch {} })();
}
