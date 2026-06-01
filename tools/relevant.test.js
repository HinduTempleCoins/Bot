// relevant.test.js — relevance scoring (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRelevance } from './relevant.mjs';

test('on-topic content scores higher than off-topic for the same topic', () => {
  const onTopic = scoreRelevance('cheetah attribution credit plagiarism pHash whitelist', 'cheetah');
  const offTopic = scoreRelevance('the weather and coffee were nice today', 'cheetah');
  assert.ok(onTopic.score > offTopic.score);
  assert.equal(offTopic.topicMatch, 0);
});

test('recency multiplies the score (older = lower)', () => {
  const fresh = scoreRelevance('trade arbitrage swap.ltc market', 'trade', { recency: 1, grader: 0.5 });
  const stale = scoreRelevance('trade arbitrage swap.ltc market', 'trade', { recency: 0.1, grader: 0.5 });
  assert.ok(fresh.score > stale.score);
});

test('grader score multiplies (a higher-graded item ranks above a lower one)', () => {
  const good = scoreRelevance('soapbox aggregator condenser clarity score', 'soapbox', { recency: 1, grader: 0.9 });
  const poor = scoreRelevance('soapbox aggregator condenser clarity score', 'soapbox', { recency: 1, grader: 0.2 });
  assert.ok(good.score > poor.score);
});

test('topicMatch is normalized 0..1', () => {
  const r = scoreRelevance('hathor rule 1 angelic egregore scripture', 'hathor');
  assert.ok(r.topicMatch > 0 && r.topicMatch <= 1);
});
