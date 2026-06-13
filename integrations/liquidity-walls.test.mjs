import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectWalls, wallSummary } from './liquidity-walls.mjs';

test('detectWalls finds a buy wall that dwarfs the median bid', () => {
  const book = {
    bids: [[0.99, 10], [0.98, 12], [0.97, 11], [0.95, 500]], // 500 is the wall (~45× median ~11)
    asks: [[1.01, 10], [1.02, 9], [1.03, 11]],
  };
  const { buyWalls, sellWalls } = detectWalls(book, { mult: 5 });
  assert.equal(buyWalls.length, 1);
  assert.equal(buyWalls[0].price, 0.95);
  assert.equal(buyWalls[0].size, 500);
  assert.ok(buyWalls[0].x >= 5, 'wall is at least 5× the median');
  assert.equal(sellWalls.length, 0, 'evenly-sized asks have no wall');
});

test('detectWalls finds a sell wall (resistance)', () => {
  const book = { bids: [[1, 5], [0.99, 6]], asks: [[1.01, 8], [1.02, 7], [1.05, 900]] };
  const { sellWalls } = detectWalls(book, { mult: 5 });
  assert.equal(sellWalls.length, 1);
  assert.equal(sellWalls[0].price, 1.05);
});

test('walls are returned largest-first', () => {
  const book = { bids: [[1, 10], [0.99, 10], [0.98, 200], [0.97, 800]], asks: [] };
  // median size = 105; mult 1.5 → threshold ~157, so both 200 and 800 are walls.
  const { buyWalls } = detectWalls(book, { mult: 1.5 });
  assert.deepEqual(buyWalls.map((w) => w.size), [800, 200]);
});

test('accepts the Hive-Engine book shape (buyOrders/sellOrders, quantity)', () => {
  const book = {
    buyOrders: [{ price: 0.01, quantity: 5 }, { price: 0.009, quantity: 6 }, { price: 0.008, quantity: 400 }],
    sellOrders: [{ price: 0.011, quantity: 5 }, { price: 0.012, quantity: 7 }],
  };
  const { buyWalls } = detectWalls(book, { mult: 5 });
  assert.equal(buyWalls.length, 1);
  assert.equal(buyWalls[0].size, 400);
});

test('accepts {price, amount} rows too', () => {
  const book = { bids: [{ price: 1, amount: 5 }, { price: 0.9, amount: 5 }, { price: 0.8, amount: 300 }] };
  const { buyWalls } = detectWalls(book, { mult: 5 });
  assert.equal(buyWalls[0].size, 300);
});

test('min option ignores dust below the floor', () => {
  const book = { bids: [[1, 1], [0.99, 1], [0.98, 1], [0.97, 50]], asks: [] };
  // with min=10 only the 50 survives → it becomes the only row, median 50, no wall
  const { buyWalls } = detectWalls(book, { mult: 5, min: 10 });
  assert.equal(buyWalls.length, 0);
});

test('soft-fail on garbage / empty input', () => {
  assert.deepEqual(detectWalls(null).buyWalls, []);
  assert.deepEqual(detectWalls({}).sellWalls, []);
  assert.deepEqual(detectWalls({ bids: 'nope', asks: 42 }).buyWalls, []);
  assert.deepEqual(detectWalls({ bids: [['x', 'y'], [1, -5]] }).buyWalls, [], 'non-numeric / non-positive dropped');
});

test('phantom flag marks an implausibly-large (broken-book) level', () => {
  // a single 10,000,000-unit bid against ~1-unit medians = a stale/broken book level, not a wall
  const book = { bids: [[1, 1], [0.99, 1], [0.98, 1], [0.5, 10_000_000]], asks: [] };
  const { buyWalls, hasPhantom } = detectWalls(book, { mult: 5, phantomX: 1000 });
  assert.equal(buyWalls[0].phantom, true, 'absurd level flagged phantom');
  assert.equal(hasPhantom, true);
  assert.match(wallSummary(book, { mult: 5 }), /PHANTOM|broken\/stale/);
});

test('a normal wall is NOT phantom; phantomX is tunable', () => {
  const book = { bids: [[1, 10], [0.99, 12], [0.98, 11], [0.95, 100]], asks: [] };
  const { buyWalls, hasPhantom } = detectWalls(book, { mult: 5 });
  assert.equal(buyWalls[0].phantom, false, '~9× median is a real wall, not phantom');
  assert.equal(hasPhantom, false);
  // tightening phantomX reclassifies the same wall as phantom
  assert.equal(detectWalls(book, { mult: 5, phantomX: 5 }).buyWalls[0].phantom, true);
});

test('wallSummary is a plain string in every case', () => {
  assert.equal(typeof wallSummary(null), 'string');
  assert.match(wallSummary({}), /No significant walls|evenly/);
  const s = wallSummary({ bids: [[1, 10], [0.99, 10], [0.98, 500]], asks: [] }, { mult: 5 });
  assert.match(s, /Support \(buy wall\)/);
  assert.match(s, /median/);
});
