/**
 * tutorial/chain-reader.test.mjs — OFFLINE tests for the tutorial chain reader.
 *
 * No network: every RPC call is served by an injected fake node. The point of
 * these tests is the CONTRACT with tutorial/detector.js — the reader's output is
 * fed straight into detectCompletedStages() and the stages must light up.
 *
 *   node --test tutorial/chain-reader.test.mjs
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchUserActivity,
  emptyActivity,
  toDetectorShape,
  KIND_COVERAGE,
  esc,
  __setFetch,
} from './chain-reader.mjs';
import { detectCompletedStages, nextStageFor } from './detector.js';

afterEach(() => __setFetch(null));

const RPC = 'http://fake-rpc.invalid';

/** A fake Graphene node. `routes` maps an RPC method to a result (or fn(params)). */
function fakeNode(routes) {
  return async (_url, opts) => {
    const { method, params } = JSON.parse(opts.body);
    const short = method.split('.').pop();
    const hit = Object.prototype.hasOwnProperty.call(routes, method)
      ? routes[method]
      : (Object.prototype.hasOwnProperty.call(routes, short) ? routes[short] : null);
    const result = typeof hit === 'function' ? hit(params) : hit;
    return { ok: true, json: async () => ({ result: result ?? null }) };
  };
}

/** account-history entries: [seq, { timestamp, op: [name, payload] }] */
const hist = (ops, startSeq = 0) =>
  ops.map((op, i) => [startSeq + i, { timestamp: '2026-06-01T00:00:0' + (i % 10), op }]);

const LONG = 'x'.repeat(900); // clears both min_body_chars (200) and (800)

// ---- the detector contract --------------------------------------------------

test('produces the exact userActivity shape detector.js expects, and stages 1-6 detect', async () => {
  const acc = 'newcomer';
  const node = fakeNode({
    get_accounts: [{
      name: acc,
      witness_votes: ['hathor', 'someguy'],
      posting_json_metadata: JSON.stringify({ profile: { name: 'New Comer', about: 'hello' } }),
    }],
    get_discussions_by_author_before_date: [
      {
        author: acc,
        permlink: 'hello-melek',
        title: 'Hello',
        body: LONG,
        json_metadata: JSON.stringify({ tags: ['introduceyourself', 'melek'] }),
        created: '2026-06-01T00:00:00',
      },
      {
        author: acc,
        permlink: 'how-to-witness',
        title: 'How to run a witness',
        body: LONG,
        json_metadata: JSON.stringify({ tags: ['howto'] }),
        created: '2026-06-02T00:00:00',
      },
    ],
    get_following: [
      { follower: acc, following: 'alice', what: ['blog'] },
      { follower: acc, following: 'bob', what: ['blog'] },
      { follower: acc, following: '@carol', what: ['blog'] },
    ],
    get_account_history: hist([
      // three substantive comments on three distinct OTHER authors
      ['comment', { author: acc, permlink: 'r1', parent_author: 'alice', parent_permlink: 'p1', body: 'y'.repeat(120) }],
      ['comment', { author: acc, permlink: 'r2', parent_author: 'bob', parent_permlink: 'p2', body: 'y'.repeat(120) }],
      ['comment', { author: acc, permlink: 'r3', parent_author: 'carol', parent_permlink: 'p3', body: 'y'.repeat(120) }],
      // an upvote from Hathor (does NOT count) and one organic upvote (does)
      ['vote', { voter: 'hathor', author: acc, permlink: 'hello-melek', weight: 10000 }],
      ['vote', { voter: 'dax', author: acc, permlink: 'hello-melek', weight: 5000 }],
      // a vote the user CAST on someone else — must not be counted as received
      ['vote', { voter: acc, author: 'alice', permlink: 'p1', weight: 10000 }],
      // power-up
      ['transfer_to_vesting', { from: acc, to: acc, amount: '5.000 MELEK' }],
      // stage 9 + 10
      ['transfer', { from: acc, to: 'alice', amount: '0.100 MELEK', memo: 'thanks' }],
      ['delegate_vesting_shares', { delegator: acc, delegatee: 'bob', vesting_shares: '1000.000000 VESTS' }],
    ]),
  });

  const a = await fetchUserActivity(acc, { rpcUrl: RPC, fetch: node });

  // exact key set detector.js reads
  for (const k of ['posts', 'comments', 'votes_received', 'transfers_to_vesting', 'witness_votes']) {
    assert.ok(Array.isArray(a[k]), `${k} is an array`);
  }
  assert.equal(a.meta.ok, true);

  // per-item field names
  assert.deepEqual(Object.keys(a.votes_received[0]).sort(), ['author', 'permlink', 'time', 'voter', 'weight']);
  assert.deepEqual(Object.keys(a.transfers_to_vesting[0]).sort(), ['amount', 'from', 'timestamp', 'to']);
  assert.deepEqual(Object.keys(a.witness_votes[0]).sort(), ['approve', 'witness']);

  // role filtering: only votes RECEIVED, and the self-cast vote excluded
  assert.equal(a.votes_received.length, 2);
  assert.ok(a.votes_received.every((v) => v.author === acc));

  // hand it to the real detector
  const d = detectCompletedStages(a);
  assert.equal(d.intro_post.complete, true, 'stage 1');
  assert.equal(d.engage_three_posts.complete, true, 'stage 2');
  assert.equal(d.share_what_you_know.complete, true, 'stage 3');
  assert.equal(d.first_organic_upvote.complete, true, 'stage 4');
  assert.equal(d.first_organic_upvote.evidence.voter, 'dax', 'hathor excluded as non-organic');
  assert.equal(d.power_up.complete, true, 'stage 5');
  assert.equal(d.vote_for_a_witness.complete, true, 'stage 6');
  assert.equal(nextStageFor(a), null, 'all detectable stages complete');

  // stages 7-10 extras
  assert.equal(a.profile.name, 'New Comer');
  assert.equal(a.follows.length, 3);
  assert.ok(a.follows.some((fw) => fw.following === 'carol'), 'leading @ stripped');
  assert.equal(a.transfers_sent.length, 1);
  assert.equal(a.delegations.length, 1);
  assert.equal(a.delegations[0].delegatee, 'bob');
});

