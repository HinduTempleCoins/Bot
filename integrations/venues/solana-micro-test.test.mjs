// solana-micro-test.test.mjs — offline, pure. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMicroSwap, planMicroTestSweep, DEFAULT_TEST_USD } from './solana-micro-test.mjs';

test('planMicroSwap: $1 at SOL=$200 → 0.005 SOL, 1% min-out, unsigned intent', () => {
  const p = planMicroSwap({ venue: 'Jupiter', usd: 1, solPriceUsd: 200, side: 'sell', slippageBps: 100 });
  assert.equal(p.ok, true);
  assert.equal(p.sizeSol, 0.005);          // 1/200
  assert.equal(p.sizeUsd, 1);
  assert.equal(p.minOutUsd, 0.99);         // 1 × (1 - 1%)
  assert.equal(p.slippageBps, 100);
  assert.equal(p.intent.unsigned, true);   // never auto-executed
  assert.equal(p.intent.venue, 'Jupiter');
});

test('planMicroSwap soft-fails without a price or budget', () => {
  assert.equal(planMicroSwap({ solPriceUsd: 0, usd: 1 }).ok, false);
  assert.equal(planMicroSwap({ solPriceUsd: 200, usd: 0 }).ok, false);
  assert.equal(planMicroSwap({}).ok, false);
});

test('buy side flips the pair + token', () => {
  const p = planMicroSwap({ usd: 1, solPriceUsd: 100, side: 'buy' });
  assert.equal(p.pair, 'USDC/SOL');
  assert.equal(p.intent.inToken, 'USDC');
  assert.equal(p.intent.amountUsd, 1);
});

test('planMicroTestSweep plans the same $1 test across venues', () => {
  const sweep = planMicroTestSweep(['Raydium', 'Orca', 'Phoenix'], { solPriceUsd: 150 });
  assert.equal(sweep.length, 3);
  assert.ok(sweep.every((p) => p.ok && p.sizeUsd === DEFAULT_TEST_USD));
  assert.deepEqual(sweep.map((p) => p.venue), ['Raydium', 'Orca', 'Phoenix']);
});
