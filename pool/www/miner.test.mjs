// Tests for the browser miner controller's stratum logic + worker/WS glue.
// Run: node --test pool/www/miner.test.mjs
//
// The pure stratum helpers are tested directly. The BrowserMiner glue is tested with a
// mock WebSocket and a mock Worker so we never touch the DOM or a real socket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  targetToUint32, difficultyFromTarget, parseJob, buildLogin, buildSubmit,
  parseLoginSession, BrowserMiner,
} from './miner.mjs';

// ---------- pure helpers ----------
test('targetToUint32 — 4-byte LE compact target', () => {
  // 0xb88d0600 little-endian bytes b8 8d 06 00 -> uint32 0x00068db8
  assert.equal(targetToUint32('b88d0600'), 0x00068db8);
});

test('targetToUint32 — 8-byte LE target takes the high word', () => {
  // bytes: 00 00 00 00 b8 8d 06 00 ; high 4 bytes LE (b8 8d 06 00) -> 0x00068db8
  assert.equal(targetToUint32('00000000b88d0600'), 0x00068db8);
});

test('targetToUint32 — unknown length is treated as hardest (no over-claim)', () => {
  assert.equal(targetToUint32('abcd') >>> 0, 0xffffffff);
});

test('difficultyFromTarget — inverse-ish of target', () => {
  assert.equal(difficultyFromTarget(0x00068db8), Math.round(0xffffffff / 0x00068db8));
  assert.ok(difficultyFromTarget(0xffffffff) === 1);
});

test('parseJob — from a login result', () => {
  const msg = { id: 1, result: { id: 'sess', job: { blob: 'aa'.repeat(76), job_id: 'j1', seed_hash: 'b'.repeat(64), target: 'b88d0600', height: 5, algo: 'rx/0' } } };
  const j = parseJob(msg);
  assert.equal(j.job_id, 'j1');
  assert.equal(j.seed_hash.length, 64);
  assert.equal(j.target, 0x00068db8);
  assert.equal(j.height, 5);
});

test('parseJob — from an unsolicited job push, and rejects incomplete jobs', () => {
  const push = { jsonrpc: '2.0', method: 'job', params: { blob: 'cc'.repeat(76), job_id: 'j2', seed_hash: 'd'.repeat(64), target: 'ffff0000' } };
  assert.equal(parseJob(push).job_id, 'j2');
  assert.equal(parseJob({ method: 'job', params: { blob: 'x' } }), null); // missing job_id/seed
});

test('buildLogin / buildSubmit shapes', () => {
  const login = buildLogin({ address: 'ADDR', worker: 'w', id: 1 });
  assert.equal(login.method, 'login');
  assert.equal(login.params.login, 'ADDR');
  assert.deepEqual(login.params.algo, ['rx/0']);
  const sub = buildSubmit({ sessionId: 's', jobId: 'j', nonce: '00000001', result: 'ab', id: 7 });
  assert.equal(sub.method, 'submit');
  assert.equal(sub.params.id, 's');
  assert.equal(sub.params.nonce, '00000001');
});

test('parseLoginSession reads the session id', () => {
  assert.equal(parseLoginSession({ result: { id: 'sess9', status: 'OK' } }), 'sess9');
  assert.equal(parseLoginSession({ result: { status: 'OK' } }), null);
});

