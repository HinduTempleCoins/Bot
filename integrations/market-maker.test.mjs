import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, summarise, plan, isTwoSided, wouldSelfTrade, explain, toOps, DEFAULTS, handler,
  fetchBook,
} from './market-maker.mjs';

// The real VKBT book, measured 2026-09-08. Keeping the actual numbers means these tests describe
// the situation the module was written for rather than a tidy invention.
const VKBT = {
  symbol: 'VKBT',
  bids: [
    { account: 'd9connect', price: '0.00001902', quantity: '17941.03' },
    { account: 'yintercept', price: '0.00001900', quantity: '443.93' },
    { account: 'idoodle', price: '0.00001870', quantity: '444.00' },
    { account: 'd9connect', price: '0.00000001', quantity: '2000000' }, // floor-parking, not a bid
  ],
  asks: [
    { account: 'vagabondspirit', price: '0.00094500', quantity: '161.81' },
    { account: 'd9connect', price: '0.00094899', quantity: '100.00' },
  ],
};
const HEALTHY = {
  symbol: 'SPS',
  bids: [{ account: 'a', price: '0.0810', quantity: '1000' }],
  asks: [{ account: 'b', price: '0.0815', quantity: '1000' }],
};

test('summarise ignores floor-parking orders below the dust floor', () => {
  const s = summarise(VKBT, { dustFloor: 1e-7 });
  assert.equal(s.bestBid, 0.00001902);
  assert.equal(s.bidCount, 3, 'the 0.00000001 wall is not a bid');
  const naive = summarise(VKBT, { dustFloor: 0 });
  assert.equal(naive.bidCount, 4);
});

test('a 50x spread is reported as broken', () => {
  const s = summarise(VKBT, { dustFloor: 1e-7 });
  assert.ok(s.spreadRatio > 49 && s.spreadRatio < 50);
  assert.equal(s.broken, true);
  assert.equal(summarise(HEALTHY).broken, false);
});

test('a broken book refuses to infer its own reference', () => {
  const p = plan({ book: VKBT, inventory: { base: 2e6, quote: 20 } });
  assert.equal(p.refused, true);
  assert.match(p.reason, /midpoint/);
  assert.match(p.reason, /nobody trades at/);
  assert.equal(p.orders.length, 0);
});

test('with a stated reference, a broken book gets a real two-sided market', () => {
  const p = plan({
    book: VKBT, inventory: { base: 2e6, quote: 20 }, referencePrice: 0.00002,
    opts: { account: 'kalivankush', maxInventoryBase: 5e6 },
  });
  assert.equal(p.ok, true);
  assert.equal(p.mode, 'two-sided');
  assert.equal(p.orders.length, 6);
  assert.ok(p.effect.spreadAfter < 1.1, 'spread collapses to near parity');
  assert.ok(p.effect.spreadBefore > 49);
  assert.ok(p.effect.bestBidAfter > p.effect.bestBidBefore, 'bid improves');
  assert.ok(p.effect.bestAskAfter < p.effect.bestAskBefore, 'ask comes down to meet it');
});

test('BID-ONLY is allowed, because a standing bid is a floor holders can sell into', () => {
  const p = plan({
    book: VKBT, inventory: { base: 0, quote: 20 }, referencePrice: 0.00002,
    opts: { account: 'kalivankush' },
  });
  assert.equal(p.ok, true);
  assert.equal(p.mode, 'bid-only (buy support)');
  assert.ok(p.orders.every((o) => o.side === 'buy'));
});

test('ASK-ONLY is refused — distributing with no way out for holders', () => {
  const p = plan({
    book: VKBT, inventory: { base: 9e5, quote: 20 }, referencePrice: 0.00002,
    opts: { account: 'kalivankush', maxInventoryBase: 250000 },
  });
  assert.equal(p.refused, true);
  assert.match(p.reason, /ASKS ONLY/);
});

test('a refusal names its OWN cause — the inventory cap, not funding', () => {
  const p = plan({
    book: VKBT, inventory: { base: 9e5, quote: 20 }, referencePrice: 0.00002,
    opts: { maxInventoryBase: 250000 },
  });
  assert.match(p.reason, /already hold 900,000 VKBT/);
  assert.match(p.reason, /maxInventoryBase of 250,000/);
  assert.ok(!/Fund the bid side first\.$/.test(p.reason), 'does not blame funding');
});

