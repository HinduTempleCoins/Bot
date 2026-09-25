import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECOVERY_FACTORS, CATEGORIES, byCategory, validatePath, factor, STRONG } from './recovery-options.mjs';

test('every factor is well-formed', () => {
  const seen = new Set();
  for (const f of RECOVERY_FACTORS) {
    assert.ok(f.id && !seen.has(f.id), `unique id: ${f.id}`); seen.add(f.id);
    assert.ok(CATEGORIES[f.cat], `known category: ${f.cat}`);
    assert.ok(['strong', 'medium', 'weak'].includes(f.strength));
    assert.equal(typeof f.standalone, 'boolean');
    assert.ok(f.online === true || f.offline === true, `${f.id} lives online or offline`);
    assert.ok(f.what && f.howto);
  }
});

test('menu is broad (all the options) and covers offline decoder rings', () => {
  assert.ok(RECOVERY_FACTORS.length >= 18, 'a full menu, not a token few');
  for (const id of ['decoder-key', 'email', 'image-keyfile', 'melek-signer', 'passkey', 'social-guardians', 'recovery-codes', 'identity-check', 'mnemonic', 'time-delay']) {
    assert.ok(factor(id), `menu includes ${id}`);
  }
  assert.ok(RECOVERY_FACTORS.some((f) => f.offline), 'has offline rings');
});

test('byCategory groups every factor', () => {
  const g = byCategory();
  const total = Object.values(g).reduce((n, c) => n + c.factors.length, 0);
  assert.equal(total, RECOVERY_FACTORS.length);
});

test('a valid path needs a strong factor', () => {
  assert.equal(validatePath(['security-questions', 'email']).valid, false); // no strong
  assert.equal(validatePath(['melek-signer']).valid, true);
  assert.equal(validatePath(['decoder-key', 'security-questions'], { threshold: 2 }).valid, true);
});

test('threshold sanity', () => {
  assert.equal(validatePath(['melek-signer', 'passkey'], { threshold: 3 }).valid, false); // K>N
  assert.equal(validatePath([]).valid, false);
  const r = validatePath(['melek-signer', 'email'], { threshold: 1 });
  assert.equal(r.valid, true); assert.equal(r.threshold, 1);
});

test('warnings surface weak choices without blocking a strong path', () => {
  const r = validatePath(['melek-signer', 'sms'], { threshold: 1 });
  assert.equal(r.valid, true);
  assert.ok(r.warnings.length >= 1);
});

test('STRONG set matches strength field', () => {
  for (const f of RECOVERY_FACTORS) assert.equal(STRONG.has(f.id), f.strength === 'strong');
});
