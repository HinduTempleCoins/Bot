// dry-run.test.mjs — OFFLINE tests for the angelicalist end-to-end DRY-RUN harness (task #69).
//
// Everything here is injected: market metrics are hand-built fixtures and the broadcaster is a SPY.
// The whole point is to PROVE the full pipeline (decide → bleed-guard → size → sweep) runs without a
// single live broadcast. No network, no keys, no filesystem writes.
//
//   node --test integrations/angelicalist/dry-run.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dryRunCycle, planSweep, assertNoLiveBroadcast, summary, makeSpyBroadcaster, SWEEP_TO } from './dry-run.mjs';

// Injected market: SWAP.BTC has a real bid/ask; SWAP.LTC too (used for the bleed-guard test).
const MARKET = {
  'SWAP.BTC': { highestBid: '0.5', lowestAsk: '0.52' },
  'SWAP.LTC': { highestBid: '0.01', lowestAsk: '0.011' },
};
const TOKENS = [{ symbol: 'SWAP.HIVE', balance: 100 }, { symbol: 'SWAP.BTC', balance: 20 }];

test('dryRunCycle runs decide → size → place → sweep and NEVER broadcasts', async () => {
  const spy = makeSpyBroadcaster();
  const signals = [
    { action: 'BUY', sym: 'SWAP.BTC', reason: 'discount' },
    { action: 'SELL', sym: 'SWAP.BTC', reason: 'premium' },
  ];
  const result = await dryRunCycle(
    { market: MARKET, signals },
    { tokens: TOKENS, balances: { 'SWAP.HIVE': 100 }, principal: 50, threshold: 5, broadcaster: spy },
  );

  assert.equal(result.dryRun, true, 'cycle must be marked dryRun');
  assert.deepEqual(result.broadcasts, [], 'no broadcasts may be recorded');
  assert.equal(spy.calls.length, 0, 'the broadcaster spy must NEVER be called');

  // it actually sized orders (decide → size produced concrete orders).
  const sized = result.orders.filter((o) => o.order);
  assert.ok(sized.length >= 1, 'expected at least one sized order');
  for (const o of sized) {
    assert.ok(o.order.quantity > 0 && o.order.price > 0, 'sized order has qty + price');
  }

  // and it produced a sweep to kalivankush.
  assert.equal(result.sweep.to, 'kalivankush');
  assert.equal(result.sweep.to, SWEEP_TO);
});

test('planSweep skims only ABOVE-threshold profit, never the principal', () => {
  // liquid 100, principal 50, buffer 5 -> skim 45.
  const s1 = planSweep({ balances: { 'SWAP.HIVE': 100 }, principal: 50, threshold: 5 });
  assert.equal(s1.skim, true);
  assert.equal(s1.amount, 45);
  assert.equal(s1.to, 'kalivankush');

  // liquid equals principal + buffer exactly -> nothing to skim.
  const s2 = planSweep({ balances: { 'SWAP.HIVE': 55 }, principal: 50, threshold: 5 });
  assert.equal(s2.skim, false);
  assert.equal(s2.amount, 0);

  // liquid below principal -> NEVER touch the principal.
  const s3 = planSweep({ balances: { 'SWAP.HIVE': 30 }, principal: 50, threshold: 5 });
  assert.equal(s3.skim, false);
  assert.equal(s3.amount, 0);

  // no principal set, default threshold buffer applies -> skims above the buffer only.
  const s4 = planSweep({ balances: { 'SWAP.HIVE': 12 }, principal: 0, threshold: 5 });
  assert.equal(s4.amount, 7);
});

test('the SWAP.LTC bleed guard blocks a one-way BUY inside the cycle', async () => {
  const spy = makeSpyBroadcaster();
  const signals = [
    { action: 'BUY', sym: 'SWAP.LTC', reason: 'one-way accumulation — the bleed' }, // no SELL leg
    { action: 'SELL', sym: 'SWAP.BTC', reason: 'has a leg' },
  ];
  const result = await dryRunCycle(
    { market: MARKET, signals },
    { tokens: TOKENS, balances: { 'SWAP.HIVE': 100 }, broadcaster: spy },
  );

  // the LTC buy must be in `blocked`, not in the sized orders.
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0].sym, 'SWAP.LTC');
  assert.match(result.blocked[0].blocked, /bleed guard/i);
  assert.ok(!result.decisions.some((d) => d.sym === 'SWAP.LTC' && d.action === 'BUY'), 'LTC buy not in guarded decisions');
  assert.equal(spy.calls.length, 0, 'still no broadcast');
});

test('assertNoLiveBroadcast passes for a dry result and throws if a broadcast is present', async () => {
  const result = await dryRunCycle(
    { market: MARKET, signals: [{ action: 'SELL', sym: 'SWAP.BTC' }] },
    { tokens: TOKENS, balances: { 'SWAP.HIVE': 60 }, principal: 50, threshold: 5 },
  );
  assert.equal(assertNoLiveBroadcast(result), true);

  // a result that recorded a broadcast must throw.
  assert.throws(() => assertNoLiveBroadcast({ ...result, broadcasts: [{ txId: 'live!' }] }), /SAFETY/);

  // a result not marked dryRun must throw.
  assert.throws(() => assertNoLiveBroadcast({ ...result, dryRun: false }), /SAFETY/);

  // a result whose broadcaster spy was somehow called must throw.
  const calledSpy = makeSpyBroadcaster();
  await calledSpy('oops');
  assert.throws(() => assertNoLiveBroadcast({ ...result, broadcaster: calledSpy }), /SAFETY/);
});

test('summary reports the dry-run plan in human-readable form', async () => {
  const result = await dryRunCycle(
    { market: MARKET, signals: [{ action: 'BUY', sym: 'SWAP.BTC' }, { action: 'SELL', sym: 'SWAP.BTC' }] },
    { tokens: TOKENS, balances: { 'SWAP.HIVE': 100 }, principal: 50, threshold: 5 },
  );
  const text = summary(result);
  assert.match(text, /DRY-RUN/);
  assert.match(text, /kalivankush/);
  assert.match(text, /broadcasts performed: 0/);
});
