// vote-command.test.mjs — offline. `node --test`. Injected fetch; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVoteCommand, isAuthorized, effectiveWeightBps, voteOp, handleCommand } from './vote-command.mjs';

const LEDGER = { delegators: [
  { account: 'whale', vests: 900, share: 0.9 },
  { account: 'minnow', vests: 100, share: 0.1 },
] };

test('parseVoteCommand reads @author/permlink, optional weight, and URLs; rejects junk', () => {
  assert.deepEqual(parseVoteCommand('!vote @Alice/my-post'), { author: 'alice', permlink: 'my-post', weightPct: 100 });
  assert.deepEqual(parseVoteCommand('!vote @alice/my-post 50'), { author: 'alice', permlink: 'my-post', weightPct: 50 });
  assert.deepEqual(parseVoteCommand('!vote https://melek.salon/hive-1/@bob/hello 25'), { author: 'bob', permlink: 'hello', weightPct: 25 });
  assert.equal(parseVoteCommand('!vote garbage'), null);
  assert.equal(parseVoteCommand('hello there'), null);
  assert.equal(parseVoteCommand('!vote @alice/post 999').weightPct, 100); // clamped
});

test('only delegators or admins may direct a vote', () => {
  assert.equal(isAuthorized('whale', { ledger: LEDGER }), true);
  assert.equal(isAuthorized('stranger', { ledger: LEDGER }), false);
  assert.equal(isAuthorized('boss', { ledger: LEDGER, admins: ['boss'] }), true);
});

test('vote weight scales with the caller’s pool share (whale > minnow); admin gets full', () => {
  assert.equal(effectiveWeightBps('whale', 100, { ledger: LEDGER }), 9000);   // 100% * 0.9
  assert.equal(effectiveWeightBps('minnow', 100, { ledger: LEDGER }), 1000);  // 100% * 0.1
  assert.equal(effectiveWeightBps('minnow', 50, { ledger: LEDGER }), 500);
  assert.equal(effectiveWeightBps('boss', 100, { ledger: LEDGER, admins: ['boss'] }), 10000);
  assert.equal(effectiveWeightBps('stranger', 100, { ledger: LEDGER }), 100); // floor, not zero
});

test('voteOp builds a positive-weight vote (no downvotes on MELEK)', () => {
  const [name, op] = voteOp('Hathor', 'Alice', 'Post', 5000);
  assert.equal(name, 'vote');
  assert.deepEqual(op, { voter: 'hathor', author: 'alice', permlink: 'post', weight: 5000 });
  assert.equal(voteOp('h', 'a', 'p', 999999)[1].weight, 10000);  // clamped
});

test('handleCommand: authorized delegator → broadcasts, returns a cast ack', async () => {
  let sent = null;
  const fakeFetch = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ ok: true, result: { id: 'tx1' } }) }; };
  const reply = await handleCommand({ text: '!vote @author/great-post 100', caller: 'whale', voter: 'hathor', token: 'T', ledger: LEDGER, fetch: fakeFetch });
  assert.match(reply, /Cast/);
  assert.match(reply, /90%/);                                   // whale's 0.9 share
  assert.equal(sent.body.role, 'posting');                     // social tier, never funds
  assert.equal(sent.body.ops[0][0], 'vote');
});

test('handleCommand: stranger refused (must delegate); bad syntax explained; no throw', async () => {
  const refuse = await handleCommand({ text: '!vote @author/post', caller: 'stranger', ledger: LEDGER, token: 'T' });
  assert.match(refuse, /Delegate/i);
  const bad = await handleCommand({ text: '!vote nonsense', caller: 'whale', ledger: LEDGER, token: 'T' });
  assert.match(bad, /couldn't parse/i);
});

test('handleCommand: a broadcast failure comes back as text, never an exception', async () => {
  const failFetch = async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'down' }) });
  const reply = await handleCommand({ text: '!vote @author/post', caller: 'whale', ledger: LEDGER, token: 'T', fetch: failFetch });
  assert.match(reply, /couldn't cast/i);
});