test('bids we could not pay for are refused', () => {
  const p = plan({
    book: VKBT, inventory: { base: 0, quote: 0.000001 }, referencePrice: 0.00002,
    opts: { account: 'kalivankush', sizeQuote: 5 },
  });
  assert.equal(p.refused, true);
  assert.match(p.reason, /nothing to quote|cannot honour/);
});

test('a committed bid total is reported so the operator sees the exposure', () => {
  const p = plan({
    book: VKBT, inventory: { base: 0, quote: 20 }, referencePrice: 0.00002,
    opts: { account: 'kalivankush', sizeQuote: 5, levels: 3 },
  });
  assert.equal(p.committedQuote, 15, '3 rungs x 5 quote each');
  assert.ok(p.committedQuote <= 20, 'never commits more than we hold');
});

test('the deviation cap applies to a FUNCTIONING book only', () => {
  const far = plan({
    book: HEALTHY, inventory: { base: 1e5, quote: 100 }, referencePrice: 0.5,
    opts: { account: 'x' },
  });
  assert.equal(far.refused, true);
  assert.match(far.reason, /functioning book/);
  const near = plan({
    book: HEALTHY, inventory: { base: 1e5, quote: 100 }, referencePrice: 0.0812,
    opts: { account: 'x' },
  });
  assert.equal(near.ok, true);
});

test('self-trading is blocked — it prints volume that never happened', () => {
  const mine = {
    symbol: 'VKBT',
    bids: [{ account: 'me', price: '0.00001902', quantity: '100' }],
    asks: [{ account: 'me', price: '0.0000201', quantity: '100' }],
  };
  assert.equal(wouldSelfTrade({ side: 'buy', price: 0.0000206 }, mine, 'me'), true);
  assert.equal(wouldSelfTrade({ side: 'buy', price: 0.0000206 }, mine, 'someone'), false);
  assert.equal(wouldSelfTrade({ side: 'sell', price: 0.0000180 }, mine, 'me'), true);
});

test('isTwoSided is honest about what it sees', () => {
  assert.equal(isTwoSided([{ side: 'buy' }, { side: 'sell' }]), true);
  assert.equal(isTwoSided([{ side: 'buy' }]), false);
  assert.equal(isTwoSided([]), false);
});

test('explain surfaces the refusal rather than printing an empty plan', () => {
  const p = plan({ book: VKBT, inventory: { base: 1, quote: 1 } });
  assert.match(explain(p), /^REFUSED/);
  assert.equal(explain(null), '');
});

test('toOps emits nothing for a refused plan', () => {
  assert.deepEqual(toOps(plan({ book: VKBT }), 'me'), []);
  const p = plan({
    book: VKBT, inventory: { base: 2e6, quote: 20 }, referencePrice: 0.00002,
    opts: { account: 'me', maxInventoryBase: 5e6 },
  });
  const ops = toOps(p, 'me');
  assert.equal(ops.length, p.orders.length);
  assert.equal(ops[0].contractName, 'market');
  assert.ok(['buy', 'sell'].includes(ops[0].contractAction));
});

test('an empty book cannot be quoted into', () => {
  const p = plan({ book: { symbol: 'X', bids: [], asks: [] }, inventory: { base: 1, quote: 1 } });
  assert.equal(p.refused, true);
  assert.match(p.reason, /no usable price/);
});

test('fetchBook soft-fails to an empty book rather than throwing', async (t) => {
  t.after(() => __setFetch(null));
  __setFetch(async () => { throw new Error('network down'); });
  const b = await fetchBook('VKBT');
  assert.deepEqual(b, { symbol: 'VKBT', bids: [], asks: [] });
});

test('handler advertises that it never signs or broadcasts', () => {
  const res = { statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  handler({ url: '/mm' }, res);
  const j = JSON.parse(res.body);
  assert.equal(j.service, 'market-maker');
  assert.match(j.note, /needs a signer/);
  assert.equal(j.defaults.maxInventoryBase, DEFAULTS.maxInventoryBase);
});