// ---- soft-fail --------------------------------------------------------------

test('a dead RPC returns the empty shape, never throws', async () => {
  const dead = async () => { throw new Error('ECONNREFUSED'); };
  const a = await fetchUserActivity('newcomer', { rpcUrl: RPC, fetch: dead });
  assert.equal(a.meta.ok, false);
  assert.ok(a.meta.errors.length > 0);
  assert.deepEqual(toDetectorShape(a), {
    posts: [], comments: [], votes_received: [], transfers_to_vesting: [], witness_votes: [],
  });
  // and the detector is happy to consume it
  const d = detectCompletedStages(a);
  assert.equal(Object.values(d).every((s) => s.complete === false), true);
  assert.equal(nextStageFor(a).key, 'intro_post');
});

test('a partial RPC (one method errors, one returns junk) still yields the other collections', async () => {
  const acc = 'newcomer';
  const node = async (_url, opts) => {
    const { method } = JSON.parse(opts.body);
    if (method.endsWith('get_discussions_by_author_before_date')) {
      return { ok: true, json: async () => ({ error: { message: 'no tags plugin' } }) };
    }
    if (method.endsWith('get_following')) return { ok: false, status: 503, json: async () => ({}) };
    if (method.endsWith('get_accounts')) return { ok: true, json: async () => ({ result: 'not-an-array' }) };
    return {
      ok: true,
      json: async () => ({
        result: hist([['transfer_to_vesting', { from: acc, to: acc, amount: '2.000 MELEK' }]]),
      }),
    };
  };
  const a = await fetchUserActivity(acc, { rpcUrl: RPC, fetch: node });
  assert.equal(a.transfers_to_vesting.length, 1);
  assert.equal(a.posts.length, 0);
  assert.equal(a.witness_votes.length, 0);
  assert.equal(a.meta.errors.length, 2, 'the rpc error and the http 503 were recorded');
  assert.equal(detectCompletedStages(a).power_up.complete, true);
});

test('malformed JSON / missing account / missing rpcUrl are soft', async () => {
  const garbage = async () => ({ ok: true, json: async () => { throw new Error('bad json'); } });
  const a = await fetchUserActivity('newcomer', { rpcUrl: RPC, fetch: garbage });
  assert.equal(a.meta.ok, false);

  const b = await fetchUserActivity('', { rpcUrl: RPC, fetch: garbage });
  assert.equal(b.account, '');
  assert.deepEqual(b.meta.errors, ['no account']);

  const c = await fetchUserActivity('newcomer', { rpcUrl: '', fetch: garbage });
  assert.deepEqual(c.meta.errors, ['no rpcUrl']);
});

