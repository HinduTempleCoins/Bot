// reaper.test.mjs — OFFLINE tests for the resting-order reaper. Everything injected: fake open
// orders, fake books, fake cancel, fake mode. NO network, NO key, nothing broadcasts.
//
// The fixtures are the REAL @angelicalist book as read on 2026-09-16, so these tests fail if the
// classifier ever stops recognising the exact orders that motivated this module.
//
//   node --test integrations/angelicalist/reaper.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, plan, reap, report } from './reaper.mjs';

const HOUR = 3.6e6;
const NOW = Date.parse('2026-09-16T10:00:00Z');
const tsOf = (iso) => Math.floor(Date.parse(iso) / 1000);

// the real resting orders (subset), with the real top bid on each book that day.
const REAL = [
  { id: 1, side: 'SELL', symbol: 'PAY', quantity: 0.01470648, price: 0.11206857, top: 0.00000225, placed: '2026-09-10T21:53:00Z' },
  { id: 2, side: 'SELL', symbol: 'VYB', quantity: 0.01097322, price: 0.00303, top: 0.00098001, placed: '2026-09-15T14:09:03Z' },
  { id: 3, side: 'SELL', symbol: 'CTP', quantity: 3.792, price: 0.1009995, top: 0.00004001, placed: '2026-09-11T14:25:00Z' },
  { id: 4, side: 'SELL', symbol: 'BBH', quantity: 16338.3, price: 0.00383796, top: 0.00340001, placed: '2026-09-08T09:36:57Z' },
];

const deps = {
  account: 'angelicalist',
  now: NOW,
  getOpenOrders: async () => REAL.map((o) => ({ id: o.id, txId: `tx${o.id}`, side: o.side, symbol: o.symbol, quantity: o.quantity, price: o.price, timestamp: tsOf(o.placed) })),
  getBidDepth: async (sym) => { const r = REAL.find((x) => x.symbol === sym); return { qty: 1e6, hive: 1, levels: 5, topPrice: r ? r.top : 0 }; },
  getAskDepth: async () => ({ qty: 0, hive: 0, levels: 0, topPrice: 0 }),
};

// ── classify (pure) ──────────────────────────────────────────────────────────────────────────────

test('classify: a sell far above the top bid is unfillable', () => {
  const v = classify({ side: 'SELL', symbol: 'PAY', price: 0.11206857, timestamp: tsOf('2026-09-10T21:53:00Z') }, { topPrice: 0.00000225 }, NOW);
  assert.equal(v.keep, false);
  assert.match(v.reason, /unfillable/);
  assert.ok(v.ratio > 49000, 'ratio reflects how absurd the price was');
});

test('classify: a sell just over the bid is still unfillable once it has gone stale', () => {
  // BBH at 1.13x the bid is inside no sane fill range, and it has rested 8 days.
  const v = classify({ side: 'SELL', symbol: 'BBH', price: 0.00383796, timestamp: tsOf('2026-09-08T09:36:57Z') }, { topPrice: 0.00340001 }, NOW);
  assert.equal(v.keep, false);
});

test('classify: a fresh sell within reach of the book is KEPT', () => {
  const v = classify({ side: 'SELL', symbol: 'X', price: 1.01, timestamp: Math.floor((NOW - HOUR) / 1000) }, { topPrice: 1.0 }, NOW);
  assert.equal(v.keep, true, '1.01x and one hour old is a live quote, not furniture');
});

test('classify: a quote within reach but rested past the stale window is reaped', () => {
  const v = classify({ side: 'SELL', symbol: 'X', price: 1.01, timestamp: Math.floor((NOW - 48 * HOUR) / 1000) }, { topPrice: 1.0 }, NOW);
  assert.equal(v.keep, false);
  assert.match(v.reason, /rested 48\.0h/);
});

test('classify: no opposing book at all means nothing can ever fill it', () => {
  const v = classify({ side: 'SELL', symbol: 'X', price: 1, timestamp: tsOf('2026-09-15T00:00:00Z') }, { topPrice: 0 }, NOW);
  assert.equal(v.keep, false);
  assert.match(v.reason, /nothing can ever fill/);
});

test('classify: a BUY is judged against the best ask, not the best bid', () => {
  const v = classify({ side: 'BUY', symbol: 'X', price: 0.001, timestamp: Math.floor((NOW - HOUR) / 1000) }, { topPrice: 0.5 }, NOW);
  assert.equal(v.keep, false, 'a bid 500x below the ask cannot fill');
});

