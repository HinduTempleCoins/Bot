/**
 * Tests for welcomer/discover.js.
 *
 *   node --test welcomer/discover.test.js
 *
 * Uses a hand-rolled mock client (no dhive) so we can run without network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getHeadBlockNumber, scanBlock, scanBlockRange } from './discover.js';

function mockClient({ headBlock = 1000, blocks = {} } = {}) {
  return {
    database: {
      async getDynamicGlobalProperties() {
        return { head_block_number: headBlock };
      },
      async getBlock(num) {
        return blocks[num] ?? null;
      },
    },
  };
}

const makeBlock = (ops) => ({
  timestamp: '2026-05-25T12:00:00',
  transactions: [{ operations: ops }],
});

test('getHeadBlockNumber returns head_block_number from global props', async () => {
  const client = mockClient({ headBlock: 42 });
  assert.equal(await getHeadBlockNumber(client), 42);
});

test('scanBlock returns empty array for missing block', async () => {
  const client = mockClient();
  assert.deepEqual(await scanBlock(client, 999), []);
});

test('scanBlock returns empty array for block with no ops', async () => {
  const client = mockClient({
    blocks: { 100: makeBlock([]) },
  });
  assert.deepEqual(await scanBlock(client, 100), []);
});

test('scanBlock finds account_create op', async () => {
  const client = mockClient({
    blocks: {
      100: makeBlock([
        ['account_create', { new_account_name: 'alice', creator: 'hathor' }],
      ]),
    },
  });
  const found = await scanBlock(client, 100);
  assert.equal(found.length, 1);
  assert.equal(found[0].account, 'alice');
  assert.equal(found[0].creator, 'hathor');
  assert.equal(found[0].block, 100);
});

test('scanBlock finds account_create_with_delegation op', async () => {
  const client = mockClient({
    blocks: {
      100: makeBlock([
        ['account_create_with_delegation', { new_account_name: 'bob', creator: 'someone' }],
      ]),
    },
  });
  const found = await scanBlock(client, 100);
  assert.equal(found.length, 1);
  assert.equal(found[0].account, 'bob');
  assert.equal(found[0].creator, 'someone');
});

test('scanBlock ignores non-account-create ops', async () => {
  const client = mockClient({
    blocks: {
      100: makeBlock([
        ['vote', { voter: 'alice', author: 'bob', permlink: 'x', weight: 10000 }],
        ['transfer', { from: 'alice', to: 'bob', amount: '1 MELEK', memo: '' }],
        ['comment', { author: 'alice', permlink: 'p', parent_author: '', parent_permlink: 'tag', title: 't', body: 'b' }],
      ]),
    },
  });
  assert.deepEqual(await scanBlock(client, 100), []);
});

test('scanBlock handles mixed ops in same block', async () => {
  const client = mockClient({
    blocks: {
      100: makeBlock([
        ['vote', { voter: 'a', author: 'b', permlink: 'x', weight: 10000 }],
        ['account_create', { new_account_name: 'alice', creator: 'hathor' }],
        ['transfer', { from: 'a', to: 'b', amount: '1 MELEK', memo: '' }],
        ['account_create_with_delegation', { new_account_name: 'bob', creator: 'hathor' }],
      ]),
    },
  });
  const found = await scanBlock(client, 100);
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((f) => f.account).sort(), ['alice', 'bob']);
});

test('scanBlock handles multiple transactions per block', async () => {
  const client = mockClient({
    blocks: {
      100: {
        timestamp: '2026-05-25T12:00:00',
        transactions: [
          { operations: [['account_create', { new_account_name: 'alice', creator: 'h' }]] },
          { operations: [['account_create', { new_account_name: 'bob', creator: 'h' }]] },
        ],
      },
    },
  });
  const found = await scanBlock(client, 100);
  assert.equal(found.length, 2);
});

test('scanBlockRange concatenates results across blocks', async () => {
  const client = mockClient({
    blocks: {
      100: makeBlock([['account_create', { new_account_name: 'alice', creator: 'h' }]]),
      101: makeBlock([]),
      102: makeBlock([['account_create', { new_account_name: 'bob', creator: 'h' }]]),
    },
  });
  const found = await scanBlockRange(client, 100, 102);
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((f) => f.account), ['alice', 'bob']);
  assert.equal(found[0].block, 100);
  assert.equal(found[1].block, 102);
});

test('scanBlockRange returns empty when range has no account creates', async () => {
  const client = mockClient({
    blocks: {
      100: makeBlock([['vote', { voter: 'a', author: 'b', permlink: 'x', weight: 10000 }]]),
      101: makeBlock([]),
    },
  });
  assert.deepEqual(await scanBlockRange(client, 100, 101), []);
});

test('scanBlock skips ops with missing new_account_name (defensive)', async () => {
  const client = mockClient({
    blocks: {
      100: makeBlock([
        ['account_create', { creator: 'h' }], // missing new_account_name — should be skipped
      ]),
    },
  });
  assert.deepEqual(await scanBlock(client, 100), []);
});
