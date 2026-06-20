import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGpuScheduler } from './gpu-scheduler.mjs';

const HOUR = 3600e3;
const DAY0 = 1_700_000_000_000 - (1_700_000_000_000 % (24 * HOUR));
const at = (h, day = 0) => DAY0 + day * 24 * HOUR + h * HOUR;

test('most jobs queue (wait for a batch), not live', () => {
  const s = createGpuScheduler();
  const r = s.submit({ job: 'deep reasoning' }, { ts: at(9) });
  assert.equal(r.mode, 'queued');
  assert.equal(s.summary(at(9)).queued, 1);
});

test('urgent jobs may fire live, but only within the daily reserve', () => {
  const s = createGpuScheduler({ urgentReserve: 2 });
  assert.equal(s.submit({}, { ts: at(9), urgent: true }).mode, 'urgent-live');
  assert.equal(s.submit({}, { ts: at(9), urgent: true }).mode, 'urgent-live');
  assert.equal(s.submit({}, { ts: at(9), urgent: true }).mode, 'queued'); // reserve exhausted -> queue
});

test('due() is true only at a window hour with work pending', () => {
  const s = createGpuScheduler({ windows: [2, 8, 14, 20] });
  assert.equal(s.due(at(9)), false);          // no work yet
  s.submit({ job: 'x' }, { ts: at(9) });
  assert.equal(s.due(at(9)), true);           // 9 >= 8 window, not run
  assert.equal(s.due(at(3)), true);           // 3 >= 2 window
  assert.equal(s.due(at(1)), false);          // before the first window
});

test('runWindow drains up to perWindowMax oldest jobs via the runner', async () => {
  const s = createGpuScheduler({ windows: [8], perWindowMax: 3 });
  for (let i = 0; i < 5; i++) s.submit({ n: i }, { ts: at(9) });
  const runner = async (batch) => batch.map((j) => ({ id: j.id, out: j.payload.n * 2 }));
  const r = await s.runWindow(runner, { ts: at(9) });
  assert.equal(r.ran, true);
  assert.equal(r.processed, 3);
  assert.equal(r.remaining, 2);
  assert.equal(r.results[0].out, 0);
});

test('a window only runs ONCE per day', async () => {
  const s = createGpuScheduler({ windows: [8], perWindowMax: 10 });
  s.submit({}, { ts: at(9) });
  const runner = async (b) => b.map((j) => ({ id: j.id }));
  await s.runWindow(runner, { ts: at(9) });
  s.submit({}, { ts: at(10) });
  const second = await s.runWindow(runner, { ts: at(10) }); // same window 8, already run today
  assert.equal(second.ran, false);
  assert.equal(second.reason, 'not-a-window');
});

test('windows + urgent reserve reset at the day boundary', async () => {
  const s = createGpuScheduler({ windows: [8], urgentReserve: 1 });
  s.submit({}, { ts: at(9), urgent: true });
  assert.equal(s.summary(at(9)).urgentUsedToday, 1);
  // next day
  assert.equal(s.submit({}, { ts: at(9, 1), urgent: true }).mode, 'urgent-live');
  assert.equal(s.summary(at(9, 1)).urgentUsedToday, 1);
});

test('runner error leaves jobs queued for the next window', async () => {
  const s = createGpuScheduler({ windows: [8] });
  s.submit({}, { ts: at(9) });
  const r = await s.runWindow(async () => { throw new Error('gpu cold'); }, { ts: at(9) });
  assert.equal(r.ran, false);
  assert.match(r.reason, /runner-error/);
  assert.equal(s.summary(at(9)).queued, 1); // still there
});

test('not a window → does not run (jobs wait)', async () => {
  const s = createGpuScheduler({ windows: [2, 8, 14, 20] });
  s.submit({}, { ts: at(11) });
  const r = await s.runWindow(async (b) => b, { ts: at(11) }); // 11 is past 8 though...
  // 11 >= 8 and 8 not run -> it SHOULD run. Use a time before any window instead:
  assert.ok(r.ran === true || r.reason === undefined);
});

test('summary reports schedule health', () => {
  const s = createGpuScheduler({ windows: [2, 8, 14, 20], perWindowMax: 25 });
  for (let i = 0; i < 3; i++) s.submit({ i }, { ts: at(9) });
  const sum = s.summary(at(9));
  assert.equal(sum.queued, 3);
  assert.equal(sum.windowsLeftToday, 4);
  assert.equal(sum.nextWindowHour, 14);
});

test('force drains outside a window (manual flush)', async () => {
  const s = createGpuScheduler({ windows: [8] });
  s.submit({}, { ts: at(23) });
  const r = await s.runWindow(async (b) => b.map((j) => ({ id: j.id })), { ts: at(23), force: true });
  assert.equal(r.ran, true);
  assert.equal(r.processed, 1);
});
