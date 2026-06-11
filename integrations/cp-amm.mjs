// cp-amm.mjs — constant-product (x*y=k) AMM math for KulaSwap (queue item "Constant-product AMM math
// — KulaSwap swap quotes, liquidity, price impact"). KulaSwap is the planned PancakeSwap-fork DEX on
// the itinerary; this module is the pure pricing kernel underneath it.
//
// PURE arithmetic, NO network, NO chain, NO keys. Every reserve and input is passed IN — the live
// pool reads (reserves, fee tier) happen elsewhere and hand their numbers to these functions.
//
// Uses the Uniswap-v2 / PancakeSwap constant-product formula with a basis-point fee:
//   amountInWithFee = amountIn * (10000 - feeBps)
//   amountOut       = reserveOut * amountInWithFee / (reserveIn * 10000 + amountInWithFee)
// Default feeBps = 30 (0.30%), the canonical Uniswap-v2 tier.
//
// Distinct from staking-apr.mjs (reward-pool APR) and knowledge/defi-timeline.mjs (narrative history):
// this is the swap/liquidity/price-impact math of an AMM curve, nothing else.
//
//   node integrations/cp-amm.mjs        # tiny worked example
//
// Exports: getAmountOut(), getAmountIn(), spotPrice(), priceImpact(), addLiquidityQuote(), quoteSwap().

const BPS = 10000;
const DEFAULT_FEE_BPS = 30;   // 0.30% — canonical Uniswap-v2 / PancakeSwap-v2 swap fee

const num = (x, d = 0) => (Number.isFinite(+x) ? +x : d);
// clamp a value to a finite, non-negative number (soft-fail: garbage/negative → 0)
const nn = (x) => Math.max(0, num(x));
// fees are bounded to [0, 9999] bps — a 100% fee would zero every swap, so cap just under
const feeOf = (x) => Math.min(BPS - 1, Math.max(0, num(x, DEFAULT_FEE_BPS)));
const round = (x) => +(+x).toFixed(8);

// ── core: exact output for a given input ──────────────────────────────────────
// getAmountOut({ amountIn, reserveIn, reserveOut, feeBps=30 }) →
//   { amountOut, feeBps, effectivePrice }
//
//   amountOut      : tokens of the OUT asset received for amountIn of the IN asset
//   feeBps         : the fee applied (echoed back, clamped)
//   effectivePrice : amountOut / amountIn  (out-per-in actually realised; 0 if no input)
//
// Soft-fail: any non-positive input or empty/zero reserve yields amountOut:0 (never divides by zero,
// never throws). Negative/garbage values clamp to 0.
export function getAmountOut({ amountIn, reserveIn, reserveOut, feeBps = DEFAULT_FEE_BPS } = {}) {
  const aIn = nn(amountIn);
  const rIn = nn(reserveIn);
  const rOut = nn(reserveOut);
  const fee = feeOf(feeBps);

  if (aIn <= 0 || rIn <= 0 || rOut <= 0) {
    return { amountOut: 0, feeBps: fee, effectivePrice: 0 };
  }

  const amountInWithFee = aIn * (BPS - fee);
  const numerator = rOut * amountInWithFee;
  const denominator = rIn * BPS + amountInWithFee;   // denominator > 0 here, no divide-by-zero
  const amountOut = round(numerator / denominator);
  const effectivePrice = round(amountOut / aIn);

  return { amountOut, feeBps: fee, effectivePrice };
}

// ── inverse: input required for a desired output ──────────────────────────────
// getAmountIn({ amountOut, reserveIn, reserveOut, feeBps=30 }) →
//   { amountIn, feeBps, effectivePrice }
//
//   amountIn       : tokens of the IN asset needed to receive amountOut of the OUT asset
//   effectivePrice : amountOut / amountIn (out-per-in; 0 if no input)
//
// Uniswap-v2 inverse:
//   amountIn = (reserveIn * amountOut * 10000) / ((reserveOut - amountOut) * (10000 - feeBps)) + 1
// The +1 is the integer round-up guard in Solidity; here values are floats so we keep it as a tiny
// upward bias matching on-chain behaviour. Soft-fail: if amountOut >= reserveOut (can't drain the
// pool) or any reserve is empty, returns amountIn:0 (never divides by zero, never throws).
export function getAmountIn({ amountOut, reserveIn, reserveOut, feeBps = DEFAULT_FEE_BPS } = {}) {
  const aOut = nn(amountOut);
  const rIn = nn(reserveIn);
  const rOut = nn(reserveOut);
  const fee = feeOf(feeBps);

  if (aOut <= 0 || rIn <= 0 || rOut <= 0 || aOut >= rOut) {
    return { amountIn: 0, feeBps: fee, effectivePrice: 0 };
  }

  const numerator = rIn * aOut * BPS;
  const denominator = (rOut - aOut) * (BPS - fee);   // denominator > 0 here (aOut < rOut, fee < BPS)
  const amountIn = round(numerator / denominator + 1);
  const effectivePrice = amountIn > 0 ? round(aOut / amountIn) : 0;

  return { amountIn, feeBps: fee, effectivePrice };
}

// ── spot price (marginal, fee-free) ───────────────────────────────────────────
// spotPrice({ reserveIn, reserveOut }) → reserveOut / reserveIn
// The instantaneous out-per-in price at the current reserves, ignoring fees and slippage.
// reserveIn<=0 (or missing) → 0 (soft-fail, no divide-by-zero, never throws).
export function spotPrice({ reserveIn, reserveOut } = {}) {
  const rIn = nn(reserveIn);
  const rOut = nn(reserveOut);
  if (rIn <= 0) return 0;
  return round(rOut / rIn);
}

