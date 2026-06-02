// market-impact-sim.test.js — pure what-if simulation math (no network).
// simulateBuy/simulateSell accept a pre-built book, so we feed fixtures and assert the fill math,
// price impact, slippage, wall-consumption, and book-clearing behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateBuy, simulateSell } from './market-impact-sim.mjs';

// a tidy ascending ask book / descending bid book fixture (cumulative fields don't matter to walk)
const book = {
  symbol: 'TEST',
  bestAsk: 1.0, bestBid: 0.9,
  asks: [
    { price: 1.0, quantity: 100 },
    { price: 1.1, quantity: 100 },
    { price: 1.5, quantity: 100 },
  ],
  bids: [
    { price: 0.9, quantity: 100 },
    { price: 0.8, quantity: 100 },
    { price: 0.5, quantity: 100 },
  ],
  realAskDepthHive: 360,
};

test('simulateBuy fills the cheapest level first, with no impact when it stays in level 1', async () => {
  const r = await simulateBuy('TEST', 50, book);  // 50 HIVE buys 50 tokens at 1.0
  assert.equal(r.tokensBought, 50);
  assert.equal(r.avgPrice, 1);
  assert.equal(r.priceImpactPct, 0);   // didn't move off the best ask level
  assert.equal(r.slippagePct, 0);
  assert.equal(r.wallsConsumed, 1);
  assert.equal(r.clearedBook, false);
});

test('simulateBuy walks into deeper levels → positive impact + slippage', async () => {
  const r = await simulateBuy('TEST', 150, book);  // eats all of L1 (100 HIVE) + 50 HIVE of L2
  assert.equal(r.tokensBought, +(100 + 50 / 1.1).toFixed(6));
  assert.ok(r.priceImpactPct > 0, 'top-of-book ask moved up');
  assert.ok(r.slippagePct > 0, 'paid above the starting best ask on average');
  assert.equal(r.wallsConsumed, 2);
});

test('simulateBuy that exceeds the whole book reports clearedBook + undeployed', async () => {
  const total = 100 * 1.0 + 100 * 1.1 + 100 * 1.5; // 360
  const r = await simulateBuy('TEST', total + 40, book);
  assert.equal(r.clearedBook, true);
  assert.equal(r.tokensBought, 300);
  assert.equal(r.undeployedHive, 40);
});

test('simulateSell hits the top bid first, pushing price DOWN as it goes deeper', async () => {
  const r = await simulateSell('TEST', 150, book); // sells 100 @0.9 + 50 @0.8
  assert.equal(r.tokensSold, 150);
  assert.equal(r.hiveReceived, 100 * 0.9 + 50 * 0.8);
  assert.ok(r.priceImpactPct < 0, 'selling moves the top bid down');
  assert.equal(r.wallsConsumed, 2);
});

test('simulateSell beyond the bid book leaves tokens unsold', async () => {
  const r = await simulateSell('TEST', 400, book);
  assert.equal(r.clearedBook, true);
  assert.equal(r.tokensSold, 300);
  assert.equal(r.unsoldTokens, 100);
});

test('empty / zero inputs are handled, not thrown', async () => {
  const empty = { symbol: 'X', bestAsk: 0, bestBid: 0, asks: [], bids: [], realAskDepthHive: 0 };
  const b = await simulateBuy('X', 100, empty);
  assert.equal(b.tokensBought, 0);
  assert.equal(b.undeployedHive, 100);
  const z = await simulateBuy('TEST', 0, book);
  assert.equal(z.tokensBought, 0);
});
