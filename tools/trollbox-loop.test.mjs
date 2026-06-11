// tools/trollbox-loop.test.mjs — offline tests for the live TrollBox reply loop.
// node:test + node:assert/strict. NO network, NO keys. Fake client + fake broadcaster.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLoop, esc, __setRunner } from './trollbox-loop.mjs';

const CHAT_ID = 'melek_trollbox';

// Build a fake reader exposing customJsonHistory, returning the given decoded lines as op rows.
function fakeClient(lines) {
  return {
    calls: 0,
    async customJsonHistory(/* id, { since, max } */) {
      this.calls += 1;
      return lines.map((l, i) => ({
        seq: l.seq ?? (i + 1),
        op: ['custom_json', { id: CHAT_ID, json: JSON.stringify({ v: 1, user: l.user, text: l.text, ts: l.ts ?? i + 1 }) }],
      }));
    },
  };
}

// A broadcaster that records the ops it was asked to sign. Returns an ok result.
function fakeBroadcaster() {
  const sent = [];
  const fn = async ({ op, redactedLog }) => { sent.push({ op, redactedLog }); return { ok: true, txId: 'fake-' + sent.length }; };
  fn.sent = sent;
  return fn;
}

test('routes a !signup line to a reply and broadcasts it (real runOnce via fake client)', async () => {
  const client = fakeClient([{ seq: 5, user: 'mary', text: '!signup', ts: 1 }]);
  const broadcaster = fakeBroadcaster();
  const loop = makeLoop({ client, broadcaster });

  const r = await loop.tick();
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, false);
  assert.equal(r.answered, 1, 'the !signup line should produce exactly one reply');
  assert.equal(broadcaster.sent.length, 1, 'reply should be handed to the broadcaster');
  // The broadcast op is a custom_json with the agreed chat id, posting-auth = hathor, no active auth.
  const [opName, body] = broadcaster.sent[0].op;
  assert.equal(opName, 'custom_json');
  assert.equal(body.id, CHAT_ID);
  assert.deepEqual(body.required_auths, []);
  assert.deepEqual(body.required_posting_auths, ['hathor']);
  // cursor advanced to the line's seq.
  assert.equal(r.cursor, 5);
});

test('idempotent: the same line is answered once across repeated ticks', async () => {
  const client = fakeClient([{ seq: 7, user: 'newbie', text: 'how do i sign up?', ts: 1 }]);
  const broadcaster = fakeBroadcaster();
  const loop = makeLoop({ client, broadcaster });

  const r1 = await loop.tick();
  const r2 = await loop.tick();
  const r3 = await loop.tick();
  assert.equal(r1.answered, 1, 'first tick answers the line');
  assert.equal(r2.answered, 0, 'second tick sees it already answered');
  assert.equal(r3.answered, 0, 'third tick too');
  assert.equal(broadcaster.sent.length, 1, 'only one broadcast total');
  assert.equal(loop.state().answeredTotal, 1);
});

test('dry-run path: no broadcaster → routes + replies but broadcasts nothing', async () => {
  const client = fakeClient([{ seq: 3, user: 'mary', text: '!help', ts: 1 }]);
  const loop = makeLoop({ client }); // no broadcaster
  const r = await loop.tick();
  assert.equal(r.dryRun, true);
  assert.equal(r.answered, 1, 'still routes and produces a reply in dry-run');
  assert.equal(loop.state().dryRun, true);
});

test('skips the bot\'s own lines (never answers itself)', async () => {
  const client = fakeClient([{ seq: 9, user: 'hathor', text: '!help', ts: 1 }]);
  const loop = makeLoop({ client });
  const r = await loop.tick();
  assert.equal(r.answered, 0, 'a line authored by hathor is filtered out by runOnce/pollInbound');
});

