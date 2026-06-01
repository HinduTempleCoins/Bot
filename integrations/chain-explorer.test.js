// chain-explorer parsing tests — no network. A mock transport returns canned RPC results so the
// account/chain/witness/block transforms are verified deterministically.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __setFetch, chain, account, witness, block, transfers } from './chain-explorer.mjs';

// build a mock fetch that returns a given JSON-RPC result
function mockResult(result) {
  __setFetch(async () => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) }));
}

test('chain() maps global properties', async () => {
  mockResult({ head_block_number: 123, last_irreversible_block_num: 120, current_witness: 'alice', current_supply: '100 MELEK', time: '2026-01-01T00:00:00' });
  const c = await chain();
  assert.equal(c.headBlock, 123);
  assert.equal(c.irreversible, 120);
  assert.equal(c.currentWitness, 'alice');
});

test('account() maps balances + vesting', async () => {
  mockResult([{ name: 'bob', created: '2020-01-01', balance: '5.000 MELEK', savings_balance: '0', hbd_balance: '1.000 HBD', vesting_shares: '999 VESTS', post_count: 7, witness_votes: ['a', 'b'], recovery_account: 'steem' }]);
  const a = await account('bob');
  assert.equal(a.name, 'bob');
  assert.equal(a.balance, '5.000 MELEK');
  assert.equal(a.postCount, 7);
  assert.equal(a.witnessVotes.length, 2);
});

test('account() returns null when not found', async () => {
  mockResult([]);
  assert.equal(await account('nobody'), null);
});

test('witness() maps the record', async () => {
  mockResult({ owner: 'carol', url: 'https://x', running_version: '1.0', total_missed: 3, last_confirmed_block_num: 99, signing_key: 'STM1', votes: '42', props: { account_creation_fee: '1 MELEK', maximum_block_size: 65536 } });
  const w = await witness('carol');
  assert.equal(w.owner, 'carol');
  assert.equal(w.totalMissed, 3);
  assert.equal(w.props.maxBlockSize, 65536);
});

test('block() summarizes ops by type', async () => {
  mockResult({ timestamp: '2026-01-01T00:00:00', witness: 'dave', transactions: [
    { operations: [['transfer', {}], ['vote', {}]] },
    { operations: [['vote', {}]] },
  ] });
  const b = await block(42);
  assert.equal(b.num, 42);
  assert.equal(b.txCount, 2);
  assert.equal(b.opCounts.vote, 2);
  assert.equal(b.opCounts.transfer, 1);
});

test('transfers() filters to transfer ops, newest first', async () => {
  mockResult([
    [1, { timestamp: '2026-01-01', op: ['transfer', { from: 'a', to: 'b', amount: '1 MELEK', memo: '' }] }],
    [2, { timestamp: '2026-01-02', op: ['vote', { voter: 'a' }] }],
    [3, { timestamp: '2026-01-03', op: ['transfer', { from: 'c', to: 'd', amount: '2 MELEK', memo: 'hi' }] }],
  ]);
  const t = await transfers('a');
  assert.equal(t.length, 2);
  assert.equal(t[0].from, 'c'); // most recent first
  assert.equal(t[1].from, 'a');
});
