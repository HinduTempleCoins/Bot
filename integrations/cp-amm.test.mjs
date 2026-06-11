// cp-amm.test.mjs — offline tests for the constant-product AMM math. node:test, no network, no keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAmountOut,
  getAmountIn,
  spotPrice,
  priceImpact,
  addLiquidityQuote,
  quoteSwap,
} from './cp-amm.mjs';

// ── getAmountOut: happy path matches the Uniswap-v2 formula ───────────────────
test('getAmountOut matches the Uniswap-v2 constant-product formula', () => {
  // reserveIn=1000, reserveOut=1000, amountIn=10, fee=30bps
  // amountInWithFee = 10 * 9970 = 99700
  // out = 1000 * 99700 / (1000*10000 + 99700) = 99700000 / 10099700 ≈ 9.871...
  const r = getAmountOut({ amountIn: 10, reserveIn: 1000, reserveOut: 1000, feeBps: 30 });
  assert.equal(r.feeBps, 30);
  assert.ok(Math.abs(r.amountOut - 9.87158034) < 1e-6, `got ${r.amountOut}`);
  assert.ok(r.amountOut < 10, 'fee + slippage means out < in for a balanced pool');
  assert.ok(Math.abs(r.effectivePrice - r.amountOut / 10) < 1e-6);
});

test('getAmountOut with zero fee gives a larger output than with fee', () => {
  const noFee = getAmountOut({ amountIn: 10, reserveIn: 1000, reserveOut: 1000, feeBps: 0 });
  const withFee = getAmountOut({ amountIn: 10, reserveIn: 1000, reserveOut: 1000, feeBps: 30 });
  assert.ok(noFee.amountOut > withFee.amountOut);
});

test('getAmountOut default fee is 30 bps', () => {
  const a = getAmountOut({ amountIn: 10, reserveIn: 1000, reserveOut: 1000 });
  const b = getAmountOut({ amountIn: 10, reserveIn: 1000, reserveOut: 1000, feeBps: 30 });
  assert.equal(a.feeBps, 30);
  assert.equal(a.amountOut, b.amountOut);
});

// ── getAmountOut: soft-fail edges ─────────────────────────────────────────────
test('getAmountOut soft-fails on zero/empty reserves and bad input', () => {
  assert.deepEqual(getAmountOut({ amountIn: 10, reserveIn: 0, reserveOut: 1000 }).amountOut, 0);
  assert.deepEqual(getAmountOut({ amountIn: 10, reserveIn: 1000, reserveOut: 0 }).amountOut, 0);
  assert.deepEqual(getAmountOut({ amountIn: 0, reserveIn: 1000, reserveOut: 1000 }).amountOut, 0);
  assert.deepEqual(getAmountOut({ amountIn: -5, reserveIn: 1000, reserveOut: 1000 }).amountOut, 0);
  assert.deepEqual(getAmountOut({ amountIn: NaN, reserveIn: 1000, reserveOut: 1000 }).amountOut, 0);
  assert.deepEqual(getAmountOut({}).amountOut, 0);
  assert.doesNotThrow(() => getAmountOut());
  assert.deepEqual(getAmountOut().amountOut, 0);
});

test('getAmountOut clamps a runaway fee to below 100% (never zero-divides)', () => {
  const r = getAmountOut({ amountIn: 10, reserveIn: 1000, reserveOut: 1000, feeBps: 999999 });
  assert.ok(r.feeBps <= 9999);
  assert.ok(Number.isFinite(r.amountOut));
  assert.ok(r.amountOut >= 0);
});

// ── getAmountIn: inverse of getAmountOut ──────────────────────────────────────
test('getAmountIn is the approximate inverse of getAmountOut', () => {
  const reserveIn = 1_000_000, reserveOut = 500_000;
  const { amountOut } = getAmountOut({ amountIn: 1000, reserveIn, reserveOut });
  const { amountIn } = getAmountIn({ amountOut, reserveIn, reserveOut });
  // round-trip should land back near 1000 (the +1 round-up biases slightly upward)
  assert.ok(Math.abs(amountIn - 1000) < 2, `round-trip got ${amountIn}`);
});

