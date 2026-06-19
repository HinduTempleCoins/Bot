// move-ledger.test.mjs — OFFLINE. In-memory fs + injected transfer; no chain, no keys. Soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epochNow, recordMine, readEpoch, standingFor, settleEpoch } from './move-ledger.mjs';

// in-memory fs store shared across a test
function memfs() {
  let blob = null;
  return { read: () => blob, write: (_p, s) => { blob = s; }, _dump: () => blob };
}
const A = 'alice-walker', B = 'bob-walker';
const FILE = '/tmp/x-move-ledger.json';
const EP = 1000;            // fixed epoch for determinism
const BUDGET = 100;         // 100 MELEK pool for easy share math

test('recordMine rejects non-MELEK names and bad weights', () => {
  const fs = memfs();
  assert.equal(recordMine({ account: '0xabc', weight: 5 }, { fs, file: FILE, epoch: EP }).ok, false);
  assert.equal(recordMine({ account: A, weight: 0 }, { fs, file: FILE, epoch: EP }).ok, false);
  assert.equal(recordMine({ account: A, weight: -3 }, { fs, file: FILE, epoch: EP }).ok, false);
});

test('recordMine accumulates weight and reports a projected MELEK slice', () => {
  const fs = memfs();
  const r1 = recordMine({ account: A, weight: 30 }, { fs, file: FILE, epoch: EP, budget: BUDGET });
  assert.equal(r1.ok, true);
  assert.equal(r1.accountWeight, 30);
  assert.equal(r1.projectedMelek, 100);            // sole walker → whole pool
  const r2 = recordMine({ account: A, weight: 10 }, { fs, file: FILE, epoch: EP, budget: BUDGET });
  assert.equal(r2.accountWeight, 40);              // accumulates within the hour
  const r3 = recordMine({ account: B, weight: 40 }, { fs, file: FILE, epoch: EP, budget: BUDGET });
  assert.equal(r3.totalWeight, 80);
  assert.equal(r3.miners, 2);
  assert.equal(r3.projectedMelek, 50);            // B has 40/80 → half the pool
});

test('standingFor reads without recording', () => {
  const fs = memfs();
  recordMine({ account: A, weight: 25 }, { fs, file: FILE, epoch: EP, budget: BUDGET });
  const s = standingFor(A, { fs, file: FILE, epoch: EP, budget: BUDGET });
  assert.equal(s.accountWeight, 25);
  assert.equal(s.projectedMelek, 100);
  const empty = standingFor(A, { fs, file: FILE, epoch: EP + 999, budget: BUDGET });
  assert.equal(empty.accountWeight, 0);            // a fresh epoch is empty, not an error
  assert.equal(empty.ok, true);
});

test('settleEpoch refuses an epoch that is still accruing', async () => {
  const fs = memfs();
  recordMine({ account: A, weight: 10 }, { fs, file: FILE, epoch: epochNow(), budget: BUDGET });
  const r = await settleEpoch(epochNow(), { transfer: async () => ({ id: 'x' }) }, { fs, file: FILE, budget: BUDGET });
  assert.equal(r.ok, false);
  assert.match(r.reason, /not closed/);
});

test('settleEpoch splits the budget by weight and pays each walker in MELEK', async () => {
  const fs = memfs();
  recordMine({ account: A, weight: 30 }, { fs, file: FILE, epoch: EP, budget: BUDGET });
  recordMine({ account: B, weight: 10 }, { fs, file: FILE, epoch: EP, budget: BUDGET });
  const sent = [];
  const deps = { transfer: async (t) => { sent.push(t); return { id: 'tx-' + t.to }; } };
  const r = await settleEpoch(EP, deps, { fs, file: FILE, budget: BUDGET, force: true });
  assert.equal(r.ok, true);
  assert.equal(r.settled, true);
  assert.equal(sent.length, 2);
  const toA = sent.find((t) => t.to === A), toB = sent.find((t) => t.to === B);
  assert.equal(toA.amount, '75.000 TESTS');        // 30/40 of 100
  assert.equal(toB.amount, '25.000 TESTS');        // 10/40 of 100
  assert.match(toA.memo, /Move reward/);
  assert.equal(toA.from, 'hathor');
});

test('settleEpoch is idempotent — a settled epoch does not pay twice', async () => {
  const fs = memfs();
  recordMine({ account: A, weight: 10 }, { fs, file: FILE, epoch: EP, budget: BUDGET });
  const deps = { transfer: async () => ({ id: 'x' }) };
  const first = await settleEpoch(EP, deps, { fs, file: FILE, budget: BUDGET, force: true });
  assert.equal(first.settled, true);
  let calls = 0;
  const second = await settleEpoch(EP, { transfer: async () => { calls++; return {}; } }, { fs, file: FILE, budget: BUDGET, force: true });
  assert.equal(second.alreadySettled, true);
  assert.equal(calls, 0);
});

test('settleEpoch keeps the epoch OPEN if a transfer fails (retry-safe), and never throws', async () => {
  const fs = memfs();
  recordMine({ account: A, weight: 30 }, { fs, file: FILE, epoch: EP, budget: BUDGET });
  recordMine({ account: B, weight: 10 }, { fs, file: FILE, epoch: EP, budget: BUDGET });
  const deps = { transfer: async (t) => { if (t.to === B) throw new Error('node down'); return { id: 'ok' }; } };
  const r = await settleEpoch(EP, deps, { fs, file: FILE, budget: BUDGET, force: true });
  assert.equal(r.ok, false);
  assert.equal(r.settled, false);                  // not marked settled → safe to retry
  assert.equal(r.paid.length, 1);
  assert.equal(r.errors.length, 1);
  assert.equal(readEpoch(EP, { fs, file: FILE }).settled, false);
});

test('settleEpoch with no activity is a clean no-op', async () => {
  const fs = memfs();
  const r = await settleEpoch(EP, { transfer: async () => ({}) }, { fs, file: FILE, budget: BUDGET, force: true });
  assert.equal(r.ok, true);
  assert.equal(r.paid.length, 0);
});
