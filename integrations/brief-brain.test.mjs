// brief-brain.test.mjs — offline guards for the brief/annal router (queue #306).
// Pure CPU, no network, deterministic. Run: node --test integrations/brief-brain.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBriefBrain, STANDING_TOPICS } from './brief-brain.mjs';

// A small, distinct training set per topic — enough for Bayes to learn separable vocab.
const TRAIN = [
  { text: 'hathor witness block production schedule feed price publish dpos slot', topic: 'hathor' },
  { text: 'hathor witness url update intro post on-chain block producer', topic: 'hathor' },
  { text: 'cheetah librarian source match credit discovery whitelist plagiarism', topic: 'cheetah' },
  { text: 'cheetah factual match source link resolution evidence library', topic: 'cheetah' },
  { text: 'signup faucet account creation register onboarding email resend faucet', topic: 'signup' },
  { text: 'signup tutorial staged onboarding new user wallet keys generate', topic: 'signup' },
  { text: 'mining pool randomx stratum hashrate payout fees monero worker', topic: 'pool' },
  { text: 'mining pool dashboard hashrate shares difficulty reward split', topic: 'pool' },
];

// ── routing learns from a small training set ─────────────────────────────────────────────────────
test('routeBrief: untrained brain falls back to general', () => {
  const bb = createBriefBrain();
  const r = bb.routeBrief('some vague unlabelled text with no topic word in it whatsoever yo');
  assert.equal(r.topic, 'general');
  assert.equal(r.era, 'none');
});

test('routeBrief: Bayes routes to the learned topic after training', () => {
  const bb = createBriefBrain();
  const { taught, trained } = bb.trainFromHistory(TRAIN);
  assert.equal(taught, TRAIN.length);
  assert.equal(trained, true);
  // Use vocab that did NOT name the topic explicitly (so the 1960s pattern can't fire) but is
  // characteristic of the learned class.
  const r = bb.routeBrief('what is the stratum hashrate payout split for randomx workers');
  assert.equal(r.topic, 'pool', `expected pool, got ${r.topic} (era ${r.era})`);
  assert.equal(r.era, '1990s');
  assert.ok(r.confidence > 0);
});

test('routeBrief: explicit "brief about X" phrasing wins via the 1960s pattern layer', () => {
  const bb = createBriefBrain(); // not even trained
  const r = bb.routeBrief('please write a brief about cheetah');
  assert.equal(r.topic, 'cheetah');
  assert.equal(r.era, '1960s');
  assert.ok(r.confidence >= 0.9);
});

test('STANDING_TOPICS is the standing rotation', () => {
  assert.deepEqual(STANDING_TOPICS, ['hathor', 'cheetah', 'signup', 'infra', 'pool', 'engine', 'general']);
});

// ── nearestPrior finds the duplicate ─────────────────────────────────────────────────────────────
test('nearestPrior: finds the matching prior brief', () => {
  const bb = createBriefBrain();
  const priors = [
    { id: 'b1', text: 'mining pool randomx stratum hashrate payout fees' },
    { id: 'b2', text: 'hathor witness block production price feed schedule' },
    { id: 'b3', text: 'cheetah librarian source credit discovery whitelist' },
  ];
  const hit = bb.nearestPrior('randomx stratum hashrate payout pool fees', priors);
  assert.ok(hit, 'should find a near match');
  assert.equal(hit.id, 'b1');
  assert.ok(hit.score > 0.15);
});

test('nearestPrior: returns null when nothing is close enough', () => {
  const bb = createBriefBrain();
  const priors = [{ id: 'b1', text: 'mining pool randomx stratum hashrate' }];
  const hit = bb.nearestPrior('completely orthogonal cooking recipe banana bread', priors);
  assert.equal(hit, null);
});

test('nearestPrior: accepts raw strings and returns index ids', () => {
  const bb = createBriefBrain();
  const hit = bb.nearestPrior('hathor witness feed', [
    'mining pool randomx stratum',
    'hathor witness block production feed schedule',
  ]);
  assert.ok(hit);
  assert.equal(hit.id, 1);
});

test('nearestPrior: empty prior list → null', () => {
  const bb = createBriefBrain();
  assert.equal(bb.nearestPrior('anything', []), null);
});

// ── dedup falls back to TF-IDF without an embedder ───────────────────────────────────────────────
test('dedupAnnal: TF-IDF fallback flags a duplicate when no embedder is injected', async () => {
  const bb = createBriefBrain(); // no embedder
  const prior = [
    { id: 'a1', text: 'hathor produced its first blocks on the testnet today and published the price feed' },
  ];
  const dup = await bb.dedupAnnal(
    'hathor produced its first blocks on the testnet today and published the price feed',
    prior,
  );
  assert.equal(dup, true);
});

test('dedupAnnal: TF-IDF fallback returns false for a genuinely new annal', async () => {
  const bb = createBriefBrain();
  const prior = [{ id: 'a1', text: 'hathor produced its first blocks on the testnet' }];
  const dup = await bb.dedupAnnal('the mining pool added a new monero wallet adapter', prior);
  assert.equal(dup, false);
});

test('dedupAnnal: uses the embedder when one is injected', async () => {
  // A toy embedder: a near-identical pair gets near-identical vectors → cosine ~1 → dup.
  const embedder = async (text) => {
    const t = String(text).toLowerCase();
    return [
      t.includes('blocks') ? 1 : 0,
      t.includes('feed') ? 1 : 0,
      t.includes('monero') ? 1 : 0,
      t.length / 100,
    ];
  };
  const bb = createBriefBrain({ embedder });
  const prior = [{ id: 'a1', text: 'hathor produced blocks and published feed' }];
  const dup = await bb.dedupAnnal('hathor produced blocks and published feed', prior, { embedThreshold: 0.99 });
  assert.equal(dup, true);
  const fresh = await bb.dedupAnnal('the pool added a monero adapter', prior, { embedThreshold: 0.99 });
  assert.equal(fresh, false);
});

test('dedupAnnal: empty prior → false', async () => {
  const bb = createBriefBrain();
  assert.equal(await bb.dedupAnnal('anything', []), false);
});

// ── snapshot round-trips ─────────────────────────────────────────────────────────────────────────
test('snapshot: round-trips learned routing through createBriefBrain({store})', () => {
  const bb = createBriefBrain();
  bb.trainFromHistory(TRAIN);
  const probe = 'what is the stratum hashrate payout split for randomx workers';
  const before = bb.routeBrief(probe);
  assert.equal(before.topic, 'pool');

  const snap = bb.snapshot();
  assert.ok(snap.routeBayes && snap.routeBayes.total > 0, 'snapshot carries trained Bayes state');
  assert.deepEqual(snap.topics, STANDING_TOPICS);

  // Reload a fresh brain from the snapshot — it must route the same without re-training.
  const reloaded = createBriefBrain({ store: snap });
  const after = reloaded.routeBrief(probe);
  assert.equal(after.topic, 'pool', 'reloaded brain routes identically');
  assert.equal(after.era, '1990s', 'reloaded brain is already trained (no re-train needed)');
});

test('snapshot: also carries the composed decades-brain weights', () => {
  const bb = createBriefBrain();
  const snap = bb.snapshot();
  assert.ok(snap.weights, 'decades-brain weights are present in the snapshot');
});
