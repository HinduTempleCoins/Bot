/**
 * token-tools.test.mjs — OFFLINE tests for the token-tools surface.
 *
 * Asserts: the combined list renders from INJECTED data (engine + SMT), the
 * detail view renders supply/holders, /api/build builds valid create + transfer
 * + smt ops, and everything soft-fails (a throwing smtSummary, a 404 token, a
 * bad build) without crashing. No network, no keys.
 *
 * Run: node --test engine/test/token-tools.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  makeHandler,
  combinedTokenList,
  buildFromRequest,
  renderTokenList,
  listEngineTokens,
  engineHolders,
} from '../lib/token-tools.mjs';

// ---- a tiny in-memory engine-State stub (collection/find/findOne) ----------
function stubState(tokens = [], balances = []) {
  return {
    collection: (name) => (name === 'tokens' ? tokens : name === 'balances' ? balances : []),
    find: (name, q) => {
      const rows = name === 'tokens' ? tokens : name === 'balances' ? balances : [];
      return rows.filter((r) => Object.entries(q || {}).every(([k, v]) => r[k] === v));
    },
    findOne(name, q) {
      return this.find(name, q)[0] || null;
    },
  };
}

const TOKENS = [
  { symbol: 'MYTOK', name: 'My Token', issuer: 'hathor', precision: 3, supply: '1500000', maxSupply: '1000000000', supplyCapImmutable: false, url: '', createdBlock: 10 },
  { symbol: 'APIS', name: 'Apis', issuer: 'hathor', precision: 3, supply: '1000000000', maxSupply: '9007199254740991000', supplyCapImmutable: false, url: 'https://x', createdBlock: 0 },
];
const BALANCES = [
  { account: 'hathor', symbol: 'MYTOK', balance: '1000000', stake: '500000' },
  { account: 'alice', symbol: 'MYTOK', balance: '0', stake: '0' }, // filtered out (zero)
  { account: 'bob', symbol: 'MYTOK', balance: '0', stake: '500000' }, // kept (has stake)
];

// ---- a mock req/res --------------------------------------------------------
function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers; },
    end(payload) { this.body = payload || ''; },
  };
}

function getReq(path) {
  return { url: path, method: 'GET', on() {} };
}

function postReq(path, obj) {
  const raw = JSON.stringify(obj);
  return {
    url: path, method: 'POST',
    on(ev, cb) { if (ev === 'data') cb(raw); if (ev === 'end') cb(); },
  };
}

async function call(handler, req) {
  const res = mockRes();
  await handler(req, res);
  return res;
}

// ---- pure helpers ----------------------------------------------------------

test('listEngineTokens projects base units to decimals and sorts by symbol', () => {
  const rows = listEngineTokens(stubState(TOKENS));
  assert.equal(rows[0].symbol, 'APIS'); // sorted
  const my = rows.find((r) => r.symbol === 'MYTOK');
  assert.equal(my.supply, '1500.000');
  assert.equal(my.maxSupply, '1000000.000');
});

test('engineHolders filters zero balances and keeps stake-only holders', () => {
  const h = engineHolders(stubState(TOKENS, BALANCES), 'MYTOK');
  const accts = h.map((x) => x.account).sort();
  assert.deepEqual(accts, ['bob', 'hathor']);
  const hathor = h.find((x) => x.account === 'hathor');
  assert.equal(hathor.balance, '1000.000');
  assert.equal(hathor.stake, '500.000');
});

test('combinedTokenList merges engine + injected SMT summary', async () => {
  const c = await combinedTokenList({
    state: stubState(TOKENS),
    smtSummary: async () => ({
      configured: true, hardforkActive: true, naiPoolSize: 3, nais: ['@@1', '@@2', '@@3'],
      tokens: [{ nai: '@@422838704', decimals: 3, controlAccount: 'hathor', phase: 0, maxSupply: '1000000' }],
      label: '[TestNet not MELEK]',
    }),
  });
  assert.equal(c.counts.engine, 2);
  assert.equal(c.counts.smt, 1);
  assert.equal(c.smt.hardforkActive, true);
  assert.equal(c.smt.tokens[0].nai, '@@422838704');
});

test('combinedTokenList soft-fails when smtSummary throws', async () => {
  const c = await combinedTokenList({
    state: stubState(TOKENS),
    smtSummary: async () => { throw new Error('rpc down'); },
  });
  assert.equal(c.counts.engine, 2);
  assert.equal(c.counts.smt, 0);
  assert.equal(c.smt.configured, false);
});

test('combinedTokenList degrades to empties with no deps', async () => {
  const c = await combinedTokenList({});
  assert.deepEqual(c.engine, []);
  assert.equal(c.counts.smt, 0);
});

test('renderTokenList renders both layers and escapes content', () => {
  const html = renderTokenList({
    engine: listEngineTokens(stubState(TOKENS)),
    smt: { configured: true, hardforkActive: true, naiPoolSize: 2, nais: [], label: '[TestNet not MELEK]',
      tokens: [{ nai: '@@99', decimals: 2, controlAccount: 'al<ice>', phase: 1, maxSupply: '5' }] },
    counts: { engine: 2, smt: 1 },
  });
  assert.match(html, /MYTOK/);
  assert.match(html, /@@99/);
  assert.match(html, /al&lt;ice&gt;/); // escaped
  assert.match(html, /SMT hardfork active/);
});

// ---- buildFromRequest dispatch ---------------------------------------------

test('buildFromRequest routes engine create', () => {
  const r = buildFromRequest({ layer: 'engine', action: 'create', account: 'hathor',
    params: { symbol: 'NEW', precision: 2, maxSupply: '500' } });
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(r.op[1].json).contractPayload.symbol, 'NEW');
});

test('buildFromRequest routes smt create + setup', () => {
  assert.equal(buildFromRequest({ layer: 'smt', action: 'create',
    params: { controlAccount: 'hathor', precision: 3, nai: '@@422838704' } }).ok, true);
  assert.equal(buildFromRequest({ layer: 'smt', action: 'setup',
    params: { controlAccount: 'hathor', nai: '@@422838704', maxSupply: '100' } }).ok, true);
  assert.equal(buildFromRequest({ layer: 'smt', action: 'bogus', params: {} }).ok, false);
});

test('buildFromRequest rejects unknown layer', () => {
  assert.equal(buildFromRequest({ layer: 'wat', action: 'create', params: {} }).ok, false);
});

// ---- HTTP handler ----------------------------------------------------------

test('GET / renders the tools page from injected data', async () => {
  const handler = makeHandler({
    state: stubState(TOKENS, BALANCES),
    smtSummary: async () => ({ configured: true, hardforkActive: true, naiPoolSize: 1, nais: ['@@1'],
      tokens: [{ nai: '@@1', decimals: 0, controlAccount: 'hathor', phase: 0, maxSupply: null }], label: '[TestNet not MELEK]' }),
  });
  const res = await call(handler, getReq('/'));
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /MELEK<\/span> Token Tools/);
  assert.match(res.body, /MYTOK/);
  assert.match(res.body, /Build a token operation/);
});

test('GET /api/tokens returns the combined JSON', async () => {
  const handler = makeHandler({ state: stubState(TOKENS) });
  const res = await call(handler, getReq('/api/tokens'));
  assert.equal(res.code, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.counts.engine, 2);
});

test('GET /token/MYTOK renders detail + holders', async () => {
  const handler = makeHandler({ state: stubState(TOKENS, BALANCES) });
  const res = await call(handler, getReq('/token/MYTOK'));
  assert.equal(res.code, 200);
  assert.match(res.body, /My Token/);
  assert.match(res.body, /Holders \(2\)/);
  assert.match(res.body, /1000\.000/);
});

test('GET /token/NOPE 404s with a friendly page', async () => {
  const handler = makeHandler({ state: stubState(TOKENS) });
  const res = await call(handler, getReq('/token/NOPE'));
  assert.equal(res.code, 404);
  assert.match(res.body, /Not found/);
});

test('POST /api/build builds a valid create op', async () => {
  const handler = makeHandler({ state: stubState(TOKENS) });
  const res = await call(handler, postReq('/api/build',
    { layer: 'engine', action: 'create', account: 'hathor', params: { symbol: 'COOL', precision: 3, maxSupply: '1000' } }));
  assert.equal(res.code, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.equal(json.op[0], 'custom_json');
});

test('POST /api/build builds a valid transfer op', async () => {
  const handler = makeHandler({});
  const res = await call(handler, postReq('/api/build',
    { layer: 'engine', action: 'transfer', account: 'alice', params: { symbol: 'MYTOK', to: 'bob', quantity: '5' } }));
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.equal(JSON.parse(json.op[1].json).contractPayload.to, 'bob');
});

test('POST /api/build returns 400 with error for a bad op', async () => {
  const handler = makeHandler({});
  const res = await call(handler, postReq('/api/build',
    { layer: 'engine', action: 'create', account: 'hathor', params: { symbol: 'bad!', precision: 3, maxSupply: '1' } }));
  assert.equal(res.code, 400);
  assert.equal(JSON.parse(res.body).ok, false);
});

test('POST /api/build returns 400 on invalid JSON body', async () => {
  const handler = makeHandler({});
  const res = mockRes();
  await handler({ url: '/api/build', method: 'POST', on(ev, cb) { if (ev === 'data') cb('{not json'); if (ev === 'end') cb(); } }, res);
  assert.equal(res.code, 400);
  assert.match(res.body, /invalid JSON/);
});

test('unknown route 404s as JSON', async () => {
  const handler = makeHandler({});
  const res = await call(handler, getReq('/nope'));
  assert.equal(res.code, 404);
  assert.equal(JSON.parse(res.body).ok, false);
});
