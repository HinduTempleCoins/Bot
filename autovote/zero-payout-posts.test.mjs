import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isZeroPayout, isPayable, selectZeroPayoutPosts, fetchZeroPayoutPosts, runZeroPayoutRound,
} from './zero-payout-posts.mjs';

const NOW = Date.parse('2026-08-30T12:00:00Z');
const future = '2026-09-04T11:00:00';   // inside payout window
const paidSentinel = '1969-12-31T23:59:59'; // Graphene "already paid"

const post = (o) => ({ author: 'a', permlink: 'p', pending_payout_value: '0.000 MELEK', created: '2026-08-30T11:00:00', cashout_time: future, ...o });

test('isZeroPayout: only true when nothing has accrued', () => {
  assert.equal(isZeroPayout({ pending_payout_value: '0.000 MELEK' }), true);
  assert.equal(isZeroPayout({ pending_payout_value: '12.500 MELEK' }), false);
  assert.equal(isZeroPayout({ pending_payout: '0.001' }), false);
  assert.equal(isZeroPayout({}), true); // missing → 0
});

test('isPayable: future cashout yes, past/sentinel/epoch no, missing yes', () => {
  assert.equal(isPayable({ cashout_time: future }, NOW), true);
  assert.equal(isPayable({ cashout_time: '2026-08-30T11:00:00' }, NOW), false); // already past
  assert.equal(isPayable({ cashout_time: paidSentinel }, NOW), false);
  assert.equal(isPayable({}, NOW), true); // no cashout_time → soft-payable
});

test('selectZeroPayoutPosts keeps only fresh, unrewarded, payable, top-level posts', () => {
  const posts = [
    post({ author: 'newbie', permlink: 'p1' }),                                   // keep
    post({ author: 'whale', permlink: 'p3', pending_payout_value: '12.5 MELEK' }), // drop: has payout
    post({ author: 'old', permlink: 'p2', cashout_time: paidSentinel }),          // drop: already paid
    post({ author: 'x', permlink: 'c1', parent_author: 'y' }),                    // drop: comment
    post({ author: '', permlink: 'p9' }),                                          // drop: no author
  ];
  const out = selectZeroPayoutPosts(posts, { now: NOW });
  assert.deepEqual(out.map((r) => `${r.author}/${r.permlink}`), ['newbie/p1']);
});

test('selectZeroPayoutPosts honors excludeAuthors, alreadyVoted, age + limit', () => {
  const posts = [
    post({ author: 'hathor', permlink: 'self' }),                     // excluded author
    post({ author: 'dup', permlink: 'seen' }),                        // already voted
    post({ author: 'tooyoung', permlink: 'y', created: '2026-08-30T11:59:00' }), // 60s old
    post({ author: 'good', permlink: 'g', created: '2026-08-30T10:00:00' }),
  ];
  const out = selectZeroPayoutPosts(posts, {
    now: NOW,
    excludeAuthors: ['Hathor'],                 // case-insensitive
    alreadyVoted: new Set(['dup/seen']),
    minAgeSec: 300,                             // drop the 60s-old post
    limit: 5,
  });
  assert.deepEqual(out.map((r) => r.author), ['good']);
});

test('selectZeroPayoutPosts sorts freshest-first, deterministic', () => {
  const posts = [
    post({ author: 'b', permlink: 'x', created: '2026-08-30T09:00:00' }),
    post({ author: 'a', permlink: 'y', created: '2026-08-30T11:30:00' }),
    post({ author: 'a', permlink: 'z', created: '2026-08-30T11:30:00' }),
  ];
  const out = selectZeroPayoutPosts(posts, { now: NOW });
  assert.deepEqual(out.map((r) => `${r.author}/${r.permlink}`), ['a/y', 'a/z', 'b/x']);
});

test('selectZeroPayoutPosts never throws on junk', () => {
  assert.doesNotThrow(() => selectZeroPayoutPosts(null));
  assert.doesNotThrow(() => selectZeroPayoutPosts([null, undefined, 42, {}]));
  assert.deepEqual(selectZeroPayoutPosts('nope'), []);
});

test('runZeroPayoutRound casts votes, dedupes, caps at topN, soft-fails', async () => {
  const votes = [];
  const castVote = async (v) => { if (v.permlink === 'boom') throw new Error('rc'); votes.push(v); return { id: 'tx_' + v.permlink }; };
  const posts = [
    { author: 'a', permlink: 'p1' }, { author: 'a', permlink: 'boom' },
    { author: 'b', permlink: 'p2' }, { author: 'c', permlink: 'p3' },
  ];
  const seen = new Set(['b/p2']); // pre-voted
  const res = await runZeroPayoutRound({ curator: { account: 'hathor' }, posts, castVote, weight: 3000, topN: 3, alreadyVoted: seen });
  // topN=3 → considers p1, boom, p2(skipped dup); p1 votes, boom throws (soft), p2 deduped
  assert.deepEqual(votes.map((v) => v.permlink), ['p1']);
  assert.equal(res.considered, 3);
  assert.equal(res.cast.length, 1);
  assert.ok(seen.has('a/p1'));
});

test('runZeroPayoutRound guards bad input', async () => {
  assert.deepEqual((await runZeroPayoutRound({})).cast, []);
  assert.deepEqual((await runZeroPayoutRound({ curator: { account: 'h' }, castVote: 1 })).cast, []);
});

test('fetchZeroPayoutPosts uses injected fetch + soft-fails', async () => {
  const fakeFetch = async () => ({ json: async () => ({ result: [post({ author: 'newbie', permlink: 'p1' })] }) });
  const out = await fetchZeroPayoutPosts({ fetch: fakeFetch, rpcUrl: 'http://rpc', tag: 'melek', now: NOW });
  assert.deepEqual(out.map((r) => r.author), ['newbie']);

  assert.deepEqual(await fetchZeroPayoutPosts({ rpcUrl: 'http://rpc' }), []);   // no fetch
  assert.deepEqual(await fetchZeroPayoutPosts({ fetch: fakeFetch }), []);        // no rpcUrl
  const boom = async () => { throw new Error('net'); };
  assert.deepEqual(await fetchZeroPayoutPosts({ fetch: boom, rpcUrl: 'http://rpc' }), []); // throws → []
});
