// auto-claim.test.mjs — OFFLINE: what gets claimed, and for whom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimOp, signerUsers, runAutoClaim, __setFetch } from './auto-claim.mjs';

test('claims everything waiting, nothing when empty', () => {
  const op = claimOp({ name: 'udabeu', reward_steem_balance: '0.000 MELEK', reward_sbd_balance: '0.000 MBD', reward_vesting_balance: '0.570834 VESTS' });
  assert.deepEqual(op, ['claim_reward_balance', { account: 'udabeu', reward_steem: '0.000 MELEK', reward_sbd: '0.000 MBD', reward_vests: '0.570834 VESTS' }]);
  assert.equal(claimOp({ name: 'x', reward_steem_balance: '0.000 MELEK', reward_sbd_balance: '0.000 MBD', reward_vesting_balance: '0.000000 VESTS' }), null);
});

test('only MELEK users signed in with MELEK-Signer', () => {
  const u = signerUsers({ users: { 'melek:a': { account: 'a', chain: 'melek', msToken: 't' }, 'hive:b': { account: 'b', chain: 'hive', token: 'h' }, 'melek:c': { account: 'c', chain: 'melek' } } });
  assert.deepEqual(u, [{ account: 'a', token: 't' }]);
});

test('a token without the scope is reported, not retried as an error', async () => {
  __setFetch(async (url) => ({ json: async () => (String(url).includes('/rpc') || String(url).includes('melek.salon/rpc')
    ? { result: [{ name: 'a', reward_steem_balance: '0.000 MELEK', reward_sbd_balance: '0.000 MBD', reward_vesting_balance: '1.000000 VESTS' }] }
    : { ok: false, error: "op 'claim_reward_balance' not in token scope [vote]" }) }));
  const [r] = await runAutoClaim({ users: [{ account: 'a', token: 't' }] });
  assert.equal(r.claimed, false); assert.match(r.reason, /sign in to Auto-Vote again/);
  __setFetch(null);
});
