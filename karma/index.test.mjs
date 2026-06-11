// index.test.mjs — offline tests for the karma LEDGER (karma/index.mjs).
// Fully offline: no network, no disk (default in-memory store + an injectable fake store).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createKarma,
  makeMemoryStore,
  makeJsonlStore,
  esc,
} from './index.mjs';

// fixed clock so ts is deterministic.
const fixedNow = () => 1_700_000_000_000;

test('award accumulates into scoreOf', async () => {
  const k = createKarma({ now: fixedNow });
  const r1 = await k.award('alice', 10, 'great answer');
  const r2 = await k.award('alice', 5, 'helped a newcomer');
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(await k.scoreOf('alice'), 15);
});

test('penalize subtracts (stored as a negative delta)', async () => {
  const k = createKarma({ now: fixedNow });
  await k.award('bob', 20, 'good work');
  const p = await k.penalize('bob', 8, 'spam');
  assert.equal(p.ok, true);
  assert.equal(p.entry.points, -8);
  assert.equal(p.entry.kind, 'penalize');
  assert.equal(await k.scoreOf('bob'), 12);
});

test('score can go negative', async () => {
  const k = createKarma({ now: fixedNow });
  await k.penalize('carol', 5, 'first strike');
  await k.penalize('carol', 3, 'second strike');
  assert.equal(await k.scoreOf('carol'), -8);
});

test('scoreOf unknown account is 0', async () => {
  const k = createKarma({ now: fixedNow });
  assert.equal(await k.scoreOf('nobody'), 0);
});

test('rank is sorted desc, ties broken by account name', async () => {
  const k = createKarma({ now: fixedNow });
  await k.award('low', 1);
  await k.award('high', 100);
  await k.award('mid', 50);
  await k.award('zeb', 50); // tie with mid → name order
  const rows = await k.rank();
  assert.deepEqual(rows.map((r) => r.account), ['high', 'mid', 'zeb', 'low']);
  assert.equal(rows[0].score, 100);
});

test('rank respects limit', async () => {
  const k = createKarma({ now: fixedNow });
  await k.award('a', 3);
  await k.award('b', 2);
  await k.award('c', 1);
  const top2 = await k.rank(2);
  assert.equal(top2.length, 2);
  assert.deepEqual(top2.map((r) => r.account), ['a', 'b']);
});

test('history returns immutable append entries in order', async () => {
  const k = createKarma({ now: fixedNow });
  await k.award('dora', 10, 'one');
  await k.penalize('dora', 4, 'two');
  await k.award('other', 99); // must not leak into dora's history
  const h = await k.history('dora');
  assert.equal(h.length, 2);
  assert.deepEqual(h.map((e) => e.reason), ['one', 'two']);
  assert.deepEqual(h.map((e) => e.points), [10, -4]);
  assert.deepEqual(h.map((e) => e.seq), [0, 1]);
  // immutability: entries are frozen and mutation is silently ignored.
  assert.equal(Object.isFrozen(h[0]), true);
  const before = h[0].points;
  try { h[0].points = 9999; } catch { /* strict mode may throw; either way unchanged */ }
  assert.equal((await k.history('dora'))[0].points, before);
});

test('history of unknown account is empty', async () => {
  const k = createKarma({ now: fixedNow });
  assert.deepEqual(await k.history('ghost'), []);
});

test('bad input: non-string / empty account is rejected, never throws', async () => {
  const k = createKarma({ now: fixedNow });
  for (const bad of [undefined, null, '', '   ', 42, {}, []]) {
    const r = await k.award(bad, 10);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'invalid-account');
  }
  assert.deepEqual(await k.rank(), []);
});

test('bad input: non-positive / non-finite points rejected', async () => {
  const k = createKarma({ now: fixedNow });
  for (const bad of [0, -5, NaN, Infinity, 'abc', null, undefined, {}]) {
    const r = await k.award('eve', bad);
    assert.equal(r.ok, false, `points ${String(bad)} should be rejected`);
  }
  assert.equal(await k.scoreOf('eve'), 0);
});

