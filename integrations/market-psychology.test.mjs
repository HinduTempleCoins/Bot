// market-psychology.test.mjs — offline, synthetic 3-point timelines per label + growth math.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  psychology,
  weeklyReport,
  sentimentLabel,
  loadHistory,
  __setReader,
} from './market-psychology.mjs';

// build a snapshot record with the fields the module cares about
function snap({ t, unique, gini, top10, price, ctp, alive = true }) {
  return {
    symbol: 'TST',
    timestampMs: t,
    price: { current: price },
    holders: { unique, giniCoefficient: gini, top10Percent: top10 },
    wall: { costToPush: ctp },
    market: { isAlive: alive },
  };
}

// --- ACCUMULATING: holders up, floor rising, cost rising ---
test('ACCUMULATING — holders grow, floor rises, cost rises', () => {
  const tl = [
    snap({ t: 1, unique: 100, gini: 0.90, top10: 50, price: 0.0010, ctp: 1.0 }),
    snap({ t: 2, unique: 130, gini: 0.88, top10: 48, price: 0.0014, ctp: 1.5 }),
    snap({ t: 3, unique: 170, gini: 0.85, top10: 45, price: 0.0020, ctp: 2.2 }),
  ];
  const r = psychology(tl);
  assert.equal(r.sentiment, 'ACCUMULATING');
  assert.equal(r.points, 3);
  // growth math: 100 → 170 = +70, +70%
  assert.equal(r.holderGrowth.first, 100);
  assert.equal(r.holderGrowth.last, 170);
  assert.equal(r.holderGrowth.delta, 70);
  assert.equal(r.holderGrowth.pct, 70);
  assert.equal(r.holderGrowth.direction, 'RISING');
  assert.equal(r.floorTrend.direction, 'RISING');
  assert.equal(r.costToPushTrend.direction, 'RISING');
  assert.equal(r.concentrationTrend.meaning, 'DISPERSING');
});

// --- DISTRIBUTING: holders down, floor falling, cost falling ---
test('DISTRIBUTING — holders shrink, floor falls, cost falls', () => {
  const tl = [
    snap({ t: 1, unique: 200, gini: 0.80, top10: 40, price: 0.0030, ctp: 3.0 }),
    snap({ t: 2, unique: 170, gini: 0.82, top10: 42, price: 0.0022, ctp: 2.4 }),
    snap({ t: 3, unique: 140, gini: 0.84, top10: 44, price: 0.0015, ctp: 1.8 }),
  ];
  const r = psychology(tl);
  assert.equal(r.sentiment, 'DISTRIBUTING');
  // 200 → 140 = -60, -30%
  assert.equal(r.holderGrowth.delta, -60);
  assert.equal(r.holderGrowth.pct, -30);
  assert.equal(r.holderGrowth.direction, 'FALLING');
  assert.equal(r.floorTrend.direction, 'FALLING');
  assert.equal(r.concentrationTrend.meaning, 'CONCENTRATING');
});

// --- STAGNANT: alive but flat on every axis ---
test('STAGNANT — alive but flat everywhere', () => {
  const tl = [
    snap({ t: 1, unique: 50, gini: 0.70, top10: 30, price: 0.0005, ctp: 1.0 }),
    snap({ t: 2, unique: 50, gini: 0.70, top10: 30, price: 0.0005, ctp: 1.0 }),
    snap({ t: 3, unique: 50, gini: 0.70, top10: 30, price: 0.0005, ctp: 1.0 }),
  ];
  const r = psychology(tl);
  assert.equal(r.sentiment, 'STAGNANT');
  assert.equal(r.holderGrowth.delta, 0);
  assert.equal(r.holderGrowth.pct, 0);
  assert.equal(r.floorTrend.direction, 'FLAT');
});

// --- DEAD: nothing alive across the window ---
test('DEAD — isAlive false for the whole window', () => {
  const tl = [
    snap({ t: 1, unique: 5, gini: 0.99, top10: 95, price: 0.00001, ctp: 0.1, alive: false }),
    snap({ t: 2, unique: 5, gini: 0.99, top10: 95, price: 0.00001, ctp: 0.1, alive: false }),
    snap({ t: 3, unique: 5, gini: 0.99, top10: 95, price: 0.00001, ctp: 0.1, alive: false }),
  ];
  const r = psychology(tl);
  assert.equal(r.sentiment, 'DEAD');
  assert.equal(r.aliveRatio, 0);
});

// --- ordering: out-of-order timestamps are sorted before computing growth ---
test('orders by timestampMs before computing first→last', () => {
  const tl = [
    snap({ t: 3, unique: 170, gini: 0.85, top10: 45, price: 0.0020, ctp: 2.2 }),
    snap({ t: 1, unique: 100, gini: 0.90, top10: 50, price: 0.0010, ctp: 1.0 }),
    snap({ t: 2, unique: 130, gini: 0.88, top10: 48, price: 0.0014, ctp: 1.5 }),
  ];
  const r = psychology(tl);
  assert.equal(r.holderGrowth.first, 100); // earliest by time, not by array order
  assert.equal(r.holderGrowth.last, 170);
  assert.equal(r.holderGrowth.delta, 70);
});

