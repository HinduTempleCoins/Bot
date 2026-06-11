// timeline.test.mjs — OFFLINE tests for the pure reconstructTimeline() export (integrations/timeline.mjs).
// No network: we never call buildTimeline (which hits marketHistory) — only the injectable
// reconstructTimeline(ops, account) with inline market-op fixtures. ARB_HISTORY_FILE is set to a
// nonexistent path BEFORE import so the arb-read soft-fails to null. Asserts: oldest→newest sort by
// timestamp, market_sell=+HIVE / market_buy=-HIVE, day-bucketed curve w/ running cumRealized, skips
// ops lacking symbol or quantityHive, per-token net/buys/sells/first/last windows, worstDays/bestDays.

// Must be set before the module is evaluated — ARB_HISTORY is captured at module-load time.
// Static `import` statements are hoisted and run BEFORE any top-level statement, so we set the
// env var here and pull reconstructTimeline in via a dynamic import (below the assignment).
process.env.ARB_HISTORY_FILE = '/nonexistent/does-not-exist-arb-history.json';

import { test } from 'node:test';
import assert from 'node:assert';
const { reconstructTimeline } = await import('./timeline.mjs');

// Helper: a market op. timestamp is unix-epoch SECONDS (HIVE-Engine style).
// 2026-01-01 00:00:00 UTC = 1767225600. One day = 86400s.
const D0 = 1767225600;            // 2026-01-01
const D1 = D0 + 86400;            // 2026-01-02
const D2 = D0 + 2 * 86400;        // 2026-01-03

function op(operation, symbol, quantityHive, timestamp, extra = {}) {
  return { operation, symbol, quantityHive, timestamp, ...extra };
}

// --- ordering ---------------------------------------------------------------

test('sorts oldest→newest by timestamp regardless of input order', () => {
  const ops = [
    op('market_sell', 'SWAP.LTC', 5, D2),
    op('market_buy', 'SWAP.LTC', 3, D0),
    op('market_sell', 'SWAP.LTC', 2, D1),
  ];
  const tl = reconstructTimeline(ops, 'kalivankush');
  assert.equal(tl.account, 'kalivankush');
  assert.equal(tl.ops, 3);
  // curve is day-keyed and sorted ascending by day
  const days = tl.curve.map((p) => p.day);
  assert.deepEqual(days, ['2026-01-01', '2026-01-02', '2026-01-03']);
});

test('ties on timestamp fall back to blockNumber ascending', () => {
  const ops = [
    op('market_buy', 'A', 1, D0, { blockNumber: 20 }),
    op('market_buy', 'A', 1, D0, { blockNumber: 10 }),
  ];
  // No throw + both counted; sort stable on block number.
  const tl = reconstructTimeline(ops, 'acct');
  assert.equal(tl.ops, 2);
});

// --- sell = +HIVE, buy = -HIVE ---------------------------------------------

test('market_sell adds HIVE, market_buy spends HIVE', () => {
  const ops = [
    op('market_buy', 'X', 4, D0),   // -4
    op('market_sell', 'X', 10, D0), // +10
  ];
  const tl = reconstructTimeline(ops, 'a');
  // single day: net = +6
  assert.equal(tl.curve.length, 1);
  assert.equal(tl.curve[0].dayRealized, 6);
  assert.equal(tl.curve[0].cumRealized, 6);
  assert.equal(tl.curve[0].buys, 1);
  assert.equal(tl.curve[0].sells, 1);
  assert.equal(tl.finalCumRealized, 6);
});

// --- day-bucketing + running cumRealized ------------------------------------

test('day-buckets the curve with a correct cumRealized running total', () => {
  const ops = [
    op('market_buy', 'T', 10, D0),  // day0: -10
    op('market_sell', 'T', 3, D1),  // day1: +3
    op('market_sell', 'T', 4, D1),  // day1: +4  -> day1 net +7
    op('market_buy', 'T', 2, D2),   // day2: -2
  ];
  const tl = reconstructTimeline(ops, 'a');
  assert.equal(tl.days, 3);
  assert.deepEqual(
    tl.curve.map((p) => [p.day, p.dayRealized, p.cumRealized]),
    [
      ['2026-01-01', -10, -10],
      ['2026-01-02', 7, -3],
      ['2026-01-03', -2, -5],
    ],
  );
  assert.equal(tl.finalCumRealized, -5);
});

// --- skipping malformed ops -------------------------------------------------

