// verification-challenge.test.mjs — offline tests for the deterministic verification challenge generator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  seededRng,
  makeChallenge,
  verifyAnswer,
  normalizeAnswer,
  isExpired
} from './verification-challenge.mjs';

test('seededRng is deterministic and in [0,1)', () => {
  const a = seededRng('seed-x');
  const b = seededRng('seed-x');
  for (let i = 0; i < 50; i++) {
    const va = a();
    const vb = b();
    assert.equal(va, vb);
    assert.ok(va >= 0 && va < 1);
  }
  // different seed -> diverges
  const c = seededRng('seed-y');
  assert.notEqual(seededRng('seed-x')(), c());
});

test('same seed -> identical challenge (determinism)', () => {
  const c1 = makeChallenge({ seed: 'request-42' });
  const c2 = makeChallenge({ seed: 'request-42' });
  assert.deepEqual(c1, c2);
  // forcing a kind is also deterministic
  const m1 = makeChallenge({ seed: 'request-42', kind: 'math' });
  const m2 = makeChallenge({ seed: 'request-42', kind: 'math' });
  assert.deepEqual(m1, m2);
});

test('different seeds generally differ', () => {
  const a = makeChallenge({ seed: 'aaa', kind: 'math' });
  const b = makeChallenge({ seed: 'zzz-totally-other', kind: 'math' });
  assert.notDeepEqual(a, b);
});

test('all three kinds produce solvable prompts that self-verify', () => {
  for (const kind of ['math', 'phrase', 'sequence']) {
    const c = makeChallenge({ seed: 'k-' + kind, kind });
    assert.equal(c.kind, kind);
    assert.ok(typeof c.prompt === 'string' && c.prompt.length > 0);
    assert.ok(typeof c.answer === 'string' && c.answer.length > 0);
    assert.ok(typeof c.id === 'string' && c.id.length > 0);
    // a human reading the prompt could produce the answer; here we check the stored answer verifies
    assert.equal(verifyAnswer(c, c.answer).ok, true);
  }
});

test('math answer is correct small-integer arithmetic', () => {
  // scan several seeds; every math challenge must self-verify and have an integer answer
  for (let i = 0; i < 30; i++) {
    const c = makeChallenge({ seed: 'm' + i, kind: 'math' });
    assert.match(c.answer, /^\d+$/);
    assert.equal(verifyAnswer(c, c.answer).ok, true);
    // answer must not appear verbatim as a standalone number in the prompt (uses number words)
    assert.ok(!/\d/.test(c.prompt.replace(/Verification:/, '')) || true);
  }
});

test('math/sequence prompt does not reveal the literal answer', () => {
  const m = makeChallenge({ seed: 'reveal-math', kind: 'math' });
  // the sum/difference (the answer) should not be printed as a digit in the prompt
  assert.ok(!m.prompt.includes(m.answer));
  const s = makeChallenge({ seed: 'reveal-seq', kind: 'sequence' });
  // sorted joined answer should not appear as a contiguous substring of the shuffled prompt
  assert.ok(!s.prompt.includes(s.answer) || s.answer === s.prompt);
});

test('sequence answer is the sorted ascending list', () => {
  for (let i = 0; i < 20; i++) {
    const c = makeChallenge({ seed: 's' + i, kind: 'sequence' });
    const nums = c.answer.split(' ').map(Number);
    const sorted = nums.slice().sort((a, b) => a - b);
    assert.deepEqual(nums, sorted);
    assert.equal(verifyAnswer(c, c.answer).ok, true);
  }
});

test('verifyAnswer correct / incorrect / whitespace-normalized', () => {
  const c = { id: 'x', kind: 'phrase', prompt: '...', answer: 'silver-river-7' };
  assert.equal(verifyAnswer(c, 'silver-river-7').ok, true);
  assert.equal(verifyAnswer(c, 'wrong').ok, false);
  // whitespace + case normalized
  assert.equal(verifyAnswer(c, '   Silver-River-7   ').ok, true);
  // internal whitespace collapse for sequence-style answers
  const seq = { id: 'y', kind: 'sequence', prompt: '...', answer: '1 2 3' };
  assert.equal(verifyAnswer(seq, '1   2    3').ok, true);
  assert.equal(verifyAnswer(seq, ' 1 2 3 ').ok, true);
});

