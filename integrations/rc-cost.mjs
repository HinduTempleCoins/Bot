// rc-cost.mjs — PURE, deterministic Resource-Credit (RC) cost estimator for Graphene chain ops.
// No network, no chain calls, no keys, no I/O, no LLM. Backlog 177ba03979.
//
// PURPOSE (read before changing numbers):
//   On a Graphene/Steem-family chain (which MELEK is), every broadcast op spends "Resource Credits"
//   (RC) drawn from an account's RC mana pool. Mana regenerates linearly over a fixed window. A user
//   asking "how often can my account do X?" or "how long until I can afford Y?" needs a NUMERIC
//   answer that does NOT require a live RC-API call. This module is that calculator: feed it the op
//   shape and the pool params, get back per-op RC, regen, ops-remaining, and time-to-afford.
//
//   This is DISTINCT from integrations/rc-usage.mjs:
//     - rc-usage.mjs   = the Admin-Panel "used vs on-the-shelf" READER report (descriptive, what an
//                        account has consumed) — it reads/renders observed usage.
//     - rc-cost.mjs    = a pure ARITHMETIC calculator with INJECTED pool params (predictive, what an
//                        op will cost and how long mana lasts). Different question, no I/O.
//
// RC COST MODEL (Graphene RC, simplified):
//   An op's RC cost is dominated by three resources, summed:
//     execution / base   — a flat per-op cost (baseRc).
//     network  / history — proportional to serialized size in bytes (rcPerByte * sizeBytes).
//     state              — proportional to the persistent state bytes it writes
//                          (rcPerStateByte * stateBytes); a new account also pays a large
//                          state premium (NEW_ACCOUNT_STATE_RC).
//   opRc = baseRc + rcPerByte*sizeBytes + rcPerStateByte*stateBytes + (newAccount ? NEW_ACCOUNT_STATE_RC : 0)
//
// DEFAULT CONSTANTS (approximations sourced from public Graphene/Steem RC documentation and
//   resource-credit cost-curve discussion; the real chain recomputes coefficients dynamically from
//   pool budgets, so these are ORDER-OF-MAGNITUDE defaults, all OVERRIDABLE via args):
//     DEFAULT_RC_PER_BYTE        ≈ 100      RC per serialized byte (network resource).
//     DEFAULT_RC_PER_STATE_BYTE  ≈ 7_000    RC per persistent state byte (state resource is dear).
//     DEFAULT_BASE_RC            ≈ 100_000  flat execution cost charged on every op.
//     NEW_ACCOUNT_STATE_RC       ≈ 1.0e10   extra state premium for account_create (very large).
//
// SOFT-FAIL, NEVER THROW: NaN / negative / missing / wrong-type inputs collapse to safe defaults
//   (0 RC, 0 regen, 0 ops, unreachable→null). Every function returns a well-formed value.
//
//   import { rcCostOf, manaRegen, opsRemaining, timeToAfford } from './integrations/rc-cost.mjs';
//   rcCostOf({ op: 'comment', sizeBytes: 400, stateBytes: 0 });   // -> { opRc }
//
// CLI:  node integrations/rc-cost.mjs        # print a worked example

// ── default cost coefficients (public-docs approximations; override via args) ───────────────────
export const DEFAULT_RC_PER_BYTE = 100;
export const DEFAULT_RC_PER_STATE_BYTE = 7000;
export const DEFAULT_BASE_RC = 100000;
export const NEW_ACCOUNT_STATE_RC = 1.0e10;

// ── numeric coercion: any garbage -> a finite, non-negative number (default 0) ──────────────────
function num(v, dflt = 0) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return n < 0 ? 0 : n;
}

