// coinflip-provably-fair.mjs — provably-fair coinflip for the KULA / PLAY arcade.
//
// PURE + DETERMINISTIC: no network, no keys, no clock, no disk. Everything an outcome depends on is
// passed in (serverSeed, clientSeed, nonce). Soft-fail-never-throw: garbage in → a safe, well-formed
// result, never an exception (house style — the surface must always render).
//
// ── Design (.local/CASINO_DESIGN_2026-09-02.md step 2: "thin reuse of the dice engine") ───────────
//   This is deliberately a THIN layer over dice-provably-fair.mjs so the audit path is identical:
//   same commit(), same HMAC, same reveal. The only difference is how the shared 0..9999 roll is
//   interpreted — here it is split into two halves rather than compared against a player-set line.
//
//     side = roll < 5000 ? 'heads' : 'tails'
//
//   Both sides therefore have exactly 5000 of the 10000 outcomes — a true 50/50 before the edge.
//   Payout follows the design doc's coinflip line: multiplier = 2 × (1 − edge). At the default 1%
//   edge that is 1.98×, and the expected return on a stake is (1 − edge), i.e. the house is +EV by
//   the edge and by nothing else.
//
//   *** DO NOT USE BLOCKHASH. *** PRANA is our own PoW chain, so the house produces the blocks and
//   any `blockhash` / `prevrandao` / `timestamp` RNG is house-controllable. This engine reads no
//   chain state at all — that is precisely why it is the safe construction here.
//
//   NATIVE TOKEN ONLY, NOT REAL MONEY. `betAmount` is a token-unit number (KULA / PLAY / internal
//   credits). THIS MODULE PERFORMS NO SETTLEMENT AND HOLDS NO KEYS — it computes an outcome and the
//   proof material; the transfer is a Signer-broadcast op that lives out of scope of this file.
//
// ── Exports ──────────────────────────────────────────────────────────────────────────────────────
//   SIDES, DEFAULTS
//   commit(serverSeed)                                        -> serverSeedHash (re-exported)
//   flip({ serverSeed, clientSeed, nonce })                   -> { side, roll, float, hmac }
//   fairMultiplier(edgeBps)                                   -> 2 × (1 − edge)
//   settleFlip({ side, pick, betAmount, edgeBps })            -> { win, payout, multiplier, ... }
//   verifyFlip({ serverSeed, serverSeedHash, clientSeed, nonce, side }) -> boolean
//   esc(s)                                                    -> HTML-escaped string (re-exported)

import {
  commit, roll as diceRoll, verify as diceVerify, esc, ROLL_MAX,
} from './dice-provably-fair.mjs';

export { commit, esc, ROLL_MAX };

// The two outcomes. Order is meaningful: index 0 owns the low half of the roll space.
export const SIDES = Object.freeze(['heads', 'tails']);

export const DEFAULTS = Object.freeze({
  edgeBps: 100,        // 1.00% house edge — same default as the dice table
  pick: 'heads',
});

// Coerce to a finite number or fall back. Never throws.
function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// Normalise a side/pick to 'heads' | 'tails'. Anything unrecognised → null (never throws).
export function normalizeSide(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === 'h' || s === 'heads' || s === '0') return 'heads';
  if (s === 't' || s === 'tails' || s === '1') return 'tails';
  return null;
}

// The half of the roll space that belongs to 'heads'. Exactly half of ROLL_MAX, so neither side is
// favoured before the edge is applied.
export const HEADS_BAND = ROLL_MAX / 2;

// flip({ serverSeed, clientSeed, nonce }) → deterministic { side, roll, float, hmac }.
// Same three inputs ALWAYS yield the same side — that determinism is what makes verifyFlip possible.
export function flip({ serverSeed, clientSeed, nonce } = {}) {
  const r = diceRoll({ serverSeed, clientSeed, nonce });
  const side = r.roll < HEADS_BAND ? SIDES[0] : SIDES[1];
  return { side, roll: r.roll, float: r.float, hmac: r.hmac };
}

// fairMultiplier(edgeBps) → the paid multiplier on a correct call: 2 × (1 − edge).
// edgeBps is basis points (100 = 1%), clamped to [0, 10000] so a garbage edge cannot invert EV.
export function fairMultiplier(edgeBps = DEFAULTS.edgeBps) {
  let bps = Math.trunc(num(edgeBps, DEFAULTS.edgeBps));
  if (bps < 0) bps = 0;
  if (bps > ROLL_MAX) bps = ROLL_MAX;
  return 2 * (1 - bps / ROLL_MAX);
}

// settleFlip({ side, pick, betAmount, edgeBps }) → { win, payout, multiplier, ... }.
// win → payout = betAmount × multiplier (the multiplier already carries the edge); lose → payout = 0.
// An unrecognised side or pick is a loss with a null outcome, never an exception.
export function settleFlip({ side, pick, betAmount, edgeBps } = {}) {
  const outcome = normalizeSide(side);
  const called = normalizeSide(pick) || DEFAULTS.pick;
  const stake = Math.max(0, num(betAmount, 0));
  let bps = Math.trunc(num(edgeBps, DEFAULTS.edgeBps));
  if (bps < 0) bps = 0;
  if (bps > ROLL_MAX) bps = ROLL_MAX;

  const multiplier = fairMultiplier(bps);
  const win = outcome !== null && outcome === called;
  const payout = win ? stake * multiplier : 0;

  return {
    win,
    payout,
    profit: payout - stake,
    multiplier,
    stake,
    side: outcome,
    pick: called,
    edgeBps: bps,
    winChancePct: 50,
  };
}

// verifyFlip({ serverSeed, serverSeedHash, clientSeed, nonce, side }) → boolean.
// Independent audit, delegating the commitment check to the dice engine so both tables prove the
// same way: SHA256(serverSeed) must match the pre-published hash AND the recomputed roll must both
// reproduce the claimed roll and land on the claimed side. Any garbage → false (never throws).
export function verifyFlip({ serverSeed, serverSeedHash, clientSeed, nonce, side } = {}) {
  try {
    const claimed = normalizeSide(side);
    if (claimed === null) return false;
    const recomputed = flip({ serverSeed, clientSeed, nonce });
    if (recomputed.side !== claimed) return false;
    return diceVerify({ serverSeed, serverSeedHash, clientSeed, nonce, roll: recomputed.roll });
  } catch {
    return false;
  }
}

export default {
  SIDES, DEFAULTS, HEADS_BAND, ROLL_MAX,
  commit, flip, fairMultiplier, settleFlip, verifyFlip, normalizeSide, esc,
};
