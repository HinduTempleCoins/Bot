// karma-curation.test.mjs — the AutoVote merit-targeting ranker. OFFLINE, pure (composes karma/). Never throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curationScore, scoreCandidate, rankForCuration, CURATION_WEIGHTS } from './karma-curation.mjs';

// signal builders
const established = { // high karma, established (low neediness): high BP, prolific, active, big reach
  author: 'pillar',
  activity: { postCount: 200, commentCount: 1000, repliesToNewcomers: 80, upvotesGiven: 500, selfVotes: 5, accountAgeDays: 900, reputation: 80 },
  need: { bp: 50000, postCount: 500, lastActiveDaysAgo: 0, followerCount: 5000 },
};
const qualityNewcomer = { // genuine but small/new: decent activity, high neediness
  author: 'newseed',
  activity: { postCount: 15, commentCount: 60, repliesToNewcomers: 10, upvotesGiven: 40, selfVotes: 0, accountAgeDays: 20, reputation: 35 },
  need: { bp: 200, postCount: 15, lastActiveDaysAgo: 0, followerCount: 8 },
};
const spammer = { author: 'spam', activity: { postCount: 0, commentCount: 0, upvotesGiven: 10, selfVotes: 10 }, need: { bp: 50, postCount: 0, lastActiveDaysAgo: 1, followerCount: 0 } };

test('curationScore is a clamped weighted blend', () => {
  assert.equal(curationScore({ quality: 1, lift: 1, balance: 1 }), 1);
  assert.equal(curationScore({ quality: 0, lift: 0, balance: 0 }), 0);
  const s = curationScore({ quality: 1, lift: 0, balance: 0 });
  assert.ok(Math.abs(s - CURATION_WEIGHTS.quality) < 1e-9);  // quality-only → its weight
});

test('the SIRING mission: a quality newcomer outranks an equally-good established account', () => {
  const est = scoreCandidate(established);
  const seed = scoreCandidate(qualityNewcomer);
  assert.ok(seed.neediness > est.neediness, 'newcomer is needier');
  assert.ok(seed.score > est.score, 'lifting a quality newcomer scores higher than an established whale');
});

test('quality gates it: a spammer/empty account does not get curated', () => {
  const r = scoreCandidate(spammer);
  assert.ok(r.quality < 0.15, 'no real contribution → low quality');
  assert.ok(r.score < 0.2, 'low quality → low curation score even though needy');
});

test('rankForCuration sorts by merit, applies minScore + limit, soft-fails bad rows', () => {
  const ranked = rankForCuration([established, qualityNewcomer, spammer, null, { author: '' }], { minScore: 0.01 });
  assert.equal(ranked[0].author, 'newseed', 'quality newcomer ranks first (siring)');
  assert.ok(ranked.every((r) => r.author && r.score >= 0.01));
  assert.ok(!ranked.find((r) => r.author === 'spam') || ranked.find((r) => r.author === 'spam').score < ranked[0].score);
  const top1 = rankForCuration([established, qualityNewcomer], { limit: 1 });
  assert.equal(top1.length, 1);
});

test('balance (dharma) is a tiebreaker; missing signals default to 0, never throw', () => {
  const withBal = scoreCandidate({ author: 'a', activity: qualityNewcomer.activity, need: qualityNewcomer.need, dharma: { given: 100, received: 100 } });
  const noBal = scoreCandidate({ author: 'a', activity: qualityNewcomer.activity, need: qualityNewcomer.need });
  assert.ok(withBal.balance > 0.8, 'gives≈receives → high dharma balance');
  assert.equal(noBal.balance, 0);
  assert.ok(withBal.score >= noBal.score);
  assert.doesNotThrow(() => scoreCandidate({ author: 'x' })); // no signals at all
});