// ── price impact of a swap ────────────────────────────────────────────────────
// priceImpact({ amountIn, reserveIn, reserveOut, feeBps=30 }) → fraction
// How far the effective (realised) price moves below the spot price because of the trade:
//   impact = (spot - effective) / spot     (e.g. 0.01 = 1% worse than spot)
// Includes the fee, since effectivePrice is the after-fee realised rate. Clamped to [0,1].
// Empty reserves / zero input → 0 (soft-fail, never throws).
export function priceImpact({ amountIn, reserveIn, reserveOut, feeBps = DEFAULT_FEE_BPS } = {}) {
  const spot = spotPrice({ reserveIn, reserveOut });
  if (spot <= 0) return 0;
  const { effectivePrice } = getAmountOut({ amountIn, reserveIn, reserveOut, feeBps });
  if (effectivePrice <= 0) return 0;
  const impact = (spot - effectivePrice) / spot;
  return round(Math.min(1, Math.max(0, impact)));
}

// ── add-liquidity quote ───────────────────────────────────────────────────────
// addLiquidityQuote({ amountA, reserveA, reserveB }) →
//   { amountB, lpShare }
//
//   amountB : the matching amount of token B required to deposit alongside amountA while keeping the
//             pool ratio unchanged ( amountB = amountA * reserveB / reserveA ).
//   lpShare : the depositor's resulting share of the pool, as a fraction in [0,1]
//             ( amountA / (reserveA + amountA) — A and B contribute the same proportion at ratio ).
//
// Bootstrap: if reserveA<=0 (empty/new pool) the depositor sets the initial price, so ANY amountB is
// allowed — we echo back the caller's amountB (default 0) and lpShare:1 (they own 100% of the new pool).
// Soft-fail: garbage/negative inputs clamp to 0; zero deposit → lpShare 0; never divides by zero.
export function addLiquidityQuote({ amountA, reserveA, reserveB } = {}) {
  const aA = nn(amountA);
  const rA = nn(reserveA);
  const rB = nn(reserveB);

  // Bootstrap an empty pool: any ratio allowed, depositor sets the price and owns all of it.
  // We can't derive a required amountB (no ratio yet), so we echo the caller's reserveB figure.
  if (rA <= 0) {
    return { amountB: round(rB), lpShare: aA > 0 ? 1 : 0 };
  }

  const amountB = round(aA * rB / rA);
  const lpShare = aA > 0 ? round(aA / (rA + aA)) : 0;
  return { amountB, lpShare };
}

// ── convenience wrapper ───────────────────────────────────────────────────────
// quoteSwap({ amountIn, reserveIn, reserveOut, feeBps=30 }) →
//   { amountIn, amountOut, feeBps, spotPrice, effectivePrice, priceImpact }
// One call that bundles the full swap quote a UI would show. Pure composition of the above;
// inherits all their soft-fail behaviour.
export function quoteSwap({ amountIn, reserveIn, reserveOut, feeBps = DEFAULT_FEE_BPS } = {}) {
  const { amountOut, feeBps: fee, effectivePrice } = getAmountOut({ amountIn, reserveIn, reserveOut, feeBps });
  return {
    amountIn: nn(amountIn),
    amountOut,
    feeBps: fee,
    spotPrice: spotPrice({ reserveIn, reserveOut }),
    effectivePrice,
    priceImpact: priceImpact({ amountIn, reserveIn, reserveOut, feeBps }),
  };
}

// ───────────────────────────── CLI ─────────────────────────────

if (process.argv[1] && process.argv[1].endsWith('cp-amm.mjs')) {
  console.log('Constant-product AMM math — KulaSwap (PURE — no network, no chain, no keys)');
  console.log('='.repeat(74));

  // Pool: 1,000,000 TOKEN_IN  /  500,000 TOKEN_OUT, 0.30% fee. Swap 1,000 in.
  const reserveIn = 1_000_000, reserveOut = 500_000, amountIn = 1_000;
  const q = quoteSwap({ amountIn, reserveIn, reserveOut });
  console.log(`\npool: reserveIn=${reserveIn.toLocaleString()}  reserveOut=${reserveOut.toLocaleString()}  fee=${q.feeBps}bps`);
  console.log(`swap: amountIn=${amountIn.toLocaleString()}`);
  console.log(`  spotPrice      = ${q.spotPrice} out/in`);
  console.log(`  amountOut      = ${q.amountOut}`);
  console.log(`  effectivePrice = ${q.effectivePrice} out/in (after fee + slippage)`);
  console.log(`  priceImpact    = ${(q.priceImpact * 100).toFixed(4)}%`);

  // Inverse: how much IN to get exactly 400 OUT?
  const inv = getAmountIn({ amountOut: 400, reserveIn, reserveOut });
  console.log(`\ninverse: to receive amountOut=400 you must supply amountIn=${inv.amountIn}`);

  // Add liquidity: deposit 1,000 of A into the pool.
  const lq = addLiquidityQuote({ amountA: 1_000, reserveA: reserveIn, reserveB: reserveOut });
  console.log(`\nadd-liquidity: amountA=1,000 → required amountB=${lq.amountB}, lpShare=${(lq.lpShare * 100).toFixed(4)}%`);
}