// rcCostOf — per-op RC cost. Soft-fails to { opRc: 0 } on garbage.
export function rcCostOf(args) {
  const {
    op,
    sizeBytes,
    stateBytes,
    newAccount,
    rcPerByte,
    rcPerStateByte,
    baseRc,
  } = args && typeof args === 'object' ? args : {};
  void op; // op name is informational only; the cost is driven by the byte/state shape.
  const perByte = num(rcPerByte, DEFAULT_RC_PER_BYTE);
  const perState = num(rcPerStateByte, DEFAULT_RC_PER_STATE_BYTE);
  const base = num(baseRc, DEFAULT_BASE_RC);
  const sz = num(sizeBytes);
  const st = num(stateBytes);
  const newAcct = newAccount === true ? NEW_ACCOUNT_STATE_RC : 0;
  const opRc = base + perByte * sz + perState * st + newAcct;
  return { opRc: Number.isFinite(opRc) && opRc >= 0 ? opRc : 0 };
}

// manaRegen — how much mana an account regenerates over elapsedSeconds, and the fraction of max.
//   Mana regenerates linearly: maxMana over regenSeconds. Capped at maxMana (cannot over-regen).
//   regenSeconds<=0 -> no regen (avoids divide-by-zero). Soft-fails to zeros.
export function manaRegen(args) {
  const { maxMana, regenSeconds, elapsedSeconds } = args && typeof args === 'object' ? args : {};
  const max = num(maxMana);
  const window = num(regenSeconds);
  const elapsed = num(elapsedSeconds);
  if (max <= 0 || window <= 0) return { regenerated: 0, fraction: 0 };
  const raw = (max * elapsed) / window;
  const regenerated = raw > max ? max : raw;
  const fraction = max > 0 ? regenerated / max : 0;
  return { regenerated, fraction };
}

// opsRemaining — integer count of ops affordable right now from currentMana at opRc each.
//   opRc<=0 -> 0 (an op that costs nothing/garbage yields no meaningful count). Floors.
export function opsRemaining(args) {
  const { currentMana, opRc } = args && typeof args === 'object' ? args : {};
  const mana = num(currentMana);
  const cost = num(opRc);
  if (cost <= 0) return 0;
  return Math.floor(mana / cost);
}

// timeToAfford — seconds of regen until currentMana reaches neededRc.
//   0 if already affordable. null if unreachable (neededRc > maxMana, or no regen). Linear regen.
export function timeToAfford(args) {
  const { neededRc, currentMana, maxMana, regenSeconds } = args && typeof args === 'object' ? args : {};
  const needed = num(neededRc);
  const current = num(currentMana);
  const max = num(maxMana);
  const window = num(regenSeconds);
  if (needed <= 0 || current >= needed) return 0;        // already affordable
  if (max > 0 && needed > max) return null;              // can never hold enough mana
  if (window <= 0 || max <= 0) return null;              // no regen -> unreachable
  const deficit = needed - current;
  const rate = max / window;                             // mana per second
  if (rate <= 0) return null;
  const seconds = deficit / rate;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

// ── CLI demo (guarded; stdout only) ─────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const maxMana = 5.0e9; // example RC mana pool
  const regenSeconds = 432000; // Steem-family RC regen window ≈ 5 days
  const ops = [
    { op: 'vote', sizeBytes: 120, stateBytes: 0 },
    { op: 'comment', sizeBytes: 600, stateBytes: 8 },
    { op: 'transfer', sizeBytes: 180, stateBytes: 0 },
    { op: 'create_account_with_keys_delegated', sizeBytes: 300, stateBytes: 64, newAccount: true },
  ];
  console.log(`RC cost estimator — maxMana=${maxMana}, regen window=${regenSeconds}s`);
  for (const o of ops) {
    const { opRc } = rcCostOf(o);
    const remaining = opsRemaining({ currentMana: maxMana, opRc });
    const tta = timeToAfford({ neededRc: opRc, currentMana: 0, maxMana, regenSeconds });
    const ttaStr = tta === null ? 'unreachable' : `${Math.round(tta)}s from empty`;
    console.log(`  ${o.op.padEnd(38)} opRc=${opRc.toLocaleString()}  ops@full=${remaining}  affordFromEmpty=${ttaStr}`);
  }
  const { regenerated, fraction } = manaRegen({ maxMana, regenSeconds, elapsedSeconds: regenSeconds / 2 });
  console.log(`  half-window regen: ${regenerated.toLocaleString()} (${(fraction * 100).toFixed(1)}% of max)`);
}
