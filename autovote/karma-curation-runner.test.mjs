// karma-curation-runner.test.mjs — the curation loop. OFFLINE: rank/recentPostOf/castVote all injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCurationRound } from './karma-curation-runner.mjs';

const rankStub = async () => [
  { author: 'newseed', score: 0.2 }, { author: 'envuser6', score: 0.15 }, { author: 'whale', score: 0.05 },
];

test('ranks → finds each post → casts the curator vote (top N), reports what it lifted', async () => {
  const votes = [];
  const r = await runCurationRound({
    curator: { account: 'hathor', chain: 'melek-testnet' },
    candidates: ['newseed', 'envuser6', 'whale'],
    rank: rankStub,
    recentPostOf: async (a) => ({ permlink: `${a}-latest` }),
    castVote: async (v) => { votes.push(v); return { id: `tx-${votes.length}` }; },
    weight: 7500, topN: 2,
  });
  assert.equal(r.cast.length, 2);                         // only top 2 lifted
  assert.deepEqual(votes.map((v) => v.author), ['newseed', 'envuser6']);
  assert.equal(votes[0].voter, 'hathor');
  assert.equal(votes[0].weight, 7500);
  assert.equal(votes[0].permlink, 'newseed-latest');
});

test('dedupe: a post already voted is skipped across rounds', async () => {
  const seen = new Set(['newseed/newseed-latest']);
  const votes = [];
  const r = await runCurationRound({
    curator: { account: 'hathor' }, candidates: ['x'], rank: rankStub,
    recentPostOf: async (a) => ({ permlink: `${a}-latest` }),
    castVote: async (v) => { votes.push(v); return {}; },
    topN: 5, alreadyVoted: seen,
  });
  assert.ok(!r.cast.find((c) => c.author === 'newseed'), 'newseed skipped (already voted)');
  assert.ok(r.cast.find((c) => c.author === 'envuser6'), 'others still curated');
});

test('soft-fail: authors with no post, or a failing vote, are skipped — the round continues', async () => {
  const r = await runCurationRound({
    curator: { account: 'hathor' }, candidates: ['a'], rank: rankStub, topN: 5,
    recentPostOf: async (a) => (a === 'newseed' ? null : { permlink: `${a}-p` }),   // newseed has no post
    castVote: async (v) => { if (v.author === 'whale') throw new Error('mana'); return { id: 'ok' }; }, // whale vote fails
  });
  assert.deepEqual(r.cast.map((c) => c.author), ['envuser6']);   // newseed (no post) + whale (failed) dropped
});

test('guards: missing curator / castVote / recentPostOf → no-op, never throws', async () => {
  assert.deepEqual((await runCurationRound({})).cast, []);
  assert.deepEqual((await runCurationRound({ curator: { account: 'h' }, castVote: () => {} })).cast, []);
});