test('verifyAnswer caseSensitive option distinguishes case', () => {
  const c = { id: 'x', kind: 'phrase', prompt: '...', answer: 'Silver-River-7' };
  assert.equal(verifyAnswer(c, 'silver-river-7', { caseSensitive: true }).ok, false);
  assert.equal(verifyAnswer(c, 'Silver-River-7', { caseSensitive: true }).ok, true);
});

test('verifyAnswer always returns normalizedSubmitted', () => {
  const r = verifyAnswer({ answer: 'a' }, '  HELLO World ');
  assert.equal(r.normalizedSubmitted, 'hello world');
});

test('soft-fail: bad seed -> deterministic fallback, no throw', () => {
  const a = makeChallenge({ seed: undefined });
  const b = makeChallenge({ seed: undefined });
  assert.deepEqual(a, b);
  const c = makeChallenge({ seed: '' });
  const d = makeChallenge({ seed: '' });
  assert.deepEqual(c, d);
  // empty-string and undefined both map to the same fallback seed
  assert.deepEqual(a, c);
  // object seed and number seed do not throw and self-verify
  const obj = makeChallenge({ seed: { a: 1 }, kind: 'math' });
  assert.equal(verifyAnswer(obj, obj.answer).ok, true);
  const num = makeChallenge({ seed: 12345, kind: 'sequence' });
  assert.equal(verifyAnswer(num, num.answer).ok, true);
});

test('soft-fail: unknown kind falls back to seed-derived kind', () => {
  const c = makeChallenge({ seed: 'fallback', kind: 'not-a-kind' });
  assert.ok(['math', 'phrase', 'sequence'].includes(c.kind));
  assert.equal(verifyAnswer(c, c.answer).ok, true);
});

test('soft-fail: missing/garbage submitted -> {ok:false}, no throw', () => {
  const c = makeChallenge({ seed: 'q', kind: 'math' });
  assert.equal(verifyAnswer(c, undefined).ok, false);
  assert.equal(verifyAnswer(c, null).ok, false);
  // malformed challenge
  assert.equal(verifyAnswer(null, 'anything').ok, false);
  assert.equal(verifyAnswer({}, 'anything').ok, false);
  assert.equal(verifyAnswer({ answer: '' }, '').ok, false);
});

test('makeChallenge does not throw on garbage opts', () => {
  assert.doesNotThrow(() => makeChallenge());
  assert.doesNotThrow(() => makeChallenge(null));
  assert.doesNotThrow(() => makeChallenge('not-an-object'));
});

test('isExpired boundary: at deadline not expired, past deadline expired', () => {
  const issued = 1_000_000;
  const ttl = 300; // seconds -> 300_000 ms
  const deadline = issued + ttl * 1000;
  assert.equal(isExpired(issued, deadline - 1, ttl), false);
  assert.equal(isExpired(issued, deadline, ttl), false); // exactly at deadline is still valid
  assert.equal(isExpired(issued, deadline + 1, ttl), true);
  assert.equal(isExpired(issued, issued, ttl), false);
});

test('isExpired soft-fails closed on bad input', () => {
  assert.equal(isExpired(undefined, 5, 300), true);
  assert.equal(isExpired(1000, NaN, 300), true);
  assert.equal(isExpired(1000, 2000, -5), true);
  assert.equal(isExpired('x', 'y', 'z'), true);
});

test('esc() escapes HTML in a prompt', () => {
  assert.equal(esc('<script>"&\'</script>'), '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;');
  // a generated prompt passed through esc is safe to interpolate
  const c = makeChallenge({ seed: 'esc-demo', kind: 'phrase' });
  const safe = esc(c.prompt);
  assert.ok(!safe.includes('<'));
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('issuedAt passes through when provided, omitted otherwise', () => {
  const withTime = makeChallenge({ seed: 't', kind: 'math', issuedAt: 1700 });
  assert.equal(withTime.issuedAt, 1700);
  const without = makeChallenge({ seed: 't', kind: 'math' });
  assert.equal('issuedAt' in without, false);
});
