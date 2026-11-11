// drive-ledger.mjs — the hourly MELEK Drive ledger + the drive_pay settlement.
//
// Same bookkeeping job move-ledger.mjs does for walking, for the DRIVE lane: accumulate each driver's
// drive-weight (and their claimed miles, so the per-hour mile cap is enforced across samples) per HOUR,
// then at hour close hand the chain that hour's integer weights in ONE attested `drive_pay` custom_json.
// The chain draws a capped slice (45.000 MELEK/epoch) from the "move" reward fund, splits it pro-rata
// straight to each driver's liquid balance, and advances dgpo.last_drive_pay_epoch.
//
// No MELEK of ours is spent, no relay account, no per-driver transfer, and NO KEY LIVES HERE — the
// broadcast dep owns its own signing (the box runner JIT-fetches the attester's active key per run).
// Persistence is one JSON file (injectable fs; path from DRIVE_DATA). Soft-fail everywhere, offline.
//
//   import { recordDrive, driverStanding, buildDrivePay, settleDriveEpoch } from './drive-ledger.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { settle } from './move-economy.mjs';
import { epochNow } from './move-ledger.mjs';
import { driveWeight, driveDiminish, classify, driveBudgetForEpoch, DRIVE_MILES_CAP, gasEquivalent } from './drive-economy.mjs';
import { validAccountName } from '../../signup/welcome-grant.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const DATA_FILE = () => env('DRIVE_DATA', join(process.cwd(), 'data', 'drive-ledger.json'));
export const KEEP_EPOCHS = () => Number(env('DRIVE_KEEP_EPOCHS', '168')) || 168;   // ~1 week of hours
export { epochNow };

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
  const keys = Object.keys(store.epochs).map(Number).sort((a, b) => b - a);
  for (const k of keys.slice(KEEP_EPOCHS())) delete store.epochs[k];
  (fs.write || realFs.write)(file, JSON.stringify(store));
}
const emptyBucket = () => ({ settled: false, weights: {}, miles: {}, samples: {} });

/**
 * Record one drive sample. The sample is classified first: walking and impossible speeds earn nothing
 * in this lane (walking has its own), and miles beyond the hourly cap are dropped rather than paid.
 *
 * @param {{account:string, miles:number, seconds?:number, avgMph?:number, stake?:number, source?:string}} sample
 * @param {{epoch?:number, now?:number, fs?:object, file?:string, budget?:number}} [opts]
 * @returns {{ok:boolean, reason?:string, lane?:string} & object}
 */
export function recordDrive(sample, opts = {}) {
  const { account, miles, seconds, avgMph, stake = 0, source } = sample || {};
  const who = String(account || '').trim().toLowerCase();
  if (!validAccountName(who)) return { ok: false, reason: 'account must be a valid MELEK account name' };
  const cls = classify({ miles, seconds, avgMph });
  if (cls.lane !== 'drive') return { ok: false, lane: cls.lane, reason: cls.reason || 'not a drive sample', avgMph: round(cls.avgMph, 1) };

  const fs = opts.fs || realFs;
  const file = opts.file || DATA_FILE();
  const ep = opts.epoch != null ? opts.epoch : epochNow(opts.now);
  const store = loadStore(fs, file);
  const bucket = store.epochs[ep] || (store.epochs[ep] = emptyBucket());
  if (bucket.settled) return { ok: false, reason: 'epoch already settled', epoch: ep };

  const milesAlready = Number(bucket.miles[who] || 0);
  const room = Math.max(0, DRIVE_MILES_CAP() - milesAlready);
  if (!(room > 0)) return { ok: false, reason: `hourly mile cap reached (${DRIVE_MILES_CAP()} mi) — the rest of this hour's miles are not counted`, epoch: ep, milesThisHour: round(milesAlready, 2) };

  const idx = Number(bucket.samples[who] || 0);
  const counted = Math.min(cls.miles, room);
  const w = driveWeight({ stake, miles: cls.miles, source, diminish: driveDiminish(idx), milesAlready });
  if (!(w > 0)) return { ok: false, reason: 'no weight earned from this sample', epoch: ep };

  bucket.weights[who] = (bucket.weights[who] || 0) + w;
  bucket.miles[who] = milesAlready + counted;
  bucket.samples[who] = idx + 1;
  saveStore(fs, file, store);
  return {
    ok: true, lane: 'drive', epoch: ep, account: who,
    avgMph: round(cls.avgMph, 1), milesCounted: round(counted, 2), milesDropped: round(cls.miles - counted, 2),
    sampleIndex: idx, ...standingIn(bucket, who, opts.budget),
  };
}

