// move-ledger.test.mjs — OFFLINE. In-memory fs + injected transfer; no chain, no keys. Soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epochNow, recordMine, readEpoch, standingFor, settleEpoch, forgetAccount, buildMovePay, settleEpochViaAttester } from './move-ledger.mjs';

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

test('forgetAccount erases a walker from every epoch (the data-deletion seam)', () => {
  const fs = memfs();
  recordMine({ account: A, weight: 30 }, { fs, file: FILE, epoch: EP });
  recordMine({ account: B, weight: 40 }, { fs, file: FILE, epoch: EP });
  recordMine({ account: A, weight: 10 }, { fs, file: FILE, epoch: EP + 1 });   // A appears in 2 epochs
  const r = forgetAccount(A, { fs, file: FILE });
  assert.equal(r.ok, true);
  assert.equal(r.removed, 2);                       // removed from both epoch buckets
  assert.equal(standingFor(A, { fs, file: FILE, epoch: EP }).accountWeight, 0);
  assert.equal(standingFor(A, { fs, file: FILE, epoch: EP + 1 }).accountWeight, 0);
  assert.equal(standingFor(B, { fs, file: FILE, epoch: EP }).accountWeight, 40); // B untouched
  // idempotent + invalid name handled
  assert.equal(forgetAccount(A, { fs, file: FILE }).removed, 0);
  assert.equal(forgetAccount('0xabc', { fs, file: FILE }).ok, false);
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

// ── HF25 attester path (buildMovePay + settleEpochViaAttester) ───────────────────────────────────────

test('buildMovePay emits integer weights, drops invalid/dust rows, sorts deterministically', () => {
  const fs = memfs();
  recordMine({ account: B, weight: 12.6 }, { fs, file: FILE, epoch: EP });   // rounds to 13
  recordMine({ account: A, weight: 30 }, { fs, file: FILE, epoch: EP });
  recordMine({ account: A, weight: 0.4 }, { fs, file: FILE, epoch: EP });    // A -> 30.4 -> rounds to 30
  const p = buildMovePay(EP, { fs, file: FILE });
  assert.deepEqual(p.pay, [[A, 30], [B, 13]]);      // sorted by account, integer weights
  assert.equal(p.totalWeight, 43);
  assert.equal(p.claims, 2);
  assert.ok(p.pay.every((row) => Number.isInteger(row[1])));
});

test('buildMovePay on an empty epoch is a safe empty payload', () => {
  const fs = memfs();
  const p = buildMovePay(EP + 500, { fs, file: FILE });
  assert.deepEqual(p.pay, []);
  assert.equal(p.totalWeight, 0);
});

test('settleEpochViaAttester broadcasts ONE move_pay and marks the epoch settled', async () => {
  const fs = memfs();
  recordMine({ account: A, weight: 30 }, { fs, file: FILE, epoch: EP });
  recordMine({ account: B, weight: 10 }, { fs, file: FILE, epoch: EP });
  const sent = [];
  const deps = { broadcastMovePay: async (m) => { sent.push(m); return { id: 'tx1' }; } };
  const r = await settleEpochViaAttester(EP, deps, { fs, file: FILE, force: true });
  assert.equal(r.ok, true);
  assert.equal(r.settled, true);
  assert.equal(r.id, 'tx1');
  assert.equal(sent.length, 1);                     // ONE op for the whole hour, not one per walker
  assert.equal(sent[0].epoch, EP);
  assert.deepEqual(sent[0].pay, [[A, 30], [B, 10]]);
  assert.equal(readEpoch(EP, { fs, file: FILE }).settled, true);
});

test('settleEpochViaAttester refuses an epoch still accruing', async () => {
  const fs = memfs();
  recordMine({ account: A, weight: 10 }, { fs, file: FILE, epoch: epochNow() });
  const r = await settleEpochViaAttester(epochNow(), { broadcastMovePay: async () => ({}) }, { fs, file: FILE });
  assert.equal(r.ok, false);
  assert.match(r.reason, /not closed/);
});

test('settleEpochViaAttester is idempotent and does not re-broadcast', async () => {
  const fs = memfs();
  recordMine({ account: A, weight: 10 }, { fs, file: FILE, epoch: EP });
  let calls = 0;
  const deps = { broadcastMovePay: async () => { calls++; return { id: 'x' }; } };
  await settleEpochViaAttester(EP, deps, { fs, file: FILE, force: true });
  const second = await settleEpochViaAttester(EP, deps, { fs, file: FILE, force: true });
  assert.equal(second.alreadySettled, true);
  assert.equal(calls, 1);                            // second run did not broadcast again
});

test('settleEpochViaAttester keeps the hour OPEN on a broadcast failure (retry-safe), never throws', async () => {
  const fs = memfs();
  recordMine({ account: A, weight: 10 }, { fs, file: FILE, epoch: EP });
  const deps = { broadcastMovePay: async () => { throw new Error('rpc down'); } };
  const r = await settleEpochViaAttester(EP, deps, { fs, file: FILE, force: true });
  assert.equal(r.ok, false);
  assert.equal(r.settled, false);
  assert.match(r.errors[0], /rpc down/);
  assert.equal(readEpoch(EP, { fs, file: FILE }).settled, false);   // safe to retry
});

test('settleEpochViaAttester treats a chain "already settled" as done (idempotent across a restart)', async () => {
  const fs = memfs();
  recordMine({ account: A, weight: 10 }, { fs, file: FILE, epoch: EP });
  const deps = { broadcastMovePay: async () => { throw new Error('move epoch 1000 already settled (last 1000)'); } };
  const r = await settleEpochViaAttester(EP, deps, { fs, file: FILE, force: true });
  assert.equal(r.ok, true);
  assert.equal(r.settled, true);
  assert.equal(r.alreadySettled, true);
});

test('settleEpochViaAttester with no walkers marks settled without broadcasting', async () => {
  const fs = memfs();
  let calls = 0;
  const r = await settleEpochViaAttester(EP, { broadcastMovePay: async () => { calls++; return {}; } }, { fs, file: FILE, force: true });
  assert.equal(r.ok, true);
  assert.equal(r.settled, true);
  assert.equal(calls, 0);
});
