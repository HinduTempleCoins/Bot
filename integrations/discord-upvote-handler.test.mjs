import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUpvote, voteOp, makeUpvoteLedger, handleUpvote } from './discord-upvote-handler.mjs';

test('parseUpvote reads @author/permlink and default 1%', () => {
  const r = parseUpvote('!upvote @alice/my-first-post');
  assert.equal(r.author, 'alice');
  assert.equal(r.permlink, 'my-first-post');
  assert.equal(r.pct, 1);
});

test('parseUpvote reads a bare author/permlink and an explicit percent', () => {
  const r = parseUpvote('!upvote bob/hello-melek 5');
  assert.equal(r.author, 'bob');
  assert.equal(r.permlink, 'hello-melek');
  assert.equal(r.pct, 5);
});

test('parseUpvote pulls the ref out of a full URL', () => {
  const r = parseUpvote('/upvote https://alpha.melek.salon/hive-1/@carol/a-post-123');
  assert.equal(r.author, 'carol');
  assert.equal(r.permlink, 'a-post-123');
});

test('parseUpvote clamps percent to the ceiling', () => {
  assert.equal(parseUpvote('!upvote @a/p 999').pct, 10); // default maxPct 10
  assert.equal(parseUpvote('!upvote @a/p 50', { maxPct: 3 }).pct, 3);
});

test('parseUpvote returns null for non-upvote text', () => {
  assert.equal(parseUpvote('!tip @a 5'), null);
  assert.equal(parseUpvote('hello'), null);
});

test('voteOp converts percent to basis points', () => {
  assert.deepEqual(voteOp({ voter: 'hathor', author: 'a', permlink: 'p', pct: 1 }),
    ['vote', { voter: 'hathor', author: 'a', permlink: 'p', weight: 100 }]);
  assert.equal(voteOp({ voter: 'hathor', author: 'a', permlink: 'p', pct: 100 })[1].weight, 10000);
});

test('ledger enforces 1 per account per day', () => {
  const led = makeUpvoteLedger();
  const t0 = 1_000_000_000_000;
  assert.equal(led.check('userA', 1, t0).ok, true);
  led.record('userA', t0);
  assert.equal(led.check('userA', 1, t0 + 1000).ok, false, 'second same-day request blocked');
  // a different user is unaffected
  assert.equal(led.check('userB', 1, t0 + 1000).ok, true);
  // next day resets
  assert.equal(led.check('userA', 1, t0 + 25 * 3600 * 1000).ok, true);
});

test('handleUpvote builds + broadcasts a 1% vote and records the day', async () => {
  const led = makeUpvoteLedger();
  const sent = [];
  const out = await handleUpvote('!upvote @alice/post-1', {
    from: 'discordbob',
    deps: { voter: 'hathor', ledger: led, now: 5_000_000_000_000, broadcast: (op) => { sent.push(op); return { id: 'abc123def456' }; } },
  });
  assert.equal(out.ok, true);
  assert.deepEqual(sent[0], ['vote', { voter: 'hathor', author: 'alice', permlink: 'post-1', weight: 100 }]);
  assert.match(out.reply, /1% upvote/);
  // second same-day request is refused before broadcasting
  const out2 = await handleUpvote('!upvote @alice/post-2', {
    from: 'discordbob', deps: { ledger: led, now: 5_000_000_100_000, broadcast: () => { throw new Error('should not broadcast'); } },
  });
  assert.equal(out2.ok, false);
  assert.match(out2.reply, /already used/);
});

test('handleUpvote refuses missing post ref and self-vote', async () => {
  const bad = await handleUpvote('!upvote', { from: 'x', deps: { broadcast: () => ({}) } });
  assert.equal(bad.ok, false);
  assert.match(bad.reply, /Usage/);
  const self = await handleUpvote('!upvote @hathor/p', { from: 'x', deps: { voter: 'hathor', broadcast: () => ({}) } });
  assert.equal(self.ok, false);
  assert.match(self.reply, /own posts/);
});

test('handleUpvote soft-fails when not wired to a broadcaster', async () => {
  const out = await handleUpvote('!upvote @alice/p', { from: 'x', deps: {} });
  assert.equal(out.ok, false);
  assert.match(out.reply, /not wired/);
});
