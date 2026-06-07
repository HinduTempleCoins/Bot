// smt-info.test.mjs — OFFLINE tests. No network, no keys. Injected fetch returns fixtures.
// Run: node --test integrations/smt-info.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';

import {
  configured,
  network,
  networkLabel,
  naiPool,
  listSmtTokens,
  smtSummary,
  __setFetch,
} from './smt-info.mjs';

// --- a tiny fetch stub: captures the last request, returns a canned JSON-RPC result ----------
function stubFetch(resultFor) {
  const calls = [];
  const f = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, method: body.method, params: body.params });
    const result = typeof resultFor === 'function' ? resultFor(body.method, body) : resultFor;
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
  };
  f.calls = calls;
  return f;
}

function withRpc(fn) {
  const prevUrl = process.env.MELEK_RPC_URL;
  const prevNet = process.env.MELEK_NETWORK;
  process.env.MELEK_RPC_URL = 'http://rpc.invalid';
  return Promise.resolve(fn()).finally(() => {
    if (prevUrl === undefined) delete process.env.MELEK_RPC_URL; else process.env.MELEK_RPC_URL = prevUrl;
    if (prevNet === undefined) delete process.env.MELEK_NETWORK; else process.env.MELEK_NETWORK = prevNet;
    __setFetch(null);
  });
}

// ---- env / config ----------------------------------------------------------

test('configured() reflects MELEK_RPC_URL', () => {
  const prev = process.env.MELEK_RPC_URL;
  delete process.env.MELEK_RPC_URL;
  assert.equal(configured(), false);
  process.env.MELEK_RPC_URL = 'http://x';
  assert.equal(configured(), true);
  if (prev === undefined) delete process.env.MELEK_RPC_URL; else process.env.MELEK_RPC_URL = prev;
});

test('network defaults to testnet with the [TestNet not MELEK] label', () => {
  const prev = process.env.MELEK_NETWORK;
  delete process.env.MELEK_NETWORK;
  assert.equal(network(), 'testnet');
  assert.equal(networkLabel(), '[TestNet not MELEK]');
  process.env.MELEK_NETWORK = 'mainnet';
  assert.equal(network(), 'mainnet');
  assert.equal(networkLabel(), '[MELEK]');
  if (prev === undefined) delete process.env.MELEK_NETWORK; else process.env.MELEK_NETWORK = prev;
});

// ---- naiPool ---------------------------------------------------------------

test('naiPool parses a bare-array NAI pool (condenser shape)', () => withRpc(async () => {
  __setFetch(stubFetch((m) => m === 'condenser_api.get_nai_pool'
    ? ['@@422838704', '@@642246205', '@@771505466'] : null));
  const p = await naiPool();
  assert.equal(p.count, 3);
  assert.equal(p.available, true);
  assert.deepEqual(p.nais, ['@@422838704', '@@642246205', '@@771505466']);
  assert.equal(p.label, '[TestNet not MELEK]');
}));

test('naiPool falls back to database_api and reads {nai_pool:[...]}', () => withRpc(async () => {
  const f = stubFetch((m) => m === 'condenser_api.get_nai_pool'
    ? null                                   // first call returns null result -> fallback
    : { nai_pool: ['@@111', '@@222'] });
  __setFetch(f);
  const p = await naiPool();
  assert.deepEqual(p.nais, ['@@111', '@@222']);
  // proves both methods were attempted
  assert.deepEqual(f.calls.map((c) => c.method),
    ['condenser_api.get_nai_pool', 'database_api.get_nai_pool']);
}));

test('naiPool soft-empties on a non-ok response (never throws)', () => withRpc(async () => {
  __setFetch(async () => ({ ok: false, json: async () => ({}) }));
  const p = await naiPool();
  assert.deepEqual(p.nais, []);
  assert.equal(p.count, 0);
  assert.equal(p.available, false);
}));

// ---- listSmtTokens ---------------------------------------------------------

test('listSmtTokens normalizes the database_api token shape', () => withRpc(async () => {
  __setFetch(stubFetch({
    tokens: [
      { liquid_symbol: { nai: '@@422838704', decimals: 3 }, control_account: 'hathor', phase: 0, max_supply: '1000000' },
      { liquid_symbol: { nai: '@@642246205', decimals: 0 }, control_account: 'alice', phase: 2 },
    ],
  }));
  const r = await listSmtTokens();
  assert.equal(r.count, 2);
  assert.deepEqual(r.tokens[0], { nai: '@@422838704', decimals: 3, controlAccount: 'hathor', phase: 0, maxSupply: '1000000' });
  assert.equal(r.tokens[1].controlAccount, 'alice');
  assert.equal(r.tokens[1].maxSupply, null);
}));

test('listSmtTokens clamps limit into 1..1000', () => withRpc(async () => {
  const f = stubFetch({ tokens: [] });
  __setFetch(f);
  await listSmtTokens(99999);
  assert.equal(f.calls[0].params.limit, 1000);
  await listSmtTokens(0);
  assert.equal(f.calls[1].params.limit, 100); // 0 -> default 100, then clamp keeps 100
}));

test('listSmtTokens soft-empties when result has no tokens array', () => withRpc(async () => {
  __setFetch(stubFetch(null));
  const r = await listSmtTokens();
  assert.deepEqual(r.tokens, []);
  assert.equal(r.count, 0);
}));

// ---- smtSummary ------------------------------------------------------------

test('smtSummary is a shaped soft-empty when unconfigured (no network touched)', async () => {
  const prev = process.env.MELEK_RPC_URL;
  delete process.env.MELEK_RPC_URL;
  __setFetch(() => { throw new Error('must not fetch'); });
  const s = await smtSummary();
  assert.equal(s.configured, false);
  assert.equal(s.hardforkActive, null);
  assert.equal(s.naiPoolSize, 0);
  assert.equal(s.tokenCount, 0);
  assert.deepEqual(s.tokens, []);
  assert.match(s.note, /MELEK_RPC_URL unset/);
  __setFetch(null);
  if (prev === undefined) delete process.env.MELEK_RPC_URL; else process.env.MELEK_RPC_URL = prev;
});

test('smtSummary reports hardforkActive:true from a live non-empty NAI pool', () => withRpc(async () => {
  __setFetch(stubFetch((m) => {
    if (m === 'condenser_api.get_nai_pool') return ['@@1', '@@2', '@@3'];
    if (m === 'database_api.list_smt_tokens') return { tokens: [] };
    return null;
  }));
  const s = await smtSummary();
  assert.equal(s.configured, true);
  assert.equal(s.hardforkActive, true);   // evidence: pool non-empty
  assert.equal(s.naiPoolSize, 3);
  assert.equal(s.tokenCount, 0);
}));

test('smtSummary leaves hardforkActive null when there is no positive evidence', () => withRpc(async () => {
  __setFetch(stubFetch((m) => {
    if (m === 'database_api.list_smt_tokens') return { tokens: [] };
    return null; // empty NAI pool both ways
  }));
  const s = await smtSummary();
  assert.equal(s.hardforkActive, null);
}));

test('smtSummary surfaces created tokens as evidence even with an empty pool', () => withRpc(async () => {
  __setFetch(stubFetch((m) => {
    if (m === 'database_api.list_smt_tokens') {
      return { tokens: [{ liquid_symbol: { nai: '@@99', decimals: 2 }, control_account: 'hathor' }] };
    }
    return null;
  }));
  const s = await smtSummary();
  assert.equal(s.hardforkActive, true);
  assert.equal(s.tokenCount, 1);
  assert.equal(s.tokens[0].nai, '@@99');
}));
