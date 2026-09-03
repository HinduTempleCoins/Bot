// melek-follow.test.mjs — offline. `node --test`. Injectable fetch; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followOp, unfollowOp, followJsonOp, follow, unfollow, makeFollow } from './melek-follow.mjs';

test('followOp builds the standard follow custom_json (matches what melek-notify parses)', () => {
  const op = followOp('Alice', 'BOB');
  assert.equal(op[0], 'custom_json');
  assert.deepEqual(op[1].required_posting_auths, ['alice']); // lowercased, posting scope
  assert.deepEqual(op[1].required_auths, []);
  assert.equal(op[1].id, 'follow');
  const [verb, data] = JSON.parse(op[1].json);
  assert.equal(verb, 'follow');
  assert.deepEqual(data, { follower: 'alice', following: 'bob', what: ['blog'] });
});

test('unfollowOp is the same op with what:[]', () => {
  const [, data] = JSON.parse(unfollowOp('alice', 'bob')[1].json);
  assert.deepEqual(data.what, []);
});

test('guards: needs both accounts, cannot follow yourself', () => {
  assert.throws(() => followOp('', 'bob'), /required/);
  assert.throws(() => followOp('alice', 'alice'), /yourself/);
  assert.throws(() => followJsonOp('alice', 'ALICE'), /yourself/); // case-insensitive
});

test('follow broadcasts one posting-scope op through the signer with the bearer token', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ ok: true, result: { id: 'abc', block_num: 42 } }) };
  };
  const r = await follow({ token: 'SECRET', follower: 'alice', following: 'bob', fetch: fakeFetch });
  assert.deepEqual(r, { id: 'abc', block_num: 42 });
  assert.match(captured.url, /\/v1\/broadcast$/);
  assert.equal(captured.headers.Authorization, 'Bearer SECRET');
  assert.equal(captured.body.role, 'posting');           // posting authority, not active
  assert.equal(captured.body.ops.length, 1);
  assert.equal(captured.body.ops[0][1].id, 'follow');
});

test('a failed broadcast throws (so a caller can skip and continue)', async () => {
  const bad = async () => ({ ok: false, status: 403, json: async () => ({ error: 'bad token' }) });
  await assert.rejects(() => follow({ token: 't', follower: 'a', following: 'b', fetch: bad }), /bad token/);
  await assert.rejects(() => follow({ follower: 'a', following: 'b', fetch: bad }), /no bearer token/);
});

test('makeFollow binds an account into a follow/unfollow pair', async () => {
  const calls = [];
  const fakeFetch = async (_u, opts) => { calls.push(JSON.parse(opts.body).ops[0][1].json); return { ok: true, json: async () => ({ ok: true, result: {} }) }; };
  const f = makeFollow({ token: 't', follower: 'alice', fetch: fakeFetch });
  await f.follow('bob');
  await f.unfollow('carol');
  assert.deepEqual(JSON.parse(calls[0])[1].what, ['blog']);
  assert.deepEqual(JSON.parse(calls[1])[1].what, []);
  assert.throws(() => makeFollow({ follower: 'alice' }), /no bearer token/);
});