// ---- op-shape + fallback paths ---------------------------------------------

test('appbase {type,value} op shape is normalized like the condenser array shape', async () => {
  const acc = 'newcomer';
  const node = fakeNode({
    get_account_history: [
      [0, { timestamp: '2026-06-01T00:00:00', op: { type: 'transfer_to_vesting_operation', value: { from: acc, to: acc, amount: '3.000 MELEK' } } }],
      [1, { timestamp: '2026-06-01T00:00:01', op: { type: 'curation_reward_operation', value: { curator: acc, comment_author: 'alice', comment_permlink: 'p1', reward: '0.100000 VESTS' } } }],
      [2, { timestamp: '2026-06-01T00:00:02', op: { type: 'fill_order_operation', value: { current_owner: acc, current_pays: '1.000 MELEK', open_owner: 'alice', open_pays: '2.000 MBD' } } }],
      [3, 'malformed'],
      'also-malformed',
    ],
  });
  const a = await fetchUserActivity(acc, { rpcUrl: RPC, fetch: node });
  assert.equal(a.transfers_to_vesting[0].amount, '3.000 MELEK');
  assert.equal(a.curation_rewards.length, 1);
  assert.equal(a.market_trades.length, 1);
  assert.equal(a.market_trades[0].open_owner, 'alice');
});

test('posts fall back to history comment ops when the discussions API is unavailable', async () => {
  const acc = 'newcomer';
  const node = fakeNode({
    get_discussions_by_author_before_date: null, // plugin absent
    get_account_history: hist([
      // parent_permlink of a ROOT comment IS the primary tag on Graphene
      ['comment', { author: acc, permlink: 'intro', parent_author: '', parent_permlink: 'introduceyourself', title: 'Hi', body: LONG, json_metadata: '{}' }],
      ['comment', { author: 'someoneelse', permlink: 'x', parent_author: '', parent_permlink: 'introduceyourself', title: 'Hi', body: LONG }],
    ]),
  });
  const a = await fetchUserActivity(acc, { rpcUrl: RPC, fetch: node });
  assert.equal(a.posts.length, 1, "another author's post is not attributed to this account");
  assert.deepEqual(a.posts[0].tags, ['introduceyourself']);
  assert.equal(detectCompletedStages(a).intro_post.complete, true);
  assert.ok(a.meta.sources.includes('posts-from-history'));
});

test('follows fall back to the follow custom_json when get_following is off', async () => {
  const acc = 'newcomer';
  const node = fakeNode({
    get_following: [],
    get_account_history: hist([
      ['custom_json', { id: 'follow', json: JSON.stringify(['follow', { follower: acc, following: 'alice', what: ['blog'] }]) }],
      ['custom_json', { id: 'follow', json: JSON.stringify(['follow', { follower: 'other', following: 'bob', what: ['blog'] }]) }],
      ['custom_json', { id: 'ssc-mainnet-hive', json: '{}' }],
    ]),
  });
  const a = await fetchUserActivity(acc, { rpcUrl: RPC, fetch: node });
  assert.equal(a.follows.length, 1);
  assert.equal(a.follows[0].following, 'alice');
});

test('an account_witness_vote un-vote (approve:false) overrides the account record', async () => {
  const acc = 'newcomer';
  const node = fakeNode({
    get_accounts: [{ name: acc, witness_votes: ['hathor'] }],
    get_account_history: hist([
      ['account_witness_vote', { account: acc, witness: 'hathor', approve: true }],
      ['account_witness_vote', { account: acc, witness: 'hathor', approve: false }],
    ]),
  });
  const a = await fetchUserActivity(acc, { rpcUrl: RPC, fetch: node });
  assert.deepEqual(a.witness_votes, [{ witness: 'hathor', approve: false }]);
  assert.equal(detectCompletedStages(a).vote_for_a_witness.complete, false);
});

