// amm-quote.test.mjs — offline tests for the constant-product AMM math. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAmountOut, getAmountIn, priceImpactBps, spotPrice,
  addLiquidityQuote, impermanentLossPct, esc,
} from './amm-quote.mjs';

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

test('spotPrice = reserveOut/reserveIn', () => {
  const r = spotPrice(1000, 2000);
  assert.equal(r.ok, true);
  assert.equal(r.price, 2);
});

test('getAmountOut: known Uniswap-V2 vector with 30bps fee', () => {
  // reserveIn=1000, reserveOut=1000, amountIn=10, fee=30bps
  // amountInWithFee = 10*9970 = 99700
  // out = 99700*1000 / (1000*10000 + 99700) = 99700000 / 10099700 = 9.8715...
  const r = getAmountOut({ amountIn: 10, reserveIn: 1000, reserveOut: 1000, feeBps: 30 });
  assert.equal(r.ok, true);
  assert.ok(approx(r.amountOut, 99700000 / 10099700, 1e-9), `got ${r.amountOut}`);
  assert.ok(r.amountOut < 10, 'output strictly less than input on a balanced pool (fee+slippage)');
});

test('getAmountOut: zero fee preserves x*y=k exactly', () => {
  const reserveIn = 1000, reserveOut = 1000, amountIn = 100;
  const r = getAmountOut({ amountIn, reserveIn, reserveOut, feeBps: 0 });
  assert.equal(r.ok, true);
  const kBefore = reserveIn * reserveOut;
  const kAfter = (reserveIn + amountIn) * (reserveOut - r.amountOut);
  assert.ok(approx(kAfter, kBefore, 1e-9), `k drifted: ${kBefore} -> ${kAfter}`);
});

test('getAmountOut: higher fee yields less output', () => {
  const base = { amountIn: 100, reserveIn: 5000, reserveOut: 5000 };
  const lo = getAmountOut({ ...base, feeBps: 5 });
  const hi = getAmountOut({ ...base, feeBps: 100 });
  assert.ok(lo.amountOut > hi.amountOut, 'more fee => less out');
});

test('getAmountIn is the inverse of getAmountOut (round-trip)', () => {
  const pool = { reserveIn: 1_000_000, reserveOut: 2_000_000, feeBps: 30 };
  const fwd = getAmountOut({ amountIn: 1000, ...pool });
  const back = getAmountIn({ amountOut: fwd.amountOut, ...pool });
  assert.equal(back.ok, true);
  assert.ok(approx(back.amountIn, 1000, 1e-6), `round-trip drifted: ${back.amountIn}`);
});

test('getAmountIn rejects draining the pool (amountOut >= reserveOut)', () => {
  const r = getAmountIn({ amountOut: 2000, reserveIn: 1000, reserveOut: 2000 });
  assert.equal(r.ok, false);
  assert.match(r.error, /drain|less than reserveOut/i);
});

test('priceImpactBps positive and grows with size', () => {
  const pool = { reserveIn: 1_000_000, reserveOut: 1_000_000, feeBps: 30 };
  const small = priceImpactBps({ amountIn: 100, ...pool });
  const big = priceImpactBps({ amountIn: 100_000, ...pool });
  assert.equal(small.ok, true);
  assert.ok(small.impactBps > 0);
  assert.ok(big.impactBps > small.impactBps, 'bigger trade => more impact');
  // a tiny trade on a deep pool with 30bps fee is dominated by the fee (~30bps floor)
  assert.ok(small.impactBps >= 30 - 1, `expected ~30bps floor, got ${small.impactBps}`);
});

test('addLiquidityQuote: matched amountB respects pool ratio', () => {
  const r = addLiquidityQuote({ amountA: 100, reserveA: 1000, reserveB: 4000 });
  assert.equal(r.ok, true);
  assert.equal(r.amountB, 400); // ratio 4:1
  // lpShare = 100/1100
  assert.ok(approx(r.lpShareFraction, 100 / 1100, 1e-9));
  // share consistency: amountA/(rA+a) == amountB/(rB+b)
  assert.ok(approx(r.lpShareFraction, r.amountB / (4000 + r.amountB), 1e-9));
});

test('impermanentLossPct: 0 at parity, known values at 2x and 4x', () => {
  const at1 = impermanentLossPct(1);
  assert.equal(at1.ok, true);
  assert.ok(approx(at1.lossPct, 0, 1e-9));

  const at2 = impermanentLossPct(2);
  // 2*sqrt(2)/3 - 1 = -0.0572809...
  assert.ok(approx(at2.lossPct, -5.7191, 1e-3), `got ${at2.lossPct}`);

  const at4 = impermanentLossPct(4);
  // 2*2/5 - 1 = -0.2 => -20%
  assert.ok(approx(at4.lossPct, -20, 1e-6), `got ${at4.lossPct}`);
  assert.ok(approx(at4.lossMagnitudePct, 20, 1e-6));
});

test('impermanentLossPct is symmetric in r and 1/r', () => {
  const a = impermanentLossPct(2);
  const b = impermanentLossPct(0.5);
  assert.ok(approx(a.lossPct, b.lossPct, 1e-9));
});

test('soft-fail: zero / negative / non-numeric reserves are rejected, never throw', () => {
  assert.equal(getAmountOut({ amountIn: 1, reserveIn: 0, reserveOut: 100 }).ok, false);
  assert.equal(getAmountOut({ amountIn: 1, reserveIn: 100, reserveOut: -5 }).ok, false);
  assert.equal(getAmountOut({ amountIn: 1, reserveIn: 'x', reserveOut: 100 }).ok, false);
  assert.equal(spotPrice(0, 100).ok, false);
  assert.equal(priceImpactBps({ amountIn: 1, reserveIn: 0, reserveOut: 1 }).ok, false);
  assert.equal(addLiquidityQuote({ amountA: 0, reserveA: 1, reserveB: 1 }).ok, false);
  assert.equal(impermanentLossPct(0).ok, false);
  assert.equal(impermanentLossPct(-1).ok, false);
});

test('soft-fail: missing args object does not throw', () => {
  assert.equal(getAmountOut().ok, false);
  assert.equal(getAmountIn().ok, false);
  assert.equal(priceImpactBps().ok, false);
  assert.equal(addLiquidityQuote().ok, false);
});

test('getAmountOut: amountIn=0 returns 0 output cleanly', () => {
  const r = getAmountOut({ amountIn: 0, reserveIn: 100, reserveOut: 100 });
  assert.equal(r.ok, true);
  assert.equal(r.amountOut, 0);
});

test('esc escapes HTML', () => {
  assert.equal(esc('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
});
