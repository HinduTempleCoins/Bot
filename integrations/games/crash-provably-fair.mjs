// crash-provably-fair.mjs — provably-fair crash/multiplier game for the KULA / PLAY arcade.
//
// PURE + DETERMINISTIC: no network, no keys, no clock, no disk. Everything an outcome depends on is
// passed in (serverSeed, clientSeed, nonce). Soft-fail-never-throw: garbage in → a safe, well-formed
// result, never an exception (house style — the surface must always render).
//
// ── Design (.local/CASINO_DESIGN_2026-09-02.md step 3) ────────────────────────────────────────────
//   Same commit-reveal spine as the dice and coinflip tables — same commit(), same HMAC, same
//   reveal — so all three audit identically. Crash differs only in how the digest is consumed: the
//   game needs a heavy-tailed multiplier, not a uniform 0..9999 roll, so it takes 52 bits of the
//   HMAC and applies inverse-transform sampling:
//
//     H     = first 52 bits of HMAC_SHA256(serverSeed, `clientSeed:nonce`)   → 0 .. 2^52-1
//     U     = (H + 1) / 2^52                                                 → uniform (0, 1]
//     crash = max(1, floor(100 · r / U) / 100),   where r = 1 − edge
//
//   That yields exactly the design doc's survival function:
//
//     P(crash ≥ m) = P(r/U ≥ m) = P(U ≤ r/m) = r/m        for m ≥ r
//
//   and therefore a constant house edge at EVERY cash-out target: a player who cashes out at m wins
//   m × stake with probability r/m, so EV = m · (r/m) = r = (1 − edge) × stake. The edge cannot be
//   dodged by picking a different target, which is the property that makes the game honest to state.
//
//   *** DO NOT USE BLOCKHASH. *** PRANA is our own PoW chain, so the house produces the blocks and
//   any `blockhash` / `prevrandao` / `timestamp` RNG is house-controllable — and a losing proposer
//   could withhold a block to re-roll. This engine reads no chain state at all.
//
//   NATIVE TOKEN ONLY, NOT REAL MONEY. `betAmount` is a token-unit number (KULA / PLAY / internal
//   credits). THIS MODULE PERFORMS NO SETTLEMENT AND HOLDS NO KEYS.
//
// ── Exports ──────────────────────────────────────────────────────────────────────────────────────
//   DEFAULTS, TWO_52, MIN_CRASH
//   commit(serverSeed)                                          -> serverSeedHash (re-exported)
//   crashPoint({ serverSeed, clientSeed, nonce, edgeBps })       -> { crash, h, u, hmac }
//   survivalProbability(m, edgeBps)                              -> P(crash ≥ m)
//   settleCrash({ crash, cashOutAt, betAmount })                 -> { win, payout, multiplier, ... }
//   verifyCrash({ serverSeed, serverSeedHash, clientSeed, nonce, crash, edgeBps }) -> boolean
//   esc(s)                                                       -> HTML-escaped string (re-exported)

import { createHmac } from 'node:crypto';
import { commit, esc, ROLL_MAX } from './dice-provably-fair.mjs';

export { commit, esc };

export const TWO_52 = 2 ** 52;        // the 52-bit sample space (exactly representable in a double)
export const MIN_CRASH = 1;           // the game never resolves below 1.00×
export const CRASH_PRECISION = 100;   // two decimal places, as displayed

export const DEFAULTS = Object.freeze({
  edgeBps: 100,        // 1.00% house edge — same default as the other tables
  cashOutAt: 2,
});

// Coerce to a finite number or fall back. Never throws.
function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// Coerce anything to a stable string for hashing. null/undefined → '' so garbage never throws.
function str(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return String(v); } catch { return ''; }
}

// Clamp an edge in basis points to [0, ROLL_MAX] and return it as a 0..1 fraction.
function edgeFraction(edgeBps) {
  let bps = Math.trunc(num(edgeBps, DEFAULTS.edgeBps));
  if (bps < 0) bps = 0;
  if (bps > ROLL_MAX) bps = ROLL_MAX;
  return { bps, edge: bps / ROLL_MAX };
}

