// freakazoid.test.mjs — OFFLINE unit tests for the thin Freakazoid-pattern connector.
// No network, no keys: the source is an in-memory array/poll fn, sign defaults to a dry-run.
//   node --test integrations/freakazoid.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import {
  createConnector,
  runOnce,
  defaultBrain,
  defaultSign,
  defaultSource,
  toContext,
  toReplyIntent,
} from './freakazoid.mjs';

test('defaultSign is a DRY-RUN: simulated, no broadcast', async () => {
  const res = await defaultSign({ op: 'comment', parentAuthor: 'alice' });
  assert.equal(res.simulated, true);
  assert.equal(res.broadcast, false);
  assert.equal(res.op, 'comment');
  assert.equal(res.to, 'alice');
});

test('createConnector defaults to defaultBrain + defaultSign (dry-run)', () => {
  const conn = createConnector();
  assert.equal(conn.brain, defaultBrain);
  assert.equal(conn.sign, defaultSign);
});

test('defaultBrain echoes / applies simple rules (no LLM)', () => {
  assert.match(defaultBrain({ author: 'alice', body: 'how do I signup?' }), /!commands|!signup/);
  assert.match(defaultBrain({ author: 'bob', body: 'hello there' }), /Greetings/);
  assert.match(defaultBrain({ author: 'carol', body: 'random thought' }), /Heard you, @carol/);
  assert.match(defaultBrain({}), /friend/); // empty body still safe
});

test('toContext is tolerant of partial/aliased events', () => {
  const ctx = toContext({ from: 'dave', memo: 'gm', permlink: 'p9' });
  assert.equal(ctx.author, 'dave');
  assert.equal(ctx.body, 'gm');
  assert.equal(ctx.id, 'p9');
});

test('toReplyIntent emits a comment op authored by hathor, never value', () => {
  const ctx = toContext({ author: 'alice', permlink: 'p1', body: 'hi' });
  const intent = toReplyIntent(ctx, 'hello');
  assert.equal(intent.op, 'comment');
  assert.equal(intent.author, 'hathor');
  assert.equal(intent.body, 'hello');
  assert.ok(!('amount' in intent) && !('to' in intent)); // no transfer/value fields
});

test('runOnce routes event -> brain -> reply intent without network or key', async () => {
  const conn = createConnector(); // dry-run sign, default brain
  const out = await runOnce(conn, { author: 'alice', body: 'hello', permlink: 'p1' });
  assert.equal(out.ctx.author, 'alice');
  assert.match(out.reply, /Greetings/);
  assert.equal(out.intent.op, 'comment');
  assert.equal(out.signed.simulated, true);
  assert.equal(out.signed.broadcast, false);
});

test('brain is SWAPPABLE — connector uses the injected brain', async () => {
  const calls = [];
  const brain = (ctx) => { calls.push(ctx.body); return `BRAIN:${ctx.body}`; };
  const conn = createConnector({ brain });
  const out = await runOnce(conn, { author: 'x', body: 'ping', permlink: 'p1' });
  assert.equal(out.reply, 'BRAIN:ping');
  assert.deepEqual(calls, ['ping']);
});

test('sign capability is SWAPPABLE — caller-supplied grant receives the intent', async () => {
  const seen = [];
  const sign = async (intent) => { seen.push(intent); return { simulated: false, broadcast: true, txid: 'abc' }; };
  const conn = createConnector({ sign });
  const out = await runOnce(conn, { author: 'x', body: 'hi', permlink: 'p1' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].op, 'comment');
  assert.equal(out.signed.txid, 'abc');
});

test('connector.run iterates an async-iterable source, yielding one intent per event', async () => {
  const events = [
    { author: 'a', body: 'hello', permlink: '1' },
    { author: 'b', body: 'how do I signup', permlink: '2' },
  ];
  const conn = createConnector({ source: events });
  const out = [];
  for await (const r of conn.run()) out.push(r);
  assert.equal(out.length, 2);
  assert.equal(out[0].intent.op, 'comment');
  assert.equal(out[1].signed.simulated, true);
});

test('source can be a poll function; undefined terminates the stream', async () => {
  const queue = [{ author: 'a', body: 'gm', permlink: '1' }, { author: 'b', body: 'gn', permlink: '2' }];
  let i = 0;
  const poll = () => (i < queue.length ? queue[i++] : undefined);
  const conn = createConnector({ source: poll });
  const out = [];
  for await (const r of conn.run()) out.push(r);
  assert.equal(out.length, 2);
  assert.equal(out[0].ctx.body, 'gm');
});

test('defaultSource yields nothing — a connector with no source is inert (read-only floor)', async () => {
  const got = [];
  for await (const e of defaultSource()) got.push(e);
  assert.equal(got.length, 0);
  const conn = createConnector();
  const out = [];
  for await (const r of conn.run()) out.push(r);
  assert.equal(out.length, 0);
});
