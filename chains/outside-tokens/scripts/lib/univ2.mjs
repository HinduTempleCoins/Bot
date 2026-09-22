// univ2.mjs — UniswapV2 opening-price + first-mint liquidity math, ZERO dependencies.
//
// Mirrors the exact on-chain arithmetic of a UniV2/PancakeSwap/QuickSwap pair's FIRST mint, so the
// add-liquidity script can compute the opening price and LP tokens the operator will receive BEFORE
// any broadcast — and the offline test can prove those numbers.
//
//   opening price (tokenB per tokenA) = reserveB / reserveA          (the ratio we seed IS the price)
//   first-mint LP  = sqrt(amountA * amountB) - MINIMUM_LIQUIDITY      (UniswapV2Pair.mint, first mint)
//   MINIMUM_LIQUIDITY = 1000 (permanently locked to address(0) on the first mint)
//
// All amounts are BigInt wei (18-dec by convention). PURE: no chain, no network, no keys.

export const MINIMUM_LIQUIDITY = 1000n;

/** Integer sqrt (Babylonian), matching UniswapV2's Math.sqrt on BigInt. */
export function sqrtBig(y) {
  if (y < 0n) throw new Error("sqrt of negative");
  if (y < 4n) return y === 0n ? 0n : 1n;
  let z = y;
  let x = y / 2n + 1n;
  while (x < z) {
    z = x;
    x = (y / x + x) / 2n;
  }
  return z;
}

/**
 * Opening price implied by a seed ratio. Returned as a Number (display only) plus the exact
 * reserves so callers can also keep the integer truth.
 * @param {bigint} amountA  seed amount of token A (wei)
 * @param {bigint} amountB  seed amount of token B (wei)
 * @returns {{ priceBperA:number, priceAperB:number, reserveA:bigint, reserveB:bigint }}
 */
export function openingPrice(amountA, amountB) {
  if (amountA <= 0n || amountB <= 0n) throw new Error("seed amounts must be > 0");
  // Use a scaled ratio to keep display precision without floating BigInt.
  const SCALE = 10n ** 18n;
  const priceBperA = Number((amountB * SCALE) / amountA) / 1e18;
  const priceAperB = Number((amountA * SCALE) / amountB) / 1e18;
  return { priceBperA, priceAperB, reserveA: amountA, reserveB: amountB };
}

/** LP tokens minted to the seeder on the FIRST mint (UniswapV2Pair.mint, totalSupply == 0 branch). */
export function firstMintLiquidity(amountA, amountB) {
  const liq = sqrtBig(amountA * amountB) - MINIMUM_LIQUIDITY;
  if (liq <= 0n) throw new Error("seed too small: liquidity <= MINIMUM_LIQUIDITY");
  return liq;
}

/**
 * Given a desired opening price and one side's seed amount, compute the other side.
 * priceBperA = amountB / amountA  ⇒  amountB = amountA * priceBperA.
 * Price is passed as a rational (num/den) to stay exact in integer math.
 * @returns {bigint} amountB (wei)
 */
export function seedBforPrice(amountA, priceNum, priceDen) {
  if (priceDen <= 0n) throw new Error("price denominator must be > 0");
  return (amountA * priceNum) / priceDen;
}

/**
 * Full add-liquidity plan for a NEW/wPRANA (or wVKBT/wPRANA) opening pool.
 * @param {object} p
 * @param {bigint} p.amountToken   seed amount of the NEW token (wei)
 * @param {bigint} p.amountQuote   seed amount of wPRANA (wei)
 * @returns {{ openingPrice:object, lpTokens:bigint, lockedForever:bigint }}
 */
export function addLiquidityPlan({ amountToken, amountQuote }) {
  const price = openingPrice(amountToken, amountQuote);
  const lpTokens = firstMintLiquidity(amountToken, amountQuote);
  return { openingPrice: price, lpTokens, lockedForever: MINIMUM_LIQUIDITY };
}
