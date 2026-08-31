import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once, report, handler } from './run.mjs';
import * as ledger from './ledger.mjs';

test('once() runs the full loop staged and produces an accountability brief', async () => {
  ledger.reset();
  const out = await once({
    signals: [{ id: 's', symbol: 'SPS', side: 'buy', venue: 'hive-engine', edgePct: 5, price: 0.02, priceUsd: 0.02, depthUsd: 50, verdict: 'ACT' }],
    config: { bankrollUsd: 100 }, ingest: false, persist: false, now: Date.now(),
  });
  assert.ok(out.run.counts.staged >= 1);
  assert.equal(out.run.counts.executed, 0, 'staged — nothing broadcast');
  assert.equal(out.accountability.status, 'ZERO_REVENUE', 'staged-only = still $0 realized');
  assert.ok(/STAGED/.test(out.brief));
});

test('once() reports OK when a real round-trip is in the ledger', async () => {
  ledger.reset();
  const now = Date.now();
  ledger.record({ symbol: 'SPS', side: 'buy', qty: 100, priceUsd: 0.02, status: 'FILLED', ts: now - 2000 });
  ledger.record({ symbol: 'SPS', side: 'sell', qty: 100, priceUsd: 0.03, status: 'FILLED', ts: now - 1000 });
  const out = await once({ signals: [], ingest: false, persist: false, now });
  assert.equal(out.accountability.status, 'OK');
});

test('report() returns day + week windows and adapter status', () => {
  ledger.reset();
  const r = report();
  assert.ok(r.day.windowHours === 24 && r.week.windowHours === 168);
  assert.ok(Array.isArray(r.adapters));
});

test('handler serves GET /api/revenue and 404s elsewhere', async () => {
  ledger.reset();
  const cap = () => { let s, b; return { writeHead: (c) => { s = c; }, end: (x) => { b = x; }, get: () => ({ s, b }) }; };
  let res = cap();
  await handler({ method: 'GET', url: '/api/revenue' }, res);
  assert.equal(res.get().s, 200);
  assert.match(res.get().b, /realizedNetUsd|accountability/);
  res = cap();
  await handler({ method: 'POST', url: '/x' }, res);
  assert.equal(res.get().s, 404);
});
