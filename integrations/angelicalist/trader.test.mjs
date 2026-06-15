// trader.test.mjs — OFFLINE: the trader's write ops dry-run (no key) and emit the correct
// HIVE-Engine payloads. Focus: cancel() (added so the VKBT ratchet can pull stale bids).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOrder, cancel, sweepToKali, executeDecision, orderCapHive, walletSellDecisions, MAX_ORDER_USD, MAX_ORDER_HIVE } from './trader.mjs';

// HIVE ~$0.05 → a $2 cap is 40 HIVE. Inject the price so tests stay offline + deterministic.
const hiveUsd5c = async () => 0.05;

// No ACTIVE key in the test env → every write is simulated (dry-run), never broadcasts.
test('cancel() dry-runs with the correct HE market cancel payload', async () => {
  const r = await cancel({ symbol: 'VKBT', orderId: 12345, type: 'buy' });
  assert.equal(r.simulated, true, 'no key → simulated, never broadcasts');
  assert.deepEqual(r.payload, {
    contractName: 'market', contractAction: 'cancel', contractPayload: { type: 'buy', id: 12345 },
  });
});

test('cancel() rejects a bad side', async () => {
  await assert.rejects(() => cancel({ orderId: 1, type: 'nope' }), /type must be/);
});

test('placeOrder() and sweepToKali() still dry-run with their payloads', async () => {
  const p = await placeOrder({ side: 'buy', symbol: 'VKBT', quantity: 10, price: '0.5' });
  assert.equal(p.simulated, true);
  assert.equal(p.payload.contractAction, 'buy');
  const s = await sweepToKali({ symbol: 'VKBT', quantity: 5 });
  assert.equal(s.simulated, true);
  assert.equal(s.payload.contractAction, 'transfer');
});

test('orderCapHive converts the $ cap at the live HIVE price (and never exceeds the HIVE ceiling)', async () => {
  const c = await orderCapHive({ getHiveUsd: hiveUsd5c });
  assert.equal(c.capHive, MAX_ORDER_USD / 0.05, '$2 / $0.05 = 40 HIVE');
  assert.equal(c.hiveUsd, 0.05);
  // no price → fall back to the HIVE ceiling, never throws
  const noPrice = await orderCapHive({ getHiveUsd: async () => 0 });
  assert.equal(noPrice.capHive, MAX_ORDER_HIVE);
});

test('executeDecision SELL hits the bid, caps notional to the $ cap, dry-runs (no key)', async () => {
  // bid 0.50 HIVE, HIVE $0.05 → cap 40 HIVE → quantity = 40 / 0.50 = 80, priced at the bid.
  const r = await executeDecision({ action: 'SELL', sym: 'SWAP.DOGE', reason: 'premium' },
    { getMetrics: async () => ({ highestBid: 0.50, lowestAsk: 0.60 }), getHiveUsd: hiveUsd5c });
  assert.equal(r.order.side, 'sell');
  assert.equal(r.order.price, 0.50, 'sells into the highest bid');
  assert.equal(r.order.notionalHive, +(MAX_ORDER_USD / 0.05).toFixed(4), 'notional = $ cap in HIVE');
  assert.equal(r.order.quantity, +((MAX_ORDER_USD / 0.05) / 0.50).toFixed(8), 'quantity = capHive / price');
  assert.equal(r.order.notionalUsd, MAX_ORDER_USD);
  assert.equal(r.result.simulated, true, 'no key → dry-run, never broadcasts');
});

test('executeDecision BUY lifts the ask', async () => {
  const r = await executeDecision({ action: 'BUY', sym: 'SWAP.DOGE', reason: 'discount' },
    { getMetrics: async () => ({ highestBid: 0.40, lowestAsk: 0.45 }), getHiveUsd: hiveUsd5c });
  assert.equal(r.order.side, 'buy');
  assert.equal(r.order.price, 0.45, 'buys from the lowest ask');
  assert.equal(r.result.simulated, true);
});

