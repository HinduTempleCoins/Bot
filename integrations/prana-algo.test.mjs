// prana-algo.test.mjs — OFFLINE. Injected fetch; nothing here touches a network.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  EPOCH_LENGTH, EPOCH_SEEDS, epochOfSeed, algorithmFrom, detectAlgorithm,
  checkClaim, minerLine, __setFetch, handler,
  seedIndexFor, seedIsDecisiveAt, algorithmFromEpochLength, algorithmFromConfig,
} from './prana-algo.mjs';

const SEED1 = EPOCH_SEEDS[1];
const SEED2 = EPOCH_SEEDS[2];

// ⭐ THE TEST THAT SHOULD HAVE EXISTED. The first version asserted 'ethash' here and was WRONG:
// at 64,954 both schemes use seed index 2, so the seed proves nothing. PRANA is etchash.
test('at block 64,954 the seed CANNOT decide — both schemes use index 2', () => {
  const d = seedIsDecisiveAt(64954);
  assert.equal(d.decisive, false);
  assert.equal(d.ethashIndex, 2);
  assert.equal(d.etchashIndex, 2);
  const r = algorithmFrom(SEED2, 64954);
  assert.equal(r.algorithm, 'ambiguous', 'a confident answer here is a wrong answer');
  assert.match(r.why, /CANNOT answer this/);
});

test('the seed IS decisive where the schemes diverge', () => {
  assert.equal(seedIsDecisiveAt(45000).decisive, true, 'ethash index 1 vs etchash index 0');
  assert.equal(algorithmFrom(SEED1, 45000).algorithm, 'ethash');
  assert.equal(algorithmFrom(EPOCH_SEEDS[0], 45000).algorithm, 'etchash');
  assert.equal(seedIsDecisiveAt(95000).decisive, true, 'ethash index 3 vs etchash index 2');
});

test('etchash advances the seed index by TWO per epoch — the fact the first version missed', () => {
  assert.equal(seedIndexFor('ethash', 64954), 2);
  assert.equal(seedIndexFor('etchash', 64954), 2);
  assert.equal(seedIndexFor('etchash', 120000), 4, 'epoch 2 -> index 4');
  assert.equal(seedIndexFor('ethash', 120000), 4);
});

test('the AUTHORITATIVE sources both say etchash for PRANA', () => {
  assert.equal(algorithmFromEpochLength(60000).algorithm, 'etchash');
  assert.equal(algorithmFromEpochLength(30000).algorithm, 'ethash');
  assert.equal(algorithmFromConfig({ ecip1099FBlock: 40000 }, 64954).algorithm, 'etchash');
  assert.equal(algorithmFromConfig({ ecip1099FBlock: 40000 }, 39999).algorithm, 'ethash');
  assert.equal(algorithmFromConfig({}, 64954).algorithm, 'ethash');
});

test('an unknown seed is unknown — never defaulted to either algorithm', () => {
  assert.equal(algorithmFrom('0xdeadbeef', 64954).algorithm, 'unknown');
  assert.equal(algorithmFrom(SEED2, NaN).algorithm, 'unknown');
  assert.equal(epochOfSeed('0xnope'), -1);
});

test('seed hashes are matched case-insensitively', () => {
  assert.equal(algorithmFrom(SEED2.toUpperCase(), 45000).algorithm, 'unknown', 'index 2 fits neither scheme at 45000');
});

// ── the claim check — the thing that would have caught the announcement ───────────────────────────
test('CONTRADICTED names the cost when a document and the chain really do disagree', () => {
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
  __setFetch(node(SEED1, '0xafc8'));   // block 45,000 — a height where the seed IS decisive
  const d = await detectAlgorithm('https://rpc.example');
  assert.equal(d.algorithm, 'ethash');
  assert.equal(d.chainId, 712217);
  assert.equal(d.seedHash, SEED1);
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
