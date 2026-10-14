import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCouncil } from './hathor-council.mjs';
import { createReward } from './brain-reward.mjs';

const seat = (name, ans, conf) => ({ name, role: name, answer: async () => (ans == null ? null : { answer: ans, confidence: conf }) });

test('deliberate picks the strongest seat; abstainers are skipped', async () => {
  const c = createCouncil({ seats: [seat('a', 'blue sky', 0.6), seat('b', null, 0), seat('c', 'green grass', 0.8)] });
  const r = await c.deliberate('q');
  assert.equal(r.by, 'c');            // highest eff
  assert.equal(r.answer, 'green grass');
  assert.equal(r.seats.length, 2);    // b abstained
});

test('agreeing seats combine certainty and win over a lone higher seat', async () => {
  // two seats agree at 0.55 each (cfCombine -> ~0.80), beating a lone 0.7
  const c = createCouncil({ seats: [
    seat('x', 'the witness produces blocks', 0.55),
    seat('y', 'the witness produces blocks on the chain', 0.55),
    seat('z', 'something unrelated entirely different', 0.7),
  ] });
  const r = await c.deliberate('what is a witness');
  assert.ok(r.agreed.includes('x') && r.agreed.includes('y'), 'x and y grouped');
  assert.ok(r.confidence > 0.7, 'combined certainty exceeds the lone seat');
  assert.match(r.answer, /witness produces blocks/);
});

test('reward weights scale a seat; feedback reinforces the winners', async () => {
  const reward = createReward();
  reward.reinforce('seat:trusted', 'good'); reward.reinforce('seat:trusted', 'good'); // weight up
  const c = createCouncil({ reward, seats: [seat('trusted', 'answer A', 0.5), seat('other', 'answer B', 0.55)] });
  const r = await c.deliberate('q');
  assert.equal(r.by, 'trusted');      // reward weight pushed 0.5 above the raw 0.55
  c.feedback(r, 'good');
  assert.ok(reward.weightFor('seat:trusted') > 1.0);
});

test('fact-checker can flag the winning answer (never edits)', async () => {
  const fc = async (ans) => (/dragon/.test(ans) ? ['unverified claim: dragon'] : []);
  const c = createCouncil({ factChecker: fc, seats: [seat('a', 'there is a dragon', 0.9)] });
  const r = await c.deliberate('q');
  assert.equal(r.answer, 'there is a dragon'); // not edited
  assert.deepEqual(r.flags, ['unverified claim: dragon']);
});

test('empty council soft-returns null', async () => {
  const c = createCouncil({ seats: [seat('a', null, 0)] });
  const r = await c.deliberate('q');
  assert.equal(r.answer, null);
});
