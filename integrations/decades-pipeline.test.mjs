// decades-pipeline.test.mjs — offline tests for the brief/annal route+dedup glue.
// No network, no GPU, no filesystem: store / embedder / clock are all injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline, bagCosine, vecCosine } from './decades-pipeline.mjs';

// A small in-memory store standing in for the JSON/Qdrant corpus on Server A.
function makeStore(extra = []) {
  return {
    list: () => ([
      { id: 'b1', text: 'how do I sign up register a new account faucet create account', route: 'signup' },
      { id: 'b2', text: 'what is a witness block producer dpos voting schedule', route: 'witness' },
      ...extra,
    ]),
    routes: () => ([
      { label: 'signup', examples: ['register a new account signup faucet create account join'] },
      { label: 'witness', examples: ['witness block producer dpos voting schedule consensus'] },
      { label: 'pool', examples: ['mining pool stratum hashrate miners hashing randomx'] },
    ]),
  };
}

test('bagCosine: identical text → 1, disjoint → 0', () => {
  assert.ok(Math.abs(bagCosine('alpha beta gamma', 'alpha beta gamma') - 1) < 1e-9);
  assert.equal(bagCosine('alpha beta', 'xxxx yyyy'), 0);
  assert.equal(bagCosine('', 'anything'), 0);
});

test('vecCosine: orthogonal → 0, parallel → 1, mismatched length → 0', () => {
  assert.equal(vecCosine([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(vecCosine([1, 1], [2, 2]) - 1) < 1e-9);
  assert.equal(vecCosine([1, 2, 3], [1, 2]), 0);
});

test('process routes a brief to the right topic via the decades-brain', async () => {
  const pipe = createPipeline({ store: makeStore() });
  const r = await pipe.process({ id: 'new', text: 'how do I register a brand new account on the chain', kind: 'brief' });
  assert.equal(r.route, 'signup');
  assert.equal(r.kind, 'brief');
  assert.ok(r.routeConfidence > 0);
  assert.ok(r.layer); // some decades-brain layer fired
});

test('process flags a near-identical annal as a duplicate (word-bag fallback)', async () => {
  const pipe = createPipeline({ store: makeStore() });
  // text essentially equal to b1 → high TF-IDF/word-bag cosine → duplicate
  const r = await pipe.process({
    id: 'new',
    text: 'how do I sign up register a new account faucet create account',
    kind: 'annal',
  });
  assert.equal(r.dedupMethod, 'wordbag');
  assert.equal(r.isDuplicate, true);
  assert.equal(r.nearestBrief.id, 'b1');
  assert.ok(r.score >= 0.9);
});

test('process does NOT flag a distinct brief as duplicate', async () => {
  const pipe = createPipeline({ store: makeStore() });
  const r = await pipe.process({ id: 'new', text: 'mining pool stratum hashrate and randomx miners', kind: 'brief' });
  assert.equal(r.isDuplicate, false);
  assert.ok(r.score < 0.92);
});

test('process never compares an item against itself (id excluded)', async () => {
  const pipe = createPipeline({ store: makeStore() });
  const r = await pipe.process({ id: 'b1', text: 'how do I sign up register a new account faucet create account', kind: 'annal' });
  // b1 is excluded; nearest is some OTHER doc, not a self-duplicate
  assert.notEqual(r.nearestBrief && r.nearestBrief.id, 'b1');
});

test('process uses the dense embedder when one is wired in', async () => {
  // toy 2-dim embedder: [signup-ish, witness-ish]
  const embedder = (t) => [/sign ?up|register|account|faucet/i.test(t) ? 1 : 0, /witness|block|dpos/i.test(t) ? 1 : 0];
  const pipe = createPipeline({ store: makeStore(), embedder });
  const r = await pipe.process({ id: 'new', text: 'I need to register and create my account', kind: 'brief' });
  assert.equal(r.dedupMethod, 'embedding');
  assert.equal(r.nearestBrief.id, 'b1'); // signup vector matches b1
});

test('process soft-fails to word-bag when the embedder throws', async () => {
  const embedder = () => { throw new Error('minilm not installed'); };
  const pipe = createPipeline({ store: makeStore(), embedder });
  const r = await pipe.process({ id: 'new', text: 'how do I sign up register a new account faucet create account' });
  assert.equal(r.dedupMethod, 'wordbag'); // fell back, did not throw
  assert.equal(r.isDuplicate, true);
});

test('process soft-fails to a safe result when the store throws', async () => {
  const store = { list: () => { throw new Error('disk gone'); }, routes: () => { throw new Error('disk gone'); } };
  const pipe = createPipeline({ store });
  const r = await pipe.process({ id: 'x', text: 'anything at all here' });
  assert.equal(r.route, 'unrouted');
  assert.equal(r.isDuplicate, false);
  assert.equal(r.candidates, 0);
});

test('process handles empty / missing text without throwing', async () => {
  const pipe = createPipeline({ store: makeStore() });
  const a = await pipe.process({ id: 'x', text: '' });
  const b = await pipe.process({});
  assert.equal(a.route, 'unrouted');
  assert.equal(a.isDuplicate, false);
  assert.equal(b.route, 'unrouted');
});

test('clock is injectable — at stamp comes from the injected clock', async () => {
  const pipe = createPipeline({ store: makeStore(), clock: () => 1234567890 });
  const r = await pipe.process({ id: 'new', text: 'register a new account' });
  assert.equal(r.at, 1234567890);
});

test('low routeThreshold config flags weak routes', async () => {
  const pipe = createPipeline({ store: makeStore(), routeThreshold: 0.99 });
  const r = await pipe.process({ id: 'new', text: 'register a new account signup faucet' });
  // even a correct route is flagged low-confidence under an impossibly high threshold
  assert.equal(r.lowConfidenceRoute, true);
});

test('returns the full documented shape', async () => {
  const pipe = createPipeline({ store: makeStore() });
  const r = await pipe.process({ id: 'new', text: 'register a new account', kind: 'brief' });
  for (const k of ['route', 'routeConfidence', 'lowConfidenceRoute', 'isDuplicate',
    'dedupMethod', 'nearestBrief', 'score', 'layer', 'kind', 'at', 'candidates']) {
    assert.ok(k in r, `missing key ${k}`);
  }
});
