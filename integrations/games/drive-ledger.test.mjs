// drive-ledger.test.mjs — OFFLINE. In-memory fs + injected broadcast; no chain, no keys. Soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordDrive, driverStanding, readDriveEpoch, previewDriveSettlement, buildDrivePay,
  settleDriveEpoch, forgetDriver, epochNow,
} from './drive-ledger.mjs';

function memfs() {
  let blob = null;
  return { read: () => blob, write: (_p, s) => { blob = s; }, _dump: () => blob };
}
const A = 'alice-driver', B = 'bob-driver';
const FILE = './.drive-ledger-test.json';   // never written: memfs ignores the path
const EP = 2000;
const BUDGET = 90;                          // easy share math

test('recordDrive rejects bad names, walking speeds and impossible speeds', () => {
  const fs = memfs();
  assert.equal(recordDrive({ account: '0xabc', miles: 10, seconds: 900 }, { fs, file: FILE, epoch: EP }).ok, false);
  const walk = recordDrive({ account: A, miles: 1, seconds: 1800 }, { fs, file: FILE, epoch: EP });
  assert.equal(walk.ok, false); assert.equal(walk.lane, 'walk');
  const fly = recordDrive({ account: A, miles: 300, seconds: 900 }, { fs, file: FILE, epoch: EP });
  assert.equal(fly.ok, false); assert.equal(fly.lane, 'rejected');
  assert.equal(fs._dump(), null, 'nothing rejected was ever written');
});

test('recordDrive accumulates weight + miles across samples in the hour', () => {
  const fs = memfs();
  const r1 = recordDrive({ account: A, miles: 12, seconds: 1200 }, { fs, file: FILE, epoch: EP, budget: BUDGET });
  assert.equal(r1.ok, true);
  assert.equal(r1.lane, 'drive');
  assert.equal(r1.milesCounted, 12);
  assert.equal(r1.projectedMelek, 90, 'sole driver takes the whole lane');
  const r2 = recordDrive({ account: A, miles: 8, seconds: 800 }, { fs, file: FILE, epoch: EP, budget: BUDGET });
  assert.equal(r2.milesThisHour, 20);
  assert.ok(r2.accountWeight > r1.accountWeight);
  assert.equal(r2.sampleIndex, 1, 'second sample diminishes');
});

test('the hourly mile cap stops a spoofed 1,000-mile hour', () => {
  const fs = memfs();
  // 95 mph for an hour is the ceiling; claim it in two legal-speed samples, then try for more
  recordDrive({ account: A, miles: 90, seconds: 3600 }, { fs, file: FILE, epoch: EP });
  const over = recordDrive({ account: A, miles: 90, seconds: 3600 }, { fs, file: FILE, epoch: EP });
  assert.equal(over.ok, true);
  assert.equal(over.milesThisHour, 95, 'capped at the hourly ceiling');
  assert.equal(over.milesDropped, 85);
  const again = recordDrive({ account: A, miles: 50, seconds: 3600 }, { fs, file: FILE, epoch: EP });
  assert.equal(again.ok, false);
  assert.match(again.reason, /mile cap/);
});

test('two drivers split the lane in proportion to drive-weight', () => {
  const fs = memfs();
  recordDrive({ account: A, miles: 30, seconds: 1800 }, { fs, file: FILE, epoch: EP, budget: BUDGET });
  recordDrive({ account: B, miles: 10, seconds: 600 }, { fs, file: FILE, epoch: EP, budget: BUDGET });
  const sa = driverStanding(A, { fs, file: FILE, epoch: EP, budget: BUDGET });
  const sb = driverStanding(B, { fs, file: FILE, epoch: EP, budget: BUDGET });
  assert.equal(sa.drivers, 2);
  assert.ok(sa.projectedMelek > sb.projectedMelek);
  assert.ok(Math.abs(sa.projectedMelek + sb.projectedMelek - BUDGET) < 0.01, 'the two shares are the whole lane');
  assert.equal(sa.gas.usd, null, 'no MELEK price, so no dollar figure is invented');
});

test('buildDrivePay emits sorted integer weights the chain can read', () => {
  const fs = memfs();
  recordDrive({ account: B, miles: 10, seconds: 600 }, { fs, file: FILE, epoch: EP });
  recordDrive({ account: A, miles: 10, seconds: 600 }, { fs, file: FILE, epoch: EP });
  const { pay, claims, totalWeight } = buildDrivePay(EP, { fs, file: FILE });
  assert.equal(claims, 2);
  assert.deepEqual(pay.map((r) => r[0]), [A, B], 'deterministic order');
  assert.ok(pay.every(([, w]) => Number.isInteger(w) && w > 0));
  assert.equal(totalWeight, pay[0][1] + pay[1][1]);
});

