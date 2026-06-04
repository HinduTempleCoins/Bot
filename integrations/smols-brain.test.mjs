// smols-brain.test.mjs — OFFLINE tests for the Smols Brain learning layer. No network, no real
// model (escalation handlers are injected spies that must NOT be called when the brain answers).
//   node --test integrations/smols-brain.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import {
  reinforce,
  induceRules,
  applyTruthMaintenance,
  activeRules,
  createBrain,
  learnStep,
  isAccepted,
} from './smols-brain.mjs';
import { clampCF } from './certainty.mjs';

// ── (a) CERTAINTY-FACTOR REINFORCEMENT ───────────────────────────────────────────────────────
test('reinforce: repeated accept moves CF toward +1, bounded, asymptotic', () => {
  let rule = { name: 'r', when: [{ fact: 't', op: 'eq', value: 1 }], then: { answer: 'A', cf: 0.0 } };
  let prev = 0;
  for (let i = 0; i < 20; i++) {
    rule = reinforce(rule, true);
    const cf = rule.then.cf;
    assert.ok(cf <= 1, `CF must stay <= 1, got ${cf}`);
    assert.ok(cf >= prev - 1e-9, `CF must be non-decreasing on accept (${cf} vs ${prev})`);
    prev = cf;
  }
  assert.ok(prev > 0.99, `should asymptote near +1, got ${prev}`);
  assert.ok(prev <= 1, 'never exceeds +1');
});

test('reinforce: repeated reject moves CF toward -1 (belief flips), bounded', () => {
  let rule = { name: 'r', when: [{ fact: 't', op: 'eq', value: 1 }], then: { answer: 'A', cf: 0.8 } };
  for (let i = 0; i < 30; i++) rule = reinforce(rule, false);
  assert.ok(rule.then.cf < -0.99, `should asymptote near -1, got ${rule.then.cf}`);
  assert.ok(rule.then.cf >= -1, 'never below -1');
});

test('reinforce: crosses zero under sustained contradiction (positive belief decays then flips)', () => {
  let rule = { name: 'r', when: [{ fact: 't', op: 'eq', value: 1 }], then: { answer: 'A', cf: 0.5 } };
  const signs = [];
  for (let i = 0; i < 6; i++) { rule = reinforce(rule, 'reject'); signs.push(Math.sign(rule.then.cf)); }
  assert.ok(signs.includes(-1), 'sustained rejection eventually flips belief negative');
});

test('reinforce: bounded — extreme rate never escapes [-1,1]; soft-fails on junk rule', () => {
  // A bare-NUMBER outcome stays a number after reinforce (no schema forced on rule authors).
  let rule = { name: 'r', when: [], then: 0.9 };
  rule = reinforce(rule, true, { rate: 5 }); // rate clamped to 1 → moves to +1
  assert.equal(typeof rule.then, 'number');
  assert.ok(rule.then <= 1 && rule.then >= -1, `bounded, got ${rule.then}`);
  assert.equal(clampCF(rule.then), rule.then);
  // An object outcome keeps its shape and exposes the tuned CF on .cf.
  let obj = { name: 'o', when: [], then: { answer: 'A', cf: 0.2 } };
  obj = reinforce(obj, false, { rate: 1 }); // full move toward -1
  assert.ok(obj.then.cf >= -1 && obj.then.cf <= 1);
  assert.equal(reinforce(null, true), null); // soft-fail, no throw
  assert.equal(isAccepted('reject'), false);
  assert.equal(isAccepted({ accepted: true }), true);
});

// ── (b) FEATURE-BASED RULE INDUCTION → GENERALIZATION (not memorization) ──────────────────────
test('induceRules: produces a CONDITIONED rule that fires on a NEW unseen case sharing features', () => {
  // Label depends ONLY on topic=price; chain varies. A learner that GENERALIZES will condition on
  // topic, not memorize each (topic,chain) pair.
  const cases = [
    { facts: { topic: 'price', chain: 'melek' }, answer: 'price-lookup' },
    { facts: { topic: 'price', chain: 'hive' }, answer: 'price-lookup' },
    { facts: { topic: 'price', chain: 'steem' }, answer: 'price-lookup' },
    { facts: { topic: 'weather', chain: 'melek' }, answer: 'weather-lookup' },
    { facts: { topic: 'weather', chain: 'hive' }, answer: 'weather-lookup' },
  ];
  const rules = induceRules(cases, { minSupport: 2, minConfidence: 0.7 });
  assert.ok(rules.length >= 1, 'should induce at least one rule');

  const priceRule = rules.find((r) => r.then.answer === 'price-lookup');
  assert.ok(priceRule, 'induced a rule for price-lookup');
  // GENERALIZATION proof: the rule conditions on `topic` only — NOT on a specific chain.
  assert.deepEqual(priceRule.when, [{ fact: 'topic', op: 'eq', value: 'price' }]);

  // Fire the induced rule via mycin-router on a chain value NEVER in the training set.
  const brain = createBrain({ learnedRules: rules.map((r) => ({ ...r, status: 'in' })) });
  const novel = brain.infer({ query: 'price on blurt?', facts: { topic: 'price', chain: 'blurt' } });
  assert.equal(novel.answer, 'price-lookup', 'generalizes to an unseen chain');
  assert.equal(novel.source, 'rules');
  assert.ok(novel.confidence > 50, `should be confident, got ${novel.confidence}`);
});

