// dice-provably-fair.mjs — the provably-fair engine for the KULA native-token casino dice.
//
// PURE + DETERMINISTIC: no network, no keys, no clock, no disk. Everything a roll depends on is
// passed in (serverSeed, clientSeed, nonce). node:crypto only. Soft-fail-never-throw: garbage in
// → a safe, well-formed result, never an exception (house style — the surface must always render).
//
// ── Design (from .local/KULA_LOTTO_DESIGN.md §1, §4a, §6) ─────────────────────────────────────────
//   Provably-fair via off-chain HMAC commit-reveal — the canonical SatoshiDice-lineage scheme:
//     1. House picks a secret `serverSeed` and publishes `serverSeedHash = SHA256(serverSeed)`
//        UP FRONT (the commitment). It cannot swap the seed later without breaking the hash.  → commit()
//     2. The player supplies a `clientSeed` (their own randomness, editable any time) and an
//        incrementing `nonce`.  roll = HMAC_SHA256(key=serverSeed, msg=`clientSeed:nonce`) folded
//        into 0..9999.  → roll()
//     3. On seed rotation the house REVEALS serverSeed; anyone recomputes SHA256(serverSeed) and
//        every past roll to prove nothing was rigged after the fact.  → verify()
//
//   *** DO NOT USE BLOCKHASH. *** (design doc §2, §6, and the CASINO-FRAMING correction.) PRANA is
//   OUR OWN PoW chain, so the house produces the blocks — anything seeded from `blockhash`,
//   `block.prevrandao`, or `block.timestamp` is house-controllable here and MUST NOT feed a money
//   game. The HMAC commit-reveal scheme reads NO block variable at all, which is exactly why it is
//   the safe RNG on a chain we mine ourselves. This engine therefore never touches chain state.
//
//   NATIVE TOKEN ONLY, NOT REAL MONEY. Wagers are the ecosystem's own token (KULA / PLAY / internal
//   credits) — crypto-native entertainment, never fiat. `betAmount` is a token-unit number here; the
//   house edge routes CONCEPTUALLY to burn / buyback-PoL / the immutable Hathor 3% cut (design §5),
//   but THIS MODULE PERFORMS NO SETTLEMENT and HOLDS NO KEYS — it only computes the game outcome. The
//   actual KULA transfer is a Signer-broadcast op that lives out of scope of this file.
//
// ── Exports ──────────────────────────────────────────────────────────────────────────────────────
//   commit(serverSeed)                                  -> serverSeedHash (hex SHA-256)
//   roll({ serverSeed, clientSeed, nonce })             -> { roll:0..9999, float:0..0.9999, hmac }
//   settleBet({ roll, target, over, betAmount, edgeBps })-> { win, payout, multiplier, ... }
//   verify({ serverSeed, serverSeedHash, clientSeed, nonce, roll }) -> boolean
//   esc(s)                                              -> HTML-escaped string
//   Plus small helpers: rollRange (0..9999), winChance(), fairMultiplier(), DEFAULTS.

import { createHash, createHmac } from 'node:crypto';

// Roll space: 0..9999 → two-decimal 0.00–99.99, exactly the doc's `mod 10000` band (§1, §4a).
export const ROLL_MAX = 10000;          // exclusive upper bound → rolls are 0..9999
export const DEFAULTS = Object.freeze({
  edgeBps: 100,                          // 1.00% house edge (design §4a example "edge = 1–2%")
  target: 5000,                          // default line at 50.00
  over: true,
});

// HTML-escape for any interpolated value (house rule). Never throws.
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

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

// commit(serverSeed) → the public commitment SHA256(serverSeed), published BEFORE any bet (design §1).
// Players later recompute this against the revealed seed to prove the seed wasn't swapped.
export function commit(serverSeed) {
  try {
    return createHash('sha256').update(str(serverSeed), 'utf8').digest('hex');
  } catch {
    return '';
  }
}

// The core HMAC. key = serverSeed (the committed secret), message = `clientSeed:nonce` (design §1).
// Returns the hex digest, or '' on any failure (soft-fail).
function rollHmac(serverSeed, clientSeed, nonce) {
  try {
    const n = Math.trunc(num(nonce, 0));
    const msg = `${str(clientSeed)}:${n}`;
    return createHmac('sha256', str(serverSeed)).update(msg, 'utf8').digest('hex');
  } catch {
    return '';
  }
}

// Fold an HMAC-SHA256 hex digest into a uniform 0..9999 integer.
// We consume the digest in 4-hex-char (16-bit) chunks and reject values in the small non-uniform
// tail so the modulo bias is zero (rejection sampling — the industry-standard uniform reduction;
// design §1 "reduced into the range"). If every chunk is exhausted (astronomically unlikely) we
// fall back to a plain modulo of the whole digest so the function is always total.
function foldToRoll(hex) {
  if (!hex || hex.length < 4) return 0;
  const limit = Math.floor(0x10000 / ROLL_MAX) * ROLL_MAX; // 60000: largest multiple of 10000 ≤ 65536
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    const chunk = parseInt(hex.slice(i, i + 4), 16);
    if (!Number.isFinite(chunk)) continue;
    if (chunk < limit) return chunk % ROLL_MAX;
  }
  // Fallback: hash-wide modulo (kept total; bias here is negligible and effectively never reached).
  let acc = 0;
  for (let i = 0; i < hex.length; i++) acc = (acc * 16 + (parseInt(hex[i], 16) || 0)) % ROLL_MAX;
  return acc;
}

