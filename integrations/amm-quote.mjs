// amm-quote.mjs — constant-product AMM quote / liquidity-pool math (queue #360/#362/#367/#414:
// 'AMM/DEX', 'Liquidity pools', 'Uniswap V3 integration'). PURE, read-only math. NEVER broadcasts,
// no network, no secrets. Models the x*y=k constant-product invariant used by Uniswap-V2 / QuickSwap
// (and the V2-compatible quote path of V3 full-range positions).
//
// Everything here is deterministic and soft-fails: bad input returns {ok:false,error} — never throws.
// This is decision-support only; the Witness never signs or sends a swap. Real on-chain routing carries
// extra cost (gas, multi-hop, MEV) this estimator does not model.
//
//   import { getAmountOut, getAmountIn, priceImpactBps, spotPrice,
//            addLiquidityQuote, impermanentLossPct } from './amm-quote.mjs'
//   node integrations/amm-quote.mjs
//
// Fee convention: feeBps is the swap fee in basis points (1 bp = 0.01%). Uniswap-V2 / QuickSwap = 30 bps.
// Uniswap-V3 common tiers: 5, 30, 100 bps (1, 5, 30, 100 → 0.01%, 0.05%, 0.30%, 1.00%).

// --- HTML escape (strict; used by any render path) -------------------------

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- numeric guards --------------------------------------------------------

