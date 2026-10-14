import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInteroception } from './brain-interoception.mjs';
import { createReward } from './brain-reward.mjs';

test('interoception: well when everything is healthy', async () => {
  const body = createInteroception({ signals: () => ({ services: { a: 'active', b: 'active' }, keyAgeHours: 2, budgetFraction: 0.8, vaultReachable: true, diskFreeFraction: 0.5 }) });
  const f = await body.feel();
  assert.equal(f.mood, 'well');
  assert.ok(f.wellbeing >= 0.75);
  assert.match(await body.report(), /I am well/);
});

test('interoception: strained/at-risk with concerns, drives disposition bias', async () => {
  const body = createInteroception({ signals: async () => ({ services: { a: 'active', b: 'failed' }, keyAgeHours: 48, budgetFraction: 0.1, vaultReachable: false }) });
  const f = await body.feel();
  assert.notEqual(f.mood, 'well');
  assert.ok(f.concerns.some((c) => /services down/.test(c)));
  assert.ok(f.concerns.some((c) => /vault unreachable/.test(c)));
  const bias = await body.dispositionBias();
  assert.equal(bias.terse, true);
});

test('interoception: unknown body when nothing is wired', async () => {
  const body = createInteroception({ signals: () => ({}) });
  const f = await body.feel();
  assert.equal(f.mood, 'unknown');
  assert.match(await body.report(), /cannot feel/);
});

test('reward: good drifts weight up, bad drifts down, bounded', () => {
  const r = createReward({ rate: 0.1 });
  for (let i = 0; i < 3; i++) r.reinforce('seat:librarian', 'good');
  for (let i = 0; i < 3; i++) r.reinforce('seat:witness', 'bad');
  assert.ok(r.weightFor('seat:librarian') > 1.0);
  assert.ok(r.weightFor('seat:witness') < 1.0);
  // bounded
  for (let i = 0; i < 50; i++) r.reinforce('seat:librarian', 'good');
  assert.ok(r.weightFor('seat:librarian') <= 1.5);
  assert.equal(r.weightFor('unseen'), 1.0);
});

test('reward: adjust scales confidence by the learned weight; digest + snapshot round-trip', () => {
  const r = createReward();
  r.reinforce('skill:price', 'good'); r.reinforce('skill:price', 'good');
  assert.ok(r.adjust('skill:price', 0.5) > 0.5);
  const d = r.digest();
  assert.ok(d.reinforced.some((x) => x.tag === 'skill:price'));
  const snap = r.snapshot();
  const r2 = createReward({ store: snap });
  assert.equal(r2.weightFor('skill:price'), r.weightFor('skill:price'));
});

test('reward: numeric + neutral outcomes', () => {
  const r = createReward();
  r.reinforce('x', 0.5); assert.ok(r.weightFor('x') > 1.0);
  const before = r.weightFor('y'); r.reinforce('y', 'neutral'); assert.equal(r.weightFor('y'), before);
});
