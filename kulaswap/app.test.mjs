// app.test.mjs — OFFLINE. The PURE swap helpers (slippage/deadline/path/estimate). The wallet +
// contract calls lazy-load ethers in the browser, so importing app.mjs here never hits the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slippageBps, applySlippage, deadlineFrom, buildPath, estimate, esc } from './app.mjs';
import { CHAINS } from './kula-config.mjs';

test('slippageBps converts % → bps, clamps, and defaults bad input to 0.5%', () => {
  assert.equal(slippageBps('0.5'), 50);
  assert.equal(slippageBps('1'), 100);
  assert.equal(slippageBps('100'), 5000, 'clamped to 50% max');
  assert.equal(slippageBps('-3'), 50, 'negative → default');
  assert.equal(slippageBps('abc'), 50, 'NaN → default');
});

test('applySlippage reduces a BigInt amount by the bps (min received)', () => {
  assert.equal(applySlippage(1_000_000n, 50), 995000n, '0.5% off 1e6');
  assert.equal(applySlippage(1_000_000n, 0), 1_000_000n);
  assert.equal(applySlippage(1_000_000n, 10000), 0n, '100% slippage → 0 floor');
});

test('deadlineFrom adds minutes to a unix seconds base', () => {
  assert.equal(deadlineFrom(1_000_000, 20), 1_000_000 + 1200);
  assert.equal(deadlineFrom(1_000_000, 0), 1_000_000 + 60, 'min 1 minute');
});

test('buildPath routes native legs through wnative and dedups identical legs', () => {
  const eth = CHAINS.ethereum;
  const usdc = { symbol: 'USDC', address: '0xUSDC', decimals: 6 };
  const native = { symbol: 'ETH', address: 'native', decimals: 18 };
  assert.deepEqual(buildPath(eth, native, usdc), [eth.wnative, '0xUSDC']);
  assert.deepEqual(buildPath(eth, usdc, native), ['0xUSDC', eth.wnative]);
  assert.deepEqual(buildPath(eth, native, native), [eth.wnative], 'same token → single-element path');
});

test('estimate returns the cp-amm quote shape (amountOut + priceImpact)', () => {
  const q = estimate({ amountIn: 1000, reserveIn: 1_000_000, reserveOut: 1_000_000, feeBps: 30 });
  assert.ok(q.amountOut > 996 && q.amountOut < 997);
  assert.ok(q.priceImpact >= 0);
});

test('esc neutralizes HTML in any token symbol rendered into the option lists', () => {
  assert.equal(esc('<img onerror=x>'), '&lt;img onerror=x&gt;');
});

test('app.mjs imports cleanly in node (ethers is lazy, DOM wiring guarded — no network, no document)', () => {
  assert.equal(typeof slippageBps, 'function');   // if the import had hit esm.sh/ethers, this test file would have failed to load
});
