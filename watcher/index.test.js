/**
 * Tests for the Watcher orchestrator class (watcher/index.js).
 *
 *   node --test watcher/index.test.js
 *
 * Exercises the tick loop with a mocked chain client + temp state file +
 * a custom sink pool so no network or disk side effects leak.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Watcher } from './index.js';
import { WatcherState } from './state.js';

const ACC = 'hathor';

const historyEntry = (idx, opName, opData) => [
  idx,
  {
    trx_id: `tx-${idx}`,
    block: 1000 + idx,
    timestamp: `2026-05-27T00:00:${String(idx).padStart(2, '0')}`,
    op: [opName, opData],
  },
];

function mockClient({ history = [], account = { name: ACC } } = {}) {
  const calls = [];
  return {
    calls,
    database: {
      async getAccounts(names) {
        return names.map((n) => (n === ACC ? account : null)).filter(Boolean);
      },
    },
    async call(api, method, params) {
      calls.push({ api, method, params });
      if (api === 'condenser_api' && method === 'get_account_history') {
        return history;
      }
      throw new Error(`unmocked ${api}/${method}`);
    },
  };
}

function makeConfig(overrides = {}) {
  return {
    chain: { rpcUrl: 'http://mock', chainId: 'x', addressPrefix: 'MLK' },
    bot: { account: ACC },
    cronExpr: '* * * * *',
    historyLimit: 100,
    statePath: null,
    sinks: {
      // file disabled (no path); use a custom pool below instead.
      file: { path: null },
      telegram: { botToken: null, chatId: null },
      email: { apiKey: null, from: null, to: null },
    },
    ...overrides,
  };
}

function captureSink() {
  const received = [];
  return {
    received,
    sink: {
      name: 'capture',
      enabled: () => true,
      send: async (event, alert) => {
        received.push({ event, alert });
        return { ok: true };
      },
    },
  };
}

function tempStatePath() {
  const dir = mkdtempSync(join(tmpdir(), 'melek-watcher-int-'));
  return { path: join(dir, 'state.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const silentLogger = { log: () => {}, error: () => {} };

test('startupHealthChecks throws when bot account does not exist on chain', async () => {
  const client = mockClient({ account: null });
  const { path, cleanup } = tempStatePath();
  try {
    const w = new Watcher({ config: makeConfig(), state: new WatcherState({ path }), client, logger: silentLogger });
    await assert.rejects(() => w.startupHealthChecks(), /does not exist/);
  } finally { cleanup(); }
});

test('startupHealthChecks claims the state file for the configured account', async () => {
  const client = mockClient({});
  const { path, cleanup } = tempStatePath();
  try {
    const state = new WatcherState({ path });
    const w = new Watcher({ config: makeConfig(), state, client, logger: silentLogger });
    await w.startupHealthChecks();
    assert.equal(state.getAccount(), ACC);
  } finally { cleanup(); }
});

test('first tick bootstraps from head and does NOT alert on backfill', async () => {
  // History full of would-be-sensitive ops; if we backfill we'd page the operator
  // for a month of transfers they already saw.
  const history = [
    historyEntry(5, 'transfer',       { from: ACC, to: 'b', amount: '1 MELEK', memo: '' }),
    historyEntry(6, 'witness_update', { owner: ACC, url: 'http://x' }),
    historyEntry(7, 'transfer',       { from: ACC, to: 'c', amount: '2 MELEK', memo: '' }),
  ];
  const client = mockClient({ history });
  const { path, cleanup } = tempStatePath();
  const cap = captureSink();
  try {
    const state = new WatcherState({ path });
    const w = new Watcher({
      config: makeConfig(),
      state,
      client,
      logger: silentLogger,
      sinkOverrides: { pool: [cap.sink] },
    });
    const result = await w.tick();
    assert.equal(result.detected, 0, 'bootstrap should not detect');
    assert.equal(cap.received.length, 0, 'no alerts should be sent on first run');
    assert.equal(state.getLastHistoryIndex(), 7, 'cursor should snap to head of slice');
  } finally { cleanup(); }
});

test('subsequent tick alerts on new sensitive ops above the cursor', async () => {
  const history = [
    historyEntry(5, 'transfer', { from: ACC, to: 'b', amount: '1 MELEK', memo: '' }),
    historyEntry(6, 'transfer', { from: ACC, to: 'c', amount: '2 MELEK', memo: '' }),
  ];
  const client = mockClient({ history });
  const { path, cleanup } = tempStatePath();
  const cap = captureSink();
  try {
    const state = new WatcherState({ path });
    state.setLastHistoryIndex(4); // post-bootstrap state
    const w = new Watcher({
      config: makeConfig(),
      state,
      client,
      logger: silentLogger,
      sinkOverrides: { pool: [cap.sink] },
    });
    const result = await w.tick();
    assert.equal(result.detected, 2);
    assert.equal(result.alerted, 2);
    assert.equal(cap.received.length, 2);
    assert.equal(cap.received[0].event.historyIndex, 5);
    assert.equal(cap.received[1].event.historyIndex, 6);
    assert.equal(state.getLastHistoryIndex(), 6);
  } finally { cleanup(); }
});

test('tick filters inbound transfers (income is not an alert)', async () => {
  const history = [
    historyEntry(5, 'transfer', { from: 'someone', to: ACC, amount: '5 MELEK', memo: '' }),
    historyEntry(6, 'transfer', { from: ACC, to: 'b', amount: '1 MELEK', memo: '' }),
  ];
  const client = mockClient({ history });
  const { path, cleanup } = tempStatePath();
  const cap = captureSink();
  try {
    const state = new WatcherState({ path });
    state.setLastHistoryIndex(4);
    const w = new Watcher({
      config: makeConfig(),
      state,
      client,
      logger: silentLogger,
      sinkOverrides: { pool: [cap.sink] },
    });
    await w.tick();
    assert.equal(cap.received.length, 1);
    assert.equal(cap.received[0].event.opData.to, 'b', 'only the outbound transfer alerts');
  } finally { cleanup(); }
});

test('tick does NOT double-alert on a history index it has already alerted on', async () => {
  const history = [
    historyEntry(5, 'transfer', { from: ACC, to: 'b', amount: '1 MELEK', memo: '' }),
  ];
  const client = mockClient({ history });
  const { path, cleanup } = tempStatePath();
  const cap = captureSink();
  try {
    const state = new WatcherState({ path });
    state.setLastHistoryIndex(4);
    state.recordAlerted(5, { trxId: 'tx-5', kind: 'transfer' });
    const w = new Watcher({
      config: makeConfig(),
      state,
      client,
      logger: silentLogger,
      sinkOverrides: { pool: [cap.sink] },
    });
    const result = await w.tick();
    assert.equal(result.detected, 1, 'still detected');
    assert.equal(result.alerted, 0, 'but suppressed because already-alerted');
    assert.equal(cap.received.length, 0);
  } finally { cleanup(); }
});

test('tick: dry-run suppresses telegram/email sinks but keeps the rest', async () => {
  // Real-shape config with telegram + email enabled. Use the real sink module
  // wiring; intercept fetch on telegram to detect the would-be call.
  const history = [historyEntry(5, 'transfer', { from: ACC, to: 'b', amount: '1 MELEK', memo: '' })];
  const client = mockClient({ history });
  const { path, cleanup } = tempStatePath();
  try {
    const state = new WatcherState({ path });
    state.setLastHistoryIndex(4);
    const config = makeConfig({
      sinks: {
        file: { path: null },
        telegram: { botToken: 'TOK', chatId: '1' },
        email: { apiKey: 'k', from: 'a@x', to: ['b@x'] },
      },
    });
    // If dry-run nulls out telegram + email config, the network sinks should
    // NOT be in the enabled list, so fetchImpl is never called.
    const calls = [];
    const fetchImpl = async (...args) => {
      calls.push(args);
      return { ok: true, status: 200 };
    };
    const w = new Watcher({
      config,
      state,
      client,
      logger: silentLogger,
      sinkOverrides: { fetchImpl },
    });
    await w.tick({ dryRun: true });
    assert.equal(calls.length, 0, 'dry-run must not POST to telegram or resend');
  } finally { cleanup(); }
});

test('tick advances cursor even when slice has no sensitive ops', async () => {
  const history = [
    historyEntry(5, 'vote',    { voter: ACC, author: 'x', permlink: 'y', weight: 10000 }),
    historyEntry(6, 'comment', { author: ACC, parent_author: '', parent_permlink: 'p' }),
  ];
  const client = mockClient({ history });
  const { path, cleanup } = tempStatePath();
  try {
    const state = new WatcherState({ path });
    state.setLastHistoryIndex(4);
    const w = new Watcher({ config: makeConfig(), state, client, logger: silentLogger });
    await w.tick();
    assert.equal(state.getLastHistoryIndex(), 6, 'cursor should still advance past boring ops');
  } finally { cleanup(); }
});

test('tick records alerted history indexes so future ticks honor them', async () => {
  const history = [
    historyEntry(5, 'transfer', { from: ACC, to: 'b', amount: '1 MELEK', memo: '' }),
  ];
  const client = mockClient({ history });
  const { path, cleanup } = tempStatePath();
  const cap = captureSink();
  try {
    const state = new WatcherState({ path });
    state.setLastHistoryIndex(4);
    const w = new Watcher({
      config: makeConfig(),
      state,
      client,
      logger: silentLogger,
      sinkOverrides: { pool: [cap.sink] },
    });
    await w.tick();
    assert.equal(state.hasAlerted(5), true);
  } finally { cleanup(); }
});

test('activeSinks() in dry-run only reports the always-on file sink', () => {
  const config = makeConfig({
    sinks: {
      file: { path: '/tmp/x.jsonl' },
      telegram: { botToken: 'T', chatId: 'c' },
      email: { apiKey: 'k', from: 'a@x', to: ['b@x'] },
    },
  });
  const w = new Watcher({ config, state: { getLastHistoryIndex: () => null, setAccount: () => {} }, client: mockClient({}), logger: silentLogger });
  assert.deepEqual(w.activeSinks(false).sort(), ['email', 'file', 'telegram']);
  assert.deepEqual(w.activeSinks(true), ['file']);
});