test('walletSellDecisions skims a PREMIUM but is NOT a dump bot (never sells own/at-or-below value)', async () => {
  const holdings = [
    { symbol: 'GIFU', balance: 16340 },     // bid 10% over last → SELL (premium)
    { symbol: 'PEPET', balance: 967 },       // bid at last → NO sell (not a dump)
    { symbol: 'TOOFUCKEH', balance: 387 },   // bid BELOW last → NO sell (never dump)
    { symbol: 'VKBT', balance: 86992 },      // our issued token → NEVER sell
    { symbol: 'NOPRICE', balance: 100 },     // no last price → NO sell (no anchor)
    { symbol: 'SWAP.HIVE', balance: 12 },    // cash-equivalent → skip
  ];
  const metrics = {
    GIFU: { highestBid: 1.10, lastPrice: 1.00 },
    PEPET: { highestBid: 1.00, lastPrice: 1.00 },
    TOOFUCKEH: { highestBid: 0.80, lastPrice: 1.00 },
    VKBT: { highestBid: 5.00, lastPrice: 1.00 },   // even a huge premium — still never sold (issued)
    NOPRICE: { highestBid: 9.00, lastPrice: 0 },
  };
  const out = await walletSellDecisions({
    getHoldings: async () => holdings,
    getMetrics: async (s) => metrics[s] || null,
    getBasis: async () => null,                 // no recorded buys → falls back to the last-price floor
    issued: ['VKBT', 'CURE'],
  });
  const syms = out.map((d) => d.sym);
  assert.deepEqual(syms, ['GIFU'], 'ONLY the genuine-premium token is sold');
  assert.equal(out[0].action, 'SELL');
  assert.equal(out[0].heldBalance, 16340);
  assert.ok(!syms.includes('VKBT'), 'never dumps our own issued token');
  assert.ok(!syms.includes('TOOFUCKEH'), 'never sells below last (no dumping)');
  assert.ok(!syms.includes('PEPET'), 'a bid merely AT last is not a premium');
  assert.ok(!syms.includes('NOPRICE'), 'no anchor price → never blind-sell');
});

test('walletSellDecisions never sells BELOW cost basis even when the bid beats the last price', async () => {
  // SPS: we paid 0.06591. The market dropped — last 0.055, and a buyer bids 0.057 (well over last,
  // a +3.6% "premium" vs last) — but 0.057 is BELOW our 0.06591 cost. A last-only gate would SELL
  // (a loss). The cost-basis floor must BLOCK it.
  const holdings = [{ symbol: 'SPS', balance: 940 }];
  const out = await walletSellDecisions({
    getHoldings: async () => holdings,
    getMetrics: async () => ({ highestBid: 0.057, lastPrice: 0.055 }),
    getBasis: async () => ({ basisHive: 0.06591 }),
    issued: [],
  });
  assert.deepEqual(out, [], 'bid over last but under cost → HELD, never sold at a loss');
});

test('walletSellDecisions SELLS when the bid clears cost basis + premium (real profit)', async () => {
  // same 0.06591 basis, but now a buyer pays 0.069 — over cost AND over the 3% premium → skim it.
  const out = await walletSellDecisions({
    getHoldings: async () => [{ symbol: 'SPS', balance: 940 }],
    getMetrics: async () => ({ highestBid: 0.069, lastPrice: 0.066 }),
    getBasis: async () => ({ basisHive: 0.06591 }),
    issued: [],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].sym, 'SPS');
  assert.equal(out[0].costBasis, 0.06591);
  assert.equal(out[0].heldBalance, 940);
});

test('executeDecision caps a wallet SELL by the held balance (can only skim, never dump the bag)', async () => {
  // tiny held balance: even a $2 cap can not exceed what we hold
  const r = await executeDecision({ action: 'SELL', sym: 'GIFU', reason: 'premium', heldBalance: 5 },
    { getMetrics: async () => ({ highestBid: 0.001, lowestAsk: 0.002 }), getHiveUsd: hiveUsd5c });
  assert.ok(r.order.quantity <= 5, 'never sells more than held');
});

test('executeDecision skips when there is no executable side (one-sided/empty book)', async () => {
  const sell = await executeDecision({ action: 'SELL', sym: 'X', reason: 'r' }, { getMetrics: async () => ({ highestBid: 0, lowestAsk: 1 }), getHiveUsd: hiveUsd5c });
  assert.equal(sell.skipped, 'no bid to sell into');
  const none = await executeDecision({ action: 'BUY', sym: 'X', reason: 'r' }, { getMetrics: async () => null, getHiveUsd: hiveUsd5c });
  assert.equal(none.skipped, 'no market metrics');
});
