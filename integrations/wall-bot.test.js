// wall-bot.test.js — buy/sell wall detection + the maintenance strategy (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectWalls, wallStrategy } from './wall-bot.mjs';

test('detectWalls finds the order that dwarfs the crowd', () => {
  const book = [
    { price: 0.01, quantity: 100, account: 'a' },
    { price: 0.009, quantity: 120, account: 'b' },
    { price: 0.008, quantity: 5000, account: 'whale' }, // the wall
    { price: 0.007, quantity: 90, account: 'c' },
  ];
  const walls = detectWalls(book, { minMultiple: 3 });
  assert.equal(walls.length, 1);
  assert.equal(walls[0].account, 'whale');
  assert.ok(walls[0].multipleOfMedian >= 3);
});

test('no wall when the book is uniform', () => {
  const book = [{ price: 1, quantity: 100, account: 'a' }, { price: 1, quantity: 110, account: 'b' }, { price: 1, quantity: 95, account: 'c' }];
  assert.equal(detectWalls(book).length, 0);
});

test('strategy: PLACE_BUY_WALL when nothing defends the floor', () => {
  const buyBook = [{ price: 0.005, quantity: 100, account: 'a' }, { price: 0.004, quantity: 90, account: 'b' }];
  const { intents } = wallStrategy({ buyBook, floor: 0.01, wallSize: 1000 });
  assert.equal(intents[0].action, 'PLACE_BUY_WALL');
  assert.equal(intents[0].price, 0.01);
  assert.equal(intents[0].quantity, 1000);
});

test('strategy: HOLD_BUY when a big-enough wall already defends the floor', () => {
  const buyBook = [{ price: 0.011, quantity: 2000, account: 'us' }, { price: 0.01, quantity: 50, account: 'a' }, { price: 0.009, quantity: 40, account: 'b' }];
  const { intents } = wallStrategy({ buyBook, floor: 0.01, wallSize: 1000 });
  assert.equal(intents[0].action, 'HOLD_BUY');
});

test('strategy: sell-side ceiling produces PLACE_SELL_WALL when uncapped', () => {
  const sellBook = [{ price: 0.05, quantity: 100, account: 'a' }, { price: 0.06, quantity: 90, account: 'b' }];
  const { intents } = wallStrategy({ sellBook, ceiling: 0.04, wallSize: 1000 });
  assert.ok(intents.some((i) => i.action === 'PLACE_SELL_WALL'));
});
