// probabilistic-trigger.test.mjs — offline, node:test. Backlog 1b68bc9f5f.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectKeywords,
  hashSeed,
  seededFloat,
  shouldFire,
  evaluate,
} from './probabilistic-trigger.mjs';

test('detectKeywords: case-insensitive word-boundary match, ordered + deduped', () => {
  assert.deepEqual(detectKeywords('How do I SIGNUP today?', ['signup', 'tutorial']), ['signup']);
  assert.deepEqual(detectKeywords('signup and tutorial', ['tutorial', 'signup']), ['tutorial', 'signup']);
  // word boundary: 'sign' should NOT match inside 'signup'
  assert.deepEqual(detectKeywords('I want to signup', ['sign']), []);
  // dedup
  assert.deepEqual(detectKeywords('vote vote vote', ['vote', 'VOTE']), ['vote']);
});

test('detectKeywords: soft-fail on bad inputs => []', () => {
  assert.deepEqual(detectKeywords('', ['a']), []);
  assert.deepEqual(detectKeywords('text', []), []);
  assert.deepEqual(detectKeywords('text', null), []);
  assert.deepEqual(detectKeywords(null, ['a']), []);
  assert.deepEqual(detectKeywords('text', ['', '   ']), []);
});

test('hashSeed: stable uint32, order-sensitive', () => {
  const a = hashSeed('alice', 'permlink-1');
  const b = hashSeed('alice', 'permlink-1');
  assert.equal(a, b, 'same parts => same hash');
  assert.equal(a >>> 0, a, 'is uint32');
  assert.ok(Number.isInteger(a) && a >= 0);
  assert.notEqual(hashSeed('alice', 'permlink-1'), hashSeed('permlink-1', 'alice'), 'order matters');
});

test('seededFloat: deterministic, in [0,1)', () => {
  const v = seededFloat(12345);
  assert.equal(v, seededFloat(12345), 'same seed => same float');
  assert.ok(v >= 0 && v < 1);
  assert.notEqual(seededFloat(1), seededFloat(2), 'different seeds differ');
  // non-finite seed collapses to a finite float
  assert.ok(seededFloat(NaN) >= 0 && seededFloat(NaN) < 1);
  assert.ok(seededFloat(undefined) >= 0 && seededFloat(undefined) < 1);
});

test('shouldFire: same seed => deterministic', () => {
  const seed = hashSeed('msg', 'x');
  const a = shouldFire({ matched: ['signup'], probability: 0.7, seed });
  const b = shouldFire({ matched: ['signup'], probability: 0.7, seed });
  assert.equal(a, b);
});

test('shouldFire: probability=1 always fires on a match, probability=0 never', () => {
  for (let i = 0; i < 50; i++) {
    const seed = hashSeed('seed', String(i));
    assert.equal(shouldFire({ matched: ['k'], probability: 1, seed }), true);
    assert.equal(shouldFire({ matched: ['k'], probability: 0, seed }), false);
  }
});

test('shouldFire: no keyword => never fires (even at p=1)', () => {
  assert.equal(shouldFire({ matched: [], probability: 1, seed: 1 }), false);
  assert.equal(shouldFire({ matched: undefined, probability: 1, seed: 1 }), false);
  assert.equal(shouldFire({}), false);
});

test('shouldFire: ~70% over many seeds lands in a sane band', () => {
  let fires = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    if (shouldFire({ matched: ['k'], probability: 0.7, seed: hashSeed('band', String(i)) })) fires++;
  }
  const rate = fires / N;
  assert.ok(rate > 0.6 && rate < 0.8, `rate ${rate} should be near 0.7`);
});

test('evaluate: fires on match with p=1', () => {
  const r = evaluate({ text: 'I need a tutorial', keywords: ['tutorial'], probability: 1, seed: 5 });
  assert.deepEqual(r.matched, ['tutorial']);
  assert.equal(r.fire, true);
  assert.equal(r.reason, 'fired');
});

test('evaluate: no keywords / no match => soft-fail reasons', () => {
  assert.deepEqual(evaluate({ text: 'hi', keywords: [] }), { matched: [], fire: false, reason: 'no-keywords' });
  assert.deepEqual(evaluate({ text: 'hi', keywords: ['signup'] }), { matched: [], fire: false, reason: 'no-match' });
  assert.equal(evaluate({}).reason, 'no-keywords');
});

test('evaluate: dice miss reports reason "dice"', () => {
  const r = evaluate({ text: 'signup please', keywords: ['signup'], probability: 0, seed: 1 });
  assert.equal(r.fire, false);
  assert.equal(r.reason, 'dice');
});

test('evaluate: cooldown blocks a fire inside the window', () => {
  const base = { text: 'signup now', keywords: ['signup'], probability: 1, seed: 9 };
  // inside window => blocked
  const blocked = evaluate({ ...base, cooldown: { lastFiredAt: 1000, windowMs: 5000, now: 2000 } });
  assert.equal(blocked.fire, false);
  assert.equal(blocked.reason, 'cooldown');
  // outside window => fires
  const ok = evaluate({ ...base, cooldown: { lastFiredAt: 1000, windowMs: 5000, now: 9000 } });
  assert.equal(ok.fire, true);
  assert.equal(ok.reason, 'fired');
  // malformed cooldown is ignored (still fires at p=1)
  const ignored = evaluate({ ...base, cooldown: { lastFiredAt: 'x' } });
  assert.equal(ignored.fire, true);
});

test('evaluate: full determinism for the same message', () => {
  const seed = hashSeed('author', 'permlink-42');
  const a = evaluate({ text: 'how do I signup and vote?', keywords: ['signup', 'vote'], probability: 0.7, seed });
  const b = evaluate({ text: 'how do I signup and vote?', keywords: ['signup', 'vote'], probability: 0.7, seed });
  assert.deepEqual(a, b);
});
