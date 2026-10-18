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

test('fetchZeroPayoutPosts scans EVERY tag in a comma-separated list and merges them', async () => {
  const asked = [];
  const now = Date.now();
  const future = new Date(now + 86400e3).toISOString().replace('Z', '');
  const old = new Date(now - 7200e3).toISOString().replace('Z', '');
  const post = (author, permlink) => ({
    author, permlink, parent_author: '', pending_payout_value: '0.000 MELEK',
    cashout_time: future, created: old,
  });
  const fakeFetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const tag = body.params[0].tag;
    asked.push(tag);
    const map = {
      '': [post('rasma', 'nft-art'), post('udabeu', 'chizzeling')],
      melek: [post('rasma', 'nft-art'), post('riyanur', 'abstract')],  // note the overlap
    };
    return { json: async () => ({ result: map[tag] || [] }) };
  };
  const out = await fetchZeroPayoutPosts({ fetch: fakeFetch, rpcUrl: 'http://x', tag: ',melek', minAgeSec: 0 });
  assert.deepEqual(asked.sort(), ['', 'melek'], 'both tags must be queried');
  const keys = out.map((p) => `${p.author}/${p.permlink}`).sort();
  assert.deepEqual(keys, ['rasma/nft-art', 'riyanur/abstract', 'udabeu/chizzeling'], 'merged and deduped');
});

test('fetchZeroPayoutPosts soft-fails one bad tag without losing the others', async () => {
  const now = Date.now();
  const future = new Date(now + 86400e3).toISOString().replace('Z', '');
  const old = new Date(now - 7200e3).toISOString().replace('Z', '');
  const fakeFetch = async (_url, opts) => {
    const tag = JSON.parse(opts.body).params[0].tag;
    if (tag === 'broken') throw new Error('rpc down');
    return {
      json: async () => ({
        result: [{ author: 'rasma', permlink: 'ok', parent_author: '', pending_payout_value: '0.000 MELEK', cashout_time: future, created: old }],
      }),
    };
  };
  const out = await fetchZeroPayoutPosts({ fetch: fakeFetch, rpcUrl: 'http://x', tag: 'broken,,melek', minAgeSec: 0 });
  assert.equal(out.length, 1, 'the surviving tags still produce a selection');
  assert.equal(out[0].author, 'rasma');
});

test('a single tag still works unchanged — the fix is backwards compatible', async () => {
  const now = Date.now();
  const future = new Date(now + 86400e3).toISOString().replace('Z', '');
  const old = new Date(now - 7200e3).toISOString().replace('Z', '');
  let seen = null;
  const fakeFetch = async (_url, opts) => {
    seen = JSON.parse(opts.body).params[0].tag;
    return { json: async () => ({ result: [{ author: 'a', permlink: 'b', parent_author: '', pending_payout_value: '0.000 MELEK', cashout_time: future, created: old }] }) };
  };
  const out = await fetchZeroPayoutPosts({ fetch: fakeFetch, rpcUrl: 'http://x', tag: 'melek', minAgeSec: 0 });
  assert.equal(seen, 'melek');
  assert.equal(out.length, 1);
});

// ── social mode (operator rule 2026-10-18): admins + posts others already upvoted, 1/author/day ─────
import { selectCurationPosts, otherUpvoters } from './zero-payout-posts.mjs';

const T0 = Date.parse('2026-10-18T12:00:00Z');
const sp = (author, permlink, voters = [], extra = {}) => ({
  author, permlink, parent_author: '', created: '2026-10-18T11:00:00', cashout_time: '2026-10-25T11:00:00',
  pending_payout_value: '0.000 MELEK', active_votes: voters.map((v) => ({ voter: v, rshares: 1000, percent: 10000 })), ...extra,
});

test('otherUpvoters ignores the author, our own accounts and downvote/zero votes', () => {
  const p = sp('juba', 'a', ['juba', 'hathor', 'megareigns']);
  p.active_votes.push({ voter: 'nobody', rshares: 0, percent: 0 });
  assert.deepEqual([...otherUpvoters(p, new Set(['hathor']))], ['megareigns']);
});

test('social mode: unvoted posts from unknowns are skipped; posts others upvoted qualify', () => {
  const out = selectCurationPosts([sp('spammer', 'x', []), sp('spammer2', 'y', ['hathor']), sp('real', 'z', ['alice'])],
    { ignoreVoters: ['hathor'], now: T0 });
  assert.deepEqual(out.map((r) => r.author), ['real']);
});

test('social mode: admins always qualify (even unvoted, even if on the affiliated exclude list) and sort first', () => {
  const out = selectCurationPosts([sp('real', 'z', ['alice']), sp('vankush', 'm', [])],
    { admins: ['vankush'], excludeAuthors: ['vankush', 'hathor'], ignoreVoters: ['hathor'], now: T0 });
  assert.deepEqual(out.map((r) => [r.author, r.admin]), [['vankush', true], ['real', false]]);
});

test('social mode: one vote per non-admin author per cooldown, across rounds and within a round', () => {
  const posts = [sp('juba', 'p1', ['megareigns']), sp('juba', 'p2', ['udabeu']), sp('sojol', 'q1', ['megareigns'])];
  const one = selectCurationPosts(posts, { now: T0 });
  assert.equal(one.filter((r) => r.author === 'juba').length, 1);
  const later = selectCurationPosts(posts, { now: T0, authorLastVoted: { juba: T0 - 3600e3 } });
  assert.deepEqual(later.map((r) => r.author), ['sojol']);
  const nextDay = selectCurationPosts(posts, { now: T0, authorLastVoted: { juba: T0 - 90000e3 } });
  assert.ok(nextDay.some((r) => r.author === 'juba'));
});

test('social mode keeps the old guards: comments, already-voted, unpayable, too-young', () => {
  const out = selectCurationPosts([
    sp('a', 'c', ['x'], { parent_author: 'b' }),
    sp('b', 'v', ['x']),
    sp('c', 'paid', ['x'], { cashout_time: '1969-12-31T23:59:59' }),
    sp('d', 'young', ['x'], { created: '2026-10-18T11:59:00' }),
  ], { alreadyVoted: new Set(['b/v']), minAgeSec: 300, now: T0 });
  assert.equal(out.length, 0);
});