// shared: a driver's standing within an epoch bucket — weight, total, and the projected MELEK slice.
function standingIn(bucket, account, budget) {
  const totalWeight = Object.values(bucket.weights).reduce((s, x) => s + Number(x), 0);
  const accountWeight = Number(bucket.weights[account] || 0);
  const pool = budget != null ? budget : driveBudgetForEpoch();
  const projected = totalWeight > 0 ? (pool * accountWeight) / totalWeight : 0;
  return {
    accountWeight: Math.round(accountWeight),
    totalWeight: Math.round(totalWeight),
    hourlyPool: round(pool, 3),
    projectedMelek: round(projected, 3),
    milesThisHour: round(Number(bucket.miles[account] || 0), 2),
    drivers: Object.keys(bucket.weights).length,
  };
}

/** Read a driver's current standing without recording — plus what that MELEK buys in gas. */
export function driverStanding(account, opts = {}) {
  const who = String(account || '').trim().toLowerCase();
  const fs = opts.fs || realFs;
  const ep = opts.epoch != null ? opts.epoch : epochNow(opts.now);
  const store = loadStore(fs, opts.file || DATA_FILE());
  const bucket = store.epochs[ep];
  const base = bucket
    ? standingIn(bucket, who, opts.budget)
    : { accountWeight: 0, totalWeight: 0, hourlyPool: round(driveBudgetForEpoch(), 3), projectedMelek: 0, milesThisHour: 0, drivers: 0 };
  return { ok: true, epoch: ep, account: who, ...base, gas: gasEquivalent({ melek: base.projectedMelek, melekUsd: opts.melekUsd }) };
}

/** Erase a driver from every epoch bucket — the data-deletion seam (Play requirement), same as walking. */
export function forgetDriver(account, opts = {}) {
  const a = String(account || '').trim().toLowerCase();
  if (!validAccountName(a)) return { ok: false, account: a, removed: 0, reason: 'invalid account name' };
  const fs = opts.fs || realFs;
  const file = opts.file || DATA_FILE();
  const store = loadStore(fs, file);
  let removed = 0;
  for (const k of Object.keys(store.epochs)) {
    const b = store.epochs[k];
    if (b && b.weights && Object.prototype.hasOwnProperty.call(b.weights, a)) {
      delete b.weights[a]; if (b.miles) delete b.miles[a]; if (b.samples) delete b.samples[a];
      removed++;
    }
  }
  if (removed) saveStore(fs, file, store);
  return { ok: true, account: a, removed };
}

/** Raw claims for an epoch (inspection / settlement preview). */
export function readDriveEpoch(epoch, opts = {}) {
  const store = loadStore(opts.fs || realFs, opts.file || DATA_FILE());
  const bucket = store.epochs[epoch];
  if (!bucket) return { epoch, settled: false, claims: [], totalWeight: 0 };
  const claims = Object.entries(bucket.weights).map(([player, weight]) => ({ player, weight: Number(weight), miles: round(Number((bucket.miles || {})[player] || 0), 2) }));
  return { epoch, settled: !!bucket.settled, claims, totalWeight: claims.reduce((s, c) => s + c.weight, 0) };
}

/** Preview the split the chain will make for an epoch (pure — the same proportional math). */
export function previewDriveSettlement(epoch, opts = {}) {
  const { claims } = readDriveEpoch(epoch, opts);
  return settle(claims, opts.budget != null ? opts.budget : driveBudgetForEpoch());
}

/**
 * Build the `drive_pay` payload for a CLOSED epoch — the per-driver integer weights the chain splits.
 * Invalid names and zero-weight rows are dropped; rows are sorted for a deterministic op. PURE.
 * @returns {{epoch:number, pay:[string,number][], totalWeight:number, claims:number}}
 */
