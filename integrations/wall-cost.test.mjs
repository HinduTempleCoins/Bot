// wall-cost.test.mjs — offline, node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costToPush, affordable, scoreOpportunity } from './wall-cost.mjs';

// fixture ascending sell book
const BOOK = [
  { price: 0.0100, quantity: 100 },
  { price: 0.0120, quantity: 250 },
  { price: 0.0150, quantity: 400 },
  { price: 0.0200, quantity: 1000 },
  { price: 0.0300, quantity: 5000 },
];

test('costToPush sums cost of every ask at or below target', () => {
  // 0.01*100 + 0.012*250 + 0.015*400 = 1 + 3 + 6 = 10 HIVE
  const r = costToPush(BOOK, 0.0150);
  assert.ok(Math.abs(r.hiveCost - 10) < 1e-9, `hiveCost ${r.hiveCost}`);
  assert.equal(r.ordersConsumed, 3);
  assert.equal(r.newFloor, 0.0200); // first ask above target
});

test('ordersConsumed boundary: inclusive of the target price level', () => {
  // target exactly at the first level price -> only that one consumed
  const r = costToPush(BOOK, 0.0100);
  assert.equal(r.ordersConsumed, 1);
  assert.ok(Math.abs(r.hiveCost - 1) < 1e-9);
  assert.equal(r.newFloor, 0.0120);
  // target below the whole book -> nothing consumed, floor stays at the low ask
  const none = costToPush(BOOK, 0.0050);
  assert.equal(none.ordersConsumed, 0);
  assert.equal(none.hiveCost, 0);
  assert.equal(none.newFloor, 0.0100);
});

test('consuming the whole book leaves newFloor null', () => {
  const r = costToPush(BOOK, 1.0);
  assert.equal(r.ordersConsumed, 5);
  assert.equal(r.newFloor, null);
});

test('empty / garbage book soft-fails to hiveCost 0 (never throws)', () => {
  assert.deepEqual(costToPush([], 0.02), { hiveCost: 0, ordersConsumed: 0, newFloor: null });
  assert.equal(costToPush(null, 0.02).hiveCost, 0);
  assert.equal(costToPush(undefined, 0.02).hiveCost, 0);
  assert.equal(costToPush('nonsense', 0.02).hiveCost, 0);
  assert.equal(costToPush([{ price: 'x', quantity: NaN }, { foo: 1 }], 0.02).hiveCost, 0);
  // bad target
  assert.equal(costToPush(BOOK, NaN).hiveCost, 0);
  assert.equal(costToPush(BOOK, -1).hiveCost, 0);
});

test('garbage rows are dropped but valid rows still counted', () => {
  const messy = [
    { price: 0.0100, quantity: 100 },
    { price: -5, quantity: 100 },      // dropped
    null,                               // dropped
    { price: 0.0120, quantity: 0 },     // dropped (zero qty)
    { price: 0.0150, quantity: 400 },
  ];
  const r = costToPush(messy, 0.02);
  // 0.01*100 + 0.015*400 = 1 + 6 = 7
  assert.ok(Math.abs(r.hiveCost - 7) < 1e-9, `hiveCost ${r.hiveCost}`);
  assert.equal(r.ordersConsumed, 2);
});

test('affordable compares wall cost to budget', () => {
  assert.equal(affordable(BOOK, 0.0150, 10), true);   // cost 10, budget 10
  assert.equal(affordable(BOOK, 0.0150, 9.99), false); // cost 10 > budget
  assert.equal(affordable(BOOK, 0.0150, 100), true);
  assert.equal(affordable(BOOK, 0.0050, 100), false); // nothing to push
  assert.equal(affordable(BOOK, 0.0150, 0), false);
  assert.equal(affordable(BOOK, 0.0150, NaN), false);
  assert.equal(affordable([], 0.0150, 100), false);
});

test('scoreOpportunity blends affordability and holder breadth in 0..1', () => {
  const s = scoreOpportunity({ sellOrders: BOOK, targetPrice: 0.0150, maxHive: 10, holders: 8 });
  // afford = 1 - 10/10 = 0 ; breadth = min(1, 8/10) = 0.8 ; score = 0.5*0 + 0.5*0.8 = 0.4
  assert.ok(Math.abs(s - 0.4) < 1e-9, `score ${s}`);

  // cheaper wall (more headroom) + many holders -> higher
  const s2 = scoreOpportunity({ sellOrders: BOOK, targetPrice: 0.0100, maxHive: 10, holders: 20 });
  // cost 1, afford = 0.9 ; breadth = 1 ; score = 0.45 + 0.5 = 0.95
  assert.ok(Math.abs(s2 - 0.95) < 1e-9, `score ${s2}`);

  // holders as array works too
  const s3 = scoreOpportunity({ sellOrders: BOOK, targetPrice: 0.0100, maxHive: 10, holders: ['a', 'b', 'c', 'd', 'e'] });
  // afford 0.9, breadth 0.5 -> 0.45 + 0.25 = 0.7
  assert.ok(Math.abs(s3 - 0.7) < 1e-9, `score ${s3}`);
});

test('scoreOpportunity soft-fails to 0 on unaffordable / garbage', () => {
  assert.equal(scoreOpportunity({ sellOrders: BOOK, targetPrice: 0.0150, maxHive: 1, holders: 8 }), 0); // cost 10 > 1
  assert.equal(scoreOpportunity({ sellOrders: [], targetPrice: 0.0150, maxHive: 10, holders: 8 }), 0);
  assert.equal(scoreOpportunity({ sellOrders: BOOK, targetPrice: 0.0050, maxHive: 10, holders: 8 }), 0); // nothing to push
  assert.equal(scoreOpportunity({ sellOrders: BOOK, targetPrice: 0.0150, maxHive: 0, holders: 8 }), 0);
  assert.equal(scoreOpportunity({}), 0);
  assert.equal(scoreOpportunity(), 0);
});
