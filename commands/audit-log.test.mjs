// commands/audit-log.test.mjs — offline tests for the audit wrapper.
//
// Fully offline (node:test): no network, no chain, injected dispatch + clock.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  wrapWithAudit,
  createRingSink,
  defaultSink,
  esc,
} from './audit-log.js';

// A fixed clock so timestamps are deterministic.
const FIXED = '2026-06-11T00:00:00.000Z';
const fixedNow = () => new Date(FIXED);

// A stub dispatch we can program per-test, mirroring commands/index.js shape.
function stubDispatch(result) {
  return async (_body, _ctx) => result;
}

test('a handled command is logged with its outcome fields', async () => {
  const sink = createRingSink();
  const dispatch = stubDispatch({
    handled: true,
    command: 'balance',
    args: ['alice'],
    ok: true,
    reply: '...',
  });
  const audited = wrapWithAudit(dispatch, { sink, now: fixedNow });

  const out = await audited('!balance @alice', { askerAccount: 'bob' });

  // Result is passed through untouched.
  assert.equal(out.handled, true);
  assert.equal(out.reply, '...');

  const entries = sink.entries();
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.timestamp, FIXED);
  assert.equal(e.askerAccount, 'bob');
  assert.equal(e.command, 'balance');
  assert.deepEqual(e.args, ['alice']);
  assert.equal(e.handled, true);
  assert.equal(e.ok, true);
  assert.equal(e.error, null);
});

test('an unknown command is logged as handled:true ok:false (dispatch said handled)', async () => {
  // The real dispatch returns handled:true, ok:false for unknown !commands.
  const sink = createRingSink();
  const dispatch = stubDispatch({
    handled: true,
    command: 'nope',
    ok: false,
    reply: 'Unknown command: !nope. Try !help.',
  });
  const audited = wrapWithAudit(dispatch, { sink, now: fixedNow });

  await audited('!nope', { askerAccount: 'carol' });

  const e = sink.entries()[0];
  assert.equal(e.command, 'nope');
  assert.equal(e.handled, true);
  assert.equal(e.ok, false);
});

test('a non-command body is logged as handled:false', async () => {
  const sink = createRingSink();
  const dispatch = stubDispatch({ handled: false });
  const audited = wrapWithAudit(dispatch, { sink, now: fixedNow });

  const out = await audited('just a normal comment', {});

  assert.equal(out.handled, false);
  const e = sink.entries()[0];
  assert.equal(e.handled, false);
  assert.equal(e.command, null);
  assert.deepEqual(e.args, []);
  assert.equal(e.askerAccount, ''); // no askerAccount in ctx
  assert.equal(e.ok, null); // dispatch returned no ok flag
});

test('a sink that throws does not break dispatch', async () => {
  const throwingSink = {
    record() {
      throw new Error('sink is down');
    },
  };
  const dispatch = stubDispatch({ handled: true, command: 'price', ok: true, reply: '$1' });
  const audited = wrapWithAudit(dispatch, { sink: throwingSink, now: fixedNow });

  // Must NOT throw; must return the dispatch result intact.
  const out = await audited('!price', { askerAccount: 'dave' });
  assert.equal(out.handled, true);
  assert.equal(out.reply, '$1');
});

test('entries are esc()-safe: HTML in fields is escaped', async () => {
  const sink = createRingSink();
  const dispatch = stubDispatch({
    handled: true,
    command: '<script>',
    args: ['<b>x</b>', 'a&b'],
    ok: false,
    error: '"<bad>"',
  });
  const audited = wrapWithAudit(dispatch, { sink, now: fixedNow });

  await audited('!<script>', { askerAccount: '<img src=x>' });

  const e = sink.entries()[0];
  assert.equal(e.askerAccount, '&lt;img src=x&gt;');
  assert.equal(e.command, '&lt;script&gt;');
  assert.deepEqual(e.args, ['&lt;b&gt;x&lt;/b&gt;', 'a&amp;b']);
  assert.equal(e.error, '&quot;&lt;bad&gt;&quot;');

  // None of the escaped fields contain raw angle brackets or quotes.
  for (const v of [e.askerAccount, e.command, e.error, ...e.args]) {
    assert.ok(!/[<>]/.test(v), `unescaped bracket in ${v}`);
  }
});

test('esc() handles null/undefined and the five HTML metachars', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('default sink is used when none is injected, and is a ring buffer', async () => {
  defaultSink.clear();
  const dispatch = stubDispatch({ handled: true, command: 'help', ok: true });
  const audited = wrapWithAudit(dispatch, { now: fixedNow });

  await audited('!help', { askerAccount: 'eve' });

  assert.equal(defaultSink.size(), 1);
  assert.equal(defaultSink.entries()[0].command, 'help');
  defaultSink.clear();
});

test('ring buffer drops oldest entries past capacity', () => {
  const sink = createRingSink(3);
  for (let i = 0; i < 5; i++) sink.record({ n: i });
  const ns = sink.entries().map((e) => e.n);
  assert.deepEqual(ns, [2, 3, 4]); // oldest two dropped
  assert.equal(sink.size(), 3);
});

test('clock accepts Date, ms number, and pre-formatted string', async () => {
  const ms = Date.parse(FIXED);
  for (const now of [() => new Date(FIXED), () => ms, () => FIXED]) {
    const sink = createRingSink();
    const audited = wrapWithAudit(stubDispatch({ handled: true, command: 'x', ok: true }), {
      sink,
      now,
    });
    await audited('!x', {});
    assert.equal(sink.entries()[0].timestamp, FIXED);
  }
});
