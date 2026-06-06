/**
 * Tests for the Welcomer orchestrator class (welcomer/index.js).
 *
 *   node --test welcomer/index.test.js
 *
 * The CLI wrapper is exercised manually; the class is exercised here with
 * a mocked dhive client and a temp-file state store.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Welcomer } from './index.js';
import { WelcomerState } from './state.js';

const makeBlock = (ops) => ({
  timestamp: '2026-05-25T12:00:00',
  transactions: [{ operations: ops }],
});

const accountCreate = (newName, creator = 'hathor') =>
  ['account_create_with_delegation', { new_account_name: newName, creator }];

// The read-only chain client. After PRE-SIGNER 2 it is NEVER used for broadcast
// — broadcasting goes through the injected MELEK-Signer client (makeSigner()).
function mockClient({ headBlock = 1000, blocks = {}, accounts = {}, posts = {} } = {}) {
  return {
    database: {
      async getDynamicGlobalProperties() { return { head_block_number: headBlock }; },
      async getBlock(num) { return blocks[num] ?? null; },
      async getAccounts(names) {
        return names.map((n) => accounts[n] ?? null).filter(Boolean);
      },
      async call(method, params) {
        // dhive: client.database.call(method, params) — two args, not three.
        if (method === 'get_content') {
          const [author, permlink] = params;
          return posts[`${author}/${permlink}`] ?? { author: '', permlink: '' };
        }
        throw new Error(`mock: unmocked call ${method}`);
      },
    },
  };
}

// A capturing MELEK-Signer client ({ broadcast(ops, { clientRef }) }). `sent`
// mirrors the old client.sent shape: an array of op-arrays, one per broadcast.
function makeSigner({ throws = null, broadcastResult } = {}) {
  const sent = [];
  return {
    sent,
    async broadcast(ops, _meta = {}) {
      if (throws) throw new Error(throws);
      sent.push(ops);
      return broadcastResult ?? { id: `tx-${sent.length}` };
    },
  };
}

function makeConfig(overrides = {}) {
  return {
    chain: { rpcUrl: 'http://mock', chainId: 'x', addressPrefix: 'BLT' },
    welcomePost: { author: 'hathor', permlink: 'welcome-to-melek' },
    bot: { account: 'hathor' },
    signer: { url: 'http://signer.test', token: 'tok-welcomer' },
    tutorialLink: 'https://example.test/start',
    statePath: null,
    skipAccounts: new Set(['hathor']),
    cronExpr: '*/2 * * * *',
    batchBlocks: 50,
    ...overrides,
  };
}