test('getAmountIn soft-fails when output cannot be satisfied or reserves empty', () => {
  // can't pull more OUT than the pool holds
  assert.equal(getAmountIn({ amountOut: 1000, reserveIn: 1000, reserveOut: 1000 }).amountIn, 0);
  assert.equal(getAmountIn({ amountOut: 5000, reserveIn: 1000, reserveOut: 1000 }).amountIn, 0);
  assert.equal(getAmountIn({ amountOut: 10, reserveIn: 0, reserveOut: 1000 }).amountIn, 0);
  assert.equal(getAmountIn({ amountOut: 0, reserveIn: 1000, reserveOut: 1000 }).amountIn, 0);
  assert.equal(getAmountIn({ amountOut: -5, reserveIn: 1000, reserveOut: 1000 }).amountIn, 0);
  assert.doesNotThrow(() => getAmountIn());
  assert.equal(getAmountIn().amountIn, 0);
});

// ── spotPrice ─────────────────────────────────────────────────────────────────
test('spotPrice is reserveOut/reserveIn', () => {
  assert.equal(spotPrice({ reserveIn: 1000, reserveOut: 2000 }), 2);
  assert.equal(spotPrice({ reserveIn: 4000, reserveOut: 1000 }), 0.25);
});

test('spotPrice soft-fails on empty reserveIn', () => {
  assert.equal(spotPrice({ reserveIn: 0, reserveOut: 1000 }), 0);
  assert.equal(spotPrice({ reserveIn: -5, reserveOut: 1000 }), 0);
  assert.equal(spotPrice({}), 0);
  assert.doesNotThrow(() => spotPrice());
  assert.equal(spotPrice(), 0);
});

// ── priceImpact ───────────────────────────────────────────────────────────────
test('priceImpact is a fraction in [0,1], larger for larger trades', () => {
  const small = priceImpact({ amountIn: 100, reserveIn: 1_000_000, reserveOut: 1_000_000 });
  const big = priceImpact({ amountIn: 100_000, reserveIn: 1_000_000, reserveOut: 1_000_000 });
  assert.ok(small >= 0 && small <= 1);
  assert.ok(big >= 0 && big <= 1);
  assert.ok(big > small, 'bigger trade should move price more');
});

test('priceImpact soft-fails on empty reserves / zero input', () => {
  assert.equal(priceImpact({ amountIn: 100, reserveIn: 0, reserveOut: 1000 }), 0);
  assert.equal(priceImpact({ amountIn: 0, reserveIn: 1000, reserveOut: 1000 }), 0);
  assert.equal(priceImpact({}), 0);
  assert.doesNotThrow(() => priceImpact());
  assert.equal(priceImpact(), 0);
});

// ── addLiquidityQuote ─────────────────────────────────────────────────────────
test('addLiquidityQuote keeps the pool ratio and computes lpShare', () => {
  // ratio 1000:2000 → depositing 100 A needs 200 B
  const r = addLiquidityQuote({ amountA: 100, reserveA: 1000, reserveB: 2000 });
  assert.equal(r.amountB, 200);
  // lpShare = 100 / (1000+100) ≈ 0.0909...
  assert.ok(Math.abs(r.lpShare - 100 / 1100) < 1e-6);
});

test('addLiquidityQuote bootstraps an empty pool (any ratio, owns 100%)', () => {
  const r = addLiquidityQuote({ amountA: 500, reserveA: 0, reserveB: 0 });
  assert.equal(r.lpShare, 1);
  // empty pool with a zero deposit → not an owner
  const z = addLiquidityQuote({ amountA: 0, reserveA: 0, reserveB: 0 });
  assert.equal(z.lpShare, 0);
});

test('addLiquidityQuote soft-fails on garbage', () => {
  const r = addLiquidityQuote({ amountA: -5, reserveA: 1000, reserveB: 2000 });
  assert.equal(r.amountB, 0);   // negative amountA clamps to 0
  assert.equal(r.lpShare, 0);
  assert.doesNotThrow(() => addLiquidityQuote());
  assert.equal(addLiquidityQuote().lpShare, 0);
});

// ── quoteSwap convenience wrapper ─────────────────────────────────────────────
test('quoteSwap bundles the full quote consistently with the parts', () => {
  const args = { amountIn: 1000, reserveIn: 1_000_000, reserveOut: 500_000 };
  const q = quoteSwap(args);
  assert.equal(q.amountIn, 1000);
  assert.equal(q.amountOut, getAmountOut(args).amountOut);
  assert.equal(q.spotPrice, spotPrice(args));
  assert.equal(q.effectivePrice, getAmountOut(args).effectivePrice);
  assert.equal(q.priceImpact, priceImpact(args));
  assert.equal(q.feeBps, 30);
});

test('quoteSwap soft-fails and never throws', () => {
  assert.doesNotThrow(() => quoteSwap());
  const q = quoteSwap();
  assert.equal(q.amountOut, 0);
  assert.equal(q.spotPrice, 0);
  assert.equal(q.priceImpact, 0);
});
