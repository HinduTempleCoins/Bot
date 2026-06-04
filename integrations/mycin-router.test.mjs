// mycin-router.test.mjs — OFFLINE unit tests for the MYCIN rules-first inference front-end.
// No network, no real model: every escalation handler is an injected spy. Run:
//   node --test integrations/mycin-router.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import {
  infer,
  answerOrEscalate,
  recordCase,
  promoteCases,
  inferWithLearning,
  createCaseStore,
  intentKey,
  cacheKey,
  outcomeCF,
  outcomeAnswer,
} from './mycin-router.mjs';

// ── infer: high-CF rules answer with high confidence, no model involved ──────────────────────
test('infer: a high-CF fired rule yields a high-confidence rules answer', () => {
  const ruleSets = [
    { name: 'price', when: [{ fact: 'topic', op: 'eq', value: 'price' }], then: { answer: 'PRICE', cf: 0.95 } },
  ];
  const r = infer({ query: 'price?', facts: { topic: 'price' }, ruleSets });
  assert.equal(r.answer, 'PRICE');
  assert.equal(r.source, 'rules');
  assert.ok(r.confidence >= 90, `expected high confidence, got ${r.confidence}`);
  assert.deepEqual(r.firedRules, ['price']);
});

test('infer: no rule fires → confidence 0, null answer (soft, not throw)', () => {
  const ruleSets = [
    { name: 'x', when: [{ fact: 'topic', op: 'eq', value: 'never' }], then: { answer: 'X', cf: 0.9 } },
  ];
  const r = infer({ query: 'q', facts: { topic: 'other' }, ruleSets });
  assert.equal(r.answer, null);
  assert.equal(r.confidence, 0);
});

test('infer: combine-CF math flows through — two corroborating rules raise confidence', () => {
  // Two rules propose the SAME answer at cf 0.6 each. combineCF(0.6,0.6)=0.84 → conf ~92,
  // strictly higher than a single 0.6 rule's confidence (~80).
  const two = [
    { name: 'a', when: [{ fact: 't', op: 'eq', value: 1 }], then: { answer: 'SAME', cf: 0.6 } },
    { name: 'b', when: [{ fact: 't', op: 'eq', value: 1 }], then: { answer: 'SAME', cf: 0.6 } },
  ];
  const one = [
    { name: 'a', when: [{ fact: 't', op: 'eq', value: 1 }], then: { answer: 'SAME', cf: 0.6 } },
  ];
  const rTwo = infer({ facts: { t: 1 }, ruleSets: two });
  const rOne = infer({ facts: { t: 1 }, ruleSets: one });
  assert.equal(rTwo.answer, 'SAME');
  assert.ok(rTwo.confidence > rOne.confidence, `${rTwo.confidence} should exceed ${rOne.confidence}`);
  // sanity vs the published worked example: combineCF(0.6,0.6) ≈ 0.84 → toConfidence ≈ 92
  assert.ok(Math.abs(rTwo.cf - 0.84) < 1e-9);
});

test('outcomeCF: reads number, {cf}, {certainty}, and chained {ruleCF,premiseCF}', () => {
  assert.equal(outcomeCF(0.5), 0.5);
  assert.equal(outcomeCF({ cf: 0.3 }), 0.3);
  assert.equal(outcomeCF({ certainty: 0.2 }), 0.2);
  assert.ok(Math.abs(outcomeCF({ ruleCF: 0.8, premiseCF: 0.5 }) - 0.4) < 1e-9); // chainCF
  assert.equal(outcomeAnswer({ decision: 'granted' }), 'granted');
  assert.equal(outcomeAnswer('plain'), 'plain');
});

// ── answerOrEscalate: confident → rules, no LLM handler called ────────────────────────────────
test('answerOrEscalate: high confidence answers from rules and NEVER calls a handler', async () => {
  let tinyCalls = 0;
  let smallCalls = 0;
  const handlers = {
    tiny: async () => { tinyCalls++; return 'TINY'; },
    small: async () => { smallCalls++; return 'SMALL'; },
  };
  const ruleSets = [
    { name: 'sure', when: [{ fact: 'topic', op: 'eq', value: 'sure' }], then: { answer: 'RULES_ANSWER', cf: 0.95 } },
  ];
  const out = await answerOrEscalate(
    { kind: 'answer', needsLanguage: true, query: 'sure thing', facts: { topic: 'sure' }, ruleSets },
    handlers,
  );
  assert.equal(out.source, 'rules');
  assert.equal(out.escalated, false);
  assert.equal(out.answer, 'RULES_ANSWER');
  assert.equal(tinyCalls, 0, 'tiny handler must NOT be called when rules are confident');
  assert.equal(smallCalls, 0, 'small handler must NOT be called when rules are confident');
});