// ---------- glue with mock WS + mock Worker ----------
class MockWS {
  constructor() { this.readyState = 0; this.sent = []; MockWS.last = this; }
  open() { this.readyState = 1; this.onopen && this.onopen(); }
  send(s) { this.sent.push(JSON.parse(s)); }
  recv(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
  close() { this.readyState = 3; this.onclose && this.onclose(); }
}
class MockWorker {
  constructor() { this.msgs = []; MockWorker.all.push(this); }
  postMessage(m) { this.msgs.push(m); }
  terminate() { this.terminated = true; }
  // simulate the worker emitting a share / hashrate
  emit(m) { this.onmessage && this.onmessage({ data: m }); }
}
MockWorker.all = [];

function makeMiner() {
  MockWorker.all = [];
  const events = [];
  const m = new BrowserMiner({
    wsUrl: 'wss://x/ws', threads: 2, throttle: 0.5,
    WebSocketImpl: MockWS, WorkerImpl: MockWorker,
    onEvent: (e) => events.push(e),
  });
  return { m, events };
}

const LOGIN_RESULT = { id: 1, result: { id: 'sess1', status: 'OK', job: { blob: 'aa'.repeat(76), job_id: 'j1', seed_hash: 'b'.repeat(64), target: 'b88d0600', height: 1, algo: 'rx/0' } } };

test('start -> login sent -> job fans out to all workers with distinct nonce lanes', () => {
  const { m, events } = makeMiner();
  m.start('MYADDR');
  assert.equal(MockWorker.all.length, 2, 'spawned 2 workers');
  MockWS.last.open();
  const login = MockWS.last.sent.find((x) => x.method === 'login');
  assert.ok(login && login.params.login === 'MYADDR');

  MockWS.last.recv(LOGIN_RESULT);
  // every worker got a 'job' with a unique lane offset and stride == worker count
  const jobMsgs = MockWorker.all.map((w) => w.msgs.find((x) => x.type === 'job'));
  assert.ok(jobMsgs.every(Boolean), 'all workers got a job');
  const offsets = jobMsgs.map((j) => j.job.lane.offset).sort();
  assert.deepEqual(offsets, [0, 1]);
  assert.ok(jobMsgs.every((j) => j.job.lane.stride === 2));
  // and a 'start'
  assert.ok(MockWorker.all.every((w) => w.msgs.some((x) => x.type === 'start')));
  m.stop();
});

test('a worker share is submitted, and an OK response increments accepted', () => {
  const { m, events } = makeMiner();
  m.start('MYADDR');
  MockWS.last.open();
  MockWS.last.recv(LOGIN_RESULT);

  // worker 0 finds a share for the current job
  MockWorker.all[0].emit({ type: 'share', jobId: 'j1', nonce: '00000007', result: 'cc'.repeat(32) });
  const submit = MockWS.last.sent.find((x) => x.method === 'submit');
  assert.ok(submit, 'share submitted to pool');
  assert.equal(submit.params.nonce, '00000007');
  assert.equal(submit.params.id, 'sess1');

  // pool accepts it
  MockWS.last.recv({ id: submit.id, result: { status: 'OK' } });
  assert.equal(m.accepted, 1);
  assert.ok(events.some((e) => e.type === 'accepted' && e.accepted === 1));
  m.stop();
});

test('a stale-job share (wrong jobId) is NOT submitted', () => {
  const { m } = makeMiner();
  m.start('A'); MockWS.last.open(); MockWS.last.recv(LOGIN_RESULT);
  const before = MockWS.last.sent.length;
  MockWorker.all[0].emit({ type: 'share', jobId: 'OLDJOB', nonce: '00000001', result: 'dd'.repeat(32) });
  assert.equal(MockWS.last.sent.length, before, 'no submit for a stale job');
  m.stop();
});

test('a rejected share increments rejected, not accepted', () => {
  const { m } = makeMiner();
  m.start('A'); MockWS.last.open(); MockWS.last.recv(LOGIN_RESULT);
  MockWorker.all[1].emit({ type: 'share', jobId: 'j1', nonce: '00000002', result: 'ee'.repeat(32) });
  const submit = MockWS.last.sent.find((x) => x.method === 'submit');
  MockWS.last.recv({ id: submit.id, error: { message: 'Low difficulty share' } });
  assert.equal(m.accepted, 0);
  assert.equal(m.rejected, 1);
  m.stop();
});

test('hashrate from workers is aggregated', () => {
  const { m, events } = makeMiner();
  m.start('A'); MockWS.last.open(); MockWS.last.recv(LOGIN_RESULT);
  MockWorker.all[0].emit({ type: 'hashrate', hs: 4 });
  MockWorker.all[1].emit({ type: 'hashrate', hs: 6 });
  const last = [...events].reverse().find((e) => e.type === 'hashrate');
  assert.equal(last.total, 10);
  m.stop();
});

test('stop terminates workers and closes the socket', () => {
  const { m } = makeMiner();
  m.start('A'); MockWS.last.open();
  const ws = MockWS.last;
  m.stop();
  assert.ok(MockWorker.all.every((w) => w.terminated));
  assert.equal(ws.readyState, 3);
  assert.equal(m.running, false);
});

test('setThrottle clamps and forwards to workers', () => {
  const { m } = makeMiner();
  m.start('A'); MockWS.last.open();
  m.setThrottle(2.0); // clamps to 1
  assert.equal(m.cfg.throttle, 1);
  m.setThrottle(0); // clamps to 0.05
  assert.equal(m.cfg.throttle, 0.05);
  assert.ok(MockWorker.all[0].msgs.some((x) => x.type === 'throttle' && x.value === 0.05));
  m.stop();
});
