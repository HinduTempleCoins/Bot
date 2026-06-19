// move-ledger.mjs — the hourly Move earn ledger + settlement (wires the built economy to MELEK payouts).
//
// The economy MATH is already built (move-economy.mjs: moveWeight + settle + the 15%-of-the-blog-pool
// budget). The MISSING seam was the bookkeeping: accumulate each walker's move-weight per HOUR, then at
// hour close split the fixed Move budget across them PROPORTIONALLY (exactly how the content pool splits
// by rshares) and pay each walker in MELEK.
//
// REWARD MODEL (operator, locked): reward = MELEK (testnet TESTS), funded by 15% OF THE BLOG POOL (which
// is 65% of emission). Recipient = a MELEK Graphene ACCOUNT NAME from the signup plugin — NOT a 0x
// address (this is move-to-earn on the MELEK chain, not an EVM/PoL claim). Payout = an on-chain MELEK
// transfer, signed by the INJECTED transfer dep (zero-WIF here, same pattern as signup/welcome-grant.mjs).
//
// Persistence is a single JSON file (injectable fs; default path from MOVE_DATA). Pure where it can be,
// soft-fail everywhere, fully offline-testable.
//
//   import { epochNow, recordMine, readEpoch, settleEpoch, standingFor } from './move-ledger.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { settle, moveBudgetForEpoch, STAKE_FLOOR } from './move-economy.mjs';
import { validAccountName, normalizeGrant, esc } from '../../signup/welcome-grant.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const EPOCH_SEC = () => Number(env('GEO_EPOCH_SEC', '3600')) || 3600;     // hourly, matches attester
export const DATA_FILE = () => env('MOVE_DATA', join(process.cwd(), 'data', 'move-ledger.json'));
export const KEEP_EPOCHS = () => Number(env('MOVE_KEEP_EPOCHS', '168')) || 168;  // ~1 week of hours

/** The current hourly epoch bucket (integer). Pass now (ms) for determinism in tests. */
export function epochNow(now) {
  const ms = now != null ? now : Date.now();
  return Math.floor(Math.floor(ms / 1000) / EPOCH_SEC());
}

// ── tiny injectable fs (so tests run with an in-memory store) ───────────────────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { epochs: {} };
  try { const o = JSON.parse(raw); return o && o.epochs ? o : { epochs: {} }; } catch { return { epochs: {} }; }
}
function saveStore(fs, file, store) {
  // prune to the most recent KEEP_EPOCHS so the file can't grow forever
  const keys = Object.keys(store.epochs).map(Number).sort((a, b) => b - a);
  for (const k of keys.slice(KEEP_EPOCHS())) delete store.epochs[k];
  (fs.write || realFs.write)(file, JSON.stringify(store));
}

/**
 * Record one mine: add the walker's move-weight to the current epoch's tally for their MELEK account.
 * Weight is accumulated (a walker who mines several times in the hour sums their weights, with the
 * per-mine diminishing already applied upstream by move-economy). Returns the walker's standing.
 * @param {{account:string, weight:number}} mine
 * @param {{epoch?:number, now?:number, fs?:object, file?:string, budget?:number}} [opts]
 */
export function recordMine({ account, weight } = {}, opts = {}) {
  if (!validAccountName(account)) return { ok: false, reason: 'account must be a valid MELEK account name' };
  const w = Number(weight);
  if (!Number.isFinite(w) || w <= 0) return { ok: false, reason: 'weight must be a positive number' };
  const fs = opts.fs || realFs;
  const file = opts.file || DATA_FILE();
  const ep = opts.epoch != null ? opts.epoch : epochNow(opts.now);
  const store = loadStore(fs, file);
  const bucket = store.epochs[ep] || (store.epochs[ep] = { settled: false, weights: {} });
  if (bucket.settled) return { ok: false, reason: 'epoch already settled', epoch: ep };
  bucket.weights[account] = (bucket.weights[account] || 0) + w;
  saveStore(fs, file, store);
  return { ok: true, epoch: ep, ...standingIn(bucket, account, opts.budget) };
}

// shared: a walker's standing within an epoch bucket — their weight, the total, and their projected slice.
function standingIn(bucket, account, budget) {
  const totalWeight = Object.values(bucket.weights).reduce((s, x) => s + Number(x), 0);
  const accountWeight = Number(bucket.weights[account] || 0);
  const pool = budget != null ? budget : moveBudgetForEpoch();
  const projected = totalWeight > 0 ? (pool * accountWeight) / totalWeight : 0;
  return {
    accountWeight: Math.round(accountWeight),
    totalWeight: Math.round(totalWeight),
    hourlyPool: Math.round(pool * 100) / 100,
    projectedMelek: Math.round(projected * 1000) / 1000,
    miners: Object.keys(bucket.weights).length,
  };
}

/** Read a walker's current standing in an epoch without recording (for a /standing view). */
export function standingFor(account, opts = {}) {
  const fs = opts.fs || realFs;
  const ep = opts.epoch != null ? opts.epoch : epochNow(opts.now);
  const store = loadStore(fs, opts.file || DATA_FILE());
  const bucket = store.epochs[ep];
  if (!bucket) return { ok: true, epoch: ep, accountWeight: 0, totalWeight: 0, hourlyPool: Math.round(moveBudgetForEpoch() * 100) / 100, projectedMelek: 0, miners: 0 };
  return { ok: true, epoch: ep, ...standingIn(bucket, account, opts.budget) };
}