// ── answerOrEscalate: low confidence → escalates, injected handler IS called ─────────────────
test('answerOrEscalate: low confidence escalates and the model handler IS invoked', async () => {
  let called = null;
  const handlers = {
    tiny: async (j) => { called = 'tiny'; return `tiny:${j.query}`; },
    small: async (j) => { called = 'small'; return `small:${j.query}`; },
  };
  // No rule matches → confidence 0 → must escalate. kind 'classify' (short) routes to tiny tier.
  const ruleSets = [
    { name: 'nope', when: [{ fact: 'x', op: 'eq', value: 'yes' }], then: { answer: 'N', cf: 0.9 } },
  ];
  const out = await answerOrEscalate(
    { kind: 'classify', tokens: 20, query: 'what is this', facts: {}, ruleSets },
    handlers,
  );
  assert.equal(out.source, 'model');
  assert.equal(out.escalated, true);
  assert.equal(called, 'tiny', 'tiny handler should have been the escalation tier');
  assert.equal(out.answer, 'tiny:what is this');
  assert.ok(out.rulesAttempt && out.rulesAttempt.confidence < 80);
  assert.match(out.reason, /escalated/);
});

test('answerOrEscalate: low confidence + NO handlers → soft-fails to best rules guess', async () => {
  const ruleSets = [
    { name: 'weak', when: [{ fact: 't', op: 'eq', value: 1 }], then: { answer: 'WEAK', cf: 0.2 } },
  ];
  const out = await answerOrEscalate(
    { kind: 'answer', needsLanguage: true, query: 'q', facts: { t: 1 }, ruleSets },
    {}, // no handlers
  );
  assert.equal(out.escalated, false);
  assert.equal(out.lowConfidence, true);
  assert.equal(out.answer, 'WEAK');
  assert.match(out.reason, /no handlers/);
});

test('answerOrEscalate: empty ruleSets + no handlers → soft-fail, never throws', async () => {
  const out = await answerOrEscalate({ kind: 'answer', query: 'q', facts: {}, ruleSets: [] }, {});
  assert.equal(out.answer, null);
  assert.equal(out.lowConfidence, true);
});

test('answerOrEscalate: a throwing handler is caught → soft-fail to rules guess', async () => {
  const handlers = { tiny: async () => { throw new Error('boom'); } };
  const out = await answerOrEscalate(
    { kind: 'classify', tokens: 10, query: 'q', facts: {}, ruleSets: [] },
    handlers,
  );
  assert.equal(out.escalated, false);
  assert.equal(out.lowConfidence, true);
  assert.match(out.reason, /escalation failed/);
});

// ── memo (cacheKey): identical repeated query skips the rule run ─────────────────────────────
test('answerOrEscalate: memo returns a cached result for an identical query', async () => {
  const memo = new Map();
  const ruleSets = [
    { name: 'r', when: [{ fact: 'topic', op: 'eq', value: 'a' }], then: { answer: 'A', cf: 0.95 } },
  ];
  const job = { kind: 'answer', query: 'price of a?', facts: { topic: 'a' }, ruleSets };
  const first = await answerOrEscalate(job, {}, { memo });
  assert.equal(first.answer, 'A');
  assert.equal(first.cached, undefined);
  const second = await answerOrEscalate(job, {}, { memo });
  assert.equal(second.cached, true);
  assert.equal(second.answer, 'A');
});

test('cacheKey: order-independent over facts; intentKey normalizes phrasing', () => {
  assert.equal(cacheKey('q', { a: 1, b: 2 }), cacheKey('q', { b: 2, a: 1 }));
  // Stop words ("is", "the") + punctuation + case are normalized away.
  assert.equal(intentKey('What is the PRICE?'), intentKey('what  price'));
});

