// audit-log.test.mjs — offline tests for the in-memory command audit-log ring buffer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuditLog, esc } from './audit-log.mjs';

test('esc() escapes HTML metacharacters and coerces non-strings', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

test('record() returns the stored entry; count()/entries() reflect it', () => {
  const log = createAuditLog();
  const stored = log.record({ actor: 'alice', command: '!signup', args: { email: 'a@b.c' }, at: 100 });
  assert.equal(stored.actor, 'alice');
  assert.equal(stored.command, '!signup');
  assert.deepEqual(stored.args, { email: 'a@b.c' });
  assert.equal(stored.at, 100);
  assert.equal(log.count(), 1);
  assert.equal(log.entries()[0], stored);
});

test('redaction replaces secret-bearing fields with [redacted] before storage', () => {
  const log = createAuditLog();
  const s = log.record({
    actor: 'bob',
    command: '!key',
    args: { wif: '5Jdeadbeef', apiKey: 'sk-123', nested: { password: 'hunter2', ok: 'fine' } },
    result: { token: 'bearer-xyz', status: 'ok' },
    at: 1,
  });
  assert.equal(s.args.wif, '[redacted]');
  assert.equal(s.args.apiKey, '[redacted]'); // substring match: contains "key"
  assert.equal(s.args.nested.password, '[redacted]');
  assert.equal(s.args.nested.ok, 'fine');
  assert.equal(s.result.token, '[redacted]');
  assert.equal(s.result.status, 'ok');
  // the secret string must not appear anywhere in the serialized buffer
  assert.ok(!JSON.stringify(log.entries()).includes('5Jdeadbeef'));
  assert.ok(!JSON.stringify(log.entries()).includes('hunter2'));
});

test('custom redactKeys override the defaults', () => {
  const log = createAuditLog({ redactKeys: ['ssn'] });
  const s = log.record({ actor: 'a', command: '!c', args: { ssn: '111', wif: 'shownnow' } });
  assert.equal(s.args.ssn, '[redacted]');
  assert.equal(s.args.wif, 'shownnow'); // default no longer applies
});

test('over-long arg strings are truncated', () => {
  const log = createAuditLog();
  const big = 'x'.repeat(900);
  const s = log.record({ actor: 'a', command: '!c', args: { note: big } });
  assert.ok(s.args.note.length < 900);
  assert.ok(s.args.note.endsWith('…'));
});

test('ring buffer drops oldest past capacity', () => {
  const log = createAuditLog({ capacity: 3 });
  for (let i = 1; i <= 5; i++) log.record({ actor: 'a', command: '!c', args: { i }, at: i });
  assert.equal(log.count(), 3);
  const ats = log.entries().map((e) => e.at);
  assert.deepEqual(ats, [5, 4, 3]); // newest-first, oldest two dropped
});

test('entries() filters by actor/command and respects limit, newest-first', () => {
  const log = createAuditLog();
  log.record({ actor: 'alice', command: '!signup', at: 1 });
  log.record({ actor: 'bob', command: '!tutorial', at: 2 });
  log.record({ actor: 'alice', command: '!tutorial', at: 3 });
  log.record({ actor: 'alice', command: '!signup', at: 4 });

  const alice = log.entries({ actor: 'alice' });
  assert.deepEqual(alice.map((e) => e.at), [4, 3, 1]);

  const signups = log.entries({ command: '!signup' });
  assert.deepEqual(signups.map((e) => e.at), [4, 1]);

  const limited = log.entries({ actor: 'alice', limit: 1 });
  assert.equal(limited.length, 1);
  assert.equal(limited[0].at, 4);

  const both = log.entries({ actor: 'alice', command: '!tutorial' });
  assert.deepEqual(both.map((e) => e.at), [3]);
});

test('summary() tallies totals by command and actor', () => {
  const log = createAuditLog();
  log.record({ actor: 'alice', command: '!signup' });
  log.record({ actor: 'bob', command: '!signup' });
  log.record({ actor: 'alice', command: '!tutorial' });
  const sum = log.summary();
  assert.equal(sum.total, 3);
  assert.deepEqual(sum.byCommand, { '!signup': 2, '!tutorial': 1 });
  assert.deepEqual(sum.byActor, { alice: 2, bob: 1 });
});

test('renderTable() produces escaped markdown and HTML', () => {
  const log = createAuditLog();
  log.record({ actor: '<x>', command: '!c', args: { a: 'b|c' }, at: 7 });
  const md = log.renderTable();
  assert.ok(md.includes('| at | actor | command | args | result |'));
  assert.ok(md.includes('&lt;x&gt;'));      // actor escaped
  assert.ok(md.includes('b\\|c'));          // pipe escaped inside cell
  const html = log.renderTable({ html: true });
  assert.ok(html.startsWith('<table>'));
  assert.ok(html.includes('<td>&lt;x&gt;</td>'));
  // custom rows passthrough
  const custom = log.renderTable({ rows: [{ at: 1, actor: 'z', command: '!z' }] });
  assert.ok(custom.includes('| 1 | z | !z |  |  |'));
});

test('soft-fail: bad input is coerced/skipped, never throws', () => {
  const log = createAuditLog({ capacity: -1, redactKeys: 'notarray' });
  assert.doesNotThrow(() => log.record(null));
  assert.doesNotThrow(() => log.record(undefined));
  assert.doesNotThrow(() => log.record('garbage'));
  assert.doesNotThrow(() => log.record(123));
  const s = log.record({ actor: 42, command: null, at: NaN });
  assert.equal(s.actor, '42');
  assert.equal(s.command, '');
  assert.equal(s.at, null); // NaN -> null, no internal clock
  assert.equal(log.record({ command: '!c' }).actor, 'anonymous');
  assert.doesNotThrow(() => log.entries(null));
  assert.doesNotThrow(() => log.entries('bad'));
  assert.doesNotThrow(() => log.summary());
  assert.doesNotThrow(() => log.renderTable(null));
});

test('cyclic input does not throw and is bounded', () => {
  const log = createAuditLog();
  const cyclic = { name: 'loop' };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => log.record({ actor: 'a', command: '!c', args: cyclic }));
  assert.equal(log.count(), 1);
});

test('createAuditLog() with no args uses defaults', () => {
  const log = createAuditLog();
  assert.equal(log.count(), 0);
  const s = log.record({ actor: 'a', command: '!c', args: { secret: 'z' } });
  assert.equal(s.args.secret, '[redacted]');
});
