// rules-engine.test.mjs — OFFLINE unit tests for the self-contained Business Rules Engine.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  operators,
  resolveFact,
  evaluateCondition,
  Engine,
  eligibilityRules,
  moderationRules,
} from './rules-engine.mjs';

// ── operators ─────────────────────────────────────────────────────────────────
test('operators evaluate correctly', () => {
  assert.equal(operators.eq(5, 5), true);
  assert.equal(operators.eq(5, '5'), false);
  assert.equal(operators.neq(5, 6), true);
  assert.equal(operators.gt(6, 5), true);
  assert.equal(operators.gt(5, 5), false);
  assert.equal(operators.gte(5, 5), true);
  assert.equal(operators.lt(4, 5), true);
  assert.equal(operators.lte(5, 5), true);
  assert.equal(operators.in('spam', ['spam', 'phishing']), true);
  assert.equal(operators.in('clean', ['spam']), false);
  assert.equal(operators.contains(['a', 'b'], 'b'), true);
  assert.equal(operators.contains('hello world', 'world'), true);
  assert.equal(operators.contains('hello', 'zzz'), false);
});

test('numeric operators are total: NaN/garbage → false, never throw', () => {
  assert.equal(operators.gt('not a number', 5), false);
  assert.equal(operators.gte(undefined, 5), false); // Number(undefined) === NaN → false
  assert.equal(operators.lt('xyz', 5), false);       // unparseable string → NaN → false
  assert.equal(operators.in('x', 'not-an-array'), false);
  assert.equal(operators.contains(42, 4), false); // number is neither array nor string
});

// ── resolveFact ───────────────────────────────────────────────────────────────
test('resolveFact reads flat and dotted paths, undefined when missing', () => {
  const facts = { a: 1, user: { reputation: 30, nested: { deep: 'x' } } };
  assert.equal(resolveFact(facts, 'a'), 1);
  assert.equal(resolveFact(facts, 'user.reputation'), 30);
  assert.equal(resolveFact(facts, 'user.nested.deep'), 'x');
  assert.equal(resolveFact(facts, 'missing'), undefined);
  assert.equal(resolveFact(facts, 'user.missing.deeper'), undefined);
  assert.equal(resolveFact(null, 'a'), undefined);
});

// ── evaluateCondition ───────────────────────────────────────────────────────────
test('evaluateCondition returns a descriptive trace entry', () => {
  const e = evaluateCondition({ fact: 'age', op: 'gte', value: 30 }, { age: 40 });
  assert.equal(e.passed, true);
  assert.equal(e.actual, 40);
  assert.equal(e.error, null);

  const fail = evaluateCondition({ fact: 'age', op: 'gte', value: 30 }, { age: 10 });
  assert.equal(fail.passed, false);

  const bad = evaluateCondition({ fact: 'age', op: 'bogus', value: 1 }, { age: 10 });
  assert.equal(bad.passed, false);
  assert.match(bad.error, /unknown operator/);
});

// ── Engine.addRule validation ─────────────────────────────────────────────────
test('addRule rejects nameless rules and defaults when/priority', () => {
  const e = new Engine();
  assert.throws(() => e.addRule({ when: [], then: 1 }), /non-empty string name/);
  assert.throws(() => e.addRule({ name: '' }), /non-empty string name/);
  e.addRule({ name: 'bare' }); // no when/priority
  assert.equal(e.rules[0].priority, 0);
  assert.deepEqual(e.rules[0].when, []);
});

// ── priority ordering ───────────────────────────────────────────────────────────
test('rules fire in priority order (highest first), stable on ties', () => {
  const e = new Engine([
    { name: 'low', priority: 1, when: [], then: 'low' },
    { name: 'high', priority: 100, when: [], then: 'high' },
    { name: 'mid-a', priority: 50, when: [], then: 'mid-a' },
    { name: 'mid-b', priority: 50, when: [], then: 'mid-b' },
  ]);
  const { firedRules, outcomes } = e.run({});
  assert.deepEqual(firedRules, ['high', 'mid-a', 'mid-b', 'low']);
  assert.deepEqual(outcomes, ['high', 'mid-a', 'mid-b', 'low']);
});

// ── AND semantics: all conditions must hold ─────────────────────────────────────
test('a rule fires only when ALL conditions pass', () => {
  const e = new Engine([
    { name: 'both', when: [
      { fact: 'a', op: 'eq', value: 1 },
      { fact: 'b', op: 'eq', value: 2 },
    ], then: 'ok' },
  ]);
  assert.deepEqual(e.run({ a: 1, b: 2 }).firedRules, ['both']);
  assert.deepEqual(e.run({ a: 1, b: 99 }).firedRules, []);
  // empty `when` always matches
  const always = new Engine([{ name: 'always', when: [], then: 'x' }]);
  assert.deepEqual(always.run({}).firedRules, ['always']);
});

// ── trace is the audit hook ─────────────────────────────────────────────────────
test('trace lists every rule with fired flag and per-condition detail', () => {
  const e = new Engine([
    { name: 'r1', priority: 10, when: [{ fact: 'x', op: 'gt', value: 5 }], then: 'fired' },
    { name: 'r2', priority: 5, when: [{ fact: 'x', op: 'lt', value: 0 }], then: 'nope' },
  ]);
  const { trace } = e.run({ x: 7 });
  assert.equal(trace.length, 2);
  assert.equal(trace[0].rule, 'r1');
  assert.equal(trace[0].fired, true);
  assert.equal(trace[0].conditions[0].actual, 7);
  assert.equal(trace[1].rule, 'r2');
  assert.equal(trace[1].fired, false);
  assert.equal(trace[1].conditions[0].passed, false);
});

// ── eligibility example: pass / fail as expected ────────────────────────────────
test('eligibilityRules: established account is granted', () => {
  const e = new Engine(eligibilityRules);
  const r = e.run({ accountAgeDays: 40, reputation: 30, flagged: false });
  assert.deepEqual(r.firedRules, ['granted:established']);
  assert.equal(r.outcomes[0].decision, 'granted');
});

test('eligibilityRules: flagged account is denied (highest priority wins the trace top slot)', () => {
  const e = new Engine(eligibilityRules);
  const r = e.run({ accountAgeDays: 365, reputation: 99, flagged: true });
  assert.deepEqual(r.firedRules, ['denied:flagged']);
  assert.equal(r.outcomes[0].decision, 'denied');
  // the granted rule must NOT fire because flagged !== true fails
  assert.ok(!r.firedRules.includes('granted:established'));
});

test('eligibilityRules: too-new account is denied and not granted', () => {
  const e = new Engine(eligibilityRules);
  const r = e.run({ accountAgeDays: 3, reputation: 50, flagged: false });
  assert.deepEqual(r.firedRules, ['denied:too-new']);
  assert.ok(!r.firedRules.includes('granted:established'));
});

// ── moderation example ──────────────────────────────────────────────────────────
test('moderationRules: banned term blocks, clean short text is allowed', () => {
  const e = new Engine(moderationRules);
  const blocked = e.run({ text: 'buy scam-token-xyz now', category: 'normal', length: 18 });
  assert.equal(blocked.firedRules[0], 'block:banned-term');

  const clean = e.run({ text: 'hello chain', category: 'normal', length: 11 });
  assert.deepEqual(clean.firedRules, ['allow:short-and-clean']);

  const risky = e.run({ text: 'hello', category: 'phishing', length: 5 });
  // both review (p50) and allow (p1) fire; review comes first by priority
  assert.deepEqual(risky.firedRules, ['review:risky-category', 'allow:short-and-clean']);
});