test('soft-fail: a throwing client never crashes the loop', async () => {
  const client = { async customJsonHistory() { throw new Error('rpc down'); } };
  const loop = makeLoop({ client });
  const r = await loop.tick();
  // pollInbound soft-fails to [] inside runOnce, so the tick is a clean no-answer cycle.
  assert.equal(r.ok, true);
  assert.equal(r.answered, 0);
  assert.equal(loop.state().errors, 0, 'client failure is absorbed below, not counted as a tick error');
});

test('soft-fail: a throwing runner is caught and counted, loop survives', async () => {
  __setRunner(async () => { throw new Error('boom'); });
  try {
    // No `runOnce` override → the loop uses the injected (throwing) default runner.
    const loop = makeLoop({ client: fakeClient([]) });
    const r = await loop.tick();
    assert.equal(r.ok, false);
    assert.match(r.error, /boom/);
    assert.equal(loop.state().errors, 1);
    // a second tick still works (no crash, state intact)
    const r2 = await loop.tick();
    assert.equal(r2.ok, false);
    assert.equal(loop.state().errors, 2);
  } finally {
    __setRunner(); // reset to the real runOnce
  }
});

test('start/stop drive ticks via an injectable timer; idempotent', async () => {
  const client = fakeClient([{ seq: 1, user: 'mary', text: '!signup', ts: 1 }]);
  let scheduled = null;
  let cleared = false;
  const setTimer = (fn) => { scheduled = fn; return { id: 1 }; };
  const clearTimer = () => { cleared = true; };
  const loop = makeLoop({ client, intervalMs: 5000, setTimer, clearTimer });

  assert.equal(loop.start(), true, 'first start arms the timer');
  assert.equal(loop.start(), false, 'second start is a no-op while running');
  assert.equal(typeof scheduled, 'function', 'a callback was scheduled');
  assert.equal(loop.state().running, true);

  // Drive one tick directly (the scheduled wrapper swallows its promise, so we can't await it
  // deterministically). This asserts the same code path the timer fires.
  const r = await loop.tick();
  assert.equal(r.answered, 1);
  assert.equal(loop.state().answeredTotal, 1, 'the !signup line was answered exactly once');

  assert.equal(loop.stop(), true, 'stop clears the armed timer');
  assert.equal(cleared, true);
  assert.equal(loop.stop(), false, 'second stop is a no-op');
  assert.equal(loop.state().running, false);
});

test('interval is floored at the minimum (no hammering the node)', () => {
  const loop = makeLoop({ client: fakeClient([]), intervalMs: 5 });
  assert.ok(loop.state().period >= 1000, 'period floored to >= 1s');
  const loopBad = makeLoop({ client: fakeClient([]), intervalMs: 'nope' });
  assert.equal(loopBad.state().period, 15000, 'non-numeric interval falls back to default');
});

test('bounded seen Set: capped via maxSeen, oldest evicted', async () => {
  // Feed many distinct lines in one tick; cap the seen Set well below that count.
  const lines = Array.from({ length: 20 }, (_, i) => ({ seq: 100 + i, user: 'u' + i, text: 'how do i sign up?', ts: i }));
  const loop = makeLoop({ client: fakeClient(lines), maxSeen: 5 });
  const r = await loop.tick();
  assert.equal(r.answered, 20, 'all distinct lines answered this tick');
  assert.ok(loop.state().seenSize <= 5, 'seen Set bounded to maxSeen after the tick');
});

test('re-entrancy guard: overlapping tick is skipped, not run twice', async () => {
  // A runner that blocks until released, so we can have two ticks overlap.
  let release;
  const gate = new Promise((res) => { release = res; });
  let runs = 0;
  const loop = makeLoop({
    client: fakeClient([]),
    runOnce: async () => { runs += 1; await gate; return { answered: [], cursor: 0, seen: new Set() }; },
  });
  const p1 = loop.tick();          // enters, blocks on gate
  const r2 = await loop.tick();    // should be skipped (previous in flight)
  assert.equal(r2.skipped, true);
  release();
  const r1 = await p1;
  assert.equal(r1.ok, true);
  assert.equal(runs, 1, 'the runner ran only once; the overlapping tick was skipped');
});

test('esc() escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});