// --- soft-fail: empty / garbage inputs never throw ---
test('soft-fail on empty, null, and non-array inputs', () => {
  assert.equal(psychology([]).sentiment, 'DEAD');
  assert.equal(psychology([]).points, 0);
  assert.equal(psychology(null).points, 0);
  assert.equal(psychology(undefined).points, 0);
  assert.equal(psychology('nope').points, 0);
});

// --- soft-fail: missing fields are skipped, not thrown ---
test('missing fields are skipped without throwing', () => {
  const tl = [
    { symbol: 'TST', timestampMs: 1, holders: { unique: 10 } }, // no price/gini/wall/market
    { symbol: 'TST', timestampMs: 2, holders: { unique: 25 } },
    { not: 'a snapshot' },
    null,
  ];
  const r = psychology(tl);
  assert.equal(r.holderGrowth.first, 10);
  assert.equal(r.holderGrowth.last, 25);
  assert.equal(r.holderGrowth.delta, 15);
  assert.equal(r.floorTrend, null);       // no price series
  assert.equal(r.concentrationTrend, null); // no gini series
});

// --- pct guard: growth from a zero base does not divide-by-zero ---
test('pct is null when first holder count is zero', () => {
  const tl = [
    snap({ t: 1, unique: 0, gini: 0.5, top10: 10, price: 0.001, ctp: 1 }),
    snap({ t: 2, unique: 40, gini: 0.5, top10: 10, price: 0.001, ctp: 1 }),
  ];
  const r = psychology(tl);
  assert.equal(r.holderGrowth.delta, 40);
  assert.equal(r.holderGrowth.pct, null);
});

// --- weeklyReport: object-of-arrays → one summary per symbol ---
test('weeklyReport maps each symbol to a psychology summary', () => {
  const history = {
    UP: [
      snap({ t: 1, unique: 10, gini: 0.9, top10: 50, price: 0.001, ctp: 1 }),
      snap({ t: 2, unique: 20, gini: 0.9, top10: 50, price: 0.002, ctp: 2 }),
    ],
    DOWN: [
      snap({ t: 1, unique: 20, gini: 0.9, top10: 50, price: 0.002, ctp: 2 }),
      snap({ t: 2, unique: 10, gini: 0.9, top10: 50, price: 0.001, ctp: 1 }),
    ],
    EMPTY: [],
  };
  const rep = weeklyReport(history);
  assert.equal(Object.keys(rep).length, 3);
  assert.equal(rep.UP.sentiment, 'ACCUMULATING');
  assert.equal(rep.DOWN.sentiment, 'DISTRIBUTING');
  assert.equal(rep.EMPTY.sentiment, 'DEAD');
  assert.equal(rep.EMPTY.points, 0);
});

test('weeklyReport soft-fails on null / non-object input', () => {
  assert.deepEqual(weeklyReport(null), {});
  assert.deepEqual(weeklyReport(undefined), {});
  assert.deepEqual(weeklyReport(42), {});
});

// --- sentimentLabel is callable directly and deterministic ---
test('sentimentLabel on hand-built signals', () => {
  assert.equal(sentimentLabel({ aliveRatio: 0 }), 'DEAD');
  assert.equal(
    sentimentLabel({ holderGrowth: { delta: 5 }, floorTrend: { direction: 'RISING' }, costToPushTrend: { direction: 'RISING' } }),
    'ACCUMULATING'
  );
  assert.equal(
    sentimentLabel({ holderGrowth: { delta: -5 }, floorTrend: { direction: 'FALLING' }, costToPushTrend: { direction: 'FALLING' } }),
    'DISTRIBUTING'
  );
  assert.equal(sentimentLabel({}), 'STAGNANT');
  assert.equal(sentimentLabel(null), 'STAGNANT');
});

// --- loadHistory via injected reader (no real fs / network) ---
test('loadHistory uses the injectable reader and soft-fails on bad JSON', () => {
  __setReader(() => JSON.stringify({ AAA: [snap({ t: 1, unique: 1, gini: 0.5, top10: 5, price: 0.001, ctp: 1 })] }));
  const h = loadHistory('whatever.json');
  assert.ok(h.AAA);
  assert.equal(h.AAA.length, 1);

  __setReader(() => 'not json{{');
  assert.deepEqual(loadHistory('x'), {});

  __setReader(() => { throw new Error('boom'); });
  assert.deepEqual(loadHistory('x'), {});

  __setReader(null); // reset to default
});