export function buildDrivePay(epoch, opts = {}) {
  const store = loadStore(opts.fs || realFs, opts.file || DATA_FILE());
  const bucket = store.epochs[epoch];
  const pay = [];
  if (bucket) for (const [acct, w] of Object.entries(bucket.weights)) {
    const wi = Math.round(Number(w));
    if (validAccountName(acct) && Number.isFinite(wi) && wi > 0) pay.push([acct, wi]);
  }
  pay.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { epoch: Number(epoch), pay, totalWeight: pay.reduce((s, r) => s + r[1], 0), claims: pay.length };
}

/**
 * Settle a CLOSED drive epoch: broadcast ONE `drive_pay` custom_json (the chain pays each driver their
 * pro-rata slice of a capped draw from the "move" fund). Idempotent: a locally-settled epoch, an empty
 * epoch, or one the chain already advanced past is a no-op. A failed broadcast leaves the hour OPEN.
 *
 * @param {number} epoch
 * @param {object} deps  { broadcastDrivePay({epoch, pay}) -> result }  signs with the attester ACTIVE key
 * @param {object} [opts] { fs, file, now, force }
 */
export async function settleDriveEpoch(epoch, deps = {}, opts = {}) {
  const fs = opts.fs || realFs;
  const file = opts.file || DATA_FILE();
  const cur = epochNow(opts.now);
  if (!opts.force && Number(epoch) >= cur) return { ok: false, epoch, reason: 'epoch not closed yet (still accruing)' };

  const store = loadStore(fs, file);
  const bucket = store.epochs[epoch];
  if (!bucket) return { ok: true, epoch, settled: true, claims: 0, totalWeight: 0, pay: [], note: 'no activity this epoch' };
  if (bucket.settled) return { ok: true, epoch, settled: true, alreadySettled: true, claims: 0, totalWeight: 0, pay: [] };

  const { pay, totalWeight, claims } = buildDrivePay(epoch, { fs, file });
  if (pay.length === 0) { bucket.settled = true; saveStore(fs, file, store); return { ok: true, epoch, settled: true, claims: 0, totalWeight: 0, pay: [], note: 'no payable drivers (all dust/invalid)' }; }
  if (typeof deps.broadcastDrivePay !== 'function') return { ok: false, epoch, settled: false, claims, totalWeight, pay, errors: ['no broadcastDrivePay dep — cannot settle'] };

  try {
    const r = await deps.broadcastDrivePay({ epoch: Number(epoch), pay });
    bucket.settled = true; saveStore(fs, file, store);
    return { ok: true, epoch, settled: true, claims, totalWeight, pay, id: idOf(r) };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/already settled/i.test(msg)) { bucket.settled = true; saveStore(fs, file, store); return { ok: true, epoch, settled: true, alreadySettled: true, claims, totalWeight, pay, note: 'chain already past this epoch' }; }
    return { ok: false, epoch, settled: false, claims, totalWeight, pay, errors: [msg.slice(0, 160)] };
  }
}
const idOf = (r) => (!r ? true : typeof r === 'string' ? r : (r.id || r.trx_id || r.block_num || true));
const round = (n, p) => { const f = 10 ** p; return Math.round(Number(n) * f) / f; };

// ── CLI: inspect / preview (settling for real is the box runner's job — it holds the key) ───────────
if (process.argv[1] && process.argv[1].endsWith('drive-ledger.mjs')) {
  const [cmd, arg] = process.argv.slice(2);
  const ep = arg != null ? Number(arg) : epochNow();
  if (cmd === 'epoch') console.log(JSON.stringify(readDriveEpoch(ep, {}), null, 2));
  else if (cmd === 'pay') console.log(JSON.stringify(buildDrivePay(ep, {}), null, 2));
  else if (cmd === 'preview') console.log(JSON.stringify(previewDriveSettlement(ep, {}), null, 2));
  else console.log(`MELEK Drive ledger. current epoch ${epochNow()}\n  usage: drive-ledger.mjs [epoch <n> | pay <n> | preview <n>]`);
}
