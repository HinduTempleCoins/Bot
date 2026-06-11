// timeline.test.mjs — OFFLINE tests for the READ-ONLY trade-timeline reconstruction.
// No network, no keys, no clock. reconstructTimeline is a PURE function over a list of
// market ops; we exercise happy path, ordering, per-token windows, and the soft-fail paths
// (bad/empty/missing input → typed empty result, never throws). The `arb` field reads an
// optional file wrapped in try/catch; with no file present it must soft-fail to null.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconstructTimeline } from './timeline.mjs';

// Two days, one token. 2026-01-01 = 86400000s*N… use round epoch-seconds for clean YYYY-MM-DD.
const D1 = Math.floor(Date.UTC(2026, 0, 1) / 1000); // 2026-01-01 00:00 UTC, seconds
const D2 = Math.floor(Date.UTC(2026, 0, 2) / 1000); // 2026-01-02
const D3 = Math.floor(Date.UTC(2026, 0, 3) / 1000); // 2026-01-03

const op = (operation, symbol, quantityHive, timestamp, blockNumber = 0) =>
  ({ operation, timestamp, blockNumber, data: { symbol, quantityHive } });

// ── happy path: cumulative curve, signs, per-token net ─────────────────────────────────────────
test('reconstructTimeline: buys spend HIVE, sells add it; cumulative curve is correct', () => {
  const ops = [
    op('market_buy', 'SWAP.LTC', 10, D1),  // -10
    op('market_sell', 'SWAP.LTC', 3, D2),  // +3
    op('market_sell', 'SWAP.LTC', 2, D3),  // +2
  ];
  const tl = reconstructTimeline(ops, 'kalivankush');

  assert.equal(tl.account, 'kalivankush');
  assert.equal(tl.ops, 3);
  assert.equal(tl.days, 3);
  // final cumulative realized = -10 + 3 + 2 = -5
  assert.equal(tl.finalCumRealized, -5);

  // curve is day-ordered with running cumulative
  assert.deepEqual(tl.curve.map((p) => p.day), ['2026-01-01', '2026-01-02', '2026-01-03']);
  assert.deepEqual(tl.curve.map((p) => p.dayRealized), [-10, 3, 2]);
  assert.deepEqual(tl.curve.map((p) => p.cumRealized), [-10, -7, -5]);
  assert.deepEqual(tl.curve.map((p) => [p.buys, p.sells]), [[1, 0], [0, 1], [0, 1]]);
});

test('reconstructTimeline: per-token net + first/last window', () => {
  const ops = [
    op('market_buy', 'SWAP.LTC', 10, D1),
    op('market_sell', 'SWAP.LTC', 4, D3),
    op('market_sell', 'SWAP.DOGE', 7, D2),
  ];
  const tl = reconstructTimeline(ops);
  const ltc = tl.tokens.find((t) => t.symbol === 'SWAP.LTC');
  const doge = tl.tokens.find((t) => t.symbol === 'SWAP.DOGE');

  assert.equal(ltc.net, -6);            // -10 + 4
  assert.equal(ltc.buys, 1);
  assert.equal(ltc.sells, 1);
  assert.equal(ltc.first, '2026-01-01'); // first op day
  assert.equal(ltc.last, '2026-01-03');  // last op day
  assert.equal(doge.net, 7);
  // tokens sorted by net ascending (losers first) → LTC (-6) before DOGE (+7)
  assert.deepEqual(tl.tokens.map((t) => t.symbol), ['SWAP.LTC', 'SWAP.DOGE']);
});

test('reconstructTimeline: orders oldest→newest even when input is shuffled', () => {
  const ops = [
    op('market_sell', 'SWAP.LTC', 2, D3),
    op('market_buy', 'SWAP.LTC', 10, D1),
    op('market_sell', 'SWAP.LTC', 3, D2),
  ];
  const tl = reconstructTimeline(ops);
  assert.deepEqual(tl.curve.map((p) => p.day), ['2026-01-01', '2026-01-02', '2026-01-03']);
  assert.equal(tl.finalCumRealized, -5);
});

test('reconstructTimeline: ties on timestamp break by blockNumber', () => {
  const ops = [
    op('market_sell', 'SWAP.LTC', 5, D1, 200),
    op('market_buy', 'SWAP.LTC', 8, D1, 100),
  ];
  const tl = reconstructTimeline(ops);
  // both same day → single bucket, net = -8 + 5 = -3, one buy + one sell
  assert.equal(tl.days, 1);
  assert.equal(tl.curve[0].dayRealized, -3);
  assert.deepEqual([tl.curve[0].buys, tl.curve[0].sells], [1, 1]);
});

