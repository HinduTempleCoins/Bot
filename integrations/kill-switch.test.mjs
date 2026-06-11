// integrations/kill-switch.test.mjs — offline tests for the emergency kill-switch + audit ring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { KillSwitch, MemoryStore, FileStore, esc } from './kill-switch.mjs';

const clock = (start = 1_000_000) => {
  let t = start;
  const fn = () => t;
  fn.advance = (ms) => { t += ms; return t; };
  return fn;
};

test('starts open and gate runs fn when open', async () => {
  const ks = new KillSwitch({ now: clock() });
  assert.equal(ks.isOpen(), true);
  const r = await ks.gate('faucet-create', () => 'minted');
  assert.deepEqual(r, { ok: true, value: 'minted' });
});

test('trip closes the gate; reset reopens it (state transitions)', async () => {
  const now = clock();
  const ks = new KillSwitch({ now });
  const tripped = ks.trip('faucet drained', 'hathor');
  assert.equal(tripped.open, false);
  assert.equal(tripped.reason, 'faucet drained');
  assert.equal(tripped.by, 'hathor');
  assert.ok(tripped.at, 'sets an ISO timestamp on trip');
  assert.equal(ks.isOpen(), false);

  now.advance(5000);
  const reset = ks.reset('hathor');
  assert.equal(reset.open, true);
  assert.equal(reset.reason, null);
  assert.equal(ks.isOpen(), true);
});

test('gate DENIES with {ok:false,reason:shutdown} when tripped and does NOT run fn', async () => {
  const ks = new KillSwitch({ now: clock() });
  ks.trip('emergency', 'admin');
  let ran = false;
  const r = await ks.gate('faucet-create', () => { ran = true; return 'should-not-happen'; });
  assert.deepEqual(r, { ok: false, reason: 'shutdown' });
  assert.equal(ran, false, 'guarded fn must not be invoked while tripped');
});

test('gate surfaces a thrown fn as error WITHOUT tripping the switch', async () => {
  const ks = new KillSwitch({ now: clock() });
  const r = await ks.gate('faucet-create', () => { throw new Error('boom'); });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'error');
  assert.match(r.error, /boom/);
  assert.equal(ks.isOpen(), true, 'a failing guarded op does not shut the switch');
});

test('gate awaits async fns', async () => {
  const ks = new KillSwitch({ now: clock() });
  const r = await ks.gate('async-work', async () => { return 42; });
  assert.deepEqual(r, { ok: true, value: 42 });
});

test('logEvent appends and recentEvents returns newest-first', () => {
  const now = clock();
  const ks = new KillSwitch({ now });
  ks.logEvent({ type: 'a', severity: 'info', detail: { i: 1 } }); now.advance(1000);
  ks.logEvent({ type: 'b', severity: 'warn', detail: { i: 2 } }); now.advance(1000);
  ks.logEvent({ type: 'c', severity: 'critical', detail: { i: 3 } });
  const recent = ks.recentEvents(10);
  assert.equal(recent.length, 3);
  assert.deepEqual(recent.map((e) => e.type), ['c', 'b', 'a'], 'newest first');
  assert.equal(recent[0].detail.i, 3);
});

test('logEvent honors explicit now arg and orders by it', () => {
  const ks = new KillSwitch({ now: clock(500_000) });
  ks.logEvent({ type: 'old' }, 100);
  ks.logEvent({ type: 'new' }, 200);
  const recent = ks.recentEvents();
  assert.equal(recent[0].type, 'new');
  assert.equal(recent[0].ts, 200);
  assert.equal(recent[1].ts, 100);
});

test('ring buffer evicts oldest when over capacity', () => {
  const now = clock();
  const ks = new KillSwitch({ ringMax: 3, now });
  for (let i = 0; i < 6; i++) { ks.logEvent({ type: `e${i}` }); now.advance(10); }
  const recent = ks.recentEvents(100);
  assert.equal(recent.length, 3, 'capped at ringMax');
  assert.deepEqual(recent.map((e) => e.type), ['e5', 'e4', 'e3'], 'oldest (e0..e2) evicted');
});