// The core HMAC — identical construction to the dice engine, so one revealed seed audits every game.
function crashHmac(serverSeed, clientSeed, nonce) {
  try {
    const n = Math.trunc(num(nonce, 0));
    return createHmac('sha256', str(serverSeed)).update(`${str(clientSeed)}:${n}`, 'utf8').digest('hex');
  } catch {
    return '';
  }
}

// Take the leading 52 bits of the digest as an integer in [0, 2^52). 13 hex chars = 52 bits exactly.
function h52(hex) {
  if (!hex || hex.length < 13) return 0;
  const v = parseInt(hex.slice(0, 13), 16);
  return Number.isFinite(v) ? v : 0;
}

// crashPoint({ serverSeed, clientSeed, nonce, edgeBps }) → deterministic { crash, h, u, hmac }.
// Same inputs ALWAYS yield the same crash point — the determinism verifyCrash depends on.
export function crashPoint({ serverSeed, clientSeed, nonce, edgeBps } = {}) {
  const hmac = crashHmac(serverSeed, clientSeed, nonce);
  const h = h52(hmac);
  const { edge } = edgeFraction(edgeBps);
  const r = 1 - edge;
  const u = (h + 1) / TWO_52;                       // uniform in (0, 1]
  const raw = r / u;                                // heavy-tailed: P(raw ≥ m) = r/m
  // Floor to two decimals with a tolerance, because a value that is mathematically 2.55 can arrive
  // as 2.5499999999999998 and a naive floor would silently shave a cent off the player's round.
  // The tolerance is many orders of magnitude below a cent, so it corrects fp drift and nothing else.
  const crash = Math.max(MIN_CRASH, Math.floor(raw * CRASH_PRECISION + 1e-9) / CRASH_PRECISION);
  return { crash, h, u, hmac };
}

// survivalProbability(m, edgeBps) → P(crash ≥ m) = r/m, clamped to [0, 1].
// This is the number a player needs to reason about a target, and it is stated on the surface.
export function survivalProbability(m, edgeBps = DEFAULTS.edgeBps) {
  const target = num(m, 0);
  if (!(target > 0)) return 0;
  const { edge } = edgeFraction(edgeBps);
  const r = 1 - edge;
  if (target <= r) return 1;
  return Math.max(0, Math.min(1, r / target));
}

// settleCrash({ crash, cashOutAt, betAmount }) → { win, payout, multiplier, ... }.
// The player wins when they cashed out at or below where the round actually crashed; the payout
// multiplier is their own chosen target, NOT the crash point (you only ever get what you asked for).
export function settleCrash({ crash, cashOutAt, betAmount } = {}) {
  const at = num(crash, 0);
  const validCrash = at >= MIN_CRASH;
  let target = num(cashOutAt, DEFAULTS.cashOutAt);
  if (!(target >= MIN_CRASH)) target = MIN_CRASH;
  const stake = Math.max(0, num(betAmount, 0));

  const win = validCrash && target <= at;
  const payout = win ? stake * target : 0;

  return {
    win,
    payout,
    profit: payout - stake,
    multiplier: target,
    stake,
    crash: validCrash ? at : null,
    cashOutAt: target,
  };
}

// verifyCrash({ serverSeed, serverSeedHash, clientSeed, nonce, crash, edgeBps }) → boolean.
// Independent audit: SHA256(serverSeed) must match the pre-published commitment AND recomputing the
// crash point from the revealed seeds must reproduce the claimed value. Any garbage → false.
export function verifyCrash({ serverSeed, serverSeedHash, clientSeed, nonce, crash, edgeBps } = {}) {
  try {
    const hash = commit(serverSeed);
    if (!hash) return false;
    if (str(serverSeedHash).trim().toLowerCase() !== hash.toLowerCase()) return false;
    const recomputed = crashPoint({ serverSeed, clientSeed, nonce, edgeBps }).crash;
    return recomputed === num(crash, -1);
  } catch {
    return false;
  }
}

export default {
  DEFAULTS, TWO_52, MIN_CRASH, CRASH_PRECISION,
  commit, crashPoint, survivalProbability, settleCrash, verifyCrash, esc,
};