test('induceRules: deterministic (same cases → identical rules) and respects support floor', () => {
  const cases = [
    { facts: { a: 1 }, answer: 'X' },
    { facts: { a: 1 }, answer: 'X' },
    { facts: { a: 2 }, answer: 'Y' }, // only one Y → below minSupport 2
  ];
  const r1 = induceRules(cases, { minSupport: 2, minConfidence: 0.6 });
  const r2 = induceRules(cases, { minSupport: 2, minConfidence: 0.6 });
  assert.deepEqual(r1, r2, 'deterministic output');
  assert.ok(r1.every((r) => r.then.answer !== 'Y'), 'single-case Y dropped by minSupport');
  assert.ok(r1.some((r) => r.then.answer === 'X'), 'X with support 2 kept');
});

// ── (c) TRUTH MAINTENANCE — retract on contradiction, keep/restore others ─────────────────────
test('applyTruthMaintenance: retracts a rule when a contradicting fact arrives, keeps others', () => {
  const rules = [
    { name: 'r-price', when: [{ fact: 'topic', op: 'eq', value: 'price' }], then: { answer: 'price-lookup', cf: 0.3 }, status: 'in' },
    { name: 'r-weather', when: [{ fact: 'topic', op: 'eq', value: 'weather' }], then: { answer: 'weather-lookup', cf: 0.9 }, status: 'in' },
  ];
  // Observe: topic=price now actually maps to something ELSE → contradicts r-price.
  let res = applyTruthMaintenance(rules, { facts: { topic: 'price' }, answer: 'NOT-price' }, { demote: 0.4, floor: 0.0 });
  // one demotion enough? cf 0.3*0.4=0.12 still > floor 0 → demoted not yet retracted
  assert.ok(res.demoted.includes('r-price') || res.retracted.includes('r-price'));
  // r-weather untouched (its conditions don't match the observation).
  const weather = res.rules.find((r) => r.name === 'r-weather');
  assert.equal(weather.status, 'in');
  assert.equal(weather.then.cf, 0.9);

  // Keep contradicting until it falls out.
  for (let i = 0; i < 5; i++) {
    res = applyTruthMaintenance(res.rules, { facts: { topic: 'price' }, answer: 'NOT-price' }, { demote: 0.4, floor: 0.0 });
  }
  const price = res.rules.find((r) => r.name === 'r-price');
  assert.equal(price.status, 'out', 'sustained contradiction retracts the rule');
  // activeRules must now exclude it but still include the untouched weather rule.
  const live = activeRules(res.rules);
  assert.ok(!live.find((r) => r.name === 'r-price'), 'retracted rule no longer active');
  assert.ok(live.find((r) => r.name === 'r-weather'), 'good rule survives');
});

test('applyTruthMaintenance: confirming observation reinforces and can revive an out rule', () => {
  const rules = [
    { name: 'r', when: [{ fact: 'k', op: 'eq', value: 1 }], then: { answer: 'A', cf: -0.5 }, status: 'out' },
  ];
  let res = applyTruthMaintenance(rules, { facts: { k: 1 }, answer: 'A' }, { floor: 0.0 });
  // one confirmation may not be enough to cross the floor; apply a few.
  for (let i = 0; i < 6; i++) res = applyTruthMaintenance(res.rules, { facts: { k: 1 }, answer: 'A' }, { floor: 0.0 });
  const r = res.rules[0];
  assert.ok(r.then.cf > 0, 'confirmation reinforces CF positive');
  assert.equal(r.status, 'in', 'rule comes back in');
});

