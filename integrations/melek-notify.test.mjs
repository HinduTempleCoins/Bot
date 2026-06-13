import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNotifications, makeNotifStore } from './melek-notify.mjs';

test('a comment that @-mentions a user produces a mention notification for that user', () => {
  const out = extractNotifications(['comment', { author: 'hathor', permlink: 'welcome-alice-1', parent_author: 'hathor', parent_permlink: 'introducing-hathor', body: 'Welcome, @alice — glad you are here.' }], 1700000000);
  // hathor replying to own post mentions @alice → alice gets a mention (not a self-reply for hathor)
  const mention = out.find((n) => n.item.type === 'mention');
  assert.ok(mention, 'mention emitted');
  assert.deepEqual(mention, { to: 'alice', item: { type: 'mention', author: 'hathor', permlink: 'welcome-alice-1', timestamp: 1700000000 } });
});

test('the welcome flow: Hathor mentions a new user → that user is notified (the operator ping)', () => {
  const store = makeNotifStore();
  store.ingest(['comment', { author: 'hathor', permlink: 'welcome-bob', parent_author: 'hathor', parent_permlink: 'introducing-hathor-on-melek', body: 'Welcome, @bob. You are on MELEK now.' }], '2026-06-13T20:00:00');
  const bob = store.get('bob');
  assert.equal(bob.length, 1);
  assert.equal(bob[0].type, 'mention');
  assert.equal(bob[0].author, 'hathor');
  assert.equal(bob[0].permlink, 'welcome-bob');
});

test('a reply to someone else notifies the parent author', () => {
  const out = extractNotifications(['comment', { author: 'bob', permlink: 'r1', parent_author: 'alice', parent_permlink: 'post1', body: 'nice post' }], 1700000000);
  assert.deepEqual(out, [{ to: 'alice', item: { type: 'reply', author: 'bob', permlink: 'r1', timestamp: 1700000000 } }]);
});

test('no self-notification: author mentioning themselves / replying to self yields nothing', () => {
  assert.deepEqual(extractNotifications(['comment', { author: 'alice', permlink: 'p', parent_author: 'alice', body: 'note to self @alice' }], 1), []);
});

test('transfer notifies the recipient (not the sender)', () => {
  const out = extractNotifications(['transfer', { from: 'hathor', to: 'carol', amount: '10.000 TESTS', memo: 'welcome grant' }], 1700000000);
  assert.deepEqual(out, [{ to: 'carol', item: { type: 'transfer', from: 'hathor', amount: '10.000 TESTS', memo: 'welcome grant', timestamp: 1700000000 } }]);
});

test('follow custom_json notifies the followed account', () => {
  const op = ['custom_json', { id: 'follow', json: JSON.stringify(['follow', { follower: 'bob', following: 'alice', what: ['blog'] }]) }];
  assert.deepEqual(extractNotifications(op, 1700000000), [{ to: 'alice', item: { type: 'follow', follower: 'bob', timestamp: 1700000000 } }]);
});

test('witness vote (approve) notifies the witness', () => {
  const out = extractNotifications(['account_witness_vote', { account: 'bob', witness: 'hathor', approve: true }], 1700000000);
  assert.deepEqual(out, [{ to: 'hathor', item: { type: 'witness_vote', account: 'bob', timestamp: 1700000000 } }]);
});

test('unrelated ops and garbage produce nothing (soft-fail)', () => {
  assert.deepEqual(extractNotifications(['vote', { voter: 'a', author: 'b', permlink: 'p' }], 1), []);
  assert.deepEqual(extractNotifications(null, 1), []);
  assert.deepEqual(extractNotifications(['comment'], 1), []);
});

test('store is newest-first, capped, and round-trips through dump/load', () => {
  const s = makeNotifStore({ cap: 2 });
  s.add('alice', { type: 'mention', author: 'x', permlink: '1', timestamp: 1 });
  s.add('alice', { type: 'mention', author: 'y', permlink: '2', timestamp: 2 });
  s.add('alice', { type: 'mention', author: 'z', permlink: '3', timestamp: 3 });
  const a = s.get('alice');
  assert.equal(a.length, 2, 'capped at 2');
  assert.equal(a[0].author, 'z', 'newest first');
  const s2 = makeNotifStore();
  s2.load(s.dump());
  assert.deepEqual(s2.get('alice'), a);
});