/** Raw claims for an epoch (for inspection / a settlement preview). */
export function readEpoch(epoch, opts = {}) {
  const store = loadStore(opts.fs || realFs, opts.file || DATA_FILE());
  const bucket = store.epochs[epoch];
  if (!bucket) return { epoch, settled: false, claims: [], totalWeight: 0 };
  const claims = Object.entries(bucket.weights).map(([player, weight]) => ({ player, weight: Number(weight) }));
  return { epoch, settled: !!bucket.settled, claims, totalWeight: claims.reduce((s, c) => s + c.weight, 0) };
}

/**
 * Settle one CLOSED epoch: split the Move budget across that hour's walkers by move-weight, then pay each
 * in MELEK via the injected transfer dep. Marks the epoch settled (idempotent — a settled epoch is a
 * no-op). The transfer dep owns its own signing/broadcast (zero WIF here), exactly like welcome-grant.
 *
 * @param {number} epoch
 * @param {object} deps  { transfer({from,to,amount,memo}) -> result }   the on-chain MELEK transfer
 * @param {object} [opts] { budget, from, symbol, memo, fs, file, now, force }
 * @returns {Promise<{ok, epoch, settled, budget, totalWeight, paid:[], errors:[]}>}
 */
export async function settleEpoch(epoch, deps = {}, opts = {}) {
  const fs = opts.fs || realFs;
  const file = opts.file || DATA_FILE();
  const symbol = opts.symbol || env('WELCOME_SYMBOL', 'TESTS');
  const from = opts.from || env('HATHOR_ACCOUNT', 'hathor');
  const cur = epochNow(opts.now);
  if (!opts.force && Number(epoch) >= cur) return { ok: false, epoch, reason: 'epoch not closed yet (still accruing)' };

  const store = loadStore(fs, file);
  const bucket = store.epochs[epoch];
  if (!bucket) return { ok: true, epoch, settled: true, budget: 0, totalWeight: 0, paid: [], errors: [], note: 'no activity this epoch' };
  if (bucket.settled) return { ok: true, epoch, settled: true, alreadySettled: true, budget: 0, totalWeight: 0, paid: [], errors: [] };

  const budget = opts.budget != null ? opts.budget : moveBudgetForEpoch();
  const claims = Object.entries(bucket.weights).map(([player, weight]) => ({ player, weight: Number(weight) }));
  const { totalWeight, payouts } = settle(claims, budget);

  const paid = []; const errors = [];
  if (typeof deps.transfer !== 'function') {
    errors.push('no transfer dep — cannot pay; epoch left UNSETTLED for retry');
    return { ok: false, epoch, settled: false, budget, totalWeight, paid, errors };
  }
  for (const p of payouts) {
    const norm = normalizeGrant(p.amount, symbol);          // -> "X.XXX TESTS", floors dust safely
    if (norm.error || !norm.asset || /^0\.000\s/.test(norm.asset)) continue; // skip dust/zero payouts
    const memo = esc(opts.memo || `MELEK Move reward — hour ${epoch} (weight ${Math.round(p.weight)})`);
    try {
      const r = await deps.transfer({ from, to: p.player, amount: norm.asset, memo });
      paid.push({ player: p.player, amount: norm.asset, share: Math.round(p.share * 1000) / 1000, id: idOf(r) });
    } catch (e) {
      errors.push(`${p.player}:${String((e && e.message) || e).slice(0, 120)}`);
    }
  }
  // settled only if every intended payout landed (else keep open for a retry of the failed ones)
  const settled = errors.length === 0;
  if (settled) { bucket.settled = true; saveStore(fs, file, store); }
  return { ok: settled, epoch, settled, budget: Math.round(budget * 1000) / 1000, totalWeight: Math.round(totalWeight), paid, errors };
}
const idOf = (r) => (!r ? true : typeof r === 'string' ? r : (r.id || r.trx_id || r.block_num || true));

// ── CLI: inspect / settle (settle prints a DRY plan unless a real transfer is wired on the host) ─────
if (process.argv[1] && process.argv[1].endsWith('move-ledger.mjs')) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'epoch') {
    console.log(JSON.stringify(readEpoch(arg != null ? Number(arg) : epochNow(), {}), null, 2));
  } else if (cmd === 'settle') {
    // DRY by default: stub transfer just echoes what WOULD be sent (no chain, no keys here).
    const stub = { transfer: async ({ to, amount }) => ({ id: `dry-${to}-${amount.split(' ')[0]}` }) };
    settleEpoch(arg != null ? Number(arg) : epochNow() - 1, stub, { force: arg == null ? false : true })
      .then((r) => console.log(JSON.stringify(r, null, 2)));
  } else {
    console.log(`MELEK Move ledger. current epoch ${epochNow()}\n  usage: move-ledger.mjs [epoch <n> | settle <n>]`);
  }
}