// ── plan (read-only) ─────────────────────────────────────────────────────────────────────────────

test('plan: flags every real 2026-09-16 order as unfillable and never broadcasts', async () => {
  const p = await plan(deps);
  assert.equal(p.openOrders, 4);
  assert.equal(p.summary.toCancel, 4);
  assert.equal(p.summary.toKeep, 0);
  assert.ok(p.summary.lockedListedHive > p.summary.recoverableHive,
    'listed notional overstates what the tokens are really worth — that gap IS the bug');
});

test('plan: reports what cancelling actually puts back in play', async () => {
  const p = await plan(deps);
  const bbh = p.cancels.find((c) => c.symbol === 'BBH');
  // 16338.3 BBH at the real top bid 0.00340001, not at the 0.00383796 it was listed at.
  assert.ok(Math.abs(bbh.quantity * bbh.topOpposing - 55.55) < 0.5);
});

test('plan: soft-fails to an empty plan when the account cannot be read', async () => {
  const p = await plan({ ...deps, getOpenOrders: async () => { throw new Error('rpc down'); } });
  assert.equal(p.openOrders, 0);
  assert.equal(p.cancels.length, 0);
});

test('plan: one book read per symbol+side, not one per order', async () => {
  let reads = 0;
  await plan({ ...deps, getOpenOrders: async () => [
    { id: 1, side: 'SELL', symbol: 'VYB', quantity: 1, price: 0.003, timestamp: tsOf('2026-09-15T00:00:00Z') },
    { id: 2, side: 'SELL', symbol: 'VYB', quantity: 1, price: 0.003, timestamp: tsOf('2026-09-15T00:00:00Z') },
    { id: 3, side: 'SELL', symbol: 'VYB', quantity: 1, price: 0.003, timestamp: tsOf('2026-09-15T00:00:00Z') },
  ], getBidDepth: async () => { reads += 1; return { qty: 10, hive: 1, levels: 1, topPrice: 0.00098001 }; } });
  assert.equal(reads, 1);
});

// ── reap (double-gated) ──────────────────────────────────────────────────────────────────────────

test('reap: DRY-RUN by default — returns intents and never calls cancel', async () => {
  let called = 0;
  const r = await reap({ ...deps, doCancel: async () => { called += 1; return { txId: 'x' }; }, getMode: () => ({ live: true, account: 'angelicalist' }), spacingMs: 0 });
  assert.equal(called, 0, 'execute defaults to false — nothing is cancelled');
  assert.equal(r.armed, false);
  assert.ok(r.results.every((x) => x.result.intent === true));
});

test('reap: --execute alone is NOT enough — the trader live gate must also be open', async () => {
  let called = 0;
  const r = await reap({ ...deps, execute: true, doCancel: async () => { called += 1; return { txId: 'x' }; }, getMode: () => ({ live: false, account: 'angelicalist' }), spacingMs: 0 });
  assert.equal(called, 0, 'no key / not live → still only intents');
  assert.equal(r.armed, false);
});

test('reap: with BOTH gates open it cancels by HE numeric order id', async () => {
  const seen = [];
  const r = await reap({ ...deps, execute: true, doCancel: async (a) => { seen.push(a); return { simulated: false, txId: `tx-${a.orderId}` }; }, getMode: () => ({ live: true, account: 'angelicalist' }), spacingMs: 0 });
  assert.equal(r.armed, true);
  assert.equal(seen.length, 4);
  assert.deepEqual(seen.map((s) => s.orderId), [1, 2, 3, 4]);
  assert.ok(seen.every((s) => s.type === 'sell'), 'HE cancel needs the side as type');
});

test('reap: a cancel error does not stop the rest of the sweep', async () => {
  const r = await reap({ ...deps, execute: true, doCancel: async (a) => { if (a.orderId === 2) throw new Error('nope'); return { txId: 'ok' }; }, getMode: () => ({ live: true }), spacingMs: 0 });
  assert.equal(r.results.length, 4);
  assert.equal(r.results[1].result.error, 'nope');
});

test('report renders a dry run without claiming anything was cancelled', async () => {
  const r = await reap({ ...deps, getMode: () => ({ live: false }), spacingMs: 0 });
  const txt = report(r);
  assert.match(txt, /DRY-RUN \(no broadcast\)/);
  assert.match(txt, /WOULD CANCEL/);
  assert.doesNotMatch(txt, /CANCELLED tx/);
});