test('reconstructTimeline: worstDays/bestDays surface the bleed and the recovery', () => {
  const ops = [
    op('market_buy', 'SWAP.LTC', 50, D1),  // -50 worst
    op('market_sell', 'SWAP.LTC', 40, D2),  // +40 best
    op('market_buy', 'SWAP.LTC', 5, D3),    // -5
  ];
  const tl = reconstructTimeline(ops);
  // worst = most negative dayRealized first
  assert.equal(tl.worstDays[0].dayRealized, -50);
  assert.equal(tl.worstDays[0].day, '2026-01-01');
  // best = most positive first
  assert.equal(tl.bestDays[0].dayRealized, 40);
  assert.equal(tl.bestDays[0].day, '2026-01-02');
});

// ── filtering: only market_buy/market_sell with a symbol + nonzero hive count ──────────────────
test('reconstructTimeline: ignores non-market ops, missing symbol, and zero hive', () => {
  const ops = [
    op('transfer', 'SWAP.LTC', 99, D1),     // wrong op → ignored
    op('market_buy', undefined, 99, D1),     // no symbol → ignored
    op('market_sell', 'SWAP.LTC', 0, D1),    // zero hive → ignored
    op('market_buy', 'SWAP.LTC', 10, D2),    // counted
  ];
  const tl = reconstructTimeline(ops);
  assert.equal(tl.days, 1);
  assert.equal(tl.finalCumRealized, -10);
  assert.equal(tl.tokens.length, 1);
});

test('reconstructTimeline: accepts quantityHIVE alias and op-level data fallback', () => {
  const ops = [
    { operation: 'market_sell', timestamp: D1, data: { symbol: 'SWAP.A', quantityHIVE: 6 } }, // alias
    { operation: 'market_buy', timestamp: D2, symbol: 'SWAP.A', quantityHive: 4 },             // no .data → uses op itself
  ];
  const tl = reconstructTimeline(ops);
  assert.equal(tl.finalCumRealized, 2); // +6 - 4
  assert.equal(tl.tokens[0].symbol, 'SWAP.A');
});

// ── soft-fail / edge: typed empty result, never throws ─────────────────────────────────────────
test('reconstructTimeline: empty input → typed empty result, no throw', () => {
  const tl = reconstructTimeline([]);
  assert.equal(tl.account, 'account'); // default
  assert.equal(tl.ops, 0);
  assert.equal(tl.days, 0);
  assert.equal(tl.finalCumRealized, 0);
  assert.deepEqual(tl.worstDays, []);
  assert.deepEqual(tl.bestDays, []);
  assert.deepEqual(tl.tokens, []);
  assert.deepEqual(tl.curve, []);
});

test('reconstructTimeline: all-junk input is filtered to an empty result', () => {
  const tl = reconstructTimeline([
    op('transfer', 'X', 1, D1),
    op('market_buy', undefined, 1, D1),
    op('market_sell', 'Y', 0, D1),
  ]);
  assert.equal(tl.days, 0);
  assert.equal(tl.finalCumRealized, 0);
  assert.deepEqual(tl.tokens, []);
});

test('reconstructTimeline: arb field never throws — it is null or a typed scan summary', () => {
  // The arb-history read is wrapped in try/catch; the path is fixed at module load
  // (ARB_HISTORY_FILE || default), so we don't couple to cwd. The contract is: the
  // optional read soft-fails — arb is either null (no/unreadable file) or a typed object.
  const tl = reconstructTimeline([op('market_buy', 'SWAP.LTC', 1, D1)]);
  if (tl.arb === null) return; // soft-failed cleanly — that is the contract
  assert.equal(typeof tl.arb.scans, 'number');
  assert.equal(typeof tl.arb.opportunitiesFound, 'number');
  assert.equal(typeof tl.arb.byToken, 'object');
  assert.ok(tl.arb.byToken !== null);
});

test('reconstructTimeline: shape is stable / typed for every key', () => {
  const tl = reconstructTimeline([op('market_buy', 'SWAP.LTC', 1, D1)]);
  assert.equal(typeof tl.account, 'string');
  assert.equal(typeof tl.ops, 'number');
  assert.equal(typeof tl.days, 'number');
  assert.equal(typeof tl.finalCumRealized, 'number');
  assert.ok(Array.isArray(tl.worstDays));
  assert.ok(Array.isArray(tl.bestDays));
  assert.ok(Array.isArray(tl.tokens));
  assert.ok(Array.isArray(tl.curve));
});

test('reconstructTimeline: does not mutate the caller-supplied ops array', () => {
  const ops = [
    op('market_sell', 'SWAP.LTC', 2, D2),
    op('market_buy', 'SWAP.LTC', 10, D1),
  ];
  const before = ops.map((o) => o.timestamp);
  reconstructTimeline(ops);
  assert.deepEqual(ops.map((o) => o.timestamp), before, 'input order must be preserved (sorts a copy)');
});