test('skips ops lacking symbol or quantityHive (and non-market ops)', () => {
  const ops = [
    op('market_sell', 'GOOD', 5, D0),     // counted: +5
    op('market_sell', undefined, 9, D0),  // no symbol -> skip
    op('market_buy', 'NOQTY', 0, D0),     // quantityHive 0 -> falsy -> skip
    op('market_buy', 'NOQTY2', undefined, D0), // missing quantityHive -> skip
    op('transfer', 'GOOD', 100, D0),      // not a market op -> skip
  ];
  const tl = reconstructTimeline(ops, 'a');
  // Only the single good sell contributes.
  assert.equal(tl.curve.length, 1);
  assert.equal(tl.curve[0].dayRealized, 5);
  assert.equal(tl.curve[0].buys, 0);
  assert.equal(tl.curve[0].sells, 1);
  // only one token tracked
  assert.equal(tl.tokens.length, 1);
  assert.equal(tl.tokens[0].symbol, 'GOOD');
});

test('reads nested op.data {symbol, quantityHive} and quantityHIVE alias', () => {
  const ops = [
    { operation: 'market_sell', timestamp: D0, data: { symbol: 'NEST', quantityHive: 7 } },
    { operation: 'market_buy', timestamp: D0, symbol: 'CASE', quantityHIVE: 2 },
  ];
  const tl = reconstructTimeline(ops, 'a');
  // NEST sell +7, CASE buy -2 -> day net +5
  assert.equal(tl.curve[0].dayRealized, 5);
  const syms = tl.tokens.map((t) => t.symbol).sort();
  assert.deepEqual(syms, ['CASE', 'NEST']);
});

// --- per-token windows ------------------------------------------------------

test('derives per-token net/buys/sells/first/last windows', () => {
  const ops = [
    op('market_buy', 'LTC', 10, D0),   // LTC -10
    op('market_sell', 'LTC', 4, D2),   // LTC +4  -> net -6
    op('market_sell', 'BTC', 8, D1),   // BTC +8
  ];
  const tl = reconstructTimeline(ops, 'a');
  const ltc = tl.tokens.find((t) => t.symbol === 'LTC');
  const btc = tl.tokens.find((t) => t.symbol === 'BTC');

  assert.equal(ltc.net, -6);
  assert.equal(ltc.buys, 1);
  assert.equal(ltc.sells, 1);
  assert.equal(ltc.first, '2026-01-01'); // first op day
  assert.equal(ltc.last, '2026-01-03');  // last op day

  assert.equal(btc.net, 8);
  assert.equal(btc.buys, 0);
  assert.equal(btc.sells, 1);
  assert.equal(btc.first, '2026-01-02');
  assert.equal(btc.last, '2026-01-02');

  // tokens sorted by net ascending (losers first)
  assert.deepEqual(tl.tokens.map((t) => t.symbol), ['LTC', 'BTC']);
});

// --- worst / best days ------------------------------------------------------

test('picks worstDays (most negative) and bestDays (most positive)', () => {
  const ops = [
    op('market_buy', 'T', 100, D0),   // day0: -100  (worst)
    op('market_sell', 'T', 50, D1),   // day1: +50   (best)
    op('market_buy', 'T', 5, D2),     // day2: -5
  ];
  const tl = reconstructTimeline(ops, 'a');
  // worst = ascending by dayRealized, top 3
  assert.equal(tl.worstDays[0].day, '2026-01-01');
  assert.equal(tl.worstDays[0].dayRealized, -100);
  // best = descending by dayRealized, top 3
  assert.equal(tl.bestDays[0].day, '2026-01-02');
  assert.equal(tl.bestDays[0].dayRealized, 50);
});

// --- arb soft-fail ----------------------------------------------------------

test('arb-read soft-fails to null when ARB_HISTORY_FILE is missing', () => {
  const tl = reconstructTimeline([op('market_sell', 'X', 1, D0)], 'a');
  assert.equal(tl.arb, null);
});

// --- empty input ------------------------------------------------------------

test('empty ops yields an empty, non-throwing timeline', () => {
  const tl = reconstructTimeline([], 'a');
  assert.equal(tl.ops, 0);
  assert.equal(tl.days, 0);
  assert.equal(tl.finalCumRealized, 0);
  assert.deepEqual(tl.curve, []);
  assert.deepEqual(tl.tokens, []);
  assert.deepEqual(tl.worstDays, []);
  assert.deepEqual(tl.bestDays, []);
  assert.equal(tl.arb, null);
});