test('trip and reset record audit events alongside manual logs', () => {
  const now = clock();
  const ks = new KillSwitch({ now });
  ks.logEvent({ type: 'rate-spike', severity: 'warn' }); now.advance(10);
  ks.trip('drained', 'op'); now.advance(10);
  ks.reset('op');
  const types = ks.recentEvents(10).map((e) => e.type);
  assert.deepEqual(types, ['reset', 'trip', 'rate-spike']);
});

test('blocked gate while tripped logs a blocked audit event', async () => {
  const ks = new KillSwitch({ now: clock() });
  ks.trip('emergency', 'op');
  await ks.gate('faucet-create', () => 'x');
  const recent = ks.recentEvents(10);
  assert.equal(recent[0].type, 'blocked');
  assert.equal(recent[0].detail.action, 'faucet-create');
});

test('disabled switch is always open and cannot be tripped', async () => {
  const ks = new KillSwitch({ disabled: true, now: clock() });
  ks.trip('try to shut', 'op');
  assert.equal(ks.isOpen(), true, 'disabled switch ignores trip');
  const r = await ks.gate('work', () => 'ran');
  assert.deepEqual(r, { ok: true, value: 'ran' });
});

test('file-backed store survives a new KillSwitch instance', async () => {
  const path = join(tmpdir(), `ks-test-${process.pid}-${Date.now()}.json`);
  try {
    const a = new KillSwitch({ path, now: clock() });
    a.trip('persisted shutdown', 'op');
    const b = new KillSwitch({ path, now: clock() });
    assert.equal(b.isOpen(), false, 'trip persisted across instances via file store');
    assert.equal(b.status().reason, 'persisted shutdown');
    b.reset('op');
    const c = new KillSwitch({ path, now: clock() });
    assert.equal(c.isOpen(), true, 'reset persisted');
  } finally {
    rmSync(path, { force: true });
    rmSync(`${path}.tmp`, { force: true });
  }
});

test('SOFT-FAIL: unreadable store fails CLOSED by default (denies)', async () => {
  const brokenStore = { read: () => null, write: () => {} };
  const ks = new KillSwitch({ store: brokenStore, now: clock() });
  assert.equal(ks.isOpen(), false, 'unreadable state -> deny (fail closed)');
  const r = await ks.gate('faucet-create', () => 'x');
  assert.deepEqual(r, { ok: false, reason: 'shutdown' });
});

test('SOFT-FAIL: failOpen:true serves when store is unreadable', () => {
  const brokenStore = { read: () => null, write: () => {} };
  const ks = new KillSwitch({ store: brokenStore, failOpen: true, now: clock() });
  assert.equal(ks.isOpen(), true, 'failOpen inverts to serve');
});

test('a store whose read() throws does not blow up isOpen (fail closed)', () => {
  const throwingStore = { read: () => { throw new Error('disk'); }, write: () => {} };
  const ks = new KillSwitch({ store: throwingStore, now: clock() });
  assert.doesNotThrow(() => ks.isOpen());
  assert.equal(ks.isOpen(), false);
});

test('MemoryStore and FileStore are exported and usable', () => {
  assert.equal(typeof MemoryStore, 'function');
  assert.equal(typeof FileStore, 'function');
  const m = new MemoryStore();
  assert.equal(m.read(), null);
  m.write({ open: false });
  assert.equal(m.read().open, false);
});

test('esc() escapes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});

test('recentEvents defaults and bad n are handled', () => {
  const now = clock();
  const ks = new KillSwitch({ now });
  for (let i = 0; i < 25; i++) { ks.logEvent({ type: `e${i}` }); now.advance(1); }
  assert.equal(ks.recentEvents().length, 20, 'default 20');
  assert.equal(ks.recentEvents(-5).length, 25, 'bad n returns all');
});
