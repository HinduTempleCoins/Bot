// diag-to-tasks.test.mjs — offline: in-memory FS + fixed clock drive the merge lifecycle.
import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  taskId, parseReport, mergeReport, renderMarkdown, loadQueue, runOnce, __setIO,
} from './diag-to-tasks.mjs';

// In-memory filesystem so runOnce touches no real disk.
function memFS(seed = {}) {
  const files = { ...seed };
  __setIO({
    readFile: async (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; },
    writeFile: async (p, d) => { files[p] = d; },
    mkdir: async () => {},
    now: () => new Date('2026-06-07T12:00:00Z'),
  });
  return files;
}
afterEach(() => __setIO({}));

const report = (results, at = '2026-06-07T12:00:00Z') => ({ at, results });
const RED = (name, required = true, detail = 'HTTP 502') => ({ name, required, pass: false, detail });
const GREEN = (name, required = true) => ({ name, required, pass: true, detail: 'ok' });

test('taskId is stable for a given check name and differs across names', () => {
  assert.equal(taskId('chain: RPC + head advancing'), taskId('chain: RPC + head advancing'));
  assert.notEqual(taskId('a'), taskId('b'));
  assert.match(taskId('x'), /^fix-[0-9a-f]{12}$/);
});

test('red check → task created with severity, evidence, count=1', () => {
  const { queue } = mergeReport({ tasks: [] }, report([RED('pool: frontend', true, 'index=502')]),
    { now: new Date('2026-06-07T12:00:00Z') });
  assert.equal(queue.tasks.length, 1);
  const t = queue.tasks[0];
  assert.equal(t.id, taskId('pool: frontend'));
  assert.equal(t.severity, 'high');
  assert.equal(t.summary, 'pool: frontend');
  assert.equal(t.evidence, 'index=502');
  assert.equal(t.count, 1);
  assert.equal(t.firstSeen, '2026-06-07T12:00:00.000Z');
});

test('optional (not required) check gets low severity', () => {
  const { queue } = mergeReport({ tasks: [] }, report([RED('sites: wiki', false)]),
    { now: new Date('2026-06-07T12:00:00Z') });
  assert.equal(queue.tasks[0].severity, 'low');
});

test('persists + counts across runs; firstSeen sticks, lastSeen + count advance', () => {
  let q = { tasks: [] };
  ({ queue: q } = mergeReport(q, report([RED('chain: RPC')]), { now: new Date('2026-06-07T12:00:00Z') }));
  ({ queue: q } = mergeReport(q, report([RED('chain: RPC', true, 'still down')]),
    { now: new Date('2026-06-07T12:15:00Z') }));
  assert.equal(q.tasks.length, 1);
  const t = q.tasks[0];
  assert.equal(t.count, 2);
  assert.equal(t.firstSeen, '2026-06-07T12:00:00.000Z');
  assert.equal(t.lastSeen, '2026-06-07T12:15:00.000Z');
  assert.equal(t.evidence, 'still down');
});

test('green-N consecutive → task recovers and is dropped (default 3)', () => {
  let q = { tasks: [] };
  ({ queue: q } = mergeReport(q, report([RED('faucet: health')]), { now: new Date('2026-06-07T12:00:00Z') }));
  assert.equal(q.tasks.length, 1);
  // green run 1 + 2: still tracked but 'recovering'
  let recovered;
  ({ queue: q, recovered } = mergeReport(q, report([GREEN('faucet: health')]), { now: new Date('2026-06-07T12:15:00Z') }));
  assert.equal(q.tasks[0].status, 'recovering');
  assert.equal(recovered.length, 0);
  ({ queue: q, recovered } = mergeReport(q, report([GREEN('faucet: health')]), { now: new Date('2026-06-07T12:30:00Z') }));
  assert.equal(q.tasks.length, 1);
  // green run 3: streak hits threshold → dropped
  ({ queue: q, recovered } = mergeReport(q, report([GREEN('faucet: health')]), { now: new Date('2026-06-07T12:45:00Z') }));
  assert.equal(q.tasks.length, 0);
  assert.equal(recovered[0], taskId('faucet: health'));
});

test('red after green resets the recovery streak (flap does not recover)', () => {
  let q = { tasks: [] };
  ({ queue: q } = mergeReport(q, report([RED('x')]), { now: new Date('2026-06-07T12:00:00Z') }));
  ({ queue: q } = mergeReport(q, report([GREEN('x')]), { now: new Date('2026-06-07T12:15:00Z') }));
  ({ queue: q } = mergeReport(q, report([RED('x')]), { now: new Date('2026-06-07T12:30:00Z') }));
  assert.equal(q.tasks[0].greenStreak, 0);
  assert.equal(q.tasks[0].status, 'open');
  assert.equal(q.tasks[0].count, 2);
});