// roll({ serverSeed, clientSeed, nonce }) → deterministic { roll, float, hmac }.
// Same three inputs ALWAYS yield the same roll — that determinism is what makes verify() possible.
export function roll({ serverSeed, clientSeed, nonce } = {}) {
  const hmac = rollHmac(serverSeed, clientSeed, nonce);
  const r = foldToRoll(hmac);
  return { roll: r, float: r / ROLL_MAX, hmac };
}

// winChance(target, over) → integer count of winning outcomes out of ROLL_MAX (for multiplier calc).
// over=true  → win when roll >  target   → winning outcomes = (ROLL_MAX-1 - target)
// over=false → win when roll <  target   → winning outcomes = target
export function winChance(target, over) {
  let t = Math.trunc(num(target, DEFAULTS.target));
  if (t < 0) t = 0;
  if (t > ROLL_MAX - 1) t = ROLL_MAX - 1;
  const outcomes = over ? (ROLL_MAX - 1 - t) : t;
  return Math.max(0, Math.min(ROLL_MAX, outcomes));
}

// fairMultiplier(winOutcomes, edgeBps) → payout multiplier including the house edge (design §4a:
// multiplier = (10000 / winRange) × (1 − edge)). With 0 winning outcomes the multiplier is 0.
// edgeBps is basis points (100 = 1%). Clamped to [0, 10000] bps so a garbage edge can't invert EV.
export function fairMultiplier(winOutcomes, edgeBps = DEFAULTS.edgeBps) {
  const w = Math.max(0, Math.trunc(num(winOutcomes, 0)));
  if (w <= 0) return 0;
  let bps = Math.trunc(num(edgeBps, DEFAULTS.edgeBps));
  if (bps < 0) bps = 0;
  if (bps > ROLL_MAX) bps = ROLL_MAX; // 100% edge cap
  const edge = bps / ROLL_MAX;
  return (ROLL_MAX / w) * (1 - edge);
}

// settleBet({ roll, target, over, betAmount, edgeBps }) → { win, payout, multiplier, ... }.
// win → payout = betAmount × multiplier (multiplier already carries the edge); lose → payout = 0.
// The edge means the expected return is (1 − edge) × stake < stake, so the house is +EV by design
// (design §5 — the edge is the treasury inflow; NO on-chain settlement happens here).
export function settleBet({ roll: r, target, over, betAmount, edgeBps } = {}) {
  const isOver = over === undefined ? DEFAULTS.over : !!over;
  const rv = Math.trunc(num(r, -1));
  let t = Math.trunc(num(target, DEFAULTS.target));
  if (t < 0) t = 0;
  if (t > ROLL_MAX - 1) t = ROLL_MAX - 1;
  const stake = Math.max(0, num(betAmount, 0));
  const bps = Math.trunc(num(edgeBps, DEFAULTS.edgeBps));

  const winOutcomes = winChance(t, isOver);
  const multiplier = fairMultiplier(winOutcomes, bps);
  const validRoll = rv >= 0 && rv < ROLL_MAX;
  const win = validRoll && (isOver ? rv > t : rv < t);

  const payout = win ? stake * multiplier : 0;
  const profit = payout - stake;
  const winChancePct = (winOutcomes / ROLL_MAX) * 100;

  return {
    win,
    payout,
    profit,
    multiplier,
    stake,
    roll: validRoll ? rv : null,
    target: t,
    over: isOver,
    edgeBps: Math.max(0, Math.min(ROLL_MAX, bps)),
    winChancePct,
  };
}

// verify({ serverSeed, serverSeedHash, clientSeed, nonce, roll }) → boolean.
// Independent audit: (1) SHA256(serverSeed) must equal the pre-published serverSeedHash (proves the
// house didn't swap the seed), AND (2) recomputing roll() from the revealed seeds must reproduce the
// claimed roll. Both must hold. Any garbage → false (never throws). This is the player's proof tool.
export function verify({ serverSeed, serverSeedHash, clientSeed, nonce, roll: claimed } = {}) {
  try {
    const hash = commit(serverSeed);
    if (!hash) return false;
    // Commitment check — tolerate case, require exact hex match.
    if (str(serverSeedHash).trim().toLowerCase() !== hash.toLowerCase()) return false;
    const recomputed = roll({ serverSeed, clientSeed, nonce }).roll;
    return recomputed === Math.trunc(num(claimed, -1));
  } catch {
    return false;
  }
}

export default { commit, roll, settleBet, verify, esc, winChance, fairMultiplier, ROLL_MAX, DEFAULTS };