test('applyTruthMaintenance: cascades retraction to dependents of a withdrawn justification', () => {
  const rules = [
    { name: 'base', when: [{ fact: 'k', op: 'eq', value: 1 }], then: { answer: 'A', cf: 0.2 }, status: 'in' },
    // `dependent` matches DIFFERENT facts (m=2) so the observation never touches it directly —
    // the ONLY way it can be retracted is the cascade from `base` being withdrawn.
    { name: 'dependent', when: [{ fact: 'm', op: 'eq', value: 2 }], then: { answer: 'B', cf: 0.9 }, status: 'in', dependsOn: ['base'] },
  ];
  // base cf 0.2 + 0.95*(-1.2) drops well below floor in one hit → out → cascade to dependent.
  const res = applyTruthMaintenance(rules, { facts: { k: 1 }, answer: 'NOT-A' }, { demote: 0.95, floor: 0.0 });
  const base = res.rules.find((r) => r.name === 'base');
  const dep = res.rules.find((r) => r.name === 'dependent');
  assert.equal(base.status, 'out', 'base retracted by contradiction');
  assert.equal(dep.status, 'out', 'dependent retracted by CASCADE (its own conditions never matched the observation)');
  assert.ok(res.retracted.includes('dependent'), 'cascade recorded in retracted list');
});

// ── (d) INTEGRATION: brain learns, then answers a NOVEL feature-matching query with NO model ───
test('integration: after learn steps, brain.infer answers a novel query from an induced rule, no model handler called', () => {
  const brain = createBrain({ induceEvery: 3, induce: { minSupport: 2, minConfidence: 0.6 } });

  // Feed accepted cases where the answer is a function of `topic` (chain varies → forces a
  // generalization, not per-input memorization).
  learnStep(brain, { query: 'btc price on melek', facts: { topic: 'price', chain: 'melek' }, answer: 'price-lookup', accepted: true });
  learnStep(brain, { query: 'price on hive', facts: { topic: 'price', chain: 'hive' }, answer: 'price-lookup', accepted: true });
  learnStep(brain, { query: 'whats the price on steem', facts: { topic: 'price', chain: 'steem' }, answer: 'price-lookup', accepted: true });
  // induceEvery=3 → induction has now fired.

  assert.ok(brain.learnedRules.some((r) => r.then && r.then.induced), 'brain induced a generalized rule');

  // A query whose CHAIN was never seen, but topic matches → should answer from the induced rule.
  const r = brain.infer({ query: 'price on a brand new chain', facts: { topic: 'price', chain: 'NEVER_SEEN' } });
  assert.equal(r.answer, 'price-lookup', 'answered from self-formed generalization');
  assert.equal(r.source, 'rules');

  // Now prove via answerOrEscalate that the MODEL handler is NEVER called for this confident answer.
  let modelCalls = 0;
  const handlers = {
    tiny: async () => { modelCalls++; return '[tiny]'; },
    small: async () => { modelCalls++; return '[small]'; },
    cloud: async () => { modelCalls++; return '[cloud]'; },
  };
  return brain
    .answerOrEscalate(
      { kind: 'answer', query: 'price on yet another new chain', facts: { topic: 'price', chain: 'ALSO_NEW' } },
      handlers,
      { confidentThreshold: 60 },
    )
    .then((out) => {
      assert.equal(out.escalated, false, 'did not escalate — answered from learned rule');
      assert.equal(out.answer, 'price-lookup');
      assert.equal(modelCalls, 0, 'NO model handler was called');
    });
});

test('integration: learnStep reinforces a matching learned rule and retracts on contradiction', () => {
  const brain = createBrain({ induceEvery: 2, induce: { minSupport: 2, minConfidence: 0.6 } });
  learnStep(brain, { query: 'q1', facts: { topic: 'price', chain: 'a' }, answer: 'price-lookup', accepted: true });
  learnStep(brain, { query: 'q2', facts: { topic: 'price', chain: 'b' }, answer: 'price-lookup', accepted: true });
  const induced = brain.learnedRules.find((r) => r.then && r.then.induced && r.then.answer === 'price-lookup');
  assert.ok(induced, 'rule induced');
  const cfBefore = induced.then.cf;

  // Confirming case nudges CF up.
  learnStep(brain, { query: 'q3', facts: { topic: 'price', chain: 'c' }, answer: 'price-lookup', accepted: true });
  const after = brain.learnedRules.find((r) => r.name === induced.name);
  assert.ok(after.then.cf >= cfBefore - 1e-9, 'confirmation did not lower CF');

  // Now feed sustained contradictions → rule should be demoted/retracted (drops from active set).
  for (let i = 0; i < 10; i++) {
    learnStep(brain, { query: 'qbad' + i, facts: { topic: 'price', chain: 'x' + i }, answer: 'WRONG', accepted: true });
  }
  const stillPriceActive = activeRules(brain.learnedRules).find(
    (r) => r.then && r.then.answer === 'price-lookup' && JSON.stringify(r.when) === JSON.stringify([{ fact: 'topic', op: 'eq', value: 'price' }]),
  );
  // Either retracted, or re-induced toward the new majority — the stale "always price" belief must
  // not still dominate with high confidence.
  if (stillPriceActive) {
    assert.ok(stillPriceActive.then.cf < 0.9, 'stale belief no longer held with high confidence');
  }
});