test('a third party powering up TO the account does not complete stage 5', async () => {
  const acc = 'newcomer';
  const node = fakeNode({
    get_account_history: hist([
      ['transfer_to_vesting', { from: 'patron', to: acc, amount: '100.000 MELEK' }],
      ['transfer', { from: 'patron', to: acc, amount: '5.000 MELEK', memo: 'gift' }],
    ]),
  });
  const a = await fetchUserActivity(acc, { rpcUrl: RPC, fetch: node });
  assert.equal(a.transfers_to_vesting.length, 0);
  assert.equal(a.transfers_sent.length, 0, 'incoming transfers are not "sent"');
  assert.equal(detectCompletedStages(a).power_up.complete, false);
});

// ---- history paging ---------------------------------------------------------

test('history pages backwards by sequence when maxOps exceeds one page', async () => {
  const acc = 'newcomer';
  const calls = [];
  const node = async (_url, opts) => {
    const { method, params } = JSON.parse(opts.body);
    if (!method.endsWith('get_account_history')) return { ok: true, json: async () => ({ result: null }) };
    const [, from, limit] = params;
    calls.push([from, limit]);
    // Pretend the account has 3 ops total, at sequences 0,1,2.
    if (from === -1) return { ok: true, json: async () => ({ result: hist([['transfer', { from: acc, to: 'a', amount: '1.000 MELEK', memo: '' }]], 2) }) };
    return { ok: true, json: async () => ({ result: hist([['transfer', { from: acc, to: 'b', amount: '1.000 MELEK', memo: '' }], ['transfer', { from: acc, to: 'c', amount: '1.000 MELEK', memo: '' }]], 0) }) };
  };
  const a = await fetchUserActivity(acc, { rpcUrl: RPC, fetch: node, maxOps: 3 });
  assert.equal(a.transfers_sent.length, 3);
  assert.deepEqual(calls[0], [-1, 3]);
  assert.deepEqual(calls[1], [1, 1], 'second page starts below the lowest seq seen, limit clamped to from');
  assert.equal(a.meta.ops, 3);
});

// ---- documented gaps --------------------------------------------------------

test('kinds with no standard Graphene read stay EMPTY and say why', async () => {
  const acc = 'newcomer';
  const node = fakeNode({ get_account_history: hist([['comment', { author: acc, permlink: 'r', parent_author: 'hathor', parent_permlink: 'p', body: 'hi' }]]) });
  const a = await fetchUserActivity(acc, { rpcUrl: RPC, fetch: node });
  for (const k of ['community_posts', 'smt_events', 'video_posts', 'wiki_edits', 'bridge_transfers', 'welcomes']) {
    assert.deepEqual(a[k], [], `${k} is empty by design`);
  }
  // conversations surface raw candidate turns only — no completion judgement
  assert.equal(a.conversations.length, 1);
  assert.equal(a.conversations[0].with, 'hathor');

  const unsupported = Object.entries(KIND_COVERAGE).filter(([, v]) => !v.supported);
  assert.ok(unsupported.length >= 6);
  for (const [kind, v] of unsupported) {
    assert.ok(v.reason && v.reason.length > 10, `${kind} states a reason`);
  }
  // every kind in stages.json is accounted for in KIND_COVERAGE
  const { stages } = JSON.parse(
    await import('node:fs/promises').then((m) => m.readFile(new URL('./stages.json', import.meta.url), 'utf8')),
  );
  for (const s of stages) {
    assert.ok(KIND_COVERAGE[s.completion_criteria.kind], `kind ${s.completion_criteria.kind} is documented`);
  }
});

// ---- seams ------------------------------------------------------------------

test('__setFetch injects a module-level fetch; emptyActivity/esc behave', async () => {
  let called = 0;
  __setFetch(async (_u, o) => {
    called++;
    const { method } = JSON.parse(o.body);
    return { ok: true, json: async () => ({ result: method.endsWith('get_accounts') ? [{ name: 'z', witness_votes: ['hathor'] }] : null }) };
  });
  const a = await fetchUserActivity('z', { rpcUrl: RPC });
  assert.ok(called > 0, 'the injected fetch was used — no network');
  assert.deepEqual(a.witness_votes, [{ witness: 'hathor', approve: true }]);

  const e = emptyActivity('Someone');
  assert.equal(e.account, 'someone');
  assert.equal(e.meta.ok, false);
  assert.equal(esc('<script>&"\''), '&lt;script&gt;&amp;&quot;&#39;');
});