function tempStatePath() {
  const dir = mkdtempSync(join(tmpdir(), 'melek-welcomer-int-'));
  return { path: join(dir, 'state.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const silentLogger = { log: () => {}, error: () => {} };

test('startupHealthChecks passes when account + post both exist', async () => {
  const client = mockClient({
    accounts: { hathor: { name: 'hathor' } },
    posts: { 'hathor/welcome-to-melek': { author: 'hathor', permlink: 'welcome-to-melek' } },
  });
  const { path, cleanup } = tempStatePath();
  try {
    const w = new Welcomer({ config: makeConfig(), state: new WelcomerState({ path }), client, logger: silentLogger, signer: makeSigner() });
    await w.startupHealthChecks(); // does not throw
  } finally { cleanup(); }
});

test('startupHealthChecks throws when bot account missing', async () => {
  const client = mockClient({
    accounts: {},
    posts: { 'hathor/welcome-to-melek': { author: 'hathor', permlink: 'welcome-to-melek' } },
  });
  const { path, cleanup } = tempStatePath();
  try {
    const w = new Welcomer({ config: makeConfig(), state: new WelcomerState({ path }), client, logger: silentLogger, signer: makeSigner() });
    await assert.rejects(() => w.startupHealthChecks(), /BOT_ACCOUNT/);
  } finally { cleanup(); }
});

test('startupHealthChecks throws when welcome post missing', async () => {
  const client = mockClient({
    accounts: { hathor: { name: 'hathor' } },
    posts: {},
  });
  const { path, cleanup } = tempStatePath();
  try {
    const w = new Welcomer({ config: makeConfig(), state: new WelcomerState({ path }), client, logger: silentLogger, signer: makeSigner() });
    await assert.rejects(() => w.startupHealthChecks(), /Welcome post/);
  } finally { cleanup(); }
});

test('tick bootstraps from head block on first run (no backfill spam)', async () => {
  const client = mockClient({
    headBlock: 500,
    blocks: {
      // every recent block has an account create — if we backfilled we'd
      // welcome a ton of users. We should NOT.
      499: makeBlock([accountCreate('shouldnotwelcome1')]),
      500: makeBlock([accountCreate('shouldnotwelcome2')]),
    },
  });
  const { path, cleanup } = tempStatePath();
  try {
    const state = new WelcomerState({ path });
    const signer = makeSigner();
    const w = new Welcomer({ config: makeConfig(), state, client, logger: silentLogger, signer });
    await w.tick({ broadcast: false });
    assert.equal(state.getLastProcessedBlock(), 500, 'cursor should be at head after bootstrap');
    assert.deepEqual(state.accounts(), [], 'no accounts should have been recorded on bootstrap');
    assert.equal(signer.sent.length, 0);
  } finally { cleanup(); }
});

test('tick discovers and dry-runs welcomes for accounts in subsequent blocks', async () => {
  const client = mockClient({
    headBlock: 502,
    blocks: {
      501: makeBlock([accountCreate('alice')]),
      502: makeBlock([accountCreate('bob')]),
    },
  });
  const { path, cleanup } = tempStatePath();
  try {
    const state = new WelcomerState({ path });
    state.setLastProcessedBlock(500); // simulate already-bootstrapped
    const signer = makeSigner();
    const w = new Welcomer({ config: makeConfig(), state, client, logger: silentLogger, signer });
    await w.tick({ broadcast: false });
    assert.deepEqual(state.accounts().sort(), ['alice', 'bob']);
    assert.equal(state.hasWelcomed('alice'), true, 'dry-run marks accounts welcomed');
    assert.equal(state.hasWelcomed('bob'), true);
    assert.equal(signer.sent.length, 0, 'dry-run should NOT broadcast');
  } finally { cleanup(); }
});

test('tick with broadcast=true actually broadcasts a comment per account', async () => {
  const client = mockClient({
    headBlock: 501,
    blocks: { 501: makeBlock([accountCreate('alice')]) },
  });
  const { path, cleanup } = tempStatePath();
  try {
    const state = new WelcomerState({ path });
    state.setLastProcessedBlock(500);
    const signer = makeSigner();
    const w = new Welcomer({ config: makeConfig(), state, client, logger: silentLogger, signer });
    await w.tick({ broadcast: true });
    assert.equal(signer.sent.length, 1);
    const [opName, opVal] = signer.sent[0][0];
    assert.equal(opName, 'comment');
    assert.equal(opVal.parent_author, 'hathor');
    assert.equal(opVal.parent_permlink, 'welcome-to-melek');
    assert.equal(opVal.author, 'hathor');
    assert.ok(opVal.body.includes('@alice'));
    assert.equal(state.hasWelcomed('alice'), true);
  } finally { cleanup(); }
});

test('tick respects skip list', async () => {
  const client = mockClient({
    headBlock: 501,
    blocks: {
      501: makeBlock([
        accountCreate('hathor'),       // skipped (self)
        accountCreate('hathor-treasury'), // skipped (in list)
        accountCreate('alice'),         // welcomed
      ]),
    },
  });
  const { path, cleanup } = tempStatePath();
  try {
    const state = new WelcomerState({ path });
    state.setLastProcessedBlock(500);
    const config = makeConfig({ skipAccounts: new Set(['hathor', 'hathor-treasury']) });
    const w = new Welcomer({ config, state, client, logger: silentLogger });
    await w.tick({ broadcast: false });
    assert.deepEqual(state.accounts(), ['alice']);
  } finally { cleanup(); }
});

test('tick does not re-welcome already-welcomed accounts', async () => {
  const client = mockClient({
    headBlock: 501,
    blocks: { 501: makeBlock([accountCreate('alice')]) },
  });
  const { path, cleanup } = tempStatePath();
  try {
    const state = new WelcomerState({ path });
    state.setLastProcessedBlock(500);
    state.recordWelcome('alice', { txId: 'previous-run' });
    const signer = makeSigner();
    const w = new Welcomer({ config: makeConfig(), state, client, logger: silentLogger, signer });
    await w.tick({ broadcast: true });
    assert.equal(signer.sent.length, 0, 'should not re-broadcast for already-welcomed account');
    assert.equal(state.data.accounts.alice.txId, 'previous-run', 'original tx id preserved');
  } finally { cleanup(); }
});

test('tick batches large block ranges to batchBlocks per call', async () => {
  // headBlock far ahead of cursor — should only scan batchBlocks in one tick.
  const blocks = {};
  for (let i = 1; i <= 200; i++) blocks[i] = makeBlock([]);
  blocks[200] = makeBlock([accountCreate('lastoneup')]);
  const client = mockClient({ headBlock: 200, blocks });
  const { path, cleanup } = tempStatePath();
  try {
    const state = new WelcomerState({ path });
    state.setLastProcessedBlock(0);
    const config = makeConfig({ batchBlocks: 50 });
    const w = new Welcomer({ config, state, client, logger: silentLogger });
    await w.tick({ broadcast: false });
    assert.equal(state.getLastProcessedBlock(), 50, 'cursor should only advance by batchBlocks');
  } finally { cleanup(); }
});

test('broadcast failure leaves account NOT welcomed (so it retries next tick)', async () => {
  const client = mockClient({
    headBlock: 501,
    blocks: { 501: makeBlock([accountCreate('alice')]) },
  });
  const signer = makeSigner({ throws: 'RPC unavailable' });
  const { path, cleanup } = tempStatePath();
  try {
    const state = new WelcomerState({ path });
    state.setLastProcessedBlock(500);
    const w = new Welcomer({ config: makeConfig(), state, client, logger: silentLogger, signer });
    await w.tick({ broadcast: true });
    assert.equal(state.isKnown('alice'), true);
    assert.equal(state.hasWelcomed('alice'), false, 'failed broadcast must NOT mark welcomed');
  } finally { cleanup(); }
});