test('reason defaults to empty string when missing or non-string', async () => {
  const k = createKarma({ now: fixedNow });
  const r1 = await k.award('frank', 5);
  const r2 = await k.award('frank', 5, 123);
  assert.equal(r1.entry.reason, '');
  assert.equal(r2.entry.reason, '');
});

test('ts is derived from the injected clock', async () => {
  const k = createKarma({ now: fixedNow });
  const r = await k.award('grace', 1);
  assert.equal(r.entry.ts, new Date(fixedNow()).toISOString());
});

test('empty ledger: scoreOf 0, rank [], history []', async () => {
  const k = createKarma({ now: fixedNow });
  assert.equal(await k.scoreOf('anyone'), 0);
  assert.deepEqual(await k.rank(), []);
  assert.deepEqual(await k.history('anyone'), []);
  assert.deepEqual(await k.all(), []);
});

test('injectable store: a custom store receives the appends', async () => {
  const seen = [];
  const fakeStore = { append: (e) => seen.push(e), all: () => seen.slice() };
  const k = createKarma({ store: fakeStore, now: fixedNow });
  await k.award('heidi', 7, 'via custom store');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].account, 'heidi');
  assert.equal(seen[0].points, 7);
  assert.equal(k.store, fakeStore);
});

test('seq continues monotonically when store is pre-seeded', async () => {
  const store = makeMemoryStore();
  store.append({ account: 'old', points: 5, reason: '', kind: 'award', ts: 'x', seq: 41 });
  const k = createKarma({ store, now: fixedNow });
  const r = await k.award('new', 1);
  assert.equal(r.entry.seq, 42); // picked up past the seeded seq=41
});

test('store append error soft-fails and rolls back seq', async () => {
  const flaky = {
    fail: true,
    append() { if (this.fail) throw new Error('disk full'); },
    all() { return []; },
  };
  const k = createKarma({ store: flaky, now: fixedNow });
  const bad = await k.award('ivan', 5);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /disk full/);
  // recover: next successful append should reuse seq 0 (rolled back).
  flaky.fail = false;
  flaky.append = function (e) { this.entries = (this.entries || []); this.entries.push(e); };
  flaky.all = function () { return this.entries || []; };
  const ok = await k.award('ivan', 5);
  assert.equal(ok.ok, true);
  assert.equal(ok.entry.seq, 0);
});

test('makeJsonlStore round-trips through an injected fake fs (no real disk)', () => {
  let buf = '';
  const fakeFs = {
    appendFileSync: (_f, data) => { buf += data; },
    readFileSync: () => buf,
  };
  const store = makeJsonlStore('/virtual/ledger.jsonl', fakeFs);
  store.append({ account: 'a', points: 3, seq: 0 });
  store.append({ account: 'b', points: -1, seq: 1 });
  const all = store.all();
  assert.equal(all.length, 2);
  assert.equal(all[0].account, 'a');
  assert.equal(all[1].points, -1);
});

test('makeJsonlStore skips corrupt lines, never throws', () => {
  let buf = '';
  const fakeFs = {
    appendFileSync: (_f, data) => { buf += data; },
    readFileSync: () => buf,
  };
  const store = makeJsonlStore('/virtual/ledger.jsonl', fakeFs);
  store.append({ account: 'a', points: 1, seq: 0 });
  buf += 'NOT JSON\n'; // inject corruption
  store.append({ account: 'b', points: 2, seq: 1 });
  const all = store.all();
  assert.equal(all.length, 2); // corrupt line skipped, valid ones survive
});

test('makeJsonlStore read on missing fs soft-fails to []', () => {
  const store = makeJsonlStore('/virtual/x.jsonl'); // no fs injected
  assert.deepEqual(store.all(), []); // does not throw
  // append also swallows the missing-fs error
  assert.doesNotThrow(() => store.append({ account: 'z', points: 1, seq: 0 }));
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('createKarma with no args uses a working in-memory store', async () => {
  const k = createKarma();
  const r = await k.award('jack', 4);
  assert.equal(r.ok, true);
  assert.equal(await k.scoreOf('jack'), 4);
});