function finite(x) {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

// positive, finite, non-zero
function pos(x) {
  const n = finite(x);
  return n != null && n > 0 ? n : null;
}

// non-negative, finite (amounts may be 0)
function nonneg(x) {
  const n = finite(x);
  return n != null && n >= 0 ? n : null;
}

function bps(x, fallback) {
  const n = finite(x);
  if (n == null) return fallback;
  // clamp to a sane swap-fee range [0, 10000) bps
  if (n < 0) return 0;
  if (n >= 10000) return 9999;
  return n;
}

// --- spot price ------------------------------------------------------------
// Price of tokenIn in units of tokenOut, ignoring fee/slippage: reserveOut / reserveIn.

export function spotPrice(reserveIn, reserveOut) {
  const ri = pos(reserveIn);
  const ro = pos(reserveOut);
  if (ri == null || ro == null) return { ok: false, error: 'reserves must be positive numbers' };
  return { ok: true, price: ro / ri };
}

// --- getAmountOut ----------------------------------------------------------
// Constant-product output for a given input, with fee. Uniswap-V2 closed form:
//   amountInWithFee = amountIn * (1 - fee)
//   amountOut = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee)
// k = reserveIn * reserveOut is preserved (post-fee) by construction.

export function getAmountOut({ amountIn, reserveIn, reserveOut, feeBps = 30 } = {}) {
  const ai = nonneg(amountIn);
  const ri = pos(reserveIn);
  const ro = pos(reserveOut);
  if (ai == null) return { ok: false, error: 'amountIn must be a non-negative number' };
  if (ri == null || ro == null) return { ok: false, error: 'reserves must be positive numbers' };
  const fee = bps(feeBps, 30);
  if (ai === 0) return { ok: true, amountOut: 0, feeBps: fee, effectivePrice: 0 };

  const feeNum = 10000 - fee;
  const amountInWithFee = ai * feeNum;
  const numerator = amountInWithFee * ro;
  const denominator = ri * 10000 + amountInWithFee;
  const amountOut = numerator / denominator;
  return {
    ok: true,
    amountOut,
    feeBps: fee,
    feePaid: ai * (fee / 10000),
    effectivePrice: amountOut / ai, // tokenOut received per tokenIn spent
  };
}

// --- getAmountIn -----------------------------------------------------------
// Inverse: input required to receive a desired output, with fee. Uniswap-V2 closed form:
//   amountIn = ceil( (reserveIn * amountOut * 10000) / ((reserveOut - amountOut) * (10000 - fee)) )
// (we return the exact real value, not the integer ceil — this is a quote, not on-chain wei).
// amountOut must be strictly less than reserveOut (you cannot drain the pool).

export function getAmountIn({ amountOut, reserveIn, reserveOut, feeBps = 30 } = {}) {
  const ao = nonneg(amountOut);
  const ri = pos(reserveIn);
  const ro = pos(reserveOut);
  if (ao == null) return { ok: false, error: 'amountOut must be a non-negative number' };
  if (ri == null || ro == null) return { ok: false, error: 'reserves must be positive numbers' };
  if (ao >= ro) return { ok: false, error: 'amountOut must be less than reserveOut (cannot drain pool)' };
  const fee = bps(feeBps, 30);
  if (ao === 0) return { ok: true, amountIn: 0, feeBps: fee };

  const numerator = ri * ao * 10000;
  const denominator = (ro - ao) * (10000 - fee);
  const amountIn = numerator / denominator;
  return {
    ok: true,
    amountIn,
    feeBps: fee,
    feePaid: amountIn * (fee / 10000),
    effectivePrice: ao / amountIn,
  };
}

// --- priceImpactBps --------------------------------------------------------
// How far the execution price moves the marginal price away from the pre-trade spot, in basis points.
// We use the standard "execution vs spot" definition:
//   spot = reserveOut / reserveIn   (out per in, no fee)
//   exec = amountOut / amountIn     (out per in, realized incl. fee)
//   impactBps = (1 - exec/spot) * 10000
// Note this folds the fee into the reported impact (the realized price a trader actually feels).

export function priceImpactBps({ amountIn, reserveIn, reserveOut, feeBps = 30 } = {}) {
  const ai = pos(amountIn);
  const ri = pos(reserveIn);
  const ro = pos(reserveOut);
  if (ai == null) return { ok: false, error: 'amountIn must be a positive number' };
  if (ri == null || ro == null) return { ok: false, error: 'reserves must be positive numbers' };
  const fee = bps(feeBps, 30);

  const out = getAmountOut({ amountIn: ai, reserveIn: ri, reserveOut: ro, feeBps: fee });
  if (!out.ok) return out;
  const spot = ro / ri;
  const exec = out.amountOut / ai;
  const impactBps = (1 - exec / spot) * 10000;
  return {
    ok: true,
    impactBps,
    impactPct: impactBps / 100,
    spotPrice: spot,
    execPrice: exec,
    amountOut: out.amountOut,
    feeBps: fee,
  };
}

// --- addLiquidityQuote -----------------------------------------------------
// Given an amount of token A you want to deposit and the current pool reserves, the matched amount of
// token B is set by the pool ratio (you must add at the current price): amountB = amountA * reserveB/reserveA.
// LP-share estimate: the fraction of the pool the new liquidity represents AFTER the deposit, using the
// constant-product proportionality lpShare = amountA / (reserveA + amountA) (== amountB/(reserveB+amountB)).

export function addLiquidityQuote({ amountA, reserveA, reserveB } = {}) {
  const a = pos(amountA);
  const ra = pos(reserveA);
  const rb = pos(reserveB);
  if (a == null) return { ok: false, error: 'amountA must be a positive number' };
  if (ra == null || rb == null) return { ok: false, error: 'reserves must be positive numbers' };

  const amountB = a * (rb / ra);
  const lpShare = a / (ra + a); // fraction of pool owned post-deposit
  return {
    ok: true,
    amountB,
    lpShareFraction: lpShare,
    lpSharePct: lpShare * 100,
    poolRatio: rb / ra, // tokenB per tokenA
  };
}

// --- impermanentLossPct ----------------------------------------------------
// Impermanent loss vs simply holding, as a function of the price ratio (newPrice / oldPrice) of the two
// assets. Closed form for a 50/50 constant-product pool:
//   IL = 2*sqrt(r)/(1+r) - 1     (a non-positive number; we return it as a percentage)
// At r=1 → 0%. At r=2 → ~ -5.72%. At r=4 → ~ -20.0%. At r=0.5 → same as r=2 (symmetric in r,1/r).

export function impermanentLossPct(priceRatio) {
  const r = pos(priceRatio);
  if (r == null) return { ok: false, error: 'priceRatio must be a positive number' };
  const il = (2 * Math.sqrt(r)) / (1 + r) - 1; // <= 0
  return {
    ok: true,
    priceRatio: r,
    lossPct: il * 100, // negative number, e.g. -5.72
    lossMagnitudePct: Math.abs(il) * 100, // positive convenience value
  };
}

// --- CLI worked example (guarded) ------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('amm-quote.mjs')) {
  const line = '─'.repeat(60);
  console.log('amm-quote — constant-product (x*y=k) AMM math (no network, read-only)');
  console.log(line);
  const reserveIn = 1_000_000, reserveOut = 2_000_000, amountIn = 1_000;
  console.log(`pool: reserveIn=${reserveIn} reserveOut=${reserveOut}  fee=30bps`);
  console.log('spotPrice       ', JSON.stringify(spotPrice(reserveIn, reserveOut)));
  const out = getAmountOut({ amountIn, reserveIn, reserveOut });
  console.log(`getAmountOut(${amountIn})`, JSON.stringify(out));
  console.log('getAmountIn(back)', JSON.stringify(getAmountIn({ amountOut: out.amountOut, reserveIn, reserveOut })));
  console.log('priceImpactBps  ', JSON.stringify(priceImpactBps({ amountIn, reserveIn, reserveOut })));
  console.log('addLiquidity    ', JSON.stringify(addLiquidityQuote({ amountA: 10_000, reserveA: reserveIn, reserveB: reserveOut })));
  console.log('IL @ 2x         ', JSON.stringify(impermanentLossPct(2)));
  console.log('IL @ 4x         ', JSON.stringify(impermanentLossPct(4)));
  console.log(line);
  console.log('Decision-support only. The Witness never signs or broadcasts a swap.');
}