test('a check absent from the report leaves its task untouched', () => {
  let q = { tasks: [] };
  ({ queue: q } = mergeReport(q, report([RED('a'), RED('b')]), { now: new Date('2026-06-07T12:00:00Z') }));
  // next report only mentions 'a' (still red); 'b' wasn't run this time
  ({ queue: q } = mergeReport(q, report([RED('a')]), { now: new Date('2026-06-07T12:15:00Z') }));
  const b = q.tasks.find((t) => t.summary === 'b');
  assert.ok(b, 'b survives');
  assert.equal(b.count, 1);
});

test('malformed input soft-fails to an empty merge (never throws)', () => {
  assert.deepEqual(parseReport('not json'), {});
  assert.deepEqual(parseReport(null), {});
  assert.deepEqual(parseReport(42), {});
  // garbage report against an existing queue: no new tasks, existing untouched
  const prev = { tasks: [{ id: 'fix-keep', summary: 'keep', severity: 'high', count: 1, firstSeen: 'x' }] };
  const { queue } = mergeReport(prev, '{bad', { now: new Date('2026-06-07T12:00:00Z') });
  assert.equal(queue.tasks.length, 1);
  assert.equal(queue.tasks[0].id, 'fix-keep');
});

test('mergeReport accepts a JSON string report too', () => {
  const { queue } = mergeReport({ tasks: [] }, JSON.stringify(report([RED('json-path')])),
    { now: new Date('2026-06-07T12:00:00Z') });
  assert.equal(queue.tasks.length, 1);
  assert.equal(queue.tasks[0].summary, 'json-path');
});

test('renderMarkdown: green stack and populated queue both render without throwing', () => {
  assert.match(renderMarkdown({ tasks: [] }), /Stack is green/);
  const md = renderMarkdown({
    updatedAt: 'U', lastReportAt: 'R',
    tasks: [{ id: 'fix-1', severity: 'high', summary: 'pool down', evidence: '502', count: 3, firstSeen: 'A', lastSeen: 'B' }],
  });
  assert.match(md, /\[HIGH\] pool down/);
  assert.match(md, /fix-1/);
  assert.match(md, /seen 3×/);
  assert.match(md, /1 open/);
});

test('renderMarkdown is defensive against garbage', () => {
  assert.doesNotThrow(() => renderMarkdown(null));
  assert.doesNotThrow(() => renderMarkdown({}));
  assert.doesNotThrow(() => renderMarkdown({ tasks: 'nope' }));
});

test('loadQueue returns empty queue on missing file', async () => {
  memFS({});
  const q = await loadQueue('/tmp/nope.json');
  assert.deepEqual(q.tasks, []);
});

test('runOnce writes JSON + markdown to the injected FS', async () => {
  const files = memFS({});
  const res = await runOnce({ report: report([RED('pool: frontend', true, 'index=502')]), path: '/q/self-fix-queue.json' });
  assert.equal(res.ok, true);
  assert.equal(res.open, 1);
  assert.equal(res.mdPath, '/q/self-fix-queue.md');
  const q = JSON.parse(files['/q/self-fix-queue.json']);
  assert.equal(q.tasks[0].summary, 'pool: frontend');
  assert.match(files['/q/self-fix-queue.md'], /\[HIGH\] pool: frontend/);
});

test('runOnce round-trips: second run on the written file increments count', async () => {
  const files = memFS({});
  await runOnce({ report: report([RED('chain: RPC')]), path: '/q/self-fix-queue.json' });
  await runOnce({ report: report([RED('chain: RPC')]), path: '/q/self-fix-queue.json' });
  const q = JSON.parse(files['/q/self-fix-queue.json']);
  assert.equal(q.tasks[0].count, 2);
});

test('runOnce soft-fails (ok:false, no throw) when the write IO errors', async () => {
  __setIO({
    readFile: async () => { throw new Error('ENOENT'); },
    writeFile: async () => { throw new Error('EACCES disk full'); },
    mkdir: async () => {},
    now: () => new Date('2026-06-07T12:00:00Z'),
  });
  const res = await runOnce({ report: report([RED('x')]), path: '/ro/q.json' });
  assert.equal(res.ok, false);
  assert.match(res.error, /EACCES/);
});