// ── LEARNING: recordCase accrues, promoteCases emits a rule after minHits, infer then answers ──
test('learning loop: 3 accepted high-conf cases → a promoted rule → answered by rules', () => {
  const store = createCaseStore();
  for (let i = 0; i < 3; i++) {
    recordCase(store, {
      query: 'what is karma?',
      answer: 'Karma is the off-chain reputation ledger.',
      confidence: 92,
      source: 'model',
      accepted: true,
    });
  }
  assert.equal(store.records.length, 3);

  // Below minHits=4 → nothing promoted yet.
  assert.equal(promoteCases(store, { minHits: 4, minConfidence: 80 }).length, 0);

  // At minHits=3 → one rule promoted.
  const learned = promoteCases(store, { minHits: 3, minConfidence: 80 });
  assert.equal(learned.length, 1);
  assert.match(learned[0].name, /^learned:/);
  assert.equal(learned[0].then.learned, true);
  assert.equal(learned[0].then.hits, 3);

  // The same intent is now answered by RULES (no model) via the promoted rule.
  const r = inferWithLearning({ query: 'what is KARMA', facts: {}, learnedRules: learned });
  assert.equal(r.source, 'rules');
  assert.equal(r.answer, 'Karma is the off-chain reputation ledger.');
  assert.ok(r.confidence >= 80, `learned rule should be confident, got ${r.confidence}`);
});

test('learning loop: end-to-end — escalate, record, promote, then rules answer (no handler 2nd time)', async () => {
  const store = createCaseStore();
  let modelCalls = 0;
  const handlers = { small: async (j) => { modelCalls++; return `Answer about ${j.query}`; } };

  // First few times: no rule → escalates to the model. Record each accepted answer.
  let learned = [];
  for (let i = 0; i < 3; i++) {
    const out = await answerOrEscalate(
      { kind: 'answer', needsLanguage: true, query: 'explain the egregore', facts: {}, ruleSets: [] },
      handlers,
    );
    assert.equal(out.source, 'model');
    recordCase(store, { query: 'explain the egregore', answer: 'A held position about the egregore.', confidence: 90, source: 'model', accepted: true });
  }
  assert.equal(modelCalls, 3);

  learned = promoteCases(store, { minHits: 3, minConfidence: 80 });
  assert.equal(learned.length, 1);

  // Now the same intent is answered by rules. Confirm via inferWithLearning — no model touched.
  const r = inferWithLearning({ query: 'explain the egregore', facts: {}, learnedRules: learned });
  assert.equal(r.source, 'rules');
  assert.equal(r.answer, 'A held position about the egregore.');
  assert.equal(modelCalls, 3, 'no further model calls once the rule is learned');
});

test('promoteCases: rejected or low-confidence cases are NOT promoted', () => {
  const store = createCaseStore();
  for (let i = 0; i < 5; i++) recordCase(store, { query: 'rejected q', answer: 'X', confidence: 95, accepted: false });
  for (let i = 0; i < 5; i++) recordCase(store, { query: 'low q', answer: 'Y', confidence: 50, accepted: true });
  assert.equal(promoteCases(store, { minHits: 3, minConfidence: 80 }).length, 0);
});

test('promoteCases / recordCase: soft-fail on unrecognized store shape', () => {
  assert.deepEqual(promoteCases(null), []);
  assert.deepEqual(promoteCases(42), []);
  // recordCase on a bad store returns it untouched (no throw).
  assert.equal(recordCase(null, { query: 'q', answer: 'a' }), null);
});

test('recordCase: a plain array also works as a store', () => {
  const arr = [];
  recordCase(arr, { query: 'q', answer: 'a', confidence: 88, accepted: true });
  recordCase(arr, { query: 'q', answer: 'a', confidence: 88, accepted: true });
  recordCase(arr, { query: 'q', answer: 'a', confidence: 88, accepted: true });
  assert.equal(arr.length, 3);
  assert.equal(promoteCases(arr, { minHits: 3, minConfidence: 80 }).length, 1);
});

// ── infer: accepts a single rule set OR an array of rule sets; skips malformed sets ────────────
test('infer: accepts a single rule-set array and an array-of-rule-sets', () => {
  const single = [{ name: 'r', when: [], then: { answer: 'OK', cf: 0.9 } }];
  const r1 = infer({ facts: {}, ruleSets: single });
  assert.equal(r1.answer, 'OK');
  const multi = [single, [{ name: 'r2', when: [], then: { answer: 'OK', cf: 0.9 } }]];
  const r2 = infer({ facts: {}, ruleSets: multi });
  assert.equal(r2.firedRules.length, 2);
});

test('infer: a malformed rule set is skipped, not fatal', () => {
  const sets = [
    [{ /* no name */ when: [], then: 'x' }], // Engine throws on this set → skipped
    [{ name: 'good', when: [], then: { answer: 'GOOD', cf: 0.9 } }],
  ];
  const r = infer({ facts: {}, ruleSets: sets });
  assert.equal(r.answer, 'GOOD');
});
