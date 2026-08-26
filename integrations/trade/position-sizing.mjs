// integrations/trade/position-sizing.mjs — DRAFT (NOT WIRED IN). Fractional-Kelly position sizing
// with hard caps. Pure math, no network, no keys, no execution.
//
// ┌─ HARD SAFETY INVARIANT ─────────────────────────────────────────────────────────────────────┐
// │ READ-ONLY / ADVISORY DRAFT. Returns a SUGGESTED size (a number). It does not place, broadcast,  │
// │ or hold a key, and it cannot enlarge a live position by itself. The separate, gated executor    │
// │ would apply its own caps on top. zero-WIF-on-host holds.                                         │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// WHY: the live bots use a FLAT $2 (MAX_ORDER_USD) per-order cap. That is safe but leaves edge on the
// table on strong signals and over-commits on marginal ones. Kelly sizes a bet in proportion to its
// edge and its odds; FRACTIONAL Kelly (a fraction < 1 of full Kelly) trades a little growth for a lot
// less variance and drawdown — the standard practitioner default is quarter-Kelly.
//
// Kelly fraction of bankroll for a bet that wins fraction `b` (net odds) with probability `p`:
//     f* = (p·b − (1 − p)) / b   =   edge / b        (edge = p·b − (1−p), the §4.7 +EV signal)
// f* ≤ 0  ⇒  no edge  ⇒  size 0. We then multiply by `kellyFraction` (default 0.25) and clamp by:
//   • maxFraction   — never risk more than this fraction of bankroll on one trade (default 0.10)
//   • maxOrderUsd   — the existing hard per-order dollar cap (default 2, matching the live bots)
//   • availableUsd  — never size beyond deployable dry-powder
//   • BUY-FIRST discipline: on a thin/own-token book, only a BUY (accumulation) or a round-trip SELL
//     (a sell that closes inventory bought lower) is allowed to carry size. A naked SELL of a bag
//     never bought cheaper is capped to 0 here — dumping is not a sized strategy. (feedback-
//     selling-is-not-profit-buy-first)
//
//   import { kellyFraction, sizePosition } from './integrations/trade/position-sizing.mjs'

const num = (x) => (Number.isFinite(+x) ? +x : NaN);
const round = (x, n = 6) => (Number.isFinite(x) ? Number(x.toFixed(n)) : null);

/**
 * Full-Kelly fraction of bankroll. { p (win prob 0..1), b (net win odds, >0) }. Returns a fraction in
 * (−∞, 1]; ≤ 0 means no edge (do not bet). Soft-fails to null on bad input (never throws).
 */
export function kellyFraction({ p, b } = {}) {
  const P = num(p), B = num(b);
  if (!(P > 0 && P < 1)) return null;
  if (!(B > 0)) return null;
  const f = (P * B - (1 - P)) / B;   // = edge / b
  return round(f);
}

/**
 * Suggested position size in USD.
 *   { p, b, bankrollUsd, side?, isRoundTrip?, kellyFraction?, maxFraction?, maxOrderUsd?, availableUsd? }
 * Returns { sizeUsd, fraction, kellyRaw, kellyUsed, cappedBy, note } — always an object; on any bad
 * input or no-edge it returns sizeUsd 0 with a reason (soft-fail, never throws).
 *   fraction  = final fraction of bankroll actually risked
 *   kellyRaw  = full-Kelly fraction (may be ≤ 0)
 *   kellyUsed = kellyRaw × kellyFraction, floored at 0
 *   cappedBy  = which limit bound the size ('kelly' | 'maxFraction' | 'maxOrderUsd' | 'availableUsd'
 *               | 'no-edge' | 'buy-first' | 'bad-input')
 */
export function sizePosition({
  p, b, bankrollUsd,
  side = 'buy', isRoundTrip = false,
  kellyFraction: kf = 0.25,
  maxFraction = 0.10,
  maxOrderUsd = 2,
  availableUsd = Infinity,
} = {}) {
  const zero = (cappedBy, note) => ({ sizeUsd: 0, fraction: 0, kellyRaw: null, kellyUsed: 0, cappedBy, note });

  const bank = num(bankrollUsd);
  if (!(bank > 0)) return zero('bad-input', 'bankrollUsd must be > 0');

  // BUY-FIRST discipline: a naked sell (sell that is not a round-trip close) is never sized here.
  if (String(side).toLowerCase() === 'sell' && !isRoundTrip) {
    return zero('buy-first', 'naked sell (no prior buy to close) — dumping is not a sized strategy');
  }

  const kellyRaw = kellyFraction({ p, b });
  if (kellyRaw == null) return zero('bad-input', 'p must be in (0,1) and b > 0');
  if (kellyRaw <= 0) return { sizeUsd: 0, fraction: 0, kellyRaw, kellyUsed: 0, cappedBy: 'no-edge', note: 'Kelly ≤ 0 — no positive edge, do not bet' };

  const frac = Math.max(0, Math.min(1, num(kf) > 0 ? num(kf) : 0.25));
  const kellyUsed = kellyRaw * frac;

  // walk the caps, tracking which one binds
  let fraction = kellyUsed;
  let cappedBy = 'kelly';
  const capFrac = num(maxFraction);
  if (capFrac > 0 && fraction > capFrac) { fraction = capFrac; cappedBy = 'maxFraction'; }

  let sizeUsd = fraction * bank;
  const capUsd = num(maxOrderUsd);
  if (capUsd > 0 && sizeUsd > capUsd) { sizeUsd = capUsd; cappedBy = 'maxOrderUsd'; }
  const avail = num(availableUsd);
  if (Number.isFinite(avail) && sizeUsd > avail) { sizeUsd = Math.max(0, avail); cappedBy = 'availableUsd'; }

  return {
    sizeUsd: round(sizeUsd, 4),
    fraction: round(sizeUsd / bank),
    kellyRaw,
    kellyUsed: round(kellyUsed),
    cappedBy,
    note: `${(frac * 100).toFixed(0)}%-Kelly on edge ${round(kellyRaw * b, 4)}; bound by ${cappedBy}`,
  };
}

if (process.argv[1] && process.argv[1].endsWith('position-sizing.mjs')) {
  console.log('position-sizing DRAFT — quarter-Kelly with caps:');
  const cases = [
    { label: 'strong edge', p: 0.6, b: 1, bankrollUsd: 1000, maxOrderUsd: 50 },
    { label: 'thin edge', p: 0.52, b: 1, bankrollUsd: 1000, maxOrderUsd: 50 },
    { label: 'no edge', p: 0.45, b: 1, bankrollUsd: 1000 },
    { label: 'naked sell blocked', p: 0.7, b: 1, bankrollUsd: 1000, side: 'sell' },
    { label: 'capped by $2', p: 0.6, b: 1, bankrollUsd: 1000 },
  ];
  for (const c of cases) console.log(`  ${c.label.padEnd(22)}`, JSON.stringify(sizePosition(c)));
}
