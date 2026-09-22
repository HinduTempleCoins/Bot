// univ2.test.mjs — OFFLINE proof of the add-liquidity ratio → opening price math. `node --test`,
// ZERO deps, no network. Proves the numbers add-liquidity.mjs prints are the exact UniV2 first-mint
// values the operator will get on-chain.

import { test } from "node:test";
import assert from "node:assert/strict";

import { sqrtBig, openingPrice, firstMintLiquidity, seedBforPrice, addLiquidityPlan, MINIMUM_LIQUIDITY } from "../scripts/lib/univ2.mjs";
import { planAddLiquidity } from "../scripts/add-liquidity.mjs";

const E = (n) => BigInt(n) * 10n ** 18n; // n whole tokens in wei

test("integer sqrt matches known squares", () => {
  assert.equal(sqrtBig(0n), 0n);
  assert.equal(sqrtBig(1n), 1n);
  assert.equal(sqrtBig(4n), 2n);
  assert.equal(sqrtBig(9n), 3n);
  assert.equal(sqrtBig(1000000n), 1000n);
  // floor for non-perfect squares
  assert.equal(sqrtBig(8n), 2n);
  assert.equal(sqrtBig(E(1) * E(1)), E(1)); // sqrt(1e36) == 1e18
});

test("opening price = seed ratio (quote per token)", () => {
  // Seed 1,000,000 NEW + 5,000 wPRANA → price 0.005 wPRANA per NEW.
  const p = openingPrice(E(1_000_000), E(5_000));
  assert.equal(p.priceBperA, 0.005);
  assert.equal(p.priceAperB, 200); // 200 NEW per wPRANA
});

test("first-mint LP = sqrt(a*b) - MINIMUM_LIQUIDITY (UniswapV2Pair.mint)", () => {
  // Equal 1000/1000 seed: sqrt(1000e18 * 1000e18) = 1000e18; minus 1000 locked.
  const liq = firstMintLiquidity(E(1000), E(1000));
  assert.equal(liq, E(1000) - MINIMUM_LIQUIDITY);
});

test("seedBforPrice computes the quote side for a target price", () => {
  // price 0.005 = 5/1000 wPRANA per NEW, for 1,000,000 NEW → 5,000 wPRANA.
  const b = seedBforPrice(E(1_000_000), 5n, 1000n);
  assert.equal(b, E(5_000));
});

test("addLiquidityPlan bundles price + LP + locked minimum", () => {
  const plan = addLiquidityPlan({ amountToken: E(1_000_000), amountQuote: E(5_000) });
  assert.equal(plan.openingPrice.priceBperA, 0.005);
  assert.equal(plan.lockedForever, 1000n);
  assert.ok(plan.lpTokens > 0n);
  // LP = sqrt(1e6 e18 * 5e3 e18) - 1000
  const expected = sqrtBig(E(1_000_000) * E(5_000)) - MINIMUM_LIQUIDITY;
  assert.equal(plan.lpTokens, expected);
});

test("tiny seed (<= MINIMUM_LIQUIDITY) is rejected, not silently zero", () => {
  assert.throws(() => firstMintLiquidity(10n, 10n), /liquidity <= MINIMUM_LIQUIDITY/);
});

test("planAddLiquidity produces router call params with the correct opening price", () => {
  const res = planAddLiquidity({
    chainKey: "base",
    tokenAddr: "0x000000000000000000000000000000000000dEaD",
    quoteAddr: "0x000000000000000000000000000000000000bEEF",
    amountToken: "1000000",
    amountQuote: "5000",
    decimals: 18,
    to: "0x00000000000000000000000000000000000000A1",
  });
  assert.equal(res.call.method, "addLiquidity");
  assert.equal(res.call.args.amountADesired, E(1_000_000).toString());
  assert.equal(res.call.args.amountBDesired, E(5_000).toString());
  // fresh pair: min == desired
  assert.equal(res.call.args.amountAMin, res.call.args.amountADesired);
  assert.equal(res.plan.openingPrice_quotePerToken, 0.005);
  // router is a zero placeholder until deploy → not live
  assert.equal(res.routerLive, false);
});