test('settleDriveEpoch broadcasts ONE drive_pay and is idempotent', async () => {
  const fs = memfs();
  recordDrive({ account: A, miles: 20, seconds: 1200 }, { fs, file: FILE, epoch: EP });
  const sent = [];
  const deps = { broadcastDrivePay: async (p) => { sent.push(p); return { id: 'trx1' }; } };

  const future = epochNow() + 10;
  recordDrive({ account: A, miles: 20, seconds: 1200 }, { fs, file: FILE, epoch: future });
  const open = await settleDriveEpoch(future, deps, { fs, file: FILE });
  assert.equal(open.ok, false, 'an hour that has not closed is never settled');
  assert.match(open.reason, /not closed yet/);

  const r = await settleDriveEpoch(EP, deps, { fs, file: FILE, force: true });
  assert.equal(r.ok, true); assert.equal(r.settled, true); assert.equal(r.id, 'trx1');
  assert.equal(sent.length, 1, 'one op for the whole hour');
  assert.equal(sent[0].epoch, EP);

  const again = await settleDriveEpoch(EP, deps, { fs, file: FILE, force: true });
  assert.equal(again.alreadySettled, true);
  assert.equal(sent.length, 1, 'no second broadcast');
});

test('a failed broadcast leaves the hour OPEN for a retry; "already settled" closes it', async () => {
  const fs = memfs();
  recordDrive({ account: A, miles: 20, seconds: 1200 }, { fs, file: FILE, epoch: EP });
  const bad = await settleDriveEpoch(EP, { broadcastDrivePay: async () => { throw new Error('rpc down'); } }, { fs, file: FILE, force: true });
  assert.equal(bad.ok, false); assert.equal(bad.settled, false);
  assert.match(bad.errors[0], /rpc down/);
  const chainAhead = await settleDriveEpoch(EP, { broadcastDrivePay: async () => { throw new Error('drive epoch 2000 already settled (last 2000)'); } }, { fs, file: FILE, force: true });
  assert.equal(chainAhead.ok, true); assert.equal(chainAhead.settled, true);
});

test('no broadcast dep = no settlement claimed', async () => {
  const fs = memfs();
  recordDrive({ account: A, miles: 20, seconds: 1200 }, { fs, file: FILE, epoch: EP });
  const r = await settleDriveEpoch(EP, {}, { fs, file: FILE, force: true });
  assert.equal(r.ok, false); assert.equal(r.settled, false);
  assert.match(r.errors[0], /no broadcastDrivePay dep/);
});

test('recordDrive refuses to add to a settled hour', async () => {
  const fs = memfs();
  recordDrive({ account: A, miles: 20, seconds: 1200 }, { fs, file: FILE, epoch: EP });
  await settleDriveEpoch(EP, { broadcastDrivePay: async () => ({ id: 'x' }) }, { fs, file: FILE, force: true });
  const late = recordDrive({ account: B, miles: 20, seconds: 1200 }, { fs, file: FILE, epoch: EP });
  assert.equal(late.ok, false);
  assert.match(late.reason, /already settled/);
});

test('forgetDriver erases a driver from every hour (the data-deletion seam)', () => {
  const fs = memfs();
  recordDrive({ account: A, miles: 10, seconds: 600 }, { fs, file: FILE, epoch: EP });
  recordDrive({ account: A, miles: 10, seconds: 600 }, { fs, file: FILE, epoch: EP + 1 });
  recordDrive({ account: B, miles: 10, seconds: 600 }, { fs, file: FILE, epoch: EP });
  const r = forgetDriver(A, { fs, file: FILE });
  assert.equal(r.removed, 2);
  assert.equal(readDriveEpoch(EP, { fs, file: FILE }).claims.length, 1);
  assert.equal(forgetDriver('0xnope', { fs, file: FILE }).ok, false);
});

test('previewDriveSettlement never pays out more than the lane holds', () => {
  const fs = memfs();
  recordDrive({ account: A, miles: 30, seconds: 1800 }, { fs, file: FILE, epoch: EP });
  recordDrive({ account: B, miles: 15, seconds: 900 }, { fs, file: FILE, epoch: EP });
  const { budget, payouts } = previewDriveSettlement(EP, { fs, file: FILE, budget: BUDGET });
  const total = payouts.reduce((s, p) => s + p.amount, 0);
  assert.ok(total <= budget + 1e-9);
});

test('epochNow is the hour bucket both lanes share', () => {
  assert.equal(epochNow(3600_000), 1);
  assert.equal(epochNow(7199_000), 1);
  assert.equal(epochNow(7200_000), 2);
});
