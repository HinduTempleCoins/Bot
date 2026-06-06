// spamtest/probe.test.mjs — offline (injected fetch). Run: node --test spamtest/probe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __setFetch, fetchConfig, fetchCadence, probe } from './probe.mjs';

// a fake node that returns canned results for the legacy `call` envelope.
function fakeNode(map) {
  return async (_url, { body }) => {
    const { params } = JSON.parse(body);
    const [, method] = params;          // ["condenser_api","<method>", [...]]
    if (!(method in map)) return { json: async () => ({ error: { message: 'no method ' + method } }) };
    const v = map[method];
    const result = typeof v === 'function' ? v(params[2]) : v;
    return { json: async () => ({ result }) };
  };
}

test('fetchConfig returns the live config object', async () => {
  __setFetch(fakeNode({ get_config: { STEEM_MIN_ROOT_COMMENT_INTERVAL: 300_000_000 } }));
  const c = await fetchConfig({ rpcUrl: 'http://x' });
  assert.equal(c.STEEM_MIN_ROOT_COMMENT_INTERVAL, 300_000_000);
  __setFetch(null);
});

test('fetchCadence computes gaps between successive ops by kind', async () => {
  const t0 = '2026-06-06T00:00:00';
  const t1 = '2026-06-06T00:05:00';   // +300s
  const t2 = '2026-06-06T00:05:20';   // +20s reply
  const history = [
    [0, { op: ['comment', { author: 'spambot1', parent_author: '', permlink: 'a' }], timestamp: t0 }],
    [1, { op: ['comment', { author: 'spambot1', parent_author: '', permlink: 'b' }], timestamp: t1 }],
    [2, { op: ['comment', { author: 'spambot1', parent_author: 'x', permlink: 'c' }], timestamp: t2 }],
    [3, { op: ['vote', { voter: 'spambot1', author: 'x', permlink: 'y' }], timestamp: t2 }],
  ];
  __setFetch(fakeNode({ get_account_history: history }));
  const c = await fetchCadence('spambot1', { rpcUrl: 'http://x' });
  assert.equal(c.count.post, 2);
  assert.deepEqual(c.gapsSec.post, [300]);
  assert.equal(c.count.comment, 1);
  assert.equal(c.count.vote, 1);
  __setFetch(null);
});

test('probe soft-fails to defaults when the RPC throws', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const r = await probe({ rpcUrl: 'http://dead' });
  assert.equal(r.live, false);
  assert.equal(r.enforced.rootPostEverySec, 300);   // decoded defaults still reported
  __setFetch(null);
});

test('probe reports enforced limits + account cadence from live config', async () => {
  __setFetch(fakeNode({
    get_config: { STEEM_MIN_ROOT_COMMENT_INTERVAL: 300_000_000, STEEM_MIN_REPLY_INTERVAL: 20_000_000 },
    get_dynamic_global_properties: { head_block_number: 100, current_witness: 'hathor', available_account_subsidies: 5, vote_power_reserve_rate: 50, target_votes_per_period: 50 },
    get_accounts: [{ name: 'spambot1', vesting_shares: '0.45 VESTS', voting_power: 9800 }],
    get_account_history: [],
  }));
  const r = await probe({ rpcUrl: 'http://x', account: 'spambot1' });
  assert.equal(r.live, true);
  assert.equal(r.enforced.rootPostEverySec, 300);
  assert.equal(r.enforced.replyEverySec, 20);
  assert.equal(r.dgp.currentWitness, 'hathor');
  assert.equal(r.account.exists, true);
  __setFetch(null);
});
