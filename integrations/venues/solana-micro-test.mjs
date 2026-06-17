// solana-micro-test.mjs — plan tiny ($1) SOL test trades on Solana venues (operator 2026-06-17:
// "more Exchanges on the Bots, where we can do like $1 Tests with SOL"). Solana's sub-cent fees make
// $1 live-fire tests the cheapest way to validate a venue + the execution path end-to-end.
//
// READ-ONLY / ADVISORY: this PLANS the order (size, min-out, slippage, route) and returns an unsigned
// intent. It NEVER signs or broadcasts — live execution stays behind the operator+classifier gate
// (cf. ANGELICALIST_LIVE). Pure math, soft-fail-never-throw, no network, no keys.

const nn = (x) => { const v = +x; return Number.isFinite(v) && v >= 0 ? v : 0; };
const round = (x, d = 9) => { const f = +(+x).toFixed(d); return Number.isFinite(f) ? f : 0; };
const BPS = 10000;

export const DEFAULT_TEST_USD = 1;       // a $1 test
export const DEFAULT_SLIPPAGE_BPS = 100; // 1% — generous for a micro-order

/**
 * planMicroSwap — a single $1-test swap plan on `venue`.
 *   usd          test budget (default $1)
 *   solPriceUsd  live SOL/USD (caller supplies from the venue analytics)
 *   side         'buy' (USDC→SOL) | 'sell' (SOL→USDC), default 'sell' (you hold SOL, sell $1 of it)
 *   slippageBps  max slippage
 * Returns { ok, venue, side, sizeSol, sizeUsd, minOutUsd, slippageBps, intent } or { ok:false }.
 */
export function planMicroSwap({ venue = 'Jupiter', usd = DEFAULT_TEST_USD, solPriceUsd, side = 'sell', slippageBps = DEFAULT_SLIPPAGE_BPS } = {}) {
  const px = nn(solPriceUsd);
  const budget = nn(usd);
  if (px <= 0 || budget <= 0) return { ok: false, reason: 'need solPriceUsd + usd' };
  const slip = Math.min(BPS - 1, Math.max(0, nn(slippageBps)));
  const sizeSol = round(budget / px, 9);                 // $1 worth of SOL
  const minOutUsd = round(budget * (BPS - slip) / BPS, 6); // worst-case proceeds after slippage
  return {
    ok: true,
    venue, side,
    sizeSol,
    sizeUsd: round(budget, 6),
    minOutUsd,
    slippageBps: slip,
    pair: side === 'sell' ? 'SOL/USDC' : 'USDC/SOL',
    intent: {
      type: 'solana-swap', venue, side, inToken: side === 'sell' ? 'SOL' : 'USDC',
      amountSol: side === 'sell' ? sizeSol : undefined, amountUsd: side === 'buy' ? round(budget, 6) : undefined,
      minOutUsd, slippageBps: slip, unsigned: true, note: 'micro-test — operator/gate signs+broadcasts',
    },
  };
}

/** Plan the SAME $1 test across many venues (e.g. SOLANA_VENUES names) — a venue-validation sweep. */
export function planMicroTestSweep(venueNames = [], { usd = DEFAULT_TEST_USD, solPriceUsd, side = 'sell', slippageBps = DEFAULT_SLIPPAGE_BPS } = {}) {
  const list = Array.isArray(venueNames) ? venueNames : [];
  return list
    .map((venue) => planMicroSwap({ venue, usd, solPriceUsd, side, slippageBps }))
    .filter((p) => p.ok);
}
