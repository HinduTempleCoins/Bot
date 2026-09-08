// prana-algo.test.mjs — OFFLINE. Injected fetch; nothing here touches a network.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  EPOCH_LENGTH, EPOCH_SEEDS, epochOfSeed, algorithmFrom, detectAlgorithm,
  checkClaim, minerLine, __setFetch, handler,
} from './prana-algo.mjs';

const SEED1 = EPOCH_SEEDS[1];
const SEED2 = EPOCH_SEEDS[2];

test('the real PRANA reading: epoch-2 seed at block 64,922 is ETHASH and nothing else', () => {
  const r = algorithmFrom(SEED2, 64922);
  assert.equal(r.algorithm, 'ethash');
  assert.equal(r.epoch, 2);
  assert.match(r.why, /64922 \/ 30000 = 2/);
});

test('the same height with an epoch-1 seed WOULD be etchash — the test can distinguish them', () => {
  assert.equal(algorithmFrom(SEED1, 64922).algorithm, 'etchash');
  assert.equal(Math.floor(64922 / EPOCH_LENGTH.etchash), 1);
});

test('below block 30,000 the two are genuinely ambiguous, and it says so instead of guessing', () => {
  const r = algorithmFrom(EPOCH_SEEDS[0], 12345);
  assert.equal(r.algorithm, 'ambiguous');
  assert.deepEqual(r.candidates.sort(), ['etchash', 'ethash']);
  assert.match(r.why, /has not diverged yet/);
});

test('an unknown seed is unknown — never defaulted to either algorithm', () => {
  assert.equal(algorithmFrom('0xdeadbeef', 64922).algorithm, 'unknown');
  assert.equal(algorithmFrom(SEED2, NaN).algorithm, 'unknown');
  assert.equal(epochOfSeed('0xnope'), -1);
});

test('seed hashes are matched case-insensitively', () => {
  assert.equal(algorithmFrom(SEED2.toUpperCase(), 64922).algorithm, 'ethash');
});

// ── the claim check — the thing that would have caught the announcement ───────────────────────────
test('CONTRADICTED: the announcement says etchash, the chain says ethash, and it names the cost', () => {
  const c = checkClaim('etchash', { algorithm: 'ethash' });
  assert.equal(c.ok, false);
  assert.equal(c.verdict, 'contradicted');
  assert.match(c.why, /builds the wrong DAG and earns nothing/);
  assert.match(c.fix.line, /--algo ETHASH/);
});

test('a correct claim is confirmed', () => {
  assert.equal(checkClaim('ethash', { algorithm: 'ethash' }).verdict, 'confirmed');
});

test('an unreachable node CANNOT confirm a claim — absence is not agreement', () => {
  for (const d of [null, { algorithm: 'unknown', why: 'node down' }, { algorithm: 'ambiguous' }]) {
    const c = checkClaim('etchash', d);
    assert.equal(c.ok, false);
    assert.equal(c.verdict, 'unverified', 'a check that did not run must never read as a pass');
  }
});

test('no miner line is published for an algorithm we have not established', () => {
  assert.equal(minerLine('unknown').ok, false);
  assert.equal(minerLine('ambiguous').ok, false);
  assert.match(minerLine('etchash').line, /--algo ETCHASH/);
});

// ── live path, with an injected node ──────────────────────────────────────────────────────────────
const node = (seed, blockHex, chainHex = '0xade19') => async (_url, opts) => {
  const m = JSON.parse(opts.body).method;
  const r = { eth_getWork: ['0xhdr', seed, '0xtarget'], eth_blockNumber: blockHex, eth_chainId: chainHex }[m];
  return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: r }) };
};

test('detectAlgorithm reads a live node and reports the chain id alongside', async () => {
  __setFetch(node(SEED2, '0xfd9a'));
  const d = await detectAlgorithm('https://rpc.example');
  assert.equal(d.algorithm, 'ethash');
  assert.equal(d.chainId, 712217);
  assert.equal(d.seedHash, SEED2);
  __setFetch(null);
});

test('a node that will not answer is unknown, with the reason — never an algorithm', async () => {
  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  const d = await detectAlgorithm('https://rpc.example');
  assert.equal(d.algorithm, 'unknown');
  assert.match(d.why, /could not reach the node/);
  __setFetch(null);
});

test('a node not serving work is unknown, not an algorithm', async () => {
  __setFetch(async (_u, o) => {
    const m = JSON.parse(o.body).method;
    return { ok: true, status: 200, json: async () => ({ result: m === 'eth_getWork' ? null : '0xfd9a' }) };
  });
  const d = await detectAlgorithm('https://rpc.example');
  assert.equal(d.algorithm, 'unknown');
  assert.match(d.why, /no work package/);
  __setFetch(null);
});

test('an HTTP error soft-fails rather than throwing outward', async () => {
  __setFetch(async () => ({ ok: false, status: 502 }));
  assert.equal((await detectAlgorithm('https://rpc.example')).algorithm, 'unknown');
  __setFetch(null);
});

test('no url is an immediate unknown', async () => {
  assert.equal((await detectAlgorithm('')).algorithm, 'unknown');
});

test('the handler states the rule', () => {
  let body = '';
  handler({}, { setHeader() {}, end(b) { body = b; } });
  assert.match(JSON.parse(body).rule, /the chain answers, not a document/);
});
