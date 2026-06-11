// order-book-spread.test.mjs — offline tests for the pure spread + paper-wall detector.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSide, spread, depthWithin, detectPaperWall, esc } from './order-book-spread.mjs';

test('cleanSide sorts ascending and drops garbage', () => {
  const out = cleanSide([
    { price: 0.02, quantity: 10 },
    { price: 0.01, quantity: 5 },
    { price: -1, quantity: 5 },     // negative price dropped
    { price: 0.03, quantity: 0 },   // zero qty dropped
    { price: 'x', quantity: 5 },    // non-finite dropped
    null,                            // non-object dropped
    'nope',                          // non-object dropped
  ]);
  assert.deepEqual(out, [
    { price: 0.01, quantity: 5 },
    { price: 0.02, quantity: 10 },
  ]);
});

test('cleanSide returns [] on non-array', () => {
  assert.deepEqual(cleanSide(undefined), []);
  assert.deepEqual(cleanSide(null), []);
  assert.deepEqual(cleanSide({}), []);
  assert.deepEqual(cleanSide(42), []);
});

test('spread computes best bid/ask, abs, pct, mid', () => {
  const book = {
    buyOrders: [{ price: 0.0090, quantity: 100 }, { price: 0.0098, quantity: 50 }],
    sellOrders: [{ price: 0.0100, quantity: 30 }, { price: 0.0120, quantity: 200 }],
  };
  const s = spread(book);
  assert.equal(s.bestBid, 0.0098);
  assert.equal(s.bestAsk, 0.0100);
  assert.ok(Math.abs(s.absSpread - 0.0002) < 1e-12);
  assert.ok(Math.abs(s.midPrice - 0.0099) < 1e-12);
  assert.ok(Math.abs(s.spreadPct - (0.0002 / 0.0099)) < 1e-12);
});

test('spread returns nulls when a side is empty', () => {
  assert.deepEqual(spread({ buyOrders: [], sellOrders: [{ price: 1, quantity: 1 }] }), {
    bestBid: null, bestAsk: 1, absSpread: null, spreadPct: null, midPrice: null,
  });
  assert.deepEqual(spread({ buyOrders: [{ price: 1, quantity: 1 }], sellOrders: [] }), {
    bestBid: 1, bestAsk: null, absSpread: null, spreadPct: null, midPrice: null,
  });
});

test('spread soft-fails on garbage book', () => {
  const s = spread(null);
  assert.equal(s.bestBid, null);
  assert.equal(s.bestAsk, null);
  assert.equal(s.midPrice, null);
});

test('spread can report a crossed book (negative abs spread)', () => {
  const book = {
    buyOrders: [{ price: 0.012, quantity: 1 }],
    sellOrders: [{ price: 0.010, quantity: 1 }],
  };
  const s = spread(book);
  assert.ok(s.absSpread < 0);
});

test('depthWithin sums sell-side quantity within pct of best ask', () => {
  const book = {
    buyOrders: [{ price: 0.0098, quantity: 50 }],
    sellOrders: [
      { price: 0.0100, quantity: 30 },
      { price: 0.0102, quantity: 70 },  // within 5% of 0.0100 (ceil 0.0105)
      { price: 0.0200, quantity: 999 }, // outside 5%
    ],
  };
  assert.equal(depthWithin(book, 'sell', 0.05), 100);
});

test('depthWithin sums buy-side quantity within pct of best bid', () => {
  const book = {
    buyOrders: [
      { price: 0.0100, quantity: 40 },  // best bid
      { price: 0.0098, quantity: 60 },  // within 5% (floor 0.0095)
      { price: 0.0050, quantity: 999 }, // outside 5%
    ],
    sellOrders: [{ price: 0.0120, quantity: 1 }],
  };
  assert.equal(depthWithin(book, 'buy', 0.05), 100);
});

test('depthWithin returns 0 on empty side, bad pct, bad side', () => {
  const book = { buyOrders: [], sellOrders: [{ price: 1, quantity: 1 }] };
  assert.equal(depthWithin(book, 'buy', 0.05), 0);
  assert.equal(depthWithin(book, 'sell', -1), 0);
  assert.equal(depthWithin(book, 'sell', 'x'), 0);
  assert.equal(depthWithin(book, 'nonsense', 0.05), 0);
  assert.equal(depthWithin(null, 'sell', 0.05), 0);
});

test('detectPaperWall flags thin front order shadowing a wall (sell side)', () => {
  const sells = [
    { price: 0.0100, quantity: 5 },      // thin front
    { price: 0.01001, quantity: 5000 },  // wall one tick behind
    { price: 0.0120, quantity: 400 },
  ];
  const r = detectPaperWall(sells);
  assert.equal(r.isPaper, true);
  assert.equal(r.suspectOrders.length, 2);
  assert.equal(r.suspectOrders[0].quantity, 5);
  assert.equal(r.suspectOrders[1].quantity, 5000);
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
});

test('detectPaperWall flags on buy side via dir option', () => {
  // raw buys ascending; top of book is the highest bid (front).
  const buys = [
    { price: 0.0098, quantity: 400 },
    { price: 0.00999, quantity: 5000 }, // wall one tick behind the top
    { price: 0.0100, quantity: 5 },     // thin top bid
  ];
  const r = detectPaperWall(buys, { dir: 'buy' });
  assert.equal(r.isPaper, true);
  assert.equal(r.suspectOrders[0].quantity, 5);
  assert.equal(r.suspectOrders[1].quantity, 5000);
});

test('detectPaperWall does not flag a healthy book', () => {
  const sells = [
    { price: 0.0100, quantity: 500 },
    { price: 0.0110, quantity: 600 },  // not one tick behind, similar size
    { price: 0.0120, quantity: 400 },
  ];
  const r = detectPaperWall(sells);
  assert.equal(r.isPaper, false);
  assert.equal(r.suspectOrders.length, 0);
});

test('detectPaperWall does not flag when second order is not one tick behind', () => {
  const sells = [
    { price: 0.0100, quantity: 5 },    // thin
    { price: 0.0500, quantity: 5000 }, // big but far away — not a paper wall
    { price: 0.0600, quantity: 10 },
  ];
  const r = detectPaperWall(sells, { minSpacingPct: 0.001 });
  assert.equal(r.isPaper, false);
});

test('detectPaperWall requires minOrders and soft-fails on garbage', () => {
  assert.equal(detectPaperWall([{ price: 0.01, quantity: 5 }]).isPaper, false);
  assert.equal(detectPaperWall(null).isPaper, false);
  assert.equal(detectPaperWall('nope').isPaper, false);
  const r = detectPaperWall(undefined);
  assert.equal(r.isPaper, false);
  assert.deepEqual(r.suspectOrders, []);
  assert.ok(typeof r.reason === 'string');
});

test('detectPaperWall honors custom sizeRatio and ignores garbage opts', () => {
  const sells = [
    { price: 0.0100, quantity: 100 },
    { price: 0.01001, quantity: 300 }, // only 3x larger
    { price: 0.0120, quantity: 50 },
  ];
  // default ratio 10 -> not flagged
  assert.equal(detectPaperWall(sells).isPaper, false);
  // ratio 2 -> flagged
  assert.equal(detectPaperWall(sells, { sizeRatio: 2 }).isPaper, true);
  // garbage opts fall back to defaults (not flagged)
  assert.equal(detectPaperWall(sells, 'bad').isPaper, false);
});

test('esc escapes HTML-significant chars', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});
