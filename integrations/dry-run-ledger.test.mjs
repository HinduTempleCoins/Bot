// dry-run-ledger.test.mjs — offline tests for the intended-trade (never-executed) ledger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLedger, record, entries, totals, bySymbol,
  wouldExceedBudget, reset, renderReport, esc,
} from './dry-run-ledger.mjs';

const DAY0 = Date.parse('2026-06-11T09:00:00Z');
const DAY1 = Date.parse('2026-06-12T09:00:00Z');

test('record buy and sell, marks dryRun + computes hive', () => {
  const led = createLedger();
  const buy = record(led, { ts: DAY0, symbol: 'SWAP.DOGE', side: 'buy', price: 0.04, amount: 1000, note: 'in' });
  assert.equal(buy.dryRun, true);
  assert.equal(buy.side, 'buy');
  assert.equal(buy.hive, 0.04 * 1000); // 40
  assert.equal(buy.note, 'in');
  const sell = record(led, { ts: DAY0, symbol: 'SWAP.DOGE', side: 'SELL', price: 0.05, amount: 600 });
  assert.equal(sell.side, 'sell'); // normalized to lowercase
  assert.equal(sell.hive, 30);
  assert.equal(entries(led).length, 2);
});

test('totals: counts and HIVE notionals + net', () => {
  const led = createLedger();
  record(led, { ts: DAY0, symbol: 'A', side: 'buy', price: 10, amount: 2 });  // 20
  record(led, { ts: DAY0, symbol: 'A', side: 'buy', price: 5, amount: 4 });   // 20
  record(led, { ts: DAY0, symbol: 'A', side: 'sell', price: 10, amount: 3 }); // 30
  const t = totals(led);
  assert.equal(t.buys.count, 2);
  assert.equal(t.buys.hive, 40);
  assert.equal(t.sells.count, 1);
  assert.equal(t.sells.hive, 30);
  assert.equal(t.netHive, 10);
});

test('bySymbol: per-symbol netting', () => {
  const led = createLedger();
  record(led, { ts: DAY0, symbol: 'DOGE', side: 'buy', price: 1, amount: 100 }); // 100
  record(led, { ts: DAY0, symbol: 'DOGE', side: 'sell', price: 1, amount: 40 }); // 40
  record(led, { ts: DAY0, symbol: 'LTC', side: 'buy', price: 60, amount: 2 });   // 120
  const b = bySymbol(led);
  assert.equal(b.DOGE.buys, 100);
  assert.equal(b.DOGE.sells, 40);
  assert.equal(b.DOGE.netHive, 60);
  assert.equal(b.LTC.buys, 120);
  assert.equal(b.LTC.sells, 0);
  assert.equal(b.LTC.netHive, 120);
});

test('wouldExceedBudget: day-bucket, sells excluded, day boundary', () => {
  const led = createLedger();
  record(led, { ts: DAY0, symbol: 'X', side: 'buy', price: 10, amount: 1 });  // day0 buy 10
  record(led, { ts: DAY0, symbol: 'X', side: 'buy', price: 10, amount: 1 });  // day0 buy 10 -> 20
  record(led, { ts: DAY0, symbol: 'X', side: 'sell', price: 100, amount: 5 }); // sells ignored
  record(led, { ts: DAY1, symbol: 'X', side: 'buy', price: 5, amount: 1 });   // day1 buy 5

  assert.equal(wouldExceedBudget(led, { dailyCapHive: 25, ts: DAY0 }), false); // 20 <= 25
  assert.equal(wouldExceedBudget(led, { dailyCapHive: 15, ts: DAY0 }), true);  // 20 > 15
  assert.equal(wouldExceedBudget(led, { dailyCapHive: 15, ts: DAY1 }), false); // only 5 on day1
  // no/invalid cap never blocks
  assert.equal(wouldExceedBudget(led, { ts: DAY0 }), false);
});

test('invalid entries are skipped (return null), never throw', () => {
  const led = createLedger();
  assert.equal(record(led, null), null);
  assert.equal(record(led, {}), null);
  assert.equal(record(led, { symbol: 'A', side: 'hold', price: 1, amount: 1 }), null); // bad side
  assert.equal(record(led, { symbol: '', side: 'buy', price: 1, amount: 1 }), null);   // no symbol
  assert.equal(record(led, { symbol: 'A', side: 'buy', price: -1, amount: 1 }), null); // bad price
  assert.equal(record(led, { symbol: 'A', side: 'buy', price: 1, amount: 0 }), null);  // amount not > 0
  assert.equal(record(led, { symbol: 'A', side: 'buy', price: 'x', amount: 1 }), null);// NaN price
  assert.equal(entries(led).length, 0);
  // a valid one still records fine afterward
  assert.ok(record(led, { symbol: 'A', side: 'buy', price: 1, amount: 1 }));
  assert.equal(entries(led).length, 1);
});

test('reset empties the ledger', () => {
  const led = createLedger();
  record(led, { ts: DAY0, symbol: 'A', side: 'buy', price: 1, amount: 1 });
  assert.equal(entries(led).length, 1);
  reset(led);
  assert.equal(entries(led).length, 0);
  assert.deepEqual(totals(led), { buys: { count: 0, hive: 0 }, sells: { count: 0, hive: 0 }, netHive: 0 });
});

test('renderReport contains the DRY RUN banner and totals', () => {
  const led = createLedger();
  record(led, { ts: DAY0, symbol: 'SWAP.DOGE', side: 'buy', price: 0.04, amount: 1000 });
  const md = renderReport(led);
  assert.match(md, /DRY RUN — no orders placed/);
  assert.match(md, /Intended trades: \*\*1\*\*/);
  assert.match(md, /SWAP\.DOGE/);
});

test('esc neutralizes html and markdown pipes', () => {
  assert.equal(esc('<b>&|'), '&lt;b&gt;&amp;\\|');
  assert.equal(esc(null), '');
});

test('soft-fail on a non-ledger argument', () => {
  assert.equal(record(null, { symbol: 'A', side: 'buy', price: 1, amount: 1 }), null);
  assert.deepEqual(entries(undefined), []);
});
